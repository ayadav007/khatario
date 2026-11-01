/**
 * A WhatsApp message id belongs to one business (migration 451). When two Khatario businesses message each other
 * (Supplier Hub), the same id is stored twice: outgoing for the sender, incoming for the receiver. Neither write may
 * touch the other business's row; a re-delivery within one business still updates its own row only.
 * Phase 1 (old global constraint still present): no overwrite, the second copy is skipped.
 * Phase 2 (global constraint dropped, the state kh_phase2_test is kept in): both copies are stored.
 * Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/whatsapp-message-tenant-scope.db.test.ts --runInBand
 * Migrations 447 and 451 plus the phase-2 drop (docs/SERVER_INFRASTRUCTURE.md) must be applied to kh_phase2_test.
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

jest.mock('@/lib/services/lead-analyzer', () => ({
  LeadAnalyzer: jest.fn().mockImplementation(() => ({ analyzeLead: jest.fn() })),
}));
jest.mock('@/lib/whatsapp-websocket', () => ({
  emitConversationUpdate: jest.fn(),
  emitNewMessage: jest.fn(),
  emitSummaryUpdate: jest.fn(),
}));
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { query, queryOne, queryRows, closePool } from '@/lib/db';
import { storeIncomingMessage, storeOutgoingMessage } from '@/lib/whatsapp-crm';
import { cleanupBusinesses, seedBusiness, seedChat } from './fixtures/connect-leads';

const run = enabled ? describe : describe.skip;

run('message ids are scoped to a business (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  let SUPPLIER = '';
  let BUYER = '';
  let SUPPLIER_CHAT = '';
  const SUPPLIER_PHONE = `9170${String(Date.now()).slice(-8)}`;
  const BUYER_PHONE = `9180${String(Date.now()).slice(-8)}`;

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const idx = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_indexes
        WHERE tablename = 'whatsapp_conversation_messages' AND indexname = 'whatsapp_conversation_messages_business_message_uniq'`,
    );
    if (!idx?.n) throw new Error('Apply migration 451 to kh_phase2_test first');
    if (await hasGlobalConstraint()) throw new Error('Apply the phase-2 drop of whatsapp_conversation_messages_message_id_key first');
    SUPPLIER = (await seedBusiness('scope-s')).businessId;
    BUYER = (await seedBusiness('scope-b')).businessId;
    SUPPLIER_CHAT = (await seedChat(SUPPLIER, { phone: BUYER_PHONE })).id;
  });

  afterAll(async () => {
    try {
      await cleanupBusinesses([SUPPLIER, BUYER]);
    } finally {
      await closePool();
    }
  });

  async function hasGlobalConstraint(): Promise<boolean> {
    const old = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_constraint WHERE conname = 'whatsapp_conversation_messages_message_id_key'`,
    );
    return (old?.n ?? 0) > 0;
  }

  // Runs first, while every message id in the table is still globally unique.
  test('phase 1, global constraint still present: the sender never overwrites the receiver, and nothing throws', async () => {
    await query(
      `ALTER TABLE whatsapp_conversation_messages
         ADD CONSTRAINT whatsapp_conversation_messages_message_id_key UNIQUE (message_id)`,
    );
    try {
      const id = `wamid.${randomUUID()}`;
      await storeIncomingMessage(BUYER, `${SUPPLIER_PHONE}@s.whatsapp.net`, BUYER_PHONE, 'Your order is packed', id);
      await expect(
        storeOutgoingMessage(SUPPLIER, SUPPLIER_CHAT, `${BUYER_PHONE}@s.whatsapp.net`, 'Overwritten?', id),
      ).resolves.not.toThrow();

      const rows = await rowsFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ business_id: BUYER, direction: 'incoming', message_text: 'Your order is packed', status: 'delivered' });
    } finally {
      await query(`ALTER TABLE whatsapp_conversation_messages DROP CONSTRAINT IF EXISTS whatsapp_conversation_messages_message_id_key`);
    }
  });

  async function rowsFor(messageId: string) {
    return queryRows<{ business_id: string; direction: string; message_text: string; status: string }>(
      `SELECT business_id::text AS business_id, direction, message_text, status
         FROM whatsapp_conversation_messages WHERE message_id = $1 ORDER BY direction`,
      [messageId],
    );
  }

  test('the receiver stores the message first, then the sender: each keeps its own row', async () => {
    const id = `wamid.${randomUUID()}`;
    await storeIncomingMessage(BUYER, `${SUPPLIER_PHONE}@s.whatsapp.net`, BUYER_PHONE, 'Your order is packed', id);
    await storeOutgoingMessage(SUPPLIER, SUPPLIER_CHAT, `${BUYER_PHONE}@s.whatsapp.net`, 'Your order is packed (edited)', id);

    const rows = await rowsFor(id);
    expect(rows).toHaveLength(2);
    const buyer = rows.find((r) => r.business_id === BUYER)!;
    const supplier = rows.find((r) => r.business_id === SUPPLIER)!;
    expect(buyer).toMatchObject({ direction: 'incoming', message_text: 'Your order is packed', status: 'delivered' });
    expect(supplier).toMatchObject({ direction: 'outgoing', message_text: 'Your order is packed (edited)' });
  });

  test('the sender stores it first, then the receiver: the receiver still gets the message in its own chat', async () => {
    const id = `wamid.${randomUUID()}`;
    await storeOutgoingMessage(SUPPLIER, SUPPLIER_CHAT, `${BUYER_PHONE}@s.whatsapp.net`, 'Invoice attached', id);
    const { conversationId } = await storeIncomingMessage(BUYER, `${SUPPLIER_PHONE}@s.whatsapp.net`, BUYER_PHONE, 'Invoice attached', id);

    const rows = await rowsFor(id);
    expect(rows.map((r) => [r.business_id, r.direction]).sort()).toEqual(
      [[BUYER, 'incoming'], [SUPPLIER, 'outgoing']].sort(),
    );
    const inBuyerChat = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM whatsapp_conversation_messages WHERE conversation_id = $1 AND message_id = $2`,
      [conversationId, id],
    );
    expect(inBuyerChat?.n).toBe(1);
  });

  test('a re-delivery within one business still updates its own row only', async () => {
    const id = `wamid.${randomUUID()}`;
    await storeIncomingMessage(BUYER, `${SUPPLIER_PHONE}@s.whatsapp.net`, BUYER_PHONE, 'Hello', id);
    await storeIncomingMessage(BUYER, `${SUPPLIER_PHONE}@s.whatsapp.net`, BUYER_PHONE, 'Hello', id);
    const rows = await rowsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].business_id).toBe(BUYER);
  });
});
