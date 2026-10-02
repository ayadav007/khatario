/**
 * Owner insights: tool SQL parameters, plan gating, primary-admin gate, model tool choice and
 * the answerTurn routing that keeps business figures away from staff.
 */
jest.mock('@/lib/db', () => ({ queryRows: jest.fn(), query: jest.fn(), queryOne: jest.fn() }));
jest.mock('@/lib/subscription/feature-access', () => ({ hasFeatureAccess: jest.fn() }));
jest.mock('@/lib/reports/sales-reports', () => ({ salesSummary: jest.fn(), salesByCustomer: jest.fn(), salesByItem: jest.fn() }));
jest.mock('@/lib/reports/purchase-reports', () => ({ purchaseSummary: jest.fn() }));
jest.mock('@/lib/reports/party-ledger-docs', () => ({ fetchPartyLedgerDocs: jest.fn() }));
jest.mock('@/lib/gst/compliance/engine', () => ({ listActiveComplianceAlerts: jest.fn() }));

import { queryOne, queryRows } from '@/lib/db';
import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import { salesByCustomer, salesSummary } from '@/lib/reports/sales-reports';
import { purchaseSummary } from '@/lib/reports/purchase-reports';
import { fetchPartyLedgerDocs } from '@/lib/reports/party-ledger-docs';
import { listActiveComplianceAlerts } from '@/lib/gst/compliance/engine';
import { getInsightTool, INSIGHT_TOOLS, runInsightTool, type InsightContext } from '@/lib/insights/tools';
import { canSeeBusinessData, runInsights } from '@/lib/insights/turn';
import { chooseTools } from '@/lib/rag/llm';

const mQueryRows = queryRows as jest.Mock;
const mQueryOne = queryOne as jest.Mock;
const mFeature = hasFeatureAccess as jest.Mock;
const mSalesSummary = salesSummary as jest.Mock;

const BIZ = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const ctx: InsightContext = { businessId: BIZ, userId: USER, today: '2026-10-02' };

const salesTotals = (sales: number) => ({
  totals: {
    invoice_count: 3, credit_note_count: 0, invoice_sales: sales, credit_note_sales: 0, sales, tax: sales * 0.18,
    sales_with_tax: sales * 1.18, discount: 0, collected: sales, balance_due: 500,
  },
});

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GROQ_API_KEY = '';
  process.env.GEMINI_API_KEY = '';
  mFeature.mockResolvedValue(true);
  mQueryRows.mockResolvedValue([]);
  mQueryOne.mockResolvedValue(null);
  (listActiveComplianceAlerts as jest.Mock).mockResolvedValue([]);
  (fetchPartyLedgerDocs as jest.Mock).mockResolvedValue([]);
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('tool registry', () => {
  it('every tool has a JSON schema and accepts empty arguments', () => {
    for (const tool of INSIGHT_TOOLS) {
      expect(tool.parameters).toMatchObject({ type: 'object' });
      expect(tool.schema.safeParse({}).success).toBe(true);
    }
  });

  it('caps limits and rejects unknown periods without throwing', () => {
    const top = getInsightTool('top_debtors')!;
    expect(top.schema.parse({ limit: 500 })).toEqual({ limit: 5 });
    expect(top.schema.parse({ limit: '3' })).toEqual({ limit: 3 });
    expect(getInsightTool('sales_summary')!.schema.parse({ period: 'all_time' })).toEqual({ period: 'today' });
  });
});

