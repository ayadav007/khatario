/**
 * Where Connect leads come from, and what happens to each new one.
 *
 * - Click-to-WhatsApp ads: Meta sends a referral on the first message (Cloud API only).
 * - Tracked links / QR / website button: the link's code rides in the prefilled message,
 *   so it is matched on the first message for Cloud API and QR-linked numbers alike.
 * - IndiaMART: buy-leads pulled with the business's CRM key (cron, at most every 5 minutes).
 * - Inbound webhook: anything that can POST JSON (JustDial or Facebook Lead Ads via Zapier/Make).
 *
 * The source is first touch: it is set when the lead opens and never overwritten. Each new lead lands
 * on the pipeline (the source's stage, else the first open stage) with the source's labels and agent.
 * Inbound messages open leads in lib/leads/inbound.ts; this file finds the link a message came from.
 * Business identity always comes from the link code, token or session — never the request body.
 */
import { createHash, randomBytes } from 'crypto';
import { query, queryOne, queryRows } from '@/lib/db';
import { decryptSecret, encryptSecret } from '@/lib/secret-encryption';
import { isEligibleInboxAgent } from '@/lib/whatsapp/inbox-ownership';
import { addImportToLead, LeadError, openLead } from '@/lib/leads/core';
import { normalizeLeadPhone } from '@/lib/leads/phone';

export { normalizeLeadPhone };

export const LEAD_SOURCES = ['ctwa_ad', 'link', 'indiamart', 'lead_api'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABEL: Record<LeadSource | 'direct', string> = {
  ctwa_ad: 'WhatsApp ad',
  link: 'Link / QR',
  indiamart: 'IndiaMART',
  lead_api: 'Lead webhook',
  direct: 'Direct',
};

export class LeadSourceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 429,
    readonly code: string,
  ) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** No 0/O/1/I/L so a code read off a poster is typed correctly. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;
