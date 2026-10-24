import { getPool, query, queryOne, queryRows } from '@/lib/db';
import { checkUserPermission } from '@/lib/permissions';
import { emitConversationUpdate } from '@/lib/whatsapp-websocket';

/**
 * AiSensy-style ownership for the shared inbox.
 * - active: the bot is handling the chat; visible to everyone (subject to agent label rules)
 * - requesting: the customer needs a person; visible to everyone (subject to agent label rules)
 * - intervened: owned by `assigned_to`; only the owner and supervisors can see it, only the owner replies
 * A chat whose owner is deleted or deactivated counts as unowned.
 */

export type InboxState = 'active' | 'requesting' | 'intervened';

export type OwnershipEventType =
  | 'intervened'
  | 'transferred'
  | 'taken_over'
  | 'resolved'
  | 'auto_resolved'
  | 'requested'
  | 'released';

export const INBOX_SUPERVISE_MODULE = 'whatsapp_inbox_supervise';
export const ONLINE_WINDOW_SECONDS = 90;

export interface InboxViewer {
  userId: string;
  businessId: string;
  isSupervisor: boolean;
}

export interface OwnershipRow {
  id: string;
  business_id: string;
  inbox_state: InboxState;
  assigned_to: string | null;
  owner_active: boolean;
  owner_name: string | null;
  is_group: boolean;
}

export class OwnershipError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    readonly ownerName?: string | null,
  ) {
    super(message);
  }
}

const ACTIVE_OWNER_SQL = (alias: string) =>
  `EXISTS (SELECT 1 FROM users ou WHERE ou.id = ${alias}.assigned_to AND ou.is_active = true)`;

/** SQL true when the chat has no live owner (not intervened, or owner gone). */
export const UNOWNED_SQL = (alias = 'c') =>
  `(${alias}.inbox_state <> 'intervened' OR ${alias}.assigned_to IS NULL OR NOT ${ACTIVE_OWNER_SQL(alias)})`;

export async function isInboxSupervisor(userId: string): Promise<boolean> {
  const user = await queryOne<{ is_primary_admin: boolean }>(
    'SELECT is_primary_admin FROM users WHERE id = $1',
    [userId],
  );
  if (user?.is_primary_admin) return true;
  return checkUserPermission(userId, INBOX_SUPERVISE_MODULE, 'read');
}

export async function getInboxViewer(ctx: { businessId: string; userId: string }): Promise<InboxViewer> {
  return {
    userId: ctx.userId,
    businessId: ctx.businessId,
    isSupervisor: await isInboxSupervisor(ctx.userId),
  };
}

/**
 * WHERE fragment limiting `alias` (whatsapp_conversations) to chats the viewer may see.
 * `nextParam` is the next free $ index; the returned params must be appended in order.
 */
export function visibilityClause(
  viewer: InboxViewer,
  alias = 'c',
  nextParam: number,
): { sql: string; params: unknown[] } {
  if (viewer.isSupervisor) return { sql: 'TRUE', params: [] };
  const p = `$${nextParam}`;
  const sql = `(
    (${alias}.inbox_state = 'intervened' AND ${alias}.assigned_to = ${p}::uuid)
    OR (
      ${UNOWNED_SQL(alias)}
      AND (
        NOT EXISTS (
          SELECT 1 FROM whatsapp_agent_label_rules r
           WHERE r.business_id = ${alias}.business_id AND r.user_id = ${p}::uuid
        )
        OR EXISTS (
          SELECT 1 FROM whatsapp_conversation_label_assignments la
          JOIN whatsapp_agent_label_rules r ON r.label_id = la.label_id
           WHERE la.conversation_id = ${alias}.id
             AND r.business_id = ${alias}.business_id
             AND r.user_id = ${p}::uuid
        )
      )
    )
  )`;
  return { sql, params: [viewer.userId] };
}

export async function loadOwnership(businessId: string, conversationId: string): Promise<OwnershipRow | null> {
  return queryOne<OwnershipRow>(
    `SELECT c.id::text AS id, c.business_id::text AS business_id, c.inbox_state, c.assigned_to::text AS assigned_to,
            COALESCE(u.is_active, false) AS owner_active, u.name AS owner_name,
            COALESCE(c.is_group, false) AS is_group
       FROM whatsapp_conversations c
       LEFT JOIN users u ON u.id = c.assigned_to
      WHERE c.id = $1::uuid AND c.business_id = $2::uuid`,
    [conversationId, businessId],
  );
}

