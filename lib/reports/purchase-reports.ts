import { queryRows } from '@/lib/db';
import { type ReportContext, reportParams as params, r2, num, sumKeys } from '@/lib/reports/report-context';

/**
 * Purchase reports (by vendor, by item, summary, bill details, returns, credit purchases, tax-wise).
 *
 * Purchases = posted bills (status 'final', not deleted) minus active purchase returns (debit notes),
 * both by document date. "Purchases" excludes GST and is the bill's taxable value (subtotal, which is
 * what the ledger debits to stock / purchase accounts); "with tax" is the document total. This matches
 * Zoho's Purchases by Vendor / Item and reconciles to the P&L.
 */

const POSTED_BILL = (a: string) => `
  ${a}.business_id = $1 AND ${a}.deleted_at IS NULL AND ${a}.status = 'final'
  AND ($2::date IS NULL OR ${a}.bill_date >= $2::date)
  AND ($3::date IS NULL OR ${a}.bill_date <= $3::date)
  AND ($4::uuid IS NULL OR ${a}.branch_id = $4::uuid)`;

const ACTIVE_RETURN = (a: string) => `
  ${a}.business_id = $1 AND COALESCE(${a}.status, 'final') <> 'cancelled'
  AND ($2::date IS NULL OR ${a}.return_date >= $2::date)
  AND ($3::date IS NULL OR ${a}.return_date <= $3::date)
  AND ($4::uuid IS NULL OR ${a}.branch_id = $4::uuid)`;

const BILL_TAX = (a: string) => `(COALESCE(${a}.tax_total, 0) + COALESCE(${a}.cess_total, 0))`;

// ---------------------------------------------------------------- by vendor

export interface PurchasesByVendorRow {
  supplier_id: string | null;
  supplier_name: string;
  phone: string | null;
  gstin: string | null;
  bill_count: number;
  return_count: number;
  bill_purchases: number;
  bill_purchases_with_tax: number;
  return_purchases: number;
  return_purchases_with_tax: number;
  purchases: number;
  tax: number;
  purchases_with_tax: number;
  paid: number;
  balance_due: number;
}

const VENDOR_KEYS = [
  'bill_count', 'return_count', 'bill_purchases', 'bill_purchases_with_tax', 'return_purchases',
  'return_purchases_with_tax', 'purchases', 'tax', 'purchases_with_tax', 'paid', 'balance_due',
] as const;

export async function purchasesByVendor(ctx: ReportContext) {
  const rows = await queryRows<any>(
    `WITH docs AS (
       SELECT p.supplier_id, 1 AS is_bill, 0 AS is_ret,
              COALESCE(p.subtotal, 0) AS amount, ${BILL_TAX('p')} AS tax, p.grand_total AS with_tax,
              COALESCE(p.paid_amount, 0) AS paid, COALESCE(p.balance_amount, 0) AS balance
         FROM purchases p
        WHERE ${POSTED_BILL('p')}
       UNION ALL
       SELECT pr.supplier_id, 0, 1,
              -COALESCE(pr.subtotal, 0), -COALESCE(pr.tax_total, 0), -pr.grand_total, 0, 0
         FROM purchase_returns pr
        WHERE ${ACTIVE_RETURN('pr')}
     )
     SELECT d.supplier_id, s.name AS supplier_name, s.phone, s.gstin,
            SUM(d.is_bill) AS bill_count, SUM(d.is_ret) AS return_count,
            COALESCE(SUM(d.amount) FILTER (WHERE d.is_bill = 1), 0) AS bill_purchases,
            COALESCE(SUM(d.with_tax) FILTER (WHERE d.is_bill = 1), 0) AS bill_purchases_with_tax,
            COALESCE(-SUM(d.amount) FILTER (WHERE d.is_ret = 1), 0) AS return_purchases,
            COALESCE(-SUM(d.with_tax) FILTER (WHERE d.is_ret = 1), 0) AS return_purchases_with_tax,
            SUM(d.amount) AS purchases, SUM(d.tax) AS tax, SUM(d.with_tax) AS purchases_with_tax,
            SUM(d.paid) AS paid, SUM(d.balance) AS balance_due
       FROM docs d
       LEFT JOIN suppliers s ON s.id = d.supplier_id
      GROUP BY d.supplier_id, s.name, s.phone, s.gstin
      ORDER BY SUM(d.amount) DESC, s.name`,
    params(ctx)
  );

  const suppliers: PurchasesByVendorRow[] = rows.map((r) => ({
    supplier_id: r.supplier_id,
    supplier_name: r.supplier_name || 'Cash Purchase (no supplier)',
    phone: r.phone,
    gstin: r.gstin,
    ...(Object.fromEntries(VENDOR_KEYS.map((k) => [k, r2(num(r[k]))])) as Record<(typeof VENDOR_KEYS)[number], number>),
  }));
  return { suppliers, totals: sumKeys(suppliers, VENDOR_KEYS) };
}