/** "(ref K7Q2MX)" as written by our links; tolerant of what customers do to it. */
const REF_RE = /\bref[\s:#-]+([A-HJ-NP-Z2-9]{6})\b/i;

export interface Routing {
  stageId?: string | null;
  assignTo?: string | null;
  labelIds?: string[];
}

// ---------------------------------------------------------------- inbound attribution

export interface AdReferral {
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body?: string | null;
  ctwaClid: string | null;
}

/** An ad that opened a lead counts only if the lead opened this recently (with the ad's message). */
const AD_CREDIT_MINUTES = 10;

/**
 * A Click-to-WhatsApp ad (or boosted post) brought this message. Runs after the message is stored:
 * the chat's phone gets a lead (the open one, else a new one), and the ad becomes its source only when
 * the lead has none and opened in the last few minutes, i.e. this message opened it.
 */
export async function applyAdReferral(businessId: string, conversationId: string, ref: AdReferral): Promise<void> {
  const detail = {
    ad_id: ref.sourceId,
    type: ref.sourceType,
    url: ref.sourceUrl,
    headline: ref.headline ? ref.headline.slice(0, 200) : null,
    ctwa_clid: ref.ctwaClid,
  };
  const chat = await queryOne<{ from_number: string; name: string | null; is_group: boolean | null }>(
    `SELECT from_number, NULLIF(whatsapp_display_name, '') AS name, is_group FROM whatsapp_conversations WHERE id = $1::uuid AND business_id = $2`,
    [conversationId, businessId],
  );
  if (!chat || chat.is_group) return;
  const { lead, created } = await openLead(businessId, {
    phone: chat.from_number,
    name: chat.name,
    conversationId,
    source: 'ctwa_ad',
    sourceDetail: detail,
    actor: { source: 'auto' },
  });
  if (created) return;
  await query(
    `UPDATE leads SET source = 'ctwa_ad', source_detail = $3::jsonb, source_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid AND business_id = $2 AND source IS NULL
        AND opened_at >= NOW() - ($4::int * INTERVAL '1 minute')`,
    [lead.id, businessId, JSON.stringify(detail), AD_CREDIT_MINUTES],
  );
}

export function extractRefCode(text: string | null | undefined): string | null {
  const m = text ? REF_RE.exec(text) : null;
  return m ? m[1].toUpperCase() : null;
}

/** The link (and its routing) whose code a message carries, if it is one of this business's links. */
export async function linkRoutingForText(
  businessId: string,
  text: string | null | undefined,
): Promise<{ linkId: string; name: string; code: string; stageId: string | null; ownerId: string | null; labelIds: string[] } | null> {
  const code = extractRefCode(text);
  if (!code) return null;
  const link = await queryOne<{ id: string; name: string; stage_id: string | null; assign_to: string | null; label_ids: string[] }>(
    `SELECT id::text AS id, name, stage_id::text AS stage_id, assign_to::text AS assign_to, label_ids::text[] AS label_ids
       FROM whatsapp_entry_links WHERE code = $1 AND business_id = $2`,
    [code, businessId],
  );
  if (!link) return null;
  return { linkId: link.id, name: link.name, code, stageId: link.stage_id, ownerId: link.assign_to, labelIds: link.label_ids ?? [] };
}

// ---------------------------------------------------------------- direct chats

/** Whether a new chat from an unknown number goes on the pipeline. No settings row counts as on. */
export async function getDirectChatSetting(businessId: string): Promise<{ enabled: boolean }> {
  const row = await queryOne<{ enabled: boolean }>(
    `SELECT whatsapp_add_new_chats_to_pipeline AS enabled FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  return { enabled: row ? row.enabled !== false : true };
}

export async function setDirectChatSetting(businessId: string, enabled: unknown): Promise<{ enabled: boolean }> {
  if (typeof enabled !== 'boolean') throw new LeadSourceError('enabled must be true or false', 400, 'INVALID_ENABLED');
  await query(
    `INSERT INTO business_settings (business_id, whatsapp_add_new_chats_to_pipeline) VALUES ($1, $2)
     ON CONFLICT (business_id) DO UPDATE SET whatsapp_add_new_chats_to_pipeline = EXCLUDED.whatsapp_add_new_chats_to_pipeline`,
    [businessId, enabled],
  );
  return { enabled };
}

/**
 * True when the number already belongs to this business: a customer, a supplier, a staff member or
 * the owner's linked phone. Matched on the last 10 digits, since stored phones mix +91, 0 and bare forms.
 */
export async function isKnownNumber(businessId: string, phone: string): Promise<boolean> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return false;
  const last10 = digits.slice(-10);
  const row = await queryOne<{ known: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM customers WHERE business_id = $1 AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2)
         OR EXISTS (SELECT 1 FROM suppliers WHERE business_id = $1 AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2)
         OR EXISTS (SELECT 1 FROM users WHERE business_id = $1 AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2)
         OR EXISTS (SELECT 1 FROM owner_whatsapp_links WHERE business_id = $1 AND RIGHT(REGEXP_REPLACE(COALESCE(linked_phone, ''), '\\D', '', 'g'), 10) = $2)
         AS known`,
    [businessId, last10],
  );
  return !!row?.known;
}

// ---------------------------------------------------------------- entry links

export interface EntryLink {
  id: string;
  code: string;
  name: string;
  phone: string;
  prefill_text: string;
  stage_id: string | null;
  assign_to: string | null;
  label_ids: string[];
  clicks: number;
  qr_scans: number;
  widget_clicks: number;
  archived: boolean;
  created_at: string;
  chats?: number;
  won?: number;
}

const LINK_COLUMNS = `l.id::text AS id, l.code, l.name, l.phone, l.prefill_text, l.stage_id::text AS stage_id,
  l.assign_to::text AS assign_to, l.label_ids::text[] AS label_ids, l.clicks, l.qr_scans, l.widget_clicks, l.archived, l.created_at`;

function newCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** The text a link pre-fills, ending in the reference code we match on. */
export function linkMessage(link: Pick<EntryLink, 'prefill_text' | 'code'>): string {
  const base = link.prefill_text.trim() || 'Hi! I would like to know more.';
  return `${base} (ref ${link.code})`;
}

export function waMeUrl(link: Pick<EntryLink, 'phone' | 'prefill_text' | 'code'>): string {
  return `https://wa.me/${link.phone}?text=${encodeURIComponent(linkMessage(link))}`;
}

async function checkRouting(businessId: string, r: { stageId?: unknown; assignTo?: unknown; labelIds?: unknown }): Promise<Required<Routing>> {
  const stageId = typeof r.stageId === 'string' && r.stageId ? r.stageId : null;
  if (stageId) {
    const ok = await queryOne(`SELECT 1 FROM whatsapp_pipeline_stages WHERE id = $1::uuid AND business_id = $2`, [
      UUID_RE.test(stageId) ? stageId : '00000000-0000-0000-0000-000000000000',
      businessId,
    ]);
    if (!ok) throw new LeadSourceError('Pick one of your pipeline stages', 400, 'BAD_STAGE');
  }
  const assignTo = typeof r.assignTo === 'string' && r.assignTo ? r.assignTo : null;
  if (assignTo && (!UUID_RE.test(assignTo) || !(await isEligibleInboxAgent(businessId, assignTo)))) {
    throw new LeadSourceError('That person cannot use the inbox', 400, 'BAD_AGENT');
  }
  const raw = Array.isArray(r.labelIds) ? r.labelIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : [];
  const labelIds = raw.length
    ? (
        await queryRows<{ id: string }>(
          `SELECT id::text AS id FROM whatsapp_conversation_labels WHERE business_id = $1 AND id = ANY($2::uuid[])`,
          [businessId, raw.slice(0, 10)],
        )
      ).map((x) => x.id)
    : [];
  return { stageId, assignTo, labelIds };
}

function cleanLinkFields(input: { name?: unknown; phone?: unknown; prefillText?: unknown }, partial: boolean) {
  const out: { name?: string; phone?: string; prefill_text?: string } = {};
  if (input.name !== undefined || !partial) {
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
    if (!name) throw new LeadSourceError('Give the link a name, e.g. "Diwali poster"', 400, 'NAME_REQUIRED');
    out.name = name;
  }
  if (input.phone !== undefined || !partial) {
    const phone = normalizeLeadPhone(input.phone);
    if (!phone) throw new LeadSourceError('Enter your WhatsApp number with country code', 400, 'BAD_PHONE');
    out.phone = phone;
  }
  if (input.prefillText !== undefined || !partial) {
    out.prefill_text = typeof input.prefillText === 'string' ? input.prefillText.trim().slice(0, 400) : '';
  }
  return out;
}

export async function listEntryLinks(businessId: string, includeArchived = false): Promise<EntryLink[]> {
  return queryRows<EntryLink>(
    `SELECT ${LINK_COLUMNS},
            COALESCE(stats.chats, 0)::int AS chats, COALESCE(stats.won, 0)::int AS won
       FROM whatsapp_entry_links l
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS chats, COUNT(*) FILTER (WHERE s.kind = 'won') AS won
           FROM leads ld
           LEFT JOIN whatsapp_pipeline_stages s ON s.id = ld.stage_id
          WHERE ld.business_id = l.business_id AND ld.source = 'link' AND ld.source_detail->>'link_id' = l.id::text
       ) stats ON true
      WHERE l.business_id = $1 AND ($2 OR NOT l.archived)
      ORDER BY l.archived, l.created_at DESC`,
    [businessId, includeArchived],
  );
}

export async function createEntryLink(
  businessId: string,
  userId: string,
  input: { name?: unknown; phone?: unknown; prefillText?: unknown; stageId?: unknown; assignTo?: unknown; labelIds?: unknown },
): Promise<EntryLink> {
  const fields = cleanLinkFields(input, false);
  const routing = await checkRouting(businessId, input);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await queryOne<EntryLink>(
        `INSERT INTO whatsapp_entry_links AS l (business_id, code, name, phone, prefill_text, stage_id, assign_to, label_ids, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::uuid[], $9::uuid)
         RETURNING ${LINK_COLUMNS}`,
        [businessId, newCode(), fields.name, fields.phone, fields.prefill_text, routing.stageId, routing.assignTo, routing.labelIds, userId],
      );
      return { ...row!, chats: 0, won: 0 };
    } catch (err) {
      if ((err as { code?: string })?.code !== '23505') throw err;
    }
  }
  throw new Error('Could not create a unique link code');
}

