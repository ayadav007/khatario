/**
 * A reconciliation decision stays on the row whose identity did not change.
 * It is not copied onto an amended document. The previous row remains the audit history.
 */

export type ItcDecision =
  | 'PENDING_SUPPLIER_CORRECTION'
  | 'ITC_ELIGIBLE_THIS_PERIOD'
  | 'ITC_DEFERRED_TO_FUTURE'
  | 'ITC_NOT_ELIGIBLE'
  | 'IGNORE';

export interface DecisionIdentity {
  supplierGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  documentType: string;
  taxHeads: { igst: number; cgst: number; sgst: number; cess: number };
  itcEligible: boolean;
  filingPeriod: string;
  matchStatus: string;
}

export type Retention =
  | { action: 'retain'; reason: 'unchanged' }
  | { action: 'not_copied'; reason: 'amendment' | 'tax' | 'eligibility' | 'period' | 'ambiguous' | 'hold' };

const HEADS = ['igst', 'cgst', 'sgst', 'cess'] as const;

function sameTax(a: DecisionIdentity, b: DecisionIdentity): boolean {
  return HEADS.every((h) => Math.abs(a.taxHeads[h] - b.taxHeads[h]) < 0.005);
}

function sameIdentity(a: DecisionIdentity, b: DecisionIdentity): boolean {
  return (
    a.supplierGstin.trim().toUpperCase() === b.supplierGstin.trim().toUpperCase() &&
    a.invoiceNumber.trim().toUpperCase() === b.invoiceNumber.trim().toUpperCase() &&
    a.invoiceDate.slice(0, 10) === b.invoiceDate.slice(0, 10) &&
    a.documentType === b.documentType &&
    a.filingPeriod === b.filingPeriod &&
    a.itcEligible === b.itcEligible &&
    sameTax(a, b)
  );
}

export function retainDecision(input: {
  decision: ItcDecision;
  before: DecisionIdentity;
  after: DecisionIdentity;
  candidateCount: number;
}): Retention {
  if (input.candidateCount !== 1) return { action: 'not_copied', reason: 'ambiguous' };
  const { before, after, decision } = input;
  if (before.supplierGstin !== after.supplierGstin || before.invoiceNumber !== after.invoiceNumber) {
    return { action: 'not_copied', reason: 'amendment' };
  }
  if (!sameTax(before, after)) return { action: 'not_copied', reason: 'tax' };
  if (before.itcEligible !== after.itcEligible || after.matchStatus === 'NOT_ELIGIBLE') {
    return { action: 'not_copied', reason: 'eligibility' };
  }
  if (before.filingPeriod !== after.filingPeriod) return { action: 'not_copied', reason: 'period' };
  if (!sameIdentity(before, after)) return { action: 'not_copied', reason: 'amendment' };
  if (
    decision === 'ITC_ELIGIBLE_THIS_PERIOD' &&
    (after.matchStatus === 'MISSING_IN_2B' || after.matchStatus === 'NOT_ELIGIBLE')
  ) {
    return { action: 'not_copied', reason: 'hold' };
  }
  return { action: 'retain', reason: 'unchanged' };
}

export interface StoredReconciliationDecision {
  reconciliationId: string;
  supplierGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  documentType: string;
  filingPeriod: string;
  matchStatus: string;
  itcEligibility: string | null;
  books: { igst: number; cgst: number; sgst: number; cess: number };
  portal: { igst: number; cgst: number; sgst: number; cess: number };
  decision: ItcDecision;
  decisionDate: string;
  decidedByUserId: string;
  remarks: string | null;
  eligibleItcAmount: number | null;
  deferredToPeriod: string | null;
}

export interface IncomingReconciliation {
  supplier_gstin: string;
  invoice_number: string;
  invoice_date: string | Date;
  document_type: string;
  match_status: string;
  filing_period?: string;
  gstr2b_itc_eligibility: string | null;
  books_igst: number;
  books_cgst: number;
  books_sgst: number;
  books_cess: number;
  gstr2b_igst: number;
  gstr2b_cgst: number;
  gstr2b_sgst: number;
  gstr2b_cess: number;
}

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

function num(value: unknown): number {
  return parseFloat(String(value ?? 0)) || 0;
}

