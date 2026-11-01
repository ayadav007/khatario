/**
 * Connect leads table (migration 447): the backfill turns chats on the board into leads, the
 * migration can run twice, a phone has one open lead, and a follow-up or event needs a chat or a lead.
 * Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/connect-leads-migration.db.test.ts --runInBand
 * Migrations 418, 419 and 446 must be applied to kh_phase2_test.
 */
import fs from 'fs';
import path from 'path';
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

import { query, queryOne, queryRows, closePool } from '@/lib/db';
import { ensureStages } from '@/lib/whatsapp/pipeline';
import { cleanupBusinesses, seedBusiness, seedChat } from './fixtures/connect-leads';

const MIGRATION = path.join(process.cwd(), 'database', 'migrations', '447_connect_leads.sql');
const runMigration = () => query(fs.readFileSync(MIGRATION, 'utf8'));

const run = enabled ? describe : describe.skip;

run('connect leads migration (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  let businessId: string;
  let agentId: string;
  let chatA: { id: string; phone: string };
  let chatB: { id: string; phone: string };
  let chatC: { id: string; phone: string };
  let followupId: string;
  let stageIds: Record<string, string>;

  const leadsOf = async () =>
    (await queryRows<{ id: string }>(`SELECT id FROM leads WHERE business_id = $1`, [businessId])).length;

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const seeded = await seedBusiness('mig');
    businessId = seeded.businessId;
    agentId = seeded.agentId;
    const stages = await ensureStages(businessId);
    stageIds = Object.fromEntries(stages.map((s) => [s.name, s.id]));

    chatA = await seedChat(businessId, { name: 'Asha' });
    chatB = await seedChat(businessId);
    chatC = await seedChat(businessId);
    await query(
      `UPDATE whatsapp_conversations
          SET stage_id = $2, deal_value = 5000, expected_close_on = '2026-12-01', source = 'link',
              source_detail = '{"link_id":"x"}'::jsonb, source_at = '2026-09-15T10:00:00Z', assigned_to = $3,
              stage_changed_at = '2026-09-20T10:00:00Z'
        WHERE id = $1`,
      [chatA.id, stageIds['Interested'], agentId],
    );
    await query(
      `UPDATE whatsapp_conversations SET stage_id = $2, lost_reason = 'price', stage_changed_at = '2026-10-01T00:00:00Z' WHERE id = $1`,
      [chatB.id, stageIds['Lost']],
    );
    followupId = randomUUID();
    await query(
      `INSERT INTO whatsapp_followups (id, business_id, conversation_id, assigned_to, due_at) VALUES ($1, $2, $3, $4, NOW() + interval '1 day')`,
      [followupId, businessId, chatA.id, agentId],
    );
  });

  afterAll(async () => {
    try {
      await cleanupBusinesses([businessId]);
    } finally {
      await closePool();
    }
  });

  test('backfill makes one lead per chat on the board, with its deal, source, owner and follow-ups', async () => {
    await runMigration();

    expect(await leadsOf()).toBe(2);

    const a = await queryOne<Record<string, any>>(
      `SELECT l.*, c.created_at AS chat_created_at, l.expected_close_on::text AS close_on FROM leads l
         JOIN whatsapp_conversations c ON c.id = l.conversation_id
        WHERE l.conversation_id = $1`,
      [chatA.id],
    );
    expect(a).not.toBeNull();
    expect(a!.stage_id).toBe(stageIds['Interested']);
    expect(Number(a!.deal_value)).toBe(5000);
    expect(a!.close_on).toBe('2026-12-01');
    expect(a!.source).toBe('link');
    expect(a!.source_detail).toEqual({ link_id: 'x' });
    expect(a!.owner_id).toBe(agentId);
    expect(a!.contact_phone).toBe(chatA.phone);
    expect(a!.contact_name).toBe('Asha');
    expect(a!.lead_type).toBe('new');
    expect(a!.closed_at).toBeNull();
    expect(new Date(a!.opened_at).toISOString()).toBe('2026-09-15T10:00:00.000Z');

    const followup = await queryOne<{ lead_id: string | null }>(`SELECT lead_id FROM whatsapp_followups WHERE id = $1`, [followupId]);
    expect(followup?.lead_id).toBe(a!.id);

    const b = await queryOne<Record<string, any>>(`SELECT * FROM leads WHERE conversation_id = $1`, [chatB.id]);
    expect(b).not.toBeNull();
    expect(new Date(b!.closed_at).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(b!.lost_reason).toBe('price');
    expect(b!.stage_id).toBe(stageIds['Lost']);

    expect(await queryOne(`SELECT 1 FROM leads WHERE conversation_id = $1`, [chatC.id])).toBeNull();
  });

  test('running the migration again changes nothing', async () => {
    const before = await leadsOf();
    await runMigration();
    expect(await leadsOf()).toBe(before);
    expect(before).toBe(2);
  });

  test('two open chats on one phone leave one open lead, the most recently active', async () => {
    const older = await seedChat(businessId);
    const phone = older.phone;
    // Same number, second chat row (a different WhatsApp session key).
    const twin = { id: randomUUID() };
    await query(
      `INSERT INTO whatsapp_conversations (id, business_id, from_number, to_number, conversation_id, last_message_at)
       VALUES ($1, $2, $3, '919999900000', $4, NOW())`,
      [twin.id, businessId, phone, `${phone}@s.whatsapp.net`],
    );
    await query(`UPDATE whatsapp_conversations SET last_message_at = NOW() - interval '2 days', stage_id = $2 WHERE id = $1`, [
      older.id,
      stageIds['New'],
    ]);
    await query(`UPDATE whatsapp_conversations SET last_message_at = NOW(), stage_id = $2 WHERE id = $1`, [twin.id, stageIds['New']]);

    await runMigration();

    const open = await queryRows<{ conversation_id: string }>(
      `SELECT conversation_id FROM leads WHERE business_id = $1 AND contact_phone = $2 AND closed_at IS NULL`,
      [businessId, phone],
    );
    expect(open.map((r) => r.conversation_id)).toEqual([twin.id]);
    // The closed duplicate leaves the board (no open column holds a closed lead) but stays in history.
    const closed = await queryOne<{ stage_id: string | null }>(
      `SELECT stage_id FROM leads WHERE conversation_id = $1 AND closed_at IS NOT NULL`,
      [older.id],
    );
    expect(closed).not.toBeNull();
    expect(closed!.stage_id).toBeNull();
  });

  test('last activity counts a staff stage move as well as the last message', async () => {
    const chat = await seedChat(businessId);
    await query(
      `UPDATE whatsapp_conversations
          SET stage_id = $2, last_message_at = NOW() - interval '40 days', stage_changed_at = NOW() - interval '5 days'
        WHERE id = $1`,
      [chat.id, stageIds['Interested']],
    );
    // Neither set: falls back to the chat's updated_at (inserted directly, since an UPDATE resets it).
    const quiet = { id: randomUUID() };
    const quietPhone = `9188${String(Date.now()).slice(-8)}`;
    await query(
      `INSERT INTO whatsapp_conversations (id, business_id, from_number, to_number, conversation_id, stage_id, last_message_at, updated_at)
       VALUES ($1, $2, $3, '919999900000', $4, $5, NULL, NOW() - interval '12 days')`,
      [quiet.id, businessId, quietPhone, `${quietPhone}@s.whatsapp.net`, stageIds['Interested']],
    );

    await runMigration();

    const ageDays = async (conversationId: string) =>
      Number(
        (await queryOne<{ days: string }>(
          `SELECT EXTRACT(EPOCH FROM (NOW() - last_activity_at)) / 86400 AS days FROM leads WHERE conversation_id = $1`,
          [conversationId],
        ))!.days,
      );
    expect(await ageDays(chat.id)).toBeCloseTo(5, 1);
    expect(await ageDays(quiet.id)).toBeCloseTo(12, 1);
  });

  test('backfill normalises phones like normalizeLeadPhone, skips non-phones and shortens long names', async () => {
    const formats: Array<[string, string]> = [
      ['09876543210', '919876543210'],
      ['+91 98765 43211', '919876543211'],
      ['00919876543212', '919876543212'],
      ['9876543213', '919876543213'],
    ];
    const longName = 'N'.repeat(200);
    const seeded: Array<{ id: string; key: string }> = [];
    for (const [raw, key] of formats) {
      const chat = await seedChat(businessId, { phone: raw, name: raw === '09876543210' ? longName : undefined });
      seeded.push({ id: chat.id, key });
    }
    const tooLong = await seedChat(businessId, { phone: '1234567890123456' });
    for (const id of [...seeded.map((s) => s.id), tooLong.id]) {
      await query(`UPDATE whatsapp_conversations SET stage_id = $2 WHERE id = $1`, [id, stageIds['New']]);
    }

    await runMigration();

    for (const { id, key } of seeded) {
      const lead = await queryOne<{ contact_phone: string }>(`SELECT contact_phone FROM leads WHERE conversation_id = $1`, [id]);
      expect(lead?.contact_phone).toBe(key);
    }
    const named = await queryOne<{ contact_name: string }>(`SELECT contact_name FROM leads WHERE conversation_id = $1`, [seeded[0].id]);
    expect(named?.contact_name).toBe(longName.slice(0, 120));
    expect(await queryOne(`SELECT 1 FROM leads WHERE conversation_id = $1`, [tooLong.id])).toBeNull();

    const before = await leadsOf();
    await runMigration();
    expect(await leadsOf()).toBe(before);
  });

  test('one open lead per phone', async () => {
    const insert = (closed: string) =>
      query(`INSERT INTO leads (business_id, contact_phone, closed_at) VALUES ($1, $2, ${closed})`, [businessId, chatA.phone]);

    await expect(insert('NULL')).rejects.toMatchObject({ code: '23505' });
    await expect(insert('NOW()')).resolves.toBeDefined();
  });

  test('a follow-up or event needs a chat or a lead', async () => {
    await expect(
      query(`INSERT INTO whatsapp_followups (business_id, assigned_to, due_at) VALUES ($1, $2, NOW())`, [businessId, agentId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      query(`INSERT INTO whatsapp_automation_events (business_id, event_type) VALUES ($1, 'stage_changed')`, [businessId]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
