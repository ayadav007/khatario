import { query, queryOne, queryRows } from '@/lib/db';
import { normalizeIndianMobile } from '@/lib/rag/actions/leads';
import type { LeadContext, LeadField } from './definition';

export const PIPELINE_STATUSES = ['new', 'qualified', 'demo_interested', 'trial_created', 'activated', 'converted', 'lost'] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

const RANK: Record<PipelineStatus, number> = {
  new: 0,
  qualified: 1,
  demo_interested: 2,
  trial_created: 3,
  activated: 4,
  converted: 5,
  lost: -1,
};

/** The older Leads tab status, kept in step so existing views stay meaningful. */
const LEGACY_STATUS: Record<PipelineStatus, string> = {
  new: 'new',
  qualified: 'contacted',
  demo_interested: 'contacted',
  trial_created: 'trial_started',
  activated: 'trial_started',
  converted: 'converted',
  lost: 'lost',
};
const LEGACY_RANK: Record<string, number> = { new: 0, contacted: 1, demo_booked: 2, trial_started: 3, converted: 4, lost: -1 };

const STATUS_TIMESTAMP: Partial<Record<PipelineStatus, string>> = {
  qualified: 'qualified_at',
  trial_created: 'trial_created_at',
  activated: 'activated_at',
  converted: 'converted_at',
};

export type FlowData = {
  profile_name?: string | null;
  reasks?: number;
  last_handoff_notify_at?: string;
  signup_token_issued_at?: string;
};

export type FunnelLead = {
  id: string;
  name: string | null;
  phone: string | null;
  wa_phone: string | null;
  business_name: string | null;
  business_type: string | null;
  pain_point: string | null;
  city: string | null;
  status: string;
  pipeline_status: PipelineStatus;
  flow_step: string | null;
  flow_version: number | null;
  flow_data: FlowData;
  entry_key: string | null;
  ad_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  ctwa_clid: string | null;
  business_id: string | null;
  last_inbound_at: string | Date | null;
  last_outbound_at: string | Date | null;
  last_funnel_message_id: string | null;
  demo_sent_at: string | Date | null;
  demo_read_at: string | Date | null;
  opted_out_at: string | Date | null;
  trial_created_at: string | Date | null;
  activated_at: string | Date | null;
  converted_at: string | Date | null;
  created_at: string | Date;
};

/** Lead phone key: 10-digit Indian mobile when possible, otherwise all digits. */
export function leadPhoneKey(waPhone: string): string {
  const digits = waPhone.replace(/\D/g, '');
  return normalizeIndianMobile(digits) ?? digits;
}

export function leadContext(lead: FunnelLead): LeadContext {
  return {
    business_type: lead.business_type,
    pain_point: lead.pain_point,
    business_name: lead.business_name,
    owner_name: lead.name,
    city: lead.city,
  };
}

const FIELD_COLUMN: Record<LeadField, string> = {
  business_type: 'business_type',
  pain_point: 'pain_point',
  business_name: 'business_name',
  owner_name: 'name',
  city: 'city',
};

export async function getLeadByPhone(waPhone: string): Promise<FunnelLead | null> {
  return queryOne<FunnelLead>(`SELECT * FROM assistant_leads WHERE phone = $1`, [leadPhoneKey(waPhone)]);
}

export async function getLeadById(id: string): Promise<FunnelLead | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return queryOne<FunnelLead>(`SELECT * FROM assistant_leads WHERE id = $1`, [id]);
}

/** One lead per phone; a message also refreshes the 24-hour window clock. */
export async function upsertInboundLead(waPhone: string, profileName: string | null): Promise<{ lead: FunnelLead; isNew: boolean }> {
  const digits = waPhone.replace(/\D/g, '');
  const row = await queryOne<FunnelLead & { inserted: boolean }>(
    `INSERT INTO assistant_leads (phone, wa_phone, source_channel, flow_data, last_inbound_at)
     VALUES ($1, $2, 'whatsapp', jsonb_build_object('profile_name', $3::text), NOW())
     ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET
       wa_phone = COALESCE(assistant_leads.wa_phone, EXCLUDED.wa_phone),
       flow_data = CASE WHEN $3::text IS NULL THEN assistant_leads.flow_data
                        ELSE assistant_leads.flow_data || jsonb_build_object('profile_name', $3::text) END,
       last_inbound_at = NOW(),
       updated_at = NOW()
     RETURNING *, (xmax = 0) AS inserted`,
    [leadPhoneKey(digits), digits, profileName?.trim().slice(0, 100) || null],
  );
  if (!row) throw new Error('Could not save lead');
  const { inserted, ...lead } = row;
  return { lead: lead as FunnelLead, isNew: inserted };
}

