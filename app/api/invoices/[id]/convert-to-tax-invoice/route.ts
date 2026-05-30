import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  getSessionScopedBusinessId,
  getUserIdFromRequest,
  requirePortalSession,
} from '@/lib/auth-helpers';
import {
  enforceAccess,
  enforceAccessErrorResponse,
} from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const businessScope = getSessionScopedBusinessId(request);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const { id: proformaId } = params;
    
    // Get target status from request body (default to 'draft' for backward compatibility)
    const body = await request.json().catch(() => ({}));
    const targetStatus = (body.status === 'final' ? 'final' : 'draft') as 'draft' | 'final';
    
    // Get proforma invoice
    const proformaRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND business_id = $2 AND document_type = 'proforma_invoice' AND deleted_at IS NULL`,
      [proformaId, businessScope]
    );
    
    if (proformaRes.rows.length === 0) {
      return NextResponse.json({ error: 'Proforma invoice not found or is not a proforma invoice' }, { status: 404 });
    }
    
    const proformaData = proformaRes.rows[0];
    
    // Get invoice items
    const itemsRes = await client.query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, id`,
      [proformaId]
    );
    
    const items = itemsRes.rows;
    
    if (items.length === 0) {
      return NextResponse.json({ error: 'Proforma invoice has no items' }, { status: 400 });
    }
    
    await client.query('BEGIN');
    
    try {
      try {
        await enforceAccess({
          businessId: proformaData.business_id,
          userId,
          feature: FeatureKeys.INVOICE_CREATION,
          limitType: 'invoices',
          poolClient: client,
        });
      } catch (e) {
        const res = enforceAccessErrorResponse(e);
        if (res) {
          await client.query('ROLLBACK');
          return res;
        }
        throw e;
      }

      // Get next invoice number for tax invoice
      const nextNumRes = await client.query(
        `SELECT next_tax_invoice_number, invoice_prefix
         FROM businesses 
         WHERE id = $1`,
        [proformaData.business_id]
      );
      
      if (nextNumRes.rows.length === 0) {
        throw new Error('Business not found');
      }
      
      const nextNumber = nextNumRes.rows[0].next_tax_invoice_number || 1;
      const prefix = nextNumRes.rows[0].invoice_prefix || 'INV';
      const formattedNumber = String(nextNumber).padStart(3, '0');
      const invoiceNumber = `${prefix}-${formattedNumber}`;
      
      // Create tax invoice
      const newInvoiceRes = await client.query(
        `INSERT INTO invoices (
          business_id, customer_id, invoice_number, invoice_date, due_date,
          status, payment_status, subtotal, discount_total, additional_charges, tax_total,
          round_off, grand_total, paid_amount, balance_amount, notes, terms,
          template_id, template_settings, billing_address, shipping_address, place_of_supply_state_code,
          cgst_total, sgst_total, igst_total, is_editable, cancellation_details,
          document_type, supply_type, export_type, shipping_bill_number, shipping_bill_date, port_code,
          ecommerce_operator_gstin, is_ecommerce_supply, is_export, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37)
        RETURNING id`,
        [
          proformaData.business_id,
          proformaData.customer_id,
          invoiceNumber,
          proformaData.invoice_date,
          proformaData.due_date,
          targetStatus, // Use the status chosen by user (draft or final)
          'unpaid',
          proformaData.subtotal,
          proformaData.discount_total,
          proformaData.additional_charges,
          proformaData.tax_total,
          proformaData.round_off,
          proformaData.grand_total,
          0, // paid_amount
          proformaData.grand_total, // balance_amount
          proformaData.notes,
          proformaData.terms,
          proformaData.template_id,
          proformaData.template_settings,
          proformaData.billing_address,
          proformaData.shipping_address,
          proformaData.place_of_supply_state_code,
          proformaData.cgst_total,
          proformaData.sgst_total,
          proformaData.igst_total,
          true, // is_editable
          null, // cancellation_details
          'tax_invoice',
          proformaData.supply_type,
          proformaData.export_type,
          proformaData.shipping_bill_number,
          proformaData.shipping_bill_date,
          proformaData.port_code,
          proformaData.ecommerce_operator_gstin,
          proformaData.is_ecommerce_supply,
          proformaData.is_export || false,
          proformaData.created_by
        ]
      );
      
      const newInvoiceId = newInvoiceRes.rows[0].id;
      
      // Copy items
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Calculate line_total if not present: taxable_value + tax_amount
        // If taxable_value is null, calculate it: (unit_price * quantity) - discount_amount
        // Ensure all values are numbers, not strings
        const unitPrice = parseFloat(item.unit_price) || 0;
        const quantity = parseFloat(item.quantity) || 0;
        const discountAmount = parseFloat(item.discount_amount) || 0;
        const taxAmount = parseFloat(item.tax_amount) || 0;
        
        const taxableValue = item.taxable_value != null 
          ? parseFloat(item.taxable_value)
          : (unitPrice * quantity) - discountAmount;
        
        const lineTotal = taxableValue + taxAmount;
        
        await client.query(
          `INSERT INTO invoice_items (
            invoice_id, item_id, variant_id, item_name, description, hsn_sac,
            quantity, unit, unit_price, discount_percent, discount_amount,
            tax_rate, taxable_value, cgst_amount, sgst_amount, igst_amount, tax_amount,
            line_total, sort_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [
            newInvoiceId,
            item.item_id,
            item.variant_id,
            item.item_name,
            item.description,
            item.hsn_sac,
            parseFloat(item.quantity) || 0,
            item.unit,
            parseFloat(item.unit_price) || 0,
            parseFloat(item.discount_percent) || 0,
            parseFloat(item.discount_amount) || 0,
            parseFloat(item.tax_rate) || 0,
            taxableValue,
            parseFloat(item.cgst_amount) || 0,
            parseFloat(item.sgst_amount) || 0,
            parseFloat(item.igst_amount) || 0,
            taxAmount,
            lineTotal,
            item.sort_order || i
          ]
        );
      }
      
      // Increment invoice counter
      await client.query(
        `UPDATE businesses 
         SET next_tax_invoice_number = next_tax_invoice_number + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [proformaData.business_id]
      );
      
      // Mark proforma as converted (update lifecycle status and add note)
      // Get user ID from request body, headers, or use invoice's created_by
      const actorUserId = getUserIdFromRequest(request, body) || userId || proformaData.created_by;
      
      await client.query(
        `UPDATE invoices 
         SET notes = COALESCE(notes || E'\n\n', '') || 'Converted to Tax Invoice: ' || $1 || ' on ' || CURRENT_TIMESTAMP::text,
             proforma_lifecycle_status = 'converted_to_tax_invoice',
             proforma_lifecycle_notes = 'Converted to Tax Invoice: ' || $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [invoiceNumber, proformaId]
      );
      
      // Add timeline entry for conversion
      await client.query(
        `INSERT INTO proforma_lifecycle_timeline (invoice_id, status, notes, created_by)
         VALUES ($1, 'converted_to_tax_invoice', $2, $3)`,
        [proformaId, `Converted to Tax Invoice: ${invoiceNumber}`, actorUserId]
      );
      
      await client.query('COMMIT');
      
      return NextResponse.json({
        success: true,
        invoice_id: newInvoiceId,
        invoice_number: invoiceNumber,
        message: 'Proforma invoice converted to tax invoice successfully'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    
  } catch (error: any) {
    console.error('Error converting proforma:', error);
    return NextResponse.json({ error: error.message || 'Failed to convert proforma invoice' }, { status: 500 });
  } finally {
    client.release();
  }
}

