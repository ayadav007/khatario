import {
  computeSegmentedGstInterest,
  mergeGstPaymentEventsByDate,
  GSTR3B_ANNUAL_INTEREST_RATE,
  wholeDaysLate,
} from '@/lib/gst/gst-interest';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

describe('computeSegmentedGstInterest', () => {
  const due = '2026-04-20';

  it('two partial payments: bases shrink and total equals sum of per-segment interest', () => {
    const initial = 10_000;
    const { segments, totalInterest } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: initial,
      paymentEvents: [
        { date: '2026-04-24', amount: 3_000 },
        { date: '2026-04-28', amount: 7_000 },
      ],
      interestEndDate: '2026-04-28',
    });

    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.days > 0)).toBe(true);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].from > segments[i - 1].to).toBe(true);
    }

    expect(segments[0].from).toBe(due);
    expect(segments[0].to).toBe('2026-04-24');
    expect(segments[0].base).toBe(10_000);
    expect(segments[0].days).toBe(wholeDaysLate(due, '2026-04-24'));
    expect(segments[0].interest).toBe(
      round2((10_000 * GSTR3B_ANNUAL_INTEREST_RATE * segments[0].days) / 365)
    );

    expect(segments[1].from).toBe('2026-04-25');
    expect(segments[1].to).toBe('2026-04-28');
    expect(segments[1].base).toBe(7_000);
    expect(segments[1].days).toBe(wholeDaysLate('2026-04-25', '2026-04-28'));
    expect(segments[1].interest).toBe(
      round2((7_000 * GSTR3B_ANNUAL_INTEREST_RATE * segments[1].days) / 365)
    );

    const expectedTotal = round2(segments.reduce((s, x) => s + x.interest, 0));
    expect(totalInterest).toBe(expectedTotal);
    expect(totalInterest).toBe(round2(segments[0].interest + segments[1].interest));
  });

  it('no payment events: single tail segment from due to interestEndDate', () => {
    const { segments, totalInterest } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 5_000,
      paymentEvents: [],
      interestEndDate: '2026-04-25',
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].from).toBe(due);
    expect(segments[0].to).toBe('2026-04-25');
    expect(segments[0].base).toBe(5_000);
    expect(segments[0].days).toBe(wholeDaysLate(due, '2026-04-25'));
    expect(totalInterest).toBe(
      round2((5_000 * GSTR3B_ANNUAL_INTEREST_RATE * segments[0].days) / 365)
    );
  });

  it('ignores payments on or before due date', () => {
    const { segments } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 1_000,
      paymentEvents: [
        { date: '2026-04-20', amount: 500 },
        { date: '2026-04-19', amount: 999 },
      ],
      interestEndDate: '2026-04-22',
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].base).toBe(1_000);
    expect(segments[0].to).toBe('2026-04-22');
  });

  it('zero initial liability yields no segments and zero interest', () => {
    const { segments, totalInterest } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 0,
      paymentEvents: [{ date: '2026-04-22', amount: 100 }],
      interestEndDate: '2026-04-30',
    });

    expect(segments).toHaveLength(0);
    expect(totalInterest).toBe(0);
  });

  it('sorts out-of-order payment events by date', () => {
    const { segments } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 1_000,
      paymentEvents: [
        { date: '2026-04-26', amount: 400 },
        { date: '2026-04-22', amount: 600 },
      ],
      interestEndDate: '2026-04-26',
    });

    expect(segments).toHaveLength(2);
    expect(segments[0].to).toBe('2026-04-22');
    expect(segments[0].base).toBe(1_000);
    expect(segments[1].from).toBe('2026-04-23');
    expect(segments[1].to).toBe('2026-04-26');
    expect(segments[1].base).toBe(400);
  });
});