export function liveOwnerId(row: Pick<OwnershipRow, 'inbox_state' | 'assigned_to' | 'owner_active'>): string | null {
  return row.inbox_state === 'intervened' && row.assigned_to && row.owner_active ? row.assigned_to : null;
}

export async function canViewConversation(viewer: InboxViewer, conversationId: string): Promise<boolean> {
  if (viewer.isSupervisor) {
    const row = await queryOne<{ ok: number }>(
      `SELECT 1 AS ok FROM whatsapp_conversations WHERE id = $1::uuid AND business_id = $2::uuid`,
      [conversationId, viewer.businessId],
    );
    return !!row;
  }
  const vis = visibilityClause(viewer, 'c', 3);
  const row = await queryOne<{ ok: number }>(
    `SELECT 1 AS ok FROM whatsapp_conversations c
      WHERE c.id = $1::uuid AND c.business_id = $2::uuid AND ${vis.sql}`,
    [conversationId, viewer.businessId, ...vis.params],
  );
  return !!row;
}

/** Groups have no single customer to own, so anyone who can see a group may reply. */
export function canReply(viewer: InboxViewer, row: OwnershipRow): boolean {
  if (row.is_group) return true;
  return liveOwnerId(row) === viewer.userId;
}

/** What the signed-in user can do with this chat, for the inbox UI. */
export function ownershipView(viewer: InboxViewer, row: OwnershipRow) {
  const owner = liveOwnerId(row);
  return {
    inbox_state: owner ? ('intervened' as const) : row.inbox_state === 'intervened' ? ('requesting' as const) : row.inbox_state,
    assigned_to: owner,
    owner_name: owner ? row.owner_name : null,
    is_group: row.is_group,
    is_supervisor: viewer.isSupervisor,
    can_reply: canReply(viewer, row),
    can_intervene: !row.is_group && !owner,
    can_resolve: canResolve(viewer, row),
    can_transfer: !row.is_group && canTransfer(viewer, row),
    can_take_over: !row.is_group && !!owner && canTakeOver(viewer, row),
  };
}

export function canResolve(viewer: InboxViewer, row: OwnershipRow): boolean {
  if (row.inbox_state === 'active') return false;
  return viewer.isSupervisor || liveOwnerId(row) === viewer.userId;
}

export function canTransfer(viewer: InboxViewer, row: OwnershipRow): boolean {
  return viewer.isSupervisor || liveOwnerId(row) === viewer.userId;
}

export function canTakeOver(viewer: InboxViewer, row: OwnershipRow): boolean {
  return viewer.isSupervisor && liveOwnerId(row) !== viewer.userId;
}

/** Active member of the business with "WhatsApp Chats" view access (or the primary admin). */
export async function isEligibleInboxAgent(businessId: string, userId: string): Promise<boolean> {
  const user = await queryOne<{ is_primary_admin: boolean }>(
    `SELECT u.is_primary_admin FROM users u
      WHERE u.id = $1::uuid AND u.is_active = true
        AND (u.business_id = $2::uuid
             OR EXISTS (SELECT 1 FROM user_businesses ub WHERE ub.user_id = u.id AND ub.business_id = $2::uuid))`,
    [userId, businessId],
  );
  if (!user) return false;
  if (user.is_primary_admin) return true;
  return checkUserPermission(userId, 'whatsapp_inbox', 'read');
}

type Client = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

async function inTransaction<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client as unknown as Client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function insertEvent(
  client: Client,
  businessId: string,
  conversationId: string,
  type: OwnershipEventType,
  actorUserId: string | null,
  targetUserId: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO whatsapp_conversation_events (business_id, conversation_id, type, actor_user_id, target_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [businessId, conversationId, type, actorUserId, targetUserId],
  );
}

