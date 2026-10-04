/**
 * WhatsApp flow CRUD, publish copy, one active session per conversation.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { createFlow, getActiveSession, listPublishedFlows, publishFlow, startSession } from '@/lib/whatsapp/flows/store';
import { shopOrderStarterDefinition } from '@/lib/whatsapp/flows/starter';

d('WhatsApp flows (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const B = randomUUID();
  const U = randomUUID();
  const CONV = randomUUID();
  const tag = B.slice(0, 8);
  const phone = `91${String(Date.now()).slice(-10)}`;

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (!/test/i.test(db.rows[0].db)) throw new Error(`Refusing to run against ${db.rows[0].db}`);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular')`,
      [B, `WaFlow ${tag}`, `27AABCF${tag.slice(0, 4).toUpperCase()}A1Z5`],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [U, B, `94${phone.slice(-8)}`],
    );
    await pool.query(
      `INSERT INTO whatsapp_conversations (id, business_id, from_number, to_number, conversation_id, whatsapp_display_name)
       VALUES ($1, $2, $3, '919999999999', $3, 'Asha')`,
      [CONV, B, phone],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM whatsapp_inbound_routing_events WHERE business_id = $1`, [B]).catch(() => {});
      await pool.query(`DELETE FROM whatsapp_flow_sessions WHERE business_id = $1`, [B]).catch(() => {});
      await pool.query(`DELETE FROM whatsapp_flows WHERE business_id = $1`, [B]).catch(() => {});
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', U, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
    } finally {
      await closePool();
    }
  });

  it('publishes a copy and allows one active session', async () => {
    const flow = await createFlow(B, U, { name: `Shop ${tag}`, definition: shopOrderStarterDefinition() });
    expect(flow.status).toBe('draft');
    const published = await publishFlow(B, U, flow.id);
    expect(published?.status).toBe('published');
    expect(published?.published_definition).toBeTruthy();
    const listed = await listPublishedFlows(B);
    expect(listed.some((f) => f.id === flow.id)).toBe(true);

    const s1 = await startSession({
      businessId: B,
      conversationId: CONV,
      flowId: flow.id,
      flowVersion: published!.version,
      currentNodeId: 'welcome',
    });
    await startSession({
      businessId: B,
      conversationId: CONV,
      flowId: flow.id,
      flowVersion: published!.version,
      currentNodeId: 'welcome',
    });
    const active = await getActiveSession(B, CONV);
    expect(active).toBeTruthy();
    expect(active!.id).not.toBe(s1.id);
  });
});
