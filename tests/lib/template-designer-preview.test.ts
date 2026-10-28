/**
 * The template designer's preview: sample data or the business's latest real document, with the
 * unsaved template and settings, and the click-to-edit script only on screen, never in print.
 */
import fs from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const BIZ = '11111111-1111-4111-8111-111111111111';

const state: { latest: Row | null; doc: Row | null; items: Row[]; assignment: Row | null; sql: string[]; params: unknown[][] } = {
  latest: null, doc: null, items: [], assignment: null, sql: [], params: [],
};

jest.mock('@/lib/db', () => ({
  queryOne: jest.fn(async (sql: string, params: unknown[]) => {
    state.sql.push(sql);
    state.params.push(params);
    if (/SELECT id FROM invoices WHERE business_id/.test(sql)) return state.latest;
    if (/FROM business_template_assignments/.test(sql)) return state.assignment;
    if (/JOIN businesses b/.test(sql)) return state.doc;
    return null;
  }),
  queryRows: jest.fn(async (sql: string) => (/WHERE ii\./.test(sql) ? state.items.map((i) => ({ ...i })) : [])),
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
}));
jest.mock('@/lib/schema-columns', () => ({ hasTableColumn: jest.fn(async () => true) }));
jest.mock('puppeteer', () => ({}));
jest.mock('@/lib/puppeteer-launch', () => ({ getPuppeteerLaunchOptions: () => ({}) }));
jest.mock('@/lib/print-branding', () => ({ maybeAppendKhatarioPrintFooter: async (html: string) => html }));
jest.mock('@/lib/custom-fields-persist', () => ({ fetchDefinitionsForBusiness: jest.fn(async () => []) }));
const access = { ok: true as boolean, status: 403 };
jest.mock('@/lib/document-access', () => ({
  requireDocumentReadAccess: jest.fn(async () =>
    access.ok
      ? { ok: true, table: 'invoices', businessId: BIZ, userId: 'u1' }
      : { ok: false, response: { status: access.status } },
  ),
}));

import { renderDesignerPreview } from '@/lib/template-designer-preview';
import { findLatestDocumentId, injectPreviewBridge, PREVIEW_SECTIONS } from '@/lib/template-preview-source';
import { getSampleData } from '@/lib/template-preview-sample';
import { generateDocumentHtml, finalizePrintHtml } from '@/lib/pdf-generator';
import { registerGlobalInvoiceHandlebarsHelpers } from '@/lib/handlebars-invoice-helpers';
import { thumbnailCacheKey } from '@/lib/template-thumbnail-cache';
import { TEMPLATE_PREVIEW_PATHS } from '@/lib/template-preview-render';

const request = {} as NextRequest;

const invoiceRow: Row = {
  id: 'inv-9', business_id: BIZ, business_name: 'Shree Ganesh Traders', business_gstin: '27AAACG1234F1Z5',
  business_state: 'Maharashtra', business_state_code: '27',
  customer_name: 'Real Customer Pvt Ltd', customer_gstin: '27BBBPM5678K1Z2', customer_state_code: '27',
  document_type: 'tax_invoice', status: 'final', invoice_number: 'SGT/26-27/0142', invoice_date: '2026-10-20',
  place_of_supply_state_code: '27', subtotal: 1000, cgst_total: 90, sgst_total: 90, tax_total: 180, grand_total: 1180,
};
const items: Row[] = [{ id: 'i1', item_name: 'Toor Dal (Loose)', hsn_sac: '07136000', quantity: 10, unit: 'KGS',
  unit_price: 100, tax_rate: 18, taxable_value: 1000, tax_amount: 180, cgst_amount: 90, sgst_amount: 90, line_total: 1180 }];

beforeAll(() => {
  registerGlobalInvoiceHandlebarsHelpers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  state.latest = null; state.doc = null; state.items = []; state.sql = []; state.params = [];
  state.assignment = { template_id: 'gst_standard', settings: {} };
  access.ok = true;
});

const render = (over: Partial<Parameters<typeof renderDesignerPreview>[0]> = {}) =>
  renderDesignerPreview({
    request, businessId: BIZ, templateId: 'modern', settings: { primary_color: '#065f46' },
    source: 'sample', documentType: 'tax_invoice', forPrint: false, getSampleData, ...over,
  });

