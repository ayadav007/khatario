import { query, queryOne } from '@/lib/db';
import { sendBusinessEmail } from '@/lib/business-email';
import type {
  CategoryCompare,
  Gstr13bReconciliationMode,
  Gstr13bReconciliationResult,
} from '@/lib/gst/gstr1-3b-reconciliation';
import type { GstReconciliationAlertDetails } from '@/lib/gst/gstr13b-alerts';
import {
  shouldSuppressGstAlertBanner,
  type GstReconciliationAlertSeverity,
} from '@/lib/gst/gstr13b-alerts';

import type { GstAlertRecipient } from '@/lib/gst/gstr13b-client';

export type { GstAlertRecipient };

export type GstAlertNotificationPrefsRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  notify_on: string[];
  include_low: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  cooldown_minutes: number;
  recipients: GstAlertRecipient[] | unknown;
  created_at: string;
  updated_at: string;
};

export type GstAlertNotifyTrigger = 'opened' | 'severity_up' | 'diff_spike' | 'manual';

const DEFAULT_PREFS: Omit<
  GstAlertNotificationPrefsRow,
  'id' | 'business_id' | 'branch_id' | 'created_at' | 'updated_at'
> = {
  email_enabled: true,
  whatsapp_enabled: false,
  notify_on: ['high', 'medium'],
  include_low: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
  cooldown_minutes: 120,
  recipients: [],
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appBaseUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  if (u) return u;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  return 'http://localhost:3000';
}

export function buildGstReconciliationReportLink(params: {
  period: string;
  mode: string;
  branchId?: string | null;
}): string {
  const q = new URLSearchParams({ period: params.period, mode: params.mode, view: 'mismatches' });
  if (params.branchId) q.set('branch_id', params.branchId);
  return `${appBaseUrl()}/reports/gst/reconciliation?${q.toString()}`;
}

/** Interpret TIME columns as Asia/Kolkata wall-clock vs "now" in IST. */
export function isWithinGstAlertQuietHoursIST(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((a, p) => {
      if (p.type !== 'literal') a[p.type] = p.value;
      return a;
    }, {});
  const h = parseInt(parts.hour || '0', 10);
  const m = parseInt(parts.minute || '0', 10);
  const mins = h * 60 + m;
  const [sh, sm] = start.split(':').map((x) => parseInt(x, 10));
  const [eh, em] = end.split(':').map((x) => parseInt(x, 10));
  const startM = sh * 60 + sm;
  const endM = eh * 60 + em;
  if (startM <= endM) return mins >= startM && mins <= endM;
  return mins >= startM || mins <= endM;
}

function parseRecipients(raw: unknown): GstAlertRecipient[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is GstAlertRecipient =>
      r &&
      typeof r === 'object' &&
      (r as GstAlertRecipient).type !== undefined &&
      ['email', 'whatsapp'].includes((r as GstAlertRecipient).type) &&
      typeof (r as GstAlertRecipient).value === 'string' &&
      (r as GstAlertRecipient).value.trim().length > 0
  ) as GstAlertRecipient[];
}

function severityAllowed(
  severity: GstReconciliationAlertSeverity,
  prefs: { notify_on: string[]; include_low: boolean }
): boolean {
  if (severity === 'low') return prefs.include_low === true;
  return prefs.notify_on.includes(severity);
}

async function loadPrefsRow(
  businessId: string,
  branchId: string | null
): Promise<GstAlertNotificationPrefsRow | null> {
  if (branchId) {
    const row = await queryOne<GstAlertNotificationPrefsRow>(
      `SELECT id, business_id, branch_id, email_enabled, whatsapp_enabled, notify_on, include_low,
              quiet_hours_start::text, quiet_hours_end::text, cooldown_minutes, recipients,
              created_at, updated_at
       FROM gst_alert_notification_prefs
       WHERE business_id = $1 AND branch_id = $2`,
      [businessId, branchId]
    );
    if (row) return normalizePrefsRow(row);
  }
  const fallback = await queryOne<GstAlertNotificationPrefsRow>(
    `SELECT id, business_id, branch_id, email_enabled, whatsapp_enabled, notify_on, include_low,
            quiet_hours_start::text, quiet_hours_end::text, cooldown_minutes, recipients,
            created_at, updated_at
     FROM gst_alert_notification_prefs
     WHERE business_id = $1 AND branch_id IS NULL`,
    [businessId]
  );
  return fallback ? normalizePrefsRow(fallback) : null;
}

