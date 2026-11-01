/**
 * Connect leads from messages (lib/leads/inbound.ts): every inbound 1:1 message follows the repeat
 * rule (join the open lead, close a lead quiet for 30 days and open a fresh one), tracked links and
 * ads open leads with their source, staff and bot replies touch the open lead, history sync and
 * re-deliveries never drive the rule, and chats get no stage.
 * Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/connect-leads-inbound.db.test.ts --runInBand
 * Migrations 418, 419, 446 and 447 must be applied to kh_phase2_test.
 */
import { randomInt, randomUUID } from 'crypto';
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

import { query, queryOne, queryRows, closePool, getPool } from '@/lib/db';
import { ensureStages, type DealActor, type PipelineStage } from '@/lib/whatsapp/pipeline';
import { closeLeadAsWentQuiet, openLead, setLeadStage } from '@/lib/leads/core';
import * as ownership from '@/lib/whatsapp/inbox-ownership';
import { leadForInboundMessage } from '@/lib/leads/inbound';
import { describeStageEvent } from '@/lib/leads/timeline';
import { applyAdReferral, createEntryLink } from '@/lib/whatsapp/lead-sources';
import { storeIncomingMessage, storeOutgoingMessage } from '@/lib/whatsapp-crm';
import { cleanupBusinesses, seedBusiness, seedChat } from './fixtures/connect-leads';

describe('stage event wording', () => {
  test('a went-quiet close reads differently from a new lead', () => {
    expect(describeStageEvent({ to_stage: 'New', source: 'auto' })).toBe('Moved to New automatically (new lead)');
    expect(describeStageEvent({ from_stage: 'New', to_stage: 'Lost', source: 'auto', reason: 'went_quiet', quiet_days: 30 })).toBe(
      'Closed as lost: went quiet (no messages for 30 days)',
    );
    expect(describeStageEvent({ from_stage: 'New', to_stage: 'Won', source: 'agent', actor_name: 'Ravi' })).toBe('Moved to Won from New by Ravi');
    expect(describeStageEvent({ reference: 'INV-7' })).toBe('Won: INV-7');
    expect(describeStageEvent({ source: 'flow' })).toBe('Taken off the pipeline by a flow');
  });
});

const run = enabled ? describe : describe.skip;

