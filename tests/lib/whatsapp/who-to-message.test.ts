import {
  buildWhoToMessageQuery,
  parseWhoToMessageParams,
  reasonForRow,
} from '@/lib/whatsapp/who-to-message';

describe('who to message', () => {
  it('rejects an unknown list', () => {
    const parsed = parseWhoToMessageParams(new URLSearchParams('condition=vehicles'));
    expect(parsed.ok).toBe(false);
  });

  it('defaults a quiet list to 30 days and only people who already bought', () => {
    const parsed = parseWhoToMessageParams(new URLSearchParams('condition=quiet'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.days).toBe(30);
    const sql = buildWhoToMessageQuery(parsed.value).text;
    expect(sql).toContain('FROM invoices i');
    expect(sql).toContain('JOIN customers c');
    expect(sql).toContain("status = 'final'");
    expect(sql).toContain('whatsapp_unsubscribes');
    expect(sql).toContain("INTERVAL '7 days'");
    expect(sql).not.toContain('store_enquiries');
  });

  it('sums top buyers only inside the chosen period', () => {
    const parsed = parseWhoToMessageParams(new URLSearchParams('condition=top&period_days=90&limit=10'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const built = buildWhoToMessageQuery(parsed.value);
    expect(built.values).toEqual([90, 10]);
    expect(built.text).toContain('invoice_date >= (CURRENT_DATE - $2::int)');
    expect(built.text).toContain('LIMIT $3');
  });

  it('keeps a store enquiry only when no later store order exists', () => {
    const parsed = parseWhoToMessageParams(new URLSearchParams('condition=enquiry&days=7'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const sql = buildWhoToMessageQuery(parsed.value).text;
    expect(sql).toContain('store_enquiries');
    expect(sql).toContain('store_orders');
    expect(sql).toContain("o.status <> 'cancelled'");
  });

  it('treats a WhatsApp chat as quiet only with no later bill or order', () => {
    const parsed = parseWhoToMessageParams(new URLSearchParams('condition=whatsapp&days=15'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const sql = buildWhoToMessageQuery(parsed.value).text;
    expect(sql).toContain("m.direction = 'incoming'");
    expect(sql).toContain('sales_orders');
    expect(sql).toContain('store_orders');
    expect(sql).toContain('invoice_date >= l.created_at::date');
  });

  it('describes a quiet customer by their last bill date', () => {
    expect(reasonForRow('quiet', { lastOn: '2026-01-12', amount: null, billCount: 2 }, 30)).toBe(
      'Last bill 12 Jan 2026',
    );
  });
});