function normalizePrefsRow(row: GstAlertNotificationPrefsRow): GstAlertNotificationPrefsRow {
  let recipients: GstAlertRecipient[] = [];
  if (Array.isArray(row.recipients)) recipients = parseRecipients(row.recipients);
  else if (typeof row.recipients === 'string') {
    try {
      recipients = parseRecipients(JSON.parse(row.recipients));
    } catch {
      recipients = [];
    }
  }
  return { ...row, recipients };
}

export async function getGstAlertNotificationPrefsEffective(
  businessId: string,
  branchId: string | null
): Promise<
  Omit<GstAlertNotificationPrefsRow, 'id' | 'created_at' | 'updated_at'> & {
    id: string | null;
    source: 'branch' | 'business' | 'default';
  }
> {
  const branchRow = branchId ? await loadPrefsRow(businessId, branchId) : null;
  if (branchRow) {
    return { ...branchRow, source: 'branch' };
  }
  const bizRow = await loadPrefsRow(businessId, null);
  if (bizRow) {
    return { ...bizRow, source: 'business' };
  }
  return {
    id: null,
    business_id: businessId,
    branch_id: branchId,
    ...DEFAULT_PREFS,
    recipients: [],
    source: 'default',
  };
}

async function lastSuccessfulNotificationAt(
  businessId: string,
  branchId: string | null,
  gstPeriod: string,
  mode: string
): Promise<Date | null> {
  const row = await queryOne<{ t: Date }>(
    `SELECT MAX(created_at) AS t
     FROM gst_alert_notification_logs
     WHERE business_id = $1
       AND gst_period = $2
       AND mode = $3
       AND status = 'sent'
       AND branch_id IS NOT DISTINCT FROM $4::uuid`,
    [businessId, gstPeriod, mode, branchId]
  );
  return row?.t ? new Date(row.t) : null;
}

