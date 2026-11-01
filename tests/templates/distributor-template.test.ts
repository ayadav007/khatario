/**
 * Renders the distributor template through the real print pipeline (only the database is mocked)
 * with a bill shaped like an FMCG distributor's: several GST slabs, case packs, MRP and product codes.
 *
 * Set STATUTORY_PRINT_OUT=<dir> to also write the rendered pages there (used to make sample PDFs).
 */
import fs from 'fs';
import path from 'path';

type Row = Record<string, unknown>;

const state: { doc: Row | null; items: Row[]; units: Row[]; assignment: { template_id: string; settings: Row } | null } = {
  doc: null, items: [], units: [], assignment: null,
};

jest.mock('@/lib/db', () => ({
  queryOne: jest.fn(async (sql: string) => {
    if (/FROM business_template_assignments/.test(sql)) return state.assignment;
    if (/JOIN businesses b/.test(sql)) return state.doc;
    return null;
  }),
  queryRows: jest.fn(async (sql: string) => {
    if (/FROM item_units/.test(sql)) return state.units;
    // Copies: the generator writes case units onto the rows it gets back.
    if (/WHERE ii\./.test(sql)) return state.items.map((i) => ({ ...i }));
    return [];
  }),
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
}));
jest.mock('@/lib/schema-columns', () => ({ hasTableColumn: jest.fn(async () => true) }));
jest.mock('puppeteer', () => ({}));
jest.mock('@/lib/puppeteer-launch', () => ({ getPuppeteerLaunchOptions: () => ({}) }));
jest.mock('@/lib/print-branding', () => ({ maybeAppendKhatarioPrintFooter: async (html: string) => html }));
jest.mock('@/lib/custom-fields-persist', () => ({
  fetchDefinitionsForBusiness: jest.fn(async () => [
    { id: 'cf1', business_id: 'b', entity_type: 'invoice', field_key: 'salesman', label: 'Salesman', field_type: 'text', options: [], is_required: false, sort_order: 1 },
    { id: 'cf2', business_id: 'b', entity_type: 'invoice', field_key: 'route', label: 'Route', field_type: 'text', options: [], is_required: false, sort_order: 2 },
    { id: 'cf3', business_id: 'b', entity_type: 'item', field_key: 'shade', label: 'Shade', field_type: 'text', options: [], is_required: false, sort_order: 1 },
  ]),
}));

import { generateDocumentHtml, finalizePrintHtml, type DocumentTable } from '@/lib/pdf-generator';
import { getDefaultTemplateSettings } from '@/lib/template-defaults';

const OUT_DIR = process.env.STATUTORY_PRINT_OUT || '';

/** A line with GST worked out the way the invoice screen does (CGST = SGST = half, 2 dp). */
function lineOf(o: { id: string; name: string; code: string; hsn: string; qty: number; rate: number; disc: number; gst: number; mrp: number }) {
  const gross = o.qty * o.rate;
  const taxable = Math.round((gross - o.disc) * 100) / 100;
  const half = Math.round(taxable * o.gst / 2) / 100;
  return {
    id: o.id, item_id: `item-${o.id}`, item_name: o.name, item_code: o.code, hsn_sac: o.hsn, quantity: o.qty, unit: 'PCS',
    unit_price: o.rate, discount_amount: o.disc, tax_rate: o.gst, taxable_value: taxable,
    cgst_amount: half, sgst_amount: half, igst_amount: 0, tax_amount: half * 2, line_total: Math.round((taxable + half * 2) * 100) / 100,
    item_mrp: o.mrp, item_base_unit: 'PCS', item_custom_fields: { shade: o.id === 'l1' ? 'Blue' : '' },
  };
}

