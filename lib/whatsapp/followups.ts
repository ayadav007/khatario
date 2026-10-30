/**
 * Follow-up reminders on Connect chats and leads ("remind me tomorrow at 10"); a lead with no chat
 * can have them too.
 * Agents set and see their own; supervisors can set one for any inbox agent and see everyone's.
 * The cron in app/api/cron/whatsapp-followups notifies the agent when one falls due.
 */
import { query, queryOne, queryRows } from '@/lib/db';
import { isEligibleInboxAgent, notifyInboxUser, type InboxViewer } from '@/lib/whatsapp/inbox-ownership';
// chat-deal and core import pipeline and inbox-ownership, never this file.
import { openLeadForChat } from '@/lib/leads/chat-deal';
import { loadLead } from '@/lib/leads/core';

const MAX_NOTE = 500;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
/** Allow a little clock skew for "in 1 minute" style reminders. */
const PAST_GRACE_MS = 5 * 60 * 1000;

export type FollowupStatus = 'pending' | 'done' | 'cancelled';

export interface FollowupRow {
  id: string;
  /** Null for a reminder on a lead that has no chat. */
  conversation_id: string | null;
  lead_id: string | null;
  assigned_to: string;
  assigned_name: string | null;
  created_by: string | null;
  due_at: string;
  note: string | null;
  status: FollowupStatus;
  cancel_on_reply: boolean;
  notified_at: string | null;
  completed_at: string | null;
  contact_name: string;
  contact_phone: string;
}

export class FollowupError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Pending reminders whose customer replied after they were set, on a cancel-on-reply reminder. */
const REPLIED_SQL = (f = 'f') => `(
  ${f}.cancel_on_reply AND EXISTS (
    SELECT 1 FROM whatsapp_conversation_messages m
     WHERE m.conversation_id = ${f}.conversation_id AND m.direction = 'incoming' AND m.created_at > ${f}.created_at
  )
)`;

/** WHERE fragment: chat `alias` has a pending reminder for user `userParam` due by `beforeParam`. */
export function dueFollowupSql(alias: string, userParam: string, beforeParam: string): string {
  return `EXISTS (
    SELECT 1 FROM whatsapp_followups df
     WHERE df.conversation_id = ${alias}.id AND df.status = 'pending'
       AND df.assigned_to = ${userParam}::uuid AND df.due_at <= ${beforeParam}::timestamptz
       AND NOT ${REPLIED_SQL('df')}
  )`;
}

const ROW_SELECT = `
  SELECT f.id::text AS id, f.conversation_id::text AS conversation_id, f.lead_id::text AS lead_id,
         f.assigned_to::text AS assigned_to,
         au.name AS assigned_name, f.created_by::text AS created_by, f.due_at, f.note, f.status,
         f.cancel_on_reply, f.notified_at, f.completed_at,
         COALESCE(NULLIF(cust.name, ''), NULLIF(ld.contact_name, ''), NULLIF(c.whatsapp_display_name, ''), c.from_number, ld.contact_phone) AS contact_name,
         COALESCE(c.from_number, ld.contact_phone) AS contact_phone
    FROM whatsapp_followups f
    LEFT JOIN whatsapp_conversations c ON c.id = f.conversation_id AND c.business_id = f.business_id
    LEFT JOIN leads ld ON ld.id = f.lead_id AND ld.business_id = f.business_id
    LEFT JOIN customers cust ON cust.id = COALESCE(c.customer_id, ld.customer_id) AND cust.business_id = f.business_id
    LEFT JOIN users au ON au.id = f.assigned_to`;

function parseDue(raw: unknown): Date {
  const d = typeof raw === 'string' || typeof raw === 'number' ? new Date(raw) : null;
  if (!d || Number.isNaN(d.getTime())) throw new FollowupError('Pick when to be reminded', 400, 'BAD_DUE');
  const now = Date.now();
  if (d.getTime() < now - PAST_GRACE_MS) throw new FollowupError('That time has already passed', 400, 'DUE_IN_PAST');
  if (d.getTime() > now + MAX_AHEAD_MS) throw new FollowupError('Reminders can be set up to a year ahead', 400, 'DUE_TOO_FAR');
  return d;
}