async function insertNotificationLog(input: {
  alertId: string;
  businessId: string;
  branchId: string | null;
  gstPeriod: string;
  mode: string;
  channel: 'email' | 'whatsapp';
  recipient: string;
  status: 'sent' | 'failed' | 'skipped';
  error?: string | null;
  triggerReason: string;
}): Promise<void> {
  await query(
    `INSERT INTO gst_alert_notification_logs (
       alert_id, business_id, branch_id, gst_period, mode, channel, recipient, status, error, trigger_reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.alertId,
      input.businessId,
      input.branchId,
      input.gstPeriod,
      input.mode,
      input.channel,
      input.recipient,
      input.status,
      input.error ?? null,
      input.triggerReason,
    ]
  );
}

function fmtInr(n: number): string {
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildEmailHtml(input: {
  summary: string;
  severity: string;
  period: string;
  mode: string;
  link: string;
  details: GstReconciliationAlertDetails;
}): string {
  const heads = ['igst', 'cgst', 'sgst', 'cess'] as const;
  const rows = heads
    .map((h) => {
      const x = input.details.head_wise[h];
      return `<tr><td>${h.toUpperCase()}</td><td style="text-align:right">${fmtInr(x.gstr1)}</td><td style="text-align:right">${fmtInr(x.gstr3b)}</td><td style="text-align:right">${fmtInr(x.difference)}</td></tr>`;
    })
    .join('');
  const top = input.details.top_mismatches.slice(0, 3);
  const topList = top
    .map(
      (e) =>
        `<li>${escapeHtml(e.type)} — ${escapeHtml(e.invoice_id ?? e.document_id ?? '')}: ${escapeHtml(e.details)}</li>`
    )
    .join('');
  return `
  <div style="font-family:system-ui,sans-serif;max-width:640px">
    <h2 style="margin:0 0 8px">GST reconciliation alert</h2>
    <p style="margin:0 0 12px;color:#444"><strong>${escapeHtml(input.severity.toUpperCase())}</strong> · ${escapeHtml(input.period)} · ${escapeHtml(input.mode.replace(/_/g, ' '))}</p>
    <p style="margin:0 0 16px">${escapeHtml(input.summary)}</p>
    <p style="margin:0 0 4px"><strong>Primary issue:</strong> ${escapeHtml(String(input.details.primary_issue))}</p>
    <p style="margin:0 0 16px"><strong>Affected head:</strong> ${escapeHtml(String(input.details.affected_head ?? '—'))}</p>
    <p style="margin:0 0 4px"><strong>Net difference:</strong> ${fmtInr(input.details.totals.difference)} · <strong>Mismatched vouchers:</strong> ${input.details.stats.mismatched}</p>
    <h3 style="margin:20px 0 8px">Head-wise</h3>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
      <thead><tr><th>Head</th><th>GSTR-1</th><th>GSTR-3B</th><th>Diff</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h3 style="margin:20px 0 8px">Top mismatches</h3>
    <ul>${topList || '<li>—</li>'}</ul>
    <p style="margin:24px 0 0"><a href="${escapeHtml(input.link)}" style="color:#2563eb">Open reconciliation →</a></p>
  </div>`;
}

function emptyTaxBlock() {
  return { taxable_value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
}

function emptyCategoryCompare(): CategoryCompare {
  const z = emptyTaxBlock();
  return { gstr1: { ...z }, gstr3b: { ...z }, difference: { ...z } };
}

/** Reconstruct a minimal reconciliation result from stored alert JSON (manual notify / resend). */
export function minimalGstr13bResultFromAlertDetails(
  details: GstReconciliationAlertDetails,
  mode: Gstr13bReconciliationMode,
  gstPeriod: string,
  branchId: string
): Gstr13bReconciliationResult {
  const z = emptyCategoryCompare();
  return {
    status: 'mismatch',
    mode,
    gst_period: gstPeriod,
    branch_id: branchId,
    meta: {
      gstr1_head_source: 'live_generator',
      gstr3b_source: 'live_generator',
      voucher_map_source: 'live_gstr1_generator',
    },
    head_wise: details.head_wise,
    totals: details.totals,
    categories: {
      outward_taxable: z,
      zero_rated: z,
      exempt: z,
      nil_rated: z,
      inward_rcm: z,
      cdn_adjustments: z,
    },
    exceptions: details.exceptions,
    stats: details.stats,
    vouchers: [],
    warnings: [],
  };
}

export function parseGstAlertDetailsRecord(
  raw: Record<string, unknown>
): GstReconciliationAlertDetails | null {
  const headWise = raw.head_wise as GstReconciliationAlertDetails['head_wise'] | undefined;
  const totals = raw.totals as GstReconciliationAlertDetails['totals'] | undefined;
  const stats = raw.stats as GstReconciliationAlertDetails['stats'] | undefined;
  const exceptions = raw.exceptions as GstReconciliationAlertDetails['exceptions'] | undefined;
  const topRaw = raw.top_mismatches;
  const topMismatches = Array.isArray(topRaw)
    ? (topRaw as GstReconciliationAlertDetails['top_mismatches'])
    : Array.isArray(exceptions)
      ? exceptions.slice(0, 5)
      : undefined;
  if (!headWise || !totals || !stats || !exceptions || !topMismatches) return null;
  const heads = ['igst', 'cgst', 'sgst', 'cess'] as const;
  for (const h of heads) {
    const row = headWise[h];
    if (!row || typeof row.gstr1 !== 'number' || typeof row.gstr3b !== 'number') return null;
  }
  if (typeof totals.difference !== 'number') return null;
  return {
    head_wise: headWise,
    exceptions,
    top_mismatches: topMismatches,
    stats,
    totals,
    primary_issue: (raw.primary_issue as GstReconciliationAlertDetails['primary_issue']) ?? 'none',
    affected_head: (raw.affected_head as string | null) ?? null,
  };
}

function buildWhatsAppText(input: {
  summary: string;
  period: string;
  primary: string;
  head: string | null;
  link: string;
}): string {
  return [
    `GST Alert (${input.period})`,
    input.summary,
    '',
    `Top issue: ${input.primary}`,
    `Head: ${input.head ?? '—'}`,
    '',
    `View: ${input.link}`,
  ].join('\n');
}

async function deliverWhatsApp(businessId: string, toRaw: string, text: string): Promise<void> {
  const { sendWhatsAppMessage } = await import('@/lib/whatsapp');
  let to = toRaw.trim().replace(/\s+/g, '');
  if (!to.includes('@')) {
    const digits = to.replace(/\D/g, '');
    if (digits.length === 10) to = `91${digits}`;
    else to = digits;
  }
  await sendWhatsAppMessage(businessId, to, text, undefined, 'text');
}

export type DeliverGstAlertNotificationsInput = {
  alertId: string;
  businessId: string;
  branchId: string | null;
  gstPeriod: string;
  mode: Gstr13bReconciliationResult['mode'];
  severity: GstReconciliationAlertSeverity;
  summary: string;
  details: GstReconciliationAlertDetails;
  /** Live reconciliation result; if omitted, derived from `details` for quiet-hour / suppress checks. */
  result?: Gstr13bReconciliationResult;
  triggerReason: GstAlertNotifyTrigger;
  /** Manual / test: bypass cooldown, quiet hours, severity & quiet-mismatch+low filter */
  forceDelivery?: boolean;
};

/**
 * Sends email + WhatsApp per prefs, with cooldown and spam guards. Intended to be called without awaiting from sync.
 */
export async function deliverGstReconciliationAlertNotifications(
  input: DeliverGstAlertNotificationsInput
): Promise<void> {
  const branchKey = input.branchId ?? '';
  const resultForPolicy =
    input.result ??
    minimalGstr13bResultFromAlertDetails(input.details, input.mode, input.gstPeriod, branchKey);

  const prefs = await getGstAlertNotificationPrefsEffective(input.businessId, input.branchId);
  const recipients = parseRecipients(prefs.recipients as unknown[]);

  const skipLog = async (
    channel: 'email' | 'whatsapp',
    recipient: string,
    reason: string
  ): Promise<void> => {
    await insertNotificationLog({
      alertId: input.alertId,
      businessId: input.businessId,
      branchId: input.branchId,
      gstPeriod: input.gstPeriod,
      mode: input.mode,
      channel,
      recipient,
      status: 'skipped',
      error: reason,
      triggerReason: input.triggerReason,
    });
  };

  if (!prefs.email_enabled && !prefs.whatsapp_enabled) {
    await skipLog('email', '-', 'all_channels_disabled');
    return;
  }

  if (!input.forceDelivery) {
    if (!severityAllowed(input.severity, prefs)) {
      await skipLog('email', '-', 'severity_not_in_policy');
      return;
    }
    // Spec: skip noisy "quiet" mismatches only when severity is low (medium/high still notify).
    if (shouldSuppressGstAlertBanner(resultForPolicy) && input.severity === 'low') {
      await skipLog('email', '-', 'quiet_mismatch_low_severity');
      return;
    }
    if (
      isWithinGstAlertQuietHoursIST(prefs.quiet_hours_start, prefs.quiet_hours_end)
    ) {
      await skipLog('email', '-', 'quiet_hours_ist');
      return;
    }
    const last = await lastSuccessfulNotificationAt(
      input.businessId,
      input.branchId,
      input.gstPeriod,
      input.mode
    );
    if (last && prefs.cooldown_minutes > 0) {
      const delta = Date.now() - last.getTime();
      if (delta < prefs.cooldown_minutes * 60_000) {
        await skipLog('email', '-', `cooldown_${prefs.cooldown_minutes}m`);
        return;
      }
    }
  }

  if (recipients.length === 0) {
    await skipLog('email', '-', 'no_recipients');
    return;
  }

  const link = buildGstReconciliationReportLink({
    period: input.gstPeriod,
    mode: input.mode,
    branchId: input.branchId,
  });
  const subject = `GST Alert — ${input.severity.toUpperCase()} — ${input.gstPeriod}`;
  const html = buildEmailHtml({
    summary: input.summary,
    severity: input.severity,
    period: input.gstPeriod,
    mode: input.mode,
    link,
    details: input.details,
  });
  const waText = buildWhatsAppText({
    summary: input.summary,
    period: input.gstPeriod,
    primary: String(input.details.primary_issue),
    head: input.details.affected_head,
    link,
  });

  for (const r of recipients) {
    if (r.type === 'email' && prefs.email_enabled) {
      const emailResult = await sendBusinessEmail(input.businessId, {
        to: r.value.trim(),
        subject,
        html,
        text: waText,
      });
      const ok = emailResult.success;
      await insertNotificationLog({
        alertId: input.alertId,
        businessId: input.businessId,
        branchId: input.branchId,
        gstPeriod: input.gstPeriod,
        mode: input.mode,
        channel: 'email',
        recipient: r.value.trim(),
        status: ok ? 'sent' : 'failed',
        error: ok ? null : 'sendEmail_returned_false',
        triggerReason: input.triggerReason,
      });
    }
    if (r.type === 'whatsapp' && prefs.whatsapp_enabled) {
      try {
        await deliverWhatsApp(input.businessId, r.value, waText);
        await insertNotificationLog({
          alertId: input.alertId,
          businessId: input.businessId,
          branchId: input.branchId,
          gstPeriod: input.gstPeriod,
          mode: input.mode,
          channel: 'whatsapp',
          recipient: r.value.trim(),
          status: 'sent',
          error: null,
          triggerReason: input.triggerReason,
        });
      } catch (e: any) {
        await insertNotificationLog({
          alertId: input.alertId,
          businessId: input.businessId,
          branchId: input.branchId,
          gstPeriod: input.gstPeriod,
          mode: input.mode,
          channel: 'whatsapp',
          recipient: r.value.trim(),
          status: 'failed',
          error: e?.message || String(e),
          triggerReason: input.triggerReason,
        });
      }
    }
  }
}

/** Preferred entry name from product spec; same behavior as `deliverGstReconciliationAlertNotifications`. */
export const sendGstReconciliationNotifications = deliverGstReconciliationAlertNotifications;

export async function saveGstAlertNotificationPrefs(input: {
  businessId: string;
  branchId: string | null;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  notify_on: string[];
  include_low: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  cooldown_minutes: number;
  recipients: GstAlertRecipient[];
}): Promise<GstAlertNotificationPrefsRow> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM gst_alert_notification_prefs
     WHERE business_id = $1
       AND (
         ($2::uuid IS NOT NULL AND branch_id = $2)
         OR ($2 IS NULL AND branch_id IS NULL)
       )`,
    [input.businessId, input.branchId]
  );
  const recipientsJson = JSON.stringify(parseRecipients(input.recipients));
  const cd = Math.min(10080, Math.max(0, input.cooldown_minutes));

  if (existing) {
    await query(
      `UPDATE gst_alert_notification_prefs SET
         email_enabled = $2,
         whatsapp_enabled = $3,
         notify_on = $4,
         include_low = $5,
         quiet_hours_start = $6::time,
         quiet_hours_end = $7::time,
         cooldown_minutes = $8,
         recipients = $9::jsonb,
         updated_at = now()
       WHERE id = $1`,
      [
        existing.id,
        input.email_enabled,
        input.whatsapp_enabled,
        input.notify_on,
        input.include_low,
        input.quiet_hours_start,
        input.quiet_hours_end,
        cd,
        recipientsJson,
      ]
    );
  } else {
    await query(
      `INSERT INTO gst_alert_notification_prefs (
         business_id, branch_id, email_enabled, whatsapp_enabled, notify_on, include_low,
         quiet_hours_start, quiet_hours_end, cooldown_minutes, recipients
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::time, $8::time, $9, $10::jsonb)`,
      [
        input.businessId,
        input.branchId,
        input.email_enabled,
        input.whatsapp_enabled,
        input.notify_on,
        input.include_low,
        input.quiet_hours_start,
        input.quiet_hours_end,
        cd,
        recipientsJson,
      ]
    );
  }
  const row = await loadPrefsRow(input.businessId, input.branchId);
  if (!row) throw new Error('Failed to load prefs after save');
  return row;
}
