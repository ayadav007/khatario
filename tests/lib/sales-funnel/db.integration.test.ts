/**
 * Runs the funnel's SQL against the disposable test database. Opt-in only:
 *   SALES_FUNNEL_DB_TEST=1 npx jest tests/lib/sales-funnel/db.integration.test.ts
 * Connection details come from .env with the database forced to kh_phase2_test; WhatsApp sends are mocked.
 */
import { config as loadEnv } from 'dotenv';

const TEST_DB = 'kh_phase2_test';
const enabled = process.env.SALES_FUNNEL_DB_TEST === '1';
if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}

const mockSends: string[] = [];
jest.mock('@/lib/meta-whatsapp', () => {
  const actual = jest.requireActual('@/lib/meta-whatsapp');
  const send = (kind: string) => async () => {
    mockSends.push(kind);
    return { messageId: `wamid.test.${kind}.${mockSends.length}` };
  };
  return {
    ...actual,
    isMetaWaConfigured: async () => false,
    sendTextMessage: send('text'),
    sendInteractiveButtons: send('buttons'),
    sendInteractiveList: send('list'),
    sendImageMessage: send('image'),
    sendVideoMessage: send('video'),
    uploadMedia: async () => 'media-test-id',
  };
});

import { getPool, query, queryOne } from '@/lib/db';
import { funnelMetrics, leadDetail, listAdMappings, listPipelineLeads, unmappedAds, upsertAdMapping, deleteAdMapping, adminSetStatus } from '@/lib/sales-funnel/admin';
import { DEFAULT_FLOW } from '@/lib/sales-funnel/default-flow';
import { runDueFollowups, runLifecycleChecks } from '@/lib/sales-funnel/followups';
import { recordFunnelRead } from '@/lib/sales-funnel/receipts';
import { linkSignupToLead } from '@/lib/sales-funnel/signup';
import { applyAttribution, cancelFollowups, getLeadById, scheduleFollowup, setPipelineStatus, upsertInboundLead } from '@/lib/sales-funnel/leads';
import { discardDraft, getDraft, getPublishedFlow, listVersions, saveDraft } from '@/lib/sales-funnel/store';
import { FUNNEL_TEMPLATES, listFunnelTemplates, seedFunnelTemplates } from '@/lib/sales-funnel/templates';

const PHONE = '919800000099';
const AD = 'test_ad_sales_funnel_1';
const run = enabled ? describe : describe.skip;

