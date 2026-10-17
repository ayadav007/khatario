import { buildItcGate, type ItcGateRow } from '@/lib/gst/itc-2b-gate';
import { reconcileAcknowledgements, type StoredAcknowledgement } from '@/lib/gst/acknowledgements';
import { financialYearsToStale, annualReadinessIsCurrent } from '@/lib/gst/period-freshness';
import { rule47aResult } from '@/lib/gst/rule47a';
import { matchRcmRules, type RcmRule } from '@/lib/gst/rcm-rules';
import { retainDecision, type DecisionIdentity, type ItcDecision } from '@/lib/gst/decision-retention';
import { countPendingItc, rowIsPending } from '@/lib/gst/pending-itc';
import { assessDownload, gstr1BlockingIssues } from '@/lib/gst/return-readiness';
import { issuesFromHeadComparison, type HeadWiseComparison } from '@/lib/gst/reconciliation-ack-issues';
import { invoiceReadinessSpan, rejectDocumentDateChange } from '@/lib/gst/document-dates';
import { PUT as rejectCreditNoteDate } from '@/app/api/credit-notes/[id]/route';
import { PUT as rejectDebitNoteDate } from '@/app/api/debit-notes/[id]/route';

const heads = { igst: 100, cgst: 0, sgst: 0, cess: 0 };

function row(partial: Partial<ItcGateRow>): ItcGateRow {
  return {
    purchase_id: 'p1',
    filing_period: '2026-04',
    match_status: 'MATCHED',
    decision: null,
    deferred_to_period: null,
    supplier_gstin: '27AAPFU0939F1ZV',
    invoice_number: 'B1',
    is_import_goods: false,
    is_import_services: false,
    books: heads,
    gstr2b: heads,
    ...partial,
  };
}

const identity = (partial: Partial<DecisionIdentity> = {}): DecisionIdentity => ({
  supplierGstin: '27AAPFU0939F1ZV',
  invoiceNumber: 'B1',
  invoiceDate: '2026-04-02',
  documentType: 'invoice',
  taxHeads: heads,
  itcEligible: true,
  filingPeriod: '2026-04',
  matchStatus: 'MATCHED',
  ...partial,
});

describe('financial year boundary', () => {
  it('marks both years when a purchase invoice moves across the boundary, either way', () => {
    expect(financialYearsToStale({ from: '2025-09-15', to: '2026-05-02' })).toEqual(['2025-26', '2026-27']);
    expect(financialYearsToStale({ from: '2026-05-02', to: '2025-09-15' })).toEqual(['2025-26', '2026-27']);
  });

  it('marks both years when a credit note moves across the boundary, either way', () => {
    expect(financialYearsToStale({ from: '2026-03-31', to: '2026-04-01' })).toEqual(['2025-26', '2026-27']);
    expect(financialYearsToStale({ from: '2026-04-01', to: '2026-03-31' })).toEqual(['2025-26', '2026-27']);
  });

  it('keeps a same-year edit, a deletion, and a next-year edit on the years they touch', () => {
    expect(financialYearsToStale({ from: '2025-09-01', to: '2026-01-15' })).toEqual(['2025-26']);
    expect(financialYearsToStale({ dates: ['2025-09-01'] })).toEqual(['2025-26']);
    expect(financialYearsToStale({ dates: ['2026-05-01'] })).toEqual(['2026-27']);
  });

  it('does not call an annual return current after the year changed', () => {
    expect(annualReadinessIsCurrent({ state: 'stale', reconciledAt: '2026-05-01T00:00:00Z', changedAt: '2026-05-02T00:00:00Z' })).toBe(false);
    expect(annualReadinessIsCurrent({ state: 'ready', reconciledAt: '2026-05-03T00:00:00Z', changedAt: '2026-05-02T00:00:00Z' })).toBe(true);
  });
});

