import { NextResponse, type NextRequest } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { INVOICE_CHANNELS, type InvoiceChannel } from '@/lib/invoices/channel';
import {
  type ReportContext,
  resolveReportContext,
  reportParams,
  handleReportError,
  r2,
  num,
} from '@/lib/reports/report-context';

/**
 * Shared basis for the sales reports (by customer, by item, summary, invoice details).
 *
 * Sales = posted invoices (status 'final', not proforma, not deleted) minus active credit notes,
 * both by document date. "Sales" excludes GST (grand_total - tax_total, which is what the ledger
 * credits to the Sales account); "sales with tax" is the document total. This matches Zoho's
 * Sales by Customer / Item / Summary and reconciles to the P&L.
 *
 * Query params: from_date, to_date (YYYY-MM-DD, optional), branch_id (optional; ALL = all branches).
 * SQL placeholders are fixed: $1 business, $2 from, $3 to, $4 branch.
 */

export type SalesReportContext = ReportContext;

/**
 * Report context, after posting store orders that are paid or cash on delivery but not yet
 * invoiced (the dashboard does the same), so a store sale never shows on the dashboard but not here.
 */
export async function resolveSalesReportContext(request: NextRequest): Promise<SalesReportContext | NextResponse> {
  const ctx = await resolveReportContext(request);
  if (ctx instanceof NextResponse) return ctx;
  const { accountOutstandingStoreOrders } = await import('@/lib/store/fulfill-paid-order');
  await accountOutstandingStoreOrders(ctx.businessId, ctx.userId).catch((err) => {
    console.error('[store invoice]', err);
  });
  return ctx;
}

const params = reportParams;

const POSTED_INVOICE = (a: string) => `
  ${a}.business_id = $1 AND ${a}.deleted_at IS NULL AND ${a}.status = 'final'
  AND COALESCE(${a}.document_type, 'tax_invoice') <> 'proforma_invoice'
  AND ($2::date IS NULL OR ${a}.invoice_date >= $2::date)
  AND ($3::date IS NULL OR ${a}.invoice_date <= $3::date)
  AND ($4::uuid IS NULL OR ${a}.branch_id = $4::uuid)`;

const ACTIVE_CREDIT_NOTE = (a: string) => `
  ${a}.business_id = $1 AND COALESCE(${a}.status, 'active') <> 'cancelled'
  AND ($2::date IS NULL OR ${a}.credit_note_date >= $2::date)
  AND ($3::date IS NULL OR ${a}.credit_note_date <= $3::date)
  AND ($4::uuid IS NULL OR ${a}.branch_id = $4::uuid)`;

export const handleSalesReportError = handleReportError;

// ---------------------------------------------------------------- by customer

export interface SalesByCustomerRow {
  customer_id: string | null;
  customer_name: string;
  phone: string | null;
  gstin: string | null;
  invoice_count: number;
  credit_note_count: number;
  invoice_sales: number;
  invoice_sales_with_tax: number;
  credit_note_sales: number;
  credit_note_sales_with_tax: number;
  sales: number;
  tax: number;
  sales_with_tax: number;
  discount: number;
  collected: number;
  balance_due: number;
}

