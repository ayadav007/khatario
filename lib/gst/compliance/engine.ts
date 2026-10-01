import { getPool, query, queryOne, queryRows } from '@/lib/db';
import { FeatureKeys } from '@/lib/featureKeys';
import { loadGstFilingOrgDefaults, mergeGstDueDateOptions } from '@/lib/gst/gst-org-filing';
import { listRule37Exposure } from '@/lib/gst/rule37';
import { effectiveGstScheme } from '@/lib/gst/scheme-policy';
import { todayIst } from '@/lib/gst/time-limits';
import { getBusinessSubscription, isSubscriptionOperationalStatus } from '@/lib/subscription';
import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import {
  creditNoteDeadlineFinding,
  currentFyDeadline,
  gstr3bFindings,
  itcDeadlineFinding,
  recentReturnPeriods,
  rule37Findings,
  SEVERITY_RANK,
  shouldNotify,
  type ComplianceCheckId,
  type ComplianceFinding,
  type Gstr3bPeriodState,
  type Rule37BillInput,
  type UnbookedItcDoc,
} from './checks';

export interface StoredAlert {
  id: string;
  check_id: ComplianceCheckId;
  alert_key: string;
  severity: ComplianceFinding['severity'];
  stage: string;
  title: string;
  message: string;
  legal_ref: string;
  action_url: string | null;
  action_label: string | null;
  ask_question: string | null;
  due_date: string | null;
  amount: string | null;
  details: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  notified_stage: string | null;
  notified_at: string | null;
  dismissed_stage: string | null;
}

const FILED = `('filed', 'revised')`;

async function loadRule37(businessId: string, asOn: string): Promise<Rule37BillInput[]> {
  const client = await getPool().connect();
  try {
    const rows = await listRule37Exposure(client, { businessId, asOn });
    const supplierIds = Array.from(new Set(rows.map((r) => r.supplier_id).filter((id): id is string => !!id)));
    const names = supplierIds.length
      ? new Map(
          (
            await client.query<{ id: string; name: string }>(`SELECT id, name FROM suppliers WHERE id = ANY($1::uuid[])`, [supplierIds])
          ).rows.map((r) => [r.id, r.name]),
        )
      : new Map<string, string>();
    return rows.map((r) => ({ ...r, supplier_name: r.supplier_id ? names.get(r.supplier_id) ?? null : null }));
  } finally {
    client.release();
  }
}

/** Eligible supplier invoices in GSTR-2B that never reached the purchase books. */
async function loadUnbookedItc(businessId: string, fyStart: string, fyEnd: string): Promise<UnbookedItcDoc[]> {
  const rows = await queryRows<{
    supplier_gstin: string;
    supplier_name: string | null;
    invoice_number: string;
    invoice_date: string;
    itc: string;
  }>(
    `SELECT DISTINCT ON (upper(r.supplier_gstin), upper(trim(r.invoice_number)))
            r.supplier_gstin, gi.supplier_name, r.invoice_number, to_char(r.invoice_date, 'YYYY-MM-DD') AS invoice_date,
            COALESCE(r.gstr2b_igst, 0) + COALESCE(r.gstr2b_cgst, 0) + COALESCE(r.gstr2b_sgst, 0) + COALESCE(r.gstr2b_cess, 0) AS itc
       FROM gstr2b_reconciliation r
       LEFT JOIN gstr2b_invoices gi ON gi.id = r.gstr2b_invoice_id
       LEFT JOIN reconciliation_decisions rd ON rd.reconciliation_id = r.id
      WHERE r.business_id = $1::uuid
        AND r.match_status = 'ONLY_IN_2B'
        AND COALESCE(r.document_type, 'invoice') IN ('invoice', 'debit_note')
        AND COALESCE(r.gstr2b_itc_eligibility, 'eligible') = 'eligible'
        AND COALESCE(gi.reverse_charge, 'N') <> 'Y'
        AND r.invoice_date BETWEEN $2::date AND $3::date
        AND (rd.decision IS NULL OR rd.decision NOT IN ('ITC_NOT_ELIGIBLE', 'IGNORE'))
        AND NOT EXISTS (
          SELECT 1 FROM purchases p
           WHERE p.business_id = r.business_id
             AND p.deleted_at IS NULL
             AND COALESCE(p.status, '') NOT IN ('draft', 'cancelled')
             AND upper(trim(p.supplier_gstin)) = upper(trim(r.supplier_gstin))
             AND upper(trim(p.bill_number)) = upper(trim(r.invoice_number))
        )
      ORDER BY upper(r.supplier_gstin), upper(trim(r.invoice_number)), r.filing_period DESC`,
    [businessId, fyStart, fyEnd],
  );
  return rows.map((r) => ({ ...r, itc: Number(r.itc) }));
}

