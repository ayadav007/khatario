/**
 * Shared-inbox ownership (migration 362): intervene races, transfer, take over, resolve, the
 * Requesting queue, auto-resolve, orphan release and agent label rules. Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/whatsapp-inbox-ownership.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test; migrations 349, 361 and 362 must be applied there.
 */
import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';

const TEST_DB = 'kh_phase2_test';
const enabled = !!process.env.PHASE2_TEST_DATABASE_URL || process.env.INBOX_DB_TEST === '1';
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
} else if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}

const mockEmit = jest.fn();
jest.mock('@/lib/whatsapp-websocket', () => ({
  emitConversationUpdate: (...a: unknown[]) => mockEmit(...a),
}));
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { query, queryOne, queryRows, closePool } from '@/lib/db';
import {
  OwnershipError,
  autoResolveStale,
  canViewConversation,
  intervene,
  listOwnershipEvents,
  loadOwnership,
  markRequesting,
  releaseOrphaned,
  resolve,
  takeOver,
  transfer,
  visibilityClause,
  type InboxViewer,
} from '@/lib/whatsapp/inbox-ownership';

const run = enabled ? describe : describe.skip;

run('WhatsApp inbox ownership (kh_phase2_test)', () => {
  jest.setTimeout(60000);

  const B = randomUUID();
  const ADMIN = randomUUID();
  const ASHA = randomUUID();
  const RAVI = randomUUID();
  const SUP = randomUUID();
  const OUTSIDER = randomUUID();
  const AGENT_ROLE = randomUUID();
  const SUP_ROLE = randomUUID();
  const LABEL_VIP = randomUUID();
  const tag = B.slice(0, 6);
  let seq = 0;

  const v = (userId: string, isSupervisor = false): InboxViewer => ({ userId, businessId: B, isSupervisor });

  async function newChat(over: { state?: string; owner?: string | null; group?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    const phone = `91${String(Date.now()).slice(-6)}${String(++seq).padStart(4, '0')}`;
    await query(
      `INSERT INTO whatsapp_conversations (id, business_id, from_number, to_number, conversation_id, is_group, inbox_state, assigned_to, last_message_at)
       VALUES ($1, $2, $3, '919999999999', $3, $4, $5, $6, NOW())`,
      [id, B, phone, over.group ?? false, over.state ?? 'active', over.owner ?? null],
    );
    return id;
  }

  async function code(p: Promise<unknown>): Promise<string> {
    try {
      await p;
      return 'ok';
    } catch (e) {
      if (e instanceof OwnershipError) return e.code;
      throw e;
    }
  }

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const col = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'whatsapp_conversation_events'`,
    );
    if (!col?.n) throw new Error('Apply migration 362 to kh_phase2_test first');

    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B, `Inbox ${tag}`],
    );
    await query(
      `INSERT INTO user_roles (id, business_id, role_name, role_key) VALUES ($1, $3, 'Agent', 'agent_${tag}'), ($2, $3, 'Lead', 'lead_${tag}')`,
      [AGENT_ROLE, SUP_ROLE, B],
    );
    await query(
      `INSERT INTO role_permissions (role_id, module_key, can_view) VALUES
         ($1, 'whatsapp_inbox', true), ($2, 'whatsapp_inbox', true), ($2, 'whatsapp_inbox_supervise', true)`,
      [AGENT_ROLE, SUP_ROLE],
    );
    const users: Array<[string, string, boolean, string | null]> = [
      [ADMIN, 'Owner', true, null],
      [ASHA, 'Asha', false, AGENT_ROLE],
      [RAVI, 'Ravi', false, AGENT_ROLE],
      [SUP, 'Sunita', false, SUP_ROLE],
      [OUTSIDER, 'NoInbox', false, null],
    ];
    for (const [id, name, admin, role] of users) {
      await query(
        `INSERT INTO users (id, business_id, name, phone, is_primary_admin, role_id, is_active) VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [id, B, name, `8${String(Date.now() + ++seq).slice(-9)}`, admin, role],
      );
    }
    await query(`INSERT INTO whatsapp_conversation_labels (id, business_id, name) VALUES ($1, $2, 'VIP')`, [LABEL_VIP, B]);
  });

  afterAll(async () => {
    try {
      await query(`DELETE FROM notifications WHERE business_id = $1`, [B]).catch(() => undefined);
      await query(`DELETE FROM whatsapp_conversations WHERE business_id = $1`, [B]);
      await query(`DELETE FROM users WHERE business_id = $1`, [B]);
      await query(`DELETE FROM user_roles WHERE business_id = $1`, [B]);
      await query(`DELETE FROM businesses WHERE id = $1`, [B]);
    } finally {
      await closePool();
    }
  });

  beforeEach(() => mockEmit.mockClear());

  test('concurrent intervene: exactly one agent wins, the other gets 409 with the winner', async () => {
    const c = await newChat({ state: 'requesting' });
    const results = await Promise.allSettled([intervene(v(ASHA), c), intervene(v(RAVI), c)]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toMatchObject({ status: 409, code: 'ALREADY_INTERVENED' });

    const row = await loadOwnership(B, c);
    expect(row!.inbox_state).toBe('intervened');
    expect([ASHA, RAVI]).toContain(row!.assigned_to);
    expect(lost[0].reason.ownerName).toBe(row!.owner_name);

    const events = await listOwnershipEvents(B, c);
    expect(events.map((e) => e.type)).toEqual(['intervened']);
    expect(mockEmit).toHaveBeenCalledWith(B, expect.objectContaining({ id: c, ownership_event: expect.objectContaining({ type: 'intervened' }) }));

    expect(await code(intervene(v(row!.assigned_to!), c))).toBe('ok');
  });

  test('owner transfers; a non-owner cannot; target must be able to receive chats', async () => {
    const c = await newChat({ state: 'intervened', owner: ASHA });
    expect(await code(transfer(v(RAVI), c, RAVI))).toBe('NOT_FOUND');
    expect(await code(transfer(v(ASHA), c, OUTSIDER))).toBe('INVALID_TARGET');
    expect(await code(transfer(v(ASHA), c, 'not-a-uuid'))).toBe('INVALID_TARGET');

    await transfer(v(ASHA), c, RAVI);
    expect((await loadOwnership(B, c))!.assigned_to).toBe(RAVI);
    expect(await canViewConversation(v(ASHA), c)).toBe(false);
    expect(await canViewConversation(v(RAVI), c)).toBe(true);

    const note = await queryOne<{ user_id: string; reference_type: string; message: string }>(
      `SELECT user_id::text, reference_type, message FROM notifications WHERE business_id = $1 AND reference_id = $2`,
      [B, c],
    );
    expect(note).toMatchObject({ user_id: RAVI, reference_type: 'whatsapp_conversation' });
    expect(note!.message).toContain('Asha transferred');

    const events = await listOwnershipEvents(B, c);
    expect(events.at(-1)).toMatchObject({ type: 'transferred', actor_name: 'Asha', target_name: 'Ravi' });
  });

  test('take over is supervisor-only and records the previous owner', async () => {
    const c = await newChat({ state: 'intervened', owner: RAVI });
    expect(await code(takeOver(v(RAVI), c))).toBe('NOT_SUPERVISOR');
    await takeOver(v(SUP, true), c);
    expect((await loadOwnership(B, c))!.assigned_to).toBe(SUP);
    expect((await listOwnershipEvents(B, c)).at(-1)).toMatchObject({ type: 'taken_over', actor_user_id: SUP, target_user_id: RAVI });

    await transfer(v(SUP, true), c, ASHA);
    expect((await loadOwnership(B, c))!.assigned_to).toBe(ASHA);
  });

  test('resolve returns the chat to Active, clears the owner and the bot pause', async () => {
    const c = await newChat({ state: 'intervened', owner: ASHA });
    await query(`UPDATE whatsapp_conversations SET bot_paused_until = NOW() + interval '1 day', bot_paused_reason = 'staff' WHERE id = $1`, [c]);
    expect(await code(resolve(v(RAVI), c))).toBe('NOT_FOUND');
    await resolve(v(ASHA), c);
    const row = await queryOne<Record<string, unknown>>(
      `SELECT inbox_state, assigned_to, conversation_status, bot_paused_until, resolved_at FROM whatsapp_conversations WHERE id = $1`,
      [c],
    );
    expect(row).toMatchObject({ inbox_state: 'active', assigned_to: null, conversation_status: 'closed', bot_paused_until: null });
    expect(row!.resolved_at).not.toBeNull();
    expect(await code(resolve(v(ASHA), c))).toBe('ok');

    const r2 = await newChat({ state: 'requesting' });
    expect(await code(resolve(v(ASHA), r2))).toBe('NOT_OWNER');
    await resolve(v(SUP, true), r2);
    expect((await loadOwnership(B, r2))!.inbox_state).toBe('active');
  });

  test('markRequesting only moves Active one-to-one chats', async () => {
    const active = await newChat();
    const owned = await newChat({ state: 'intervened', owner: ASHA });
    const group = await newChat({ group: true });
    expect(await markRequesting(B, active)).toBe(true);
    expect(await markRequesting(B, active)).toBe(false);
    expect(await markRequesting(B, owned)).toBe(false);
    expect(await markRequesting(B, group)).toBe(false);
    expect((await loadOwnership(B, active))!.inbox_state).toBe('requesting');
    expect((await loadOwnership(B, owned))!.assigned_to).toBe(ASHA);
    expect((await listOwnershipEvents(B, active)).map((e) => e.type)).toEqual(['requested']);
  });

  test('auto-resolve after 24h of customer silence, unless the business turned it off', async () => {
    const stale = await newChat({ state: 'intervened', owner: ASHA });
    const fresh = await newChat({ state: 'intervened', owner: ASHA });
    await query(`UPDATE whatsapp_conversations SET intervened_at = NOW() - interval '30 hours' WHERE id IN ($1, $2)`, [stale, fresh]);
    await query(
      `INSERT INTO whatsapp_conversation_messages (business_id, conversation_id, message_id, from_number, to_number, direction, message_text, message_type, created_at)
       VALUES ($1, $2, $3, '910000000000', '919999999999', 'incoming', 'still there?', 'text', NOW() - interval '1 hour')`,
      [B, fresh, `test-${randomUUID()}`],
    );
    await query(
      `INSERT INTO business_settings (business_id, whatsapp_auto_resolve_enabled) VALUES ($1, false)
       ON CONFLICT (business_id) DO UPDATE SET whatsapp_auto_resolve_enabled = false`,
      [B],
    );
    await autoResolveStale();
    expect((await loadOwnership(B, stale))!.inbox_state).toBe('intervened');

    await query(`UPDATE business_settings SET whatsapp_auto_resolve_enabled = true WHERE business_id = $1`, [B]);
    await autoResolveStale();
    expect((await loadOwnership(B, stale))!.inbox_state).toBe('active');
    expect((await loadOwnership(B, fresh))!.inbox_state).toBe('intervened');
    expect((await listOwnershipEvents(B, stale)).at(-1)!.type).toBe('auto_resolved');
  });

  test('a deactivated owner’s chats count as unowned and are released to Requesting', async () => {
    const c = await newChat({ state: 'intervened', owner: RAVI });
    await query(`UPDATE users SET is_active = false WHERE id = $1`, [RAVI]);
    try {
      expect(await canViewConversation(v(ASHA), c)).toBe(true);
      await intervene(v(ASHA), c);
      expect((await loadOwnership(B, c))!.assigned_to).toBe(ASHA);

      const c2 = await newChat({ state: 'intervened', owner: RAVI });
      await releaseOrphaned();
      expect(await loadOwnership(B, c2)).toMatchObject({ inbox_state: 'requesting', assigned_to: null });
      expect((await listOwnershipEvents(B, c2)).at(-1)!.type).toBe('released');
    } finally {
      await query(`UPDATE users SET is_active = true WHERE id = $1`, [RAVI]);
    }
  });

  test('visibility: agents see unowned + their own; label rules narrow the unowned set', async () => {
    await query(`DELETE FROM whatsapp_conversations WHERE business_id = $1`, [B]);
    const plain = await newChat({ state: 'requesting' });
    const vip = await newChat();
    const mine = await newChat({ state: 'intervened', owner: ASHA });
    const ravis = await newChat({ state: 'intervened', owner: RAVI });
    await query(`INSERT INTO whatsapp_conversation_label_assignments (conversation_id, label_id) VALUES ($1, $2)`, [vip, LABEL_VIP]);

    async function visible(viewer: InboxViewer): Promise<string[]> {
      const vis = visibilityClause(viewer, 'c', 2);
      const rows = await queryRows<{ id: string }>(
        `SELECT c.id::text AS id FROM whatsapp_conversations c WHERE c.business_id = $1 AND ${vis.sql}`,
        [B, ...vis.params],
      );
      return rows.map((r) => r.id).sort();
    }

    expect(await visible(v(ASHA))).toEqual([plain, vip, mine].sort());
    expect(await visible(v(SUP, true))).toEqual([plain, vip, mine, ravis].sort());

    await query(`INSERT INTO whatsapp_agent_label_rules (business_id, user_id, label_id) VALUES ($1, $2, $3)`, [B, ASHA, LABEL_VIP]);
    expect(await visible(v(ASHA))).toEqual([vip, mine].sort());
    expect(await canViewConversation(v(ASHA), plain)).toBe(false);
    expect(await code(intervene(v(ASHA), plain))).toBe('NOT_FOUND');
    expect(await visible(v(RAVI))).toEqual([plain, vip, ravis].sort());

    await intervene(v(RAVI), plain);
    expect(await code(intervene(v(ASHA), plain))).toBe('NOT_FOUND');
    await intervene(v(RAVI), vip);
    expect(await code(intervene(v(ASHA), vip))).toBe('ALREADY_INTERVENED');
  });
});
