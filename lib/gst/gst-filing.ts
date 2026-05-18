import { getPool, queryOne, queryRows } from '@/lib/db';
import {
  GSTR3BGenerator,
  type GSTR3BData,
  type GSTR3BReconciliation,
  type TaxBreakdown,
} from '@/lib/gst/gstr3b';
import type { GSTR3BLedgerBasis } from '@/lib/gst/gstr3b-ledger';
import { round2 } from '@/lib/gst/gstr3b-ledger';
import { calendarMonthBounds, lockGstPeriod } from '@/lib/gst/gst-period-lock';
import { getOutstandingGst, gstSetoffExistsForPeriod } from '@/lib/gst/gst-settlement';
import { computeGstChargesFull } from '@/lib/gst/gst-charges-compute';
import {
  gstr3bDueDateIso,
  isLikelyNilGstr3BReturn,
  lateFilingWarningMessage,
  toIsoDateOnly,
  type Gstr3BDueDateOptions,
  type Gstr3BFilingFrequency,
} from '@/lib/gst/gst-interest';
import {
  loadGstFilingOrgDefaults,
  mergeGstDueDateOptions,
  type GstDueDateRuleSource,
} from '@/lib/gst/gst-org-filing';

export type GstFilingStatus = 'draft' | 'filed' | 'revised';

/** Persisted with each filing/re-file for audit (see migration 192). */
export interface GstChargesSnapshotV1 {
  schema_version: 1;
  /** Whether due-date cadence came from org settings or explicit request fields. */
  rule_source: GstDueDateRuleSource;
  due_date: string;
  filing_date: string;
  payment_date_used: string;
  cash_liability_after_itc: number;
  interest_days: number;
  days_delayed_filing: number;
  is_nil_return: boolean;
  interest_amount: number;
  late_fee: number;
  filing_frequency: Gstr3BFilingFrequency;
  qrmp_due_day?: 22 | 24;
}

/** Persisted from segmented interest engine (ledger `gst_payment` + outstanding at due date). */
export interface GstChargesSnapshotV2 {
  version: 2;
  rule_source: GstDueDateRuleSource;
  due_date: string;
  filing_date: string;
  payment_date_used: string;
  /** Max(filing, payment, last ledger payment after due) used for segment tail — audit. */
  effective_interest_end_date: string;
  /** Cap date for ledger fetch and `effective_interest_end_date` (reproducible reports). */
  as_on_date: string;
  /** IANA zone for default “today” when computing `as_on_date` (IST). */
  as_on_calendar_timezone: string;
  cash_liability_initial: number;
  cash_liability_after_itc_3b: number;
  interest_total: number;
  late_fee: number;
  segmented: boolean;
  payment_events: { date: string; amount: number }[];
  segments: { from: string; to: string; base: number; days: number; interest: number }[];
  days_delayed_filing: number;
  is_nil_return: boolean;
  filing_frequency: Gstr3BFilingFrequency;
  qrmp_due_day?: 22 | 24;
  warnings?: string[];
}

/** JSON-serializable point-in-time GSTR-3B snapshot for audit (see `buildGstSnapshot`). */
export interface GstFilingSnapshot {
  generated_at: string;
  gst_period: string;
  branch_id: string;
  business_id: string;
  /** Full GSTR-3B generator output (JSON-safe clone). */
  gstr3b: unknown;
  ledger_basis: GSTR3BLedgerBasis;
  outward_supplies: { igst: number; cgst: number; sgst: number };
  itc: { igst: number; cgst: number; sgst: number };
  net_payable: GSTR3BLedgerBasis['net_payable'];
  gross_output_tax: TaxBreakdown;
  reconciliation: GSTR3BReconciliation;
}

