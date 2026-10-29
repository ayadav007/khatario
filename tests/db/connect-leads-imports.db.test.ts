/**
 * Connect leads from IndiaMART pulls and webhooks (lib/whatsapp/lead-sources.ts importLead): an import opens
 * (or joins) a lead with no chat; the chat links when the buyer messages. The source's stage and owner are
 * best effort (a deleted stage or an agent who lost inbox access never drops the lead), an open Direct lead
 * takes the import's source, and tracked-link stats count leads.
 * Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/connect-leads-imports.db.test.ts --runInBand
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
process.env.SECRETS_ENCRYPTION_KEY = process.env.SECRETS_ENCRYPTION_KEY || 'a'.repeat(64);

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
import { ensureStages, type PipelineStage } from '@/lib/whatsapp/pipeline';
import * as core from '@/lib/leads/core';
import { openLead } from '@/lib/leads/core';
import {
  createEntryLink,
  createWebhookSource,
  importLead,
  listEntryLinks,
  parseIndiaMartResponse,
  parseWebhookLead,
  receiveWebhookLead,
  saveIndiaMartSource,
  syncIndiaMart,
  type IncomingLead,
} from '@/lib/whatsapp/lead-sources';
import { storeIncomingMessage } from '@/lib/whatsapp-crm';
import { cleanupBusinesses, seedBusiness, seedChat } from './fixtures/connect-leads';

describe('imported text', () => {
  test('control characters are stripped from IndiaMART and webhook text; new lines and tabs stay', () => {
    const r = parseIndiaMartResponse({
      CODE: 200,
      RESPONSE: [{ UNIQUE_QUERY_ID: 'Q\u00001', SENDER_NAME: 'Ra\u0000vi\u0007', SENDER_MOBILE: '9876500001', QUERY_MESSAGE: 'Need\u0000 20<br>boxes\tnow\u001f', SUBJECT: '\u0000' }],
    });
    expect(r.leads[0]).toMatchObject({ externalId: 'Q1', name: 'Ravi', message: 'Need 20\nboxes\tnow' });
    expect(r.leads[0].detail.subject).toBeNull();
    const w = parseWebhookLead({ phone: '9876500002', name: 'Ki\u0000ran', message: 'a\u0000b\nc', id: 'x\u0000y' });
    expect(w).toMatchObject({ name: 'Kiran', message: 'ab\nc', externalId: 'xy' });
  });
});

const run = enabled ? describe : describe.skip;

run('connect leads from IndiaMART and webhooks (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  let B: string;
  let AGENT: string;
  let stages: PipelineStage[];
  let LABEL: string;
  let LABEL_2: string;
  const phone = () => `91${randomInt(6_000_000_000, 9_999_999_999)}`;
  const incoming = (p: string, over: Partial<IncomingLead> = {}): IncomingLead => ({
    externalId: `ext-${randomUUID()}`,
    name: 'Mehul',
    phone: p,
    message: 'Need 20 boxes',
    detail: { product: 'Boxes' },
    ...over,
  });

  type LeadRow = {
    id: string;
    conversation_id: string | null;
    source: string | null;
    source_detail: any;
    source_at: Date | null;
    stage_name: string | null;
    owner_id: string | null;
    note: string | null;
    closed_at: Date | null;
  };
  async function leadsFor(p: string): Promise<LeadRow[]> {
    return queryRows<LeadRow>(
      `SELECT l.id::text AS id, l.conversation_id::text AS conversation_id, l.source, l.source_detail, l.source_at,
              s.name AS stage_name, l.owner_id::text AS owner_id, l.note, l.closed_at
         FROM leads l LEFT JOIN whatsapp_pipeline_stages s ON s.id = l.stage_id
        WHERE l.business_id = $1 AND l.contact_phone = $2 ORDER BY l.opened_at, l.created_at`,
      [B, p],
    );
  }
  const chatCount = async (p: string) =>
    (await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM whatsapp_conversations WHERE business_id = $1 AND RIGHT(from_number, 10) = $2`,
      [B, p.slice(-10)],
    ))!.n;
  const labelsOn = async (conversationId: string) =>
    (
      await queryRows<{ label_id: string }>(
        `SELECT label_id::text AS label_id FROM whatsapp_conversation_label_assignments WHERE conversation_id = $1`,
        [conversationId],
      )
    ).map((r) => r.label_id);

  /** A webhook source routed to the given stage/agent/labels, as importLead takes it. */
  async function webhookSource(name: string, routing: { stageId?: string; assignTo?: string; labelIds?: string[] } = {}) {
    const { source, token } = await createWebhookSource(B, AGENT, { name, ...routing });
    return { src: { ...source, business_id: B }, token };
  }

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const t = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'leads'`);
    if (!t?.n) throw new Error('Apply migration 447 to kh_phase2_test first');
    const seeded = await seedBusiness('imports');
    B = seeded.businessId;
    AGENT = seeded.agentId;
    stages = await ensureStages(B);
    LABEL = randomUUID();
    LABEL_2 = randomUUID();
    await query(`INSERT INTO whatsapp_conversation_labels (id, business_id, name) VALUES ($1, $2, 'IndiaMART'), ($3, $2, 'Hot')`, [LABEL, B, LABEL_2]);
  });

  afterAll(async () => {
    try {
      if (B) {
        await query(`DELETE FROM whatsapp_lead_imports WHERE business_id = $1`, [B]);
        await query(`DELETE FROM whatsapp_lead_sources WHERE business_id = $1`, [B]);
        await query(`DELETE FROM whatsapp_entry_links WHERE business_id = $1`, [B]);
        await query(`DELETE FROM whatsapp_conversation_labels WHERE business_id = $1`, [B]);
      }
      await cleanupBusinesses([B].filter(Boolean));
    } finally {
      await closePool();
    }
  });

  test('IndiaMART lead has no chat, then links when the buyer messages', async () => {
    await saveIndiaMartSource(B, AGENT, { key: 'MOCKKEY1234567890ABCDEFG', labelIds: [LABEL] });
    const p = '919876543210';
    const fetcher = async () => ({
      json: async () => ({
        CODE: 200,
        RESPONSE: [{ UNIQUE_QUERY_ID: 'IM-A1', SENDER_NAME: 'Mehul', SENDER_MOBILE: '+91-98765 43210', QUERY_MESSAGE: 'Need 20 boxes', QUERY_PRODUCT_NAME: 'Boxes' }],
      }),
    });
    expect(await syncIndiaMart(B, { fetcher, now: new Date('2026-10-26T10:00:00Z') })).toMatchObject({ fetched: 1, imported: 1, duplicates: 0 });

    const [lead] = await leadsFor(p);
    expect(await leadsFor(p)).toHaveLength(1);
    expect(lead).toMatchObject({ conversation_id: null, source: 'indiamart', stage_name: 'New', note: 'Need 20 boxes', closed_at: null });
    expect(lead.source_detail).toMatchObject({ query_id: 'IM-A1', product: 'Boxes', label_ids: [LABEL] });
    expect(await chatCount(p)).toBe(0);
    const imp = await queryOne<{ lead_id: string | null; conversation_id: string | null }>(
      `SELECT lead_id::text AS lead_id, conversation_id::text AS conversation_id FROM whatsapp_lead_imports WHERE business_id = $1 AND external_id = 'IM-A1'`,
      [B],
    );
    expect(imp).toEqual({ lead_id: lead.id, conversation_id: null });
    const field = await queryOne(`SELECT 1 FROM whatsapp_conversation_custom_fields WHERE business_id = $1 AND field_key = 'indiamart_enquiry'`, [B]);
    expect(field).toBeNull();

    // The buyer messages: the same lead gets the chat and the source's labels.
    const { conversationId } = await storeIncomingMessage(B, `${p}@s.whatsapp.net`, '919999900000', 'Hi, about my IndiaMART enquiry', `in-${randomUUID()}`);
    const after = await leadsFor(p);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: lead.id, conversation_id: conversationId, source: 'indiamart' });
    expect(await labelsOn(conversationId)).toEqual([LABEL]);
  });

  test('the same IndiaMART query twice imports once', async () => {
    const { src } = await webhookSource('Twice');
    const p = phone();
    const lead = incoming(p, { externalId: 'IM-TWICE' });
    const first = await importLead(src, lead);
    expect(first).toMatchObject({ created: true });
    expect(await importLead(src, lead)).toBeNull();
    expect(await leadsFor(p)).toHaveLength(1);
  });

  test('webhook lead for a number with an open lead reuses it', async () => {
    const { src, token } = await webhookSource('JustDial', { labelIds: [LABEL] });
    const p = phone();
    const ad = (await openLead(B, { phone: p, source: 'ctwa_ad', sourceDetail: { ad_id: 'AD9' }, actor: { source: 'auto' } })).lead;

    const joined = await importLead(src, incoming(p));
    expect(joined).toEqual({ leadId: ad.id, created: false });
    const rows = await leadsFor(p);
    expect(rows).toHaveLength(1);
    // The lead keeps its own source; the import's labels join it.
    expect(rows[0].source).toBe('ctwa_ad');
    expect(rows[0].source_detail).toMatchObject({ ad_id: 'AD9', label_ids: [LABEL] });
    expect(rows[0].source_detail.lead_source_id).toBeUndefined();

    // Through the public entry point: not a duplicate, same lead.
    const viaWebhook = await receiveWebhookLead(token, { phone: p, id: 'JD-OPEN-1', message: 'Another enquiry' });
    expect(viaWebhook).toEqual({ leadId: ad.id, duplicate: false });
    // A repeat of the same webhook call is a duplicate and names the lead it made.
    expect(await receiveWebhookLead(token, { phone: p, id: 'JD-OPEN-1' })).toEqual({ leadId: ad.id, duplicate: true });
    expect(await leadsFor(p)).toHaveLength(1);
  });

  test('an open Direct lead takes the import source; labels reach its chat', async () => {
    const { src } = await webhookSource('Zapier', { labelIds: [LABEL, LABEL_2] });
    const chat = await seedChat(B);
    const direct = (await openLead(B, { phone: chat.phone, conversationId: chat.id, actor: { source: 'auto' } })).lead;
    expect(direct.source).toBeNull();

    const r = await importLead(src, incoming(chat.phone, { detail: { city: 'Pune' }, message: 'Bulk order' }));
    expect(r).toEqual({ leadId: direct.id, created: false });
    const [row] = await leadsFor(chat.phone);
    expect(row).toMatchObject({ id: direct.id, source: 'lead_api', conversation_id: chat.id });
    expect(row.source_at).not.toBeNull();
    expect(row.source_detail).toMatchObject({ lead_source_id: src.id, name: 'Zapier', city: 'Pune', message: 'Bulk order' });
    expect([...row.source_detail.label_ids].sort()).toEqual([LABEL, LABEL_2].sort());
    expect((await labelsOn(chat.id)).sort()).toEqual([LABEL, LABEL_2].sort());
    expect(await chatCount(chat.phone)).toBe(1);

    // A second import with the same labels does not duplicate them.
    await importLead(src, incoming(chat.phone));
    const [again] = await leadsFor(chat.phone);
    expect(again.source_detail.label_ids).toHaveLength(2);
    expect(again.source).toBe('lead_api');
  });

  test('a source whose stage was deleted falls back to the first open stage', async () => {
    const { src } = await webhookSource('Old stage');
    const p = phone();
    const r = await importLead({ ...src, stage_id: randomUUID() }, incoming(p));
    expect(r).toMatchObject({ created: true });
    const [row] = await leadsFor(p);
    expect(row.stage_name).toBe(stages.find((s) => s.kind === 'open')!.name);
    expect(row.closed_at).toBeNull();
  });

  test('the source stage and owner apply when valid; an ineligible owner falls back to no owner', async () => {
    const interested = stages.find((s) => s.name === 'Interested')!;
    const { src } = await webhookSource('Routed', { stageId: interested.id, assignTo: AGENT });
    const p1 = phone();
    await importLead(src, incoming(p1));
    expect((await leadsFor(p1))[0]).toMatchObject({ stage_name: 'Interested', owner_id: AGENT });

    // A user with no inbox access cannot own the lead; the lead is still created.
    const noAccess = randomUUID();
    await query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin, is_active) VALUES ($1, $2, 'Gone', $3, false, true)`, [
      noAccess,
      B,
      `8${randomInt(100_000_000, 999_999_999)}`,
    ]);
    const p2 = phone();
    const r = await importLead({ ...src, assign_to: noAccess }, incoming(p2));
    expect(r).toMatchObject({ created: true });
    expect((await leadsFor(p2))[0]).toMatchObject({ stage_name: 'Interested', owner_id: null, source: 'lead_api' });
  });

  test('a lead that fails to import does not stop the pull: the rest import, the failure is recorded and retried', async () => {
    const good1 = phone();
    const bad = phone();
    const good2 = phone();
    const fetcher = async () => ({
      json: async () => ({
        CODE: 200,
        RESPONSE: [good1, bad, good2].map((p, i) => ({ UNIQUE_QUERY_ID: `IM-F${i}`, SENDER_NAME: 'Buyer', SENDER_MOBILE: p, QUERY_MESSAGE: 'Need boxes' })),
      }),
    });
    const original = core.openLead;
    const spy = jest.spyOn(core, 'openLead').mockImplementation((businessId, input) =>
      input.phone === bad ? Promise.reject(new Error('forced failure')) : original(businessId, input),
    );
    let run1;
    try {
      run1 = await syncIndiaMart(B, { fetcher, now: new Date('2026-10-27T10:00:00Z') });
    } finally {
      spy.mockRestore();
    }
    expect(run1).toMatchObject({ fetched: 3, imported: 2, duplicates: 0, failed: 1 });
    expect(await leadsFor(good1)).toHaveLength(1);
    expect(await leadsFor(good2)).toHaveLength(1);
    expect(await leadsFor(bad)).toHaveLength(0);
    const src = await queryOne<{ last_error: string; last_result: any; synced_until: Date }>(
      `SELECT last_error, last_result, synced_until FROM whatsapp_lead_sources WHERE business_id = $1 AND kind = 'indiamart'`,
      [B],
    );
    expect(src!.last_error).toContain('IM-F1');
    expect(src!.last_error).toContain('forced failure');
    expect(src!.last_result).toMatchObject({ fetched: 3, imported: 2, failed: 1 });
    expect(new Date(src!.synced_until).toISOString()).toBe('2026-10-27T10:00:00.000Z');
    // No claim is left for the failed enquiry, so the next pull imports it (and the others are duplicates).
    const claims = async () =>
      (await queryRows<{ external_id: string }>(`SELECT external_id FROM whatsapp_lead_imports WHERE business_id = $1 AND external_id LIKE 'IM-F%'`, [B]))
        .map((r) => r.external_id)
        .sort();
    expect(await claims()).toEqual(['IM-F0', 'IM-F2']);
    const run2 = await syncIndiaMart(B, { fetcher, now: new Date('2026-10-27T10:10:00Z') });
    expect(run2).toMatchObject({ fetched: 3, imported: 1, duplicates: 2, failed: 0 });
    expect(await leadsFor(bad)).toHaveLength(1);
    expect(await claims()).toEqual(['IM-F0', 'IM-F1', 'IM-F2']);
    const cleared = await queryOne<{ last_error: string | null }>(`SELECT last_error FROM whatsapp_lead_sources WHERE business_id = $1 AND kind = 'indiamart'`, [B]);
    expect(cleared!.last_error).toBeNull();
  });

  test('a failure after the claim releases it, and a retry imports the enquiry once', async () => {
    const { src } = await webhookSource('Claim');
    const p = phone();
    const lead = incoming(p, { externalId: 'CLAIM-1' });
    const spy = jest.spyOn(core, 'openLead').mockRejectedValueOnce(new Error('database went away'));
    try {
      await expect(importLead(src, lead)).rejects.toThrow('database went away');
    } finally {
      spy.mockRestore();
    }
    const rows = () =>
      queryRows<{ lead_id: string | null }>(`SELECT lead_id::text AS lead_id FROM whatsapp_lead_imports WHERE lead_source_id = $1 AND external_id = 'CLAIM-1'`, [src.id]);
    expect(await rows()).toHaveLength(0);
    expect(await leadsFor(p)).toHaveLength(0);

    const retry = await importLead(src, lead);
    expect(retry).toMatchObject({ created: true });
    expect(await importLead(src, lead)).toBeNull();
    expect(await leadsFor(p)).toHaveLength(1);
    expect(await rows()).toEqual([{ lead_id: retry!.leadId }]);
  });

  test('the lead owner takes the chat when the buyer messages', async () => {
    const { src } = await webhookSource('Owned', { assignTo: AGENT });
    const p = phone();
    await importLead(src, incoming(p));
    expect((await leadsFor(p))[0]).toMatchObject({ owner_id: AGENT, conversation_id: null });
    const { conversationId } = await storeIncomingMessage(B, `${p}@s.whatsapp.net`, '919999900000', 'Hello', `in-${randomUUID()}`);
    expect((await leadsFor(p))[0].conversation_id).toBe(conversationId);
    const chat = await queryOne<{ assigned_to: string | null; inbox_state: string }>(
      `SELECT assigned_to::text AS assigned_to, inbox_state FROM whatsapp_conversations WHERE id = $1`,
      [conversationId],
    );
    expect(chat).toEqual({ assigned_to: AGENT, inbox_state: 'intervened' });
  });

  test('an existing chat for the number links to the lead at import', async () => {
    const { src } = await webhookSource('Known chat', { assignTo: AGENT, labelIds: [LABEL] });
    const chat = await seedChat(B);
    // The match is on the last 10 digits, whatever the country code.
    const r = await importLead(src, incoming(chat.phone));
    expect(r).toMatchObject({ created: true });
    const [row] = await leadsFor(chat.phone);
    expect(row.conversation_id).toBe(chat.id);
    expect(await chatCount(chat.phone)).toBe(1);
    expect(await labelsOn(chat.id)).toEqual([LABEL]);
    const c = await queryOne<{ assigned_to: string | null }>(`SELECT assigned_to::text AS assigned_to FROM whatsapp_conversations WHERE id = $1`, [chat.id]);
    expect(c!.assigned_to).toBe(AGENT);

    // A group chat with that number is never linked.
    const gp = phone();
    await query(
      `INSERT INTO whatsapp_conversations (id, business_id, from_number, to_number, conversation_id, is_group, last_message_at)
       VALUES ($1, $2, $3, '919999900000', $3, true, NOW())`,
      [randomUUID(), B, gp],
    );
    await importLead(src, incoming(gp));
    expect((await leadsFor(gp))[0].conversation_id).toBeNull();
  });

  test('joining an open lead adds the enquiry to its note, and an odd label_ids shape counts as empty', async () => {
    const { src } = await webhookSource('JustDial', { labelIds: [LABEL] });
    const p = phone();
    const { lead } = await openLead(B, { phone: p, note: 'Called twice', actor: { source: 'auto' } });
    await importLead(src, incoming(p, { message: 'Need 20 boxes' }));
    expect((await leadsFor(p))[0].note).toBe('Called twice\nJustDial: Need 20 boxes');

    // The note stays inside its 1000-character limit.
    for (let i = 0; i < 4; i++) await importLead(src, incoming(p, { message: 'x'.repeat(400) }));
    expect((await leadsFor(p))[0].note!.length).toBeLessThanOrEqual(1000);

    // label_ids that is not an array (or a source_detail that is not an object) is replaced, not an error.
    await query(`UPDATE leads SET source_detail = '{"label_ids": "oops"}'::jsonb WHERE id = $1`, [lead.id]);
    await importLead(src, incoming(p));
    expect((await leadsFor(p))[0].source_detail.label_ids).toEqual([LABEL]);
    await query(`UPDATE leads SET source_detail = '"scalar"'::jsonb WHERE id = $1`, [lead.id]);
    await importLead(src, incoming(p));
    expect((await leadsFor(p))[0].source_detail.label_ids).toEqual([LABEL]);
  });

  test('link stats count leads', async () => {
    const link = await createEntryLink(B, AGENT, { name: 'Poster', phone: '9999900000', prefillText: 'Price please' });
    const won = stages.find((s) => s.kind === 'won')!;
    const p = phone();
    const { lead } = await openLead(B, {
      phone: p,
      source: 'link',
      sourceDetail: { link_id: link.id, name: link.name, code: link.code, label_ids: [] },
      actor: { source: 'auto' },
    });
    const stats = async () => (await listEntryLinks(B)).find((l) => l.id === link.id)!;
    expect(await stats()).toMatchObject({ chats: 1, won: 0 });
    await query(`UPDATE leads SET stage_id = $2, closed_at = NOW() WHERE id = $1`, [lead.id, won.id]);
    expect(await stats()).toMatchObject({ chats: 1, won: 1 });
  });
});
