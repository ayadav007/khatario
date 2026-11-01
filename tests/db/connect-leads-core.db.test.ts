/**
 * Connect leads core (lib/leads/core.ts, lib/leads/chat-deal.ts): one open lead per phone, stage moves
 * that close and reopen leads, timeline events with or without a chat, and the chat deal panel.
 * Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/connect-leads-core.db.test.ts --runInBand
 * Migrations 418, 419, 446 and 447 must be applied to kh_phase2_test.
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

jest.mock('@/lib/whatsapp-websocket', () => ({ emitConversationUpdate: jest.fn() }));
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { query, queryOne, queryRows, closePool } from '@/lib/db';
import { ensureStages, PipelineError, type DealActor, type PipelineStage } from '@/lib/whatsapp/pipeline';
import { closeLeadAsWentQuiet, LeadError, loadLead, openLead, setLeadStage } from '@/lib/leads/core';
import { loadChatDeal, openLeadForChat, setChatDeal, setChatStageByLegacyKey } from '@/lib/leads/chat-deal';
import { cleanupBusinesses, seedBusiness, seedChat } from './fixtures/connect-leads';

const run = enabled ? describe : describe.skip;

run('connect leads core (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const auto: DealActor = { source: 'auto' };
  let B: string;
  let OTHER: string;
  let otherAgent: string;
  let AGENT: string;
  let stages: PipelineStage[];
  const stage = (name: string) => stages.find((s) => s.name === name)!;

  async function code(p: Promise<unknown>): Promise<string> {
    try {
      await p;
      return 'ok';
    } catch (e) {
      if (e instanceof LeadError || e instanceof PipelineError) return e.code;
      throw e;
    }
  }

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const t = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'leads'`);
    if (!t?.n) throw new Error('Apply migration 447 to kh_phase2_test first');
    const seeded = await seedBusiness('core');
    B = seeded.businessId;
    AGENT = seeded.agentId;
    const other = await seedBusiness('core-other');
    OTHER = other.businessId;
    otherAgent = other.agentId;
    stages = await ensureStages(B);
  });

  afterAll(async () => {
    try {
      await cleanupBusinesses([B, OTHER].filter(Boolean));
    } finally {
      await closePool();
    }
  });

  test('openLead creates once per phone', async () => {
    const first = await openLead(B, { phone: '+91 98765 00001', actor: auto });
    const second = await openLead(B, { phone: '919876500001', actor: auto });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.lead.id).toBe(first.lead.id);
    expect(first.lead.contact_phone).toBe('919876500001');
    expect(first.lead.stage_id).toBe(stage('New').id);
  });

  test('concurrent openLead makes one lead', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => openLead(B, { phone: '98765 00003', actor: auto })));
    expect(new Set(results.map((r) => r.lead.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  test('lead_type existing when the phone is a customer', async () => {
    const customerId = randomUUID();
    await query(`INSERT INTO customers (id, business_id, name, phone) VALUES ($1, $2, 'Meena', '98765 00002')`, [customerId, B]);
    const { lead } = await openLead(B, { phone: '919876500002', actor: auto });
    expect(lead.lead_type).toBe('existing');
    expect(lead.customer_id).toBe(customerId);
  });

  test('won closes, reopening with another open lead is refused', async () => {
    const chat = await seedChat(B, { phone: '919876500004' });
    const { lead: l1 } = await openLead(B, { phone: chat.phone, conversationId: chat.id, actor: auto });
    const won = await setLeadStage(B, l1.id, stage('Won').id, auto);
    expect(won.closed_at).not.toBeNull();
    const row = await queryOne<{ lead_status: string }>(`SELECT lead_status FROM whatsapp_conversations WHERE id = $1`, [chat.id]);
    expect(row?.lead_status).toBe('converted');

    const l2 = await openLead(B, { phone: chat.phone, actor: auto });
    expect(l2.created).toBe(true);
    expect(l2.lead.id).not.toBe(l1.id);

    // Refused before the update, so the unique index is never hit (lib/db logs every DB error).
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const err = await setLeadStage(B, l1.id, stage('Interested').id, auto).catch((e) => e);
      expect(err).toBeInstanceOf(LeadError);
      expect(err).toMatchObject({ status: 409, code: 'LEAD_ALREADY_OPEN' });
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  test('won -> lost keeps when the lead first closed', async () => {
    const { lead } = await openLead(B, { phone: '919876500010', actor: auto });
    await setLeadStage(B, lead.id, stage('Won').id, auto);
    await query(`UPDATE leads SET closed_at = NOW() - INTERVAL '3 days' WHERE id = $1`, [lead.id]);
    const before = (await loadLead(B, lead.id))!.closed_at;
    const lost = await setLeadStage(B, lead.id, stage('Lost').id, auto);
    expect(lost.stage_id).toBe(stage('Lost').id);
    expect(new Date(lost.closed_at!).getTime()).toBe(new Date(before!).getTime());
  });

  test('openLead with a won stage joins an open lead, else creates one closed', async () => {
    const open = await openLead(B, { phone: '919876500011', actor: auto });
    const joined = await openLead(B, { phone: '919876500011', stageId: stage('Won').id, actor: auto });
    expect(joined.created).toBe(false);
    expect(joined.lead.id).toBe(open.lead.id);
    expect(joined.lead.closed_at).toBeNull();

    const fresh = await openLead(B, { phone: '919876500012', stageId: stage('Won').id, actor: auto });
    expect(fresh.created).toBe(true);
    expect(fresh.lead.stage_id).toBe(stage('Won').id);
    expect(fresh.lead.closed_at).not.toBeNull();
  });

  test('stage event carries lead_id and works with no chat', async () => {
    const { lead } = await openLead(B, { phone: '919876500005', actor: auto });
    await setLeadStage(B, lead.id, stage('Interested').id, auto);
    const rows = await queryRows<{ conversation_id: string | null; event_data: any }>(
      `SELECT conversation_id::text AS conversation_id, event_data FROM whatsapp_automation_events
        WHERE lead_id = $1 AND event_type = 'stage_changed' AND event_data->>'to_stage' = 'Interested'`,
      [lead.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].conversation_id).toBeNull();
    expect(rows[0].event_data).toMatchObject({ to_stage: 'Interested', from_stage: 'New', source: 'auto' });
  });

  test('setChatDeal opens a lead for a chat with none, refuses value-only', async () => {
    const chat = await seedChat(B, { phone: '919876500006' });
    expect(await code(setChatDeal(B, chat.id, { dealValue: 10 }, auto))).toBe('NO_LEAD');
    const deal = await setChatDeal(B, chat.id, { stageId: stage('Interested').id }, auto);
    expect(deal.lead_id).toBeTruthy();
    const loaded = await loadChatDeal(B, chat.id);
    expect(loaded).toMatchObject({ lead_id: deal.lead_id, stage_id: stage('Interested').id });
  });

  test('the deal panel keeps working on a chat whose lead closed', async () => {
    const agent: DealActor = { source: 'agent', userId: AGENT };
    // Pick Lost first, then the reason is saved on its own (as DealSection does on blur).
    const lostChat = await seedChat(B, { phone: '919876500013' });
    const lost = await setChatDeal(B, lostChat.id, { stageId: stage('Lost').id }, agent);
    const reason = await setChatDeal(B, lostChat.id, { lostReason: 'Price' }, agent);
    expect(reason).toMatchObject({ lead_id: lost.lead_id, lost_reason: 'Price' });
    expect(await loadChatDeal(B, lostChat.id)).toMatchObject({ lead_id: lost.lead_id, stage_id: stage('Lost').id, lost_reason: 'Price' });

    // After Won, the value can still be edited.
    const wonChat = await seedChat(B, { phone: '919876500014' });
    const won = await setChatDeal(B, wonChat.id, { stageId: stage('Won').id }, agent);
    const valued = await setChatDeal(B, wonChat.id, { dealValue: 900, expectedCloseOn: '2026-11-30' }, agent);
    expect(valued).toMatchObject({ lead_id: won.lead_id, deal_value: 900, expected_close_on: '2026-11-30' });

    // Moving the lost lead back to an open stage reopens it.
    const back = await setChatDeal(B, lostChat.id, { stageId: stage('Interested').id }, agent);
    expect(back).toMatchObject({ lead_id: lost.lead_id, stage_id: stage('Interested').id, lost_reason: null });
    expect((await loadLead(B, lost.lead_id!))?.closed_at).toBeNull();
  });

  test("the deal panel on a second chat for a number does not read or edit the first chat's lead", async () => {
    const agent: DealActor = { source: 'agent', userId: AGENT };
    const chatA = await seedChat(B, { phone: '919876500090' });
    const onA = await setChatDeal(B, chatA.id, { stageId: stage('Interested').id }, agent);
    // Same number, another chat row (stored in another format).
    const chatB = await seedChat(B, { phone: '+91 98765 00090' });

    expect(await loadChatDeal(B, chatB.id)).toMatchObject({ lead_id: null, stage_id: null });
    expect(await code(setChatDeal(B, chatB.id, { dealValue: 5 }, agent))).toBe('NO_LEAD');
    expect(await code(setChatDeal(B, chatB.id, { stageId: stage('Follow up').id }, agent))).toBe('LEAD_ALREADY_OPEN');
    const a = (await loadLead(B, onA.lead_id!))!;
    expect(a).toMatchObject({ conversation_id: chatA.id, stage_id: stage('Interested').id, deal_value: null });

    // Messages, touches and reminders still find the number's open lead from either chat.
    expect((await openLeadForChat(B, chatB.id, 'any_chat'))?.id).toBe(onA.lead_id);
    expect(await openLeadForChat(B, chatB.id, 'this_chat')).toBeNull();

    // A lead with no chat yet is still the second chat's deal.
    const loose = await openLead(B, { phone: '919876500091', actor: auto });
    const chatC = await seedChat(B, { phone: '919876500091' });
    expect((await loadChatDeal(B, chatC.id))?.lead_id).toBe(loose.lead.id);
  });

  test('automated moves open a new lead instead of rewriting a won one', async () => {
    const chat = await seedChat(B, { phone: '919876500015' });
    const won = await setChatDeal(B, chat.id, { stageId: stage('Won').id, dealValue: 500 }, { source: 'agent', userId: AGENT });

    // A value alone from a flow does not touch the won lead.
    expect(await code(setChatDeal(B, chat.id, { dealValue: 1 }, { source: 'flow' }))).toBe('NO_LEAD');

    await setChatStageByLegacyKey(B, chat.id, 'interested', { source: 'ai' });
    const fresh = await loadChatDeal(B, chat.id);
    expect(fresh?.lead_id).not.toBe(won.lead_id);
    expect(fresh?.stage_id).toBe(stage('Interested').id);
    const freshLead = await loadLead(B, fresh!.lead_id!);
    expect(freshLead).toMatchObject({ conversation_id: chat.id, closed_at: null });

    const old = await loadLead(B, won.lead_id!);
    expect(old).toMatchObject({ stage_id: stage('Won').id, deal_value: 500 });
    expect(old?.closed_at).not.toBeNull();
  });

  test('closeLeadAsWentQuiet', async () => {
    const { lead } = await openLead(B, { phone: '919876500007', actor: auto });
    await closeLeadAsWentQuiet(B, lead.id);
    const after = await loadLead(B, lead.id);
    expect(after?.stage_id).toBe(stage('Lost').id);
    expect(after?.lost_reason).toBe('Went quiet');
    expect(after?.closed_at).not.toBeNull();
  });

  test("rejects another business's stage and a non-agent owner", async () => {
    const otherStages = await ensureStages(OTHER);
    expect(await code(openLead(B, { phone: '919876500008', stageId: otherStages[0].id, actor: auto }))).toBe('STAGE_NOT_FOUND');
    expect(await code(openLead(B, { phone: '919876500008', ownerId: otherAgent, actor: auto }))).toBe('BAD_OWNER');
  });
});
