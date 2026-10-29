/**
 * Connect lead sources (migration 419): ad referrals, tracked links, inbound webhook and IndiaMART
 * pulls (with a fake IndiaMART), first-touch attribution and routing onto the pipeline.
 * Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/whatsapp-lead-sources.db.test.ts --runInBand
 * Migrations 362, 418 and 419 must be applied to kh_phase2_test.
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
process.env.SECRETS_ENCRYPTION_KEY = process.env.SECRETS_ENCRYPTION_KEY || 'a'.repeat(64);

jest.mock('@/lib/whatsapp-websocket', () => ({ emitConversationUpdate: jest.fn() }));
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { query, queryOne, closePool } from '@/lib/db';
import { ensureStages, loadPipelineSummary } from '@/lib/whatsapp/pipeline';
import {
  applyAdReferral,
  attributeNewChat,
  createEntryLink,
  createWebhookSource,
  extractRefCode,
  indiaMartTime,
  LeadSourceError,
  linkMessage,
  normalizeLeadPhone,
  openEntryLink,
  parseIndiaMartResponse,
  receiveWebhookLead,
  saveIndiaMartSource,
  syncIndiaMart,
  updateEntryLink,
} from '@/lib/whatsapp/lead-sources';

describe('lead source helpers', () => {
  test('ref codes, phones and IndiaMART times', () => {
    expect(extractRefCode('Hi! I want rates (ref K7Q2MX)')).toBe('K7Q2MX');
    expect(extractRefCode('hello ref:k7q2mx thanks')).toBe('K7Q2MX');
    expect(extractRefCode('reference letter')).toBeNull();
    expect(normalizeLeadPhone('+91-98765 43210')).toBe('919876543210');
    expect(normalizeLeadPhone('09876543210')).toBe('919876543210');
    expect(normalizeLeadPhone('12345')).toBeNull();
    expect(indiaMartTime(new Date('2026-10-26T08:30:00Z'))).toBe('26-Oct-2026 14:00:00');
    expect(linkMessage({ prefill_text: '', code: 'ABC234' })).toBe('Hi! I would like to know more. (ref ABC234)');
  });

  test('IndiaMART response parsing', () => {
    expect(parseIndiaMartResponse({ CODE: 204, MESSAGE: 'no leads' })).toMatchObject({ ok: true, leads: [] });
    expect(parseIndiaMartResponse({ CODE: 429, MESSAGE: 'Too frequent' })).toMatchObject({ ok: false, message: 'Too frequent' });
    const r = parseIndiaMartResponse({
      CODE: 200,
      RESPONSE: [
        { UNIQUE_QUERY_ID: 'Q1', SENDER_NAME: 'Ravi', SENDER_MOBILE: '+91-9876500001', QUERY_MESSAGE: 'Need 20 boxes<br>urgent', QUERY_PRODUCT_NAME: 'Cartons' },
        { UNIQUE_QUERY_ID: 'Q2', SENDER_NAME: 'No phone' },
      ],
    });
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]).toMatchObject({ externalId: 'Q1', phone: '919876500001', message: 'Need 20 boxes\nurgent' });
    expect(r.leads[0].detail.product).toBe('Cartons');
  });
});

const run = enabled ? describe : describe.skip;

run('Connect lead sources (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const B = randomUUID();
  const OTHER = randomUUID();
  const ASHA = randomUUID();
  const ROLE = randomUUID();
  const tag = B.slice(0, 6);
  let seq = 0;

  async function newChat(business = B): Promise<string> {
    const id = randomUUID();
    const phone = `91${String(Date.now()).slice(-6)}${String(++seq).padStart(4, '0')}`;
    await query(
      `INSERT INTO whatsapp_conversations (id, business_id, from_number, to_number, conversation_id, last_message_at, last_message_direction)
       VALUES ($1, $2, $3, '919999900000', $3, NOW(), 'incoming')`,
      [id, business, phone],
    );
    return id;
  }

  async function chat(id: string) {
    return queryOne<{ source: string | null; source_detail: any; stage_name: string | null; assigned_to: string | null; inbox_state: string }>(
      `SELECT c.source, c.source_detail, s.name AS stage_name, c.assigned_to::text AS assigned_to, c.inbox_state
         FROM whatsapp_conversations c
         LEFT JOIN leads l ON l.conversation_id = c.id AND l.closed_at IS NULL
         LEFT JOIN whatsapp_pipeline_stages s ON s.id = l.stage_id
        WHERE c.id = $1`,
      [id],
    );
  }

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const t = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'whatsapp_entry_links'`);
    if (!t?.n) throw new Error('Apply migration 419 to kh_phase2_test first');
    for (const [id, name] of [[B, `Leads ${tag}`], [OTHER, `Other ${tag}`]]) {
      await query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [id, name],
      );
    }
    await query(`INSERT INTO user_roles (id, business_id, role_name, role_key) VALUES ($1, $2, 'Agent', 'lsagent_${tag}')`, [ROLE, B]);
    await query(`INSERT INTO role_permissions (role_id, module_key, can_view) VALUES ($1, 'whatsapp_inbox', true)`, [ROLE]);
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, role_id, is_active) VALUES ($1, $2, 'Asha', $3, false, $4, true)`,
      [ASHA, B, `6${String(Date.now()).slice(-9)}`, ROLE],
    );
  });

  afterAll(async () => {
    try {
      await query(`DELETE FROM whatsapp_lead_sources WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]);
      await query(`DELETE FROM whatsapp_entry_links WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]);
      await query(`DELETE FROM leads WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]);
      await query(`DELETE FROM notifications WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]).catch(() => undefined);
      await query(`DELETE FROM whatsapp_conversations WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]);
      await query(`DELETE FROM whatsapp_pipeline_stages WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]);
      await query(`DELETE FROM users WHERE business_id = $1`, [B]);
      await query(`DELETE FROM user_roles WHERE business_id = $1`, [B]);
      await query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER]]);
    } finally {
      await closePool();
    }
  });

  test('ad referral: first touch only, lands in the first open stage', async () => {
    const c = await newChat();
    await applyAdReferral(B, c, { sourceId: 'AD1', sourceType: 'ad', sourceUrl: 'https://fb.me/x', headline: 'Diwali sale', ctwaClid: 'clid1' });
    await applyAdReferral(B, c, { sourceId: 'AD2', sourceType: 'ad', sourceUrl: null, headline: 'Second ad', ctwaClid: null });
    const row = await chat(c);
    expect(row).toMatchObject({ source: 'ctwa_ad', stage_name: 'New' });
    expect(row?.source_detail).toMatchObject({ ad_id: 'AD1', headline: 'Diwali sale', ctwa_clid: 'clid1' });
  });

  test('tracked link: counts clicks, credits the chat and applies its routing; codes are per business', async () => {
    const stages = await ensureStages(B);
    const interested = stages.find((s) => s.name === 'Interested')!;
    const link = await createEntryLink(B, ASHA, { name: 'Poster', phone: '9999900000', prefillText: 'Price list please', stageId: interested.id, assignTo: ASHA });
    expect(link.phone).toBe('919999900000');
    expect(link.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    const target = await openEntryLink(link.code.toLowerCase(), 'qr');
    expect(target).toBe(`https://wa.me/919999900000?text=${encodeURIComponent(`Price list please (ref ${link.code})`)}`);

    const c = await newChat();
    await attributeNewChat(B, c, `Price list please (ref ${link.code})`);
    expect(await chat(c)).toMatchObject({ source: 'link', stage_name: 'Interested', assigned_to: ASHA, inbox_state: 'intervened' });

    // Another business's chat quoting this code is not credited.
    const foreign = await newChat(OTHER);
    await attributeNewChat(OTHER, foreign, `hi (ref ${link.code})`);
    expect((await chat(foreign))?.source).toBeNull();

    // Routing must use this business's own stage and agents.
    const otherStage = (await ensureStages(OTHER))[0];
    await expect(createEntryLink(B, ASHA, { name: 'X', phone: '9999900000', stageId: otherStage.id })).rejects.toBeInstanceOf(LeadSourceError);

    await updateEntryLink(B, link.id, { archived: true });
    expect(await openEntryLink(link.code, 'link')).toBeNull();
    const counts = await queryOne<{ clicks: number; qr_scans: number }>(`SELECT clicks, qr_scans FROM whatsapp_entry_links WHERE id = $1`, [link.id]);
    expect(counts).toEqual({ clicks: 0, qr_scans: 1 });
  });

  test('webhook: token picks the business, repeats are dropped, a later message joins the same chat', async () => {
    const { token } = await createWebhookSource(B, ASHA, { name: 'JustDial' });
    await expect(receiveWebhookLead('x'.repeat(30), { phone: '9876511111' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(receiveWebhookLead(token, { name: 'No phone' })).rejects.toMatchObject({ code: 'PHONE_REQUIRED' });

    const first = await receiveWebhookLead(token, { mobile: '98765 11111', full_name: 'Kiran', requirement: 'Need 50 kg', id: 'JD-1', business_id: OTHER });
    expect(first.duplicate).toBe(false);
    const again = await receiveWebhookLead(token, { phone: '9876511111', id: 'JD-1' });
    expect(again).toEqual({ conversationId: first.conversationId, duplicate: true });

    const row = await queryOne<{ business_id: string; from_number: string; whatsapp_display_name: string; source: string; inbox_state: string }>(
      `SELECT business_id::text AS business_id, from_number, whatsapp_display_name, source, inbox_state FROM whatsapp_conversations WHERE id = $1`,
      [first.conversationId],
    );
    expect(row).toEqual({ business_id: B, from_number: '919876511111', whatsapp_display_name: 'Kiran', source: 'lead_api', inbox_state: 'requesting' });
    const field = await queryOne<{ field_value: string }>(
      `SELECT field_value FROM whatsapp_conversation_custom_fields WHERE conversation_id = $1 AND field_key = 'lead_api_enquiry'`,
      [first.conversationId],
    );
    expect(field?.field_value).toBe('Need 50 kg');

    // A second lead for an existing chat keeps that chat (and its first-touch source).
    const second = await receiveWebhookLead(token, { phone: '+919876511111', message: 'Any update?', id: 'JD-2' });
    expect(second.conversationId).toBe(first.conversationId);
  });

  test('IndiaMART: pulls a window, imports once, records errors and honours the 5-minute limit', async () => {
    await expect(syncIndiaMart(B)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await saveIndiaMartSource(B, ASHA, { key: 'MOCKKEY1234567890ABCDEFG' });
    const stored = await queryOne<{ encrypted_key: string }>(`SELECT encrypted_key FROM whatsapp_lead_sources WHERE business_id = $1 AND kind = 'indiamart'`, [B]);
    expect(stored?.encrypted_key).not.toContain('MOCKKEY');

    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      return {
        json: async () => ({
          CODE: 200,
          RESPONSE: [{ UNIQUE_QUERY_ID: 'IM-1', SENDER_NAME: 'Mehul', SENDER_MOBILE: '+91-9876522222', SUBJECT: 'Requirement for boxes', QUERY_PRODUCT_NAME: 'Boxes' }],
        }),
      };
    };
    const t0 = new Date('2026-10-26T10:00:00Z');
    const r1 = await syncIndiaMart(B, { fetcher, now: t0 });
    expect(r1).toMatchObject({ fetched: 1, imported: 1, duplicates: 0 });
    expect(urls[0]).toContain('glusr_crm_key=MOCKKEY1234567890ABCDEFG');
    expect(decodeURIComponent(urls[0])).toContain('end_time=26-Oct-2026 15:30:00');

    await expect(syncIndiaMart(B, { fetcher, now: new Date(t0.getTime() + 60_000) })).rejects.toMatchObject({ code: 'TOO_SOON' });

    const r2 = await syncIndiaMart(B, { fetcher, now: new Date(t0.getTime() + 6 * 60_000) });
    expect(r2).toMatchObject({ imported: 0, duplicates: 1 });
    // The next window starts where the last one ended.
    expect(decodeURIComponent(urls[1])).toContain('start_time=26-Oct-2026 15:30:00');

    const failing = async () => ({ json: async () => ({ CODE: 401, MESSAGE: 'Invalid key' }) });
    const r3 = await syncIndiaMart(B, { fetcher: failing, now: new Date(t0.getTime() + 12 * 60_000) });
    expect(r3.error).toBe('Invalid key');
    const src = await queryOne<{ last_error: string }>(`SELECT last_error FROM whatsapp_lead_sources WHERE business_id = $1 AND kind = 'indiamart'`, [B]);
    expect(src?.last_error).toBe('Invalid key');

    const lead = await queryOne<{ source: string; source_detail: any }>(
      `SELECT source, source_detail FROM whatsapp_conversations WHERE business_id = $1 AND from_number = '919876522222'`,
      [B],
    );
    expect(lead).toMatchObject({ source: 'indiamart', source_detail: { query_id: 'IM-1', product: 'Boxes' } });
  });

  test('dashboard: chats and wins by source', async () => {
    const sum = await loadPipelineSummary(B, 30);
    const bySource = Object.fromEntries(sum.by_source.map((r) => [r.source, r]));
    expect(bySource.ctwa_ad?.leads).toBeGreaterThanOrEqual(1);
    expect(bySource.link?.on_board).toBeGreaterThanOrEqual(1);
    expect(bySource.indiamart?.leads).toBe(1);
    expect(bySource.lead_api?.leads).toBe(1);
  });
});
