import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { resolveBranchId } from '@/lib/branch-helpers';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { FeatureKeys } from '@/lib/featureKeys';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { InvoiceCreateServiceError } from '@/lib/invoices/invoice-create-service';
import { convertLinesToInvoice, todayIsoDate } from '@/lib/invoices/convert-to-invoice';
import { periodGuardResponse } from '@/lib/http/period-guards';

export const dynamic = 'force-dynamic';

/**
 * POST /api/estimates/[id]/convert
 * Convert estimate to a final tax invoice (body: { invoice_date?, due_date? }).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const estimateId = params.id;
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const tenant = requireTenantBusinessId(request);
  if (!tenant.ok) return tenant.response;

  const estimateMeta = await queryOne<{ business_id: string }>(
    'SELECT business_id FROM estimates WHERE id = $1 AND business_id = $2',
    [estimateId, tenant.businessId],
  );
  if (!estimateMeta) {
    return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
  }

  try {
    await authorize(userId, 'invoices', 'create', { businessId: estimateMeta.business_id });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  try {
    await enforceAccess({
      userId,
      businessId: estimateMeta.business_id,
      feature: FeatureKeys.ESTIMATES_QUOTATIONS,
    });
  } catch (error) {
    const denied = enforceAccessErrorResponse(error);
    if (denied) return denied;
    throw error;
  }

  const body = await request.json().catch(() => ({}));
  const invoiceDate = body?.invoice_date ? String(body.invoice_date).slice(0, 10) : todayIsoDate();

  let invoiceBranchId: string;
  try {
    invoiceBranchId = await resolveBranchId({ businessId: estimateMeta.business_id, branchId: body?.branch_id ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not resolve branch for invoice' }, { status: 400 });
  }

  const guard = await periodGuardResponse({
    businessId: estimateMeta.business_id,
    branchId: invoiceBranchId,
    dates: [invoiceDate],
    action: 'create this invoice',
    checkGstFiled: true,
  });
  if (guard) return guard;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const estimateRes = await client.query(
      `SELECT e.*, c.state_code AS customer_state_code, c.billing_address AS customer_billing_address
         FROM estimates e
         LEFT JOIN customers c ON c.id = e.customer_id
        WHERE e.id = $1 AND e.business_id = $2
        FOR UPDATE OF e`,
      [estimateId, tenant.businessId]
    );
    if (estimateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }
    const estimate = estimateRes.rows[0];

    if (estimate.status === 'converted' || estimate.converted_invoice_id) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Estimate already converted to invoice' }, { status: 400 });
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    let defaultWarehouseId: string | null = null;
    if (await isWarehouseModeEnabled(estimate.business_id)) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      defaultWarehouseId = await getDefaultWarehouseForBranch(invoiceBranchId);
      if (!defaultWarehouseId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Warehouse mode is enabled but no default warehouse is configured for this branch.', code: 'WAREHOUSE_REQUIRED' },
          { status: 400 }
        );
      }
    }

    const itemsRes = await client.query(
      `SELECT ei.*, i.name AS master_name, i.hsn_sac AS master_hsn
         FROM estimate_items ei
         LEFT JOIN items i ON i.id = ei.item_id
        WHERE ei.estimate_id = $1
        ORDER BY ei.sort_order`,
      [estimateId]
    );
    if (itemsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Estimate has no items' }, { status: 400 });
    }

    const result = await convertLinesToInvoice(client, {
      businessId: estimate.business_id,
      userId,
      branchId: invoiceBranchId,
      customerId: estimate.customer_id || null,
      invoiceDate,
      placeOfSupplyStateCode: estimate.customer_state_code || null,
      billingAddress: estimate.customer_billing_address || null,
      notes: estimate.notes,
      locationId: defaultWarehouseId,
      lines: itemsRes.rows.map((r: any) => {
        const qty = Number(r.qty) || 0;
        const gross = qty * (Number(r.unit_price) || 0);
        const discount = Number(r.discount) || 0;
        return {
          item_id: r.item_id,
          item_name: String(r.master_name || r.description || 'Line item').slice(0, 255),
          description: r.description,
          hsn_sac: r.master_hsn || null,
          quantity: qty,
          unit: r.unit,
          unit_price: r.unit_price,
          discount_percent: gross > 0 ? Math.round((discount / gross) * 1e6) / 1e4 : 0,
          tax_rate: r.tax_rate,
        };
      }),
    });

    await client.query(
      `UPDATE estimates SET status = 'converted', converted_invoice_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [result.invoiceId, estimateId]
    );

    if (body?.due_date) {
      await client.query(`UPDATE invoices SET due_date = $1 WHERE id = $2`, [body.due_date, result.invoiceId]);
    }

    await client.query('COMMIT');
    return NextResponse.json({ invoice: result.invoice, estimate_id: estimateId });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof InvoiceCreateServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(error.details || {}) },
        { status: error.statusCode }
      );
    }
    console.error('Error converting estimate to invoice:', error);
    const status = typeof error?.statusCode === 'number' ? error.statusCode : 500;
    return NextResponse.json(
      { error: status === 500 ? 'Failed to convert estimate' : error.message, details: error.message },
      { status }
    );
  } finally {
    client.release();
  }
}
