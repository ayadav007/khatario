/**
 * ITC gate from the GSTR-2B reconciliation (s.16(2)(aa) CGST Act, Rule 36(4)).
 *
 * A bill's credit may be taken only when the supplier's details appear in the recipient's GSTR-2B.
 * The books post ITC on the bill date; this works out, per GSTR-3B period, how much of that books
 * ITC 2B does not support yet (held), and how much held earlier is now supported (released).
 *
 * Per bill, in the period of its first reconciliation row (the bill's month):
 * - MISSING_IN_2B, NOT_ELIGIBLE (2B says ineligible) or a blocking decision → all its ITC is held.
 * - MATCHED / PARTIALLY_MATCHED → only tax above what 2B shows, head by head, is held.
 * - A decision ITC_ELIGIBLE_THIS_PERIOD overrides all of the above (user accepts the claim).
 * Held ITC is released in the earliest of: the period a decision defers it to, or a later period
 * whose reconciliation finds it in 2B. ITC_NOT_ELIGIBLE / IGNORE never release.
 * Imports and bills without a supplier GSTIN (unregistered RCM) do not depend on 2B, and blocked
 * credit (s.17(5)) never reaches the input ledger, so none of these is held.
 */

export interface ItcHeads {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface ItcGateRow {
  purchase_id: string;
  filing_period: string;
  match_status: string;
  decision: string | null;
  deferred_to_period: string | null;
  supplier_gstin: string | null;
  invoice_number: string;
  is_import_goods: boolean;
  is_import_services: boolean;
  /** Books block the credit (purchases.itc_eligible = false). */
  blocked?: boolean;
  books: ItcHeads;
  gstr2b: ItcHeads;
}

export interface HeldBill {
  purchase_id: string;
  invoice_number: string;
  supplier_gstin: string;
  period: string;
  reason: string;
  release_period: string | null;
  itc: ItcHeads;
}

export interface ItcGate {
  /** A GSTR-2B reconciliation has been run for the period. */
  reconciled: boolean;
  /** Books ITC of this period's bills that GSTR-2B does not support (left out of 4A(5)). */
  held: ItcHeads;
  /** ITC held in an earlier period and supported from this period (added to 4A(5)). */
  released: ItcHeads;
  /** ITC held in earlier periods and still not released when this period starts. */
  held_before: ItcHeads;
  held_bills: HeldBill[];
}

const BLOCKING = new Set(['ITC_DEFERRED_TO_FUTURE', 'ITC_NOT_ELIGIBLE', 'PENDING_SUPPLIER_CORRECTION', 'IGNORE']);
const NEVER = new Set(['ITC_NOT_ELIGIBLE', 'IGNORE']);
const HEADS = ['igst', 'cgst', 'sgst', 'cess'] as const;

const zero = (): ItcHeads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const add = (t: ItcHeads, v: ItcHeads) => {
  for (const h of HEADS) t[h] = r2(t[h] + v[h]);
};

export function buildItcGate(rows: ItcGateRow[], period: string, reconciled: boolean): ItcGate {
  const gate: ItcGate = { reconciled, held: zero(), released: zero(), held_before: zero(), held_bills: [] };
  const byBill = new Map<string, ItcGateRow[]>();
  for (const r of rows) {
    if (!byBill.has(r.purchase_id)) byBill.set(r.purchase_id, []);
    byBill.get(r.purchase_id)!.push(r);
  }

  for (const list of byBill.values()) {
    list.sort((a, b) => a.filing_period.localeCompare(b.filing_period));
    const first = list[0];
    if (first.is_import_goods || first.is_import_services || first.blocked || !String(first.supplier_gstin || '').trim()) continue;
    if (first.decision === 'ITC_ELIGIBLE_THIS_PERIOD') continue;

    let itc: ItcHeads;
    let reason: string;
    if (BLOCKING.has(first.decision ?? '')) {
      itc = { ...first.books };
      reason = first.decision!;
    } else if (first.match_status === 'MISSING_IN_2B' || first.match_status === 'NOT_ELIGIBLE') {
      itc = { ...first.books };
      reason = first.match_status;
    } else {
      itc = zero();
      for (const h of HEADS) itc[h] = r2(Math.max(0, first.books[h] - first.gstr2b[h]));
      reason = 'TAX_ABOVE_2B';
    }
    if (HEADS.every((h) => Math.abs(itc[h]) < 0.005)) continue;

    let release: string | null = null;
    if (!list.some((r) => NEVER.has(r.decision ?? ''))) {
      const candidates: string[] = [];
      for (const r of list) {
        if (r.decision === 'ITC_DEFERRED_TO_FUTURE' && r.deferred_to_period && r.deferred_to_period > first.filing_period) {
          candidates.push(r.deferred_to_period);
        }
        if (r.filing_period > first.filing_period && !BLOCKING.has(r.decision ?? '') &&
            (r.match_status === 'MATCHED' || r.match_status === 'PARTIALLY_MATCHED' || r.decision === 'ITC_ELIGIBLE_THIS_PERIOD')) {
          candidates.push(r.filing_period);
        }
      }
      release = candidates.sort()[0] ?? null;
    }

    if (first.filing_period === period) {
      add(gate.held, itc);
      gate.held_bills.push({
        purchase_id: first.purchase_id,
        invoice_number: first.invoice_number,
        supplier_gstin: String(first.supplier_gstin),
        period: first.filing_period,
        reason,
        release_period: release,
        itc,
      });
    } else if (first.filing_period < period) {
      if (release === period) add(gate.released, itc);
      else if (release === null || release > period) add(gate.held_before, itc);
    }
  }
  return gate;
}

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export async function loadItcGate(
  db: Queryable,
  businessId: string,
  period: string,
  branchIds: string[] | null
): Promise<ItcGate> {
  const [rows, ran] = await Promise.all([
    db.query(
      `SELECT r.purchase_id, r.filing_period, r.match_status, rd.decision, rd.deferred_to_period,
              r.supplier_gstin, r.invoice_number, r.is_import_goods, r.is_import_services,
              r.books_igst, r.books_cgst, r.books_sgst, r.books_cess,
              r.gstr2b_igst, r.gstr2b_cgst, r.gstr2b_sgst, r.gstr2b_cess,
              (p.itc_eligible = false) AS blocked
         FROM gstr2b_reconciliation r
         JOIN purchases p ON p.id = r.purchase_id AND p.deleted_at IS NULL
         LEFT JOIN reconciliation_decisions rd ON rd.reconciliation_id = r.id
        WHERE r.business_id = $1 AND r.filing_period <= $2
          AND ($3::uuid[] IS NULL OR p.branch_id = ANY($3::uuid[]))`,
      [businessId, period, branchIds]
    ),
    db.query(`SELECT EXISTS (SELECT 1 FROM gstr2b_reconciliation WHERE business_id = $1 AND filing_period = $2) AS ran`, [
      businessId,
      period,
    ]),
  ]);
  const n = (v: unknown) => Number(v) || 0;
  return buildItcGate(
    rows.rows.map((r) => ({
      purchase_id: String(r.purchase_id),
      filing_period: String(r.filing_period),
      match_status: String(r.match_status),
      decision: r.decision ?? null,
      deferred_to_period: r.deferred_to_period ?? null,
      supplier_gstin: r.supplier_gstin ?? null,
      invoice_number: String(r.invoice_number),
      is_import_goods: r.is_import_goods === true,
      is_import_services: r.is_import_services === true,
      blocked: r.blocked === true,
      books: { igst: n(r.books_igst), cgst: n(r.books_cgst), sgst: n(r.books_sgst), cess: n(r.books_cess) },
      gstr2b: { igst: n(r.gstr2b_igst), cgst: n(r.gstr2b_cgst), sgst: n(r.gstr2b_sgst), cess: n(r.gstr2b_cess) },
    })),
    period,
    ran.rows[0]?.ran === true
  );
}
