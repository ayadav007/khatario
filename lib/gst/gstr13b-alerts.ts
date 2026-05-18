import { query, queryOne, queryRows } from '@/lib/db';
import {
  runGstr13bReconciliation,
  type Gstr13bReconciliationMode,
  type Gstr13bReconciliationResult,
  type ReconciliationException,
  type ReconciliationParams,
} from '@/lib/gst/gstr1-3b-reconciliation';

const TOLERANCE = 1;

/** Net tax difference below this + low structural risk → UI may hide loud mismatch banner. */
export const GST_ALERT_QUIET_DIFF_THRESHOLD = 500;

export type GstReconciliationAlertSeverity = 'low' | 'medium' | 'high';

export type GstReconciliationPrimaryIssue =
  | 'missing_invoice'
  | 'extra_invoice'
  | 'tax_mismatch'
  | 'date_mismatch'
  | 'cdn_mismatch'
  | 'head_mismatch'
  | 'none';

export type {
  GstReconciliationAlertRow,
  GstReconciliationOpenSeverityCounts,
  ReconciliationUiInsights,
} from '@/lib/gst/gstr13b-client';
export { reconciliationModeLabel } from '@/lib/gst/gstr13b-client';
import {
  reconciliationModeLabel,
  type GstReconciliationAlertRow,
  type GstReconciliationOpenSeverityCounts,
  type ReconciliationUiInsights,
} from '@/lib/gst/gstr13b-client';

export type GstReconciliationAlertDetails = {
  head_wise: Gstr13bReconciliationResult['head_wise'];
  exceptions: Gstr13bReconciliationResult['exceptions'];
  top_mismatches: Gstr13bReconciliationResult['exceptions'];
  stats: Gstr13bReconciliationResult['stats'];
  totals: Gstr13bReconciliationResult['totals'];
  primary_issue: GstReconciliationPrimaryIssue;
  affected_head: string | null;
};

export type GstReconciliationAlertHistoryRow = {
  id: string;
  alert_id: string;
  business_id: string;
  event: 'opened' | 'updated' | 'resolved' | 'severity_changed';
  previous_severity: string | null;
  new_severity: string | null;
  previous_totals_difference: string | null;
  new_totals_difference: string | null;
  snapshot: Record<string, unknown>;
  created_at: string;
};

/** Severity from absolute net tax difference (GSTR-1 − GSTR-3B, heads sum). */
export function gstReconciliationSeverity(totalAbsDiff: number): GstReconciliationAlertSeverity {
  if (totalAbsDiff > 50_000) return 'high';
  if (totalAbsDiff > 10_000) return 'medium';
  return 'low';
}

/**
 * If net difference dropped by more than 80% vs last stored snapshot, cap severity at `low`
 * so stale "high" does not linger after books are largely fixed.
 */
export function effectiveGstAlertSeverity(
  result: Gstr13bReconciliationResult,
  previousDetails: Record<string, unknown> | null | undefined
): GstReconciliationAlertSeverity {
  const totalAbs = Math.abs(result.totals.difference);
  let sev = gstReconciliationSeverity(totalAbs);
  const prevTotals = previousDetails?.totals as { difference?: number } | undefined;
  const prevDiff = prevTotals?.difference;
  if (typeof prevDiff === 'number') {
    const prevAbs = Math.abs(prevDiff);
    if (prevAbs >= 100 && totalAbs < prevAbs * 0.2 && sev !== 'low') {
      sev = 'low';
    }
  }
  return sev;
}

export function shouldRaiseGstReconciliationAlert(result: Gstr13bReconciliationResult): boolean {
  const headMismatch = (['igst', 'cgst', 'sgst', 'cess'] as const).some(
    (h) => result.head_wise[h].status === 'mismatch'
  );
  const missingInv = result.stats.missing_in_ledger > 0;
  const taxMis = result.exceptions.some((e) => e.type === 'tax_mismatch');
  const cdnMis = result.exceptions.some((e) => e.type === 'cdn_mismatch');
  return headMismatch || missingInv || taxMis || cdnMis;
}

