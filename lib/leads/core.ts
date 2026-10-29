/**
 * Connect leads: one row per enquiry, with or without a chat. This file is the only writer of the
 * leads table. A business has at most one open lead (closed_at IS NULL) per phone, so a repeat
 * enquiry joins the open lead and a won or lost lead leaves room for a fresh one.
 * Business identity always comes from the session; callers pass it in.
 */
import { query, queryOne } from '@/lib/db';
import { assignToAgent, broadcastOwnership, isEligibleInboxAgent } from '@/lib/whatsapp/inbox-ownership';
import { normalizeLeadPhone } from './phone';
import {
  ensureStages,
  PipelineError,
  type DealActor,
  type DealPatch,
  type LegacyLeadStatus,
  type PipelineStage,
} from '@/lib/whatsapp/pipeline';

/** An open lead with no activity for this long is closed as lost (see closeLeadAsWentQuiet). */
export const QUIET_DAYS = 30;
export const WENT_QUIET_REASON = 'Went quiet';

export const LEAD_SOURCE_KEYS = ['ctwa_ad', 'link', 'indiamart', 'lead_api', 'manual', 'call', 'walk_in'] as const;
export type LeadSourceKey = (typeof LEAD_SOURCE_KEYS)[number];

export interface Lead {
  id: string;
  business_id: string;
  contact_phone: string;
  contact_name: string | null;
  conversation_id: string | null;
  customer_id: string | null;
  lead_type: 'new' | 'existing';
  stage_id: string | null;
  deal_value: number | null;
  expected_close_on: string | null;
  lost_reason: string | null;
  stage_changed_at: string | null;
  owner_id: string | null;
  source: LeadSourceKey | null;
  source_detail: Record<string, unknown> | null;
  source_at: string | null;
  note: string | null;
  opened_at: string;
  closed_at: string | null;
  last_activity_at: string;
  created_by: string | null;
}

export class LeadError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
  ) {
    super(message);
  }
}

const LEAD_COLUMNS = `id::text AS id, business_id::text AS business_id, contact_phone, contact_name,
  conversation_id::text AS conversation_id, customer_id::text AS customer_id, lead_type, stage_id::text AS stage_id,
  deal_value::float8 AS deal_value, to_char(expected_close_on, 'YYYY-MM-DD') AS expected_close_on, lost_reason,
  stage_changed_at, owner_id::text AS owner_id, source, source_detail, source_at, note, opened_at, closed_at,
  last_activity_at, created_by::text AS created_by`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

const alreadyOpen = () => new LeadError('This number already has an open lead; close that one first', 409, 'LEAD_ALREADY_OPEN');

// ---------------------------------------------------------------- deal values (moved from pipeline.ts)

/** The old whatsapp_conversations.lead_status value for a stage; still written on every stage change. */
export function legacyStatusFor(stage: PipelineStage): LegacyLeadStatus {
  if (stage.legacy_key) return stage.legacy_key;
  if (stage.kind === 'won') return 'converted';
  if (stage.kind === 'lost') return 'lost';
  return 'interested';
}

export function parseDealValue(raw: number | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 999_999_999_999) throw new PipelineError('Enter a deal value of 0 or more', 400, 'BAD_VALUE');
  return Math.round(n * 100) / 100;
}

export function parseCloseDate(raw: string | null): string | null {
  if (raw === null || raw === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new PipelineError('Expected close date must look like 2026-11-30', 400, 'BAD_DATE');
  }
  return raw;
}

function cleanText(raw: unknown, max: number): string | null {
  const s = typeof raw === 'string' ? raw.trim().slice(0, max) : '';
  return s || null;
}

async function checkOwner(businessId: string, ownerId: string | null | undefined): Promise<string | null> {
  if (!ownerId) return null;
  if (!UUID_RE.test(ownerId) || !(await isEligibleInboxAgent(businessId, ownerId))) {
    throw new LeadError('Pick a team member with WhatsApp Chats access', 400, 'BAD_OWNER');
  }
  return ownerId;
}

async function actorName(actor: DealActor): Promise<string | null> {
  if (actor.source !== 'agent') return null;
  const row = await queryOne<{ name: string | null }>('SELECT name FROM users WHERE id = $1::uuid', [actor.userId]).catch(() => null);
  return row?.name ?? null;
}