function day(value: string | Date): string {
  if (value instanceof Date) {
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function reconKey(gstin: string, invoiceNumber: string, invoiceDate: string, documentType: string): string {
  return [gstin, invoiceNumber, invoiceDate.slice(0, 10), documentType || 'invoice'].join('|');
}

function portalEligible(matchStatus: string, eligibility: string | null): boolean {
  if (matchStatus === 'NOT_ELIGIBLE') return false;
  const value = (eligibility || '').trim().toLowerCase();
  return value !== 'no' && value !== 'n' && value !== 'ineligible';
}

function headsClose(
  a: { igst: number; cgst: number; sgst: number; cess: number },
  b: { igst: number; cgst: number; sgst: number; cess: number }
): boolean {
  return HEADS.every((h) => Math.abs(a[h] - b[h]) < 0.005);
}

function identityOf(row: {
  supplierGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  documentType: string;
  filingPeriod: string;
  matchStatus: string;
  itcEligibility: string | null;
  books: { igst: number; cgst: number; sgst: number; cess: number };
}): DecisionIdentity {
  return {
    supplierGstin: row.supplierGstin,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    documentType: row.documentType || 'invoice',
    taxHeads: row.books,
    itcEligible: portalEligible(row.matchStatus, row.itcEligibility),
    filingPeriod: row.filingPeriod,
    matchStatus: row.matchStatus,
  };
}

/**
 * Writes the current decision into reconciliation_decision_history and removes it from the
 * live row when retainDecision says it must not stay on the new match.
 * A decision whose invoice identity is absent from this import is left on its own row.
 */
export async function applyStoredDecisionRetention(
  client: Queryable,
  businessId: string,
  filingPeriod: string,
  matches: IncomingReconciliation[]
): Promise<void> {
  const existing = await client.query(
    `SELECT r.id, r.supplier_gstin, r.invoice_number, to_char(r.invoice_date, 'YYYY-MM-DD') AS invoice_date,
            r.document_type, r.filing_period, r.match_status, r.gstr2b_itc_eligibility,
            r.books_igst, r.books_cgst, r.books_sgst, r.books_cess,
            r.gstr2b_igst, r.gstr2b_cgst, r.gstr2b_sgst, r.gstr2b_cess,
            d.decision, d.decision_date, d.decided_by_user_id, d.remarks,
            d.eligible_itc_amount, d.deferred_to_period
       FROM gstr2b_reconciliation r
       JOIN reconciliation_decisions d ON d.reconciliation_id = r.id
      WHERE r.business_id = $1 AND r.filing_period = $2`,
    [businessId, filingPeriod]
  );

  const byKey = new Map<string, IncomingReconciliation[]>();
  for (const match of matches) {
    const key = reconKey(match.supplier_gstin, match.invoice_number, day(match.invoice_date), match.document_type);
    const list = byKey.get(key) ?? [];
    list.push(match);
    byKey.set(key, list);
  }

  for (const row of existing.rows) {
    const before: StoredReconciliationDecision = {
      reconciliationId: row.id,
      supplierGstin: row.supplier_gstin,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date,
      documentType: row.document_type || 'invoice',
      filingPeriod: row.filing_period,
      matchStatus: row.match_status,
      itcEligibility: row.gstr2b_itc_eligibility,
      books: {
        igst: num(row.books_igst),
        cgst: num(row.books_cgst),
        sgst: num(row.books_sgst),
        cess: num(row.books_cess),
      },
      portal: {
        igst: num(row.gstr2b_igst),
        cgst: num(row.gstr2b_cgst),
        sgst: num(row.gstr2b_sgst),
        cess: num(row.gstr2b_cess),
      },
      decision: row.decision,
      decisionDate: row.decision_date,
      decidedByUserId: row.decided_by_user_id,
      remarks: row.remarks,
      eligibleItcAmount: row.eligible_itc_amount == null ? null : num(row.eligible_itc_amount),
      deferredToPeriod: row.deferred_to_period,
    };
    const key = reconKey(before.supplierGstin, before.invoiceNumber, before.invoiceDate, before.documentType);
    const candidates = byKey.get(key) ?? [];
    if (candidates.length === 0) continue;

    const match = candidates[0];
    const afterBooks = {
      igst: num(match.books_igst),
      cgst: num(match.books_cgst),
      sgst: num(match.books_sgst),
      cess: num(match.books_cess),
    };
    const afterPortal = {
      igst: num(match.gstr2b_igst),
      cgst: num(match.gstr2b_cgst),
      sgst: num(match.gstr2b_sgst),
      cess: num(match.gstr2b_cess),
    };
    const after = identityOf({
      supplierGstin: match.supplier_gstin,
      invoiceNumber: match.invoice_number,
      invoiceDate: day(match.invoice_date),
      documentType: match.document_type,
      filingPeriod: match.filing_period || filingPeriod,
      matchStatus: match.match_status,
      itcEligibility: match.gstr2b_itc_eligibility,
      books: afterBooks,
    });
    const retention = headsClose(before.portal, afterPortal)
      ? retainDecision({
          decision: before.decision,
          before: identityOf(before),
          after,
          candidateCount: candidates.length,
        })
      : { action: 'not_copied' as const, reason: 'tax' as const };
    if (retention.action === 'retain') continue;

    await client.query(
      `INSERT INTO reconciliation_decision_history (
         reconciliation_id, business_id, decision, decision_date, decided_by_user_id,
         remarks, eligible_itc_amount, deferred_to_period,
         supplier_gstin, invoice_number, invoice_date, document_type, filing_period,
         books_igst, books_cgst, books_sgst, books_cess, match_status, retention_reason
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11::date, $12, $13, $14, $15, $16, $17, $18, $19
       )`,
      [
        before.reconciliationId,
        businessId,
        before.decision,
        before.decisionDate,
        before.decidedByUserId,
        before.remarks,
        before.eligibleItcAmount,
        before.deferredToPeriod,
        before.supplierGstin,
        before.invoiceNumber,
        before.invoiceDate,
        before.documentType,
        before.filingPeriod,
        before.books.igst,
        before.books.cgst,
        before.books.sgst,
        before.books.cess,
        before.matchStatus,
        retention.reason,
      ]
    );
    await client.query(`DELETE FROM reconciliation_decisions WHERE reconciliation_id = $1`, [
      before.reconciliationId,
    ]);
  }
}
