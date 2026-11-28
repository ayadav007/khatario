/**
 * The e-invoice (IRN) block of templates/partials/invoice-meta-extra.html, through the real print pipeline
 * (only the database is mocked), on every template that includes that partial.
 */
type Row = Record<string, unknown>;

const state: { doc: Row | null; items: Row[]; assignment: { template_id: string; settings: Row } | null } = {
  doc: null, items: [], assignment: null,
};

jest.mock('@/lib/db', () => ({
  queryOne: jest.fn(async (sql: string) => {
    if (/FROM business_template_assignments/.test(sql)) return state.assignment;
    if (/JOIN businesses b/.test(sql)) return state.doc;
    return null;
  }),
  queryRows: jest.fn(async (sql: string) => (/WHERE ii\./.test(sql) ? state.items : [])),
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
}));
jest.mock('@/lib/schema-columns', () => ({ hasTableColumn: jest.fn(async () => true) }));
jest.mock('puppeteer', () => ({}));
jest.mock('@/lib/puppeteer-launch', () => ({ getPuppeteerLaunchOptions: () => ({}) }));
jest.mock('@/lib/print-branding', () => ({ maybeAppendKhatarioPrintFooter: async (html: string) => html }));
jest.mock('@/lib/custom-fields-persist', () => ({ fetchDefinitionsForBusiness: jest.fn(async () => []) }));

import { generateDocumentHtml, finalizePrintHtml } from '@/lib/pdf-generator';
import { getDefaultTemplateSettings } from '@/lib/template-defaults';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';

const IRN = 'f'.repeat(60) + 'a1b2';
const invoiceRow: Row = {
  id: 'inv-1',
  business_id: '11111111-1111-4111-8111-111111111111', business_name: 'Shree Ganesh Traders', business_address: 'Market Yard',
  business_city: 'Pune', business_state: 'Maharashtra', business_pincode: '411037', business_gstin: '27AAACG1234F1Z5',
  business_state_code: '27',
  customer_id: '22222222-2222-4222-8222-222222222222', customer_name: 'Mahalaxmi Kirana Stores', customer_gstin: '27BBBPM5678K1Z2',
  customer_state: 'Maharashtra', customer_state_code: '27', customer_current_balance: 0,
  document_type: 'tax_invoice', status: 'final', invoice_number: 'SGT/0142', invoice_date: '2026-11-27',
  place_of_supply_state_code: '27', subtotal: 6000, cgst_total: 150, sgst_total: 150, igst_total: 0, tax_total: 300,
  grand_total: 6300, paid_amount: 0, balance_amount: 6300,
  irn: IRN, irn_ack_no: '112410239876543', irn_ack_date: '2026-11-27T08:00:00Z', irn_signed_qr: 'eyJhbGciOiJSUzI1NiJ9.eyJkYXRhIjoiMSJ9.c2ln',
  irn_status: 'active',
};
const items: Row[] = [
  { id: 'i1', item_name: 'Toor Dal', hsn_sac: '07136000', quantity: 50, unit: 'KGS', unit_price: 120, tax_rate: 5,
    taxable_value: 6000, tax_amount: 300, cgst_amount: 150, sgst_amount: 150, igst_amount: 0, line_total: 6300 },
];
const bosRow: Row = { ...invoiceRow, document_type: 'bill_of_supply', cgst_total: 0, sgst_total: 0, tax_total: 0, grand_total: 6000 };
const bosItems = items.map((i) => ({ ...i, tax_rate: 0, tax_amount: 0, cgst_amount: 0, sgst_amount: 0, line_total: i.taxable_value }));
const exportRow: Row = { ...invoiceRow, is_export: true, export_type: 'wp', cgst_total: 0, sgst_total: 0, igst_total: 300,
  customer_country: 'UAE', customer_state_code: '96', place_of_supply_state_code: '96', customer_gstin: null };

/** Templates that include the invoice-meta-extra partial, with a document they print. */
const WITH_PARTIAL: Array<[string, Row, Row[]]> = [
  ['tally_style', invoiceRow, items],
  ['thermal_58mm', invoiceRow, items],
  ['thermal_80mm', invoiceRow, items],
  ['distributor', invoiceRow, items],
  ['export_invoice', exportRow, items],
  ['composition_standard', bosRow, bosItems],
  ['composition_modern', bosRow, bosItems],
  ['tax_exempt', bosRow, bosItems],
];

