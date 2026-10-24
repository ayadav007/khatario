import { z } from 'zod';
import { queryOne, queryRows } from '@/lib/db';
import { listActiveComplianceAlerts } from '@/lib/gst/compliance/engine';
import { buildAgeing } from '@/lib/reports/ageing';
import { fetchPartyLedgerDocs } from '@/lib/reports/party-ledger-docs';
import { purchaseSummary } from '@/lib/reports/purchase-reports';
import type { ReportContext } from '@/lib/reports/report-context';
import { salesByCustomer, salesByItem, salesSummary } from '@/lib/reports/sales-reports';
import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import { change, count, inr, shorten, type InsightCard } from './format';
import { addDays, formatDay, PERIODS, resolvePeriod, type ResolvedPeriod } from './period';

/** Who is asking. The business always comes from the session or the verified WhatsApp link, never from the model. */
export interface InsightContext {
  businessId: string;
  userId: string;
  /** Today in Indian time (YYYY-MM-DD). */
  today: string;
}

export type InsightFeature = 'reports_basic' | 'reports_advanced' | 'reports_gst';

export interface InsightToolResult {
  cards: InsightCard[];
  data: unknown;
}

export interface InsightTool<A = any> {
  name: string;
  description: string;
  schema: z.ZodType<A, z.ZodTypeDef, unknown>;
  /** JSON schema of the arguments, sent to the model for tool selection. */
  parameters: Record<string, unknown>;
  feature: InsightFeature;
  run(ctx: InsightContext, args: A): Promise<InsightToolResult>;
}

const PLAN_NAMES: Record<InsightFeature, string> = {
  reports_basic: 'reports',
  reports_advanced: 'advanced reports (ageing)',
  reports_gst: 'GST reports',
};

const periodOr = (fallback: (typeof PERIODS)[number]) => z.enum(PERIODS).catch(fallback);
const periodArg = periodOr('today');
const limitArg = z.coerce.number().int().min(1).max(10).catch(5);
const periodParam = { type: 'string', enum: [...PERIODS], description: 'Time window, in Indian time. Default today.' };
const limitParam = { type: 'integer', minimum: 1, maximum: 10, description: 'How many rows. Default 5.' };

const num = (v: unknown) => Number(v) || 0;

function reportCtx(ctx: InsightContext, from: string, to: string): ReportContext {
  return { businessId: ctx.businessId, userId: ctx.userId, fromDate: from, toDate: to, branchId: null };
}

async function salesTotals(ctx: InsightContext, from: string, to: string) {
  const { totals } = await salesSummary(reportCtx(ctx, from, to), 'day');
  return totals;
}

// ------------------------------------------------------------------ tools

const salesSummaryTool: InsightTool<{ period: (typeof PERIODS)[number] }> = {
  name: 'sales_summary',
  description: 'Sales for a period: number of bills, sales before and after GST, credit notes, and change vs the earlier period.',
  schema: z.object({ period: periodArg }),
  parameters: { type: 'object', properties: { period: periodParam } },
  feature: 'reports_basic',
  async run(ctx, { period }) {
    const p = resolvePeriod(period, ctx.today);
    const [cur, prev] = await Promise.all([salesTotals(ctx, p.from, p.to), salesTotals(ctx, p.prevFrom, p.prevTo)]);
    const trend = change(cur.sales, prev.sales, p.prevLabel);
    const card: InsightCard = {
      title: `Sales: ${p.label}`,
      rows: [
        { label: 'Sales (before GST)', value: inr(cur.sales), hint: trend ?? undefined },
        { label: 'Sales with GST', value: inr(cur.sales_with_tax) },
        { label: 'Bills', value: count(cur.invoice_count, 'bill') },
        ...(cur.credit_note_count
          ? [{ label: 'Returns (credit notes)', value: `${inr(cur.credit_note_sales)} on ${count(cur.credit_note_count, 'note')}` }]
          : []),
        { label: 'Still to collect on these bills', value: inr(cur.balance_due) },
      ],
      link: { label: 'Sales summary', url: '/reports/sales/summary' },
    };
    return { cards: [card], data: { period: p, current: cur, previous: prev } };
  },
};