describe('tools read the right business and dates', () => {
  it('sales_summary uses the session business, the period and the earlier period', async () => {
    mSalesSummary.mockResolvedValueOnce(salesTotals(1100)).mockResolvedValueOnce(salesTotals(1000));
    const res = await runInsightTool(ctx, { name: 'sales_summary', args: { period: 'today' } });
    expect(res.ok).toBe(true);
    expect(mSalesSummary.mock.calls[0][0]).toEqual({ businessId: BIZ, userId: USER, fromDate: '2026-10-02', toDate: '2026-10-02', branchId: null });
    expect(mSalesSummary.mock.calls[1][0]).toMatchObject({ fromDate: '2026-10-01', toDate: '2026-10-01' });
    expect(res.cards[0].rows[0]).toEqual({ label: 'Sales (before GST)', value: '₹1,100', hint: 'up 10% vs yesterday' });
  });

  it('payments_received filters active receivables by payment date', async () => {
    mQueryRows.mockResolvedValueOnce([{ mode: 'upi', n: '2', total: '3000' }, { mode: 'cash', n: '1', total: '500' }]);
    const res = await runInsightTool(ctx, { name: 'payments_received', args: { period: 'this_month' } });
    const [sql, params] = mQueryRows.mock.calls[0];
    expect(sql).toMatch(/type = 'receivable'/);
    expect(sql).toMatch(/status = 'active'/);
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(params).toEqual([BIZ, '2026-10-01', '2026-10-02']);
    expect(res.cards[0].subtitle).toBe('₹3,500 from 3 payments');
    expect(res.cards[0].rows[0]).toMatchObject({ label: 'UPI', value: '₹3,000' });
  });

  it('overdue_invoices only counts posted, non-proforma invoices due before today', async () => {
    await runInsightTool(ctx, { name: 'overdue_invoices', args: { limit: 3 } });
    const [sql, params] = mQueryRows.mock.calls[0];
    expect(sql).toMatch(/status = 'final'/);
    expect(sql).toMatch(/proforma_invoice/);
    expect(sql).toMatch(/balance_amount > 0/);
    expect(params).toEqual([BIZ, '2026-10-02', 3]);
  });

  it('payables_due looks ahead the requested number of days', async () => {
    await runInsightTool(ctx, { name: 'payables_due', args: { within_days: 7 } });
    expect(mQueryRows.mock.calls[0][1]).toEqual([BIZ, '2026-10-09']);
  });

  it('low_stock only lists active goods with a minimum set', async () => {
    await runInsightTool(ctx, { name: 'low_stock', args: {} });
    const [sql, params] = mQueryRows.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(item_type, 'goods'\) = 'goods'/);
    expect(sql).toMatch(/min_stock, 0\) > 0/);
    expect(params).toEqual([BIZ, 5]);
  });

  it('top_debtors sorts by total owed and shows the overdue part', async () => {
    (fetchPartyLedgerDocs as jest.Mock).mockResolvedValue([
      { voucherType: 'invoice', voucherId: 'a', partyId: 'c1', partyName: 'Asha Traders', partyPhone: null, reference: 'INV-1', docDate: '2026-08-01', dueDate: '2026-08-15', amount: 5000, linkedVoucherId: null },
      { voucherType: 'invoice', voucherId: 'b', partyId: 'c2', partyName: 'Bharat Stores', partyPhone: null, reference: 'INV-2', docDate: '2026-09-30', dueDate: '2026-10-20', amount: 9000, linkedVoucherId: null },
    ]);
    const res = await runInsightTool(ctx, { name: 'top_debtors', args: {} });
    expect(fetchPartyLedgerDocs).toHaveBeenCalledWith({ businessId: BIZ, partyType: 'customer', asOfDate: '2026-10-02' });
    expect(res.cards[0].rows.map((r) => r.label)).toEqual(['Bharat Stores', 'Asha Traders']);
    expect(res.cards[0].rows[0].hint).toBe('not due yet');
    expect(res.cards[0].rows[1].hint).toBe('₹5,000 overdue');
  });

  it('top_customers defaults to this month', async () => {
    (salesByCustomer as jest.Mock).mockResolvedValue({ customers: [{ customer_name: 'Asha', sales: 1000, invoice_count: 2 }], totals: {} });
    const res = await runInsightTool(ctx, { name: 'top_customers', args: {} });
    expect((salesByCustomer as jest.Mock).mock.calls[0][0]).toMatchObject({ fromDate: '2026-10-01', toDate: '2026-10-02' });
    expect(res.cards[0].rows[0]).toEqual({ label: 'Asha', value: '₹1,000', hint: '2 bills' });
  });

  it('purchases_expenses combines purchase totals with expenses', async () => {
    (purchaseSummary as jest.Mock).mockResolvedValue({ totals: { purchases: 2000, purchases_with_tax: 2360, bill_count: 1 } });
    mQueryOne.mockResolvedValueOnce({ n: '2', total: '450' });
    const res = await runInsightTool(ctx, { name: 'purchases_expenses', args: { period: 'today' } });
    expect(res.cards[0].rows.map((r) => r.value)).toEqual(['₹2,000', '₹2,360', '₹450']);
  });
});