export async function logLeadEvent(
  leadId: string,
  kind: string,
  detail: Record<string, unknown> = {},
  change: { fromStep?: string | null; toStep?: string | null; fromStatus?: string | null; toStatus?: string | null } = {},
): Promise<void> {
  await query(
    `INSERT INTO lead_events (lead_id, kind, from_step, to_step, from_status, to_status, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [leadId, kind, change.fromStep ?? null, change.toStep ?? null, change.fromStatus ?? null, change.toStatus ?? null, JSON.stringify(detail)],
  ).catch((err) => console.warn('[sales-funnel] event log failed', err instanceof Error ? err.message : err));
}

export async function setLeadFields(lead: FunnelLead, fields: Partial<Record<LeadField, string>>): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [lead.id];
  for (const [field, value] of Object.entries(fields)) {
    const col = FIELD_COLUMN[field as LeadField];
    if (!col || value == null) continue;
    values.push(String(value).trim().slice(0, field === 'business_name' ? 255 : 100));
    sets.push(`${col} = $${values.length}`);
    (lead as Record<string, unknown>)[col] = values[values.length - 1];
  }
  if (sets.length === 0) return;
  await query(`UPDATE assistant_leads SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, values);
  await logLeadEvent(lead.id, 'field', fields);
}

export async function setLeadStep(lead: FunnelLead, step: string | null, version: number | null, reason: string): Promise<void> {
  if (lead.flow_step === step && lead.flow_version === version) return;
  const from = lead.flow_step;
  await query(`UPDATE assistant_leads SET flow_step = $2, flow_version = $3, updated_at = NOW() WHERE id = $1`, [lead.id, step, version]);
  lead.flow_step = step;
  lead.flow_version = version;
  await logLeadEvent(lead.id, 'step', { reason }, { fromStep: from, toStep: step });
}

export async function mergeFlowData(lead: FunnelLead, patch: FlowData): Promise<void> {
  await query(`UPDATE assistant_leads SET flow_data = flow_data || $2::jsonb, updated_at = NOW() WHERE id = $1`, [lead.id, JSON.stringify(patch)]);
  lead.flow_data = { ...(lead.flow_data || {}), ...patch };
}

/**
 * Pipeline only moves forward (lost is the exception, and any later progress reopens a lost lead).
 * Returns true when the status changed.
 */
export async function setPipelineStatus(
  lead: FunnelLead,
  to: PipelineStatus,
  reason: string,
  extra: { conversionValue?: number | null } = {},
): Promise<boolean> {
  const from = lead.pipeline_status;
  if (from === to) return false;
  if (to !== 'lost' && from !== 'lost' && RANK[to] <= RANK[from]) return false;
  if (to === 'lost' && (from === 'converted' || from === 'activated' || from === 'trial_created')) return false;

  const tsCol = STATUS_TIMESTAMP[to];
  const legacy = LEGACY_STATUS[to];
  const keepLegacy = to !== 'lost' && (LEGACY_RANK[lead.status] ?? 0) >= (LEGACY_RANK[legacy] ?? 0);
  await query(
    `UPDATE assistant_leads SET
       pipeline_status = $2,
       status = $3,
       ${tsCol ? `${tsCol} = COALESCE(${tsCol}, NOW()),` : ''}
       conversion_value = COALESCE($4, conversion_value),
       updated_at = NOW()
     WHERE id = $1`,
    [lead.id, to, keepLegacy ? lead.status : legacy, extra.conversionValue ?? null],
  );
  lead.pipeline_status = to;
  if (!keepLegacy) lead.status = legacy;
  await logLeadEvent(lead.id, 'status', { reason }, { fromStatus: from, toStatus: to });
  return true;
}

export async function recordOutbound(lead: FunnelLead, messageId: string | null, summary: string): Promise<void> {
  await query(
    `UPDATE assistant_leads SET last_outbound_at = NOW(), last_funnel_message_id = COALESCE($2, last_funnel_message_id), updated_at = NOW()
      WHERE id = $1`,
    [lead.id, messageId],
  );
  lead.last_outbound_at = new Date();
  if (messageId) lead.last_funnel_message_id = messageId;
  await logLeadEvent(lead.id, 'outbound', { text: summary.slice(0, 2000), message_id: messageId });
}