export async function salesByCustomer(ctx: SalesReportContext) {
  const rows = await queryRows<any>(
    `WITH docs AS (
       SELECT i.customer_id, 1 AS is_inv, 0 AS is_cn,
              i.grand_total - COALESCE(i.tax_total, 0) AS sales, COALESCE(i.tax_total, 0) AS tax, i.grand_total AS with_tax,
              COALESCE(i.discount_total, 0) AS discount, COALESCE(i.paid_amount, 0) AS collected, COALESCE(i.balance_amount, 0) AS balance
         FROM invoices i
        WHERE ${POSTED_INVOICE('i')}
       UNION ALL
       SELECT cn.customer_id, 0, 1,
              -(cn.grand_total - COALESCE(cn.tax_total, 0)), -COALESCE(cn.tax_total, 0), -cn.grand_total,
              0, 0, 0
         FROM credit_notes cn
        WHERE ${ACTIVE_CREDIT_NOTE('cn')}
     )
     SELECT d.customer_id, c.name AS customer_name, c.phone, c.gstin,
            SUM(d.is_inv) AS invoice_count, SUM(d.is_cn) AS credit_note_count,
            COALESCE(SUM(d.sales) FILTER (WHERE d.is_inv = 1), 0) AS invoice_sales,
            COALESCE(SUM(d.with_tax) FILTER (WHERE d.is_inv = 1), 0) AS invoice_sales_with_tax,
            COALESCE(-SUM(d.sales) FILTER (WHERE d.is_cn = 1), 0) AS credit_note_sales,
            COALESCE(-SUM(d.with_tax) FILTER (WHERE d.is_cn = 1), 0) AS credit_note_sales_with_tax,
            SUM(d.sales) AS sales, SUM(d.tax) AS tax, SUM(d.with_tax) AS sales_with_tax,
            SUM(d.discount) AS discount, SUM(d.collected) AS collected, SUM(d.balance) AS balance_due
       FROM docs d
       LEFT JOIN customers c ON c.id = d.customer_id
      GROUP BY d.customer_id, c.name, c.phone, c.gstin
      ORDER BY SUM(d.sales) DESC, c.name`,
    params(ctx)
  );

  const customers: SalesByCustomerRow[] = rows.map((r) => ({
    customer_id: r.customer_id,
    customer_name: r.customer_name || 'Walk-in / Cash Sale',
    phone: r.phone,
    gstin: r.gstin,
    invoice_count: num(r.invoice_count),
    credit_note_count: num(r.credit_note_count),
    invoice_sales: r2(num(r.invoice_sales)),
    invoice_sales_with_tax: r2(num(r.invoice_sales_with_tax)),
    credit_note_sales: r2(num(r.credit_note_sales)),
    credit_note_sales_with_tax: r2(num(r.credit_note_sales_with_tax)),
    sales: r2(num(r.sales)),
    tax: r2(num(r.tax)),
    sales_with_tax: r2(num(r.sales_with_tax)),
    discount: r2(num(r.discount)),
    collected: r2(num(r.collected)),
    balance_due: r2(num(r.balance_due)),
  }));

  const keys = [
    'invoice_count', 'credit_note_count', 'invoice_sales', 'invoice_sales_with_tax', 'credit_note_sales',
    'credit_note_sales_with_tax', 'sales', 'tax', 'sales_with_tax', 'discount', 'collected', 'balance_due',
  ] as const;
  const totals = Object.fromEntries(keys.map((k) => [k, r2(customers.reduce((s, c) => s + c[k], 0))])) as Record<
    (typeof keys)[number],
    number
  >;
  return { customers, totals };
}

// ---------------------------------------------------------------- by item

export interface SalesByItemRow {
  item_id: string | null;
  item_name: string;
  hsn_sac: string | null;
  unit: string | null;
  quantity_invoiced: number;
  quantity_returned: number;
  quantity_sold: number;
  amount: number;
  tax: number;
  amount_with_tax: number;
  discount: number;
  average_price: number;
  invoice_count: number;
}

export async function salesByItem(ctx: SalesReportContext) {
  // Catalogue lines group by item; free-text lines group by their name (case-insensitive).
  const rows = await queryRows<any>(
    `WITH lines AS (
       SELECT COALESCE(ii.item_id::text, 'name:' || LOWER(TRIM(ii.item_name))) AS k,
              ii.item_id, ii.item_name AS line_name, ii.hsn_sac, ii.unit, i.id AS invoice_id,
              COALESCE(ii.quantity, 0) AS qty_in, 0::numeric AS qty_out,
              COALESCE(ii.taxable_value, 0) AS amount, COALESCE(ii.tax_amount, 0) AS tax,
              COALESCE(ii.discount_amount, 0) AS discount
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
        WHERE ${POSTED_INVOICE('i')}
       UNION ALL
       SELECT COALESCE(cni.item_id::text, 'name:' || LOWER(TRIM(cni.description))),
              cni.item_id, cni.description, cni.hsn_sac, cni.unit, NULL,
              0, COALESCE(cni.qty, 0),
              -(COALESCE(cni.line_total, 0) - COALESCE(cni.tax_amount, 0)), -COALESCE(cni.tax_amount, 0),
              0
         FROM credit_note_items cni
         JOIN credit_notes cn ON cn.id = cni.credit_note_id
        WHERE ${ACTIVE_CREDIT_NOTE('cn')}
     )
     SELECT l.k, MAX(l.item_id::text) AS item_id,
            COALESCE(MAX(it.name), MAX(l.line_name)) AS item_name,
            COALESCE(MAX(it.hsn_sac), MAX(l.hsn_sac)) AS hsn_sac,
            COALESCE(MAX(it.unit), MAX(l.unit)) AS unit,
            SUM(l.qty_in) AS qty_in, SUM(l.qty_out) AS qty_out,
            SUM(l.amount) AS amount, SUM(l.tax) AS tax, SUM(l.discount) AS discount,
            COUNT(DISTINCT l.invoice_id) AS invoice_count
       FROM lines l
       LEFT JOIN items it ON it.id = l.item_id
      GROUP BY l.k
      ORDER BY SUM(l.amount) DESC, 3`,
    params(ctx)
  );

  const items: SalesByItemRow[] = rows.map((r) => {
    const qtyIn = num(r.qty_in);
    const qtyOut = num(r.qty_out);
    const qty = qtyIn - qtyOut;
    const amount = r2(num(r.amount));
    const tax = r2(num(r.tax));
    return {
      item_id: r.item_id,
      item_name: r.item_name,
      hsn_sac: r.hsn_sac,
      unit: r.unit,
      quantity_invoiced: qtyIn,
      quantity_returned: qtyOut,
      quantity_sold: qty,
      amount,
      tax,
      amount_with_tax: r2(amount + tax),
      discount: r2(num(r.discount)),
      average_price: qty !== 0 ? r2(amount / qty) : 0,
      invoice_count: num(r.invoice_count),
    };
  });

  const totals = {
    quantity_invoiced: items.reduce((s, i) => s + i.quantity_invoiced, 0),
    quantity_returned: items.reduce((s, i) => s + i.quantity_returned, 0),
    quantity_sold: items.reduce((s, i) => s + i.quantity_sold, 0),
    amount: r2(items.reduce((s, i) => s + i.amount, 0)),
    tax: r2(items.reduce((s, i) => s + i.tax, 0)),
    amount_with_tax: r2(items.reduce((s, i) => s + i.amount_with_tax, 0)),
    discount: r2(items.reduce((s, i) => s + i.discount, 0)),
  };
  return { items, totals };
}