const paymentsReceivedTool: InsightTool<{ period: (typeof PERIODS)[number] }> = {
  name: 'payments_received',
  description: 'Money received from customers in a period, split by payment mode (cash, UPI, bank, cheque).',
  schema: z.object({ period: periodArg }),
  parameters: { type: 'object', properties: { period: periodParam } },
  feature: 'reports_basic',
  async run(ctx, { period }) {
    const p = resolvePeriod(period, ctx.today);
    const rows = await queryRows<{ mode: string | null; n: string; total: string }>(
      `SELECT COALESCE(NULLIF(TRIM(payment_mode), ''), 'other') AS mode, COUNT(*) AS n, SUM(ABS(amount)) AS total
         FROM payments
        WHERE business_id = $1 AND deleted_at IS NULL AND status = 'active' AND type = 'receivable'
          AND payment_date BETWEEN $2::date AND $3::date
        GROUP BY 1 ORDER BY 3 DESC`,
      [ctx.businessId, p.from, p.to],
    );
    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const receipts = rows.reduce((s, r) => s + num(r.n), 0);
    const card: InsightCard = {
      title: `Money received: ${p.label}`,
      subtitle: receipts ? `${inr(total)} from ${count(receipts, 'payment')}` : undefined,
      rows: rows.map((r) => ({ label: modeLabel(r.mode), value: inr(num(r.total)), hint: count(num(r.n), 'payment') })),
      empty: 'No payments recorded in this period.',
      link: { label: 'Sales by payment mode', url: '/reports/sales/payment-mode' },
    };
    return { cards: [card], data: { period: p, total, rows } };
  },
};

function modeLabel(mode: string | null): string {
  const m = (mode || 'other').toLowerCase();
  if (m === 'upi') return 'UPI';
  if (m === 'neft' || m === 'rtgs' || m === 'imps') return m.toUpperCase();
  return m.charAt(0).toUpperCase() + m.slice(1).replace(/_/g, ' ');
}

