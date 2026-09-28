import { allocateParty, buildAgeing, bucketFor, type AgeingDoc } from '@/lib/reports/ageing';

const doc = (voucherId: string, amount: number, docDate: string, extra: Partial<AgeingDoc> = {}): AgeingDoc => ({
  voucherType: amount > 0 ? 'invoice' : 'payment',
  voucherId,
  partyId: 'c1',
  partyName: 'Customer',
  partyPhone: null,
  reference: voucherId,
  docDate,
  dueDate: null,
  amount,
  linkedVoucherId: null,
  ...extra,
});

describe('ageing allocation', () => {
  it('applies linked settlements first, then FIFO', () => {
    const rows = allocateParty(
      [
        doc('inv1', 1000, '2026-04-01'),
        doc('inv2', 500, '2026-06-01'),
        doc('pay', -500, '2026-06-10', { linkedVoucherId: 'inv2' }),
        doc('cn', -300, '2026-06-15'),
      ],
      '2026-07-01'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].transaction_id).toBe('inv1');
    expect(rows[0].outstanding).toBe(700);
    expect(rows[0].age_bucket).toBe('90+');
  });

  it('excess settlement stays on account and totals equal the net ledger balance', () => {
    const docs = [
      doc('inv1', 20000, '2026-09-01'),
      doc('inv2', 11800, '2026-09-10'),
      doc('pay', -25000, '2026-09-20', { linkedVoucherId: 'inv1' }),
      doc('adv', -9000, '2026-09-21', { partyId: 'c2', partyName: 'Other' }),
      doc('jv', 250, '2026-09-22', { voucherType: 'journal', partyId: null, partyName: null }),
    ];
    const { summary, totals } = buildAgeing(docs, '2026-09-27');
    expect(totals.total).toBe(20000 + 11800 - 25000 - 9000 + 250);
    expect(totals.on_account).toBe(-9000);
    const c1 = summary.find((s) => s.party_id === 'c1')!;
    expect(c1.total).toBe(6800);
    expect(summary.some((s) => s.party_id === null)).toBe(true);
  });

  it('ages from due date', () => {
    const rows = allocateParty([doc('inv', 100, '2026-01-01', { dueDate: '2026-06-20' })], '2026-07-01');
    expect(rows[0].days_old).toBe(11);
    expect(bucketFor(31)).toBe('31-60');
    expect(bucketFor(61)).toBe('61-90');
  });
});