export async function updateEntryLink(
  businessId: string,
  id: string,
  input: { name?: unknown; phone?: unknown; prefillText?: unknown; stageId?: unknown; assignTo?: unknown; labelIds?: unknown; archived?: unknown },
): Promise<EntryLink> {
  if (!UUID_RE.test(id)) throw new LeadSourceError('Link not found', 404, 'NOT_FOUND');
  const fields = cleanLinkFields(input, true);
  const sets: string[] = [];
  const values: unknown[] = [id, businessId];
  const set = (col: string, v: unknown, cast = '') => {
    values.push(v);
    sets.push(`${col} = $${values.length}${cast}`);
  };
  if (fields.name !== undefined) set('name', fields.name);
  if (fields.phone !== undefined) set('phone', fields.phone);
  if (fields.prefill_text !== undefined) set('prefill_text', fields.prefill_text);
  if (input.stageId !== undefined || input.assignTo !== undefined || input.labelIds !== undefined) {
    const r = await checkRouting(businessId, input);
    if (input.stageId !== undefined) set('stage_id', r.stageId, '::uuid');
    if (input.assignTo !== undefined) set('assign_to', r.assignTo, '::uuid');
    if (input.labelIds !== undefined) set('label_ids', r.labelIds, '::uuid[]');
  }
  if (typeof input.archived === 'boolean') set('archived', input.archived);
  if (!sets.length) throw new LeadSourceError('Nothing to update', 400, 'EMPTY');
  const row = await queryOne<{ id: string }>(
    `UPDATE whatsapp_entry_links SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1::uuid AND business_id = $2 RETURNING id::text AS id`,
    values,
  );
  if (!row) throw new LeadSourceError('Link not found', 404, 'NOT_FOUND');
  return (await listEntryLinks(businessId, true)).find((l) => l.id === id)!;
}