describe('acknowledgement scope', () => {
  const ack = (partial: Partial<StoredAcknowledgement>): StoredAcknowledgement => ({
    id: 'a1',
    issueKey: 'head:igst',
    snapshotId: 'snap-1',
    facts: { kind: 'head_difference' },
    amounts: { igst: 500, cgst: 0, sgst: 0, cess: 0 },
    userId: 'user-1',
    acknowledgedAt: '2026-05-01T00:00:00Z',
    invalidatedAt: null,
    ...partial,
  });

  it('keeps an unaffected issue when the snapshot changes and drops only the changed issue', () => {
    const result = reconcileAcknowledgements(
      [ack({}), ack({ id: 'a2', issueKey: 'head:cgst', amounts: { igst: 0, cgst: 20, sgst: 0, cess: 0 } })],
      [
        { key: 'head:igst', facts: { kind: 'head_difference' }, amounts: { igst: 800, cgst: 0, sgst: 0, cess: 0 } },
        { key: 'head:cgst', facts: { kind: 'head_difference' }, amounts: { igst: 0, cgst: 20, sgst: 0, cess: 0 } },
      ]
    );
    expect(result.invalidated.map((row) => row.issueKey)).toEqual(['head:igst']);
    expect(result.stillValid.map((row) => row.issueKey)).toEqual(['head:cgst']);
    expect(result.needsAcknowledgement.map((row) => row.key)).toEqual(['head:igst']);
    expect(result.invalidated[0].userId).toBe('user-1');
    expect(result.invalidated[0].acknowledgedAt).toBe('2026-05-01T00:00:00Z');
  });

  it('does not treat a new snapshot id as a change when the issue facts and amounts are the same', () => {
    const result = reconcileAcknowledgements(
      [ack({ snapshotId: 'snap-1' })],
      [{ key: 'head:igst', facts: { kind: 'head_difference' }, amounts: { igst: 500, cgst: 0, sgst: 0, cess: 0 } }]
    );
    expect(result.stillValid).toHaveLength(1);
    expect(result.needsAcknowledgement).toHaveLength(0);
    expect(result.invalidated).toHaveLength(0);
  });
});

describe('Rule 47A supplier status', () => {
  const supply = {
    id: '1',
    document: 'purchase' as const,
    number: 'B',
    supplierName: 'A',
    tax: 18,
    reverseCharge: true,
    registrationStatus: 'unregistered' as const,
    supplyReceivedOn: '2024-11-02',
  };

  it('calculates receipt plus 30 only when status and the rule are established', () => {
    expect(rule47aResult(supply)).toEqual({ kind: 'deadline', due: '2024-12-02' });
    expect(rule47aResult({ ...supply, document: 'expense' }).kind).toBe('deadline');
  });

  it('leaves unknown, registered, and missing receipt unverified or without a date', () => {
    expect(rule47aResult({ ...supply, registrationStatus: 'unknown' }).kind).toBe('unverified');
    expect(rule47aResult({ ...supply, registrationStatus: 'registered' }).kind).toBe('not_applicable');
    expect(rule47aResult({ ...supply, supplyReceivedOn: null }).kind).toBe('unverified');
    expect(rule47aResult({ ...supply, reverseCharge: false }).kind).toBe('unverified');
  });
});

describe('ITC gate and decision retention', () => {
  it('holds books ITC when a missing 2B row was accepted', () => {
    const gate = buildItcGate(
      [row({ match_status: 'MISSING_IN_2B', decision: 'ITC_ELIGIBLE_THIS_PERIOD', gstr2b: { igst: 0, cgst: 0, sgst: 0, cess: 0 } })],
      '2026-04',
      true
    );
    expect(gate.held.igst).toBe(100);
    expect(gate.held_bills[0].reason).toBe('OVERRIDE_WITHOUT_2B');
  });

  it('holds only the excess on a matched row', () => {
    const gate = buildItcGate(
      [row({ gstr2b: { igst: 40, cgst: 0, sgst: 0, cess: 0 }, decision: 'ITC_ELIGIBLE_THIS_PERIOD' })],
      '2026-04',
      true
    );
    expect(gate.held.igst).toBe(60);
  });

  it.each([
    'IGNORE',
    'ITC_NOT_ELIGIBLE',
    'PENDING_SUPPLIER_CORRECTION',
    'ITC_DEFERRED_TO_FUTURE',
    'ITC_ELIGIBLE_THIS_PERIOD',
  ] as ItcDecision[])('does not copy %s onto a changed invoice', (decision) => {
    expect(retainDecision({ decision, before: identity(), after: identity({ invoiceNumber: 'B2' }), candidateCount: 1 }).action).toBe('not_copied');
    expect(retainDecision({ decision, before: identity(), after: identity({ taxHeads: { ...heads, igst: 50 } }), candidateCount: 1 }).action).toBe('not_copied');
    expect(retainDecision({ decision, before: identity(), after: identity({ itcEligible: false }), candidateCount: 1 }).action).toBe('not_copied');
    expect(retainDecision({ decision, before: identity(), after: identity({ filingPeriod: '2026-05' }), candidateCount: 1 }).action).toBe('not_copied');
    expect(retainDecision({ decision, before: identity(), after: identity(), candidateCount: 2 }).action).toBe('not_copied');
  });

  it('retains an unchanged re-import except a missing-2B acceptance', () => {
    expect(retainDecision({ decision: 'IGNORE', before: identity(), after: identity(), candidateCount: 1 }).action).toBe('retain');
    expect(
      retainDecision({
        decision: 'ITC_ELIGIBLE_THIS_PERIOD',
        before: identity({ matchStatus: 'MISSING_IN_2B' }),
        after: identity({ matchStatus: 'MISSING_IN_2B' }),
        candidateCount: 1,
      }).action
    ).toBe('not_copied');
  });
});

