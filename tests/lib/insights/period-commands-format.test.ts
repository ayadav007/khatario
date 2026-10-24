import { detectPeriod, isSummaryCommand, matchCommand } from '@/lib/insights/commands';
import { change, inr, renderCards, toWhatsAppText, type InsightCard } from '@/lib/insights/format';
import { addDays, fyStart, resolvePeriod } from '@/lib/insights/period';

describe('periods (Indian calendar)', () => {
  const today = '2026-10-02'; // a Friday

  it('today and yesterday compare with the day before', () => {
    expect(resolvePeriod('today', today)).toMatchObject({ from: today, to: today, prevFrom: '2026-10-01', prevTo: '2026-10-01' });
    expect(resolvePeriod('yesterday', today)).toMatchObject({ from: '2026-10-01', to: '2026-10-01', prevFrom: '2026-09-30' });
  });

  it('weeks start on Monday', () => {
    expect(resolvePeriod('this_week', today)).toMatchObject({ from: '2026-09-28', to: today, prevFrom: '2026-09-21', prevTo: '2026-09-25' });
    expect(resolvePeriod('last_week', today)).toMatchObject({ from: '2026-09-21', to: '2026-09-27' });
    expect(resolvePeriod('this_week', '2026-09-28').from).toBe('2026-09-28');
    expect(resolvePeriod('this_week', '2026-10-04').from).toBe('2026-09-28');
  });

  it('this month compares with the same days of last month, clipped to month end', () => {
    expect(resolvePeriod('this_month', today)).toMatchObject({ from: '2026-10-01', prevFrom: '2026-09-01', prevTo: '2026-09-02' });
    expect(resolvePeriod('this_month', '2026-03-31')).toMatchObject({ prevFrom: '2026-02-01', prevTo: '2026-02-28' });
    expect(resolvePeriod('last_month', '2026-03-15')).toMatchObject({ from: '2026-02-01', to: '2026-02-28', prevFrom: '2026-01-01', prevTo: '2026-01-31' });
    expect(resolvePeriod('last_month', '2026-01-10')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('financial year runs April to March', () => {
    expect(fyStart('2026-03-31')).toBe('2025-04-01');
    expect(fyStart('2026-04-01')).toBe('2026-04-01');
    expect(resolvePeriod('this_fy', today)).toMatchObject({ from: '2026-04-01', to: today, prevFrom: '2025-04-01', prevTo: '2025-10-02' });
    expect(resolvePeriod('this_fy', '2028-02-29').prevTo).toBe('2027-02-28');
  });

  it('rolling windows', () => {
    expect(resolvePeriod('last_7_days', today)).toMatchObject({ from: '2026-09-26', prevFrom: '2026-09-19', prevTo: '2026-09-25' });
    expect(resolvePeriod('last_30_days', today).from).toBe(addDays(today, -29));
  });
});

describe('keyword commands', () => {
  const tool = (text: string) => matchCommand(text)?.calls[0]?.name ?? null;
  const args = (text: string) => matchCommand(text)?.calls[0]?.args;

  it.each([
    ['How was sale today?', 'sales_summary'],
    ['aaj kitna sale hua', 'sales_summary'],
    ['sales this month', 'sales_summary'],
    ['Which customer has the highest pending amount?', 'top_debtors'],
    ['udhaar list', 'top_debtors'],
    ['dues', 'top_debtors'],
    ['overdue invoices', 'overdue_invoices'],
    ['supplier dues this week', 'payables_due'],
    ['top products this month', 'top_products'],
    ['best selling items', 'top_products'],
    ['top 3 customers', 'top_customers'],
    ['low stock', 'low_stock'],
    ['stock khatam', 'low_stock'],
    ['GST alerts', 'gst_alerts'],
    ['payments received yesterday', 'payments_received'],
    ['kharcha this month', 'purchases_expenses'],
    ['summary', 'daily_summary'],
    ['aaj ka hisaab', 'daily_summary'],
    ['how is the business', 'daily_summary'],
  ])('%s -> %s', (text, expected) => {
    expect(tool(text)).toBe(expected);
  });

  it('reads periods and limits', () => {
    expect(args('sales yesterday')).toEqual({ period: 'yesterday' });
    expect(args('kal ki sale')).toEqual({ period: 'yesterday' });
    expect(args('pichle mahine ki sales')).toEqual({ period: 'last_month' });
    expect(args('sales this year')).toEqual({ period: 'this_fy' });
    expect(args('top 3 customers')).toEqual({ period: 'this_month', limit: 3 });
    expect(args('summary')).toEqual({ day: 'today' });
    expect(args('kal ka hisaab')).toEqual({ day: 'yesterday' });
    expect(detectPeriod('random words')).toBeNull();
  });

  it('flags how-to questions so they go to the guides', () => {
    expect(matchCommand('How do I create a sales invoice?')?.howTo).toBe(true);
    expect(matchCommand('sales return kaise kare')?.howTo).toBe(true);
    expect(matchCommand('what is a sales return')?.howTo).toBe(true);
    expect(matchCommand('what is my sales today')?.howTo).toBe(false);
    expect(matchCommand('how was sale today')?.howTo).toBe(false);
  });

  it('returns null for unrelated text', () => {
    expect(matchCommand('hello there')).toBeNull();
    expect(matchCommand('')).toBeNull();
  });

  it('summary shortcuts', () => {
    expect(isSummaryCommand('SUMMARY')).toBe(true);
    expect(isSummaryCommand('aaj')).toBe(true);
    expect(isSummaryCommand('summary of GST')).toBe(false);
  });
});

describe('formatting', () => {
  const card: InsightCard = {
    title: 'Sales: Today',
    rows: [
      { label: 'Sales', value: inr(125000.4), hint: 'up 10% vs yesterday' },
      { label: 'Bills', value: '12 bills' },
    ],
    link: { label: 'Sales summary', url: '/reports/sales/summary' },
  };

  it('formats rupees the Indian way', () => {
    expect(inr(125000.4)).toBe('₹1,25,000');
    expect(inr(-1500)).toBe('-₹1,500');
    expect(inr(0)).toBe('₹0');
  });

  it('describes change vs the earlier period', () => {
    expect(change(110, 100, 'yesterday')).toBe('up 10% vs yesterday');
    expect(change(50, 100, 'yesterday')).toBe('down 50% vs yesterday');
    expect(change(100, 100, 'yesterday')).toBe('same as yesterday');
    expect(change(0, 0, 'yesterday')).toBeNull();
    expect(change(10, 0, 'yesterday')).toBe('none yesterday');
  });

  it('renders chat markdown and WhatsApp text', () => {
    expect(renderCards([card], 'chat')).toBe('**Sales: Today**\n- Sales: ₹1,25,000 (up 10% vs yesterday)\n- Bills: 12 bills');
    expect(renderCards([card], 'whatsapp', 'https://app.example.com')).toBe(
      '*Sales: Today*\nSales: ₹1,25,000 (up 10% vs yesterday)\nBills: 12 bills\nSales summary: https://app.example.com/reports/sales/summary',
    );
  });

  it('shows the empty message when there are no rows', () => {
    expect(renderCards([{ title: 'Low stock', rows: [], empty: 'Nothing low.' }], 'chat')).toBe('**Low stock**\nNothing low.');
  });

  it('converts guide answers for WhatsApp', () => {
    expect(toWhatsAppText('**Step 1**: open Sales [1].\n\n\n## Next\nSee [guide](https://khatario.com/guides/x) [2]')).toBe(
      '*Step 1*: open Sales.\n\n*Next*\nSee guide (https://khatario.com/guides/x)',
    );
  });
});
