import { query, queryOne, queryRows } from '@/lib/db';
import { sendTextMessage } from '@/lib/meta-whatsapp';
import { sendPlatformEventWhatsApp } from '@/lib/platform-whatsapp-send';
import type { PlatformWaEventKey } from '@/lib/platform-whatsapp-templates';
import { insideSessionWindow } from './followups';
import {
  getLeadById,
  leadEvents,
  logLeadEvent,
  PIPELINE_STATUSES,
  recordOutbound,
  type FunnelLead,
  type PipelineStatus,
} from './leads';
import { leadVars } from './render';
import { FUNNEL_EVENT_KEYS } from './templates';

const FUNNEL_LEAD = `(l.wa_phone IS NOT NULL OR l.flow_step IS NOT NULL OR l.source_channel = 'meta_ad')`;

export type PipelineFilters = {
  status?: string | null;
  campaign?: string | null;
  adId?: string | null;
  assignedTo?: string | null;
  q?: string | null;
  page?: number;
  pageSize?: number;
};

export async function listPipelineLeads(f: PipelineFilters) {
  const where: string[] = [FUNNEL_LEAD];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.status && (PIPELINE_STATUSES as readonly string[]).includes(f.status)) add('l.pipeline_status = ?', f.status);
  if (f.campaign) add('(l.campaign_id = ? OR l.campaign_name = $' + (params.length + 1) + ')', f.campaign);
  if (f.adId) add('l.ad_id = ?', f.adId);
  if (f.assignedTo === 'none') where.push('l.assigned_to IS NULL');
  else if (f.assignedTo) add('l.assigned_to = ?', f.assignedTo);
  if (f.q?.trim()) {
    add(`(l.name ILIKE ? OR l.business_name ILIKE $${params.length + 1} OR l.phone ILIKE $${params.length + 1})`, `%${f.q.trim()}%`);
  }
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200);
  const page = Math.max(f.page ?? 1, 1);
  params.push(pageSize, (page - 1) * pageSize);
  const leads = await queryRows(
    `SELECT l.id, l.name, l.phone, l.business_name, l.business_type, l.pain_point, l.pipeline_status, l.flow_step,
            l.entry_key, l.ad_id, l.campaign_id, l.campaign_name, l.business_id, l.assigned_to, a.name AS assigned_name,
            l.last_inbound_at, l.last_outbound_at, l.opted_out_at, l.demo_sent_at, l.demo_read_at,
            l.trial_created_at, l.activated_at, l.converted_at, l.conversion_value, l.created_at
       FROM assistant_leads l
       LEFT JOIN platform_admins a ON a.id = l.assigned_to
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(l.last_inbound_at, l.created_at) DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const counts = await queryRows<{ pipeline_status: string; count: string }>(
    `SELECT pipeline_status, COUNT(*)::text AS count FROM assistant_leads l WHERE ${FUNNEL_LEAD} GROUP BY pipeline_status`,
  );
  return {
    leads,
    page,
    pageSize,
    counts: Object.fromEntries(counts.map((c) => [c.pipeline_status, Number(c.count)])),
  };
}

export async function leadDetail(id: string) {
  const lead = await getLeadById(id);
  if (!lead) return null;
  const [events, followups, extra] = await Promise.all([
    leadEvents(id, 500),
    queryRows(
      `SELECT id, kind, due_at, status, attempts, sent_via, error_message, updated_at
         FROM lead_followups WHERE lead_id = $1 ORDER BY due_at DESC LIMIT 50`,
      [id],
    ),
    queryOne<{ email: string | null; notes: string | null; ad_headline: string | null; ad_source_url: string | null; business_display: string | null }>(
      `SELECT l.email, l.notes, l.ad_headline, l.ad_source_url, b.name AS business_display
         FROM assistant_leads l LEFT JOIN businesses b ON b.id = l.business_id WHERE l.id = $1`,
      [id],
    ),
  ]);
  return {
    lead: { ...lead, ...extra },
    events,
    followups,
    windowOpen: insideSessionWindow(lead),
  };
}

export async function listAssignees() {
  return queryRows<{ id: string; name: string; email: string }>(
    `SELECT id, name, email FROM platform_admins WHERE is_active = true AND role IN ('support', 'admin', 'super_admin') ORDER BY name`,
  );
}

export async function assignLead(lead: FunnelLead, adminId: string | null, byAdminId: string): Promise<void> {
  if (adminId) {
    const exists = await queryOne(`SELECT 1 FROM platform_admins WHERE id = $1 AND is_active = true`, [adminId]);
    if (!exists) throw new Error('Salesperson not found');
  }
  await query(`UPDATE assistant_leads SET assigned_to = $2, updated_at = NOW() WHERE id = $1`, [lead.id, adminId]);
  await logLeadEvent(lead.id, 'assigned', { assigned_to: adminId, by: byAdminId });
}

/** Manual stage change from the pipeline board; unlike the bot this may move backwards. */
export async function adminSetStatus(lead: FunnelLead, to: PipelineStatus, byAdminId: string): Promise<void> {
  if (!(PIPELINE_STATUSES as readonly string[]).includes(to)) throw new Error('Unknown stage');
  if (lead.pipeline_status === to) return;
  await query(`UPDATE assistant_leads SET pipeline_status = $2, updated_at = NOW() WHERE id = $1`, [lead.id, to]);
  await logLeadEvent(lead.id, 'status', { reason: 'admin', by: byAdminId }, { fromStatus: lead.pipeline_status, toStatus: to });
  if (to === 'lost') await query(`UPDATE lead_followups SET status = 'cancelled', updated_at = NOW() WHERE lead_id = $1 AND status = 'pending'`, [lead.id]);
}

export async function updateLeadNotes(lead: FunnelLead, notes: string): Promise<void> {
  await query(`UPDATE assistant_leads SET notes = $2, updated_at = NOW() WHERE id = $1`, [lead.id, notes.slice(0, 5000)]);
}

function leadPhone(lead: FunnelLead): string {
  const phone = (lead.wa_phone || (lead.phone && lead.phone.length === 10 ? `91${lead.phone}` : lead.phone) || '').replace(/\D/g, '');
  if (!phone) throw new Error('Lead has no WhatsApp number');
  return phone;
}

/** A message typed by sales; only allowed while the lead's 24-hour window is open. */
export async function sendManualMessage(lead: FunnelLead, text: string, byAdminId: string): Promise<void> {
  const body = text.trim();
  if (!body) throw new Error('Message is empty');
  if (body.length > 4096) throw new Error('Message is too long (WhatsApp allows 4096 characters)');
  if (lead.opted_out_at) throw new Error('This lead opted out of messages');
  if (!insideSessionWindow(lead)) throw new Error('The 24-hour window is closed; send an approved template instead');
  const { messageId } = await sendTextMessage({ to: leadPhone(lead), body });
  await recordOutbound(lead, messageId, body);
  await logLeadEvent(lead.id, 'manual_message', { by: byAdminId, message_id: messageId });
}

/** Approved funnel template, for reaching a lead after the 24-hour window. */
export async function sendLeadTemplate(lead: FunnelLead, eventKey: string, byAdminId: string): Promise<void> {
  if (!(FUNNEL_EVENT_KEYS as string[]).includes(eventKey)) throw new Error('Unknown template');
  if (lead.opted_out_at) throw new Error('This lead opted out of messages');
  const vars = leadVars(lead);
  const res = await sendPlatformEventWhatsApp({
    eventKey: eventKey as PlatformWaEventKey,
    toPhone: leadPhone(lead),
    vars: [vars.first_name],
  });
  if (!res.sent) {
    const reasons: Record<string, string> = {
      NO_APPROVED_TEMPLATE: 'This template is not approved by Meta yet',
      NO_HEADER_MEDIA: 'The header image or video for this template is missing',
      META_WA_NOT_CONFIGURED: 'WhatsApp is not configured',
      SEND_FAILED: 'WhatsApp rejected the message; check Logs for the reason',
    };
    throw new Error(reasons[res.skipped ?? ''] ?? `Not sent: ${res.skipped}`);
  }
  await recordOutbound(lead, res.messageId ?? null, `[template ${eventKey}]`);
  await logLeadEvent(lead.id, 'manual_template', { by: byAdminId, event_key: eventKey, message_id: res.messageId ?? null });
}

export type FunnelMetricsRow = {
  campaign: string;
  ad_id: string | null;
  leads: number;
  qualified: number;
  demo: number;
  demo_read: number;
  trial: number;
  activated: number;
  converted: number;
  lost: number;
  revenue: number;
};

/** Funnel counts per campaign and ad for leads created in the last `days` days. */
export async function funnelMetrics(days: number): Promise<{ totals: FunnelMetricsRow; rows: FunnelMetricsRow[] }> {
  const d = Math.min(Math.max(Math.round(days) || 30, 1), 730);
  const rows = await queryRows<Record<string, string | null>>(
    `SELECT COALESCE(l.campaign_name, l.campaign_id, CASE WHEN l.ad_id IS NULL THEN 'Organic / no ad' ELSE 'Unmapped ad' END) AS campaign,
            l.ad_id,
            COUNT(*)::text AS leads,
            COUNT(*) FILTER (WHERE l.qualified_at IS NOT NULL OR l.pipeline_status IN ('qualified','demo_interested','trial_created','activated','converted'))::text AS qualified,
            COUNT(*) FILTER (WHERE l.demo_sent_at IS NOT NULL)::text AS demo,
            COUNT(*) FILTER (WHERE l.demo_read_at IS NOT NULL)::text AS demo_read,
            COUNT(*) FILTER (WHERE l.trial_created_at IS NOT NULL)::text AS trial,
            COUNT(*) FILTER (WHERE l.activated_at IS NOT NULL)::text AS activated,
            COUNT(*) FILTER (WHERE l.converted_at IS NOT NULL)::text AS converted,
            COUNT(*) FILTER (WHERE l.pipeline_status = 'lost')::text AS lost,
            COALESCE(SUM(l.conversion_value), 0)::text AS revenue
       FROM assistant_leads l
      WHERE ${FUNNEL_LEAD} AND l.created_at >= NOW() - ($1::int * INTERVAL '1 day')
      GROUP BY 1, 2
      ORDER BY COUNT(*) DESC
      LIMIT 200`,
    [d],
  );
  const num = (v: string | null | undefined) => Number(v) || 0;
  const mapped: FunnelMetricsRow[] = rows.map((r) => ({
    campaign: String(r.campaign),
    ad_id: r.ad_id,
    leads: num(r.leads),
    qualified: num(r.qualified),
    demo: num(r.demo),
    demo_read: num(r.demo_read),
    trial: num(r.trial),
    activated: num(r.activated),
    converted: num(r.converted),
    lost: num(r.lost),
    revenue: num(r.revenue),
  }));
  const totals = mapped.reduce<FunnelMetricsRow>(
    (t, r) => ({
      ...t,
      leads: t.leads + r.leads,
      qualified: t.qualified + r.qualified,
      demo: t.demo + r.demo,
      demo_read: t.demo_read + r.demo_read,
      trial: t.trial + r.trial,
      activated: t.activated + r.activated,
      converted: t.converted + r.converted,
      lost: t.lost + r.lost,
      revenue: t.revenue + r.revenue,
    }),
    { campaign: 'All', ad_id: null, leads: 0, qualified: 0, demo: 0, demo_read: 0, trial: 0, activated: 0, converted: 0, lost: 0, revenue: 0 },
  );
  return { totals, rows: mapped };
}

export type AdMapping = { ad_id: string; campaign_id: string | null; campaign_name: string | null; ad_name: string | null; entry_key: string | null };

export async function listAdMappings() {
  return queryRows<AdMapping & { leads: string; updated_at: string }>(
    `SELECT m.ad_id, m.campaign_id, m.campaign_name, m.ad_name, m.entry_key, m.updated_at,
            (SELECT COUNT(*) FROM assistant_leads l WHERE l.ad_id = m.ad_id)::text AS leads
       FROM meta_ad_mappings m ORDER BY m.updated_at DESC`,
  );
}

/** Ad ids seen on leads that have no mapping yet, so they can be named. */
export async function unmappedAds() {
  return queryRows<{ ad_id: string; headline: string | null; leads: string; last_seen: string }>(
    `SELECT l.ad_id, MAX(l.ad_headline) AS headline, COUNT(*)::text AS leads, MAX(l.created_at) AS last_seen
       FROM assistant_leads l
      WHERE l.ad_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meta_ad_mappings m WHERE m.ad_id = l.ad_id)
      GROUP BY l.ad_id ORDER BY MAX(l.created_at) DESC LIMIT 100`,
  );
}

const AD_ID_RE = /^[0-9A-Za-z_-]{1,64}$/;

/** Saves the mapping and back-fills campaign details on leads from that ad. */
export async function upsertAdMapping(m: AdMapping): Promise<void> {
  const adId = m.ad_id.trim();
  if (!AD_ID_RE.test(adId)) throw new Error('Ad id must be the numeric id from Ads Manager');
  const clean = (v: string | null, max: number) => (v && v.trim() ? v.trim().slice(0, max) : null);
  const campaignId = clean(m.campaign_id, 64);
  const campaignName = clean(m.campaign_name, 255);
  await query(
    `INSERT INTO meta_ad_mappings (ad_id, campaign_id, campaign_name, ad_name, entry_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ad_id) DO UPDATE SET
       campaign_id = EXCLUDED.campaign_id, campaign_name = EXCLUDED.campaign_name,
       ad_name = EXCLUDED.ad_name, entry_key = EXCLUDED.entry_key, updated_at = NOW()`,
    [adId, campaignId, campaignName, clean(m.ad_name, 255), clean(m.entry_key, 64)],
  );
  await query(
    `UPDATE assistant_leads SET campaign_id = $2, campaign_name = $3, updated_at = NOW() WHERE ad_id = $1`,
    [adId, campaignId, campaignName],
  );
}

export async function deleteAdMapping(adId: string): Promise<boolean> {
  const res = await query(`DELETE FROM meta_ad_mappings WHERE ad_id = $1`, [adId]);
  return (res.rowCount ?? 0) > 0;
}
