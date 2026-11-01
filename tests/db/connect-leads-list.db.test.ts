/**
 * Connect leads list (lib/leads/list.ts): filters, message counts, visibility, manual add, new enquiry
 * and the CSV export. Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/connect-leads-list.db.test.ts --runInBand
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

import { query, queryOne, closePool } from '@/lib/db';
import { ensureStages, PipelineError, type DealActor, type PipelineStage } from '@/lib/whatsapp/pipeline';
import { getInboxViewer, type InboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { LeadError, findOpenLead, loadLead, openLead } from '@/lib/leads/core';
import {
  createManualLead,
  exportLeads,
  listLeads,
  loadLeadDetail,
  leadsCsv,
  parseLeadPatchBody,
  startNewEnquiry,
  type LeadRow,
} from '@/lib/leads/list';
import { cleanupBusinesses, seedBusiness, seedChat } from './fixtures/connect-leads';

const run = enabled ? describe : describe.skip;

run('connect leads list (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const auto: DealActor = { source: 'auto' };
  let B: string;
  let OTHER: string;
  let AGENT: string;
  let SUP: string;
  let supervisor: InboxViewer;
  let agent: InboxViewer;
  let otherViewer: InboxViewer;
  let stages: PipelineStage[];
  const stage = (name: string) => stages.find((s) => s.name === name)!;
  const ids: Record<string, string> = {};

  async function code(p: Promise<unknown>): Promise<string> {
    try {
      await p;
      return 'ok';
    } catch (e) {
      if (e instanceof LeadError || e instanceof PipelineError) return e.code;
      throw e;
    }
  }

  const idsOf = (rows: LeadRow[]) => rows.map((r) => r.id);

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const t = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'leads'`);
    if (!t?.n) throw new Error('Apply migration 447 to kh_phase2_test first');

    const seeded = await seedBusiness('list');
    B = seeded.businessId;
    AGENT = seeded.agentId;
    SUP = seeded.supervisorId;
    const other = await seedBusiness('list-other');
    OTHER = other.businessId;
    stages = await ensureStages(B);
    supervisor = await getInboxViewer({ businessId: B, userId: SUP });
    agent = await getInboxViewer({ businessId: B, userId: AGENT });
    otherViewer = await getInboxViewer({ businessId: OTHER, userId: other.supervisorId });
    expect(supervisor.isSupervisor).toBe(true);
    expect(agent.isSupervisor).toBe(false);

    // Five leads with distinct values, opened Jan..May 2026 (the order in which they are listed oldest first).
    await query(`INSERT INTO customers (business_id, name, phone) VALUES ($1, 'Beta Customer', '98765 10002')`, [B]);
    const make = async (key: string, phone: string, opts: Partial<Parameters<typeof openLead>[1]>, openedAt: string) => {
      const { lead } = await openLead(B, { phone, actor: auto, ...opts });
      ids[key] = lead.id;
      await query(`UPDATE leads SET opened_at = $2::timestamptz WHERE id = $1`, [lead.id, openedAt]);
    };
    await make('alpha', '919876510001', { name: 'Alpha Traders', source: 'call', ownerId: AGENT, stageId: stage('Interested').id }, '2026-01-10T10:00:00Z');
    await make('beta', '919876510002', { name: 'Beta Stores' }, '2026-02-10T10:00:00Z');
    await make('gamma', '919876510003', { name: 'Gamma Mart', source: 'walk_in', stageId: stage('Won').id }, '2026-03-10T10:00:00Z');
    await make('delta', '919876510004', { name: 'Delta Works', source: 'indiamart' }, '2026-04-10T10:00:00Z');
    await make('epsilon', '919876510005', { name: 'Epsilon Foods', source: 'manual', stageId: stage('Lost').id }, '2026-05-10T10:00:00Z');
  });

  afterAll(async () => {
    try {
      await cleanupBusinesses([B, OTHER].filter(Boolean));
    } finally {
      await closePool();
    }
  });

  test('filters: type, stage, source (direct), owner, opened range, search', async () => {
    const all = await listLeads(supervisor, {});
    expect(all.total).toBe(5);
    expect(idsOf(all.rows)).toEqual([ids.epsilon, ids.delta, ids.gamma, ids.beta, ids.alpha]);

    const existing = await listLeads(supervisor, { leadType: 'existing' });
    expect(idsOf(existing.rows)).toEqual([ids.beta]);
    expect(existing.total).toBe(1);
    expect((await listLeads(supervisor, { leadType: 'new' })).total).toBe(4);

    const byStage = await listLeads(supervisor, { stageId: stage('Interested').id });
    expect(idsOf(byStage.rows)).toEqual([ids.alpha]);
    expect(byStage.total).toBe(1);
    expect(byStage.rows[0].stage_name).toBe('Interested');
    expect(byStage.rows[0].stage_kind).toBe('open');

    const direct = await listLeads(supervisor, { source: 'direct' });
    expect(idsOf(direct.rows)).toEqual([ids.beta]);
    expect(direct.total).toBe(1);
    expect(idsOf((await listLeads(supervisor, { source: 'walk_in' })).rows)).toEqual([ids.gamma]);

    const byOwner = await listLeads(supervisor, { ownerId: AGENT });
    expect(idsOf(byOwner.rows)).toEqual([ids.alpha]);
    expect(byOwner.rows[0].owner_name).toBe('Agent');
    expect(byOwner.total).toBe(1);

    const range = await listLeads(supervisor, { openedFrom: '2026-02-10', openedTo: '2026-03-10' });
    expect(idsOf(range.rows)).toEqual([ids.gamma, ids.beta]);
    expect(range.total).toBe(2);

    const byName = await listLeads(supervisor, { search: 'gamma' });
    expect(idsOf(byName.rows)).toEqual([ids.gamma]);
    expect(byName.total).toBe(1);
    expect(idsOf((await listLeads(supervisor, { search: '510004' })).rows)).toEqual([ids.delta]);
    // The linked customer's name counts too.
    expect(idsOf((await listLeads(supervisor, { search: 'Beta Customer' })).rows)).toEqual([ids.beta]);

    expect(idsOf((await listLeads(supervisor, { status: 'open' })).rows)).toEqual([ids.delta, ids.beta, ids.alpha]);
    expect(idsOf((await listLeads(supervisor, { status: 'closed' })).rows)).toEqual([ids.epsilon, ids.gamma]);

    // Bad values are ignored, as on the board.
    const junk = await listLeads(supervisor, {
      stageId: 'nope',
      ownerId: 'nope',
      source: 'DROP TABLE',
      openedFrom: 'yesterday',
      openedTo: '2026-13-45',
      leadType: 'weird' as never,
      status: 'weird' as never,
    });
    expect(junk.total).toBe(5);

    const page = await listLeads(supervisor, { offset: 4 });
    expect(idsOf(page.rows)).toEqual([ids.alpha]);
    expect(page.total).toBe(5);
  });

  test('message_count is null without a chat and counts messages with one', async () => {
    const chat = await seedChat(B, { phone: '919876520001', name: 'Chatty' });
    const { lead } = await openLead(B, { phone: chat.phone, conversationId: chat.id, actor: auto });
    for (const text of ['hi', 'price?', 'ok']) {
      await query(
        `INSERT INTO whatsapp_conversation_messages (business_id, conversation_id, from_number, to_number, message_text, direction)
         VALUES ($1, $2, $3, '919999900000', $4, 'incoming')`,
        [B, chat.id, chat.phone, text],
      );
    }
    const rows = (await listLeads(supervisor, {})).rows;
    expect(rows.find((r) => r.id === ids.alpha)!.message_count).toBeNull();
    const chatty = rows.find((r) => r.id === lead.id)!;
    expect(chatty.message_count).toBe(3);
    expect(chatty.conversation_id).toBe(chat.id);
    expect(chatty.name).toBe('Chatty');
    await query(`DELETE FROM leads WHERE id = $1`, [lead.id]);
  });

  test('agents cannot list, open or export leads they cannot see', async () => {
    const chat = await seedChat(B, { phone: '919876530001', name: 'Hidden Buyer' });
    await query(`UPDATE whatsapp_conversations SET inbox_state = 'intervened', assigned_to = $2 WHERE id = $1`, [chat.id, SUP]);
    const { lead: hidden } = await openLead(B, { phone: chat.phone, conversationId: chat.id, actor: auto });

    expect(idsOf((await listLeads(supervisor, {})).rows)).toContain(hidden.id);
    const seen = await listLeads(agent, {});
    expect(idsOf(seen.rows)).not.toContain(hidden.id);
    expect(seen.total).toBe(5);
    expect(await loadLeadDetail(agent, hidden.id)).toBeNull();
    expect(await loadLeadDetail(supervisor, hidden.id)).not.toBeNull();
    const csv = await exportLeads(agent, {});
    expect(csv).not.toContain(chat.phone);
    expect(await exportLeads(supervisor, {})).toContain(chat.phone);
    // An agent cannot start a new enquiry from it either.
    expect(await code(startNewEnquiry(agent, hidden.id, true))).toBe('NOT_FOUND');

    await query(`DELETE FROM leads WHERE id = $1`, [hidden.id]);
  });

  test('manual add refuses a bad phone, returns the open lead for a known one', async () => {
    expect(await code(createManualLead(supervisor, { name: 'Ravi', phone: '12345', source: 'call' }))).toBe('BAD_PHONE');
    expect(await code(createManualLead(supervisor, { name: '', phone: '919876540001', source: 'call' }))).toBe('BAD_NAME');
    expect(await code(createManualLead(supervisor, { name: 'x'.repeat(121), phone: '919876540001', source: 'call' }))).toBe('BAD_NAME');
    expect(await code(createManualLead(supervisor, { name: 'Ravi', phone: '919876540001', source: 'ctwa_ad' }))).toBe('BAD_SOURCE');

    const made = await createManualLead(supervisor, {
      name: 'Ravi', phone: '+91 98765 40001', source: 'walk_in', note: 'Came to the shop', stageId: stage('Interested').id, ownerId: AGENT,
    });
    expect(made.existing).toBe(false);
    expect(made.lead.source).toBe('walk_in');
    expect(made.lead.contact_name).toBe('Ravi');
    expect(made.lead.created_by).toBe(SUP);
    expect(made.lead.stage_id).toBe(stage('Interested').id);
    expect(made.lead.owner_id).toBe(AGENT);

    const again = await createManualLead(supervisor, {
      name: 'Someone else', phone: '919876540001', source: 'call', note: 'ignored', stageId: stage('New').id, ownerId: null,
    });
    expect(again.existing).toBe(true);
    expect(again.lead.id).toBe(made.lead.id);
    const stored = (await loadLead(B, made.lead.id))!;
    expect(stored.contact_name).toBe('Ravi');
    expect(stored.note).toBe('Came to the shop');
    expect(stored.stage_id).toBe(stage('Interested').id);
    expect(stored.owner_id).toBe(AGENT);
  });

  test('new enquiry refuses while one is open, closes it when confirmed', async () => {
    await query(`INSERT INTO customers (business_id, name, phone) VALUES ($1, 'Repeat Buyer', '98765 50001')`, [B]);
    const chat = await seedChat(B, { phone: '919876550001', name: 'Repeat' });
    const { lead: first } = await openLead(B, { phone: chat.phone, name: 'Repeat', conversationId: chat.id, source: 'call', actor: auto });
    expect(first.lead_type).toBe('existing');

    expect(await code(startNewEnquiry(supervisor, first.id, false))).toBe('LEAD_OPEN');
    expect((await loadLead(B, first.id))!.closed_at).toBeNull();

    const fresh = await startNewEnquiry(supervisor, first.id, true);
    expect(fresh.id).not.toBe(first.id);
    expect(fresh.closed_at).toBeNull();
    expect(fresh.conversation_id).toBe(chat.id);
    expect(fresh.contact_phone).toBe(chat.phone);
    expect(fresh.contact_name).toBe('Repeat');
    expect(fresh.customer_id).toBe(first.customer_id);
    expect(fresh.source).toBeNull();
    expect(fresh.created_by).toBe(SUP);

    const old = (await loadLead(B, first.id))!;
    expect(old.closed_at).not.toBeNull();
    expect(old.lost_reason).toBe('New enquiry');
    expect(old.stage_id).toBe(stage('Lost').id);

    const detail = (await loadLeadDetail(supervisor, fresh.id))!;
    expect(detail.other_leads.map((o) => o.id)).toEqual([first.id]);
    expect(detail.other_leads[0].stage_name).toBe('Lost');
    expect(detail.other_leads[0].closed_at).not.toBeNull();
    expect(detail.followups).toEqual([]);
    expect(detail.source_detail).toBeNull();
    expect((await findOpenLead(B, chat.phone))!.id).toBe(fresh.id);

    // From the closed lead, with nobody else open, it just opens a new one.
    await query(`UPDATE leads SET closed_at = NOW(), stage_id = $2 WHERE id = $1`, [fresh.id, stage('Won').id]);
    const third = await startNewEnquiry(supervisor, first.id, false);
    expect(third.closed_at).toBeNull();
    expect(third.id).not.toBe(fresh.id);
  });

  test('CSV escapes hostile names', () => {
    const base: LeadRow = {
      id: 'x', name: '', phone: '919876500000', conversation_id: null, message_count: null, lead_type: 'new', source: null,
      stage_id: null, stage_name: 'New', stage_kind: 'open', temperature: null, lead_score: null, owner_id: null, owner_name: null,
      customer_id: null, opened_at: '2026-01-10T10:00:00Z', last_activity_at: '2026-01-11T10:00:00Z', closed_at: null,
    };
    const csv = leadsCsv([
      { ...base, name: '=HYPERLINK("x")' },
      { ...base, name: 'Sharma, "Raju"' },
      { ...base, name: '@cmd', source: 'walk_in', message_count: 4 },
    ]);
    expect(csv.split('\r\n')[0]).toBe('Name,Phone,Type,Source,Stage,Owner,Opened,Last activity,Messages');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"Sharma, ""Raju"""`);
    expect(csv).toContain(`'@cmd`);
    expect(csv).toContain('Walk-in');
    expect(csv).toContain('Direct');
  });

  test('manual add does not reveal an open lead the agent cannot see', async () => {
    const chat = await seedChat(B, { phone: '919876560101', name: 'Secret Buyer' });
    await query(`UPDATE whatsapp_conversations SET inbox_state = 'intervened', assigned_to = $2 WHERE id = $1`, [chat.id, SUP]);
    const { lead: hidden } = await openLead(B, { phone: chat.phone, name: 'Secret Buyer', conversationId: chat.id, actor: auto });

    let thrown: unknown;
    try {
      await createManualLead(agent, { name: 'Probe', phone: '98765 60101', source: 'call' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(LeadError);
    expect((thrown as LeadError).status).toBe(409);
    expect((thrown as LeadError).code).toBe('LEAD_OPEN');
    expect(JSON.stringify({ message: (thrown as LeadError).message, ...(thrown as object) })).not.toContain(hidden.id);
    expect((thrown as LeadError).message).not.toContain('Secret');
    // A supervisor gets the lead.
    expect((await createManualLead(supervisor, { name: 'Probe', phone: '919876560101', source: 'call' })).lead.id).toBe(hidden.id);
    await query(`DELETE FROM leads WHERE id = $1`, [hidden.id]);
  });

  test("manual add links the number's newest visible 1:1 chat", async () => {
    const older = await seedChat(B, { phone: '919876560201', name: 'Older' });
    await query(`UPDATE whatsapp_conversations SET last_message_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [older.id]);
    const newest = await seedChat(B, { phone: '+919876560201', name: 'Newest' });
    const group = await seedChat(B, { phone: '91 98765 60201', name: 'Group' });
    await query(`UPDATE whatsapp_conversations SET is_group = true, last_message_at = NOW() + INTERVAL '1 day' WHERE id = $1`, [group.id]);

    const made = await createManualLead(supervisor, { name: 'Walk In', phone: '98765 60201', source: 'walk_in' });
    expect(made.existing).toBe(false);
    expect(made.lead.conversation_id).toBe(newest.id);
    expect(made.lead.contact_phone).toBe('919876560201');

    // A chat the agent cannot see is not attached by an agent's add.
    const hiddenChat = await seedChat(B, { phone: '919876560202', name: 'Hidden' });
    await query(`UPDATE whatsapp_conversations SET inbox_state = 'intervened', assigned_to = $2 WHERE id = $1`, [hiddenChat.id, SUP]);
    const byAgent = await createManualLead(agent, { name: 'Agent Add', phone: '919876560202', source: 'call' });
    expect(byAgent.lead.conversation_id).toBeNull();
    await query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [[made.lead.id, byAgent.lead.id]]);
  });

  test('a failed new enquiry puts the closed lead back', async () => {
    const chat = await seedChat(B, { phone: '919876560301', name: 'Rollback' });
    const { lead } = await openLead(B, { phone: chat.phone, conversationId: chat.id, stageId: stage('Interested').id, actor: auto });
    // openLead refuses a group chat, after the old lead was closed.
    await query(`UPDATE whatsapp_conversations SET is_group = true WHERE id = $1`, [chat.id]);
    expect(await code(startNewEnquiry(supervisor, lead.id, true))).toBe('GROUP_CHAT');
    const after = (await loadLead(B, lead.id))!;
    expect(after.closed_at).toBeNull();
    expect(after.stage_id).toBe(stage('Interested').id);
    expect(after.lost_reason).toBeNull();
    expect((await findOpenLead(B, chat.phone))!.id).toBe(lead.id);
    await query(`DELETE FROM leads WHERE id = $1`, [lead.id]);
  });

  test('a customer copied onto a new enquiry makes it existing; a deleted customer is not copied', async () => {
    for (const deleted of [false, true]) {
      const phone = deleted ? '919876560402' : '919876560401';
      const cust = await queryOne<{ id: string }>(
        `INSERT INTO customers (business_id, name, phone, deleted_at) VALUES ($1, $2, $3, ${deleted ? 'NOW()' : 'NULL'}) RETURNING id::text AS id`,
        [B, deleted ? 'Gone Customer' : 'Live Customer', deleted ? '90000 99998' : '90000 99999'],
      );
      const { lead } = await openLead(B, { phone, actor: auto });
      expect(lead.lead_type).toBe('new');
      await query(`UPDATE leads SET customer_id = $2 WHERE id = $1`, [lead.id, cust!.id]);
      const fresh = await startNewEnquiry(supervisor, lead.id, true);
      if (deleted) {
        expect(fresh.customer_id).toBeNull();
        expect(fresh.lead_type).toBe('new');
      } else {
        expect(fresh.customer_id).toBe(cust!.id);
        expect(fresh.lead_type).toBe('existing');
      }
      await query(`DELETE FROM leads WHERE contact_phone = $1 AND business_id = $2`, [phone, B]);
    }
  });

  test('opened-date filters use India dates', async () => {
    const { lead } = await openLead(B, { phone: '919876560501', name: 'Late Night', actor: auto });
    // 23:00 UTC on 10 June is 04:30 on 11 June in India.
    await query(`UPDATE leads SET opened_at = '2026-06-10T23:00:00Z' WHERE id = $1`, [lead.id]);
    expect(idsOf((await listLeads(supervisor, { openedFrom: '2026-06-11', openedTo: '2026-06-11' })).rows)).toEqual([lead.id]);
    expect((await listLeads(supervisor, { openedFrom: '2026-06-10', openedTo: '2026-06-10' })).total).toBe(0);
    await query(`DELETE FROM leads WHERE id = $1`, [lead.id]);
  });

  test('search finds a phone typed with spaces or a plus', async () => {
    expect(idsOf((await listLeads(supervisor, { search: '98765 10004' })).rows)).toEqual([ids.delta]);
    expect(idsOf((await listLeads(supervisor, { search: '+91 98765-10004' })).rows)).toEqual([ids.delta]);
  });

  test('other_leads matches the last 10 digits', async () => {
    const { lead: current } = await openLead(B, { phone: '919876570001', actor: auto });
    const { lead: closed } = await openLead(B, { phone: '919876570002', stageId: stage('Lost').id, actor: auto });
    // Same last 10 digits, different country prefix.
    await query(`UPDATE leads SET contact_phone = '449876570001' WHERE id = $1`, [closed.id]);
    const detail = (await loadLeadDetail(supervisor, current.id))!;
    expect(detail.other_leads.map((o) => o.id)).toEqual([closed.id]);
    await query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [[current.id, closed.id]]);
  });

  test('PATCH bodies that are not JSON objects are refused', () => {
    for (const bad of ['text', 5, [1], null, undefined]) {
      let thrown: unknown;
      try {
        parseLeadPatchBody(bad);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(LeadError);
      expect((thrown as LeadError).status).toBe(400);
      expect((thrown as LeadError).code).toBe('BAD_BODY');
    }
    expect(parseLeadPatchBody({})).toEqual({});
    expect(parseLeadPatchBody({ stage_id: 'x', deal_value: '12.5', owner_id: '', note: 'hi' })).toEqual({
      stageId: 'x',
      dealValue: 12.5,
      ownerId: null,
      note: 'hi',
    });
  });

  test("another business's lead is invisible", async () => {
    expect(await loadLeadDetail(otherViewer, ids.alpha)).toBeNull();
    expect((await listLeads(otherViewer, {})).total).toBe(0);
    expect(await loadLeadDetail(supervisor, randomUUID())).toBeNull();
    expect(await loadLeadDetail(supervisor, 'not-a-uuid')).toBeNull();
  });
});