const purchasesExpensesTool: InsightTool<{ period: (typeof PERIODS)[number] }> = {
  name: 'purchases_expenses',
  description: 'Purchases (bills from suppliers, less returns) and expenses recorded in a period.',
  schema: z.object({ period: periodArg }),
  parameters: { type: 'object', properties: { period: periodParam } },
  feature: 'reports_basic',
  async run(ctx, { period }) {
    const p = resolvePeriod(period, ctx.today);
    const [{ totals }, expense] = await Promise.all([
      purchaseSummary(reportCtx(ctx, p.from, p.to), 'day'),
      queryOne<{ n: string; total: string }>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
           FROM expenses
          WHERE business_id = $1 AND deleted_at IS NULL AND expense_date BETWEEN $2::date AND $3::date`,
        [ctx.businessId, p.from, p.to],
      ),
    ]);
    const card: InsightCard = {
      title: `Purchases and expenses: ${p.label}`,
      rows: [
        { label: 'Purchases (before GST)', value: inr(totals.purchases), hint: count(totals.bill_count, 'bill') },
        { label: 'Purchases with GST', value: inr(totals.purchases_with_tax) },
        { label: 'Expenses', value: inr(num(expense?.total)), hint: count(num(expense?.n), 'entry', 'entries') },
      ],
      link: { label: 'Purchase summary', url: '/reports/purchase/summary' },
    };
    return { cards: [card], data: { period: p, purchases: totals, expenses: expense } };
  },
};

async function receivableAgeing(ctx: InsightContext) {
  const docs = await fetchPartyLedgerDocs({ businessId: ctx.businessId, partyType: 'customer', asOfDate: ctx.today });
  return buildAgeing(docs, ctx.today);
}

const topDebtorsTool: InsightTool<{ limit: number }> = {
  name: 'top_debtors',
  description: 'Customers who owe the most money (highest pending / outstanding / udhaar), with how much is overdue.',
  schema: z.object({ limit: limitArg }),
  parameters: { type: 'object', properties: { limit: limitParam } },
  feature: 'reports_advanced',
  async run(ctx, { limit }) {
    const { summary, totals } = await receivableAgeing(ctx);
    const owing = summary.filter((s) => s.total > 0.5).sort((a, b) => b.total - a.total);
    const overdueOf = (s: { age_0_30: number; age_30_60: number; age_60_90: number; age_90_plus: number }) =>
      s.age_0_30 + s.age_30_60 + s.age_60_90 + s.age_90_plus;
    const totalOverdue = overdueOf(totals);
    const card: InsightCard = {
      title: 'Who owes you the most',
      subtitle: owing.length
        ? `${inr(totals.total)} to collect from ${count(owing.length, 'customer')}; ${inr(totalOverdue)} is overdue`
        : undefined,
      rows: owing.slice(0, limit).map((s) => {
        const overdue = overdueOf(s);
        return {
          label: shorten(s.party_name),
          value: inr(s.total),
          hint: overdue > 0.5 ? `${inr(overdue)} overdue` : 'not due yet',
        };
      }),
      empty: 'No customer owes you money right now.',
      link: { label: 'Receivables ageing', url: '/reports/aging/receivables' },
    };
    return { cards: [card], data: { totals, top: owing.slice(0, limit).map(({ transactions, ...rest }) => rest) } };
  },
};

const overdueInvoicesTool: InsightTool<{ limit: number }> = {
  name: 'overdue_invoices',
  description: 'Unpaid invoices whose due date has passed, oldest first.',
  schema: z.object({ limit: limitArg }),
  parameters: { type: 'object', properties: { limit: limitParam } },
  feature: 'reports_basic',
  async run(ctx, { limit }) {
    const rows = await queryRows<{ invoice_number: string; due: string; balance: string; name: string | null; total_count: string; total_amount: string }>(
      `SELECT i.invoice_number, to_char(COALESCE(i.due_date, i.invoice_date), 'YYYY-MM-DD') AS due, i.balance_amount AS balance,
              c.name, COUNT(*) OVER () AS total_count, SUM(i.balance_amount) OVER () AS total_amount
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.business_id = $1 AND i.deleted_at IS NULL AND i.status = 'final'
          AND COALESCE(i.document_type, 'tax_invoice') <> 'proforma_invoice'
          AND i.balance_amount > 0 AND COALESCE(i.due_date, i.invoice_date) < $2::date
        ORDER BY COALESCE(i.due_date, i.invoice_date), i.invoice_number
        LIMIT $3`,
      [ctx.businessId, ctx.today, limit],
    );
    const totalCount = num(rows[0]?.total_count);
    const card: InsightCard = {
      title: 'Overdue invoices',
      subtitle: totalCount ? `${count(totalCount, 'invoice')}, ${inr(num(rows[0]?.total_amount))} overdue` : undefined,
      rows: rows.map((r) => ({
        label: `${r.invoice_number} · ${shorten(r.name || 'Walk-in', 20)}`,
        value: inr(num(r.balance)),
        hint: `due ${formatDay(r.due)}`,
      })),
      empty: 'No overdue invoices. Well done!',
      link: { label: 'Receivables ageing', url: '/reports/aging/receivables' },
    };
    return { cards: [card], data: { totalCount, rows } };
  },
};

const topCustomersTool: InsightTool<{ period: (typeof PERIODS)[number]; limit: number }> = {
  name: 'top_customers',
  description: 'Customers who bought the most in a period (by sales before GST, net of returns).',
  schema: z.object({ period: periodOr('this_month'), limit: limitArg }),
  parameters: { type: 'object', properties: { period: { ...periodParam, description: 'Time window. Default this_month.' }, limit: limitParam } },
  feature: 'reports_basic',
  async run(ctx, { period, limit }) {
    const p = resolvePeriod(period, ctx.today);
    const { customers } = await salesByCustomer(reportCtx(ctx, p.from, p.to));
    const top = customers.filter((c) => c.sales > 0).slice(0, limit);
    const card: InsightCard = {
      title: `Top customers: ${p.label}`,
      rows: top.map((c) => ({ label: shorten(c.customer_name), value: inr(c.sales), hint: count(c.invoice_count, 'bill') })),
      empty: 'No sales in this period.',
      link: { label: 'Party-wise sales', url: '/reports/sales/party-wise' },
    };
    return { cards: [card], data: { period: p, top } };
  },
};

const topProductsTool: InsightTool<{ period: (typeof PERIODS)[number]; limit: number }> = {
  name: 'top_products',
  description: 'Best-selling items or products in a period (by sales value before GST, net of returns).',
  schema: z.object({ period: periodOr('this_month'), limit: limitArg }),
  parameters: { type: 'object', properties: { period: { ...periodParam, description: 'Time window. Default this_month.' }, limit: limitParam } },
  feature: 'reports_basic',
  async run(ctx, { period, limit }) {
    const p = resolvePeriod(period, ctx.today);
    const { items } = await salesByItem(reportCtx(ctx, p.from, p.to));
    const top = items.filter((i) => i.amount > 0).slice(0, limit);
    const card: InsightCard = {
      title: `Best-selling items: ${p.label}`,
      rows: top.map((i) => ({
        label: shorten(i.item_name || 'Item'),
        value: inr(i.amount),
        hint: `${i.quantity_sold.toLocaleString('en-IN')}${i.unit ? ` ${i.unit}` : ''} sold`,
      })),
      empty: 'No sales in this period.',
      link: { label: 'Item-wise sales', url: '/reports/sales/item-wise' },
    };
    return { cards: [card], data: { period: p, top } };
  },
};

const payablesDueTool: InsightTool<{ within_days: number }> = {
  name: 'payables_due',
  description: 'Supplier bills you still have to pay that are overdue or due within the next N days.',
  schema: z.object({ within_days: z.coerce.number().int().min(0).max(90).catch(7) }),
  parameters: { type: 'object', properties: { within_days: { type: 'integer', minimum: 0, maximum: 90, description: 'Days ahead. Default 7.' } } },
  feature: 'reports_basic',
  async run(ctx, { within_days }) {
    const until = addDays(ctx.today, within_days);
    const rows = await queryRows<{ bill_number: string | null; due: string; balance: string; name: string | null; total_count: string; total_amount: string }>(
      `SELECT p.bill_number, to_char(COALESCE(p.due_date, p.bill_date), 'YYYY-MM-DD') AS due, p.balance_amount AS balance,
              s.name, COUNT(*) OVER () AS total_count, SUM(p.balance_amount) OVER () AS total_amount
         FROM purchases p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.business_id = $1 AND p.deleted_at IS NULL AND p.status = 'final'
          AND p.balance_amount > 0 AND COALESCE(p.due_date, p.bill_date) <= $2::date
        ORDER BY COALESCE(p.due_date, p.bill_date)
        LIMIT 10`,
      [ctx.businessId, until],
    );
    const totalCount = num(rows[0]?.total_count);
    const card: InsightCard = {
      title: within_days ? `Supplier bills due by ${formatDay(until)}` : 'Supplier bills overdue',
      subtitle: totalCount ? `${count(totalCount, 'bill')}, ${inr(num(rows[0]?.total_amount))} to pay` : undefined,
      rows: rows.map((r) => ({
        label: shorten(r.name || 'Supplier', 22),
        value: inr(num(r.balance)),
        hint: `${r.due < ctx.today ? 'overdue since' : 'due'} ${formatDay(r.due)}`,
      })),
      empty: 'Nothing to pay in this window.',
      link: { label: 'Payables ageing', url: '/reports/aging/payables' },
    };
    return { cards: [card], data: { until, totalCount, rows } };
  },
};

const lowStockTool: InsightTool<{ limit: number }> = {
  name: 'low_stock',
  description: 'Items at or below their minimum stock level (need reordering).',
  schema: z.object({ limit: limitArg }),
  parameters: { type: 'object', properties: { limit: limitParam } },
  feature: 'reports_basic',
  async run(ctx, { limit }) {
    const rows = await queryRows<{ name: string; current_stock: string; min_stock: string; unit: string | null; total_count: string }>(
      `SELECT name, current_stock, min_stock, unit, COUNT(*) OVER () AS total_count
         FROM items
        WHERE business_id = $1 AND COALESCE(is_active, true) AND deleted_at IS NULL
          AND COALESCE(item_type, 'goods') = 'goods'
          AND COALESCE(min_stock, 0) > 0 AND COALESCE(current_stock, 0) <= min_stock
        ORDER BY COALESCE(current_stock, 0) - min_stock, name
        LIMIT $2`,
      [ctx.businessId, limit],
    );
    const totalCount = num(rows[0]?.total_count);
    const card: InsightCard = {
      title: 'Low stock',
      subtitle: totalCount ? `${count(totalCount, 'item')} at or below minimum stock` : undefined,
      rows: rows.map((r) => ({
        label: shorten(r.name),
        value: `${num(r.current_stock).toLocaleString('en-IN')}${r.unit ? ` ${r.unit}` : ''} left`,
        hint: `min ${num(r.min_stock).toLocaleString('en-IN')}`,
      })),
      empty: 'No item is below its minimum stock.',
      link: { label: 'Stock summary', url: '/reports/stock/summary' },
    };
    return { cards: [card], data: { totalCount, rows } };
  },
};

const gstAlertsTool: InsightTool<Record<string, never>> = {
  name: 'gst_alerts',
  description: 'Open GST compliance alerts: returns due or overdue, ITC time limits, e-way bills and similar.',
  schema: z.object({}).strip() as unknown as z.ZodType<Record<string, never>, z.ZodTypeDef, unknown>,
  parameters: { type: 'object', properties: {} },
  feature: 'reports_gst',
  async run(ctx) {
    const alerts = (await listActiveComplianceAlerts(ctx.businessId)).filter((a) => a.dismissed_stage !== a.stage);
    const card: InsightCard = {
      title: 'GST alerts',
      rows: alerts.slice(0, 6).map((a) => ({
        label: a.title,
        value: a.severity === 'critical' ? 'Urgent' : a.severity === 'warning' ? 'Soon' : 'Note',
        hint: a.due_date ? `due ${formatDay(a.due_date)}` : undefined,
      })),
      empty: 'No open GST alerts.',
      link: { label: 'GST alerts', url: '/reports/gst/compliance' },
    };
    return { cards: [card], data: { count: alerts.length } };
  },
};

const dailySummaryTool: InsightTool<{ day: 'today' | 'yesterday' }> = {
  name: 'daily_summary',
  description: "One-screen business summary for a day: sales, money received, purchases and expenses, dues, low stock and GST alerts. Use for 'how is business', 'summary', 'aaj ka hisaab'.",
  schema: z.object({ day: z.enum(['today', 'yesterday']).catch('today') }),
  parameters: { type: 'object', properties: { day: { type: 'string', enum: ['today', 'yesterday'] } } },
  feature: 'reports_basic',
  async run(ctx, { day }) {
    const p = resolvePeriod(day, ctx.today);
    const [canAdvanced, canGst] = await Promise.all([
      hasFeatureAccess(ctx.businessId, 'reports_advanced').catch(() => false),
      hasFeatureAccess(ctx.businessId, 'reports_gst').catch(() => false),
    ]);
    const [sales, prevSales, received, purchases, ageing, lowStock, gst] = await Promise.all([
      salesTotals(ctx, p.from, p.to),
      salesTotals(ctx, p.prevFrom, p.prevTo),
      queryOne<{ total: string }>(
        `SELECT COALESCE(SUM(ABS(amount)), 0) AS total FROM payments
          WHERE business_id = $1 AND deleted_at IS NULL AND status = 'active' AND type = 'receivable'
            AND payment_date = $2::date`,
        [ctx.businessId, p.from],
      ),
      purchasesExpensesTool.run(ctx, { period: day }),
      canAdvanced ? receivableAgeing(ctx) : Promise.resolve(null),
      queryOne<{ n: string }>(
        `SELECT COUNT(*) AS n FROM items
          WHERE business_id = $1 AND COALESCE(is_active, true) AND deleted_at IS NULL
            AND COALESCE(item_type, 'goods') = 'goods' AND COALESCE(min_stock, 0) > 0 AND COALESCE(current_stock, 0) <= min_stock`,
        [ctx.businessId],
      ),
      canGst ? listActiveComplianceAlerts(ctx.businessId).catch(() => []) : Promise.resolve(null),
    ]);
    const purchaseData = purchases.data as { purchases: { purchases_with_tax: number }; expenses: { total: string } | null };
    const rows = [
      { label: 'Sales', value: inr(sales.sales_with_tax), hint: `${count(sales.invoice_count, 'bill')}${change(sales.sales_with_tax, prevSales.sales_with_tax, p.prevLabel) ? `, ${change(sales.sales_with_tax, prevSales.sales_with_tax, p.prevLabel)}` : ''}` },
      { label: 'Money received', value: inr(num(received?.total)) },
      { label: 'Purchases', value: inr(purchaseData.purchases.purchases_with_tax) },
      { label: 'Expenses', value: inr(num(purchaseData.expenses?.total)) },
    ];
    if (ageing) {
      const t = ageing.totals;
      rows.push({ label: 'Customers owe you', value: inr(t.total), hint: `${inr(t.age_0_30 + t.age_30_60 + t.age_60_90 + t.age_90_plus)} overdue` });
    }
    const low = num(lowStock?.n);
    if (low) rows.push({ label: 'Low stock', value: count(low, 'item') });
    if (gst) {
      const open = gst.filter((a) => a.dismissed_stage !== a.stage);
      if (open.length) rows.push({ label: 'GST alerts', value: count(open.length, 'alert') });
    }
    const card: InsightCard = {
      title: `Business summary: ${p.label}`,
      subtitle: 'Sales and purchases include GST.',
      rows,
      link: { label: 'Dashboard', url: '/dashboard' },
    };
    return {
      cards: [card],
      data: { period: p, sales, received: num(received?.total), lowStock: low, overdueReceivable: ageing?.totals ?? null },
    };
  },
};

export const INSIGHT_TOOLS: InsightTool[] = [
  dailySummaryTool,
  salesSummaryTool,
  paymentsReceivedTool,
  purchasesExpensesTool,
  topDebtorsTool,
  overdueInvoicesTool,
  topCustomersTool,
  topProductsTool,
  payablesDueTool,
  lowStockTool,
  gstAlertsTool,
];

const BY_NAME = new Map(INSIGHT_TOOLS.map((t) => [t.name, t]));

export function getInsightTool(name: string): InsightTool | undefined {
  return BY_NAME.get(name);
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Validates the call, checks the plan, runs the tool. Never throws: failures become a card saying so. */
export async function runInsightTool(ctx: InsightContext, call: ToolCall): Promise<InsightToolResult & { ok: boolean }> {
  const tool = BY_NAME.get(call.name);
  if (!tool) return { ok: false, cards: [], data: null };
  if (!(await hasFeatureAccess(ctx.businessId, tool.feature).catch(() => false))) {
    return {
      ok: false,
      cards: [
        {
          title: 'Not on your plan',
          rows: [],
          empty: `This needs ${PLAN_NAMES[tool.feature]}, which is not included in your current plan.`,
          link: { label: 'See plans', url: '/settings/subscription' },
        },
      ],
      data: { denied: tool.feature },
    };
  }
  const parsed = tool.schema.safeParse(call.args ?? {});
  const args = parsed.success ? parsed.data : tool.schema.parse({});
  try {
    return { ok: true, ...(await tool.run(ctx, args)) };
  } catch (err) {
    console.error(`[insights] ${tool.name} failed:`, err instanceof Error ? err.message : err);
    return {
      ok: false,
      cards: [{ title: 'Could not load this', rows: [], empty: 'Something went wrong while reading your data. Please try again.' }],
      data: { error: true },
    };
  }
}

export type { ResolvedPeriod };