/** Push the updated row (with owner name and the triggering event) to live inbox clients. */
export async function broadcastOwnership(
  businessId: string,
  conversationId: string,
  event?: { type: OwnershipEventType; actor_user_id: string | null; target_user_id: string | null },
): Promise<void> {
  try {
    // customer_name / customer_phone mirror the list API so a row that (re)appears live is labelled the same.
    const conv = await queryOne(
      `SELECT c.*, u.name AS owner_name,
              COALESCE(cust.name, c.whatsapp_display_name) AS customer_name,
              COALESCE(cust.phone, c.from_number) AS customer_phone,
              COALESCE((SELECT array_agg(la.label_id::text) FROM whatsapp_conversation_label_assignments la
                         WHERE la.conversation_id = c.id), '{}') AS label_ids
         FROM whatsapp_conversations c
         LEFT JOIN users u ON u.id = c.assigned_to
         LEFT JOIN LATERAL (
           SELECT cu.name, cu.phone FROM customers cu
            WHERE cu.business_id = c.business_id
              AND (cu.id = c.customer_id
                   OR (c.customer_id IS NULL
                       AND REGEXP_REPLACE(cu.phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(c.from_number, '[^0-9]', '', 'g')))
            ORDER BY (cu.id = c.customer_id) DESC NULLS LAST
            LIMIT 1
         ) cust ON true
        WHERE c.id = $1::uuid AND c.business_id = $2::uuid`,
      [conversationId, businessId],
    );
    if (conv) emitConversationUpdate(businessId, { ...conv, ownership_event: event ?? null });
  } catch (err) {
    console.warn('[inbox-ownership] broadcast failed:', err instanceof Error ? err.message : err);
  }
}

async function notifyAssignee(
  businessId: string,
  conversationId: string,
  targetUserId: string,
  actorName: string | null,
): Promise<void> {
  try {
    const label = await queryOne<{ name: string | null; phone: string | null }>(
      `SELECT NULLIF(c.whatsapp_display_name, '') AS name, c.from_number AS phone
         FROM whatsapp_conversations c WHERE c.id = $1::uuid`,
      [conversationId],
    ).catch(() => null);
    const who = label?.name || label?.phone || 'A customer';
    const title = 'WhatsApp chat assigned to you';
    const message = actorName ? `${actorName} transferred the chat with ${who} to you.` : `The chat with ${who} was assigned to you.`;
    const ins = await queryOne<{ id: string }>(
      `INSERT INTO notifications (business_id, user_id, type, title, message, reference_type, reference_id, created_at)
       VALUES ($1, $2, 'general', $3, $4, 'whatsapp_conversation', $5, CURRENT_TIMESTAMP)
       RETURNING id`,
      [businessId, targetUserId, title, message, conversationId],
    );
    const { getRedisConnection } = await import('@/lib/queue/redis');
    const redis = getRedisConnection();
    if (ins?.id && redis && redis.status === 'ready') {
      void redis
        .publish('notifications', JSON.stringify({ businessId, userId: targetUserId, notificationId: ins.id, timestamp: Date.now() }))
        .catch(() => undefined);
    }
  } catch (err) {
    console.warn('[inbox-ownership] notify failed:', err instanceof Error ? err.message : err);
  }
}

async function userName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const row = await queryOne<{ name: string | null }>('SELECT name FROM users WHERE id = $1::uuid', [userId]).catch(() => null);
  return row?.name ?? null;
}

async function requireRow(viewer: InboxViewer, conversationId: string): Promise<OwnershipRow> {
  const row = await loadOwnership(viewer.businessId, conversationId);
  if (!row || !(await canViewConversation(viewer, conversationId))) {
    throw new OwnershipError('Conversation not found', 404, 'NOT_FOUND');
  }
  return row;
}

/** True when the agent's label rules (if any) would let them see this chat while it is unowned. */
async function passesLabelRules(viewer: InboxViewer, conversationId: string): Promise<boolean> {
  if (viewer.isSupervisor) return true;
  const row = await queryOne<{ ok: number }>(
    `SELECT 1 AS ok
      WHERE NOT EXISTS (SELECT 1 FROM whatsapp_agent_label_rules r WHERE r.business_id = $2::uuid AND r.user_id = $3::uuid)
         OR EXISTS (
              SELECT 1 FROM whatsapp_conversation_label_assignments la
              JOIN whatsapp_agent_label_rules r ON r.label_id = la.label_id
             WHERE la.conversation_id = $1::uuid AND r.business_id = $2::uuid AND r.user_id = $3::uuid)`,
    [conversationId, viewer.businessId, viewer.userId],
  );
  return !!row;
}

function alreadyTaken(row: OwnershipRow | null): OwnershipError {
  const name = row?.owner_name || 'another agent';
  return new OwnershipError(`Already taken by ${name}`, 409, 'ALREADY_INTERVENED', row?.owner_name);
}

