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
    expect(rows[0].days_overdue).toBe(11);
    expect(bucketFor(31)).toBe('31-60');
    expect(bucketFor(61)).toBe('61-90');
  });

  it('items due on or after the as-of date are not due (Zoho "Current")', () => {
    expect(bucketFor(0)).toBe('not_due');
    expect(bucketFor(-10)).toBe('not_due');
    expect(bucketFor(1)).toBe('0-30');
    const { summary, totals } = buildAgeing(
      [
        doc('future', 2360, '2026-09-25', { dueDate: '2026-10-10' }),
        doc('today', 500, '2026-09-30'),
        doc('late', 4720, '2026-08-15', { dueDate: '2026-08-30' }),
      ],
      '2026-09-30'
    );
    const rows = summary[0].transactions;
    expect(rows.find((r) => r.transaction_id === 'future')).toMatchObject({ age_bucket: 'not_due', days_overdue: -10, days_old: 0 });
    expect(rows.find((r) => r.transaction_id === 'today')?.age_bucket).toBe('not_due');
    expect(rows.find((r) => r.transaction_id === 'late')).toMatchObject({ age_bucket: '31-60', days_overdue: 31 });
    expect(totals).toMatchObject({ not_due: 2860, age_0_30: 0, age_30_60: 4720, total: 7580 });
  });

  it('an advance adjustment settles the invoice it is linked to', () => {
    const rows = allocateParty(
      [
        doc('old', 1000, '2026-04-01'),
        doc('new', 800, '2026-08-01'),
        doc('adj', -800, '2026-08-05', { voucherType: 'advance_adjustment', linkedVoucherId: 'new' }),
      ],
      '2026-09-30'
    );
    expect(rows.map((r) => [r.transaction_id, r.outstanding])).toEqual([['old', 1000]]);
  });
});