function cleanNote(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new FollowupError('Note must be text', 400, 'BAD_NOTE');
  return raw.trim().slice(0, MAX_NOTE) || null;
}

async function loadRow(businessId: string, id: string): Promise<FollowupRow | null> {
  return queryOne<FollowupRow>(`${ROW_SELECT} WHERE f.id = $1::uuid AND f.business_id = $2`, [id, businessId]);
}

/**
 * Sets a reminder on a chat or on a lead. The caller has already checked the chat or lead is visible to
 * this viewer. With a chat the reminder also points at the chat's open lead (when it has one). With only
 * a lead it uses the lead's chat when it has one; a lead with no chat gets a reminder with no chat, and
 * cancel-on-reply is switched off since there is nothing to reply in.
 */
export async function createFollowup(
  viewer: InboxViewer,
  input: {
    conversationId?: string | null;
    leadId?: string | null;
    dueAt: unknown;
    note?: unknown;
    assignedTo?: unknown;
    cancelOnReply?: unknown;
  },
): Promise<FollowupRow> {
  if (!input.conversationId && !input.leadId) throw new FollowupError('Pick a chat or a lead', 400, 'TARGET_REQUIRED');
  const dueAt = parseDue(input.dueAt);
  const note = cleanNote(input.note);
  let assignee = viewer.userId;
  if (typeof input.assignedTo === 'string' && input.assignedTo && input.assignedTo !== viewer.userId) {
    if (!viewer.isSupervisor) throw new FollowupError('Only supervisors can set reminders for someone else', 403, 'NOT_SUPERVISOR');
    if (!(await isEligibleInboxAgent(viewer.businessId, input.assignedTo))) {
      throw new FollowupError('That person cannot use the inbox', 400, 'BAD_ASSIGNEE');
    }
    assignee = input.assignedTo;
  }
  let conversationId: string | null = null;
  let leadId: string | null = null;
  let cancelOnReply = false;
  if (input.conversationId) {
    conversationId = input.conversationId;
    leadId = (await openLeadForChat(viewer.businessId, conversationId, 'any_chat'))?.id ?? null;
    cancelOnReply = input.cancelOnReply === true;
  } else {
    const lead = await loadLead(viewer.businessId, input.leadId!);
    if (!lead) throw new FollowupError('Lead not found', 404, 'NOT_FOUND');
    leadId = lead.id;
    // A lead that has a chat gets a chat reminder; only a lead with no chat has no reply to cancel on.
    if (lead.conversation_id) {
      conversationId = lead.conversation_id;
      cancelOnReply = input.cancelOnReply === true;
    }
  }
  const row = await queryOne<{ id: string }>(
    `INSERT INTO whatsapp_followups (business_id, conversation_id, lead_id, assigned_to, created_by, due_at, note, cancel_on_reply)
     VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8)
     RETURNING id::text AS id`,
    [viewer.businessId, conversationId, leadId, assignee, viewer.userId, dueAt.toISOString(), note, cancelOnReply],
  );
  return (await loadRow(viewer.businessId, row!.id))!;
}

export interface FollowupListQuery {
  /** Supervisors only: everyone's reminders, or one agent's. Agents always get their own. */
  agentId?: string | null;
  all?: boolean;
  conversationId?: string | null;
  leadId?: string | null;
  /** 'due' = overdue plus everything up to `dueBefore`; 'upcoming' = after now. */
  when?: 'due' | 'upcoming' | 'any';
  /** End of the viewer's today, from the browser (so "today" follows their clock). */
  dueBefore?: string | null;
  limit?: number;
}

export interface FollowupCounts {
  overdue: number;
  today: number;
}