describe('plan gating', () => {
  it('names the missing feature instead of running the tool', async () => {
    mFeature.mockImplementation(async (_b: string, f: string) => f !== 'reports_advanced');
    const res = await runInsightTool(ctx, { name: 'top_debtors', args: {} });
    expect(res.ok).toBe(false);
    expect(res.cards[0].title).toBe('Not on your plan');
    expect(res.cards[0].empty).toMatch(/advanced reports/);
    expect(fetchPartyLedgerDocs).not.toHaveBeenCalled();
  });

  it('daily_summary leaves out sections the plan does not include', async () => {
    mFeature.mockImplementation(async (_b: string, f: string) => f === 'reports_basic');
    mSalesSummary.mockResolvedValue(salesTotals(1000));
    (purchaseSummary as jest.Mock).mockResolvedValue({ totals: { purchases: 0, purchases_with_tax: 0, bill_count: 0 } });
    const res = await runInsightTool(ctx, { name: 'daily_summary', args: { day: 'today' } });
    const labels = res.cards[0].rows.map((r) => r.label);
    expect(labels).toEqual(['Sales', 'Money received', 'Purchases', 'Expenses']);
    expect(fetchPartyLedgerDocs).not.toHaveBeenCalled();
    expect(listActiveComplianceAlerts).not.toHaveBeenCalled();
  });

  it('a failing tool becomes a friendly card', async () => {
    mQueryRows.mockRejectedValueOnce(new Error('boom'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await runInsightTool(ctx, { name: 'low_stock', args: {} });
    spy.mockRestore();
    expect(res.ok).toBe(false);
    expect(res.cards[0].title).toBe('Could not load this');
  });

  it('unknown tools are ignored', async () => {
    expect(await runInsightTool(ctx, { name: 'drop_tables', args: {} })).toMatchObject({ ok: false, cards: [] });
  });
});

describe('primary admin gate', () => {
  it('only an active primary admin of this business sees figures', async () => {
    mQueryOne.mockResolvedValueOnce({ ok: true });
    await expect(canSeeBusinessData(USER, BIZ)).resolves.toBe(true);
    const [sql, params] = mQueryOne.mock.calls[0];
    expect(sql).toMatch(/is_active = true/);
    expect(params).toEqual([USER, BIZ]);

    mQueryOne.mockResolvedValueOnce({ ok: false });
    await expect(canSeeBusinessData(USER, BIZ)).resolves.toBe(false);
    mQueryOne.mockResolvedValueOnce(null);
    await expect(canSeeBusinessData(USER, BIZ)).resolves.toBe(false);
    await expect(canSeeBusinessData(null, BIZ)).resolves.toBe(false);
  });
});

describe('model tool choice', () => {
  it('reads Groq tool calls and drops unknown tools', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { tool_calls: [
          { function: { name: 'top_debtors', arguments: '{"limit":3}' } },
          { function: { name: 'delete_everything', arguments: '{}' } },
        ] } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const res = await chooseTools([{ role: 'user', content: 'who owes me' }], [{ name: 'top_debtors', description: 'x', parameters: { type: 'object' } }]);
    expect(res.available).toBe(true);
    expect(res.calls).toEqual([{ name: 'top_debtors', args: { limit: 3 } }]);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.tool_choice).toBe('auto');
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: 'top_debtors', description: 'x', parameters: { type: 'object' } } });
  });

  it('reports unavailable without a Groq key, so keywords take over', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const res = await chooseTools([{ role: 'user', content: 'x' }], []);
    expect(res).toMatchObject({ available: false, calls: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runInsights uses the keyword match for short commands without calling a model', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.GROQ_API_KEY = 'test-key';
    mQueryRows.mockResolvedValueOnce([]);
    const res = await runInsights({ businessId: BIZ, userId: USER, today: '2026-10-02' }, 'low stock', { format: 'whatsapp' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.kind).toBe('data');
    expect(res.calls).toEqual([{ name: 'low_stock', args: {} }]);
    expect(res.text.startsWith('*Low stock*')).toBe(true);
  });

  it('runInsights lists what the owner can ask when nothing matches', async () => {
    const res = await runInsights({ businessId: BIZ, userId: USER }, 'tell me a joke', { useModel: false });
    expect(res.kind).toBe('help');
    expect(res.text).toMatch(/highest pending amount/);
  });
});
