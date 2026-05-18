import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { calculateCreditMetrics, getCreditWarningMessage } from '@/lib/credit-utils';
import { checkAndSendCreditAlerts } from '@/lib/credit-alerts';
import { deriveInvoicePaymentStatus } from '@/lib/invoice-payment-status';
import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';

type ProfitSummary = {
  total_revenue: number;
  total_cost: number;
  total_profit: number;
  margin_percent: number;
};

/**
 * Gross profit from stored line totals: revenue (taxable/ex-disc pre-GST column) − cost × qty.
 * Missing purchase prices count as zero cost per requirements.
 */
function computeInvoiceProfitSummary(
  rows: Array<Record<string, unknown>>
): ProfitSummary {
  let totalRevenue = 0;
  let totalCost = 0;

  for (const row of rows) {
    const qty = Number(row.quantity) || 0;
    const taxable = row.taxable_value != null ? Number(row.taxable_value) : NaN;
    let revenue: number;
    if (Number.isFinite(taxable)) {
      revenue = Math.max(0, taxable);
    } else {
      const unitPrice = Number(row.unit_price) || 0;
      const discountAmt = Number(row.discount_amount) || 0;
      revenue = Math.max(0, qty * unitPrice - discountAmt);
    }

    let unitCost = 0;
    if (
      row.resolved_unit_cost != null &&
      row.resolved_unit_cost !== ''
    ) {
      const c = Number(row.resolved_unit_cost);
      if (Number.isFinite(c) && c >= 0) unitCost = c;
    }

    totalRevenue += revenue;
    totalCost += qty * unitCost;
  }

  const totalProfit = totalRevenue - totalCost;
  const margin_percent =
    totalRevenue > 1e-9
      ? Math.round(((totalProfit / totalRevenue) * 100 + Number.EPSILON) * 100) / 100
      : 0;

  return {
    total_revenue: Math.round((totalRevenue + Number.EPSILON) * 100) / 100,
    total_cost: Math.round((totalCost + Number.EPSILON) * 100) / 100,
    total_profit: Math.round((totalProfit + Number.EPSILON) * 100) / 100,
    margin_percent,
  };
}

