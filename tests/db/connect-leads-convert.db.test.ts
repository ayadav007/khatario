/**
 * Connect leads convert + auto-won (lib/leads/convert.ts and the leads_auto_won trigger on invoices and
 * sales orders). Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/connect-leads-convert.db.test.ts --runInBand
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
import { ensureStages, type DealActor, type PipelineStage } from '@/lib/whatsapp/pipeline';
import { getInboxViewer, type InboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { LeadError, loadLead, openLead } from '@/lib/leads/core';
import { findCustomerForLead, linkLeadToCustomer } from '@/lib/leads/convert';
import { describeStageEvent } from '@/lib/leads/timeline';
import { cleanupBusinesses, seedBusiness, seedChat } from './fixtures/connect-leads';

const run = enabled ? describe : describe.skip;

run('connect leads convert and auto-won (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const auto: DealActor = { source: 'auto' };
  let B: string;
  let OTHER: string;
  let supervisor: InboxViewer;
  let stages: PipelineStage[];
  let branchId: string;
  let seq = 0;
  const stage = (name: string) => stages.find((s) => s.name === name)!;

  async function code(p: Promise<unknown>): Promise<string> {
    try {
      await p;
      return 'ok';
    } catch (e) {
      if (e instanceof LeadError) return e.code;
      throw e;
    }
  }

  async function customer(businessId: string, phone: string, name = 'Cust', active = true): Promise<string> {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO customers (business_id, name, phone, is_active) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
      [businessId, name, phone, active],
    );
    return row!.id;
  }

  async function invoice(customerId: string | null, o: { status?: string; type?: string | null; date?: string; number?: string } = {}) {
    seq += 1;
    const number = o.number ?? `INV-T${seq}`;
    await query(
      `INSERT INTO invoices (business_id, customer_id, invoice_number, invoice_date, status, document_type, branch_id)
       VALUES ($1, $2, $3, COALESCE($4::date, (NOW() AT TIME ZONE 'Asia/Kolkata')::date), $5, $6, $7)`,
      [B, customerId, number, o.date ?? null, o.status ?? 'final', o.type === undefined ? 'tax_invoice' : o.type, branchId],
    );
    return number;
  }

  async function salesOrder(customerId: string, status: string, date?: string) {
    seq += 1;
    const number = `SO-T${seq}`;
    await query(
      `INSERT INTO sales_orders (business_id, customer_id, order_number, order_date, status, subtotal, grand_total)
       VALUES ($1, $2, $3, COALESCE($4::date, (NOW() AT TIME ZONE 'Asia/Kolkata')::date), $5, 100, 100)`,
      [B, customerId, number, date ?? null, status],
    );
    return number;
  }

  /** An open lead with a chat for the phone, opened now. */
  async function lead(phone: string) {
    const chat = await seedChat(B, { phone });
    const { lead: l } = await openLead(B, { phone, actor: auto, conversationId: chat.id });
    return l;
  }

  async function wonEvents(leadId: string) {
    return queryRows<{ event_data: Record<string, unknown>; conversation_id: string | null }>(
      `SELECT event_data, conversation_id::text AS conversation_id FROM whatsapp_automation_events
        WHERE lead_id = $1::uuid AND event_type = 'stage_changed' AND event_data ? 'reference'`,
      [leadId],
    );
  }

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const t = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_trigger WHERE tgname = 'invoices_leads_auto_won' AND NOT tgisinternal`,
    );
    if (!t?.n) throw new Error('Apply migration 447 (with the leads_auto_won trigger) to kh_phase2_test first');

    const seeded = await seedBusiness('convert');
    B = seeded.businessId;
    OTHER = (await seedBusiness('convert-other')).businessId;
    stages = await ensureStages(B);
    supervisor = await getInboxViewer({ businessId: B, userId: seeded.supervisorId });
    const br = await queryOne<{ id: string }>(
      `INSERT INTO branches (business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, 'Main', '27', true, true, true) RETURNING id::text AS id`,
      [B],
    );
    branchId = br!.id;
  });

  afterAll(async () => {
    try {
      const ids = [B, OTHER].filter(Boolean);
      if (ids.length) {
        await query(`DELETE FROM invoices WHERE business_id = ANY($1::uuid[])`, [ids]);
        await query(`DELETE FROM sales_orders WHERE business_id = ANY($1::uuid[])`, [ids]);
        await query(`DELETE FROM branches WHERE business_id = ANY($1::uuid[])`, [ids]);
      }
      await cleanupBusinesses(ids);
    } finally {
      await closePool();
    }
  });

  test('finds a customer by phone and links lead and chat', async () => {
    // The lead opens first, so it is a new lead; the customer arrives afterwards.
    const l = await lead('919876500010');
    const cust = await customer(B, '098765 00010', 'Phone Match');
    expect(await findCustomerForLead(B, l.id)).toEqual({ id: cust, name: 'Phone Match' });

    const linked = await linkLeadToCustomer(supervisor, l.id, cust);
    expect(linked.customer_id).toBe(cust);
    expect(linked.lead_type).toBe('new');
    const chat = await queryOne<{ customer_id: string | null }>(
      `SELECT customer_id::text AS customer_id FROM whatsapp_conversations WHERE id = $1`,
      [l.conversation_id],
    );
    expect(chat?.customer_id).toBe(cust);
    expect((await loadLead(B, l.id))!.customer_id).toBe(cust);
  });

  test('a deleted or inactive customer is not matched or linked', async () => {
    const gone = await customer(B, '98765 00011', 'Gone');
    await query(`UPDATE customers SET deleted_at = NOW() WHERE id = $1`, [gone]);
    const off = await customer(B, '98765 00011', 'Off', false);
    const l = await lead('919876500011');
    expect(await findCustomerForLead(B, l.id)).toBeNull();
    expect(await code(linkLeadToCustomer(supervisor, l.id, gone))).toBe('CUSTOMER_NOT_FOUND');
    expect(await code(linkLeadToCustomer(supervisor, l.id, off))).toBe('CUSTOMER_NOT_FOUND');
  });

  test('refuses another business customer and an unknown lead', async () => {
    const theirs = await customer(OTHER, '98765 00012');
    const l = await lead('919876500012');
    expect(await code(linkLeadToCustomer(supervisor, l.id, theirs))).toBe('CUSTOMER_NOT_FOUND');
    const mine = await customer(B, '98765 00012');
    expect(await code(linkLeadToCustomer(supervisor, randomUUID(), mine))).toBe('NOT_FOUND');
  });

  test('a final invoice after the lead opened wins it', async () => {
    const cust = await customer(B, '98765 00020');
    const l = await lead('919876500020');
    await linkLeadToCustomer(supervisor, l.id, cust);
    await invoice(cust, { number: 'INV-0123' });

    const after = (await loadLead(B, l.id))!;
    expect(after.stage_id).toBe(stage('Won').id);
    expect(after.closed_at).not.toBeNull();
    const events = await wonEvents(l.id);
    expect(events.length).toBe(1);
    expect(describeStageEvent(events[0].event_data)).toBe('Won: INV-0123');
    expect(events[0].event_data).toMatchObject({ to_stage: 'Won', source: 'auto', reference: 'INV-0123', lead_id: l.id });
    expect(events[0].conversation_id).toBe(l.conversation_id);
    const chat = await queryOne<{ lead_status: string }>(`SELECT lead_status FROM whatsapp_conversations WHERE id = $1`, [l.conversation_id]);
    expect(chat?.lead_status).toBe('converted');

    // Another invoice does not move or re-log a closed lead.
    await invoice(cust);
    expect((await wonEvents(l.id)).length).toBe(1);
  });

  test('an invoice dated before the lead opened, a draft or a quotation does nothing', async () => {
    const cust = await customer(B, '98765 00030');
    const l = await lead('919876500030');
    await linkLeadToCustomer(supervisor, l.id, cust);
    await invoice(cust, { date: '2020-01-01' });
    await invoice(cust, { status: 'draft' });
    await invoice(cust, { type: 'quotation' });
    await invoice(cust, { type: 'proforma_invoice' });
    await invoice(cust, { status: 'cancelled' });
    await invoice(null);
    const same = (await loadLead(B, l.id))!;
    expect(same.closed_at).toBeNull();
    expect(same.stage_id).toBe(l.stage_id);

    // A draft that is finalised later does win it.
    const number = await invoice(cust, { status: 'draft' });
    await query(`UPDATE invoices SET status = 'final' WHERE business_id = $1 AND invoice_number = $2`, [B, number]);
    expect((await loadLead(B, l.id))!.stage_id).toBe(stage('Won').id);
  });

  test('a soft-deleted invoice or one for another customer does nothing', async () => {
    const cust = await customer(B, '98765 00040');
    const other = await customer(B, '98765 00041');
    const l = await lead('919876500040');
    await linkLeadToCustomer(supervisor, l.id, cust);
    await query(
      `INSERT INTO invoices (business_id, customer_id, invoice_number, invoice_date, status, document_type, branch_id, deleted_at)
       VALUES ($1, $2, 'INV-DEL', CURRENT_DATE, 'final', 'tax_invoice', $3, NOW())`,
      [B, cust, branchId],
    );
    await invoice(other);
    expect((await loadLead(B, l.id))!.closed_at).toBeNull();
    const number = await invoice(cust);
    expect((await wonEvents(l.id)).map((e) => e.event_data.reference)).toEqual([number]);
  });

  test('a confirmed sales order wins it; a draft does not', async () => {
    const cust = await customer(B, '98765 00050');
    const l = await lead('919876500050');
    await linkLeadToCustomer(supervisor, l.id, cust);
    await salesOrder(cust, 'draft');
    await salesOrder(cust, 'cancelled');
    expect((await loadLead(B, l.id))!.closed_at).toBeNull();
    const so = await salesOrder(cust, 'confirmed');
    const after = (await loadLead(B, l.id))!;
    expect(after.stage_id).toBe(stage('Won').id);
    expect(after.closed_at).not.toBeNull();
    expect(describeStageEvent((await wonEvents(l.id))[0].event_data)).toBe(`Won: ${so}`);
  });

  test('an invoice still saves when the business has no won stage', async () => {
    const cust = await customer(B, '98765 00060');
    const l = await lead('919876500060');
    await linkLeadToCustomer(supervisor, l.id, cust);
    const wonStages = stages.filter((s) => s.kind === 'won');
    const wonIds = wonStages.map((s) => s.id);
    // Take every won stage away (leads parked on one move to New first).
    await query(`UPDATE leads SET stage_id = $2 WHERE business_id = $1 AND stage_id = ANY($3::uuid[])`, [B, stage('New').id, wonIds]);
    await query(`DELETE FROM whatsapp_pipeline_stages WHERE id = ANY($1::uuid[])`, [wonIds]);
    try {
      await expect(invoice(cust)).resolves.toBeTruthy();
      const same = (await loadLead(B, l.id))!;
      expect(same.closed_at).toBeNull();
      expect(same.stage_id).toBe(l.stage_id);
    } finally {
      // ensureStages does not recreate a missing stage, so put the deleted ones back as they were.
      for (const s of wonStages) {
        await query(
          `INSERT INTO whatsapp_pipeline_stages (id, business_id, name, color, position, kind, legacy_key) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [s.id, B, s.name, s.color, s.position, s.kind, s.legacy_key],
        );
      }
      stages = await ensureStages(B);
      expect(stages.some((s) => s.kind === 'won')).toBe(true);
    }
  });

  test('an invoice still saves when the lead update itself fails', async () => {
    const cust = await customer(B, '98765 00070');
    const l = await lead('919876500070');
    await linkLeadToCustomer(supervisor, l.id, cust);
    // A trigger that fails only for this business, so other sessions on the test DB are untouched.
    await query(`CREATE OR REPLACE FUNCTION tmp_leads_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql`);
    await query(`DROP TRIGGER IF EXISTS tmp_leads_fail ON leads`);
    await query(`CREATE TRIGGER tmp_leads_fail BEFORE UPDATE ON leads FOR EACH ROW WHEN (OLD.business_id = '${B}'::uuid) EXECUTE FUNCTION tmp_leads_fail()`);
    let failedNumber: string;
    try {
      failedNumber = await invoice(cust);
      expect((await loadLead(B, l.id))!.closed_at).toBeNull();
    } finally {
      await query(`DROP TRIGGER IF EXISTS tmp_leads_fail ON leads`);
      await query(`DROP FUNCTION IF EXISTS tmp_leads_fail()`);
    }
    // The trigger did reach the lead update: once the failure is gone, the next qualifying invoice wins the lead.
    const next = await invoice(cust);
    expect((await loadLead(B, l.id))!.stage_id).toBe(stage('Won').id);
    expect((await wonEvents(l.id)).map((e) => e.event_data.reference)).toEqual([next]);
    expect(failedNumber).not.toBe(next);
  });
});
