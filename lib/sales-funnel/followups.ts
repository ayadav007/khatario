import { query, queryRows } from '@/lib/db';
import { PLATFORM_WA_EVENT_KEYS, type PlatformWaEventKey } from '@/lib/platform-whatsapp-templates';
import { findStep, isWaitingStep, stepMessages, type FlowDefinition, type FlowFollowup, type FlowMessage } from './definition';
import { HANDED_OFF } from './engine';
import { cancelFollowups, getLeadById, leadContext, logLeadEvent, recordOutbound, setPipelineStatus, type FunnelLead } from './leads';
import { mediaRefForSend } from './media';
import { leadVars, sendFlowMessage } from './render';
import { getPublishedFlow } from './store';

/** Free-form messages only inside 24 hours of the lead's last message; keep a safety margin. */
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000 - 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_MS = 30 * 60 * 1000;
const UNRESPONSIVE_DAYS = 21;

type DueRow = { id: string; lead_id: string; kind: string; created_at: string | Date; attempts: number };

export type FollowupRunReport = { due: number; sent: number; skipped: number; cancelled: number; failed: number };

export function insideSessionWindow(lead: Pick<FunnelLead, 'last_inbound_at'>, now = Date.now()): boolean {
  if (!lead.last_inbound_at) return false;
  return now - new Date(lead.last_inbound_at).getTime() < SESSION_WINDOW_MS;
}

const PRE_TRIAL = new Set(['new', 'qualified', 'demo_interested']);

export function followupConditionMet(f: Pick<FlowFollowup, 'condition'>, lead: FunnelLead, scheduledAt: Date): boolean {
  switch (f.condition) {
    case 'no_reply': {
      const lastIn = lead.last_inbound_at ? new Date(lead.last_inbound_at).getTime() : 0;
      return lastIn <= scheduledAt.getTime() && lead.flow_step !== HANDED_OFF && PRE_TRIAL.has(lead.pipeline_status);
    }
    case 'no_trial':
      return !lead.business_id && PRE_TRIAL.has(lead.pipeline_status) && lead.flow_step !== HANDED_OFF;
    case 'no_invoice':
      return Boolean(lead.business_id) && !lead.activated_at;
    case 'activated_not_paid':
      return Boolean(lead.activated_at) && !lead.converted_at;
    default:
      return false;
  }
}

async function finish(id: string, status: 'sent' | 'skipped' | 'cancelled' | 'failed', via: string | null, error: string | null) {
  await query(
    `UPDATE lead_followups SET status = $2, sent_via = $3, error_message = $4, updated_at = NOW() WHERE id = $1`,
    [id, status, via, error?.slice(0, 500) ?? null],
  );
}

async function sendSessionFollowup(flow: FlowDefinition, f: FlowFollowup, lead: FunnelLead, to: string): Promise<number> {
  const vars = leadVars(lead);
  const messages: FlowMessage[] = [...(f.messages || [])];
  if (f.repeatCurrentStep) {
    const step = findStep(flow, lead.flow_step);
    if (step && isWaitingStep(step, leadContext(lead))) {
      const msgs = stepMessages(step, leadContext(lead));
      const prompt = [...msgs].reverse().find((m) => m.type === 'buttons' || m.type === 'list') ?? (step.collect ? msgs[msgs.length - 1] : null);
      if (prompt) messages.push(prompt);
    }
  }
  let sent = 0;
  for (const m of messages) {
    for (const s of await sendFlowMessage(to, m, vars)) {
      sent += 1;
      await recordOutbound(lead, s.messageId, s.summary);
    }
  }
  return sent;
}

async function sendTemplateFollowup(f: FlowFollowup, lead: FunnelLead, to: string): Promise<{ sent: boolean; reason: string | null }> {
  const key = f.templateEventKey as PlatformWaEventKey;
  if (!PLATFORM_WA_EVENT_KEYS.includes(key)) return { sent: false, reason: 'UNKNOWN_TEMPLATE_EVENT' };
  const vars = leadVars(lead);
  const values = (f.templateVars || []).map((v) => vars[v] ?? '');
  const mediaKey = lead.pain_point ? f.headerMediaByPainPoint?.[lead.pain_point] : undefined;
  const headerMedia = mediaKey ? await mediaRefForSend(mediaKey).catch(() => null) : null;
  const { sendPlatformEventWhatsApp } = await import('@/lib/platform-whatsapp-send');
  const res = await sendPlatformEventWhatsApp({ eventKey: key, toPhone: to, vars: values, headerMedia });
  if (res.sent) await recordOutbound(lead, res.messageId ?? null, `[template ${key}] ${values.join(', ')}`);
  return { sent: res.sent, reason: res.skipped };
}