// ---------------------------------------------------------------- by item

export interface PurchasesByItemRow {
  item_id: string | null;
  item_name: string;
  hsn_sac: string | null;
  unit: string | null;
  quantity_purchased: number;
  quantity_returned: number;
  quantity: number;
  amount: number;
  tax: number;
  amount_with_tax: number;
  discount: number;
  average_cost: number;
  bill_count: number;
}

export async function purchasesByItem(ctx: ReportContext) {
  // Catalogue lines group by item; free-text lines group by their name (case-insensitive).
  const rows = await queryRows<any>(
    `WITH lines AS (
       SELECT COALESCE(pi.item_id::text, 'name:' || LOWER(TRIM(pi.item_name))) AS k,
              pi.item_id, pi.item_name AS line_name, pi.hsn_sac, pi.unit, p.id AS bill_id,
              COALESCE(pi.quantity, 0) AS qty_in, 0::numeric AS qty_out,
              COALESCE(pi.taxable_value, 0) AS amount,
              COALESCE(pi.tax_amount, 0) + COALESCE(pi.cess_amount, 0) AS tax,
              COALESCE(pi.discount_amount, 0) AS discount
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
        WHERE ${POSTED_BILL('p')}
       UNION ALL
       SELECT COALESCE(pri.item_id::text, 'name:' || LOWER(TRIM(pri.description))),
              pri.item_id, pri.description, pri.hsn_sac, pri.unit, NULL,
              0, COALESCE(pri.qty, 0),
              -COALESCE(pri.taxable_value, 0), -COALESCE(pri.tax_amount, 0),
              0
         FROM purchase_return_items pri
         JOIN purchase_returns pr ON pr.id = pri.return_id
        WHERE ${ACTIVE_RETURN('pr')}
     )
     SELECT l.k, MAX(l.item_id::text) AS item_id,
            COALESCE(MAX(it.name), MAX(l.line_name)) AS item_name,
            COALESCE(MAX(it.hsn_sac), MAX(l.hsn_sac)) AS hsn_sac,
            COALESCE(MAX(it.unit), MAX(l.unit)) AS unit,
            SUM(l.qty_in) AS qty_in, SUM(l.qty_out) AS qty_out,
            SUM(l.amount) AS amount, SUM(l.tax) AS tax, SUM(l.discount) AS discount,
            COUNT(DISTINCT l.bill_id) AS bill_count
       FROM lines l
       LEFT JOIN items it ON it.id = l.item_id
      GROUP BY l.k
      ORDER BY SUM(l.amount) DESC, 3`,
    params(ctx)
  );

  const items: PurchasesByItemRow[] = rows.map((r) => {
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
      quantity_purchased: qtyIn,
      quantity_returned: qtyOut,
      quantity: qty,
      amount,
      tax,
      amount_with_tax: r2(amount + tax),
      discount: r2(num(r.discount)),
      average_cost: qty !== 0 ? r2(amount / qty) : 0,
      bill_count: num(r.bill_count),
    };
  });

  return {
    items,
    totals: sumKeys(items, ['quantity_purchased', 'quantity_returned', 'quantity', 'amount', 'tax', 'amount_with_tax', 'discount'] as const),
  };
}