function scopeWhere(viewer: InboxViewer, q: FollowupListQuery, params: unknown[]): string[] {
  const where = ['f.business_id = $1', `f.status = 'pending'`, `NOT ${REPLIED_SQL()}`];
  if (viewer.isSupervisor && q.agentId) {
    params.push(q.agentId);
    where.push(`f.assigned_to = $${params.length}::uuid`);
  } else if (!(viewer.isSupervisor && q.all)) {
    params.push(viewer.userId);
    where.push(`f.assigned_to = $${params.length}::uuid`);
  }
  return where;
}

function endOfToday(dueBefore: string | null | undefined): string {
  const d = dueBefore ? new Date(dueBefore) : null;
  if (d && !Number.isNaN(d.getTime()) && Math.abs(d.getTime() - Date.now()) < 2 * 24 * 60 * 60 * 1000) return d.toISOString();
  const fallback = new Date();
  fallback.setHours(23, 59, 59, 999);
  return fallback.toISOString();
}

export async function listFollowups(
  viewer: InboxViewer,
  q: FollowupListQuery = {},
): Promise<{ followups: FollowupRow[]; counts: FollowupCounts }> {
  const params: unknown[] = [viewer.businessId];
  const where = scopeWhere(viewer, q, params);
  const countParams = [...params];
  // The inbox badge counts chat reminders only, matching dueFollowupSql; lead-only ones show on the Leads page.
  const countWhere = [...where, 'f.conversation_id IS NOT NULL'];
  if (q.conversationId) {
    params.push(q.conversationId);
    where.push(`f.conversation_id = $${params.length}::uuid`);
  }
  if (q.leadId) {
    params.push(q.leadId);
    where.push(`f.lead_id = $${params.length}::uuid`);
  }
  const eod = endOfToday(q.dueBefore);
  if (q.when === 'due') {
    params.push(eod);
    where.push(`f.due_at <= $${params.length}::timestamptz`);
  } else if (q.when === 'upcoming') {
    where.push('f.due_at > NOW()');
  }
  params.push(Math.min(Math.max(Math.floor(q.limit ?? 100), 1), 200));
  const followups = await queryRows<FollowupRow>(
    `${ROW_SELECT} WHERE ${where.join(' AND ')} ORDER BY f.due_at ASC LIMIT $${params.length}`,
    params,
  );

  countParams.push(eod);
  const counts = await queryOne<FollowupCounts>(
    `SELECT COUNT(*) FILTER (WHERE f.due_at <= NOW())::int AS overdue,
            COUNT(*) FILTER (WHERE f.due_at > NOW() AND f.due_at <= $${countParams.length}::timestamptz)::int AS today
       FROM whatsapp_followups f
      WHERE ${countWhere.join(' AND ')}`,
    countParams,
  );
  return { followups, counts: counts ?? { overdue: 0, today: 0 } };
}

/** Mark done / cancel, snooze to a new time, or edit the note. Assignee or a supervisor only. */
export async function updateFollowup(
  viewer: InboxViewer,
  id: string,
  input: { status?: unknown; dueAt?: unknown; note?: unknown },
): Promise<FollowupRow> {
  const row = await loadRow(viewer.businessId, id);
  if (!row || (!viewer.isSupervisor && row.assigned_to !== viewer.userId)) {
    throw new FollowupError('Reminder not found', 404, 'NOT_FOUND');
  }
  const sets: string[] = [];
  const values: unknown[] = [id, viewer.businessId];
  if (input.status !== undefined) {
    if (input.status !== 'done' && input.status !== 'cancelled' && input.status !== 'pending') {
      throw new FollowupError('Status must be done, cancelled or pending', 400, 'BAD_STATUS');
    }
    values.push(input.status);
    sets.push(`status = $${values.length}`);
    if (input.status === 'pending') {
      sets.push('completed_at = NULL', 'completed_by = NULL');
    } else {
      values.push(viewer.userId);
      sets.push('completed_at = NOW()', `completed_by = $${values.length}::uuid`);
    }
  }
  if (input.dueAt !== undefined) {
    values.push(parseDue(input.dueAt).toISOString());
    // Snoozing makes it pending again and lets the cron remind once more.
    sets.push(`due_at = $${values.length}`, 'notified_at = NULL');
    if (input.status === undefined) sets.push(`status = 'pending'`, 'completed_at = NULL', 'completed_by = NULL');
  }
  if (input.note !== undefined) {
    values.push(cleanNote(input.note));
    sets.push(`note = $${values.length}`);
  }
  if (!sets.length) throw new FollowupError('Nothing to update', 400, 'EMPTY');
  await query(
    `UPDATE whatsapp_followups SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1::uuid AND business_id = $2`,
    values,
  );
  return (await loadRow(viewer.businessId, id))!;
}