/** The A4 sales templates that include the einvoice-irn partial directly (not through invoice-meta-extra). */
const SALES_A4 = ['gst_standard', 'modern', 'classic', 'elegant', 'minimal', 'business_pro', 'gst_detailed'];

async function render(templateId: string, doc: Row, lines: Row[], allOff = false) {
  const settings: Row = { ...(getDefaultTemplateSettings(templateId) as unknown as Row) };
  if (allOff) for (const k of Object.keys(settings)) if (k.startsWith('show_')) settings[k] = false;
  state.doc = { ...doc, template_id: templateId };
  state.items = lines;
  state.assignment = { template_id: templateId, settings };
  const out = await generateDocumentHtml(String(doc.id), 'invoices');
  return finalizePrintHtml(out.html, out.templateId, out.settings, out.businessId);
}

const block = (html: string) => {
  const at = html.indexOf('kh-einvoice-irn');
  return at < 0 ? '' : html.slice(at, at + 4000);
};

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('e-invoice block on the printed invoice', () => {
  for (const [t, doc, lines] of WITH_PARTIAL) {
    it(`${t}: prints the QR, IRN, Ack No and Ack Date for an active e-invoice, even with every setting off`, async () => {
      for (const allOff of [false, true]) {
        const b = block(await render(t, doc, lines, allOff));
        expect(b).not.toBe('');
        expect(b).toMatch(/<img src="data:image\/png;base64,/);
        // The IRN prints whole (in pieces the thermal shortening leaves alone).
        expect(b.replace(/<\/?span>/g, '')).toContain(`<strong>IRN:</strong> ${IRN}</div>`);
        expect(b).toMatch(/Ack No:<\/strong> 112410239876543/);
        expect(b).toMatch(/Ack Date:<\/strong> 27\/11\/2026/);
        expect(b).toContain('width:30mm;height:30mm');
      }
    });

    it(`${t}: prints no block for a cancelled e-invoice or none`, async () => {
      expect(await render(t, { ...doc, irn_status: 'cancelled' }, lines)).not.toContain('kh-einvoice-irn');
      expect(await render(t, { ...doc, irn: null, irn_status: null }, lines)).not.toContain('kh-einvoice-irn');
    });
  }
});

describe('e-invoice block on the A4 sales templates', () => {
  for (const t of SALES_A4) {
    it(`${t}: prints the QR, IRN, Ack No and Ack Date once for an active e-invoice, even with every setting off`, async () => {
      for (const allOff of [false, true]) {
        const html = await render(t, invoiceRow, items, allOff);
        expect(html.split('kh-einvoice-irn').length - 1).toBe(1);
        const b = block(html);
        expect(b).toMatch(/<img src="data:image\/png;base64,/);
        expect(b.replace(/<\/?span>/g, '')).toContain(`<strong>IRN:</strong> ${IRN}</div>`);
        expect(b).toMatch(/Ack No:<\/strong> 112410239876543/);
        expect(b).toMatch(/Ack Date:<\/strong> 27\/11\/2026/);
        expect(b).toContain('width:30mm;height:30mm');
        expect(b).toContain('word-break:break-all');
      }
    });

    it(`${t}: without an active e-invoice the page is byte-identical to one with no block at all`, async () => {
      const cancelled = await render(t, { ...invoiceRow, irn_status: 'cancelled' }, items);
      const none = await render(t, { ...invoiceRow, irn: null, irn_status: null }, items);
      expect(none).not.toContain('kh-einvoice-irn');
      expect(cancelled).toBe(none);
      // Swap the partial for nothing: the include itself must add no bytes (no blank line, no spaces).
      const original = fs.readFileSync(path.join(process.cwd(), 'templates', 'partials', 'einvoice-irn.html'), 'utf-8');
      Handlebars.registerPartial('einvoice-irn', '');
      try {
        expect(await render(t, { ...invoiceRow, irn: null, irn_status: null }, items)).toBe(none);
      } finally {
        Handlebars.registerPartial('einvoice-irn', original);
      }
    });
  }
});