async function countSalesInvoices(businessId: string, from: string, to: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM invoices
      WHERE business_id = $1::uuid AND deleted_at IS NULL AND status = 'final'
        AND (document_type IS NULL OR document_type <> 'proforma_invoice')
        AND invoice_date BETWEEN $2::date AND $3::date`,
    [businessId, from, to],
  );
  return Number(row?.n ?? 0);
}

async function loadGstr3bState(businessId: string, asOn: string) {
  const opts = mergeGstDueDateOptions(await loadGstFilingOrgDefaults(businessId));
  const tracks = await queryOne<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM gst_filings WHERE business_id = $1::uuid AND status IN ${FILED}) AS ok`,
    [businessId],
  );
  const periods: Gstr3bPeriodState[] = [];
  for (const period of recentReturnPeriods(asOn, opts)) {
    const from = `${period.months[0]}-01`;
    const last = period.months[period.months.length - 1];
    const state = await queryOne<{ filed: boolean; activity: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM gst_filings WHERE business_id = $1::uuid AND gst_period = ANY($2::text[]) AND status IN ${FILED}) AS filed,
         (EXISTS (SELECT 1 FROM invoices WHERE business_id = $1::uuid AND deleted_at IS NULL AND status = 'final'
                   AND invoice_date >= $3::date AND invoice_date < ($4::date + INTERVAL '1 month'))
          OR EXISTS (SELECT 1 FROM purchases WHERE business_id = $1::uuid AND deleted_at IS NULL
                   AND COALESCE(status, '') NOT IN ('draft', 'cancelled')
                   AND bill_date >= $3::date AND bill_date < ($4::date + INTERVAL '1 month'))) AS activity`,
      [businessId, period.months, from, `${last}-01`],
    );
    periods.push({ period, filed: !!state?.filed, hasActivity: !!state?.activity });
  }
  return { opts, periods, tracksFiling: !!tracks?.ok };
}

export interface Evaluation {
  findings: ComplianceFinding[];
  /** Checks that ran to completion; only their stale alerts may be resolved. */
  ran: ComplianceCheckId[];
  skipped?: string;
}

export async function evaluateBusinessCompliance(businessId: string, asOn: string = todayIst()): Promise<Evaluation> {
  const biz = await queryOne<{ gstin: string | null; gst_registration_type: string | null }>(
    `SELECT gstin, gst_registration_type FROM businesses WHERE id = $1::uuid`,
    [businessId],
  );
  if (!biz) return { findings: [], ran: [], skipped: 'business not found' };
  // Composition and unregistered businesses take no ITC and file no GSTR-3B.
  if (effectiveGstScheme(biz.gst_registration_type, biz.gstin) !== 'regular') {
    return { findings: [], ran: ['rule37', 'itc_deadline', 'credit_note_deadline', 'gstr3b_due'], skipped: 'not a regular GST registration' };
  }

  const findings: ComplianceFinding[] = [];
  const ran: ComplianceCheckId[] = [];
  const attempt = async (ids: ComplianceCheckId[], fn: () => Promise<ComplianceFinding[]>) => {
    try {
      findings.push(...(await fn()));
      ran.push(...ids);
    } catch (err) {
      console.error(`[gst-compliance] ${ids.join('+')} failed for ${businessId}:`, err instanceof Error ? err.message : err);
    }
  };

  await attempt(['rule37'], async () => rule37Findings(await loadRule37(businessId, asOn), asOn));
  await attempt(['itc_deadline', 'credit_note_deadline'], async () => {
    const w = currentFyDeadline(asOn);
    if (!w) return [];
    const out: ComplianceFinding[] = [];
    const itc = itcDeadlineFinding(asOn, await loadUnbookedItc(businessId, w.fyStart, w.fyEnd));
    if (itc) out.push(itc);
    const cn = creditNoteDeadlineFinding(asOn, await countSalesInvoices(businessId, w.fyStart, w.fyEnd));
    if (cn) out.push(cn);
    return out;
  });
  await attempt(['gstr3b_due'], async () => {
    const s = await loadGstr3bState(businessId, asOn);
    return gstr3bFindings(asOn, s.opts, s.periods, s.tracksFiling);
  });

  return { findings, ran };
}

export interface SyncResult {
  active: number;
  notified: number;
  resolved: number;
}

/** Store findings, resolve alerts their check no longer raises, and notify on new stages. */
export async function syncComplianceAlerts(
  businessId: string,
  evaluation: Evaluation,
  opts: { notify: boolean },
): Promise<SyncResult> {
  const previous = new Map(
    (
      await queryRows<Pick<StoredAlert, 'alert_key' | 'notified_stage' | 'resolved_at' | 'dismissed_stage'>>(
        `SELECT alert_key, notified_stage, resolved_at, dismissed_stage FROM gst_compliance_alerts WHERE business_id = $1::uuid`,
        [businessId],
      )
    ).map((r) => [r.alert_key, r]),
  );

  let notified = 0;
  for (const f of evaluation.findings) {
    const saved = await queryOne<{ id: string }>(
      `INSERT INTO gst_compliance_alerts
         (business_id, check_id, alert_key, severity, stage, title, message, legal_ref, action_url, action_label,
          ask_question, due_date, amount, details)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13, $14::jsonb)
       ON CONFLICT (business_id, alert_key) DO UPDATE SET
         severity = EXCLUDED.severity, stage = EXCLUDED.stage, title = EXCLUDED.title, message = EXCLUDED.message,
         legal_ref = EXCLUDED.legal_ref, action_url = EXCLUDED.action_url, action_label = EXCLUDED.action_label,
         ask_question = EXCLUDED.ask_question, due_date = EXCLUDED.due_date, amount = EXCLUDED.amount,
         details = EXCLUDED.details, last_seen_at = CURRENT_TIMESTAMP,
         first_seen_at = CASE WHEN gst_compliance_alerts.resolved_at IS NOT NULL THEN CURRENT_TIMESTAMP ELSE gst_compliance_alerts.first_seen_at END,
         dismissed_stage = CASE WHEN gst_compliance_alerts.resolved_at IS NOT NULL THEN NULL ELSE gst_compliance_alerts.dismissed_stage END,
         notified_stage = CASE WHEN gst_compliance_alerts.resolved_at IS NOT NULL THEN NULL ELSE gst_compliance_alerts.notified_stage END,
         resolved_at = NULL
       RETURNING id`,
      [
        businessId, f.checkId, f.key, f.severity, f.stage, f.title, f.message, f.legalRef, f.actionUrl, f.actionLabel,
        f.askQuestion, f.dueDate, f.amount, JSON.stringify(f.details),
      ],
    );
    const prev = previous.get(f.key) ?? null;
    const dismissedThisStage = !!prev && !prev.resolved_at && prev.dismissed_stage === f.stage;
    if (!opts.notify || !saved || dismissedThisStage || !shouldNotify(prev, f)) continue;
    await query(
      `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
       VALUES ($1::uuid, 'gst_compliance', $2, $3, 'gst_compliance', $4::uuid, CURRENT_TIMESTAMP)`,
      [businessId, f.title.slice(0, 255), `${f.message} (${f.legalRef})`, saved.id],
    );
    await query(`UPDATE gst_compliance_alerts SET notified_stage = $2, notified_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`, [
      saved.id,
      f.stage,
    ]);
    notified++;
  }

  const resolved = evaluation.ran.length
    ? await query(
        `UPDATE gst_compliance_alerts SET resolved_at = CURRENT_TIMESTAMP
          WHERE business_id = $1::uuid AND resolved_at IS NULL
            AND check_id = ANY($2::text[]) AND NOT (alert_key = ANY($3::text[]))`,
        [businessId, evaluation.ran, evaluation.findings.map((f) => f.key)],
      )
    : null;

  return { active: evaluation.findings.length, notified, resolved: resolved?.rowCount ?? 0 };
}

export async function listActiveComplianceAlerts(businessId: string): Promise<StoredAlert[]> {
  const rows = await queryRows<StoredAlert>(
    `SELECT id, check_id, alert_key, severity, stage, title, message, legal_ref, action_url, action_label, ask_question,
            to_char(due_date, 'YYYY-MM-DD') AS due_date, amount, details, first_seen_at, last_seen_at, resolved_at,
            notified_stage, notified_at, dismissed_stage
       FROM gst_compliance_alerts
      WHERE business_id = $1::uuid AND resolved_at IS NULL`,
    [businessId],
  );
  return rows.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')),
  );
}

export async function dismissComplianceAlert(businessId: string, alertId: string, userId: string): Promise<boolean> {
  const res = await query(
    `UPDATE gst_compliance_alerts SET dismissed_stage = stage, dismissed_by = $3::uuid
      WHERE id = $1::uuid AND business_id = $2::uuid AND resolved_at IS NULL`,
    [alertId, businessId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

export interface RunSummary {
  as_on: string;
  businesses: number;
  evaluated: number;
  skipped: number;
  notified: number;
  resolved: number;
  failed: number;
}

/** Daily job: every operational business with a GSTIN and GST reports on its plan. */
export async function runGstComplianceAlerts(opts: { asOn?: string; notify?: boolean } = {}): Promise<RunSummary> {
  const asOn = opts.asOn ?? todayIst();
  const businesses = await queryRows<{ id: string }>(
    `SELECT id FROM businesses
      WHERE platform_suspended_at IS NULL AND gstin IS NOT NULL AND TRIM(gstin) <> ''`,
  );
  const summary: RunSummary = { as_on: asOn, businesses: businesses.length, evaluated: 0, skipped: 0, notified: 0, resolved: 0, failed: 0 };
  for (const { id } of businesses) {
    try {
      const sub = await getBusinessSubscription(id);
      if (!sub || !isSubscriptionOperationalStatus(sub.status) || !(await hasFeatureAccess(id, FeatureKeys.REPORTS_GST))) {
        summary.skipped++;
        continue;
      }
      const evaluation = await evaluateBusinessCompliance(id, asOn);
      const r = await syncComplianceAlerts(id, evaluation, { notify: opts.notify ?? true });
      summary.evaluated++;
      summary.notified += r.notified;
      summary.resolved += r.resolved;
    } catch (err) {
      summary.failed++;
      console.error(`[gst-compliance] business ${id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return summary;
}