/** Structural issues that should never be hidden behind "quiet" banner mode. */
export function hasStructuralGstAlertReason(result: Gstr13bReconciliationResult): boolean {
  if (result.stats.missing_in_ledger > 0 || result.stats.missing_in_gstr1 > 0) return true;
  return result.exceptions.some((e) =>
    ['tax_mismatch', 'cdn_mismatch', 'missing_invoice', 'extra_invoice'].includes(e.type)
  );
}

/**
 * Small net variance without structural exceptions → de-emphasize red alert strip (still show data).
 */
export function shouldSuppressGstAlertBanner(result: Gstr13bReconciliationResult): boolean {
  if (result.status === 'matched') return false;
  const abs = Math.abs(result.totals.difference);
  return abs < GST_ALERT_QUIET_DIFF_THRESHOLD && !hasStructuralGstAlertReason(result);
}

function countAffectedVouchers(result: Gstr13bReconciliationResult): number {
  return result.vouchers.filter((v) => v.status !== 'matched').length;
}

export function deriveAffectedHead(result: Gstr13bReconciliationResult): string | null {
  const heads = ['igst', 'cgst', 'sgst', 'cess'] as const;
  let best: { h: string; d: number } | null = null;
  for (const h of heads) {
    const row = result.head_wise[h];
    if (row.status !== 'mismatch') continue;
    const ad = Math.abs(row.difference);
    if (!best || ad > best.d) best = { h: h.toUpperCase(), d: ad };
  }
  return best && best.d > TOLERANCE ? best.h : null;
}

export function derivePrimaryIssue(result: Gstr13bReconciliationResult): GstReconciliationPrimaryIssue {
  if (result.stats.missing_in_ledger > 0) return 'missing_invoice';
  if (result.stats.missing_in_gstr1 > 0) return 'extra_invoice';
  if (result.exceptions.some((e) => e.type === 'cdn_mismatch')) return 'cdn_mismatch';
  if (result.exceptions.some((e) => e.type === 'tax_mismatch')) return 'tax_mismatch';
  if (result.exceptions.some((e) => e.type === 'date_mismatch')) return 'date_mismatch';
  if ((['igst', 'cgst', 'sgst', 'cess'] as const).some((h) => result.head_wise[h].status === 'mismatch')) {
    return 'head_mismatch';
  }
  return 'none';
}

/** Human-readable alert summary for CA banner. */
export function buildGstReconciliationAlertSummary(result: Gstr13bReconciliationResult): string {
  const heads = ['igst', 'cgst', 'sgst', 'cess'] as const;
  let top: { h: string; diff: number } | null = null;
  for (const h of heads) {
    const row = result.head_wise[h];
    if (row.status !== 'mismatch') continue;
    const ad = Math.abs(row.difference);
    if (!top || ad > top.diff) top = { h: h.toUpperCase(), diff: ad };
  }
  const n = countAffectedVouchers(result);
  const parts: string[] = [];

  if (top && top.diff > TOLERANCE) {
    parts.push(`${top.h} mismatch ₹${top.diff.toLocaleString('en-IN')} across ${n} voucher(s)`);
  }
  if (result.stats.missing_in_ledger > 0) {
    parts.push(`${result.stats.missing_in_ledger} missing in 3B/ledger`);
  }
  if (result.exceptions.some((e) => e.type === 'cdn_mismatch')) {
    parts.push('CDN mismatch');
  }
  if (result.exceptions.some((e) => e.type === 'tax_mismatch')) {
    parts.push('tax mismatch on vouchers');
  }

  if (parts.length === 0 && result.status === 'mismatch') {
    return `Reconciliation mismatch — review ${n} voucher(s)`;
  }
  return parts.join(' · ');
}

export function buildGstReconciliationAlertDetails(
  result: Gstr13bReconciliationResult
): GstReconciliationAlertDetails {
  return {
    head_wise: result.head_wise,
    exceptions: result.exceptions,
    top_mismatches: result.exceptions.slice(0, 5),
    stats: result.stats,
    totals: result.totals,
    primary_issue: derivePrimaryIssue(result),
    affected_head: deriveAffectedHead(result),
  };
}