export interface GstRevisionDelta {
  revised_at: string;
  /** Full snapshot as of last filed state before this revision (audit). */
  filed_snapshot: GstFilingSnapshot | null;
  previous_net_payable: { igst: number; cgst: number; sgst: number };
  revised_net_payable: { igst: number; cgst: number; sgst: number };
  difference: { igst: number; cgst: number; sgst: number };
}

export interface GstFilingRow {
  id: string;
  business_id: string;
  branch_id: string | null;
  gst_period: string;
  status: GstFilingStatus;
  filed_at: string | null;
  filed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  gst_snapshot?: GstFilingSnapshot | null;
  revision_delta?: GstRevisionDelta | null;
  interest_amount?: string | number | null;
  late_fee?: string | number | null;
  charges_snapshot?: GstChargesSnapshotV1 | GstChargesSnapshotV2 | null;
}

export interface GstFilingHistoryEntry {
  action: string;
  by: string | null;
  at: string;
  notes?: string | null;
}

export interface ValidateBeforeFilingParams {
  businessId: string;
  branchId: string;
  gstPeriod: string;
}

function assertPeriodFormat(gstPeriod: string): void {
  if (!/^\d{4}-\d{2}$/.test(gstPeriod.trim())) {
    throw new Error('gst_period must be YYYY-MM');
  }
}

function parseYearMonth(gstPeriod: string): { year: number; month: number } {
  const [y, m] = gstPeriod.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || m < 1 || m > 12) {
    throw new Error('Invalid gst_period');
  }
  return { year: y, month: m };
}

function criticalWarningsFromGstr3b(data: GSTR3BData): string[] {
  const out: string[] = [];
  if (data.reconciliation.status === 'mismatch') {
    out.push('GSTR-1 and ledger output tax (2150–2152) mismatch — reconcile returns vs books before filing.');
  }
  const rh = data.reconciliation_by_head;
  if (
    rh?.igst.status === 'mismatch' ||
    rh?.cgst.status === 'mismatch' ||
    rh?.sgst.status === 'mismatch' ||
    rh?.cess.status === 'mismatch'
  ) {
    out.push(
      'GSTR-1 vs ledger mismatch on one or more tax heads (IGST/CGST/SGST/CESS) — review reconciliation_by_head before filing.'
    );
  }
  for (const w of data.warnings) {
    if (
      w.includes('Negative output GST') ||
      w.includes('Significant mismatch') ||
      w.includes('RCM paid but no ITC') ||
      w.includes('net credits for the period') ||
      w.includes('duplicate RCM posting') ||
      w.includes('duplicate RCM')
    ) {
      out.push(w);
    }
  }
  return [...new Set(out)];
}

async function loadGstr3bForPeriod(
  businessId: string,
  branchId: string,
  gstPeriod: string
): Promise<GSTR3BData> {
  const { year, month } = parseYearMonth(gstPeriod);
  const gen = new GSTR3BGenerator();
  return gen.generate({
    business_id: businessId,
    month,
    year,
    branch_id: branchId,
  });
}

function jsonSafeGstr3bClone(data: GSTR3BData): GSTR3BData {
  return JSON.parse(JSON.stringify(data)) as GSTR3BData;
}

function cloneGstFilingSnapshot(snap: GstFilingSnapshot): GstFilingSnapshot {
  return JSON.parse(JSON.stringify(snap)) as GstFilingSnapshot;
}

/**
 * Immutable audit snapshot: deep-clones GSTR-3B so stored JSON does not reference live objects.
 */
export function buildGstSnapshot(
  gstr3b: GSTR3BData,
  ctx: { generatedAt: string; gstPeriod: string; branchId: string; businessId: string }
): GstFilingSnapshot {
  const safe = jsonSafeGstr3bClone(gstr3b);
  return {
    generated_at: ctx.generatedAt,
    gst_period: ctx.gstPeriod,
    branch_id: ctx.branchId,
    business_id: ctx.businessId,
    gstr3b: safe,
    ledger_basis: safe.ledger_basis,
    outward_supplies: safe.outward_supplies,
    itc: safe.itc,
    net_payable: safe.net_payable,
    gross_output_tax: safe.gross_output_tax,
    reconciliation: safe.reconciliation,
  };
}