describe('pending count and RCM catalogue', () => {
  const open = '2026-04';
  it('counts unresolved rows and withholds a number when data is missing or stale', () => {
    expect(rowIsPending({ matchStatus: 'MISSING_IN_2B', decision: 'PENDING_SUPPLIER_CORRECTION', deferredToPeriod: null, taxDifference: 10 }, open)).toBe(true);
    expect(rowIsPending({ matchStatus: 'MATCHED', decision: 'IGNORE', deferredToPeriod: null, taxDifference: 0 }, open)).toBe(false);
    expect(rowIsPending({ matchStatus: 'MATCHED', decision: 'ITC_ELIGIBLE_THIS_PERIOD', deferredToPeriod: null, taxDifference: 0 }, open)).toBe(false);
    expect(rowIsPending({ matchStatus: 'MISSING_IN_2B', decision: 'ITC_ELIGIBLE_THIS_PERIOD', deferredToPeriod: null, taxDifference: 10 }, open)).toBe(true);
    expect(rowIsPending({ matchStatus: 'MATCHED', decision: 'ITC_DEFERRED_TO_FUTURE', deferredToPeriod: '2026-05', taxDifference: 0 }, open)).toBe(false);
    expect(rowIsPending({ matchStatus: 'MATCHED', decision: 'ITC_DEFERRED_TO_FUTURE', deferredToPeriod: '2026-04', taxDifference: 0 }, open)).toBe(true);
    expect(countPendingItc({ imported: false, stale: false, openPeriod: open, rows: [] })).toEqual({ state: 'not_imported' });
    expect(countPendingItc({ imported: true, stale: true, openPeriod: open, rows: [] })).toEqual({ state: 'stale' });
  });

  it('says coverage is incomplete when no rules are loaded', () => {
    const facts = {
      billDate: '2026-04-01',
      registrationStatus: 'registered' as const,
      reverseCharge: false,
      sac: '996511',
      hsn: null,
      expenseCategory: null,
    };
    expect(matchRcmRules(facts, []).result).toBe('not_checked');
    const rule: RcmRule = {
      id: 'r',
      catalogueVersion: 1,
      effectiveFrom: '2024-11-01',
      effectiveTo: null,
      supplierType: 'registered',
      sacPrefix: '9965',
      hsnPrefix: null,
      expenseCategory: null,
      sourceCitation: 'Notification example',
      reviewOnly: true,
    };
    expect(matchRcmRules(facts, [rule]).result).toBe('suspected');
    expect(matchRcmRules({ ...facts, billDate: '2024-01-01' }, [rule]).result).toBe('not_checked');
  });
});

describe('download blocking', () => {
  it('blocks a B2B row that is missing an invoice number, date, or place of supply', () => {
    const issues = gstr1BlockingIssues([
      {
        id: 'inv-1',
        invoiceNumber: null,
        invoiceDate: '2026-04-02',
        placeOfSupply: '27',
        gstin: '27AAPFU0939F1ZV',
        included: true,
      },
    ]);
    expect(issues.some((issue) => issue.key === 'portal-field:inv-1')).toBe(true);
    expect(assessDownload({ blocking: issues, review: [], acknowledgements: [] }).blocked).toBe(true);
  });

  it('blocks an invalid GSTIN and asks for acknowledgement of a larger difference', () => {
    const blocked = assessDownload({
      blocking: [{ key: 'gstin:1', facts: { code: 'CHECKSUM' }, amounts: { igst: 0, cgst: 0, sgst: 0, cess: 0 } }],
      review: [],
      acknowledgements: [],
    });
    expect(blocked.blocked).toBe(true);
    const review = assessDownload({
      blocking: [],
      review: [{ key: 'head:igst', facts: { kind: 'head_difference' }, amounts: { igst: 500, cgst: 0, sgst: 0, cess: 0 } }],
      acknowledgements: [],
    });
    expect(review.blocked).toBe(false);
    expect(review.needsAcknowledgement).toHaveLength(1);
  });
});

