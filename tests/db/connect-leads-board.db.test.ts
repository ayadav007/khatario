/**
 * Connect leads on the board, dashboard, stage delete and follow-ups (lib/leads/visibility.ts,
 * lib/whatsapp/pipeline.ts, lib/whatsapp/followups.ts). Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/connect-leads-board.db.test.ts --runInBand
 * Migrations 418, 419, 446 and 447 must be applied to kh_phase2_test.
 */
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
import type { InboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { deleteStage, ensureStages, loadBoard, loadPipelineSummary, type PipelineStage } from '@/lib/whatsapp/pipeline';
import { openLead, patchLead } from '@/lib/leads/core';
import { setChatDeal } from '@/lib/leads/chat-deal';
import { createFollowup, listFollowups, runDueFollowupReminders } from '@/lib/whatsapp/followups';
import { notificationHref } from '@/lib/notifications/notification-href';
import { cleanupBusinesses, seedBusiness, seedChat } from './fixtures/connect-leads';

const run = enabled ? describe : describe.skip;

run('connect leads on the board, dashboard and follow-ups (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const auto = { source: 'auto' } as const;
  let B: string;
  let AGENT: string;
  let SUP: string;
  let stages: PipelineStage[];
  const stage = (name: string) => stages.find((s) => s.name === name)!;
  const agentView = (): InboxViewer => ({ businessId: B, userId: AGENT, isSupervisor: false });
  const supView = (): InboxViewer => ({ businessId: B, userId: SUP, isSupervisor: true });
  let seq = 0;
  const phone = () => `9187${String(Date.now()).slice(-6)}${String(++seq).padStart(2, '0')}`;

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const t = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'leads'`);
    if (!t?.n) throw new Error('Apply migration 447 to kh_phase2_test first');
    const seeded = await seedBusiness('board');
    B = seeded.businessId;
    AGENT = seeded.agentId;
    SUP = seeded.supervisorId;
    stages = await ensureStages(B);
  });

  afterAll(async () => {
    try {
      await query(`DELETE FROM notifications WHERE business_id = $1`, [B]).catch(() => undefined);
      await cleanupBusinesses([B].filter(Boolean));
    } finally {
      await closePool();
    }
  });

  const cardsIn = async (viewer: InboxViewer, stageName: string, filters = {}) =>
    (await loadBoard(viewer, filters)).find((c) => c.id === stage(stageName).id)!.cards;

  test('board shows leads, including one with no chat', async () => {
    const chat = await seedChat(B, { name: 'Chat Buyer' });
    const chatDeal = await setChatDeal(B, chat.id, { stageId: stage('New').id }, auto);
    const manual = await openLead(B, { phone: phone(), name: 'Walk In Wendy', actor: auto });

    const cards = await cardsIn(supView(), 'New');
    const onChat = cards.find((c) => c.id === chatDeal.lead_id)!;
    const noChat = cards.find((c) => c.id === manual.lead.id)!;
    expect(cards).toHaveLength(2);
    expect(onChat).toMatchObject({ conversation_id: chat.id, name: 'Chat Buyer', lead_type: 'new', phone: chat.phone });
    expect(noChat).toMatchObject({ conversation_id: null, name: 'Walk In Wendy', last_message_text: null, temperature: null, is_customer: false });
  });

  test('an agent sees chat leads they could open and unowned or own no-chat leads', async () => {
    // Clean slate: the board is checked by exact card list.
    await query(`DELETE FROM leads WHERE business_id = $1`, [B]);
    const mine = await seedChat(B);
    await query(`UPDATE whatsapp_conversations SET inbox_state = 'intervened', assigned_to = $2 WHERE id = $1`, [mine.id, AGENT]);
    const theirs = await seedChat(B);
    await query(`UPDATE whatsapp_conversations SET inbox_state = 'intervened', assigned_to = $2 WHERE id = $1`, [theirs.id, SUP]);
    const open = await seedChat(B);
    const myLead = (await setChatDeal(B, mine.id, { stageId: stage('New').id }, auto)).lead_id!;
    const theirLead = (await setChatDeal(B, theirs.id, { stageId: stage('New').id }, auto)).lead_id!;
    const openLeadId = (await setChatDeal(B, open.id, { stageId: stage('New').id }, auto)).lead_id!;
    const supOwned = await openLead(B, { phone: phone(), name: 'Sup owned', ownerId: SUP, actor: auto });
    const unowned = await openLead(B, { phone: phone(), name: 'Unowned', actor: auto });
    const ownOne = await openLead(B, { phone: phone(), name: 'Own', ownerId: AGENT, actor: auto });

    const ids = (await cardsIn(agentView(), 'New')).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([myLead, openLeadId, unowned.lead.id, ownOne.lead.id]));
    expect(ids).not.toContain(theirLead);
    expect(ids).not.toContain(supOwned.lead.id);
    const supIds = (await cardsIn(supView(), 'New')).map((c) => c.id);
    expect(supIds).toEqual(expect.arrayContaining([theirLead, supOwned.lead.id]));
  });

  test('owner filter uses the lead owner', async () => {
    await query(`DELETE FROM leads WHERE business_id = $1`, [B]);
    const chat = await seedChat(B);
    // The chat is held by the supervisor in the inbox, but the salesperson is the agent.
    await query(`UPDATE whatsapp_conversations SET inbox_state = 'intervened', assigned_to = $2 WHERE id = $1`, [chat.id, SUP]);
    const leadId = (await setChatDeal(B, chat.id, { stageId: stage('Interested').id }, auto)).lead_id!;
    await patchLead(B, leadId, { ownerId: AGENT }, auto);
    const other = await openLead(B, { phone: phone(), ownerId: SUP, stageId: stage('Interested').id, actor: auto });

    const byAgent = await cardsIn(supView(), 'Interested', { ownerId: AGENT });
    expect(byAgent.map((c) => c.id)).toEqual([leadId]);
    expect(byAgent[0]).toMatchObject({ owner_id: AGENT, owner_name: 'Agent' });
    const bySup = await cardsIn(supView(), 'Interested', { ownerId: SUP });
    expect(bySup.map((c) => c.id)).toEqual([other.lead.id]);
  });

  test('deleting a stage moves its leads', async () => {
    await query(`DELETE FROM leads WHERE business_id = $1`, [B]);
    const followUp = stage('Follow up');
    const interested = stage('Interested');
    const a = await openLead(B, { phone: phone(), stageId: followUp.id, actor: auto });
    const b = await openLead(B, { phone: phone(), stageId: followUp.id, actor: auto });
    await deleteStage(B, followUp.id, interested.id);
    const rows = await queryRows<{ id: string; stage_id: string }>(
      `SELECT id::text AS id, stage_id::text AS stage_id FROM leads WHERE id = ANY($1::uuid[])`,
      [[a.lead.id, b.lead.id]],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.stage_id === interested.id)).toBe(true);
    stages = await ensureStages(B);
  });

  test('dashboard counts leads by source and owner', async () => {
    await query(`DELETE FROM leads WHERE business_id = $1`, [B]);
    const won = stages.find((s) => s.kind === 'won')!;
    await openLead(B, { phone: phone(), source: 'indiamart', ownerId: AGENT, actor: auto });
    const wonLead = await openLead(B, { phone: phone(), source: 'indiamart', ownerId: AGENT, actor: auto });
    await patchLead(B, wonLead.lead.id, { stageId: won.id, dealValue: 4000 }, auto);
    await openLead(B, { phone: phone(), source: 'walk_in', actor: auto });
    await openLead(B, { phone: phone(), actor: auto });
    // Opened outside the window: not counted.
    const old = await openLead(B, { phone: phone(), source: 'call', actor: auto });
    await query(`UPDATE leads SET opened_at = NOW() - INTERVAL '90 days' WHERE id = $1`, [old.lead.id]);

    const sum = await loadPipelineSummary(B, 30);
    const bySource = Object.fromEntries(sum.by_source.map((r) => [r.source, r]));
    expect(bySource.indiamart).toMatchObject({ leads: 2, on_board: 2, won: 1, won_value: 4000 });
    expect(bySource.walk_in).toMatchObject({ leads: 1, on_board: 1, won: 0 });
    expect(bySource.direct?.leads).toBe(1);
    expect(bySource.call).toBeUndefined();
    expect(sum.by_agent.find((a) => a.agent_id === AGENT)).toMatchObject({ agent_name: 'Agent', open: 1, won: 1, won_value: 4000 });
  });

  test('a follow-up on a no-chat lead notifies with a lead link', async () => {
    const lead = await openLead(B, { phone: phone(), name: 'Callback Carl', actor: auto });
    const fu = await createFollowup(supView(), { leadId: lead.lead.id, dueAt: new Date(Date.now() + 3600_000).toISOString(), note: 'ring him', cancelOnReply: true });
    expect(fu).toMatchObject({ lead_id: lead.lead.id, conversation_id: null, cancel_on_reply: false, contact_name: 'Callback Carl', contact_phone: lead.lead.contact_phone });
    expect((await listFollowups(supView(), { leadId: lead.lead.id })).followups.map((f) => f.id)).toEqual([fu.id]);

    await query(`UPDATE whatsapp_followups SET due_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [fu.id]);
    await runDueFollowupReminders();
    const notes = await queryRows<{ reference_type: string; reference_id: string; message: string }>(
      `SELECT reference_type, reference_id::text AS reference_id, message FROM notifications WHERE business_id = $1 AND user_id = $2`,
      [B, SUP],
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ reference_type: 'whatsapp_lead', reference_id: lead.lead.id });
    expect(notes[0].message).toMatch(/ring him/);
    expect(notificationHref({ reference_type: 'whatsapp_lead', reference_id: lead.lead.id })).toBe(`/whatsapp/leads?lead=${lead.lead.id}`);
  });

  test('a follow-up on a chat keeps the chat and links its open lead', async () => {
    const chat = await seedChat(B, { name: 'Chatty' });
    const none = await createFollowup(supView(), { conversationId: chat.id, dueAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(none).toMatchObject({ conversation_id: chat.id, lead_id: null });
    const deal = await setChatDeal(B, chat.id, { stageId: stage('Interested').id }, auto);
    const withLead = await createFollowup(supView(), { conversationId: chat.id, dueAt: new Date(Date.now() + 3600_000).toISOString(), cancelOnReply: true });
    expect(withLead).toMatchObject({ conversation_id: chat.id, lead_id: deal.lead_id, cancel_on_reply: true });
  });
});