export function netPayableTriple(
  snap: GstFilingSnapshot | null | undefined
): { igst: number; cgst: number; sgst: number } {
  if (!snap?.net_payable) {
    return { igst: 0, cgst: 0, sgst: 0 };
  }
  return {
    igst: round2(Number(snap.net_payable.igst)),
    cgst: round2(Number(snap.net_payable.cgst)),
    sgst: round2(Number(snap.net_payable.sgst)),
  };
}

export function diffNetPayable(
  current: { igst: number; cgst: number; sgst: number },
  filed: { igst: number; cgst: number; sgst: number }
): { igst: number; cgst: number; sgst: number } {
  return {
    igst: round2(current.igst - filed.igst),
    cgst: round2(current.cgst - filed.cgst),
    sgst: round2(current.sgst - filed.sgst),
  };
}

function hasMaterialNetPayableDiff(d: { igst: number; cgst: number; sgst: number }): boolean {
  return Math.abs(d.igst) >= 0.005 || Math.abs(d.cgst) >= 0.005 || Math.abs(d.sgst) >= 0.005;
}

/** Ledger/settlement preconditions (no GSTR-3B generation). */
export async function assertGstFilingLedgerPreconditions(
  params: ValidateBeforeFilingParams
): Promise<void> {
  const { businessId, branchId, gstPeriod } = params;
  assertPeriodFormat(gstPeriod);

  const setoffOk = await gstSetoffExistsForPeriod(businessId, branchId, gstPeriod);
  if (!setoffOk) {
    throw new Error('GST set-off not applied');
  }

  const { end: monthEnd } = calendarMonthBounds(gstPeriod);
  const outstanding = await getOutstandingGst({
    businessId,
    asOnDate: monthEnd,
    branchId,
  });
  const remaining = round2(outstanding.total_liability);
  if (remaining > 1) {
    throw new Error('GST payment pending');
  }
}

export interface ValidateBeforeFilingOptions {
  /** Defaults to UTC “today” (YYYY-MM-DD). */
  filingDateIso?: string;
  /** When set, receives non-blocking late-filing / late-fee exposure messages. */
  complianceWarnings?: string[];
  dueDateOptions?: Gstr3BDueDateOptions;
}

/**
 * Pre-flight checks before marking a GST return as filed.
 * Does not throw for late filing; pushes a **late fee** hint into `complianceWarnings` when applicable.
 */
export async function validateBeforeFiling(
  params: ValidateBeforeFilingParams,
  options?: ValidateBeforeFilingOptions
): Promise<void> {
  await assertGstFilingLedgerPreconditions(params);
  const { businessId, branchId, gstPeriod } = params;
  const gstr3b = await loadGstr3bForPeriod(businessId, branchId, gstPeriod);
  const critical = criticalWarningsFromGstr3b(gstr3b);
  if (critical.length > 0) {
    throw new Error(`Resolve warnings before filing: ${critical.join(' ')}`);
  }

  const orgDue = await loadGstFilingOrgDefaults(businessId);
  const dueOpts = options?.dueDateOptions ?? mergeGstDueDateOptions(orgDue);
  const fd = options?.filingDateIso ?? new Date().toISOString().slice(0, 10);
  const late = lateFilingWarningMessage(gstPeriod, fd, dueOpts);
  if (late && options?.complianceWarnings) {
    options.complianceWarnings.push(late);
  }
}

