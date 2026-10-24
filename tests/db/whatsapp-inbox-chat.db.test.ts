/**
 * Inbox chat behaviour that lives in SQL: delivery ticks only move forward, the 24-hour reply
 * window, server-side chat search, and the contact-panel status endpoint. Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/whatsapp-inbox-chat.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). The database is forced to kh_phase2_test.
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

const mockEmitNew = jest.fn();
jest.mock('@/lib/whatsapp-websocket', () => ({
  emitNewMessage: (...a: unknown[]) => mockEmitNew(...a),
  emitConversationUpdate: jest.fn(),
}));
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
let mockTransport: 'cloud' | 'baileys' = 'cloud';
jest.mock('@/lib/whatsapp/business-transport', () => ({
  businessTransport: async () => mockTransport,
}));
jest.mock('@/lib/security/premium-module-api', () => ({
  withWhatsAppPremiumApi:
    (opts: { parseJsonBody?: boolean }, handler: (ctx: unknown) => Promise<unknown>) =>
    async (request: Request, ctx?: { params?: Record<string, string> }) =>
      handler({
        request,
        body: opts?.parseJsonBody ? await request.json().catch(() => ({})) : undefined,
        businessId: request.headers.get('x-business'),
        userId: request.headers.get('x-user'),
        params: ctx?.params ?? {},
      }),
}));

import { query, queryOne, closePool } from '@/lib/db';
import { applyOutgoingStatus } from '@/lib/whatsapp/message-status';
import { replyWindow } from '@/lib/whatsapp/inbox-send';
import { GET as listConversations } from '@/app/api/whatsapp/conversations/route';
import { GET as conversationStatus } from '@/app/api/whatsapp/conversations/[id]/route';

const run = enabled ? describe : describe.skip;

run('WhatsApp inbox chat (kh_phase2_test)', () => {
  jest.setTimeout(60000);

  const B = randomUUID();
  const ADMIN = randomUUID();
  const tag = B.slice(0, 6);
  let seq = 0;

  const headers = { 'x-business': B, 'x-user': ADMIN };

  async function newChat(over: { name?: string; phone?: string; group?: boolean; blocked?: boolean; lastDir?: string } = {}) {
    const id = randomUUID();
    const phone = over.phone ?? `91${String(Date.now()).slice(-6)}${String(++seq).padStart(4, '0')}`;
    await query(
      `INSERT INTO whatsapp_conversations
         (id, business_id, from_number, to_number, conversation_id, is_group, whatsapp_display_name,
          is_blocked, last_message_direction, last_message_at)
       VALUES ($1, $2, $3, '919999999999', $3, $4, $5, $6, $7, NOW())`,
      [id, B, phone, over.group ?? false, over.name ?? null, over.blocked ?? false, over.lastDir ?? 'incoming'],
    );
    return { id, phone };
  }

  async function addMessage(conversationId: string, dir: 'incoming' | 'outgoing', text: string, at: Date, status = 'sent') {
    const mid = `wamid.${tag}.${++seq}`;
    await query(
      `INSERT INTO whatsapp_conversation_messages
         (business_id, conversation_id, message_id, from_number, to_number, message_text, message_type, direction, status, created_at)
       VALUES ($1, $2, $3, '1', '2', $4, 'text', $5, $6, $7)`,
      [B, conversationId, mid, text, dir, status, at],
    );
    return mid;
  }

  async function list(params: Record<string, string>) {
    const res = (await listConversations(
      new Request(`http://localhost/api/whatsapp/conversations?${new URLSearchParams(params)}`, { headers }) as never,
      undefined as never,
    )) as Response;
    expect(res.status).toBe(200);
    const data = await res.json();
    return (data.conversations as Array<{ id: string }>).map((c) => c.id);
  }

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B, `InboxChat ${tag}`],
    );
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, is_active) VALUES ($1, $2, 'Owner', $3, true, true)`,
      [ADMIN, B, `8${String(Date.now()).slice(-9)}`],
    );
  });

  afterAll(async () => {
    try {
      await query(`DELETE FROM whatsapp_unsubscribes WHERE business_id = $1`, [B]).catch(() => undefined);
      await query(`DELETE FROM whatsapp_conversations WHERE business_id = $1`, [B]);
      await query(`DELETE FROM users WHERE business_id = $1`, [B]);
      await query(`DELETE FROM businesses WHERE id = $1`, [B]);
    } finally {
      await closePool();
    }
  });

  test('delivery ticks only move forward, failed always applies, and the live event is status-only', async () => {
    const c = await newChat();
    const mid = await addMessage(c.id, 'outgoing', 'hello', new Date());
    const status = async () =>
      (await queryOne<{ status: string }>(`SELECT status FROM whatsapp_conversation_messages WHERE message_id = $1`, [mid]))?.status;

    mockEmitNew.mockClear();
    expect(await applyOutgoingStatus(B, mid, 'read')).toBe(true);
    expect(await status()).toBe('read');
    expect(mockEmitNew).toHaveBeenCalledWith(B, c.id, expect.objectContaining({ status: 'read', status_only: true, message_id: mid }));

    expect(await applyOutgoingStatus(B, mid, 'delivered')).toBe(false);
    expect(await status()).toBe('read');

    expect(await applyOutgoingStatus(B, mid, 'failed', 'Re-engagement message')).toBe(true);
    expect(await status()).toBe('failed');
  });

  test('reply window: open within 24h of the last customer message on Cloud, always open on QR and groups', async () => {
    const now = Date.now();
    const recent = await newChat();
    await addMessage(recent.id, 'incoming', 'hi', new Date(now - 2 * 3600_000));
    await addMessage(recent.id, 'outgoing', 'reply', new Date(now - 3600_000));
    const stale = await newChat();
    await addMessage(stale.id, 'incoming', 'old', new Date(now - 25 * 3600_000));
    const never = await newChat();

    mockTransport = 'cloud';
    const w1 = await replyWindow(B, recent.id, false, now);
    expect(w1.open).toBe(true);
    expect(new Date(w1.expires_at!).getTime()).toBe(now - 2 * 3600_000 + 24 * 3600_000);
    expect((await replyWindow(B, stale.id, false, now)).open).toBe(false);
    expect((await replyWindow(B, never.id, false, now)).open).toBe(false);
    expect((await replyWindow(B, stale.id, true, now))).toMatchObject({ transport: 'baileys', open: true });

    mockTransport = 'baileys';
    expect((await replyWindow(B, stale.id, false, now)).open).toBe(true);
    mockTransport = 'cloud';
  });

  test('chat search matches name, phone digits and message text; new_only keeps chats awaiting a reply', async () => {
    const byName = await newChat({ name: `Priya ${tag}` });
    const byPhone = await newChat({ phone: `9198${tag.replace(/\D/g, '1').padEnd(6, '7').slice(0, 6)}55` });
    const byText = await newChat({ name: 'Someone', lastDir: 'outgoing' });
    await addMessage(byText.id, 'incoming', `Do you deliver to Kharadi-${tag}?`, new Date(Date.now() - 60_000));

    expect(await list({ search: `priya ${tag}` })).toEqual([byName.id]);
    const digits = byPhone.phone.slice(-8);
    expect(await list({ search: `${digits.slice(0, 4)} ${digits.slice(4)}` })).toContain(byPhone.id);
    expect(await list({ search: `+${byPhone.phone}` })).toContain(byPhone.id);
    expect(await list({ search: `kharadi-${tag}` })).toEqual([byText.id]);
    expect(await list({ search: '100%_' })).toEqual([]);

    const newOnly = await list({ new_only: 'true', limit: '100' });
    expect(newOnly).toContain(byName.id);
    expect(newOnly).not.toContain(byText.id);
  });

  test('contact status reports blocked and opted-out numbers', async () => {
    const c = await newChat({ blocked: true });
    await query(`INSERT INTO whatsapp_unsubscribes (business_id, phone) VALUES ($1, $2)`, [B, c.phone]);
    const res = (await conversationStatus(
      new Request(`http://localhost/api/whatsapp/conversations/${c.id}`, { headers }) as never,
      { params: { id: c.id } } as never,
    )) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ is_blocked: true, is_group: false, opted_out: true });

    const other = await newChat();
    const res2 = (await conversationStatus(
      new Request(`http://localhost/api/whatsapp/conversations/${other.id}`, { headers }) as never,
      { params: { id: other.id } } as never,
    )) as Response;
    expect(await res2.json()).toMatchObject({ is_blocked: false, opted_out: false });
  });
});