// ---------------------------------------------------------------- summary

export type SalesPeriod = 'day' | 'week' | 'month';

export async function salesSummary(ctx: SalesReportContext, period: SalesPeriod) {
  const trunc = period === 'day' ? 'day' : period;
  const rows = await queryRows<any>(
    `WITH docs AS (
       SELECT i.invoice_date AS d, 1 AS is_inv, 0 AS is_cn,
              i.grand_total - COALESCE(i.tax_total, 0) AS sales, COALESCE(i.tax_total, 0) AS tax, i.grand_total AS with_tax,
              COALESCE(i.discount_total, 0) AS discount, COALESCE(i.paid_amount, 0) AS collected, COALESCE(i.balance_amount, 0) AS balance
         FROM invoices i
        WHERE ${POSTED_INVOICE('i')}
       UNION ALL
       SELECT cn.credit_note_date, 0, 1,
              -(cn.grand_total - COALESCE(cn.tax_total, 0)), -COALESCE(cn.tax_total, 0), -cn.grand_total, 0, 0, 0
         FROM credit_notes cn
        WHERE ${ACTIVE_CREDIT_NOTE('cn')}
     )
     SELECT to_char(date_trunc('${trunc}', d::timestamp), 'YYYY-MM-DD') AS period,
            SUM(is_inv) AS invoice_count, SUM(is_cn) AS credit_note_count,
            COALESCE(SUM(sales) FILTER (WHERE is_inv = 1), 0) AS invoice_sales,
            COALESCE(-SUM(sales) FILTER (WHERE is_cn = 1), 0) AS credit_note_sales,
            SUM(sales) AS sales, SUM(tax) AS tax, SUM(with_tax) AS sales_with_tax,
            SUM(discount) AS discount, SUM(collected) AS collected, SUM(balance) AS balance_due
       FROM docs
      GROUP BY 1
      ORDER BY 1 DESC`,
    params(ctx)
  );

  const summary = rows.map((r) => ({
    period: r.period as string,
    invoice_count: num(r.invoice_count),
    credit_note_count: num(r.credit_note_count),
    invoice_sales: r2(num(r.invoice_sales)),
    credit_note_sales: r2(num(r.credit_note_sales)),
    sales: r2(num(r.sales)),
    tax: r2(num(r.tax)),
    sales_with_tax: r2(num(r.sales_with_tax)),
    discount: r2(num(r.discount)),
    collected: r2(num(r.collected)),
    balance_due: r2(num(r.balance_due)),
  }));
  const keys = [
    'invoice_count', 'credit_note_count', 'invoice_sales', 'credit_note_sales', 'sales', 'tax',
    'sales_with_tax', 'discount', 'collected', 'balance_due',
  ] as const;
  const totals = Object.fromEntries(keys.map((k) => [k, r2(summary.reduce((s, x) => s + x[k], 0))])) as Record<
    (typeof keys)[number],
    number
  >;
  return { period, summary, totals };
}

// ---------------------------------------------------------------- invoice details

export const INVOICE_STATUSES = ['draft', 'final', 'cancelled'] as const;
export type InvoiceStatusFilter = (typeof INVOICE_STATUSES)[number] | 'all';

export type InvoiceChannelFilter = InvoiceChannel | 'all';

export function isInvoiceChannelFilter(v: string): v is InvoiceChannelFilter {
  return v === 'all' || (INVOICE_CHANNELS as readonly string[]).includes(v);
}