export interface FollowupRunReport {
  due: number;
  notified: number;
  cancelled: number;
}

/**
 * All businesses: notify the agent for each reminder that has fallen due, once.
 * Cancel-on-reply reminders whose customer has written since are cancelled instead.
 */
export async function runDueFollowupReminders(limit = 200): Promise<FollowupRunReport> {
  const cancelled = await query(
    `UPDATE whatsapp_followups f SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
      WHERE f.status = 'pending' AND f.notified_at IS NULL AND f.due_at <= NOW() AND ${REPLIED_SQL()}`,
  );
  // Claim rows first so overlapping runs cannot notify twice.
  const due = await queryRows<{
    id: string;
    business_id: string;
    conversation_id: string | null;
    lead_id: string | null;
    assigned_to: string;
    note: string | null;
    contact: string;
  }>(
    `WITH claimed AS (
       UPDATE whatsapp_followups f SET notified_at = NOW(), updated_at = NOW()
        WHERE f.id IN (
          SELECT f2.id FROM whatsapp_followups f2
            JOIN users u ON u.id = f2.assigned_to AND u.is_active = true
           WHERE f2.status = 'pending' AND f2.notified_at IS NULL AND f2.due_at <= NOW()
           ORDER BY f2.due_at
           LIMIT $1
           FOR UPDATE OF f2 SKIP LOCKED
        )
        RETURNING f.id, f.business_id, f.conversation_id, f.lead_id, f.assigned_to, f.note
     )
     SELECT cl.id::text AS id, cl.business_id::text AS business_id, cl.conversation_id::text AS conversation_id,
            cl.lead_id::text AS lead_id, cl.assigned_to::text AS assigned_to, cl.note,
            COALESCE(NULLIF(cust.name, ''), NULLIF(ld.contact_name, ''), NULLIF(c.whatsapp_display_name, ''), c.from_number, ld.contact_phone) AS contact
       FROM claimed cl
       LEFT JOIN whatsapp_conversations c ON c.id = cl.conversation_id
       LEFT JOIN leads ld ON ld.id = cl.lead_id
       LEFT JOIN customers cust ON cust.id = COALESCE(c.customer_id, ld.customer_id) AND cust.business_id = cl.business_id`,
    [limit],
  );
  let notified = 0;
  for (const r of due) {
    try {
      const message = r.note ? `${r.contact}: ${r.note}` : `Time to follow up with ${r.contact}.`;
      if (r.conversation_id) {
        await notifyInboxUser(r.business_id, r.assigned_to, 'WhatsApp follow-up due', message, r.conversation_id);
      } else if (r.lead_id) {
        await notifyInboxUser(r.business_id, r.assigned_to, 'WhatsApp follow-up due', message, r.lead_id, 'whatsapp_lead');
      }
      notified++;
    } catch (err) {
      console.warn('[followups] notify failed:', err instanceof Error ? err.message : err);
    }
  }
  return { due: due.length, notified, cancelled: cancelled.rowCount ?? 0 };
}