// ---------------------------------------------------------------- summary

export type PurchasePeriod = 'day' | 'week' | 'month';

const SUMMARY_KEYS = [
  'bill_count', 'return_count', 'bill_purchases', 'return_purchases', 'purchases', 'tax',
  'purchases_with_tax', 'paid', 'balance_due',
] as const;

export async function purchaseSummary(ctx: ReportContext, period: PurchasePeriod) {
  const rows = await queryRows<any>(
    `WITH docs AS (
       SELECT p.bill_date AS d, 1 AS is_bill, 0 AS is_ret,
              COALESCE(p.subtotal, 0) AS amount, ${BILL_TAX('p')} AS tax, p.grand_total AS with_tax,
              COALESCE(p.paid_amount, 0) AS paid, COALESCE(p.balance_amount, 0) AS balance
         FROM purchases p
        WHERE ${POSTED_BILL('p')}
       UNION ALL
       SELECT pr.return_date, 0, 1,
              -COALESCE(pr.subtotal, 0), -COALESCE(pr.tax_total, 0), -pr.grand_total, 0, 0
         FROM purchase_returns pr
        WHERE ${ACTIVE_RETURN('pr')}
     )
     SELECT to_char(date_trunc('${period}', d::timestamp), 'YYYY-MM-DD') AS period,
            SUM(is_bill) AS bill_count, SUM(is_ret) AS return_count,
            COALESCE(SUM(amount) FILTER (WHERE is_bill = 1), 0) AS bill_purchases,
            COALESCE(-SUM(amount) FILTER (WHERE is_ret = 1), 0) AS return_purchases,
            SUM(amount) AS purchases, SUM(tax) AS tax, SUM(with_tax) AS purchases_with_tax,
            SUM(paid) AS paid, SUM(balance) AS balance_due
       FROM docs
      GROUP BY 1
      ORDER BY 1 DESC`,
    params(ctx)
  );

  const summary = rows.map((r) => ({
    period: r.period as string,
    ...(Object.fromEntries(SUMMARY_KEYS.map((k) => [k, r2(num(r[k]))])) as Record<(typeof SUMMARY_KEYS)[number], number>),
  }));
  return { period, summary, totals: sumKeys(summary, SUMMARY_KEYS) };
}

// ---------------------------------------------------------------- bill details

export const BILL_STATUSES = ['draft', 'final', 'cancelled'] as const;
export type BillStatusFilter = (typeof BILL_STATUSES)[number] | 'all';