/** Timeline entry for a stage move; on the lead and, when it has one, its chat. Never throws. */
async function recordStageEvent(
  businessId: string,
  lead: Pick<Lead, 'id' | 'conversation_id'>,
  from: PipelineStage | null,
  to: PipelineStage | null,
  actor: DealActor,
  extra?: Record<string, unknown>,
): Promise<void> {
  await query(
    `INSERT INTO whatsapp_automation_events (conversation_id, lead_id, business_id, event_type, event_data)
     VALUES ($1, $2, $3, 'stage_changed', $4::jsonb)`,
    [
      lead.conversation_id,
      lead.id,
      businessId,
      JSON.stringify({ from_stage: from?.name ?? null, to_stage: to?.name ?? null, source: actor.source, actor_name: await actorName(actor), ...extra }),
    ],
  ).catch((err) => console.warn('[leads] timeline event failed:', err instanceof Error ? err.message : err));
}

/** Keeps the chat's old lead_status in step and refreshes open inboxes. */
async function syncChat(businessId: string, conversationId: string | null, stage: PipelineStage | null): Promise<void> {
  if (!conversationId) return;
  if (stage) {
    await query(
      `UPDATE whatsapp_conversations SET lead_status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid AND business_id = $2`,
      [conversationId, businessId, legacyStatusFor(stage)],
    );
  }
  await broadcastOwnership(businessId, conversationId);
}

/** A chat joining a lead gets the lead's source labels, and its customer when the chat has none. */
async function applyLeadToChat(businessId: string, lead: Lead, conversationId: string): Promise<void> {
  const labelIds = Array.isArray(lead.source_detail?.label_ids) ? (lead.source_detail!.label_ids as unknown[]) : [];
  for (const labelId of labelIds) {
    if (typeof labelId !== 'string' || !UUID_RE.test(labelId)) continue;
    await query(
      `INSERT INTO whatsapp_conversation_label_assignments (conversation_id, label_id)
       SELECT $1::uuid, l.id FROM whatsapp_conversation_labels l WHERE l.id = $2::uuid AND l.business_id = $3
       ON CONFLICT (conversation_id, label_id) DO NOTHING`,
      [conversationId, labelId, businessId],
    );
  }
  if (lead.customer_id) {
    await query(
      `UPDATE whatsapp_conversations SET customer_id = $3::uuid WHERE id = $1::uuid AND business_id = $2 AND customer_id IS NULL`,
      [conversationId, businessId, lead.customer_id],
    );
  }
}

// ---------------------------------------------------------------- reads

export async function loadLead(businessId: string, leadId: string): Promise<Lead | null> {
  if (!UUID_RE.test(leadId)) return null;
  return queryOne<Lead>(`SELECT ${LEAD_COLUMNS} FROM leads WHERE id = $1::uuid AND business_id = $2`, [leadId, businessId]);
}

/** The open lead for a phone in any format, or null. */
export async function findOpenLead(businessId: string, phone: string): Promise<Lead | null> {
  const normalised = normalizeLeadPhone(phone);
  if (!normalised) return null;
  return queryOne<Lead>(
    `SELECT ${LEAD_COLUMNS} FROM leads WHERE business_id = $1 AND contact_phone = $2 AND closed_at IS NULL`,
    [businessId, normalised],
  );
}

// ---------------------------------------------------------------- opening a lead

export interface OpenLeadInput {
  phone: string;
  name?: string | null;
  conversationId?: string | null;
  source?: LeadSourceKey | null;
  sourceDetail?: Record<string, unknown> | null;
  stageId?: string | null;
  ownerId?: string | null;
  note?: string | null;
  createdBy?: string | null;
  actor: DealActor;
}

/**
 * Opens a lead for a phone, or returns the open one (created: false). Two calls at once cannot both
 * create: the insert leans on the one-open-lead-per-phone index. A new lead lands on the given stage,
 * else the first open stage; a customer with the same last 10 digits makes it an 'existing' lead.
 * A won or lost stage still goes through the open insert, so it joins an open lead like any other,
 * and only a lead created here is then closed.
 */
