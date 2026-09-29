export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  getSessionScopedBusinessId,
  getUserIdFromRequest,
  requirePortalSession,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { resolveBranchId } from '@/lib/branch-helpers';
import { periodGuardResponse } from '@/lib/http/period-guards';
import {
  createInvoiceInTransaction,
  InvoiceCreateServiceError,
  type CreateInvoiceInput,
  type CreateInvoiceItemInput,
} from '@/lib/invoices/invoice-create-service';

/**
 * POST /api/invoices/[id]/convert-to-tax-invoice  body: { status?: 'draft' | 'final', invoice_date? }
 *
 * Creates the tax invoice through the same service as POST /api/invoices, so GST is recomputed
 * server-side (scheme / bill-of-supply rules) and a final invoice posts stock, customer balance
 * and its ledger voucher in the same transaction as the document.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const gate = await requirePortalSession(request);
  if (gate) return gate;

  const businessId = getSessionScopedBusinessId(request);
  if (!businessId) {
    return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
  }
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
  }

  const proformaId = params.id;
  const body = await request.json().catch(() => ({}));
  const targetStatus = (body.status === 'final' ? 'final' : 'draft') as 'draft' | 'final';

  const pool = getPool();
  const client = await pool.connect();
  try {
    const proformaRes = await client.query(
      `SELECT * FROM invoices
        WHERE id = $1 AND business_id = $2 AND document_type = 'proforma_invoice' AND deleted_at IS NULL`,
      [proformaId, businessId]
    );
    if (proformaRes.rows.length === 0) {
      return NextResponse.json({ error: 'Proforma invoice not found or is not a proforma invoice' }, { status: 404 });
    }
    const proforma = proformaRes.rows[0];

    let invoiceBranchId: string;
    try {
      invoiceBranchId = await resolveBranchId({ businessId, branchId: proforma.branch_id || null });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Could not resolve branch for invoice' }, { status: 400 });
    }

    try {
      await authorize(userId, 'invoices', 'create', { businessId, branchId: invoiceBranchId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const rawDate = body.invoice_date ?? proforma.invoice_date;
    const invoiceDate =
      rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : String(rawDate).slice(0, 10);

    if (targetStatus === 'final') {
      const guard = await periodGuardResponse({
        businessId,
        branchId: invoiceBranchId,
        dates: [invoiceDate],
        action: 'create this invoice',
        checkGstFiled: true,
      });
      if (guard) return guard;
    }

    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT proforma_lifecycle_status FROM invoices WHERE id = $1 FOR UPDATE`,
      [proformaId]
    );
    if (locked.rows[0]?.proforma_lifecycle_status === 'converted_to_tax_invoice') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Proforma invoice already converted to a tax invoice' }, { status: 409 });
    }

    const itemsRes = await client.query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, id`,
      [proformaId]
    );
    if (itemsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Proforma invoice has no items' }, { status: 400 });
    }

    let locationId: string | null = null;
    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    if (await isWarehouseModeEnabled(businessId)) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      locationId = await getDefaultWarehouseForBranch(invoiceBranchId);
      if (!locationId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Warehouse mode is enabled but no default warehouse is configured for this branch.', code: 'WAREHOUSE_REQUIRED' },
          { status: 400 }
        );
      }
    }

    const items: CreateInvoiceItemInput[] = itemsRes.rows.map((it: any) => ({
      item_id: it.item_id || null,
      variant_id: it.variant_id || null,
      item_name: it.item_name,
      description: it.description || null,
      hsn_sac: it.hsn_sac || null,
      quantity: Number(it.quantity) || 0,
      unit: it.unit || undefined,
      unit_price: Number(it.unit_price) || 0,
      discount_percent: Number(it.discount_percent) || 0,
      tax_rate: Number(it.tax_rate) || 0,
      location_id: locationId,
    }));

    const payload: CreateInvoiceInput & Record<string, unknown> = {
      business_id: businessId,
      created_by: userId,
      branch_id: invoiceBranchId,
      customer_id: proforma.customer_id || null,
      invoice_date: invoiceDate,
      due_date: proforma.due_date || null,
      status: targetStatus,
      document_type: 'tax_invoice',
      items,
      additional_charges: Number(proforma.additional_charges) || 0,
      round_off: Number(proforma.round_off) || 0,
      enable_round_off: proforma.enable_round_off ?? false,
      notes: proforma.notes,
      billing_address: proforma.billing_address,
      shipping_address: proforma.shipping_address,
      place_of_supply_state_code: proforma.place_of_supply_state_code,
      prices_include_gst: proforma.prices_include_gst === true,
      is_export: proforma.is_export || false,
      supply_type: proforma.supply_type,
      export_type: proforma.export_type,
      template_id: proforma.template_id || null,
    };

    const result = await createInvoiceInTransaction(client, payload, { allowDraft: true });

    await client.query(
      `UPDATE invoices
          SET terms = $2, template_settings = $3, shipping_bill_number = $4, shipping_bill_date = $5, port_code = $6,
              ecommerce_operator_gstin = $7, is_ecommerce_supply = $8, supply_type = $9, export_type = $10
        WHERE id = $1`,
      [
        result.invoiceId,
        proforma.terms,
        proforma.template_settings,
        proforma.shipping_bill_number,
        proforma.shipping_bill_date,
        proforma.port_code,
        proforma.ecommerce_operator_gstin,
        proforma.is_ecommerce_supply,
        proforma.supply_type,
        proforma.export_type,
      ]
    );

    await client.query(
      `UPDATE invoices
          SET notes = COALESCE(notes || E'\n\n', '') || 'Converted to Tax Invoice: ' || $1 || ' on ' || CURRENT_TIMESTAMP::text,
              proforma_lifecycle_status = 'converted_to_tax_invoice',
              proforma_lifecycle_notes = 'Converted to Tax Invoice: ' || $1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [result.invoiceNumber, proformaId]
    );
    await client.query(
      `INSERT INTO proforma_lifecycle_timeline (invoice_id, status, notes, created_by)
       VALUES ($1, 'converted_to_tax_invoice', $2, $3)`,
      [proformaId, `Converted to Tax Invoice: ${result.invoiceNumber}`, userId]
    );

    await client.query('COMMIT');
    return NextResponse.json({
      success: true,
      invoice_id: result.invoiceId,
      invoice_number: result.invoiceNumber,
      message: 'Proforma invoice converted to tax invoice successfully',
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof InvoiceCreateServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(error.details || {}) },
        { status: error.statusCode }
      );
    }
    console.error('Error converting proforma:', error);
    return NextResponse.json({ error: error?.message || 'Failed to convert proforma invoice' }, { status: 500 });
  } finally {
    client.release();
  }
}