/** Effective filing row: prefers branch-specific row over business-wide (branch_id NULL). */
export async function getGstFilingForScope(
  businessId: string,
  branchId: string,
  gstPeriod: string
): Promise<GstFilingRow | null> {
  assertPeriodFormat(gstPeriod);
  return queryOne<GstFilingRow>(
    `
    SELECT *
    FROM gst_filings
    WHERE business_id = $1::uuid
      AND gst_period = $2
      AND (branch_id = $3::uuid OR branch_id IS NULL)
    ORDER BY (branch_id IS NOT NULL) DESC, updated_at DESC
    LIMIT 1
    `,
    [businessId, gstPeriod, branchId]
  );
}

export async function isGstPeriodFiled(
  businessId: string,
  branchId: string | null,
  gstPeriod: string
): Promise<boolean> {
  if (!branchId || !/^\d{4}-\d{2}$/.test(gstPeriod.trim())) {
    return false;
  }
  const row = await queryOne<{ id: string }>(
    `
    SELECT id
    FROM gst_filings
    WHERE business_id = $1::uuid
      AND gst_period = $2
      AND status = 'filed'
      AND (branch_id IS NULL OR branch_id = $3::uuid)
    LIMIT 1
    `,
    [businessId, gstPeriod, branchId]
  );
  return !!row;
}

/**
 * Block document saves when the calendar month is marked filed (not when revised).
 */
export async function assertGstPeriodNotFiledForDocumentDate(
  businessId: string,
  branchId: string | null,
  documentDate: string,
  transactionType: string
): Promise<void> {
  if (!branchId || !documentDate || documentDate.length < 7) {
    return;
  }
  const gstPeriod = documentDate.trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(gstPeriod)) {
    return;
  }
  const filed = await isGstPeriodFiled(businessId, branchId, gstPeriod);
  if (filed) {
    throw new Error(
      `Cannot ${transactionType}: GST period ${gstPeriod} is filed. Open a revision (POST /api/gst/revise) before changing books for this period.`
    );
  }
}

async function loadFilingHistory(gstFilingId: string): Promise<GstFilingHistoryEntry[]> {
  const rows = await queryRows<{
    action: string;
    actor_id: string | null;
    created_at: string;
    notes: string | null;
  }>(
    `
    SELECT action, actor_id, created_at, notes
    FROM gst_filing_history
    WHERE gst_filing_id = $1::uuid
    ORDER BY created_at ASC
    `,
    [gstFilingId]
  );
  return rows.map((r) => ({
    action: r.action,
    by: r.actor_id,
    at: r.created_at,
    notes: r.notes,
  }));
}

export interface GstStatusResult {
  status: GstFilingStatus;
  setoff_done: boolean;
  payment_done: boolean;
  remaining_payable: number;
  warnings: string[];
  critical_warnings: string[];
  gst_filing_history: GstFilingHistoryEntry[];
  filing_id: string | null;
  /** Resolved due-date inputs (matches GET /api/gst/charges for the same query overrides). */
  gst_filing: {
    filing_frequency: Gstr3BFilingFrequency;
    /** Only when effective cadence is QRMP; otherwise null (same as charges `qrmp_due_day_used`). */
    qrmp_due_day: 22 | 24 | null;
    gstr3b_due_date: string;
    due_date_rule_source: GstDueDateRuleSource;
  };
}