/** CA minimal pack — dates 2026-04-* align with `due` 20 Apr. */
describe('computeSegmentedGstInterest (CA minimal pack)', () => {
  const due = '2026-04-20';

  it('Case 1 — single payment after due: 5 days @ full base', () => {
    const base = 100;
    const { segments, totalInterest } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: base,
      paymentEvents: [{ date: '2026-04-25', amount: 100 }],
      interestEndDate: '2026-04-25',
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].base).toBe(100);
    expect(segments[0].days).toBe(5);
    expect(segments[0].days).toBe(wholeDaysLate(due, '2026-04-25'));
    expect(totalInterest).toBe(round2((100 * GSTR3B_ANNUAL_INTEREST_RATE * 5) / 365));
  });

  it('Case 2 — two partial payments (60 + 40 on 100)', () => {
    const { segments, totalInterest } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 100,
      paymentEvents: [
        { date: '2026-04-23', amount: 60 },
        { date: '2026-04-28', amount: 40 },
      ],
      interestEndDate: '2026-04-28',
    });

    expect(segments).toHaveLength(2);
    expect(segments[0].base).toBe(100);
    expect(segments[0].to).toBe('2026-04-23');
    expect(segments[0].days).toBe(3);
    expect(segments[1].base).toBe(40);
    expect(segments[1].from).toBe('2026-04-24');
    expect(segments[1].to).toBe('2026-04-28');
    expect(segments[1].days).toBe(wholeDaysLate('2026-04-24', '2026-04-28'));
    expect(totalInterest).toBe(round2(segments[0].interest + segments[1].interest));
  });

  it('Case 3 — paid on due: books show no outstanding (initial 0)', () => {
    const { segments, totalInterest } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 0,
      paymentEvents: [],
      interestEndDate: '2026-04-30',
    });

    expect(segments).toHaveLength(0);
    expect(totalInterest).toBe(0);
  });

  it('Case 4 — no payment, late filing: tail from due to filing date', () => {
    const { segments, totalInterest } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 100,
      paymentEvents: [],
      interestEndDate: '2026-04-30',
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].from).toBe(due);
    expect(segments[0].to).toBe('2026-04-30');
    expect(segments[0].days).toBe(wholeDaysLate(due, '2026-04-30'));
    expect(totalInterest).toBe(
      round2((100 * GSTR3B_ANNUAL_INTEREST_RATE * segments[0].days) / 365)
    );
  });

  it('Case 5 — overpayment: outstanding never negative; one segment then cleared', () => {
    const { segments, totalInterest } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 100,
      paymentEvents: [{ date: '2026-04-22', amount: 150 }],
      interestEndDate: '2026-04-22',
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].base).toBe(100);
    expect(totalInterest).toBe(
      round2((100 * GSTR3B_ANNUAL_INTEREST_RATE * wholeDaysLate(due, '2026-04-22')) / 365)
    );
  });
});

describe('computeSegmentedGstInterest (edge cases)', () => {
  const due = '2026-04-20';

  it('same-day multiple payments aggregate like one instalment', () => {
    const { segments, totalInterest } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 100,
      paymentEvents: [
        { date: '2026-04-23', amount: 60 },
        { date: '2026-04-23', amount: 40 },
      ],
      interestEndDate: '2026-04-23',
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].to).toBe('2026-04-23');
    expect(segments[0].days).toBe(wholeDaysLate(due, '2026-04-23'));
    expect(totalInterest).toBe(
      round2((100 * GSTR3B_ANNUAL_INTEREST_RATE * segments[0].days) / 365)
    );
  });

  it('payment day after due → exactly one interest day', () => {
    expect(wholeDaysLate(due, '2026-04-21')).toBe(1);
    const { segments, totalInterest } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 100,
      paymentEvents: [{ date: '2026-04-21', amount: 100 }],
      interestEndDate: '2026-04-21',
    });
    expect(segments[0].days).toBe(1);
    expect(totalInterest).toBe(round2((100 * GSTR3B_ANNUAL_INTEREST_RATE) / 365));
  });

  it('ignores payment events after interestEndDate (e.g. future-dated vs April cut-off)', () => {
    const { segments, totalInterest } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 100,
      paymentEvents: [
        { date: '2026-04-25', amount: 50 },
        { date: '2026-05-05', amount: 50 },
      ],
      interestEndDate: '2026-04-30',
    });

    expect(segments.some((s) => s.to === '2026-05-05')).toBe(false);
    expect(segments.every((s) => s.days > 0)).toBe(true);
    const lastTo = segments[segments.length - 1]?.to;
    expect(lastTo && lastTo <= '2026-04-30').toBe(true);
    expect(totalInterest).toBe(round2(segments.reduce((s, x) => s + x.interest, 0)));
  });

  it('strict segment ordering: each segment starts after previous segment end (ISO dates)', () => {
    const { segments } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 10_000,
      paymentEvents: [
        { date: '2026-04-22', amount: 2_000 },
        { date: '2026-04-24', amount: 3_000 },
        { date: '2026-04-27', amount: 5_000 },
      ],
      interestEndDate: '2026-04-27',
    });
    expect(segments.length).toBeGreaterThan(1);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].from > segments[i - 1].to).toBe(true);
    }
    expect(segments.every((s) => s.days > 0)).toBe(true);
  });

  it('mergeGstPaymentEventsByDate sums and sorts', () => {
    const merged = mergeGstPaymentEventsByDate([
      { date: '2026-04-24', amount: 1 },
      { date: '2026-04-23', amount: 2 },
      { date: '2026-04-23', amount: 3 },
    ]);
    expect(merged).toEqual([
      { date: '2026-04-23', amount: 5 },
      { date: '2026-04-24', amount: 1 },
    ]);
  });

  it('totalInterest matches rounded sum of segment interests', () => {
    const { segments, totalInterest } = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: 10_000,
      paymentEvents: [
        { date: '2026-04-22', amount: 4_000 },
        { date: '2026-04-27', amount: 6_000 },
      ],
      interestEndDate: '2026-04-27',
    });
    const sumRounded = round2(segments.reduce((s, x) => s + x.interest, 0));
    expect(totalInterest).toBe(sumRounded);
    expect(totalInterest.toFixed(2)).toBe(sumRounded.toFixed(2));
  });
});