describe('designer preview', () => {
  it('fills the sample with the unsaved settings and adds the click-to-edit script', async () => {
    const r = await render();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain('#065f46');
    expect(r.html).toContain('data-kh-preview-bridge');
    expect(r.html).toMatch(/data-kh-section="items"/);
  });

  it('leaves the script out of a print render', async () => {
    const r = await render({ forPrint: true });
    expect(r.ok && r.html.includes('data-kh-preview-bridge')).toBe(false);
  });

  it('says there is no document when the business has none of that type', async () => {
    const r = await render({ source: 'last_document' });
    expect(r).toEqual({ ok: false, status: 404, error: 'no_document' });
  });

  it('renders the latest real invoice with the chosen template, not the saved one', async () => {
    state.latest = { id: 'inv-9' };
    state.doc = invoiceRow;
    state.items = items;
    const r = await render({ source: 'last_document' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.templateId).toBe('modern');
    expect(r.documentNumber).toBe('SGT/26-27/0142');
    expect(r.html).toContain('Real Customer Pvt Ltd');
    expect(r.html).toContain('header-bg'); // modern's header, though gst_standard is the saved template
    expect(r.html).toContain('#065f46');
    expect(r.html).toContain('data-kh-preview-bridge');
  });

  it('refuses the real invoice when the user cannot read invoices', async () => {
    state.latest = { id: 'inv-9' };
    access.ok = false;
    const r = await render({ source: 'last_document' });
    expect(r).toEqual({ ok: false, status: 403, error: 'forbidden' });
  });
});

describe('latest document lookup', () => {
  it('scopes to the business, skips deleted rows and filters tax invoices by type', async () => {
    state.latest = { id: 'inv-9' };
    await expect(findLatestDocumentId(BIZ, 'tax_invoice')).resolves.toBe('inv-9');
    const sql = state.sql[state.sql.length - 1];
    expect(sql).toMatch(/business_id = \$1/);
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(sql).toMatch(/document_type = ANY\(\$2::text\[\]\) OR document_type IS NULL/);
    expect(state.params[state.params.length - 1]).toEqual([BIZ, ['tax_invoice', 'regular']]);
  });

  it('has no source for payment receipts', async () => {
    await expect(findLatestDocumentId(BIZ, 'payment_receipt')).resolves.toBeNull();
  });
});

describe('click-to-edit markers', () => {
  it('puts the script just before </body>', () => {
    const out = injectPreviewBridge('<html><body><p>x</p></body></html>');
    expect(out).toMatch(/<p>x<\/p><script data-kh-preview-bridge>[\s\S]*<\/script><\/body><\/html>$/);
  });

  it('marks the header, details and items of every A4 template with known section names', () => {
    const a4 = Object.entries(TEMPLATE_PREVIEW_PATHS).filter(([id]) => !['payment_receipt', 'thermal_58mm', 'thermal_80mm'].includes(id));
    for (const [id, rel] of a4) {
      const html = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
      const sections = Array.from(html.matchAll(/data-kh-section="([a-z]+)"/g)).map((m) => m[1]);
      for (const s of sections) expect(PREVIEW_SECTIONS).toContain(s);
      expect({ id, header: sections.includes('header'), items: sections.includes('items') }).toEqual({ id, header: true, items: true });
    }
  });

  it('never ships the script in a printed document', async () => {
    state.doc = invoiceRow;
    state.items = items;
    const out = await generateDocumentHtml('inv-9', 'invoices');
    const html = await finalizePrintHtml(out.html, out.templateId, out.settings, out.businessId);
    expect(html).not.toContain('data-kh-preview-bridge');
    expect(html).not.toContain('<script');
  });
});

describe('thumbnail cache key', () => {
  it('is stable for the same input and changes with settings or sample data', () => {
    const a = thumbnailCacheKey('gst_standard', { x: 1 }, null);
    expect(thumbnailCacheKey('gst_standard', { x: 1 }, null)).toBe(a);
    expect(thumbnailCacheKey('gst_standard', { x: 1 }, '{"primary_color":"#000"}')).not.toBe(a);
    expect(thumbnailCacheKey('gst_standard', { x: 2 }, null)).not.toBe(a);
    expect(thumbnailCacheKey('modern', { x: 1 }, null)).not.toBe(a);
  });
});