/** Every invoice in the period (drafts and cancelled included, like Zoho); totals cover posted invoices only. */
export async function invoiceDetails(
  ctx: SalesReportContext,
  status: InvoiceStatusFilter,
  channel: InvoiceChannelFilter = 'all',
) {
  const rows = await queryRows<any>(
    `SELECT i.id, i.invoice_number, to_char(i.invoice_date, 'YYYY-MM-DD') AS invoice_date,
            to_char(i.due_date, 'YYYY-MM-DD') AS due_date, i.status, i.payment_status, i.reference_number,
            i.customer_id, COALESCE(c.name, 'Walk-in / Cash Sale') AS customer_name, c.gstin AS customer_gstin,
            COALESCE(i.channel, 'manual') AS channel,
            i.subtotal, i.discount_total, i.additional_charges, i.tax_total, i.cgst_total, i.sgst_total, i.igst_total,
            i.grand_total, i.paid_amount, i.balance_amount, i.supply_type
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.business_id = $1 AND i.deleted_at IS NULL
        AND COALESCE(i.document_type, 'tax_invoice') <> 'proforma_invoice'
        AND ($2::date IS NULL OR i.invoice_date >= $2::date)
        AND ($3::date IS NULL OR i.invoice_date <= $3::date)
        AND ($4::uuid IS NULL OR i.branch_id = $4::uuid)
        AND ($5::text IS NULL OR i.status = $5::text)
        AND ($6::text IS NULL OR COALESCE(i.channel, 'manual') = $6::text)
      ORDER BY i.invoice_date DESC, i.invoice_number DESC`,
    [...params(ctx), status === 'all' ? null : status, channel === 'all' ? null : channel]
  );

  const invoices = rows.map((r) => ({
    ...r,
    subtotal: num(r.subtotal),
    discount_total: num(r.discount_total),
    additional_charges: num(r.additional_charges),
    tax_total: num(r.tax_total),
    cgst_total: num(r.cgst_total),
    sgst_total: num(r.sgst_total),
    igst_total: num(r.igst_total),
    grand_total: num(r.grand_total),
    paid_amount: num(r.paid_amount),
    balance_amount: num(r.balance_amount),
    sales: r2(num(r.grand_total) - num(r.tax_total)),
  }));

  const posted = invoices.filter((i) => i.status === 'final');
  const totals = {
    total_invoices: posted.length,
    draft_count: invoices.filter((i) => i.status === 'draft').length,
    cancelled_count: invoices.filter((i) => i.status === 'cancelled').length,
    total_sales: r2(posted.reduce((s, i) => s + i.sales, 0)),
    total_tax: r2(posted.reduce((s, i) => s + i.tax_total, 0)),
    total_sales_with_tax: r2(posted.reduce((s, i) => s + i.grand_total, 0)),
    total_discount: r2(posted.reduce((s, i) => s + i.discount_total, 0)),
    total_collected: r2(posted.reduce((s, i) => s + i.paid_amount, 0)),
    total_pending: r2(posted.reduce((s, i) => s + i.balance_amount, 0)),
  };
  const byChannel: Partial<Record<InvoiceChannel, { count: number; sales_with_tax: number }>> = {};
  for (const i of posted) {
    const key = i.channel as InvoiceChannel;
    const bucket = (byChannel[key] ??= { count: 0, sales_with_tax: 0 });
    bucket.count += 1;
    bucket.sales_with_tax = r2(bucket.sales_with_tax + i.grand_total);
  }
  return { invoices, totals, by_channel: byChannel, unbilled_orders: await unbilledOrders(ctx) };
}

/**
 * Store and WhatsApp orders placed in the period that have no bill yet (pending, unpaid or not
 * approved). They are not sales until invoiced, so they are counted here rather than in the totals.
 */
async function unbilledOrders(ctx: SalesReportContext): Promise<{ count: number; amount: number }> {
  const r = await queryOne<{ count: number; amount: string | null }>(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(h.amount), 0)::text AS amount
       FROM order_hub h
      WHERE h.business_id = $1
        AND h.channel IN ('online_store', 'whatsapp')
        AND h.invoice_id IS NULL
        AND COALESCE(h.delivery_status, '') NOT IN ('cancelled', 'returned')
        AND h.order_status NOT IN ('cancelled', 'rejected', 'draft')
        AND ($2::date IS NULL OR (h.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date)
        AND ($3::date IS NULL OR (h.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $3::date)
        AND ($4::uuid IS NULL OR h.branch_id IS NULL OR h.branch_id = $4::uuid)`,
    params(ctx),
  ).catch(() => null);
  return { count: r?.count ?? 0, amount: r2(num(r?.amount)) };
}