/**
 * GET /api/invoices/[id]
 * Fetch a single invoice with its items
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const invoiceId = params.id;

  try {
    // Get user_id from query params (required for authorization)
    const userId = getUserIdFromRequest(request);
    
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const businessScope = getBusinessIdFromRequest(request);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Tenant-scoped: only rows for the JWT/session active business
    const invoiceResult = await pool.query(
      `SELECT 
        i.*,
        c.name as customer_name,
        c.phone as customer_phone,
        c.email as customer_email,
        c.gstin as customer_gstin,
        c.billing_address as customer_billing_address,
        c.shipping_address as customer_shipping_address
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
      WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL`,
      [invoiceId, businessScope]
    );

    if (invoiceResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    const invoice = invoiceResult.rows[0];

    // AUTHORIZATION: Check read permission (PBAC will check branch access, business ownership)
    try {
      await authorize(userId, 'invoices', 'read', { 
        branchId: invoice.branch_id,
        businessId: invoice.business_id,
        resourceId: invoiceId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Fetch invoice items with variant information (tenant-safe joins for cost pricing)
    const itemsResult = await pool.query(
      `SELECT 
        ii.*,
        i.name AS item_name,
        i.code AS item_code,
        iv.variant_name,
        iv.attributes AS variant_attributes,
        COALESCE(
          iv.purchase_price,
          i.purchase_price,
          iv_parent.purchase_price,
          0
        )::numeric AS resolved_unit_cost
      FROM invoice_items ii
      INNER JOIN invoices inv ON inv.id = ii.invoice_id AND inv.business_id = $2 AND inv.deleted_at IS NULL
      LEFT JOIN items i ON ii.item_id = i.id AND i.business_id = inv.business_id
      LEFT JOIN item_variants iv
        ON iv.id = ii.variant_id
        AND (ii.item_id IS NULL OR ii.item_id = iv.item_id)
      LEFT JOIN items iv_parent
        ON iv.id IS NOT NULL
        AND iv_parent.id = iv.item_id
        AND iv_parent.business_id = inv.business_id
      WHERE ii.invoice_id = $1
      ORDER BY ii.sort_order, ii.id`,
      [invoiceId, businessScope]
    );

    const profit_summary = (await hasFeatureAccess(businessScope, FeatureKeys.PROFIT_INVOICE))
      ? computeInvoiceProfitSummary(
          itemsResult.rows as Array<Record<string, unknown>>
        )
      : null;

    invoice.items = itemsResult.rows.map(({ resolved_unit_cost: _r, ...line }) => line);

    // Fetch payments for this invoice
    const paymentsResult = await pool.query(
      `SELECT *
       FROM payments
       WHERE reference_type = 'invoice' AND reference_id = $1
         AND business_id = $2
         AND deleted_at IS NULL
       ORDER BY payment_date DESC`,
      [invoiceId, businessScope]
    );

    invoice.payments = paymentsResult.rows;

    // Align payment_status with balance when DB is stale (e.g. credit note adjusted balance only)
    if (invoice.status !== 'cancelled') {
      const normalized = deriveInvoicePaymentStatus(
        invoice.grand_total,
        invoice.paid_amount,
        invoice.balance_amount
      );
      if (normalized !== invoice.payment_status) {
        invoice.payment_status = normalized;
      }
    }

    // PHASE 4.2: Calculate credit metrics for customer (if applicable)
    let creditMetrics = null;
    let creditWarning = null;
    
    if (invoice.customer_id && invoice.document_type !== 'proforma_invoice') {
      try {
        const customerData = await pool.query(
          `SELECT credit_limit, current_balance FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
          [invoice.customer_id, invoice.business_id]
        );

        if (customerData.rows.length > 0) {
          const creditLimit = customerData.rows[0].credit_limit;
          const currentBalance = customerData.rows[0].current_balance;
          
          // Calculate current credit metrics
          const currentMetrics = calculateCreditMetrics(creditLimit, currentBalance);
          
          creditMetrics = {
            current: currentMetrics,
          };
          
          // Get warning message
          creditWarning = getCreditWarningMessage(
            currentMetrics,
            'customer'
          );

          // PHASE 5.4: Check and send credit alerts (async, non-blocking)
          checkAndSendCreditAlerts(
            invoice.business_id,
            'customer',
            invoice.customer_id,
            creditLimit,
            currentBalance,
            currentMetrics,
            'invoice',
            invoice.id
          ).catch(err => console.error('Error sending credit alert:', err));
        }
      } catch (creditError) {
        // Don't fail invoice fetch if credit calculation fails
        console.error('Error calculating credit metrics:', creditError);
      }
    }

    return NextResponse.json({ 
      invoice,
      credit_metrics: creditMetrics,
      credit_warning: creditWarning,
      profit_summary,
    });
  } catch (error: any) {
    console.error('Error fetching invoice:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invoice', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/invoices/[id]
 * Update invoice fields (including estimate_status for proforma invoices)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const invoiceId = params.id;

  try {
    const body = await request.json();
    const userId = getUserIdFromRequest(request, body);

    const businessScope = getBusinessIdFromRequest(request, body);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }
    
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Fetch invoice tenant-scoped
    const invoiceResult = await pool.query(
      'SELECT id, business_id, branch_id, document_type FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [invoiceId, businessScope]
    );

    if (invoiceResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    const invoice = invoiceResult.rows[0];

    const { estimate_status } = body;

    // Full document saves (draft edits, line items, totals) must use POST /api/invoices with body.id.
    // This PATCH route only handles proforma estimate_status; delegate tax/credit invoices to POST.
    if (invoice.document_type !== 'proforma_invoice') {
      if (body.items && Array.isArray(body.items)) {
        const { POST: postInvoice } = await import('../route');
        const postReq = new NextRequest(new URL('/api/invoices', request.url).href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, id: invoiceId }),
        });
        return postInvoice(postReq);
      }
      return NextResponse.json(
        { error: 'estimate_status can only be updated for proforma invoices' },
        { status: 400 }
      );
    }

    // For proforma invoices, we allow updating estimate_status even if invoice status is 'final'
    // because estimate_status is separate from invoice status
    // The authorization policy has been updated to allow this
    try {
      await authorize(userId, 'invoices', 'update', { 
        branchId: invoice.branch_id,
        businessId: invoice.business_id,
        resourceId: invoiceId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Validate estimate_status
    const validStatuses = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'];
    if (estimate_status && !validStatuses.includes(estimate_status)) {
      return NextResponse.json(
        { error: `Invalid estimate_status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Update estimate_status
    if (estimate_status) {
      await pool.query(
        'UPDATE invoices SET estimate_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND business_id = $3',
        [estimate_status, invoiceId, businessScope]
      );
    }

    // Fetch updated invoice
    const updatedResult = await pool.query(
      `SELECT 
        i.*,
        c.name as customer_name,
        c.phone as customer_phone,
        c.email as customer_email,
        c.gstin as customer_gstin,
        c.billing_address as customer_billing_address,
        c.shipping_address as customer_shipping_address
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
      WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL`,
      [invoiceId, businessScope]
    );

    const updatedInvoice = updatedResult.rows[0];

    // Fetch items
    const itemsResult = await pool.query(
      `SELECT 
        ii.*,
        i.name as item_name,
        i.code as item_code,
        iv.variant_name,
        iv.attributes as variant_attributes
      FROM invoice_items ii
      LEFT JOIN items i ON ii.item_id = i.id
      LEFT JOIN item_variants iv ON ii.variant_id = iv.id
      WHERE ii.invoice_id = $1
      ORDER BY ii.sort_order, ii.id`,
      [invoiceId]
    );

    updatedInvoice.items = itemsResult.rows;

    return NextResponse.json({ 
      invoice: updatedInvoice,
      message: 'Estimate status updated successfully'
    });
  } catch (error: any) {
    console.error('Error updating estimate status:', error);
    return NextResponse.json(
      { error: 'Failed to update estimate status', details: error.message },
      { status: 500 }
    );
  }
}