/** Claim an unowned chat. The first click wins; a lost race throws 409 with the winner's name. */
export async function intervene(viewer: InboxViewer, conversationId: string): Promise<void> {
  const row = await loadOwnership(viewer.businessId, conversationId);
  if (!row) throw new OwnershipError('Conversation not found', 404, 'NOT_FOUND');
  if (liveOwnerId(row) === viewer.userId) return;
  if (!(await canViewConversation(viewer, conversationId))) {
    // Someone else claimed it after this agent's list loaded; tell them who, unless label rules hide it.
    if (liveOwnerId(row) && (await passesLabelRules(viewer, conversationId))) throw alreadyTaken(row);
    throw new OwnershipError('Conversation not found', 404, 'NOT_FOUND');
  }

  const claimed = await inTransaction(async (client) => {
    const res = await client.query(
      `UPDATE whatsapp_conversations c
          SET inbox_state = 'intervened', assigned_to = $3::uuid, intervened_at = NOW(),
              conversation_status = 'open', handoff_requested_at = NULL
        WHERE c.id = $1::uuid AND c.business_id = $2::uuid AND ${UNOWNED_SQL('c')}
        RETURNING c.id`,
      [conversationId, viewer.businessId, viewer.userId],
    );
    if (!res.rowCount) return false;
    await insertEvent(client, viewer.businessId, conversationId, 'intervened', viewer.userId, viewer.userId);
    return true;
  });

  if (!claimed) {
    const now = await loadOwnership(viewer.businessId, conversationId);
    if (now && liveOwnerId(now) === viewer.userId) return;
    throw alreadyTaken(now);
  }
  // Person owns the chat — drop any leftover bot flow so it cannot swallow later messages.
  const { endActiveSessionsForConversation } = await import('@/lib/whatsapp/flows/store');
  await endActiveSessionsForConversation(viewer.businessId, conversationId).catch(() => undefined);
  await broadcastOwnership(viewer.businessId, conversationId, {
    type: 'intervened',
    actor_user_id: viewer.userId,
    target_user_id: viewer.userId,
  });
}

/** Supervisor takes the chat from whoever owns it (or claims it if unowned). */
export async function takeOver(viewer: InboxViewer, conversationId: string): Promise<void> {
  const row = await requireRow(viewer, conversationId);
  if (!viewer.isSupervisor) {
    throw new OwnershipError('Only supervisors can take over a chat', 403, 'NOT_SUPERVISOR');
  }
  if (liveOwnerId(row) === viewer.userId) return;
  const previous = liveOwnerId(row);

  await inTransaction(async (client) => {
    await client.query(
      `UPDATE whatsapp_conversations
          SET inbox_state = 'intervened', assigned_to = $3::uuid, intervened_at = NOW(),
              conversation_status = 'open', handoff_requested_at = NULL
        WHERE id = $1::uuid AND business_id = $2::uuid`,
      [conversationId, viewer.businessId, viewer.userId],
    );
    await insertEvent(client, viewer.businessId, conversationId, previous ? 'taken_over' : 'intervened', viewer.userId, previous ?? viewer.userId);
  });
  await broadcastOwnership(viewer.businessId, conversationId, {
    type: previous ? 'taken_over' : 'intervened',
    actor_user_id: viewer.userId,
    target_user_id: previous ?? viewer.userId,
  });
}

/** Owner hands their chat to someone else; a supervisor can move any chat. */
export async function transfer(viewer: InboxViewer, conversationId: string, toUserId: string): Promise<void> {
  const row = await requireRow(viewer, conversationId);
  if (!canTransfer(viewer, row)) {
    throw new OwnershipError('Only the agent handling this chat or a supervisor can transfer it', 403, 'NOT_OWNER');
  }
  if (!/^[0-9a-f-]{36}$/i.test(toUserId) || !(await isEligibleInboxAgent(viewer.businessId, toUserId))) {
    throw new OwnershipError('That person cannot receive WhatsApp chats', 400, 'INVALID_TARGET');
  }
  if (liveOwnerId(row) === toUserId) return;

  const moved = await inTransaction(async (client) => {
    const res = await client.query(
      `UPDATE whatsapp_conversations c
          SET inbox_state = 'intervened', assigned_to = $3::uuid, intervened_at = NOW(),
              conversation_status = 'open', handoff_requested_at = NULL
        WHERE c.id = $1::uuid AND c.business_id = $2::uuid
          AND ($5::boolean OR (c.inbox_state = 'intervened' AND c.assigned_to = $4::uuid))
        RETURNING c.id`,
      [conversationId, viewer.businessId, toUserId, viewer.userId, viewer.isSupervisor],
    );
    if (!res.rowCount) return false;
    await insertEvent(client, viewer.businessId, conversationId, 'transferred', viewer.userId, toUserId);
    return true;
  });
  if (!moved) {
    throw new OwnershipError('This chat is no longer yours to transfer', 409, 'NOT_OWNER');
  }

  await broadcastOwnership(viewer.businessId, conversationId, {
    type: 'transferred',
    actor_user_id: viewer.userId,
    target_user_id: toUserId,
  });
  await notifyAssignee(viewer.businessId, conversationId, toUserId, await userName(viewer.userId));
}