export async function openLead(businessId: string, input: OpenLeadInput): Promise<{ lead: Lead; created: boolean }> {
  const phone = normalizeLeadPhone(input.phone);
  if (!phone) throw new LeadError('Enter a valid phone number with country code', 400, 'BAD_PHONE');
  const stages = await ensureStages(businessId);
  let stage: PipelineStage | null;
  if (input.stageId) {
    stage = stages.find((s) => s.id === input.stageId) ?? null;
    if (!stage) throw new LeadError('Stage not found', 404, 'STAGE_NOT_FOUND');
  } else {
    stage = stages.find((s) => s.kind === 'open') ?? null;
  }
  const ownerId = await checkOwner(businessId, input.ownerId);

  let conversationId: string | null = null;
  if (input.conversationId) {
    const chat = await queryOne<{ is_group: boolean | null }>(
      `SELECT is_group FROM whatsapp_conversations WHERE id = $1::uuid AND business_id = $2`,
      [input.conversationId, businessId],
    );
    if (!chat) throw new LeadError('Conversation not found', 404, 'NOT_FOUND');
    if (chat.is_group) throw new LeadError('Group chats cannot go on the pipeline', 400, 'GROUP_CHAT');
    conversationId = input.conversationId;
  }

  const customer = await queryOne<{ id: string }>(
    `SELECT id::text AS id FROM customers
      WHERE business_id = $1 AND deleted_at IS NULL
        AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2
      ORDER BY COALESCE(is_active, true) DESC, created_at
      LIMIT 1`,
    [businessId, phone.slice(-10)],
  );
  const source = input.source && (LEAD_SOURCE_KEYS as readonly string[]).includes(input.source) ? input.source : null;

  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO leads (
       business_id, contact_phone, contact_name, conversation_id, customer_id, lead_type, stage_id, stage_changed_at,
       owner_id, source, source_detail, source_at, note, created_by
     ) VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, $7::uuid, NOW(), $8::uuid, $9, $10::jsonb,
               CASE WHEN $13 THEN NOW() END, $11, $12::uuid)
     ON CONFLICT (business_id, contact_phone) WHERE closed_at IS NULL DO NOTHING
     RETURNING id::text AS id`,
    [
      businessId,
      phone,
      cleanText(input.name, 120),
      conversationId,
      customer?.id ?? null,
      customer ? 'existing' : 'new',
      stage?.id ?? null,
      ownerId,
      source,
      input.sourceDetail ? JSON.stringify(input.sourceDetail) : null,
      cleanText(input.note, 1000),
      input.createdBy ?? null,
      !!source,
    ],
  );

  if (!inserted) {
    // Someone already has this phone open: join it, linking the chat if the lead has none.
    const open = await findOpenLead(businessId, phone);
    if (!open) throw new Error('Open lead disappeared while joining it');
    if (conversationId && !open.conversation_id) {
      await linkChatToLead(businessId, open.id, conversationId);
      return { lead: (await loadLead(businessId, open.id))!, created: false };
    }
    return { lead: open, created: false };
  }

  if (stage && stage.kind !== 'open') {
    await query(`UPDATE leads SET closed_at = NOW() WHERE id = $1::uuid AND business_id = $2`, [inserted.id, businessId]);
  }
  const lead = (await loadLead(businessId, inserted.id))!;
  if (conversationId) await applyLeadToChat(businessId, lead, conversationId);
  await recordStageEvent(businessId, lead, null, stage, input.actor);
  await syncChat(businessId, conversationId, stage);
  return { lead, created: true };
}

// ---------------------------------------------------------------- changing a lead

/**
 * Moves a lead to a stage (null = open with no stage). A won or lost stage closes the lead (keeping
 * when it first closed on a won -> lost move); an open stage reopens it, which fails while another
 * lead for the phone is open.
 */
export async function setLeadStage(
  businessId: string,
  leadId: string,
  stageId: string | null,
  actor: DealActor,
  lostReason?: string | null,
): Promise<Lead> {
  return moveLead(businessId, leadId, stageId, actor, lostReason);
}

/**
 * setLeadStage, plus: extra fields for the timeline entry (why an automatic move happened), and
 * onlyIfOpen, which moves the lead only while it is still open so two closes at once record one event.
 */
async function moveLead(
  businessId: string,
  leadId: string,
  stageId: string | null,
  actor: DealActor,
  lostReason: string | null | undefined,
  opts: { eventExtra?: Record<string, unknown>; onlyIfOpen?: boolean } = {},
): Promise<Lead> {
  const lead = await loadLead(businessId, leadId);
  if (!lead) throw new LeadError('Lead not found', 404, 'NOT_FOUND');
  const stages = await ensureStages(businessId);
  const toStage = stageId ? stages.find((s) => s.id === stageId) ?? null : null;
  if (stageId && !toStage) throw new LeadError('Stage not found', 404, 'STAGE_NOT_FOUND');
  const fromStage = stages.find((s) => s.id === lead.stage_id) ?? null;

  const values: unknown[] = [leadId, businessId];
  const set = (sql: string, v: unknown) => {
    values.push(v);
    return sql.replace('$?', `$${values.length}`);
  };
  const sets: string[] = [];
  const stageChanges = (toStage?.id ?? null) !== lead.stage_id;
  const closes = !!toStage && toStage.kind !== 'open';
  if (stageChanges && lead.closed_at && !closes) {
    // Checked here so the usual case never reaches the unique index; the index still settles races.
    const open = await findOpenLead(businessId, lead.contact_phone);
    if (open && open.id !== lead.id) throw alreadyOpen();
  }
  if (stageChanges) {
    sets.push(set('stage_id = $?::uuid', toStage?.id ?? null), 'stage_changed_at = NOW()');
    sets.push(closes ? 'closed_at = COALESCE(closed_at, NOW())' : 'closed_at = NULL');
    // Moving out of a lost stage clears the reason unless a new one is sent.
    if (toStage?.kind !== 'lost' && lostReason === undefined) sets.push('lost_reason = NULL');
  }
  if (lostReason !== undefined) sets.push(set('lost_reason = $?', cleanText(lostReason, 200)));
  if (!sets.length) return lead;
  if (actor.source === 'agent') sets.push('last_activity_at = NOW()');

  let changed: boolean;
  try {
    const res = await query(
      `UPDATE leads SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $1::uuid AND business_id = $2${opts.onlyIfOpen ? ' AND closed_at IS NULL' : ''}`,
      values,
    );
    changed = (res.rowCount ?? 0) > 0;
  } catch (err) {
    if (isUniqueViolation(err)) throw alreadyOpen();
    throw err;
  }

  if (stageChanges && changed) {
    await recordStageEvent(businessId, lead, fromStage, toStage, actor, opts.eventExtra);
    await syncChat(businessId, lead.conversation_id, toStage);
  }
  return (await loadLead(businessId, leadId))!;
}

export interface LeadPatch extends DealPatch {
  ownerId?: string | null;
  contactName?: string | null;
  note?: string | null;
}

/** Updates a lead's deal and details. Values are checked before anything is written. */
export async function patchLead(businessId: string, leadId: string, patch: LeadPatch, actor: DealActor): Promise<Lead> {
  const lead = await loadLead(businessId, leadId);
  if (!lead) throw new LeadError('Lead not found', 404, 'NOT_FOUND');

  const values: unknown[] = [leadId, businessId];
  const sets: string[] = [];
  const set = (col: string, v: unknown, cast = '') => {
    values.push(v);
    sets.push(`${col} = $${values.length}${cast}`);
  };
  if (patch.dealValue !== undefined) set('deal_value', parseDealValue(patch.dealValue));
  if (patch.expectedCloseOn !== undefined) set('expected_close_on', parseCloseDate(patch.expectedCloseOn), '::date');
  if (patch.ownerId !== undefined) set('owner_id', await checkOwner(businessId, patch.ownerId), '::uuid');
  if (patch.contactName !== undefined) set('contact_name', cleanText(patch.contactName, 120));
  if (patch.note !== undefined) set('note', cleanText(patch.note, 1000));

  const stageChanges = patch.stageId !== undefined && (patch.stageId || null) !== lead.stage_id;
  if (stageChanges) {
    // The reason rides with the stage move so moving out of Lost doesn't clear a reason sent with it.
    await setLeadStage(businessId, leadId, patch.stageId || null, actor, patch.lostReason);
  } else if (patch.lostReason !== undefined) {
    set('lost_reason', cleanText(patch.lostReason, 200));
  }

  if (sets.length) {
    if (actor.source === 'agent') sets.push('last_activity_at = NOW()');
    await query(`UPDATE leads SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1::uuid AND business_id = $2`, values);
  } else if (!stageChanges && actor.source === 'agent') {
    await touchLead(businessId, leadId);
  }
  return (await loadLead(businessId, leadId))!;
}

/** Closes a stale open lead in the first lost stage; the timeline says it went quiet. */
export async function closeLeadAsWentQuiet(businessId: string, leadId: string): Promise<void> {
  const lead = await loadLead(businessId, leadId);
  if (!lead || lead.closed_at) return;
  const lost = (await ensureStages(businessId)).filter((s) => s.kind === 'lost').sort((a, b) => a.position - b.position)[0];
  if (!lost) return;
  await moveLead(businessId, leadId, lost.id, { source: 'auto' }, WENT_QUIET_REASON, {
    eventExtra: { reason: 'went_quiet', quiet_days: QUIET_DAYS },
    onlyIfOpen: true,
  });
}

/**
 * An outside enquiry (IndiaMART, webhook) lands on a lead that is already open. A Direct lead (no source)
 * takes the enquiry's source; a lead with a source keeps it. Either way the enquiry's labels join the lead's
 * source_detail.label_ids and, when the lead has a chat, go onto it, and the enquiry text is added to the
 * lead's note. The lead counts as active.
 */
export async function addImportToLead(
  businessId: string,
  leadId: string,
  input: { source: LeadSourceKey; sourceDetail: Record<string, unknown>; labelIds: string[]; enquiry: string },
): Promise<Lead> {
  await query(
    `UPDATE leads SET source = $3, source_detail = $4::jsonb, source_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid AND business_id = $2 AND source IS NULL`,
    [leadId, businessId, input.source, JSON.stringify(input.sourceDetail)],
  );
  if (input.labelIds.length) {
    // A source_detail or label_ids of an unexpected shape counts as empty.
    await query(
      `UPDATE leads
          SET source_detail = jsonb_set(
                CASE WHEN jsonb_typeof(source_detail) = 'object' THEN source_detail ELSE '{}'::jsonb END, '{label_ids}',
                (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb)
                   FROM jsonb_array_elements_text(
                     (CASE WHEN jsonb_typeof(source_detail->'label_ids') = 'array' THEN source_detail->'label_ids' ELSE '[]'::jsonb END)
                     || $3::jsonb) x)),
              updated_at = NOW()
        WHERE id = $1::uuid AND business_id = $2`,
      [leadId, businessId, JSON.stringify(input.labelIds)],
    );
  }
  const enquiry = cleanText(input.enquiry, 500);
  if (enquiry) {
    // A note over 1000 characters loses its oldest text: cut after the first line break in the newest 1000.
    await query(
      `UPDATE leads l
          SET note = CASE WHEN length(c.n) <= 1000 THEN c.n
                          WHEN position(chr(10) IN RIGHT(c.n, 1000)) > 0
                          THEN substring(RIGHT(c.n, 1000) FROM position(chr(10) IN RIGHT(c.n, 1000)) + 1)
                          ELSE RIGHT(c.n, 1000) END,
              updated_at = NOW()
         FROM (SELECT id, CASE WHEN COALESCE(note, '') = '' THEN $3 ELSE note || chr(10) || $3 END AS n
                 FROM leads WHERE id = $1::uuid AND business_id = $2 FOR UPDATE) c
        WHERE l.id = c.id`,
      [leadId, businessId, enquiry],
    );
  }
  await touchLead(businessId, leadId);
  const lead = (await loadLead(businessId, leadId))!;
  if (lead.conversation_id) await applyLeadToChat(businessId, lead, lead.conversation_id);
  return lead;
}

/**
 * Gives a lead with no chat its chat (same business, not a group). With assignOwner, a chat nobody has
 * also goes to the lead's owner: only a live message from the customer asks for that, never a history
 * sync, a manual link or a join through openLead.
 */
export async function linkChatToLead(
  businessId: string,
  leadId: string,
  conversationId: string,
  opts: { assignOwner?: boolean } = {},
): Promise<void> {
  const linked = await queryOne<{ id: string }>(
    `UPDATE leads SET conversation_id = $3::uuid, updated_at = NOW()
      WHERE id = $1::uuid AND business_id = $2 AND conversation_id IS NULL
        AND EXISTS (SELECT 1 FROM whatsapp_conversations c
                     WHERE c.id = $3::uuid AND c.business_id = $2 AND NOT COALESCE(c.is_group, false))
      RETURNING id::text AS id`,
    [leadId, businessId, conversationId],
  );
  if (!linked) return;
  const lead = await loadLead(businessId, leadId);
  if (!lead) return;
  await applyLeadToChat(businessId, lead, conversationId);
  // A failed assignment never undoes the link.
  if (opts.assignOwner && lead.owner_id) {
    await assignToAgent(businessId, conversationId, lead.owner_id).catch((err) =>
      console.warn('[leads] owner assignment on link failed:', err instanceof Error ? err.message : err),
    );
  }
}

export async function touchLead(businessId: string, leadId: string): Promise<void> {
  await query(`UPDATE leads SET last_activity_at = NOW() WHERE id = $1::uuid AND business_id = $2`, [leadId, businessId]);
}
