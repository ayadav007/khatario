jest.mock('@/lib/db', () => ({ getPool: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn() }));

import {
  creditNoteDeadlineFinding,
  currentFyDeadline,
  daysLeftStage,
  gstr3bFindings,
  einvoiceFinding,
  ewayBillFinding,
  itcDeadlineFinding,
  periodFilingOpensOn,
  previousFyRange,
  rcmSelfInvoiceFinding,
  type EwayCandidate,
  type RcmUnregisteredBill,
  recentReturnPeriods,
  returnPeriodForMonth,
  rule37Findings,
  shouldNotify,
  trackingSince,
  type Rule37BillInput,
} from '@/lib/gst/compliance/checks';
import { ReturnMarkInputError, validateReturnMarkInput } from '@/lib/gst/compliance/return-marks';
import { buildComplianceEmail } from '@/lib/gst/compliance/email';

const zero = { igst: 0, cgst: 0, sgst: 0, cess: 0 };

function bill(p: Partial<Rule37BillInput> & { days: number; status: Rule37BillInput['status'] }): Rule37BillInput {
  return {
    purchase_id: `p-${p.days}`,
    bill_number: `B-${p.days}`,
    bill_date: '2026-01-01',
    supplier_id: null,
    supplier_name: 'Sharma Traders',
    branch_id: null,
    days_outstanding: p.days,
    status: p.status,
    grand_total: 11800,
    unpaid: 11800,
    itc_claimed: { igst: 0, cgst: 900, sgst: 900, cess: 0 },
    target_reversal: zero,
    already_reversed: zero,
    interest_if_utilised: 0,
    ...p,
  };
}

describe('daysLeftStage', () => {
  it('buckets into the tightest milestone', () => {
    expect(daysLeftStage(40, [7, 15, 30])).toBeNull();
    expect(daysLeftStage(30, [7, 15, 30])).toBe('30d');
    expect(daysLeftStage(10, [30, 7, 15])).toBe('15d');
    expect(daysLeftStage(0, [7, 15, 30])).toBe('7d');
  });
});