const items = [
  lineOf({ id: 'l1', name: 'Vapour Rub 5gm', code: '80895636', hsn: '30049011', qty: 66, rate: 18.28, disc: 7.49, gst: 5, mrp: 23 }),
  lineOf({ id: 'l2', name: 'Shampoo Sachet Rs 2', code: '83920956', hsn: '33051090', qty: 60, rate: 1.53, disc: 1.38, gst: 18, mrp: 2 }),
  lineOf({ id: 'l3', name: 'Liquid Detergent Rs 10', code: '80890420', hsn: '34025000', qty: 18, rate: 8.32, disc: 13.47, gst: 18, mrp: 10 }),
  lineOf({ id: 'l4', name: 'Sanitary Pads Ultra 6', code: '80888569', hsn: '96190010', qty: 12, rate: 36.03, disc: 27.02, gst: 0, mrp: 50 }),
  lineOf({ id: 'l5', name: 'Baby Pants XL 2s', code: '83918756', hsn: '96190030', qty: 2, rate: 30.16, disc: 2.41, gst: 5, mrp: 38 }),
];
const units = [
  { item_id: 'item-l1', unit: 'CASE', factor_to_base: 60 },
  { item_id: 'item-l2', unit: 'STRIP', factor_to_base: 12 },
  { item_id: 'item-l2', unit: 'CASE', factor_to_base: 60 },
  { item_id: 'item-l3', unit: 'CASE', factor_to_base: 18 },
];

const sum = (k: string) => Math.round(items.reduce((s, i) => s + Number((i as Row)[k]), 0) * 100) / 100;

const invoiceRow: Row = {
  id: 'inv-d1',
  business_id: '11111111-1111-4111-8111-111111111111',
  business_name: 'Shree Ganesh Distributors', business_address: 'Office C-520, 5th Floor, Market Yard',
  business_city: 'Pune', business_state: 'Maharashtra', business_pincode: '411014',
  business_gstin: '27AAACG1234F1Z5', business_pan: 'AAACG1234F', business_phone: '9225000000', business_state_code: '27',
  customer_id: '22222222-2222-4222-8222-222222222222', customer_name: 'Ramdev Market',
  customer_billing_address: 'Near Tempo Chowk, Wadgaon Sheri, Pune 411014', customer_gstin: '27BBBPM5678K1Z2',
  customer_phone: '9970000000', customer_state: 'Maharashtra', customer_state_code: '27', customer_current_balance: 0,
  document_type: 'tax_invoice', status: 'final', invoice_number: 'CGPUN-26-1051602', invoice_date: '2026-10-24',
  place_of_supply_state_code: '27', is_reverse_charge: false,
  subtotal: sum('taxable_value'), discount_total: 0, cgst_total: sum('cgst_amount'), sgst_total: sum('sgst_amount'),
  igst_total: 0, tax_total: sum('tax_amount'), round_off: 0, grand_total: sum('line_total'),
  paid_amount: 0, balance_amount: sum('line_total'),
  custom_fields: { salesman: 'Nitin Pawar', route: 'Manjari / Mahadevnagar' },
};

const DEFAULTS = getDefaultTemplateSettings('distributor') as unknown as Row;
const withLayout = (extra: Row = {}): Row => ({
  ...DEFAULTS,
  custom_field_layout: { invoice_meta: ['salesman', 'route'], item_table: [] },
  ...extra,
});

async function render(settings: Row, doc: Row = invoiceRow, table: DocumentTable = 'invoices') {
  state.doc = { ...doc, template_id: 'distributor' };
  state.items = items;
  state.units = units;
  state.assignment = { template_id: 'distributor', settings };
  const out = await generateDocumentHtml(String(doc.id), table);
  return finalizePrintHtml(out.html, out.templateId, out.settings, out.businessId);
}

const text = (html: string) => html
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#x2F;/g, '/')
  .replace(/\s+/g, ' ');

/** The text of each header cell of the items table, in order. */
function itemHeaders(html: string): string[] {
  const table = html.match(/<table class="items">([\s\S]*?)<\/thead>/)?.[1] || '';
  return Array.from(table.matchAll(/<th>([^<]*)<\/th>/g)).map((m) => m[1]);
}