export async function getGstFilingStatus(params: {
  businessId: string;
  branchId: string;
  gstPeriod: string;
  /** Same shape as `parseGstDueDateQueryOverrides` in `gst-org-filing` (null axes = org). */
  dueDateOverride?: { filingFrequency: Gstr3BFilingFrequency | null; qrmpDueDay: 22 | 24 | null };
  /** True when client sent `filing_frequency` and/or `qrmp_due_day` query params. */
  due_date_inputs_from_request?: boolean;
}): Promise<GstStatusResult> {
  const { businessId, branchId, gstPeriod } = params;
  assertPeriodFormat(gstPeriod);
  const { end: monthEnd } = calendarMonthBounds(gstPeriod);

  const setoff_done = await gstSetoffExistsForPeriod(businessId, branchId, gstPeriod);
  const outstanding = await getOutstandingGst({
    businessId,
    asOnDate: monthEnd,
    branchId,
  });
  const remaining_payable = round2(outstanding.total_liability);
  const payment_done = remaining_payable <= 1;

  const orgDue = await loadGstFilingOrgDefaults(businessId);
  const dueDateOverride = params.dueDateOverride ?? {
    filingFrequency: null,
    qrmpDueDay: null,
  };
  const dueOpts = mergeGstDueDateOptions(orgDue, dueDateOverride);
  const gstr3b_due_date = gstr3bDueDateIso(gstPeriod, dueOpts);
  const due_date_rule_source: GstDueDateRuleSource = params.due_date_inputs_from_request
    ? 'request_override'
    : 'org_defaults';

  const gstr3b = await loadGstr3bForPeriod(businessId, branchId, gstPeriod);
  const critical_warnings = criticalWarningsFromGstr3b(gstr3b);
  const warnings = [...gstr3b.warnings];
  const today = new Date().toISOString().slice(0, 10);
  const late = lateFilingWarningMessage(gstPeriod, today, dueOpts);
  if (late) {
    warnings.push(late);
  }

  const row = await getGstFilingForScope(businessId, branchId, gstPeriod);
  const status: GstFilingStatus = row?.status ?? 'draft';
  let gst_filing_history: GstFilingHistoryEntry[] = [];
  if (row) {
    gst_filing_history = await loadFilingHistory(row.id);
  }

  return {
    status,
    setoff_done,
    payment_done,
    remaining_payable,
    warnings,
    critical_warnings,
    gst_filing_history,
    filing_id: row?.id ?? null,
    gst_filing: {
      filing_frequency: dueOpts.filingFrequency ?? 'monthly',
      qrmp_due_day:
        dueOpts.filingFrequency === 'qrmp' ? (dueOpts.qrmpDueDay === 24 ? 24 : 22) : null,
      gstr3b_due_date,
      due_date_rule_source,
    },
  };
}

export interface FileGstReturnParams {
  businessId: string;
  branchId: string;
  gstPeriod: string;
  userId: string;
  notes?: string | null;
  /**
   * Date tax was paid / credited for interest (YYYY-MM-DD). Defaults to filing date if omitted.
   * Separate from GST liability; used only for `interest_amount` estimate on the filing row.
   */
  interest_payment_date?: string | null;
  /**
   * Interest / challan window cap (YYYY-MM-DD). Defaults to **filing date** for a frozen snapshot.
   * Overrides for what-if: pass an explicit as-on (e.g. support / audit replay).
   */
  interest_as_on_date?: string | null;
  /** Parsed from POST body (null axes = org default). */
  dueDateOverride?: { filingFrequency: Gstr3BFilingFrequency | null; qrmpDueDay: 22 | 24 | null };
  /** True when body included `filing_frequency` and/or `qrmp_due_day` keys. */
  due_date_inputs_from_request?: boolean;
}