run('sales funnel SQL on kh_phase2_test', () => {
  let leadId = '';
  let createdTemplates: string[] = [];

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    await query(`DELETE FROM assistant_leads WHERE phone = $1`, ['9800000099']);
  });

  afterAll(async () => {
    if (leadId) await query(`DELETE FROM assistant_leads WHERE id = $1`, [leadId]);
    await query(`DELETE FROM meta_ad_mappings WHERE ad_id = $1`, [AD]);
    if (createdTemplates.length) await query(`DELETE FROM platform_whatsapp_templates WHERE name = ANY($1::text[])`, [createdTemplates]);
    await discardDraft();
    await getPool().end();
  });

  it('creates and attributes a WhatsApp lead', async () => {
    const { lead } = await upsertInboundLead(PHONE, 'Test Lead');
    leadId = lead.id;
    expect(lead.phone).toBe('9800000099');
    expect(lead.flow_data.profile_name).toBe('Test Lead');
    const again = await upsertInboundLead(PHONE, null);
    expect(again.isNew).toBe(false);
    expect(again.lead.id).toBe(leadId);

    await upsertAdMapping({ ad_id: AD, campaign_id: 'c1', campaign_name: 'Test GST campaign', ad_name: 'GST ad', entry_key: 'gst_ad' });
    await applyAttribution(again.lead, { adId: AD, sourceType: 'ad', sourceUrl: null, headline: 'GST billing', ctwaClid: 'clid' });
    const fresh = await getLeadById(leadId);
    expect(fresh?.campaign_name).toBe('Test GST campaign');
    expect((await listAdMappings()).some((m) => m.ad_id === AD)).toBe(true);
    expect((await unmappedAds()).some((u) => u.ad_id === AD)).toBe(false);
  });

  it('moves the pipeline forward only, and lets an admin override', async () => {
    const lead = (await getLeadById(leadId))!;
    expect(await setPipelineStatus(lead, 'demo_interested', 'test')).toBe(true);
    expect(await setPipelineStatus(lead, 'qualified', 'test')).toBe(false);
    const row = await queryOne<{ pipeline_status: string; status: string }>(`SELECT pipeline_status, status FROM assistant_leads WHERE id = $1`, [leadId]);
    expect(row).toEqual({ pipeline_status: 'demo_interested', status: 'contacted' });
    await adminSetStatus(lead, 'qualified', '00000000-0000-4000-8000-000000000000');
    expect((await getLeadById(leadId))?.pipeline_status).toBe('qualified');
  });

  it('schedules each follow-up once and sends due ones inside the window', async () => {
    await getPublishedFlow();
    await scheduleFollowup(leadId, 'nudge_5m', new Date(Date.now() + 60_000));
    await scheduleFollowup(leadId, 'nudge_5m', new Date(Date.now() - 1000));
    const pending = await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM lead_followups WHERE lead_id = $1 AND status = 'pending'`, [leadId]);
    expect(pending?.n).toBe('1');

    await query(`UPDATE assistant_leads SET flow_step = 'business_type', last_inbound_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [leadId]);
    await query(`UPDATE lead_followups SET created_at = NOW() - INTERVAL '10 minutes' WHERE lead_id = $1`, [leadId]);
    mockSends.length = 0;
    const report = await runDueFollowups();
    expect(report.sent).toBeGreaterThanOrEqual(1);
    expect(mockSends).toEqual(['text', 'list']);
    const sent = await queryOne<{ status: string; sent_via: string }>(`SELECT status, sent_via FROM lead_followups WHERE lead_id = $1 AND kind = 'nudge_5m'`, [leadId]);
    expect(sent).toEqual({ status: 'sent', sent_via: 'session' });

    await scheduleFollowup(leadId, 'nudge_5m', new Date());
    const total = await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM lead_followups WHERE lead_id = $1 AND kind = 'nudge_5m'`, [leadId]);
    expect(total?.n).toBe('1');

    await scheduleFollowup(leadId, 'nudge_22h', new Date(Date.now() + 3600_000));
    expect(await cancelFollowups(leadId, ['nudge_22h'])).toBe(1);
  });

  it('runs lifecycle checks and admin reports', async () => {
    await expect(runLifecycleChecks()).resolves.toEqual(expect.objectContaining({ activated: expect.any(Number), converted: expect.any(Number), lost: expect.any(Number) }));
    const list = await listPipelineLeads({ q: '9800000099', campaign: 'Test GST campaign', status: 'qualified' });
    expect(list.leads.map((l) => l.id)).toContain(leadId);
    const metrics = await funnelMetrics(30);
    expect(metrics.rows.some((r) => r.campaign === 'Test GST campaign' && r.leads >= 1)).toBe(true);
    const detail = await leadDetail(leadId);
    expect(detail?.events.some((e) => e.kind === 'attribution')).toBe(true);
    expect(detail?.followups.length).toBeGreaterThan(0);
    expect(await deleteAdMapping(AD)).toBe(true);
  });

  it('records a demo read receipt', async () => {
    await query(`UPDATE assistant_leads SET demo_sent_at = NOW(), last_funnel_message_id = 'wamid.read.1' WHERE id = $1`, [leadId]);
    await recordFunnelRead('wamid.read.1');
    const row = await queryOne<{ demo_read_at: Date | null }>(`SELECT demo_read_at FROM assistant_leads WHERE id = $1`, [leadId]);
    expect(row?.demo_read_at).toBeTruthy();
  });

  it('links a signup to the lead, then activates it on the first invoice', async () => {
    const biz = await queryOne<{ business_id: string; has_invoice: boolean }>(
      `SELECT b.id AS business_id,
              EXISTS (SELECT 1 FROM invoices i WHERE i.business_id = b.id AND i.deleted_at IS NULL
                         AND COALESCE(i.document_type, 'tax_invoice') = 'tax_invoice') AS has_invoice
         FROM businesses b
        WHERE NOT EXISTS (SELECT 1 FROM assistant_leads l WHERE l.business_id = b.id)
        ORDER BY 2 DESC LIMIT 1`,
    );
    if (!biz) throw new Error('kh_phase2_test has no free business to link');
    await linkSignupToLead({ businessId: biz.business_id, phone10: '9800000099', leadId });
    let lead = await getLeadById(leadId);
    expect(lead).toMatchObject({ business_id: biz.business_id, pipeline_status: 'trial_created' });
    expect(lead?.trial_created_at).toBeTruthy();
    const trialFollowups = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM lead_followups WHERE lead_id = $1 AND status = 'pending' AND kind = 'first_invoice_2h'`,
      [leadId],
    );
    expect(trialFollowups?.n).toBe('1');

    await runLifecycleChecks();
    lead = await getLeadById(leadId);
    if (biz.has_invoice) {
      expect(['activated', 'converted']).toContain(lead?.pipeline_status);
      expect(lead?.activated_at).toBeTruthy();
    } else {
      expect(['trial_created', 'converted']).toContain(lead?.pipeline_status);
      expect(lead?.activated_at).toBeNull();
    }

    await linkSignupToLead({ businessId: biz.business_id, phone10: '9800000099', leadId });
    const signups = await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM lead_events WHERE lead_id = $1 AND kind = 'signup'`, [leadId]);
    expect(signups?.n).toBe('1');
  });

  it('saves drafts and seeds templates', async () => {
    const saved = await saveDraft(DEFAULT_FLOW, null);
    expect(saved.ok).toBe(true);
    expect((await getDraft()).flow.steps.length).toBe(DEFAULT_FLOW.steps.length);
    expect((await listVersions()).some((v) => v.status === 'draft')).toBe(true);
    const bad = await saveDraft({ ...DEFAULT_FLOW, defaultEntry: 'missing' }, null);
    expect(bad.ok).toBe(false);

    const seeded = await seedFunnelTemplates(null);
    createdTemplates = seeded.created;
    const templates = await listFunnelTemplates();
    for (const t of FUNNEL_TEMPLATES) expect(templates.some((r) => r.event_key === t.event_key)).toBe(true);
    const reengage = templates.find((t) => t.name === 'khatario_funnel_reengage_v1');
    if (reengage && createdTemplates.includes(reengage.name)) {
      expect(reengage).toMatchObject({ header_format: 'image', header_media_key: 'sales_list', status: 'draft' });
    }
  });
});