function comparison(igstDifference: number, cgstDifference = 0): HeadWiseComparison {
  return {
    igst: { gstr1: 500 + igstDifference, gstr3b: 500, difference: igstDifference },
    cgst: { gstr1: cgstDifference, gstr3b: 0, difference: cgstDifference },
    sgst: { gstr1: 0, gstr3b: 0, difference: 0 },
    cess: { gstr1: 0, gstr3b: 0, difference: 0 },
  };
}

describe('GSTR-1 versus books acknowledgements', () => {
  const branch = 'branch-1';

  it('requires acknowledgement for a ₹500 head difference and ignores ₹1 rounding', () => {
    const fiveHundred = issuesFromHeadComparison({
      period: '2026-04',
      branchId: branch,
      headWise: comparison(500),
    });
    expect(fiveHundred).toHaveLength(1);
    expect(fiveHundred[0].key).toBe('head:2026-04:branch-1:igst');
    expect(fiveHundred[0].amounts.igst).toBe(500);
    expect(fiveHundred[0].facts.books).toBe(500);
    expect(
      issuesFromHeadComparison({ period: '2026-04', branchId: branch, headWise: comparison(1) })
    ).toEqual([]);
    const assessed = assessDownload({ blocking: [], review: fiveHundred, acknowledgements: [] });
    expect(assessed.blocked).toBe(false);
    expect(assessed.needsAcknowledgement).toEqual(fiveHundred);
  });

  it('keeps an acknowledgement when the same reconciliation is repeated and drops only the changed head', () => {
    const first = issuesFromHeadComparison({
      period: '2026-04',
      branchId: branch,
      headWise: comparison(500, 20),
    });
    const stored: StoredAcknowledgement[] = first.map((issue, index) => ({
      id: `ack-${index}`,
      issueKey: issue.key,
      snapshotId: 'run-1',
      facts: issue.facts,
      amounts: issue.amounts,
      userId: 'user-1',
      acknowledgedAt: '2026-04-20T10:00:00.000Z',
      invalidatedAt: null,
    }));
    const repeated = issuesFromHeadComparison({
      period: '2026-04',
      branchId: branch,
      headWise: comparison(500, 20),
    });
    const same = reconcileAcknowledgements(stored, repeated);
    expect(same.needsAcknowledgement).toEqual([]);
    expect(same.invalidated).toEqual([]);
    expect(same.stillValid.map((ack) => ack.userId)).toEqual(['user-1', 'user-1']);

    const changed = issuesFromHeadComparison({
      period: '2026-04',
      branchId: branch,
      headWise: comparison(800, 20),
    });
    const next = reconcileAcknowledgements(stored, changed);
    expect(next.invalidated.map((ack) => ack.issueKey)).toEqual(['head:2026-04:branch-1:igst']);
    expect(next.stillValid.map((ack) => ack.issueKey)).toEqual(['head:2026-04:branch-1:cgst']);
    expect(next.needsAcknowledgement.map((issue) => issue.amounts.igst)).toEqual([800]);
    expect(next.invalidated[0].acknowledgedAt).toBe('2026-04-20T10:00:00.000Z');
  });
});

describe('document dates', () => {
  it('marks both financial years when a final invoice date crosses 31 March', () => {
    const forward = invoiceReadinessSpan({
      priorStatus: 'final',
      priorDate: '2026-03-31',
      nextStatus: 'final',
      nextDate: '2026-04-01',
    });
    expect(financialYearsToStale(forward!)).toEqual(['2025-26', '2026-27']);
    const back = invoiceReadinessSpan({
      priorStatus: 'final',
      priorDate: '2026-05-02',
      nextStatus: 'final',
      nextDate: '2025-09-15',
    });
    expect(financialYearsToStale(back!)).toEqual(['2025-26', '2026-27']);
    expect(
      invoiceReadinessSpan({
        priorStatus: 'draft',
        priorDate: '2026-03-31',
        nextStatus: 'final',
        nextDate: '2026-04-01',
      })?.from
    ).toBeNull();
  });

  it('rejects a purchase, credit-note or debit-note date change', async () => {
    const purchase = await rejectDocumentDateChange('purchase');
    expect(purchase.status).toBe(405);
    expect((await purchase.json()).code).toBe('DOCUMENT_DATE_IMMUTABLE');
    for (const reject of [rejectCreditNoteDate, rejectDebitNoteDate]) {
      const response = await reject();
      expect(response.status).toBe(405);
      expect((await response.json()).code).toBe('DOCUMENT_DATE_IMMUTABLE');
    }
  });
});