/** Give a chat to a specific agent without a human actor (e.g. AI handoff to a named person). */
export async function assignToAgent(businessId: string, conversationId: string, toUserId: string): Promise<boolean> {
  if (!(await isEligibleInboxAgent(businessId, toUserId))) return false;
  const moved = await inTransaction(async (client) => {
    const res = await client.query(
      `UPDATE whatsapp_conversations c
          SET inbox_state = 'intervened', assigned_to = $3::uuid, intervened_at = NOW(),
              conversation_status = 'open'
        WHERE c.id = $1::uuid AND c.business_id = $2::uuid AND ${UNOWNED_SQL('c')}
        RETURNING c.id`,
      [conversationId, businessId, toUserId],
    );
    if (!res.rowCount) return false;
    await insertEvent(client, businessId, conversationId, 'transferred', null, toUserId);
    return true;
  });
  if (moved) {
    await broadcastOwnership(businessId, conversationId, { type: 'transferred', actor_user_id: null, target_user_id: toUserId });
    await notifyAssignee(businessId, conversationId, toUserId, null);
  }
  return moved;
}

const RESOLVE_SET = `inbox_state = 'active', assigned_to = NULL, resolved_at = NOW(), conversation_status = 'closed',
  bot_paused_until = NULL, bot_paused_reason = NULL, handoff_requested_at = NULL`;

/** Return the chat to the bot and to everyone. */
export async function resolve(viewer: InboxViewer, conversationId: string): Promise<void> {
  const row = await requireRow(viewer, conversationId);
  if (row.inbox_state === 'active') return;
  if (!canResolve(viewer, row)) {
    throw new OwnershipError('Only the agent handling this chat or a supervisor can resolve it', 403, 'NOT_OWNER');
  }
  const done = await inTransaction(async (client) => {
    const res = await client.query(
      `UPDATE whatsapp_conversations c SET ${RESOLVE_SET}
        WHERE c.id = $1::uuid AND c.business_id = $2::uuid AND c.inbox_state <> 'active'
          AND ($4::boolean OR (c.inbox_state = 'intervened' AND c.assigned_to = $3::uuid))
        RETURNING c.id`,
      [conversationId, viewer.businessId, viewer.userId, viewer.isSupervisor],
    );
    if (!res.rowCount) return false;
    await insertEvent(client, viewer.businessId, conversationId, 'resolved', viewer.userId, null);
    return true;
  });
  if (!done) throw new OwnershipError('This chat is no longer yours to resolve', 409, 'NOT_OWNER');
  // Hand back to the bot without a parked flow session from "Talk to team" / handoff.
  const { endActiveSessionsForConversation } = await import('@/lib/whatsapp/flows/store');
  await endActiveSessionsForConversation(viewer.businessId, conversationId).catch(() => undefined);
  await broadcastOwnership(viewer.businessId, conversationId, { type: 'resolved', actor_user_id: viewer.userId, target_user_id: null });
}

/** Active chat needs a person (handoff, no bot reply). No-op for requesting/intervened chats. */
export async function markRequesting(businessId: string, conversationId: string): Promise<boolean> {
  const moved = await inTransaction(async (client) => {
    const res = await client.query(
      `UPDATE whatsapp_conversations
          SET inbox_state = 'requesting', requested_at = NOW(), assigned_to = NULL,
              conversation_status = 'pending'
        WHERE id = $1::uuid AND business_id = $2::uuid AND inbox_state = 'active' AND NOT COALESCE(is_group, false)
        RETURNING id`,
      [conversationId, businessId],
    );
    if (!res.rowCount) return false;
    await insertEvent(client, businessId, conversationId, 'requested', null, null);
    return true;
  });
  if (moved) {
    await broadcastOwnership(businessId, conversationId, { type: 'requested', actor_user_id: null, target_user_id: null });
  }
  return moved;
}