async function insertAlertHistoryRow(input: {
  alertId: string;
  businessId: string;
  event: GstReconciliationAlertHistoryRow['event'];
  previousSeverity: string | null;
  newSeverity: string | null;
  previousTotalsDifference: number | null;
  newTotalsDifference: number | null;
  snapshot: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO gst_reconciliation_alert_history (
       alert_id, business_id, event, previous_severity, new_severity,
       previous_totals_difference, new_totals_difference, snapshot
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      input.alertId,
      input.businessId,
      input.event,
      input.previousSeverity,
      input.newSeverity,
      input.previousTotalsDifference,
      input.newTotalsDifference,
      JSON.stringify(input.snapshot),
    ]
  );
}

/** Pure UI helper from an existing reconciliation payload (no extra DB / run). */
export function buildReconciliationUiInsights(result: Gstr13bReconciliationResult): ReconciliationUiInsights {
  const heads = ['igst', 'cgst', 'sgst', 'cess'] as const;
  let largest: { head: string; amount: number } = { head: 'IGST', amount: 0 };
  for (const h of heads) {
    const a = Math.abs(result.head_wise[h].difference);
    if (a > largest.amount) largest = { head: h.toUpperCase(), amount: a };
  }
  const affected = countAffectedVouchers(result);
  const asOf = new Date().toISOString().slice(0, 10);
  const g1s = result.meta.gstr1_head_source === 'filed_snapshot' ? 'Snapshot' : 'Live';
  const g3s = result.meta.gstr3b_source === 'filed_snapshot' ? 'Snapshot' : 'Ledger';
  const sourceLine = `${g1s} vs ${g3s}`;
  const quiet = shouldSuppressGstAlertBanner(result);

  let insight_line = '';
  if (result.status === 'matched') {
    insight_line = 'All tax heads within tolerance and no blocking exceptions.';
  } else if (quiet) {
    insight_line = `Minor net variance (under ₹${GST_ALERT_QUIET_DIFF_THRESHOLD.toLocaleString('en-IN')}) — review heads if needed.`;
  } else if (largest.amount > TOLERANCE) {
    insight_line = `${largest.head} mismatch ₹${largest.amount.toLocaleString('en-IN')} (${affected} voucher(s) affected)`;
  } else {
    insight_line = `${affected} voucher(s) need review · see exceptions`;
  }

  return {
    largest_mismatch_head: largest.amount > TOLERANCE ? largest.head : null,
    largest_mismatch_amount: largest.amount,
    affected_voucher_count: affected,
    top_exceptions: result.exceptions.slice(0, 5),
    insight_line,
    quiet_mismatch: quiet,
    context: {
      mode_key: result.mode,
      mode_label: reconciliationModeLabel(result.mode),
      as_of: asOf,
      source_line: sourceLine,
    },
  };
}