/** Every bill in the period (drafts and cancelled included, like Zoho); totals cover posted bills only. */
export async function billDetails(ctx: ReportContext, status: BillStatusFilter) {
  const rows = await queryRows<any>(
    `SELECT p.id, p.bill_number, p.invoice_number, to_char(p.bill_date, 'YYYY-MM-DD') AS bill_date,
            to_char(p.due_date, 'YYYY-MM-DD') AS due_date, p.status, p.payment_status,
            p.supplier_id, COALESCE(s.name, 'Cash Purchase (no supplier)') AS supplier_name, s.gstin AS supplier_gstin,
            p.subtotal, p.tax_total, COALESCE(p.cess_total, 0) AS cess_total, p.cgst_total, p.sgst_total, p.igst_total,
            p.grand_total, p.paid_amount, p.balance_amount, COALESCE(p.is_reverse_charge, false) AS is_reverse_charge
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.business_id = $1 AND p.deleted_at IS NULL
        AND ($2::date IS NULL OR p.bill_date >= $2::date)
        AND ($3::date IS NULL OR p.bill_date <= $3::date)
        AND ($4::uuid IS NULL OR p.branch_id = $4::uuid)
        AND ($5::text IS NULL OR p.status = $5::text)
      ORDER BY p.bill_date DESC, p.bill_number DESC`,
    [...params(ctx), status === 'all' ? null : status]
  );

  const bills = rows.map((r) => ({
    ...r,
    subtotal: num(r.subtotal),
    tax_total: r2(num(r.tax_total) + num(r.cess_total)),
    cess_total: num(r.cess_total),
    cgst_total: num(r.cgst_total),
    sgst_total: num(r.sgst_total),
    igst_total: num(r.igst_total),
    grand_total: num(r.grand_total),
    paid_amount: num(r.paid_amount),
    balance_amount: num(r.balance_amount),
  }));

  const posted = bills.filter((b) => b.status === 'final');
  const totals = {
    total_bills: posted.length,
    draft_count: bills.filter((b) => b.status === 'draft').length,
    cancelled_count: bills.filter((b) => b.status === 'cancelled').length,
    total_purchases: r2(posted.reduce((s, b) => s + b.subtotal, 0)),
    total_tax: r2(posted.reduce((s, b) => s + b.tax_total, 0)),
    total_purchases_with_tax: r2(posted.reduce((s, b) => s + b.grand_total, 0)),
    total_paid: r2(posted.reduce((s, b) => s + b.paid_amount, 0)),
    total_pending: r2(posted.reduce((s, b) => s + b.balance_amount, 0)),
  };
  return { bills, totals };
}

// ---------------------------------------------------------------- returns (debit notes)

export async function purchaseReturns(ctx: ReportContext) {
  const rows = await queryRows<any>(
    `SELECT pr.id, pr.return_number, to_char(pr.return_date, 'YYYY-MM-DD') AS return_date,
            COALESCE(p.bill_number, 'N/A') AS purchase_bill_number,
            COALESCE(s.name, 'Unknown Supplier') AS supplier_name,
            pr.subtotal, pr.tax_total, pr.grand_total, pr.refund_amount, pr.refund_status, pr.reason
       FROM purchase_returns pr
       LEFT JOIN purchases p ON p.id = pr.purchase_id AND p.deleted_at IS NULL
       LEFT JOIN suppliers s ON s.id = pr.supplier_id
      WHERE ${ACTIVE_RETURN('pr')}
      ORDER BY pr.return_date DESC, pr.return_number DESC`,
    params(ctx)
  );
  const returns = rows.map((r) => ({
    ...r,
    subtotal: num(r.subtotal),
    tax_total: num(r.tax_total),
    grand_total: num(r.grand_total),
    refund_amount: num(r.refund_amount),
  }));
  const totals = {
    total_returns: returns.length,
    total_purchases: r2(returns.reduce((s, r) => s + r.subtotal, 0)),
    total_tax: r2(returns.reduce((s, r) => s + r.tax_total, 0)),
    total_amount: r2(returns.reduce((s, r) => s + r.grand_total, 0)),
    total_refunded: r2(returns.reduce((s, r) => s + r.refund_amount, 0)),
    pending_count: returns.filter((r) => r.refund_status === 'pending').length,
  };
  return { returns, totals };
}

// ---------------------------------------------------------------- credit purchases (unpaid bills)