describe('Rule 37 findings', () => {
  it('warns about bills approaching 180 days with the ITC on the unpaid part', () => {
    const [f] = rule37Findings(
      [bill({ days: 160, status: 'approaching', bill_date: '2026-01-01' }), bill({ days: 150, status: 'approaching', unpaid: 5900 })],
      '2026-06-10',
    );
    expect(f.key).toBe('rule37:approaching');
    expect(f.severity).toBe('warning');
    expect(f.stage).toBe('30d');
    expect(f.amount).toBe(1800 + 900);
    expect(f.dueDate).toBe('2026-06-30');
    expect(f.legalRef).toMatch(/Rule 37/);
  });

  it('turns critical in the last week', () => {
    const [f] = rule37Findings([bill({ days: 176, status: 'approaching' })], '2026-06-26');
    expect(f.severity).toBe('critical');
    expect(f.stage).toBe('7d');
  });

  it('asks for a reversal only for the part not yet reversed', () => {
    const findings = rule37Findings(
      [
        bill({ days: 200, status: 'overdue', target_reversal: { igst: 0, cgst: 900, sgst: 900, cess: 0 }, already_reversed: zero }),
        bill({
          days: 220,
          status: 'overdue',
          target_reversal: { igst: 0, cgst: 900, sgst: 900, cess: 0 },
          already_reversed: { igst: 0, cgst: 900, sgst: 900, cess: 0 },
        }),
      ],
      '2026-07-20',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe('rule37:reversal_pending');
    expect(findings[0].amount).toBe(1800);
    expect((findings[0].details.bills as unknown[]).length).toBe(1);
  });

  it('ignores paid and within-window bills', () => {
    expect(rule37Findings([bill({ days: 160, status: 'approaching', unpaid: 0 }), bill({ days: 90, status: 'within' })], '2026-06-10')).toEqual([]);
  });
});

describe('30 November deadline', () => {
  it('only runs April to November for the FY that just ended', () => {
    expect(currentFyDeadline('2026-02-10')).toBeNull();
    expect(currentFyDeadline('2026-12-01')).toBeNull();
    expect(currentFyDeadline('2026-10-01')).toMatchObject({
      fyLabel: 'FY 2025-26',
      fyStart: '2025-04-01',
      fyEnd: '2026-03-31',
      deadline: '2026-11-30',
      daysLeft: 60,
    });
  });

  const docs = [
    { supplier_gstin: '27AAAAA0000A1Z5', supplier_name: 'A', invoice_number: 'X1', invoice_date: '2025-06-01', itc: 1200 },
    { supplier_gstin: '27AAAAA0000A1Z5', supplier_name: 'A', invoice_number: 'X2', invoice_date: '2026-05-01', itc: 5000 },
  ];

  it('flags last FY invoices in GSTR-2B that are not in the books, inside 60 days', () => {
    expect(itcDeadlineFinding('2026-09-15', docs)).toBeNull();
    const f = itcDeadlineFinding('2026-10-15', docs)!;
    expect(f.key).toBe('itc_deadline:FY 2025-26');
    expect(f.amount).toBe(1200);
    expect(f.stage).toBe('60d');
    expect(f.severity).toBe('warning');
    expect(f.legalRef).toBe('CGST Act, Section 16(4)');
    expect(itcDeadlineFinding('2026-11-20', docs)!.severity).toBe('critical');
  });

  it('reminds about credit notes only in the last 30 days and only with sales in that FY', () => {
    expect(creditNoteDeadlineFinding('2026-10-15', 12)).toBeNull();
    expect(creditNoteDeadlineFinding('2026-11-05', 0)).toBeNull();
    const f = creditNoteDeadlineFinding('2026-11-05', 12)!;
    expect(f.severity).toBe('info');
    expect(f.legalRef).toBe('CGST Act, Section 34(2)');
    expect(creditNoteDeadlineFinding('2026-11-25', 12)!.stage).toBe('7d');
  });
});

describe('GSTR-3B due dates', () => {
  const monthly = { filingFrequency: 'monthly' as const };

  it('lists the last two ended periods', () => {
    expect(recentReturnPeriods('2026-01-10', monthly).map((p) => p.period)).toEqual(['2025-12', '2025-11']);
    const q = recentReturnPeriods('2026-05-10', { filingFrequency: 'qrmp', qrmpDueDay: 22 });
    expect(q.map((p) => p.period)).toEqual(['2026-03', '2025-12']);
    expect(q[0].months).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('reminds in the last five days when there was activity', () => {
    const periods = recentReturnPeriods('2026-10-16', monthly).map((period, i) => ({ period, filed: i > 0, hasActivity: true }));
    const [f] = gstr3bFindings('2026-10-16', monthly, periods, false);
    expect(f.key).toBe('gstr3b:2026-09');
    expect(f.stage).toBe('due_5d');
    expect(f.dueDate).toBe('2026-10-20');
    expect(f.message).toMatch(/Mark it as filed/);
    expect(f.details).toMatchObject({ period: '2026-09', label: 'Sep 2026', can_mark_filed: true });
    expect(gstr3bFindings('2026-10-14', monthly, periods, false)).toEqual([]);
    expect(gstr3bFindings('2026-10-19', monthly, periods, false)[0].stage).toBe('due_1d');
  });

  it('skips quiet periods and filed returns', () => {
    const quiet = recentReturnPeriods('2026-10-16', monthly).map((period) => ({ period, filed: false, hasActivity: false }));
    expect(gstr3bFindings('2026-10-16', monthly, quiet, false)).toEqual([]);
    const filed = recentReturnPeriods('2026-10-16', monthly).map((period) => ({ period, filed: true, hasActivity: true }));
    expect(gstr3bFindings('2026-10-16', monthly, filed, true)).toEqual([]);
  });

  it('claims "late" only when the business records filings in Khatario', () => {
    const periods = recentReturnPeriods('2026-10-05', monthly).map((period) => ({ period, filed: false, hasActivity: true }));
    expect(gstr3bFindings('2026-10-05', monthly, periods, false)).toEqual([]);
    const late = gstr3bFindings('2026-10-05', monthly, periods, true);
    const aug = late.find((f) => f.key === 'gstr3b:2026-08')!;
    expect(aug.severity).toBe('critical');
    expect(aug.stage).toBe('overdue');
    expect(aug.amount).toBe(15 * 50);
  });
});

describe('e-way bill', () => {
  const inv = (p: Partial<EwayCandidate>): EwayCandidate => ({
    invoice_id: 'i1',
    invoice_number: 'INV-1',
    invoice_date: '2026-10-08',
    customer_name: 'Gupta Stores',
    grand_total: 60_000,
    has_goods: true,
    eway_bill_number: null,
    ...p,
  });

  it('lists recent goods invoices over the limit without a number, and never notifies', () => {
    const f = ewayBillFinding('2026-10-10', [
      inv({}),
      inv({ invoice_id: 'i2', grand_total: 50_000 }),
      inv({ invoice_id: 'i3', has_goods: false }),
      inv({ invoice_id: 'i4', eway_bill_number: '1812 3456 7890' }),
      inv({ invoice_id: 'i5', invoice_date: '2026-09-30' }),
    ])!;
    expect(f.quiet).toBe(true);
    expect(f.amount).toBe(60_000);
    expect((f.details.sales as unknown[]).length).toBe(1);
    expect(f.legalRef).toMatch(/Rule 138/);
  });

  it('is silent when nothing is missing', () => {
    expect(ewayBillFinding('2026-10-10', [inv({ eway_bill_number: 'EWB1' })])).toBeNull();
  });
});

describe('e-invoicing', () => {
  it('applies when last FY sales cross 5 crore, once per FY', () => {
    expect(previousFyRange('2026-10-10')).toEqual({ from: '2025-04-01', to: '2026-03-31', label: 'FY 2025-26' });
    expect(previousFyRange('2027-02-10').label).toBe('FY 2025-26');
    expect(einvoiceFinding('2026-10-10', { declaredAbove5cr: false, previousFyTurnover: 4_99_00_000 })).toBeNull();
    const f = einvoiceFinding('2026-10-10', { declaredAbove5cr: false, previousFyTurnover: 6_00_00_000 })!;
    expect(f.stage).toBe('FY 2026-27');
    expect(f.message).not.toMatch(/30 days/);
    expect(f.legalRef).toMatch(/Rule 48\(4\)/);
  });

  it('uses the profile flag and adds the 30-day rule at 10 crore', () => {
    const declared = einvoiceFinding('2026-10-10', { declaredAbove5cr: true, previousFyTurnover: 0 })!;
    expect(declared.message).toMatch(/business profile/);
    expect(declared.amount).toBeNull();
    expect(einvoiceFinding('2026-10-10', { declaredAbove5cr: false, previousFyTurnover: 12_00_00_000 })!.message).toMatch(/within 30 days/);
  });
});

describe('RCM self-invoice', () => {
  const bill = (bill_date: string, id = bill_date): RcmUnregisteredBill => ({
    purchase_id: id,
    bill_number: `RC-${id}`,
    bill_date,
    supplier_name: 'Local transporter',
    tax: 900,
  });

  it('reminds within 30 days of the purchase, more urgently in the last 5', () => {
    const f = rcmSelfInvoiceFinding('2026-10-10', [bill('2026-09-20'), bill('2026-10-05'), bill('2026-09-01')])!;
    expect(f.dueDate).toBe('2026-10-20');
    expect(f.severity).toBe('info');
    expect(f.amount).toBe(1800);
    expect((f.details.rcm_bills as unknown[]).length).toBe(2);
    const urgent = rcmSelfInvoiceFinding('2026-10-17', [bill('2026-09-20')])!;
    expect(urgent.severity).toBe('warning');
    expect(urgent.stage).toBe('5d');
  });

  it('drops bills past their 30 days', () => {
    expect(rcmSelfInvoiceFinding('2026-10-10', [bill('2026-09-01')])).toBeNull();
  });
});

describe('return periods for marking GSTR-3B filed', () => {
  it('maps a month to its own period, or its quarter for QRMP', () => {
    expect(returnPeriodForMonth('2026-08', { filingFrequency: 'monthly' })).toMatchObject({ period: '2026-08', label: 'Aug 2026' });
    const qrmp = { filingFrequency: 'qrmp' as const, qrmpDueDay: 22 as const };
    expect(returnPeriodForMonth('2026-01', qrmp).period).toBe('2026-03');
    expect(returnPeriodForMonth('2026-03', qrmp).period).toBe('2026-03');
    expect(returnPeriodForMonth('2026-04', qrmp).period).toBe('2026-06');
    expect(returnPeriodForMonth('2026-11', qrmp)).toMatchObject({ period: '2026-12', months: ['2026-10', '2026-11', '2026-12'] });
  });

  it('opens filing the day after the period and tracks six months back', () => {
    expect(periodFilingOpensOn('2026-12')).toBe('2027-01-01');
    expect(trackingSince('2026-03-15')).toBe('2025-09');
  });

  it('validates the mark input', () => {
    const today = '2026-10-10';
    expect(validateReturnMarkInput({ period: '2026-09', today })).toEqual({
      returnType: 'GSTR3B',
      period: '2026-09',
      filedOn: today,
      arn: null,
    });
    expect(validateReturnMarkInput({ period: '2026-09', filed_on: '2026-10-01', arn: ' aa2709260012345 ', today }).arn).toBe(
      'AA2709260012345',
    );
    expect(() => validateReturnMarkInput({ period: '2026-10', today })).toThrow(/after its period ends/);
    expect(() => validateReturnMarkInput({ period: '2026-09', filed_on: '2026-10-11', today })).toThrow(/future/);
    expect(() => validateReturnMarkInput({ period: '2026-13', today })).toThrow(ReturnMarkInputError);
    expect(() => validateReturnMarkInput({ period: '2026-09', arn: 'bad-arn', today })).toThrow(/ARN/);
    expect(() => validateReturnMarkInput({ return_type: 'GSTR1', period: '2026-09', today })).toThrow(/GSTR3B/);
  });
});

describe('critical alert email', () => {
  it('escapes content and links to the alerts page', () => {
    const mail = buildComplianceEmail(
      'Sharma & Sons <Pvt>',
      [{ title: 'Reverse ₹1,800 ITC', message: 'Bills unpaid > 180 days', legalRef: 'CGST Rules, Rule 37' }],
      'https://staging.khatario.com/',
    );
    expect(mail.subject).toBe('[Khatario] GST action needed: Reverse ₹1,800 ITC');
    expect(mail.html).toContain('Sharma &amp; Sons &lt;Pvt&gt;');
    expect(mail.html).toContain('Bills unpaid &gt; 180 days');
    expect(mail.html).toContain('https://staging.khatario.com/reports/gst/compliance');
    expect(mail.text).toContain('(CGST Rules, Rule 37)');
    const item = { title: 'T', message: 'M', legalRef: 'L' };
    expect(buildComplianceEmail('X', [item, item], 'https://a.b').subject).toBe('[Khatario] 2 GST items need action');
  });
});

describe('shouldNotify', () => {
  const f = rule37Findings([bill({ days: 160, status: 'approaching' })], '2026-06-10')[0];

  it('notifies new, reopened and escalated alerts but never the same stage twice', () => {
    expect(shouldNotify(null, f)).toBe(true);
    expect(shouldNotify({ notified_stage: '30d', resolved_at: null }, f)).toBe(false);
    expect(shouldNotify({ notified_stage: '30d', resolved_at: '2026-06-01' }, f)).toBe(true);
    expect(shouldNotify({ notified_stage: null, resolved_at: null }, f)).toBe(true);
    expect(shouldNotify({ notified_stage: '60d', resolved_at: null }, f)).toBe(true);
  });
});