async function processOne(flow: FlowDefinition, row: DueRow, report: FollowupRunReport): Promise<void> {
  const f = flow.followups.find((x) => x.kind === row.kind);
  const lead = await getLeadById(row.lead_id);
  if (!f || !f.enabled || !lead) {
    report.cancelled += 1;
    return finish(row.id, 'cancelled', null, !f ? 'follow-up removed from flow' : !f.enabled ? 'disabled' : 'lead missing');
  }
  if (lead.opted_out_at) {
    report.cancelled += 1;
    return finish(row.id, 'cancelled', null, 'opted out');
  }
  if (!followupConditionMet(f, lead, new Date(row.created_at))) {
    report.skipped += 1;
    return finish(row.id, 'skipped', null, `condition ${f.condition} not met`);
  }
  const to = lead.wa_phone || lead.phone;
  if (!to) {
    report.skipped += 1;
    return finish(row.id, 'skipped', null, 'no phone');
  }

  try {
    const canSession = insideSessionWindow(lead) && (Boolean(f.messages?.length) || Boolean(f.repeatCurrentStep));
    if (canSession) {
      const n = await sendSessionFollowup(flow, f, lead, to);
      if (n > 0) {
        report.sent += 1;
        await logLeadEvent(lead.id, 'followup', { kind: f.kind, via: 'session' });
        return finish(row.id, 'sent', 'session', null);
      }
    }
    if (f.templateEventKey) {
      const res = await sendTemplateFollowup(f, lead, to);
      if (res.sent) {
        report.sent += 1;
        await logLeadEvent(lead.id, 'followup', { kind: f.kind, via: 'template' });
        return finish(row.id, 'sent', 'template', null);
      }
      if (res.reason === 'SEND_FAILED') throw new Error('Template send failed');
      report.skipped += 1;
      return finish(row.id, 'skipped', null, res.reason || 'template not sent');
    }
    report.skipped += 1;
    return finish(row.id, 'skipped', null, 'outside 24-hour window and no template');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (row.attempts < MAX_ATTEMPTS) {
      await query(`UPDATE lead_followups SET due_at = NOW() + ($2 || ' milliseconds')::interval, error_message = $3, updated_at = NOW() WHERE id = $1`, [
        row.id,
        String(RETRY_MS),
        msg.slice(0, 500),
      ]);
      return;
    }
    report.failed += 1;
    return finish(row.id, 'failed', null, msg);
  }
}

/** Claims due follow-ups (skip-locked, attempt counted) and sends them. */
export async function runDueFollowups(limit = 100): Promise<FollowupRunReport> {
  const report: FollowupRunReport = { due: 0, sent: 0, skipped: 0, cancelled: 0, failed: 0 };
  const rows = await queryRows<DueRow>(
    `UPDATE lead_followups SET attempts = attempts + 1, updated_at = NOW()
      WHERE id IN (
        SELECT id FROM lead_followups WHERE status = 'pending' AND due_at <= NOW()
         ORDER BY due_at LIMIT $1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, lead_id, kind, created_at, attempts`,
    [limit],
  );
  report.due = rows.length;
  if (rows.length === 0) return report;
  const { flow } = await getPublishedFlow();
  for (const row of rows) {
    await processOne(flow, row, report).catch((err) => {
      report.failed += 1;
      console.error('[sales-funnel] follow-up failed', row.kind, err instanceof Error ? err.message : err);
    });
  }
  return report;
}

/**
 * Activation = the linked business has its first real invoice; conversion = an active paid plan.
 * Both come from Khatario's own tables, never from the conversation.
 */
export async function runLifecycleChecks(): Promise<{ activated: number; converted: number; lost: number }> {
  const out = { activated: 0, converted: 0, lost: 0 };
  const toActivate = await queryRows<FunnelLead>(
    `SELECT l.* FROM assistant_leads l
      WHERE l.business_id IS NOT NULL AND l.activated_at IS NULL
        AND EXISTS (
          SELECT 1 FROM invoices i
           WHERE i.business_id = l.business_id AND i.deleted_at IS NULL
             AND COALESCE(i.document_type, 'tax_invoice') NOT IN ('proforma_invoice', 'estimate', 'quotation', 'delivery_challan')
        )
      LIMIT 500`,
  );
  for (const lead of toActivate) {
    if (await setPipelineStatus(lead, 'activated', 'first_invoice')) out.activated += 1;
    await query(`UPDATE assistant_leads SET activated_at = COALESCE(activated_at, NOW()) WHERE id = $1`, [lead.id]);
  }

  const toConvert = await queryRows<FunnelLead & { plan_value: string | null }>(
    `SELECT l.*, (
        SELECT CASE WHEN bs.billing_cycle = 'yearly' THEN p.price_yearly ELSE p.price_monthly END
          FROM business_subscriptions bs JOIN subscription_plans p ON p.id = bs.plan_id
         WHERE bs.business_id = l.business_id AND bs.status = 'active'
           AND (COALESCE(p.price_monthly, 0) > 0 OR COALESCE(p.price_yearly, 0) > 0)
         ORDER BY bs.updated_at DESC LIMIT 1
      ) AS plan_value
      FROM assistant_leads l
     WHERE l.business_id IS NOT NULL AND l.converted_at IS NULL
     LIMIT 500`,
  );
  for (const lead of toConvert) {
    if (lead.plan_value == null) continue;
    if (await setPipelineStatus(lead, 'converted', 'paid_subscription', { conversionValue: Number(lead.plan_value) })) {
      out.converted += 1;
      await cancelFollowups(lead.id);
    }
    await query(`UPDATE assistant_leads SET converted_at = COALESCE(converted_at, NOW()) WHERE id = $1`, [lead.id]);
  }

  const stale = await queryRows<FunnelLead>(
    `SELECT l.* FROM assistant_leads l
      WHERE l.flow_step IS NOT NULL AND l.pipeline_status IN ('new', 'qualified', 'demo_interested')
        AND COALESCE(l.last_inbound_at, l.created_at) < NOW() - ($1 || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM lead_followups f WHERE f.lead_id = l.id AND f.status = 'pending')
      LIMIT 500`,
    [String(UNRESPONSIVE_DAYS)],
  );
  for (const lead of stale) {
    if (await setPipelineStatus(lead, 'lost', 'unresponsive')) out.lost += 1;
  }
  return out;
}