/** An incoming message no automation answered goes to the Requesting queue. Never throws. */
export async function queueIfUnanswered(
  businessId: string,
  conversationUuid: string | undefined,
  outcome: { replied: boolean; handled?: boolean; isGroup?: boolean },
): Promise<void> {
  if (!conversationUuid || outcome.replied || outcome.handled || outcome.isGroup) return;
  await markRequesting(businessId, conversationUuid).catch((err) =>
    console.warn('[inbox] markRequesting failed:', err instanceof Error ? err.message : err),
  );
}

/** Auto-resolve intervened chats whose customer has been silent for 24h (businesses with the setting on). */
export async function autoResolveStale(limit = 500): Promise<number> {
  const rows = await queryRows<{ id: string; business_id: string }>(
    `SELECT c.id::text AS id, c.business_id::text AS business_id
       FROM whatsapp_conversations c
       JOIN business_settings bs ON bs.business_id = c.business_id
      WHERE c.inbox_state = 'intervened'
        AND COALESCE(bs.whatsapp_auto_resolve_enabled, true) = true
        AND COALESCE(
              (SELECT MAX(m.created_at) FROM whatsapp_conversation_messages m
                WHERE m.conversation_id = c.id AND m.direction = 'incoming'),
              c.intervened_at, c.last_message_at
            ) < NOW() - INTERVAL '24 hours'
      LIMIT $1`,
    [limit],
  );
  let count = 0;
  for (const r of rows) {
    const done = await inTransaction(async (client) => {
      const res = await client.query(
        `UPDATE whatsapp_conversations SET ${RESOLVE_SET}
          WHERE id = $1::uuid AND business_id = $2::uuid AND inbox_state = 'intervened' RETURNING id`,
        [r.id, r.business_id],
      );
      if (!res.rowCount) return false;
      await insertEvent(client, r.business_id, r.id, 'auto_resolved', null, null);
      return true;
    });
    if (done) {
      count++;
      const { endActiveSessionsForConversation } = await import('@/lib/whatsapp/flows/store');
      await endActiveSessionsForConversation(r.business_id, r.id).catch(() => undefined);
      await broadcastOwnership(r.business_id, r.id, { type: 'auto_resolved', actor_user_id: null, target_user_id: null });
    }
  }
  return count;
}

/** Intervened chats whose owner is deleted or deactivated go back to Requesting. */
export async function releaseOrphaned(limit = 500): Promise<number> {
  const rows = await queryRows<{ id: string; business_id: string; prev: string | null }>(
    `UPDATE whatsapp_conversations c
        SET inbox_state = 'requesting', requested_at = NOW(), conversation_status = 'pending', assigned_to = NULL
      WHERE c.id IN (
        SELECT c2.id FROM whatsapp_conversations c2
         WHERE c2.inbox_state = 'intervened'
           AND (c2.assigned_to IS NULL OR NOT ${ACTIVE_OWNER_SQL('c2')})
         LIMIT $1
      )
      RETURNING c.id::text AS id, c.business_id::text AS business_id, NULL::text AS prev`,
    [limit],
  );
  for (const r of rows) {
    await query(
      `INSERT INTO whatsapp_conversation_events (business_id, conversation_id, type) VALUES ($1, $2, 'released')`,
      [r.business_id, r.id],
    ).catch(() => undefined);
    await broadcastOwnership(r.business_id, r.id, { type: 'released', actor_user_id: null, target_user_id: null });
  }
  return rows.length;
}

export interface OwnershipEventRow {
  id: string;
  type: OwnershipEventType;
  actor_user_id: string | null;
  actor_name: string | null;
  target_user_id: string | null;
  target_name: string | null;
  created_at: string;
}

export async function listOwnershipEvents(businessId: string, conversationId: string): Promise<OwnershipEventRow[]> {
  return queryRows<OwnershipEventRow>(
    `SELECT e.id::text AS id, e.type, e.actor_user_id::text AS actor_user_id, a.name AS actor_name,
            e.target_user_id::text AS target_user_id, t.name AS target_name, e.created_at
       FROM whatsapp_conversation_events e
       LEFT JOIN users a ON a.id = e.actor_user_id
       LEFT JOIN users t ON t.id = e.target_user_id
      WHERE e.business_id = $1::uuid AND e.conversation_id = $2::uuid
      ORDER BY e.created_at ASC
      LIMIT 500`,
    [businessId, conversationId],
  ).catch(() => []);
}

/** Record that a user has the inbox open (drives online/offline in the Transfer list). */
export async function touchInboxPresence(userId: string): Promise<void> {
  await query('UPDATE users SET inbox_last_seen_at = NOW() WHERE id = $1::uuid', [userId]).catch(() => undefined);
}