function save(name: string, html: string) {
  if (!OUT_DIR) return;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.html`), html);
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('distributor template', () => {
  it('prints the header grid, slab summary and default columns', async () => {
    const html = await render(withLayout());
    save('distributor__default_columns', html);
    const tx = text(html);

    expect(tx).toContain('Shree Ganesh Distributors');
    expect(tx).toContain('27AAACG1234F1Z5');
    expect(tx).toContain('Ramdev Market');
    expect(tx).toContain('27BBBPM5678K1Z2');
    expect(tx).toContain('CGPUN-26-1051602');
    expect(tx).toContain('Salesman');
    expect(tx).toContain('Nitin Pawar');
    expect(tx).toContain('Manjari / Mahadevnagar');
    expect(tx).toContain('Original for Recipient');
    expect(tx).toMatch(/Reverse Charge\s*No/);

    expect(itemHeaders(html)).toEqual([
      '#', 'HSN', 'P.Code', 'Item Description', 'MRP', 'Cs', 'Pcs', 'UPC', 'Rate', 'Gross Amt',
      'Disc Amt', 'Taxable', 'GST %', 'IGST/ CGST', 'SGST', 'Net Amt',
    ]);
    // 66 pieces at 60 a case = 1 case + 6 pieces; 18 at 18 a case = 1 case.
    expect(tx).toMatch(/Vapour Rub 5gm 23\.00 1 6 60 18\.28/);
    expect(tx).toMatch(/Liquid Detergent Rs 10 10\.00 1 0 18 8\.32/);
    expect(tx).toMatch(/Sanitary Pads Ultra 6 50\.00 12 36\.03/);

    // Slab summary: one row each for 0%, 5%, 18%, then totals, with margin.
    expect(tx).toMatch(/GST % Pcs Gross Amt Disc Amt Taxable Amt Tax Amt Net Amt Margin Margin %/);
    expect(tx).toMatch(/0% 12 432\.36 27\.02 405\.34 0\.00 405\.34/);
    const net = sum('line_total');
    const mrpValue = 66 * 23 + 60 * 2 + 18 * 10 + 12 * 50 + 2 * 38;
    const margin = (mrpValue - net).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(tx).toContain(`Total 158 `);
    expect(tx).toContain(margin);
    expect(tx).toContain(`Net Payable ₹ ${net.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  });

  it('prints the business\'s own columns in its order, plus what GST requires', async () => {
    const html = await render(withLayout({ item_columns: ['description', 'cf:shade', 'mrp', 'qty', 'net'] }));
    save('distributor__chosen_columns', html);
    expect(itemHeaders(html)).toEqual(['HSN', 'Item Description', 'Shade', 'MRP', 'Qty', 'Taxable', 'GST %', 'CGST', 'SGST', 'Net Amt']);
    expect(text(html)).toContain('Blue');
  });

  it('a sales order prints exactly the chosen columns', async () => {
    const order = { ...invoiceRow, id: 'so-1', document_type: undefined, invoice_number: undefined, order_number: 'SO-77', order_date: '2026-10-24' };
    const html = await render(withLayout({ item_columns: ['description', 'qty', 'net'] }), order, 'sales_orders');
    expect(itemHeaders(html)).toEqual(['Item Description', 'Qty', 'Net Amt']);
  });

  it('drops case and MRP columns when no item has them', async () => {
    state.units = [];
    const bare = items.map((i) => ({ ...i, item_mrp: null, item_code: null }));
    state.doc = { ...invoiceRow, template_id: 'distributor' };
    state.items = bare;
    state.assignment = { template_id: 'distributor', settings: withLayout() };
    const out = await generateDocumentHtml('inv-d1', 'invoices');
    const html = await finalizePrintHtml(out.html, out.templateId, out.settings, out.businessId);
    expect(itemHeaders(html)).toEqual(['#', 'HSN', 'Item Description', 'Pcs', 'Rate', 'Gross Amt', 'Disc Amt', 'Taxable', 'GST %', 'IGST/ CGST', 'SGST', 'Net Amt']);
    expect(text(html)).not.toContain('Margin');
  });
});
