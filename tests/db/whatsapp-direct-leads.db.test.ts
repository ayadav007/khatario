/**
 * Direct leads and lead summaries (migration 446): a new number's first message puts the chat on the
 * pipeline, known numbers stay off it, and the lead summary is rewritten once the chat goes quiet
 * with bot and staff replies named in the transcript.
 * Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/whatsapp-direct-leads.db.test.ts --runInBand
 * Migrations 418, 419 and 446 must be applied to kh_phase2_test.
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

const mockAnalyze = jest.fn();
jest.mock('@/lib/services/lead-analyzer', () => ({
  LeadAnalyzer: jest.fn().mockImplementation(() => ({ analyzeLead: (...args: unknown[]) => mockAnalyze(...args) })),
}));
jest.mock('@/lib/whatsapp-websocket', () => ({
  emitConversationUpdate: jest.fn(),
  emitNewMessage: jest.fn(),
  emitSummaryUpdate: jest.fn(),
}));
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { query, queryOne, closePool } from '@/lib/db';
import { ensureStages } from '@/lib/whatsapp/pipeline';
import { addNewChatToPipeline, attributeNewChat, createEntryLink, getDirectChatSetting, isKnownNumber, setDirectChatSetting } from '@/lib/whatsapp/lead-sources';
import { refreshLeadProfile, runDueLeadSummaries, scheduleLeadSummary, speakerFor } from '@/lib/whatsapp/lead-summary';

describe('lead summary speakers', () => {
  test('names who wrote each message', () => {
    expect(speakerFor({ direction: 'incoming', sent_by: null, staff_name: null })).toBe('Customer');
    expect(speakerFor({ direction: 'outgoing', sent_by: 'bot', staff_name: null })).toBe('Bot');
    expect(speakerFor({ direction: 'outgoing', sent_by: 'staff', staff_name: 'Ravi' })).toBe('Ravi (staff)');
    expect(speakerFor({ direction: 'outgoing', sent_by: 'staff', staff_name: null })).toBe('Staff');
    expect(speakerFor({ direction: 'outgoing', sent_by: null, staff_name: null })).toBe('Business');
  });
});

const run = enabled ? describe : describe.skip;

run('direct leads and lead summaries (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const B = randomUUID();
  const OFF = randomUUID();
  const RAVI = randomUUID();
  const tag = B.slice(0, 6);
  let seq = 0;

  const phone = () => `91${String(Date.now()).slice(-5)}${String(++seq).padStart(5, '0')}`;

  async function newChat(business = B, from = phone()): Promise<string> {
    const id = randomUUID();
    await query(
      `INSERT INTO whatsapp_conversations (id, business_id, from_number, to_number, conversation_id, last_message_at, last_message_direction)
       VALUES ($1, $2, $3, '919999900000', $3, NOW(), 'incoming')`,
      [id, business, from],
    );
    return id;
  }

  /** Stage of the chat's open lead (migration 447 moved the pipeline onto leads). */
  async function stageOf(id: string): Promise<string | null> {
    const row = await queryOne<{ name: string | null }>(
      `SELECT s.name FROM leads l LEFT JOIN whatsapp_pipeline_stages s ON s.id = l.stage_id
        WHERE l.conversation_id = $1 AND l.closed_at IS NULL`,
      [id],
    );
    return row?.name ?? null;
  }

  async function addMessage(conv: string, direction: 'incoming' | 'outgoing', text: string, sentBy?: string, userId?: string) {
    await query(
      `INSERT INTO whatsapp_conversation_messages
         (business_id, conversation_id, message_id, from_number, to_number, message_text, message_type, direction, status, sent_by, sent_by_user_id, created_at)
       VALUES ($1, $2, $3, 'x', 'y', $4, 'text', $5, 'sent', $6, $7, NOW() + make_interval(secs => $8))`,
      [B, conv, `m-${randomUUID()}`, text, direction, sentBy ?? null, userId ?? null, ++seq],
    );
  }

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const col = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'whatsapp_conversations' AND column_name = 'summary_due_at'`,
    );
    if (!col?.n) throw new Error('Apply migration 446 to kh_phase2_test first');
    for (const [id, name] of [[B, `Direct ${tag}`], [OFF, `Off ${tag}`]]) {
      await query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [id, name],
      );
    }
    await query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin, is_active) VALUES ($1, $2, 'Ravi', $3, false, true)`, [
      RAVI,
      B,
      `7${String(Date.now()).slice(-9)}`,
    ]);
    await query(`INSERT INTO ai_provider_config (business_id, lead_analyzer_enabled) VALUES ($1, true)`, [B]);
  });

  afterAll(async () => {
    try {
      await query(`DELETE FROM whatsapp_lead_profiles WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
      await query(`DELETE FROM whatsapp_conversation_messages WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
      await query(`DELETE FROM whatsapp_entry_links WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
      await query(`DELETE FROM leads WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
      await query(`DELETE FROM whatsapp_conversations WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
      await query(`DELETE FROM whatsapp_pipeline_stages WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
      await query(`DELETE FROM ai_provider_config WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
      await query(`DELETE FROM customers WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
      await query(`DELETE FROM suppliers WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
      await query(`DELETE FROM business_settings WHERE business_id = ANY($1::uuid[])`, [[B, OFF]]);
      await query(`DELETE FROM users WHERE business_id = $1`, [B]);
      await query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OFF]]);
    } finally {
      await closePool();
    }
  });

  test('a new number goes on the first open stage as a direct lead', async () => {
    const c = await newChat();
    expect(await addNewChatToPipeline(B, c, (await queryOne<{ p: string }>(`SELECT from_number AS p FROM whatsapp_conversations WHERE id = $1`, [c]))!.p)).toBe(true);
    expect(await stageOf(c)).toBe('New');
    const row = await queryOne<{ source: string | null }>(`SELECT source FROM whatsapp_conversations WHERE id = $1`, [c]);
    expect(row?.source).toBeNull();
  });

  test('customers, suppliers and staff stay off the board, whatever format their phone is stored in', async () => {
    const custPhone = phone();
    const supPhone = phone();
    await query(`INSERT INTO customers (business_id, name, phone) VALUES ($1, 'Asha', $2)`, [B, `+91 ${custPhone.slice(2, 7)} ${custPhone.slice(7)}`]);
    await query(`INSERT INTO suppliers (business_id, name, phone) VALUES ($1, 'Box Co', $2)`, [B, `0${supPhone.slice(2)}`]);
    const ravi = await queryOne<{ phone: string }>(`SELECT phone FROM users WHERE id = $1`, [RAVI]);

    expect(await isKnownNumber(B, custPhone)).toBe(true);
    expect(await isKnownNumber(B, supPhone)).toBe(true);
    expect(await isKnownNumber(B, `91${ravi!.phone}`)).toBe(true);
    expect(await isKnownNumber(OFF, custPhone)).toBe(false);

    for (const p of [custPhone, supPhone, `91${ravi!.phone}`]) {
      const c = await newChat(B, p);
      expect(await addNewChatToPipeline(B, c, p)).toBe(false);
      expect(await stageOf(c)).toBeNull();
    }
  });

  test('a tracked link keeps its own stage', async () => {
    const stages = await ensureStages(B);
    const followUp = stages.find((s) => s.name === 'Follow up')!;
    const link = await createEntryLink(B, RAVI, { name: 'Flyer', phone: '9999900000', stageId: followUp.id });
    const p = phone();
    const c = await newChat(B, p);
    await attributeNewChat(B, c, `hello (ref ${link.code})`);
    expect(await addNewChatToPipeline(B, c, p)).toBe(false);
    expect(await stageOf(c)).toBe('Follow up');
  });

  test('the setting turns it off; no settings row counts as on', async () => {
    expect(await getDirectChatSetting(OFF)).toEqual({ enabled: true });
    await setDirectChatSetting(OFF, false);
    expect(await getDirectChatSetting(OFF)).toEqual({ enabled: false });
    const p = phone();
    const c = await newChat(OFF, p);
    expect(await addNewChatToPipeline(OFF, c, p)).toBe(false);
    expect(await stageOf(c)).toBeNull();
    await expect(setDirectChatSetting(OFF, 'yes')).rejects.toThrow('enabled must be true or false');
  });

  test('a quiet chat gets one summary naming the bot and staff; groups are never scheduled', async () => {
    const c = await newChat();
    await addMessage(c, 'incoming', 'Need 50 cartons by Friday, what is the rate?');
    await addMessage(c, 'outgoing', 'Rs 22 each for 50.', 'bot');
    await addMessage(c, 'outgoing', 'I can do Rs 20 if you confirm today.', 'staff', RAVI);

    await scheduleLeadSummary(B, c);
    const due = await queryOne<{ mins: number }>(
      `SELECT EXTRACT(EPOCH FROM summary_due_at - NOW()) / 60 AS mins FROM whatsapp_conversations WHERE id = $1`,
      [c],
    );
    expect(Number(due?.mins)).toBeGreaterThan(9);

    // Not due yet: nothing happens.
    mockAnalyze.mockReset();
    await runDueLeadSummaries(500);
    expect(mockAnalyze).not.toHaveBeenCalledWith(B, expect.anything());

    await query(`UPDATE whatsapp_conversations SET summary_due_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [c]);
    mockAnalyze.mockResolvedValue({
      leadScore: 72,
      leadStatus: 'hot',
      interestLevel: 'high',
      behaviorTags: ['price_sensitive'],
      sentiment: 'positive',
      keyTopics: ['pricing'],
      purchaseIntent: 80,
      urgencyLevel: 'high',
      aiSummary: 'Wants 50 cartons by Friday. Bot quoted Rs 22; Ravi offered Rs 20 if confirmed today.',
      insights: {},
    });
    const report = await runDueLeadSummaries(500);
    expect(report.written).toBeGreaterThanOrEqual(1);

    const call = mockAnalyze.mock.calls.find(([biz]) => biz === B);
    expect(call![1].messages.map((m: { speaker: string }) => m.speaker)).toEqual(['Customer', 'Bot', 'Ravi (staff)']);

    const profile = await queryOne<{ ai_summary: string; lead_score: number; total_messages: number }>(
      `SELECT ai_summary, lead_score, total_messages FROM whatsapp_lead_profiles WHERE conversation_id = $1`,
      [c],
    );
    expect(profile).toMatchObject({ lead_score: 72, total_messages: 3 });
    expect(profile?.ai_summary).toContain('Ravi offered Rs 20');
    const after = await queryOne<{ due: string | null }>(`SELECT summary_due_at AS due FROM whatsapp_conversations WHERE id = $1`, [c]);
    expect(after?.due).toBeNull();

    // A second pass updates the same profile row.
    mockAnalyze.mockResolvedValue({ ...(await mockAnalyze.mock.results[0].value), leadScore: 40, aiSummary: 'Went quiet.' });
    expect(await refreshLeadProfile(B, c)).toBe('written');
    const rows = await queryOne<{ n: number; s: string }>(
      `SELECT COUNT(*)::int AS n, MAX(ai_summary) AS s FROM whatsapp_lead_profiles WHERE conversation_id = $1`,
      [c],
    );
    expect(rows).toEqual({ n: 1, s: 'Went quiet.' });

    const g = await newChat();
    await query(`UPDATE whatsapp_conversations SET is_group = true WHERE id = $1`, [g]);
    await scheduleLeadSummary(B, g);
    expect((await queryOne<{ due: string | null }>(`SELECT summary_due_at AS due FROM whatsapp_conversations WHERE id = $1`, [g]))?.due).toBeNull();
  });

  test('storing a first message from a new number creates the lead and schedules its summary', async () => {
    const { storeIncomingMessage, storeOutgoingMessage } = await import('@/lib/whatsapp-crm');
    const p = phone();
    const { conversationId } = await storeIncomingMessage(B, `${p}@s.whatsapp.net`, '919999900000', 'Do you deliver to Pune?', `in-${randomUUID()}`);
    expect(await stageOf(conversationId)).toBe('New');
    const first = await queryOne<{ due: Date | null }>(`SELECT summary_due_at AS due FROM whatsapp_conversations WHERE id = $1`, [conversationId]);
    expect(first?.due).not.toBeNull();

    // A staff reply pushes the summary further out.
    await query(`UPDATE whatsapp_conversations SET summary_due_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [conversationId]);
    await storeOutgoingMessage(B, conversationId, `${p}@s.whatsapp.net`, 'Yes, next day.', `out-${randomUUID()}`, 'text', undefined, undefined, null, null, {
      sentBy: 'staff',
      sentByUserId: RAVI,
    });
    const later = await queryOne<{ ahead: boolean }>(`SELECT summary_due_at > NOW() AS ahead FROM whatsapp_conversations WHERE id = $1`, [conversationId]);
    expect(later?.ahead).toBe(true);

    // An existing customer's first message does not go on the board.
    const custPhone = phone();
    await query(`INSERT INTO customers (business_id, name, phone) VALUES ($1, 'Meena', $2)`, [B, custPhone]);
    const known = await storeIncomingMessage(B, `${custPhone}@s.whatsapp.net`, '919999900000', 'Send my bill', `in-${randomUUID()}`);
    expect(await stageOf(known.conversationId)).toBeNull();
  });

  test('no summary without a customer message, or with the analyzer off', async () => {
    const c = await newChat();
    await addMessage(c, 'outgoing', 'Hello from us', 'staff', RAVI);
    expect(await refreshLeadProfile(B, c)).toBe('no_customer_message');

    const off = await newChat(OFF);
    expect(await refreshLeadProfile(OFF, off)).toBe('disabled');
  });
});