export async function syncGstReconciliationAlertsFromResult(
  businessId: string,
  result: Gstr13bReconciliationResult
): Promise<{ alertId: string | null; action: 'upserted' | 'resolved' | 'none' }> {
  const branchId = result.branch_id;
  const gstPeriod = result.gst_period;
  const mode = result.mode;

  const open = await queryOne<GstReconciliationAlertRow>(
    `SELECT id, business_id, branch_id, gst_period, mode, status, severity, summary, details,
            created_at, resolved_at
     FROM gst_reconciliation_alerts
     WHERE business_id = $1 AND branch_id = $2 AND gst_period = $3 AND mode = $4 AND status = 'open'`,
    [businessId, branchId, gstPeriod, mode]
  );

  let prevDetails: Record<string, unknown> = {};
  if (open?.details) {
    if (typeof open.details === 'string') {
      try {
        prevDetails = JSON.parse(open.details) as Record<string, unknown>;
      } catch {
        prevDetails = {};
      }
    } else if (typeof open.details === 'object') {
      prevDetails = open.details as Record<string, unknown>;
    }
  }

  if (!shouldRaiseGstReconciliationAlert(result)) {
    if (open) {
      const prevDiff = (prevDetails.totals as { difference?: number } | undefined)?.difference ?? null;
      await query(
        `UPDATE gst_reconciliation_alerts
         SET status = 'resolved', resolved_at = now()
         WHERE id = $1`,
        [open.id]
      );
      await insertAlertHistoryRow({
        alertId: open.id,
        businessId,
        event: 'resolved',
        previousSeverity: open.severity,
        newSeverity: null,
        previousTotalsDifference: typeof prevDiff === 'number' ? prevDiff : null,
        newTotalsDifference: result.totals.difference,
        snapshot: { summary: open.summary, resolved_reason: 'reconciliation_clear' },
      });
      return { alertId: open.id, action: 'resolved' };
    }
    return { alertId: null, action: 'none' };
  }

  const totalAbs = Math.abs(result.totals.difference);
  const rawSeverity = gstReconciliationSeverity(totalAbs);
  const severity = effectiveGstAlertSeverity(result, prevDetails);
  const summary = buildGstReconciliationAlertSummary(result);
  const details = buildGstReconciliationAlertDetails(result);
  const detailsJson = JSON.stringify(details);

  if (open) {
    const prevSev = open.severity;
    const prevDiff = (prevDetails.totals as { difference?: number } | undefined)?.difference ?? null;
    await query(
      `UPDATE gst_reconciliation_alerts
       SET severity = $2, summary = $3, details = $4::jsonb
       WHERE id = $1`,
      [open.id, severity, summary, detailsJson]
    );

    const sevChanged = prevSev !== severity;
    const event: GstReconciliationAlertHistoryRow['event'] = sevChanged ? 'severity_changed' : 'updated';
    const improvementDowngrade =
      rawSeverity !== severity &&
      typeof prevDiff === 'number' &&
      Math.abs(prevDiff) >= 100 &&
      totalAbs < Math.abs(prevDiff) * 0.2;
    await insertAlertHistoryRow({
      alertId: open.id,
      businessId,
      event,
      previousSeverity: prevSev,
      newSeverity: severity,
      previousTotalsDifference: typeof prevDiff === 'number' ? prevDiff : null,
      newTotalsDifference: result.totals.difference,
      snapshot: {
        summary,
        primary_issue: details.primary_issue,
        affected_head: details.affected_head,
        improvement_downgrade: improvementDowngrade,
        severity_raw: rawSeverity,
        severity_effective: severity,
      },
    });

    const notifyTrig = computeGstAlertNotifyTrigger({
      isNewOpen: false,
      prevSeverity: prevSev,
      newSeverity: severity,
      prevDiff: typeof prevDiff === 'number' ? prevDiff : null,
      newDiff: result.totals.difference,
    });
    if (notifyTrig) {
      void import('@/lib/gst/gstr13b-notifications').then((m) =>
        m.deliverGstReconciliationAlertNotifications({
          alertId: open.id,
          businessId,
          branchId,
          gstPeriod,
          mode,
          severity,
          summary,
          details,
          result,
          triggerReason: notifyTrig,
        })
      );
    }

    return { alertId: open.id, action: 'upserted' };
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO gst_reconciliation_alerts (
       business_id, branch_id, gst_period, mode, status, severity, summary, details
     ) VALUES ($1, $2, $3, $4, 'open', $5, $6, $7::jsonb)
     RETURNING id`,
    [businessId, branchId, gstPeriod, mode, severity, summary, detailsJson]
  );
  const newId = row?.id ?? null;
  if (newId) {
    await insertAlertHistoryRow({
      alertId: newId,
      businessId,
      event: 'opened',
      previousSeverity: null,
      newSeverity: severity,
      previousTotalsDifference: null,
      newTotalsDifference: result.totals.difference,
      snapshot: { summary, primary_issue: details.primary_issue, affected_head: details.affected_head },
    });
    void import('@/lib/gst/gstr13b-notifications').then((m) =>
      m.deliverGstReconciliationAlertNotifications({
        alertId: newId,
        businessId,
        branchId,
        gstPeriod,
        mode,
        severity,
        summary,
        details,
        result,
        triggerReason: 'opened',
      })
    );
  }
  return { alertId: newId, action: 'upserted' };
}

/**
 * Runs reconciliation once, then persists alerts (for manual or scheduled jobs).
 * For daily checks, call `POST /api/reports/gst/reconciliation/alerts/generate` from a secured cron
 * (or invoke `generateReconciliationAlerts` with a system context) per business/branch/period.
 */
export async function generateReconciliationAlerts(
  params: ReconciliationParams
): Promise<{
  result: Gstr13bReconciliationResult;
  alertId: string | null;
  alertAction: 'upserted' | 'resolved' | 'none';
}> {
  const result = await runGstr13bReconciliation(params);
  const { alertId, action } = await syncGstReconciliationAlertsFromResult(params.businessId, result);
  return { result, alertId, alertAction: action };
}

export async function countOpenGstReconciliationAlertsBySeverity(options: {
  businessId: string;
  gstPeriod?: string;
  branchId?: string | null;
  mode?: Gstr13bReconciliationMode;
}): Promise<GstReconciliationOpenSeverityCounts> {
  const { businessId, gstPeriod, branchId, mode } = options;
  const cond: string[] = [`business_id = $1`, `status = 'open'`];
  const p: unknown[] = [businessId];
  let i = 2;

  if (gstPeriod) {
    cond.push(`gst_period = $${i}`);
    p.push(gstPeriod);
    i++;
  }
  if (branchId) {
    cond.push(`branch_id = $${i}`);
    p.push(branchId);
    i++;
  }
  if (mode) {
    cond.push(`mode = $${i}`);
    p.push(mode);
    i++;
  }

  const sql = `
    SELECT severity, COUNT(*)::int AS c
    FROM gst_reconciliation_alerts
    WHERE ${cond.join(' AND ')}
    GROUP BY severity
  `;
  const rows = await queryRows<{ severity: string | null; c: number }>(sql, p);
  const out: GstReconciliationOpenSeverityCounts = { high: 0, medium: 0, low: 0, total: 0 };
  for (const r of rows) {
    const c = r.c;
    out.total += c;
    if (r.severity === 'high') out.high += c;
    else if (r.severity === 'medium') out.medium += c;
    else if (r.severity === 'low') out.low += c;
  }
  return out;
}

export async function listGstReconciliationAlerts(options: {
  businessId: string;
  gstPeriod?: string;
  branchId?: string | null;
  mode?: Gstr13bReconciliationMode;
  status?: 'open' | 'resolved' | 'all';
  limit?: number;
}): Promise<GstReconciliationAlertRow[]> {
  const { businessId, gstPeriod, branchId, mode, status = 'all', limit = 50 } = options;
  const cond: string[] = ['business_id = $1'];
  const p: unknown[] = [businessId];
  let i = 2;

  if (gstPeriod) {
    cond.push(`gst_period = $${i}`);
    p.push(gstPeriod);
    i++;
  }
  if (branchId) {
    cond.push(`branch_id = $${i}`);
    p.push(branchId);
    i++;
  }
  if (mode) {
    cond.push(`mode = $${i}`);
    p.push(mode);
    i++;
  }
  if (status !== 'all') {
    cond.push(`status = $${i}`);
    p.push(status);
    i++;
  }

  const safeLimit = Math.min(200, Math.max(1, limit));
  p.push(safeLimit);
  const limIdx = i;

  const sql = `
    SELECT id, business_id, branch_id, gst_period, mode, status, severity, summary, details,
           created_at, resolved_at
    FROM gst_reconciliation_alerts
    WHERE ${cond.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${limIdx}
  `;
  const rows = await queryRows<GstReconciliationAlertRow>(sql, p);
  return rows.map((r) => {
    let details: Record<string, unknown> = {};
    if (typeof r.details === 'string') {
      try {
        details = JSON.parse(r.details) as Record<string, unknown>;
      } catch {
        details = {};
      }
    } else if (r.details && typeof r.details === 'object') {
      details = r.details as Record<string, unknown>;
    }
    return { ...r, details };
  });
}

/** When to push notifications (opened, severity increased, or net diff worsened ≥20%). */
export function computeGstAlertNotifyTrigger(params: {
  isNewOpen: boolean;
  prevSeverity: string | null;
  newSeverity: string;
  prevDiff: number | null;
  newDiff: number;
}): 'opened' | 'severity_up' | 'diff_spike' | null {
  if (params.isNewOpen) return 'opened';
  const rank = (s: string | null) => (s === 'high' ? 3 : s === 'medium' ? 2 : s === 'low' ? 1 : 0);
  if (rank(params.newSeverity) > rank(params.prevSeverity)) return 'severity_up';
  const pa = params.prevDiff != null ? Math.abs(params.prevDiff) : 0;
  const na = Math.abs(params.newDiff);
  if (pa >= 1 && na >= pa * 1.2) return 'diff_spike';
  return null;
}

export async function getGstReconciliationAlertById(
  alertId: string,
  businessId: string
): Promise<GstReconciliationAlertRow | null> {
  const row = await queryOne<GstReconciliationAlertRow>(
    `SELECT id, business_id, branch_id, gst_period, mode, status, severity, summary, details,
            created_at, resolved_at
     FROM gst_reconciliation_alerts
     WHERE id = $1 AND business_id = $2`,
    [alertId, businessId]
  );
  if (!row) return null;
  let details: Record<string, unknown> = {};
  if (typeof row.details === 'string') {
    try {
      details = JSON.parse(row.details) as Record<string, unknown>;
    } catch {
      details = {};
    }
  } else if (row.details && typeof row.details === 'object') {
    details = row.details as Record<string, unknown>;
  }
  return { ...row, details };
}

export async function listGstReconciliationAlertHistory(options: {
  businessId: string;
  alertId: string;
  limit?: number;
}): Promise<GstReconciliationAlertHistoryRow[]> {
  const { businessId, alertId, limit = 50 } = options;
  const safeLimit = Math.min(200, Math.max(1, limit));
  const rows = await queryRows<GstReconciliationAlertHistoryRow>(
    `SELECT id, alert_id, business_id, event, previous_severity, new_severity,
            previous_totals_difference::text, new_totals_difference::text, snapshot, created_at
     FROM gst_reconciliation_alert_history
     WHERE business_id = $1 AND alert_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [businessId, alertId, safeLimit]
  );
  return rows.map((r) => {
    let snapshot: Record<string, unknown> = {};
    if (typeof r.snapshot === 'string') {
      try {
        snapshot = JSON.parse(r.snapshot) as Record<string, unknown>;
      } catch {
        snapshot = {};
      }
    } else if (r.snapshot && typeof r.snapshot === 'object') {
      snapshot = r.snapshot as Record<string, unknown>;
    }
    return { ...r, snapshot };
  });
}

export async function resolveGstReconciliationAlert(alertId: string, businessId: string): Promise<boolean> {
  const row = await queryOne<GstReconciliationAlertRow>(
    `SELECT id, severity, summary, details FROM gst_reconciliation_alerts
     WHERE id = $1 AND business_id = $2 AND status = 'open'`,
    [alertId, businessId]
  );
  if (!row) return false;

  let prevDetails: Record<string, unknown> = {};
  if (row.details) {
    if (typeof row.details === 'string') {
      try {
        prevDetails = JSON.parse(row.details) as Record<string, unknown>;
      } catch {
        prevDetails = {};
      }
    } else if (typeof row.details === 'object') {
      prevDetails = row.details as Record<string, unknown>;
    }
  }
  const prevDiff = (prevDetails.totals as { difference?: number } | undefined)?.difference ?? null;

  const res = await query(
    `UPDATE gst_reconciliation_alerts
     SET status = 'resolved', resolved_at = now()
     WHERE id = $1 AND business_id = $2 AND status = 'open'`,
    [alertId, businessId]
  );
  if ((res.rowCount ?? 0) === 0) return false;

  await insertAlertHistoryRow({
    alertId,
    businessId,
    event: 'resolved',
    previousSeverity: row.severity,
    newSeverity: null,
    previousTotalsDifference: typeof prevDiff === 'number' ? prevDiff : null,
    newTotalsDifference: null,
    snapshot: { summary: row.summary, resolved_reason: 'manual' },
  });
  return true;
}