/** Posted bills in the period that still owe the supplier; overdue = past due date (bill date if none). */
export async function creditPurchases(ctx: ReportContext) {
  const rows = await queryRows<any>(
    `SELECT p.id, p.bill_number, to_char(p.bill_date, 'YYYY-MM-DD') AS bill_date,
            to_char(COALESCE(p.due_date, p.bill_date), 'YYYY-MM-DD') AS due_date,
            COALESCE(s.name, 'Cash Purchase (no supplier)') AS supplier_name,
            p.grand_total, p.paid_amount, p.balance_amount,
            GREATEST(CURRENT_DATE - COALESCE(p.due_date, p.bill_date), 0) AS days_overdue
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE ${POSTED_BILL('p')} AND COALESCE(p.balance_amount, 0) > 0.005
      ORDER BY p.bill_date DESC, p.bill_number DESC`,
    params(ctx)
  );
  const creditPurchases = rows.map((r) => {
    const days = num(r.days_overdue);
    return {
      ...r,
      grand_total: num(r.grand_total),
      paid_amount: num(r.paid_amount),
      balance_amount: num(r.balance_amount),
      days_overdue: days,
      status_category: days > 0 ? 'overdue' : num(r.paid_amount) > 0 ? 'partially_paid' : 'pending',
    };
  });
  const totals = {
    total_purchases: creditPurchases.length,
    total_amount: r2(creditPurchases.reduce((s, p) => s + p.grand_total, 0)),
    total_outstanding: r2(creditPurchases.reduce((s, p) => s + p.balance_amount, 0)),
    total_overdue: r2(creditPurchases.filter((p) => p.days_overdue > 0).reduce((s, p) => s + p.balance_amount, 0)),
  };
  return { creditPurchases, totals };
}

// ---------------------------------------------------------------- tax-wise (net of returns)

const TAX_KEYS = ['total_quantity', 'total_taxable_value', 'total_cgst', 'total_sgst', 'total_igst', 'total_cess', 'total_tax'] as const;

export async function purchaseTaxWise(ctx: ReportContext) {
  const rows = await queryRows<any>(
    `WITH lines AS (
       SELECT COALESCE(pi.tax_rate, 0) AS tax_rate, COALESCE(NULLIF(TRIM(pi.hsn_sac), ''), 'N/A') AS hsn_sac,
              COALESCE(pi.quantity, 0) AS qty, COALESCE(pi.taxable_value, 0) AS taxable,
              COALESCE(pi.cgst_amount, 0) AS cgst, COALESCE(pi.sgst_amount, 0) AS sgst, COALESCE(pi.igst_amount, 0) AS igst,
              COALESCE(pi.cess_amount, 0) AS cess, COALESCE(pi.tax_amount, 0) + COALESCE(pi.cess_amount, 0) AS tax
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
        WHERE ${POSTED_BILL('p')}
       UNION ALL
       SELECT COALESCE(pri.tax_rate, 0), COALESCE(NULLIF(TRIM(pri.hsn_sac), ''), 'N/A'),
              -COALESCE(pri.qty, 0), -COALESCE(pri.taxable_value, 0),
              -COALESCE(pri.cgst_amount, 0), -COALESCE(pri.sgst_amount, 0), -COALESCE(pri.igst_amount, 0),
              0, -COALESCE(pri.tax_amount, 0)
         FROM purchase_return_items pri
         JOIN purchase_returns pr ON pr.id = pri.return_id
        WHERE ${ACTIVE_RETURN('pr')}
     )
     SELECT tax_rate, hsn_sac, SUM(qty) AS total_quantity, SUM(taxable) AS total_taxable_value,
            SUM(cgst) AS total_cgst, SUM(sgst) AS total_sgst, SUM(igst) AS total_igst,
            SUM(cess) AS total_cess, SUM(tax) AS total_tax
       FROM lines
      GROUP BY tax_rate, hsn_sac
      ORDER BY tax_rate DESC, hsn_sac`,
    params(ctx)
  );
  const taxWise = rows.map((r) => ({
    tax_rate: num(r.tax_rate),
    hsn_sac: r.hsn_sac as string,
    ...(Object.fromEntries(TAX_KEYS.map((k) => [k, r2(num(r[k]))])) as Record<(typeof TAX_KEYS)[number], number>),
  }));
  return { taxWise, totals: sumKeys(taxWise, TAX_KEYS) };
}