run('connect leads from messages (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const auto: DealActor = { source: 'auto' };
  let B: string;
  let AGENT: string;
  let stages: PipelineStage[];
  const stage = (name: string) => stages.find((s) => s.name === name)!;
  const phone = () => `91${randomInt(6_000_000_000, 9_999_999_999)}`;

  async function receive(p: string, text: string, opts: { messageId?: string; sentSec?: number } = {}): Promise<string> {
    const { conversationId } = await storeIncomingMessage(
      B, `${p}@s.whatsapp.net`, '919999900000', text, opts.messageId ?? `in-${randomUUID()}`,
      'text', undefined, false, undefined, undefined, undefined, opts.sentSec ?? null,
    );
    return conversationId;
  }
  const daysAgoSec = (d: number) => Math.floor(Date.now() / 1000) - d * 24 * 60 * 60;
  const activityOf = async (leadId: string) =>
    (await queryOne<{ t: string }>(`SELECT last_activity_at::text AS t FROM leads WHERE id = $1`, [leadId]))!.t;

  type LeadRow = {
    id: string;
    conversation_id: string | null;
    source: string | null;
    source_detail: any;
    lead_type: string;
    stage_name: string | null;
    owner_id: string | null;
    lost_reason: string | null;
    closed_at: Date | null;
    last_activity_at: Date;
  };
  async function leadsFor(p: string): Promise<LeadRow[]> {
    return queryRows<LeadRow>(
      `SELECT l.id::text AS id, l.conversation_id::text AS conversation_id, l.source, l.source_detail, l.lead_type,
              s.name AS stage_name, l.owner_id::text AS owner_id, l.lost_reason, l.closed_at, l.last_activity_at
         FROM leads l LEFT JOIN whatsapp_pipeline_stages s ON s.id = l.stage_id
        WHERE l.business_id = $1 AND l.contact_phone = $2
        ORDER BY l.opened_at, l.created_at`,
      [B, p],
    );
  }
  const openOf = async (p: string) => (await leadsFor(p)).filter((l) => !l.closed_at);

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const t = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'leads'`);
    if (!t?.n) throw new Error('Apply migration 447 to kh_phase2_test first');
    const seeded = await seedBusiness('inbound');
    B = seeded.businessId;
    AGENT = seeded.agentId;
    stages = await ensureStages(B);
  });

  afterAll(async () => {
    try {
      if (B) await query(`DELETE FROM whatsapp_entry_links WHERE business_id = $1`, [B]);
      await cleanupBusinesses([B].filter(Boolean));
    } finally {
      await closePool();
    }
  });

  test("new number's first message opens a Direct lead linked to the chat", async () => {
    const p = phone();
    const chat = await receive(p, 'Do you deliver to Pune?');
    const leads = await leadsFor(p);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ source: null, lead_type: 'new', conversation_id: chat, stage_name: 'New', closed_at: null });
    // A number that is not a phone returns at once: no queries, no warning.
    const warn = jest.spyOn(console, 'warn');
    try {
      expect(await leadForInboundMessage(B, chat, 'abc', null)).toEqual({ leadId: null, action: 'none' });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('a second message joins the open lead', async () => {
    const p = phone();
    await receive(p, 'Hi');
    const [lead] = await leadsFor(p);
    await query(`UPDATE leads SET last_activity_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [lead.id]);
    const before = (await leadsFor(p))[0].last_activity_at;
    await receive(p, 'Any update?');
    const after = await leadsFor(p);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(lead.id);
    expect(new Date(after[0].last_activity_at).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  test('quiet 30 days: old lead lost as went quiet, a new one opens', async () => {
    const p = phone();
    const chat = await receive(p, 'Rates please');
    const [old] = await leadsFor(p);
    await query(`UPDATE leads SET last_activity_at = NOW() - INTERVAL '31 days' WHERE id = $1`, [old.id]);

    const result = await leadForInboundMessage(B, chat, p, 'Back again');
    expect(result.action).toBe('reopened_after_quiet');
    const leads = await leadsFor(p);
    expect(leads).toHaveLength(2);
    const closed = leads.find((l) => l.id === old.id)!;
    expect(closed.closed_at).not.toBeNull();
    expect(closed).toMatchObject({ lost_reason: 'Went quiet', stage_name: 'Lost' });
    const fresh = leads.find((l) => !l.closed_at)!;
    expect(fresh.id).toBe(result.leadId);
    expect(fresh).toMatchObject({ conversation_id: chat, stage_name: 'New' });

    const event = await queryOne<{ event_data: any }>(
      `SELECT event_data FROM whatsapp_automation_events WHERE lead_id = $1 AND event_type = 'stage_changed' AND event_data->>'to_stage' = 'Lost'`,
      [old.id],
    );
    expect(event?.event_data).toMatchObject({ reason: 'went_quiet', quiet_days: 30 });
    expect(describeStageEvent(event!.event_data)).toBe('Closed as lost: went quiet (no messages for 30 days)');
  });

  test('29 days quiet still joins', async () => {
    const p = phone();
    await receive(p, 'Hello');
    const [lead] = await leadsFor(p);
    await query(`UPDATE leads SET last_activity_at = NOW() - INTERVAL '29 days' WHERE id = $1`, [lead.id]);
    await receive(p, 'Still there?');
    const leads = await leadsFor(p);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ id: lead.id, closed_at: null });
  });

  test("after a won lead, a non-customer's message opens a new lead", async () => {
    const p = phone();
    const chat = await receive(p, 'Order 10 boxes');
    const [won] = await leadsFor(p);
    await setLeadStage(B, won.id, stage('Won').id, auto);
    const result = await leadForInboundMessage(B, chat, p, 'Need 10 more');
    expect(result.action).toBe('opened');
    const open = await openOf(p);
    expect(open).toHaveLength(1);
    expect(open[0].id).not.toBe(won.id);
    expect(open[0].conversation_id).toBe(chat);
  });

  test("a customer's message opens nothing, even after a closed lead", async () => {
    const p = phone();
    await query(`INSERT INTO customers (business_id, name, phone) VALUES ($1, 'Meena', $2)`, [B, `+91 ${p.slice(2)}`]);
    const { lead } = await openLead(B, { phone: p, actor: auto });
    await setLeadStage(B, lead.id, stage('Lost').id, auto);
    await receive(p, 'Send my bill');
    expect(await openOf(p)).toHaveLength(0);
  });

  test("link code on a returning number opens a link lead with the link's stage and owner", async () => {
    const p = phone();
    await query(`INSERT INTO customers (business_id, name, phone) VALUES ($1, 'Kiran', $2)`, [B, p]);
    const { lead: past } = await openLead(B, { phone: p, actor: auto });
    await setLeadStage(B, past.id, stage('Won').id, auto);
    const link = await createEntryLink(B, AGENT, { name: 'Diwali poster', phone: '9999900000', stageId: stage('Follow up').id, assignTo: AGENT });

    const chat = await receive(p, `Price list please (ref ${link.code})`);
    const open = await openOf(p);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ source: 'link', stage_name: 'Follow up', owner_id: AGENT, lead_type: 'existing', conversation_id: chat });
    expect(open[0].source_detail).toMatchObject({ link_id: link.id, name: 'Diwali poster', code: link.code, label_ids: [] });
    const conv = await queryOne<{ assigned_to: string | null }>(`SELECT assigned_to::text AS assigned_to FROM whatsapp_conversations WHERE id = $1`, [chat]);
    expect(conv?.assigned_to).toBe(AGENT);
  });

  test('ad referral sets the source on the lead just opened, not on an old one', async () => {
    const p = phone();
    const chat = await receive(p, 'Saw your ad');
    await applyAdReferral(B, chat, { sourceId: 'AD1', sourceType: 'ad', sourceUrl: 'https://fb.me/x', headline: 'Diwali sale', ctwaClid: 'clid1' });
    await applyAdReferral(B, chat, { sourceId: 'AD2', sourceType: 'ad', sourceUrl: null, headline: 'Second ad', ctwaClid: null });
    const [lead] = await openOf(p);
    expect(lead.source).toBe('ctwa_ad');
    expect(lead.source_detail).toMatchObject({ ad_id: 'AD1', headline: 'Diwali sale', ctwa_clid: 'clid1' });

    const q = phone();
    const { id: oldChat } = await seedChat(B, { phone: q });
    const { lead: old } = await openLead(B, { phone: q, conversationId: oldChat, actor: auto });
    await query(`UPDATE leads SET opened_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [old.id]);
    await applyAdReferral(B, oldChat, { sourceId: 'AD3', sourceType: 'ad', sourceUrl: null, headline: null, ctwaClid: null });
    const [still] = await openOf(q);
    expect(still.id).toBe(old.id);
    expect(still.source).toBeNull();
  });

  test('an outbound message touches and links the open lead', async () => {
    const p = phone();
    const { lead } = await openLead(B, { phone: p, actor: auto });
    await query(`UPDATE leads SET last_activity_at = NOW() - INTERVAL '3 days' WHERE id = $1`, [lead.id]);
    const before = await activityOf(lead.id);
    const { id: chat } = await seedChat(B, { phone: p });
    const send = (sentBy: 'staff' | 'system' | null) =>
      storeOutgoingMessage(B, chat, `${p}@s.whatsapp.net`, 'Hello from us', `out-${randomUUID()}`, 'text', undefined, undefined, null, null, { sentBy });

    // Campaign sends and unclassified echoes leave the lead alone.
    await send(null);
    await send('system');
    let [after] = await leadsFor(p);
    expect(after.conversation_id).toBeNull();
    expect(await activityOf(lead.id)).toBe(before);

    await send('staff');
    [after] = await leadsFor(p);
    expect(after.conversation_id).toBe(chat);
    expect(new Date(after.last_activity_at).getTime()).toBeGreaterThan(Date.now() - 60 * 60 * 1000);
  });

  test("a chat tied to a customer gets no Direct lead, even when the customer's phone differs", async () => {
    const p = phone();
    const cust = await queryOne<{ id: string }>(`INSERT INTO customers (business_id, name, phone) VALUES ($1, 'Office line', $2) RETURNING id::text AS id`, [
      B,
      phone(),
    ]);
    const { id: chat } = await seedChat(B, { phone: p });
    await query(`UPDATE whatsapp_conversations SET customer_id = $2 WHERE id = $1`, [chat, cust!.id]);
    expect(await receive(p, 'Send the invoice')).toBe(chat);
    expect(await leadsFor(p)).toHaveLength(0);

    // An agent's lead on that chat, once won, is not followed by an automatic one.
    const { lead } = await openLead(B, { phone: p, conversationId: chat, actor: auto });
    await setLeadStage(B, lead.id, stage('Won').id, auto);
    await receive(p, 'Thanks, received');
    expect(await openOf(p)).toHaveLength(0);
  });

  test('history sync, old and re-delivered messages never drive the repeat rule', async () => {
    // A 3-day-old message from a new number opens nothing.
    const fresh = phone();
    await receive(fresh, 'Old hello', { sentSec: daysAgoSec(3) });
    expect(await leadsFor(fresh)).toHaveLength(0);

    // A 3-day-old message on a stale lead neither closes it nor touches it.
    const stale = phone();
    await receive(stale, 'Hi');
    const [lead] = await leadsFor(stale);
    await query(`UPDATE leads SET last_activity_at = NOW() - INTERVAL '31 days' WHERE id = $1`, [lead.id]);
    const staleAt = await activityOf(lead.id);
    await receive(stale, 'Synced from history', { sentSec: daysAgoSec(3) });
    const stillOpen = await leadsFor(stale);
    expect(stillOpen).toHaveLength(1);
    expect(stillOpen[0].closed_at).toBeNull();
    expect(await activityOf(lead.id)).toBe(staleAt);

    // An old message still gives an open lead with no chat its chat, without touching it.
    const noChat = phone();
    const { lead: bare } = await openLead(B, { phone: noChat, actor: auto });
    await query(`UPDATE leads SET last_activity_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [bare.id]);
    const bareAt = await activityOf(bare.id);
    const chat = await receive(noChat, 'From the backlog', { sentSec: daysAgoSec(2) });
    expect((await leadsFor(noChat))[0].conversation_id).toBe(chat);
    expect(await activityOf(bare.id)).toBe(bareAt);

    // A re-delivered message (same message id) does not touch the lead or open one.
    const dup = phone();
    const messageId = `in-${randomUUID()}`;
    await receive(dup, 'Need a quote', { messageId });
    const [first] = await leadsFor(dup);
    await query(`UPDATE leads SET last_activity_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [first.id]);
    const firstAt = await activityOf(first.id);
    await receive(dup, 'Need a quote', { messageId });
    expect(await activityOf(first.id)).toBe(firstAt);
    await setLeadStage(B, first.id, stage('Won').id, auto);
    await receive(dup, 'Need a quote', { messageId });
    expect(await leadsFor(dup)).toHaveLength(1);
    expect(await openOf(dup)).toHaveLength(0);
  });

  test('two went-quiet closes at once record one event', async () => {
    const p = phone();
    const { lead } = await openLead(B, { phone: p, actor: auto });
    // Hold the lead's row so both closes read it as open and then queue on the same UPDATE.
    const holder = await getPool().connect();
    let closes: Promise<unknown> = Promise.resolve();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM leads WHERE id = $1 FOR UPDATE', [lead.id]);
      closes = Promise.all([closeLeadAsWentQuiet(B, lead.id), closeLeadAsWentQuiet(B, lead.id)]);
      for (let i = 0; i < 150; i++) {
        const waiting = await queryOne<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'UPDATE leads SET%'`,
        );
        if (waiting!.n >= 2) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await holder.query('COMMIT');
    } finally {
      holder.release();
    }
    await closes;
    const events = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM whatsapp_automation_events WHERE lead_id = $1 AND event_data->>'reason' = 'went_quiet'`,
      [lead.id],
    );
    expect(events?.n).toBe(1);
    expect((await leadsFor(p))[0]).toMatchObject({ lost_reason: 'Went quiet', stage_name: 'Lost' });
  });

  test("a link's lead opens even when its agent cannot be assigned", async () => {
    // The agent lost inbox access: the lead opens unowned.
    const gone = randomUUID();
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, role_id, is_active)
       SELECT $1, $2, 'Gone', $3, false, role_id, true FROM users WHERE id = $4`,
      [gone, B, `8${randomInt(100_000_000, 999_999_999)}`, AGENT],
    );
    const link = await createEntryLink(B, AGENT, { name: 'Old flyer', phone: '9999900000', assignTo: gone });
    await query(`UPDATE users SET is_active = false WHERE id = $1`, [gone]);
    const p = phone();
    const { id: chat } = await seedChat(B, { phone: p });
    expect((await leadForInboundMessage(B, chat, p, `hi (ref ${link.code})`)).action).toBe('opened');
    expect((await openOf(p))[0]).toMatchObject({ source: 'link', owner_id: null });

    // Assigning the chat fails: the lead still opens, with its owner.
    const q = phone();
    const { id: chat2 } = await seedChat(B, { phone: q });
    const link2 = await createEntryLink(B, AGENT, { name: 'Shop QR', phone: '9999900000', assignTo: AGENT });
    const assign = jest.spyOn(ownership, 'assignToAgent').mockRejectedValueOnce(new Error('inbox down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect((await leadForInboundMessage(B, chat2, q, `hi (ref ${link2.code})`)).action).toBe('opened');
      expect(warn).toHaveBeenCalledWith('[leads] link agent assignment failed:', 'inbox down');
    } finally {
      assign.mockRestore();
      warn.mockRestore();
    }
    expect((await openOf(q))[0]).toMatchObject({ source: 'link', owner_id: AGENT, conversation_id: chat2 });
  });

  test('chats get no stage columns written', async () => {
    const row = await queryOne<{ chats: number; written: number }>(
      `SELECT COUNT(*)::int AS chats, COUNT(*) FILTER (WHERE stage_id IS NOT NULL OR source IS NOT NULL)::int AS written
         FROM whatsapp_conversations WHERE business_id = $1`,
      [B],
    );
    expect(row!.chats).toBeGreaterThan(5);
    expect(row!.written).toBe(0);
  });

  test('groups never get a lead', async () => {
    const p = phone();
    const groupJid = `1203630${randomInt(10_000_000, 99_999_999)}@g.us`;
    const { conversationId: group } = await storeIncomingMessage(
      B, `${p}@s.whatsapp.net`, '919999900000', 'Hello group', `in-${randomUUID()}`, 'text', undefined, true, 'Buyers', groupJid,
    );
    await storeOutgoingMessage(B, group, groupJid, 'Welcome all', `out-${randomUUID()}`);
    expect(await leadForInboundMessage(B, group, p, 'Hello group')).toEqual({ leadId: null, action: 'none' });
    const n = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM leads WHERE business_id = $1 AND (conversation_id = $2 OR contact_phone = $3)`, [B, group, p]);
    expect(n?.n).toBe(0);
  });
});
