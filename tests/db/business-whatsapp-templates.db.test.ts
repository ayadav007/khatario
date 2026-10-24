/**
 * Real-PostgreSQL tests for per-business WhatsApp templates (migration 352): drafts, Meta sync,
 * event mapping rules, webhook status updates and tenant isolation. Runs only when
 * PHASE2_TEST_DATABASE_URL points at a disposable database with migration 352 applied.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

const listMessageTemplates = jest.fn();
const createMessageTemplate = jest.fn();
jest.mock('@/lib/meta-whatsapp', () => ({
  ...jest.requireActual('@/lib/meta-whatsapp'),
  listMessageTemplates: (...a: unknown[]) => listMessageTemplates(...a),
  createMessageTemplate: (...a: unknown[]) => createMessageTemplate(...a),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import {
  applyBusinessTemplateWebhook,
  createBusinessTemplateDraft,
  listBusinessTemplates,
  listEventMappings,
  resolveEventTemplate,
  setEventMapping,
  submitBusinessTemplate,
  syncBusinessTemplates,
  TenantTemplateError,
} from '@/lib/whatsapp/tenant-templates';

d('business WhatsApp templates (real DB)', () => {
  jest.setTimeout(60000);
  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const tag = A.slice(0, 8);

  beforeAll(async () => {
    pool = getPool();
    for (const [biz, name] of [[A, 'A'], [B, 'B']] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz, `WA templates ${name} ${tag}`],
      );
    }
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[A, B]]);
        });
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    } finally {
      await closePool();
    }
  });

  it('creates a draft, rejects duplicates and bad bodies', async () => {
    const t = await createBusinessTemplateDraft(A, null, {
      name: 'Order Paid!',
      category: 'UTILITY',
      body_text: 'Hi {{1}}, order {{2}} is paid. Thanks.',
      example_vars: ['Priya', 'SO-1'],
    });
    expect(t).toMatchObject({ name: 'order_paid', status: 'draft', placeholder_count: 2, source: 'khatario' });
    await expect(
      createBusinessTemplateDraft(A, null, { name: 'order_paid', category: 'UTILITY', body_text: 'Hello there.' }),
    ).rejects.toBeInstanceOf(TenantTemplateError);
    await expect(
      createBusinessTemplateDraft(A, null, { name: 'x_end', category: 'UTILITY', body_text: 'Your code is {{1}}' }),
    ).rejects.toThrow(/start or end/);
  });

  it('submits to Meta and stores the template id and status', async () => {
    const [draft] = await listBusinessTemplates(A);
    createMessageTemplate.mockResolvedValueOnce({ id: 'meta-1', status: 'PENDING' });
    const submitted = await submitBusinessTemplate(A, draft.id);
    expect(submitted).toMatchObject({ status: 'pending', meta_template_id: 'meta-1' });
    expect(createMessageTemplate).toHaveBeenCalledWith(expect.objectContaining({ businessId: A, name: 'order_paid' }));
  });

  it('syncs templates from Meta, parsing header, body and placeholders', async () => {
    listMessageTemplates.mockResolvedValueOnce([
      {
        id: 'meta-2',
        name: 'invoice_doc',
        status: 'APPROVED',
        language: 'en',
        category: 'UTILITY',
        components: [
          { type: 'HEADER', format: 'DOCUMENT' },
          { type: 'BODY', text: 'Dear {{1}}, invoice {{2}} for {{3}} is attached.' },
        ],
      },
      { id: 'meta-1', name: 'order_paid', status: 'APPROVED', language: 'en_US', category: 'UTILITY', components: [] },
    ]);
    const all = await syncBusinessTemplates(A);
    const doc = all.find((t) => t.name === 'invoice_doc')!;
    expect(doc).toMatchObject({ source: 'meta', header_format: 'document', placeholder_count: 3, status: 'approved' });
    // A template made in Khatario keeps its source when Meta reports on it.
    expect(all.find((t) => t.name === 'order_paid')).toMatchObject({ source: 'khatario', status: 'approved' });
    expect(await listBusinessTemplates(B)).toHaveLength(0);
  });

  it('validates mappings and resolves only approved templates', async () => {
    const all = await listBusinessTemplates(A);
    const doc = all.find((t) => t.name === 'invoice_doc')!;

    await expect(setEventMapping(A, null, 'invoice_sent', doc.id, ['customer_name'])).rejects.toThrow(/3 placeholders/);
    await expect(
      setEventMapping(A, null, 'invoice_sent', doc.id, ['customer_name', 'order_number', 'amount']),
    ).rejects.toThrow(/not available/);
    await expect(setEventMapping(A, null, 'store_otp', doc.id, [])).rejects.toThrow(/authentication/);
    // Business B cannot point an event at business A's template.
    await expect(setEventMapping(B, null, 'invoice_sent', doc.id, ['customer_name', 'invoice_number', 'amount'])).rejects.toThrow(
      /not found/i,
    );

    await setEventMapping(A, null, 'invoice_sent', doc.id, ['customer_name', 'invoice_number', 'amount']);
    expect(await listEventMappings(A)).toEqual([
      expect.objectContaining({ event_key: 'invoice_sent', variable_map: ['customer_name', 'invoice_number', 'amount'] }),
    ]);
    expect((await resolveEventTemplate(A, 'invoice_sent'))?.template.name).toBe('invoice_doc');
    expect(await resolveEventTemplate(B, 'invoice_sent')).toBeNull();

    await applyBusinessTemplateWebhook(A, { event: 'PAUSED', message_template_id: 'meta-2' });
    expect(await resolveEventTemplate(A, 'invoice_sent')).toBeNull();
    await applyBusinessTemplateWebhook(A, { event: 'APPROVED', message_template_name: 'invoice_doc', message_template_language: 'en' });
    expect((await resolveEventTemplate(A, 'invoice_sent'))?.variableMap).toEqual(['customer_name', 'invoice_number', 'amount']);

    await setEventMapping(A, null, 'invoice_sent', null, []);
    expect(await listEventMappings(A)).toEqual([]);
  });
});