export async function recordInboundEvent(lead: FunnelLead, text: string, replyId: string | null, messageId: string): Promise<void> {
  await logLeadEvent(lead.id, 'inbound', { text: text.slice(0, 2000), reply_id: replyId, message_id: messageId });
}

/** Each follow-up kind is sent at most once per lead; rescheduling moves the pending one. */
export async function scheduleFollowup(leadId: string, kind: string, dueAt: Date): Promise<void> {
  await query(
    `INSERT INTO lead_followups (lead_id, kind, due_at)
     SELECT $1::uuid, $2::varchar, $3::timestamptz
      WHERE NOT EXISTS (SELECT 1 FROM lead_followups WHERE lead_id = $1::uuid AND kind = $2::varchar AND status = 'sent')
     ON CONFLICT (lead_id, kind) WHERE status = 'pending'
     DO UPDATE SET due_at = EXCLUDED.due_at, updated_at = NOW()`,
    [leadId, kind, dueAt],
  );
}

export async function cancelFollowups(leadId: string, kinds?: string[]): Promise<number> {
  const res = await query(
    `UPDATE lead_followups SET status = 'cancelled', updated_at = NOW()
      WHERE lead_id = $1 AND status = 'pending' AND ($2::text[] IS NULL OR kind = ANY($2::text[]))`,
    [leadId, kinds && kinds.length ? kinds : null],
  );
  return res.rowCount ?? 0;
}

export async function setOptOut(lead: FunnelLead, optedOut: boolean): Promise<void> {
  await query(`UPDATE assistant_leads SET opted_out_at = ${optedOut ? 'NOW()' : 'NULL'}, updated_at = NOW() WHERE id = $1`, [lead.id]);
  lead.opted_out_at = optedOut ? new Date() : null;
  if (optedOut) await cancelFollowups(lead.id);
  await logLeadEvent(lead.id, optedOut ? 'opt_out' : 'opt_in');
}

export async function applyAttribution(
  lead: FunnelLead,
  input: { adId: string | null; sourceType: string | null; sourceUrl: string | null; headline: string | null; ctwaClid: string | null },
): Promise<void> {
  if (!input.adId && !input.ctwaClid && !input.sourceUrl) return;
  const mapping = input.adId
    ? await queryOne<{ campaign_id: string | null; campaign_name: string | null }>(
        `SELECT campaign_id, campaign_name FROM meta_ad_mappings WHERE ad_id = $1`,
        [input.adId],
      ).catch(() => null)
    : null;
  await query(
    `UPDATE assistant_leads SET
       ad_id = COALESCE(ad_id, $2), ad_source_type = COALESCE(ad_source_type, $3), ad_source_url = COALESCE(ad_source_url, $4),
       ad_headline = COALESCE(ad_headline, $5), ctwa_clid = COALESCE(ctwa_clid, $6),
       campaign_id = COALESCE(campaign_id, $7), campaign_name = COALESCE(campaign_name, $8),
       source_channel = 'meta_ad', updated_at = NOW()
     WHERE id = $1`,
    [lead.id, input.adId, input.sourceType, input.sourceUrl, input.headline?.slice(0, 500) ?? null, input.ctwaClid, mapping?.campaign_id ?? null, mapping?.campaign_name ?? null],
  );
  lead.ad_id = lead.ad_id ?? input.adId;
  lead.ctwa_clid = lead.ctwa_clid ?? input.ctwaClid;
  await logLeadEvent(lead.id, 'attribution', { ad_id: input.adId, source_type: input.sourceType, source_url: input.sourceUrl, headline: input.headline });
}

export async function adEntryKey(adId: string | null): Promise<string | null> {
  if (!adId) return null;
  const row = await queryOne<{ entry_key: string | null }>(`SELECT entry_key FROM meta_ad_mappings WHERE ad_id = $1`, [adId]).catch(() => null);
  return row?.entry_key ?? null;
}

export async function leadEvents(leadId: string, limit = 300) {
  return queryRows<{ id: string; kind: string; from_step: string | null; to_step: string | null; from_status: string | null; to_status: string | null; detail: Record<string, unknown>; created_at: string }>(
    `SELECT id, kind, from_step, to_step, from_status, to_status, detail, created_at FROM lead_events
      WHERE lead_id = $1 ORDER BY created_at ASC, id ASC LIMIT $2`,
    [leadId, limit],
  );
}