export type LinkVia = 'link' | 'qr' | 'widget';

/** Public: counts a click and returns where to send the visitor, or null for an unknown/archived code. */
export async function openEntryLink(code: string, via: LinkVia): Promise<string | null> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(clean)) return null;
  const column = via === 'qr' ? 'qr_scans' : via === 'widget' ? 'widget_clicks' : 'clicks';
  const row = await queryOne<Pick<EntryLink, 'phone' | 'prefill_text' | 'code'>>(
    `UPDATE whatsapp_entry_links SET ${column} = ${column} + 1
      WHERE code = $1 AND NOT archived
      RETURNING phone, prefill_text, code`,
    [clean],
  );
  return row ? waMeUrl(row) : null;
}

/** Public: what the website button script needs. No business data beyond the link itself. */
export async function widgetLink(code: string): Promise<{ code: string; name: string } | null> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(clean)) return null;
  return queryOne<{ code: string; name: string }>(
    `SELECT code, name FROM whatsapp_entry_links WHERE code = $1 AND NOT archived`,
    [clean],
  );
}

/** Number shown by default when making a link: the one customers have been writing to. */
export async function suggestedBusinessPhone(businessId: string): Promise<string | null> {
  const row = await queryOne<{ phone: string }>(
    `SELECT to_number AS phone FROM whatsapp_conversations
      WHERE business_id = $1 AND NOT COALESCE(is_group, false) AND last_message_direction = 'incoming'
        AND length(regexp_replace(to_number, '\\D', '', 'g')) >= 11
      ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
    [businessId],
  );
  return row ? normalizeLeadPhone(row.phone) : null;
}

// ---------------------------------------------------------------- outside leads (IndiaMART, webhook)

export type LeadSourceKind = 'indiamart' | 'webhook';

export interface LeadSourceRow {
  id: string;
  kind: LeadSourceKind;
  name: string;
  enabled: boolean;
  token_hint: string | null;
  has_key: boolean;
  stage_id: string | null;
  assign_to: string | null;
  label_ids: string[];
  synced_until: string | null;
  last_run_at: string | null;
  last_result: Record<string, unknown> | null;
  last_error: string | null;
  leads: number;
}

const SOURCE_COLUMNS = `ls.id::text AS id, ls.kind, ls.name, ls.enabled, ls.token_hint, (ls.encrypted_key IS NOT NULL) AS has_key,
  ls.stage_id::text AS stage_id, ls.assign_to::text AS assign_to, ls.label_ids::text[] AS label_ids,
  ls.synced_until, ls.last_run_at, ls.last_result, ls.last_error`;

export async function listLeadSources(businessId: string): Promise<LeadSourceRow[]> {
  return queryRows<LeadSourceRow>(
    `SELECT ${SOURCE_COLUMNS},
            (SELECT COUNT(*)::int FROM whatsapp_lead_imports i WHERE i.lead_source_id = ls.id) AS leads
       FROM whatsapp_lead_sources ls WHERE ls.business_id = $1 ORDER BY ls.kind, ls.created_at`,
    [businessId],
  );
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates an inbound webhook. The token is returned once and only its hash is stored. */
export async function createWebhookSource(
  businessId: string,
  userId: string,
  input: { name?: unknown; stageId?: unknown; assignTo?: unknown; labelIds?: unknown },
): Promise<{ source: LeadSourceRow; token: string }> {
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : 'Lead webhook';
  const routing = await checkRouting(businessId, input);
  const token = randomBytes(24).toString('base64url');
  const row = await queryOne<{ id: string }>(
    `INSERT INTO whatsapp_lead_sources (business_id, kind, name, token_hash, token_hint, stage_id, assign_to, label_ids, created_by)
     VALUES ($1, 'webhook', $2, $3, $4, $5::uuid, $6::uuid, $7::uuid[], $8::uuid) RETURNING id::text AS id`,
    [businessId, name, hashToken(token), token.slice(-4), routing.stageId, routing.assignTo, routing.labelIds, userId],
  );
  const source = (await listLeadSources(businessId)).find((s) => s.id === row!.id)!;
  return { source, token };
}

/** Saves (or replaces) the business's IndiaMART CRM key. */
export async function saveIndiaMartSource(
  businessId: string,
  userId: string,
  input: { key?: unknown; stageId?: unknown; assignTo?: unknown; labelIds?: unknown; enabled?: unknown },
): Promise<LeadSourceRow> {
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (key && !/^[A-Za-z0-9+/=_-]{16,200}$/.test(key)) {
    throw new LeadSourceError('That does not look like an IndiaMART CRM key', 400, 'BAD_KEY');
  }
  const routing = await checkRouting(businessId, input);
  const existing = await queryOne<{ id: string }>(
    `SELECT id::text AS id FROM whatsapp_lead_sources WHERE business_id = $1 AND kind = 'indiamart'`,
    [businessId],
  );
  if (!existing && !key) throw new LeadSourceError('Paste your IndiaMART CRM key', 400, 'KEY_REQUIRED');
  if (existing) {
    await query(
      `UPDATE whatsapp_lead_sources
          SET encrypted_key = COALESCE($3, encrypted_key), stage_id = $4::uuid, assign_to = $5::uuid, label_ids = $6::uuid[],
              enabled = COALESCE($7, enabled), last_error = CASE WHEN $3 IS NULL THEN last_error END, updated_at = NOW()
        WHERE id = $1::uuid AND business_id = $2`,
      [existing.id, businessId, key ? encryptSecret(key) : null, routing.stageId, routing.assignTo, routing.labelIds,
        typeof input.enabled === 'boolean' ? input.enabled : null],
    );
  } else {
    await query(
      `INSERT INTO whatsapp_lead_sources (business_id, kind, name, encrypted_key, stage_id, assign_to, label_ids, created_by)
       VALUES ($1, 'indiamart', 'IndiaMART', $2, $3::uuid, $4::uuid, $5::uuid[], $6::uuid)`,
      [businessId, encryptSecret(key), routing.stageId, routing.assignTo, routing.labelIds, userId],
    );
  }
  return (await listLeadSources(businessId)).find((s) => s.kind === 'indiamart')!;
}

export async function updateLeadSource(
  businessId: string,
  id: string,
  input: { name?: unknown; enabled?: unknown; stageId?: unknown; assignTo?: unknown; labelIds?: unknown },
): Promise<LeadSourceRow> {
  if (!UUID_RE.test(id)) throw new LeadSourceError('Lead source not found', 404, 'NOT_FOUND');
  const routing = await checkRouting(businessId, input);
  const res = await query(
    `UPDATE whatsapp_lead_sources
        SET name = COALESCE($3, name), enabled = COALESCE($4, enabled),
            stage_id = CASE WHEN $8 THEN $5::uuid ELSE stage_id END,
            assign_to = CASE WHEN $9 THEN $6::uuid ELSE assign_to END,
            label_ids = CASE WHEN $10 THEN $7::uuid[] ELSE label_ids END,
            updated_at = NOW()
      WHERE id = $1::uuid AND business_id = $2`,
    [
      id,
      businessId,
      typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : null,
      typeof input.enabled === 'boolean' ? input.enabled : null,
      routing.stageId,
      routing.assignTo,
      routing.labelIds,
      input.stageId !== undefined,
      input.assignTo !== undefined,
      input.labelIds !== undefined,
    ],
  );
  if (!res.rowCount) throw new LeadSourceError('Lead source not found', 404, 'NOT_FOUND');
  return (await listLeadSources(businessId)).find((s) => s.id === id)!;
}

export async function deleteLeadSource(businessId: string, id: string): Promise<void> {
  if (!UUID_RE.test(id)) throw new LeadSourceError('Lead source not found', 404, 'NOT_FOUND');
  const res = await query(`DELETE FROM whatsapp_lead_sources WHERE id = $1::uuid AND business_id = $2`, [id, businessId]);
  if (!res.rowCount) throw new LeadSourceError('Lead source not found', 404, 'NOT_FOUND');
}

export interface IncomingLead {
  externalId: string;
  name: string | null;
  phone: string;
  message: string | null;
  /** Kept in the lead's source_detail. */
  detail: Record<string, string | null>;
}

interface SourceForImport {
  id: string;
  business_id: string;
  kind: LeadSourceKind;
  name: string;
  stage_id: string | null;
  assign_to: string | null;
  label_ids: string[];
}

/**
 * Puts an outside enquiry on the pipeline as a lead, with no chat: the chat links when the buyer messages
 * (leadForInboundMessage). Returns null when this enquiry was already imported. A number with an open lead
 * joins it: a Direct lead takes this source, a lead with a source keeps it, and the source's labels are
 * added either way. The source's stage and owner are best effort, so a deleted stage (first open stage
 * instead) or an agent who lost inbox access (no owner instead) never drops the lead.
 */
export async function importLead(src: SourceForImport, lead: IncomingLead): Promise<{ leadId: string; created: boolean } | null> {
  const claim = await queryOne<{ id: string }>(
    `INSERT INTO whatsapp_lead_imports (business_id, lead_source_id, external_id)
     VALUES ($1, $2::uuid, $3) ON CONFLICT (lead_source_id, external_id) DO NOTHING RETURNING id::text AS id`,
    [src.business_id, src.id, lead.externalId.slice(0, 120)],
  );
  if (!claim) return null;

  const source: LeadSource = src.kind === 'indiamart' ? 'indiamart' : 'lead_api';
  const summary = (lead.message || lead.detail.subject || lead.detail.product || `New lead from ${src.name}`)!.slice(0, 500);
  const labelIds = src.label_ids ?? [];
  const sourceDetail = { lead_source_id: src.id, name: src.name, ...lead.detail, message: lead.message, label_ids: labelIds };
  try {
    let stageId = src.stage_id;
    let ownerId = src.assign_to;
    let opened: Awaited<ReturnType<typeof openLead>> | undefined;
    while (!opened) {
      try {
        opened = await openLead(src.business_id, {
          phone: lead.phone,
          name: lead.name,
          source,
          sourceDetail,
          stageId,
          ownerId,
          note: summary,
          actor: { source: 'auto' },
        });
      } catch (err) {
        if (err instanceof LeadError && err.code === 'STAGE_NOT_FOUND' && stageId) stageId = null;
        else if (err instanceof LeadError && err.code === 'BAD_OWNER' && ownerId) ownerId = null;
        else throw err;
      }
    }
    if (!opened.created) await addImportToLead(src.business_id, opened.lead.id, { source, sourceDetail, labelIds });
    await query(`UPDATE whatsapp_lead_imports SET lead_id = $2::uuid WHERE id = $1::uuid`, [claim.id, opened.lead.id]);
    return { leadId: opened.lead.id, created: opened.created };
  } catch (err) {
    // Release the claim so the next pull or retry can import this enquiry.
    await query(`DELETE FROM whatsapp_lead_imports WHERE id = $1::uuid`, [claim.id]).catch(() => undefined);
    throw err;
  }
}

const IMPORT_COLUMNS = `id::text AS id, business_id::text AS business_id, kind, name, stage_id::text AS stage_id,
  assign_to::text AS assign_to, label_ids::text[] AS label_ids`;

/** Inbound webhook body → one lead. Accepts the common field names Zapier/Make/JustDial use. */
export function parseWebhookLead(body: unknown): IncomingLead {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = b[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return null;
  };
  const phone = normalizeLeadPhone(pick('phone', 'mobile', 'phone_number', 'whatsapp', 'contact_number', 'mobile_number'));
  if (!phone) throw new LeadSourceError('Send the lead’s phone number in "phone"', 400, 'PHONE_REQUIRED');
  const name = pick('name', 'full_name', 'customer_name', 'lead_name');
  const message = pick('message', 'requirement', 'enquiry', 'query', 'notes', 'comments');
  const externalId = pick('id', 'lead_id', 'external_id', 'leadid') || createHash('sha256').update(`${phone}|${message || ''}`).digest('hex');
  return {
    externalId,
    name: name ? name.slice(0, 120) : null,
    phone,
    message: message ? message.slice(0, 1000) : null,
    detail: {
      origin: pick('source', 'platform', 'channel'),
      email: pick('email'),
      city: pick('city', 'area'),
      product: pick('product', 'service', 'category'),
      subject: pick('subject', 'campaign', 'form_name'),
    },
  };
}

/** Public webhook: token in the URL picks the business. */
export async function receiveWebhookLead(token: string, body: unknown): Promise<{ leadId: string; duplicate: boolean }> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new LeadSourceError('Unknown webhook', 404, 'NOT_FOUND');
  const src = await queryOne<SourceForImport & { enabled: boolean }>(
    `SELECT ${IMPORT_COLUMNS}, enabled FROM whatsapp_lead_sources WHERE token_hash = $1 AND kind = 'webhook'`,
    [hashToken(token)],
  );
  if (!src) throw new LeadSourceError('Unknown webhook', 404, 'NOT_FOUND');
  if (!src.enabled) throw new LeadSourceError('This webhook is switched off', 403, 'DISABLED');
  const lead = parseWebhookLead(body);
  const result = await importLead(src, lead);
  await query(
    `UPDATE whatsapp_lead_sources SET last_run_at = NOW(), last_result = $2::jsonb, last_error = NULL WHERE id = $1::uuid`,
    [src.id, JSON.stringify({ received: 1, duplicate: !result })],
  );
  if (!result) {
    const prior = await queryOne<{ lead_id: string | null }>(
      `SELECT lead_id::text AS lead_id FROM whatsapp_lead_imports WHERE lead_source_id = $1::uuid AND external_id = $2`,
      [src.id, lead.externalId.slice(0, 120)],
    );
    return { leadId: prior?.lead_id ?? '', duplicate: true };
  }
  return { leadId: result.leadId, duplicate: false };
}

// ---------------------------------------------------------------- IndiaMART pull

const INDIAMART_URL = 'https://mapi.indiamart.com/wservce/crm/crmListing/v2/';
/** IndiaMART allows one pull every 5 minutes and a window of at most 7 days. */
const INDIAMART_MIN_GAP_MS = 5 * 60 * 1000;
const INDIAMART_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const INDIAMART_FIRST_WINDOW_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26-Oct-2026 14:05:00" in IST, the format IndiaMART's CRM API takes. */
export function indiaMartTime(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(ist.getUTCDate())}-${MONTHS[ist.getUTCMonth()]}-${ist.getUTCFullYear()} ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}`;
}

/** IndiaMART response → leads (rows without a usable mobile are skipped). */
export function parseIndiaMartResponse(json: unknown): { ok: boolean; leads: IncomingLead[]; message: string | null } {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const code = Number(j.CODE);
  const message = typeof j.MESSAGE === 'string' ? j.MESSAGE : null;
  // 204: no leads in this window.
  if (code === 204) return { ok: true, leads: [], message };
  if (code !== 200 || !Array.isArray(j.RESPONSE)) return { ok: false, leads: [], message: message || `IndiaMART returned code ${j.CODE ?? 'unknown'}` };
  const leads: IncomingLead[] = [];
  for (const r of j.RESPONSE as Array<Record<string, unknown>>) {
    const s = (k: string) => (typeof r[k] === 'string' && (r[k] as string).trim() ? (r[k] as string).trim() : null);
    const phone = normalizeLeadPhone(s('SENDER_MOBILE') || s('SENDER_PHONE') || s('SENDER_MOBILE_ALT'));
    const id = s('UNIQUE_QUERY_ID');
    if (!phone || !id) continue;
    leads.push({
      externalId: id,
      name: s('SENDER_NAME'),
      phone,
      message: s('QUERY_MESSAGE') ? s('QUERY_MESSAGE')!.replace(/<br\s*\/?>/gi, '\n').slice(0, 1000) : null,
      detail: {
        query_id: id,
        subject: s('SUBJECT'),
        product: s('QUERY_PRODUCT_NAME'),
        company: s('SENDER_COMPANY'),
        city: s('SENDER_CITY'),
        state: s('SENDER_STATE'),
        email: s('SENDER_EMAIL'),
        query_type: s('QUERY_TYPE'),
        query_time: s('QUERY_TIME'),
      },
    });
  }
  return { ok: true, leads, message };
}

export interface IndiaMartRun {
  business_id: string;
  fetched: number;
  imported: number;
  duplicates: number;
  skipped?: string;
  error?: string;
}

type Fetcher = (url: string) => Promise<{ json: () => Promise<unknown> }>;

/** One pull for one business (cron or "Sync now"); respects IndiaMART's 5-minute limit. */
export async function syncIndiaMart(businessId: string, opts: { fetcher?: Fetcher; now?: Date } = {}): Promise<IndiaMartRun> {
  const now = opts.now ?? new Date();
  const src = await queryOne<SourceForImport & { encrypted_key: string | null; enabled: boolean; synced_until: Date | null; last_run_at: Date | null }>(
    `SELECT ${IMPORT_COLUMNS}, encrypted_key, enabled, synced_until, last_run_at
       FROM whatsapp_lead_sources WHERE business_id = $1 AND kind = 'indiamart'`,
    [businessId],
  );
  if (!src || !src.encrypted_key) throw new LeadSourceError('Connect IndiaMART first', 404, 'NOT_CONNECTED');
  if (!src.enabled) return { business_id: businessId, fetched: 0, imported: 0, duplicates: 0, skipped: 'disabled' };
  if (src.last_run_at && now.getTime() - new Date(src.last_run_at).getTime() < INDIAMART_MIN_GAP_MS) {
    throw new LeadSourceError('IndiaMART allows one sync every 5 minutes. Try again shortly.', 429, 'TOO_SOON');
  }
  const start = src.synced_until ? new Date(src.synced_until) : new Date(now.getTime() - INDIAMART_FIRST_WINDOW_MS);
  const end = new Date(Math.min(now.getTime(), start.getTime() + INDIAMART_MAX_WINDOW_MS));
  await query(`UPDATE whatsapp_lead_sources SET last_run_at = $2 WHERE id = $1::uuid`, [src.id, now.toISOString()]);

  const fetcher: Fetcher =
    opts.fetcher ??
    ((url) => fetch(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json' } }));
  const url =
    `${INDIAMART_URL}?glusr_crm_key=${encodeURIComponent(decryptSecret(src.encrypted_key))}` +
    `&start_time=${encodeURIComponent(indiaMartTime(start))}&end_time=${encodeURIComponent(indiaMartTime(end))}`;
  let parsed: ReturnType<typeof parseIndiaMartResponse>;
  try {
    parsed = parseIndiaMartResponse(await (await fetcher(url)).json());
  } catch (err) {
    parsed = { ok: false, leads: [], message: err instanceof Error ? err.message : 'IndiaMART did not answer' };
  }
  if (!parsed.ok) {
    await query(`UPDATE whatsapp_lead_sources SET last_error = $2 WHERE id = $1::uuid`, [src.id, (parsed.message || 'Sync failed').slice(0, 500)]);
    return { business_id: businessId, fetched: 0, imported: 0, duplicates: 0, error: parsed.message || 'Sync failed' };
  }
  let imported = 0;
  let duplicates = 0;
  for (const lead of parsed.leads) {
    const r = await importLead(src, lead);
    if (r) imported++;
    else duplicates++;
  }
  const result = { fetched: parsed.leads.length, imported, duplicates, window: [start.toISOString(), end.toISOString()] };
  await query(
    `UPDATE whatsapp_lead_sources SET synced_until = $2, last_result = $3::jsonb, last_error = NULL WHERE id = $1::uuid`,
    [src.id, end.toISOString(), JSON.stringify(result)],
  );
  return { business_id: businessId, fetched: parsed.leads.length, imported, duplicates };
}

/** Cron: every enabled IndiaMART connection that is due. Errors are recorded per business. */
export async function syncAllIndiaMart(limit = 50): Promise<IndiaMartRun[]> {
  const due = await queryRows<{ business_id: string }>(
    `SELECT business_id::text AS business_id FROM whatsapp_lead_sources
      WHERE kind = 'indiamart' AND enabled AND encrypted_key IS NOT NULL
        AND (last_run_at IS NULL OR last_run_at < NOW() - INTERVAL '5 minutes')
      ORDER BY last_run_at NULLS FIRST LIMIT $1`,
    [limit],
  );
  const out: IndiaMartRun[] = [];
  for (const d of due) {
    try {
      out.push(await syncIndiaMart(d.business_id));
    } catch (err) {
      out.push({ business_id: d.business_id, fetched: 0, imported: 0, duplicates: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