export async function fileGstReturn(params: FileGstReturnParams): Promise<{
  filing: GstFilingRow;
  period_lock: { locked: boolean; warning?: string };
  compliance_warnings: string[];
}> {
  const {
    businessId,
    branchId,
    gstPeriod,
    userId,
    notes,
    interest_payment_date,
    interest_as_on_date,
    dueDateOverride: dueDateOverrideParam,
    due_date_inputs_from_request,
  } = params;
  const dueDateOverride = dueDateOverrideParam ?? {
    filingFrequency: null,
    qrmpDueDay: null,
  };
  const rule_source: GstDueDateRuleSource = due_date_inputs_from_request
    ? 'request_override'
    : 'org_defaults';
  assertPeriodFormat(gstPeriod);
  await assertGstFilingLedgerPreconditions({ businessId, branchId, gstPeriod });

  const compliance_warnings: string[] = [];

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<GstFilingRow>(
      `
      SELECT * FROM gst_filings
      WHERE business_id = $1::uuid AND gst_period = $2 AND branch_id = $3::uuid
      FOR UPDATE
      `,
      [businessId, gstPeriod, branchId]
    );

    if (existing.rows.length > 0 && existing.rows[0].status === 'filed') {
      await client.query('ROLLBACK');
      throw new Error('GST return already filed for this period');
    }

    const gstr3b = await loadGstr3bForPeriod(businessId, branchId, gstPeriod);
    const critical = criticalWarningsFromGstr3b(gstr3b);
    if (critical.length > 0) {
      await client.query('ROLLBACK');
      throw new Error(`Resolve warnings before filing: ${critical.join(' ')}`);
    }

    const orgDue = await loadGstFilingOrgDefaults(businessId);
    const dueDateOpts = mergeGstDueDateOptions(orgDue, dueDateOverride);
    const preFileDate = new Date().toISOString().slice(0, 10);
    const lateMsg = lateFilingWarningMessage(gstPeriod, preFileDate, dueDateOpts);
    if (lateMsg) {
      compliance_warnings.push(lateMsg);
    }

    const generatedAt = new Date().toISOString();
    const gst_snapshot = buildGstSnapshot(gstr3b, {
      generatedAt,
      gstPeriod,
      branchId,
      businessId,
    });

    const filingDateIso = toIsoDateOnly(generatedAt);
    const netPay = round2(Number(gstr3b.summary?.net_tax_payable ?? 0));
    const nilReturn = isLikelyNilGstr3BReturn(netPay);
    const dueIso = gstr3bDueDateIso(gstPeriod, dueDateOpts);
    const paymentIso =
      interest_payment_date && interest_payment_date.trim().length >= 10
        ? toIsoDateOnly(interest_payment_date.trim().slice(0, 10))
        : filingDateIso;

    const asOnForCharges =
      interest_as_on_date && interest_as_on_date.trim().length >= 10
        ? toIsoDateOnly(interest_as_on_date.trim().slice(0, 10))
        : filingDateIso;

    const full = await computeGstChargesFull({
      businessId,
      branchId,
      gstPeriod,
      netTaxPayable: netPay,
      filingDate: filingDateIso,
      paymentDate: paymentIso,
      isNilReturn: nilReturn,
      dueDateOptions: dueDateOpts,
      asOnDate: asOnForCharges,
    });
    const interest_amount = full.interest;
    const late_fee = full.late_fee;

    const snapshotWarnings = [...full.warnings];
    const charges_snapshot: GstChargesSnapshotV2 = {
      version: 2,
      rule_source,
      due_date: full.due_date,
      filing_date: filingDateIso,
      payment_date_used: paymentIso,
      effective_interest_end_date: full.effective_interest_end_date,
      as_on_date: full.as_on_date,
      as_on_calendar_timezone: full.as_on_calendar_timezone,
      cash_liability_initial: full.cash_liability_initial,
      cash_liability_after_itc_3b: full.cash_liability_after_itc,
      interest_total: interest_amount,
      late_fee,
      segmented: full.segmented,
      payment_events: full.payment_events,
      segments: full.segments,
      days_delayed_filing: full.days_delayed,
      is_nil_return: nilReturn,
      filing_frequency: dueDateOpts.filingFrequency ?? 'monthly',
      ...(dueDateOpts.filingFrequency === 'qrmp' ? { qrmp_due_day: dueDateOpts.qrmpDueDay } : {}),
      ...(snapshotWarnings.length ? { warnings: snapshotWarnings } : {}),
    };

    for (const w of full.warnings) {
      if (!compliance_warnings.includes(w)) {
        compliance_warnings.push(w);
      }
    }

    if (
      paymentIso > dueIso &&
      full.cash_liability_after_itc < 0.005 &&
      full.interest < 0.005
    ) {
      compliance_warnings.push(
        'GST interest estimate is ₹0 because ledger net cash liability for the period is nil (typically after payment). If tax was paid after the due date, Section 50 interest should be computed on cash amounts outstanding until actual payment — confirm with your CA.'
      );
    }

    let filingId: string;

    if (existing.rows.length === 0) {
      const ins = await client.query<GstFilingRow>(
        `
        INSERT INTO gst_filings (
          business_id, branch_id, gst_period, status, filed_at, filed_by, notes,
          gst_snapshot, revision_delta, interest_amount, late_fee, charges_snapshot
        )
        VALUES ($1::uuid, $2::uuid, $3, 'filed', CURRENT_TIMESTAMP, $4::uuid, $5, $6::jsonb, NULL, $7, $8, $9::jsonb)
        RETURNING *
        `,
        [
          businessId,
          branchId,
          gstPeriod,
          userId,
          notes ?? null,
          gst_snapshot,
          interest_amount,
          late_fee,
          charges_snapshot,
        ]
      );
      filingId = ins.rows[0].id;
    } else {
      const cur = existing.rows[0];
      const upd = await client.query<GstFilingRow>(
        `
        UPDATE gst_filings
        SET status = 'filed',
            filed_at = CURRENT_TIMESTAMP,
            filed_by = $2::uuid,
            notes = COALESCE($3, notes),
            gst_snapshot = $4::jsonb,
            revision_delta = NULL,
            interest_amount = $5,
            late_fee = $6,
            charges_snapshot = $7::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::uuid
        RETURNING *
        `,
        [cur.id, userId, notes ?? null, gst_snapshot, interest_amount, late_fee, charges_snapshot]
      );
      filingId = upd.rows[0].id;
    }

    await client.query(
      `
      INSERT INTO gst_filing_history (gst_filing_id, action, actor_id, notes, metadata)
      VALUES ($1::uuid, 'filed', $2::uuid, $3, $4::jsonb)
      `,
      [
        filingId,
        userId,
        notes ?? null,
        { snapshot_generated_at: generatedAt },
      ]
    );

    await client.query('COMMIT');

    const period_lock = await lockGstPeriod({
      businessId,
      branchId,
      period: gstPeriod,
      lockedBy: userId,
      notes: 'Locked after GST return filed',
    });

    const filing = await queryOne<GstFilingRow>(
      `SELECT * FROM gst_filings WHERE id = $1::uuid`,
      [filingId]
    );
    if (!filing) {
      throw new Error('GST filing record missing after commit');
    }

    return { filing, period_lock, compliance_warnings };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export interface ReviseGstReturnParams {
  businessId: string;
  branchId: string;
  gstPeriod: string;
  userId: string;
  notes?: string | null;
}

export async function reviseGstReturn(params: ReviseGstReturnParams): Promise<GstFilingRow> {
  const { businessId, branchId, gstPeriod, userId, notes } = params;
  assertPeriodFormat(gstPeriod);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<GstFilingRow>(
      `
      SELECT * FROM gst_filings
      WHERE business_id = $1::uuid AND gst_period = $2 AND branch_id = $3::uuid
      FOR UPDATE
      `,
      [businessId, gstPeriod, branchId]
    );

    if (existing.rows.length === 0) {
      throw new Error('No GST filing found for this period');
    }
    const cur = existing.rows[0];
    if (cur.status !== 'filed') {
      throw new Error('Only filed returns can be revised');
    }

    const previousSnapshot = (cur.gst_snapshot ?? null) as GstFilingSnapshot | null;
    const previousNp = netPayableTriple(previousSnapshot);

    const currentGstr3b = await loadGstr3bForPeriod(businessId, branchId, gstPeriod);
    const generatedAt = new Date().toISOString();
    const currentSnapshot = buildGstSnapshot(currentGstr3b, {
      generatedAt,
      gstPeriod,
      branchId,
      businessId,
    });
    const revisedNp = netPayableTriple(currentSnapshot);
    const difference = diffNetPayable(revisedNp, previousNp);

    const filedSnapshotCopy: GstFilingSnapshot | null = previousSnapshot
      ? cloneGstFilingSnapshot(previousSnapshot)
      : null;

    const revisionDeltaPayload: GstRevisionDelta = {
      revised_at: generatedAt,
      filed_snapshot: filedSnapshotCopy,
      previous_net_payable: previousNp,
      revised_net_payable: revisedNp,
      difference,
    };

    const upd = await client.query<GstFilingRow>(
      `
      UPDATE gst_filings
      SET status = 'revised',
          notes = COALESCE($2, notes),
          gst_snapshot = $3::jsonb,
          revision_delta = $4::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::uuid
      RETURNING *
      `,
      [cur.id, notes ?? null, currentSnapshot, revisionDeltaPayload]
    );

    await client.query(
      `
      INSERT INTO gst_filing_history (gst_filing_id, action, actor_id, notes, metadata)
      VALUES ($1::uuid, 'revised', $2::uuid, $3, $4::jsonb)
      `,
      [
        cur.id,
        userId,
        notes ?? null,
        {
          prior_filed_at: cur.filed_at,
          prior_filed_by: cur.filed_by,
          net_payable_delta: difference,
        },
      ]
    );

    await client.query('COMMIT');
    return upd.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Compare freshly recalculated GSTR-3B to the **filed** snapshot (audit / notice support).
 * When status is `revised`, `filed_values_snapshot` is the immutable pre-revision copy from
 * `revision_delta.filed_snapshot`; otherwise it is `gst_filings.gst_snapshot`.
 */
export async function getGstAuditComparison(params: {
  businessId: string;
  branchId: string;
  gstPeriod: string;
}): Promise<{
  /** Same as `filed_values_snapshot` — values treated as “filed” for audit delta. */
  snapshot: GstFilingSnapshot;
  /** Figures as of original filing (or last re-file), for CA audit. */
  filed_values_snapshot: GstFilingSnapshot;
  /** Row `gst_snapshot` (after revision = books at revise time; transparency). */
  stored_row_snapshot: GstFilingSnapshot;
  current: GstFilingSnapshot;
  delta: { igst: number; cgst: number; sgst: number };
  warnings: string[];
  filing_status: GstFilingStatus;
  revision_delta: GstRevisionDelta | null;
}> {
  const { businessId, branchId, gstPeriod } = params;
  assertPeriodFormat(gstPeriod);

  const filing = await getGstFilingForScope(businessId, branchId, gstPeriod);
  if (!filing?.gst_snapshot) {
    throw new Error('No GST filing snapshot for this period — file a return first');
  }

  const storedRowSnapshot = filing.gst_snapshot as GstFilingSnapshot;
  const rev = (filing.revision_delta as GstRevisionDelta | null) ?? null;
  const filedValuesSnapshot =
    filing.status === 'revised' && rev?.filed_snapshot
      ? rev.filed_snapshot
      : storedRowSnapshot;

  const gstr3bCurrent = await loadGstr3bForPeriod(businessId, branchId, gstPeriod);
  const current = buildGstSnapshot(gstr3bCurrent, {
    generatedAt: new Date().toISOString(),
    gstPeriod,
    branchId,
    businessId,
  });

  const filedNp = netPayableTriple(filedValuesSnapshot);
  const currNp = netPayableTriple(current);
  const delta = diffNetPayable(currNp, filedNp);

  const warnings: string[] = [];
  if (hasMaterialNetPayableDiff(delta)) {
    warnings.push('Current data differs from filed return');
  }

  return {
    snapshot: filedValuesSnapshot,
    filed_values_snapshot: filedValuesSnapshot,
    stored_row_snapshot: storedRowSnapshot,
    current,
    delta,
    warnings,
    filing_status: filing.status,
    revision_delta: rev,
  };
}
