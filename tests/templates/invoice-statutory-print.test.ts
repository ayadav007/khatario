/**
 * Renders every sales template through the real print pipeline (only the database is mocked)
 * with every show_* setting switched off, and checks that GST documents still print what the
 * CGST Rules require: GSTINs, HSN, place of supply, reverse charge, signatory, copy label and
 * the HSN-wise tax summary.
 *
 * Set STATUTORY_PRINT_OUT=<dir> to also write each rendered page there (used to make sample PDFs).
 */
import fs from 'fs';
import path from 'path';

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

import { generateDocumentHtml, finalizePrintHtml, type DocumentTable, type DocumentPrintOptions } from '@/lib/pdf-generator';
import { getDefaultTemplateSettings } from '@/lib/template-defaults';

const OUT_DIR = process.env.STATUTORY_PRINT_OUT || '';

const business = {
  business_id: '11111111-1111-4111-8111-111111111111',
  business_name: 'Shree Ganesh Traders',
  business_address: 'Shop 14, Market Yard, Gultekdi',
  business_city: 'Pune',
  business_state: 'Maharashtra',
  business_pincode: '411037',
  business_gstin: '27AAACG1234F1Z5',
  business_phone: '9822012345',
  business_state_code: '27',
};
const customer = {
  customer_id: '22222222-2222-4222-8222-222222222222',
  customer_name: 'Mahalaxmi Kirana Stores',
  customer_billing_address: '22 Laxmi Road, Pune 411030',
  customer_shipping_address: 'Godown 3, Hadapsar, Pune 411028',
  customer_gstin: '27BBBPM5678K1Z2',
  customer_state: 'Maharashtra',
  customer_state_code: '27',
  customer_current_balance: 0,
};

const invoiceRow: Row = {
  id: 'inv-1', ...business, ...customer,
  document_type: 'tax_invoice', status: 'final',
  invoice_number: 'SGT/26-27/0142', invoice_date: '2026-10-20', due_date: '2026-11-19',
  place_of_supply_state_code: '27', is_reverse_charge: false,
  subtotal: 9000, discount_total: 0, cgst_total: 290, sgst_total: 290, igst_total: 0, tax_total: 580,
  round_off: 0, grand_total: 9580, paid_amount: 0, balance_amount: 9580,
  invoice_billing_address: '22 Laxmi Road, Pune 411030', invoice_shipping_address: 'Godown 3, Hadapsar, Pune 411028',
};
const invoiceItems: Row[] = [
  { id: 'i1', item_name: 'Toor Dal (Loose)', hsn_sac: '07136000', quantity: 50, unit: 'KGS', unit_price: 120,
    tax_rate: 5, taxable_value: 6000, tax_amount: 300, cgst_amount: 150, sgst_amount: 150, igst_amount: 0, line_total: 6300 },
  { id: 'i2', item_name: 'Sunflower Oil 1L', hsn_sac: '15121910', quantity: 20, unit: 'BTL', unit_price: 100,
    tax_rate: 5, taxable_value: 2000, tax_amount: 100, cgst_amount: 50, sgst_amount: 50, igst_amount: 0, line_total: 2100 },
  { id: 'i3', item_name: 'Steel Container 5L', hsn_sac: '73239390', quantity: 10, unit: 'PCS', unit_price: 100,
    tax_rate: 18, taxable_value: 1000, tax_amount: 180, cgst_amount: 90, sgst_amount: 90, igst_amount: 0, line_total: 1180 },
];
const b2cInvoiceRow: Row = { ...invoiceRow, customer_gstin: null, customer_name: 'Walk-in Customer' };

const exportRow: Row = {
  ...invoiceRow, invoice_number: 'SGT/EXP/0009', is_export: true, export_type: 'wp',
  cgst_total: 0, sgst_total: 0, igst_total: 580, customer_country: 'UAE',
  customer_state_code: '96', place_of_supply_state_code: '96', customer_gstin: null,
};
const exportItems = invoiceItems.map((i) => ({ ...i, cgst_amount: 0, sgst_amount: 0, igst_amount: i.tax_amount }));

const bosRow: Row = { ...invoiceRow, document_type: 'bill_of_supply', invoice_number: 'SGT/BOS/0003',
  cgst_total: 0, sgst_total: 0, tax_total: 0, grand_total: 9000, balance_amount: 9000 };
const bosItems = invoiceItems.map((i) => ({ ...i, tax_rate: 0, tax_amount: 0, cgst_amount: 0, sgst_amount: 0, line_total: i.taxable_value }));

const noteRow: Row = {
  id: 'cn-1', ...business, ...customer, credit_note_number: 'SGT/CN/0007', credit_note_date: '2026-10-22',
  original_invoice_number: 'SGT/26-27/0142', original_invoice_date: '2026-10-20', reason: 'Damaged in transit',
  place_of_supply_state_code: '27', subtotal: 1000, tax_total: 180, cgst_total: 90, sgst_total: 90, igst_total: 0,
  grand_total: 1180,
};
const noteItems: Row[] = [{ id: 'n1', item_name: 'Steel Container 5L', description: 'Steel Container 5L', hsn_sac: '73239390',
  qty: 10, unit: 'PCS', unit_price: 100, tax_rate: 18, tax_amount: 180, cgst_amount: 90, sgst_amount: 90, taxable_value: 1000, line_total: 1180 }];
const debitRow: Row = { ...noteRow, id: 'dn-1', credit_note_number: undefined, credit_note_date: undefined,
  debit_note_number: 'SGT/DN/0004', debit_note_date: '2026-10-23', reason: 'Short billed' };

const challanRow: Row = {
  id: 'dc-1', ...business, ...customer, challan_number: 'SGT/DC/0011', challan_date: '2026-10-19',
  reason_for_transportation: 'supply', vehicle_number: 'MH12AB1234', status: 'draft',
};
const challanItems: Row[] = [{ id: 'c1', item_name: 'Toor Dal (Loose)', hsn_sac: '07136000', qty: 50, unit: 'KGS' }];

function allOff(templateId: string): Row {
  const s: Row = { ...(getDefaultTemplateSettings(templateId) as unknown as Row) };
  for (const k of Object.keys(s)) if (k.startsWith('show_')) s[k] = false;
  return s;
}
const defaults = (templateId: string): Row => ({ ...(getDefaultTemplateSettings(templateId) as unknown as Row) });

async function render(templateId: string, table: DocumentTable, doc: Row, items: Row[], settings: Row, opts: DocumentPrintOptions = {}) {
  state.doc = { ...doc, template_id: templateId };
  state.items = items;
  state.assignment = { template_id: templateId, settings };
  const out = await generateDocumentHtml(String(doc.id), table, opts);
  return finalizePrintHtml(out.html, out.templateId, out.settings, out.businessId);
}

function text(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ');
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

const A4_TAX_TEMPLATES = ['gst_standard', 'modern', 'classic', 'elegant', 'minimal', 'business_pro', 'tally_style', 'gst_detailed'];
/** These two have their own HSN summary table rather than the shared partial. */
const OWN_SUMMARY = new Set(['tally_style', 'gst_detailed']);

describe('tax invoice templates print the GST essentials even with every setting off', () => {
  for (const t of A4_TAX_TEMPLATES) {
    it(t, async () => {
      const html = await render(t, 'invoices', invoiceRow, invoiceItems, allOff(t));
      save(`tax_invoice__${t}`, await render(t, 'invoices', invoiceRow, invoiceItems, defaults(t)));
      const tx = text(html);
      expect(tx).toContain('27AAACG1234F1Z5');
      expect(tx).toContain('27BBBPM5678K1Z2');
      expect(tx).toContain('07136000');
      expect(tx).toContain('Maharashtra');
      expect(tx).toMatch(/Reverse Charge:?\s*No/);
      expect(tx).toContain('Original for Recipient');
      expect(tx).toMatch(/Authori[sz]ed Signatory/i);
      expect(tx).toContain('Mahalaxmi Kirana Stores');
      expect(tx).toMatch(/9,?580\.00/);
      if (!OWN_SUMMARY.has(t)) {
        expect(html).toContain('kh-hsn-summary');
        // One row per HSN, then the totals row: taxable 9,000.00, CGST 290.00, SGST 290.00, tax 580.00
        expect(tx).toMatch(/Total 9,000\.00 290\.00 290\.00 580\.00/);
      }
    });
  }

  it('prints "Reverse Charge: Yes" when tax is payable on reverse charge', async () => {
    const html = await render('gst_standard', 'invoices', { ...invoiceRow, is_reverse_charge: true }, invoiceItems, allOff('gst_standard'));
    expect(text(html)).toContain('Reverse Charge: Yes');
  });
});

describe('thermal receipts', () => {
  for (const t of ['thermal_58mm', 'thermal_80mm']) {
    it(`${t}: B2B receipt prints HSN and reverse charge`, async () => {
      const tx = text(await render(t, 'invoices', invoiceRow, invoiceItems, allOff(t)));
      save(`tax_invoice__${t}`, await render(t, 'invoices', invoiceRow, invoiceItems, defaults(t)));
      expect(tx).toContain('27AAACG1234F1Z5');
      expect(tx).toContain('HSN: 07136000');
      expect(tx).toContain('Rev Chg: No');
      expect(tx).not.toContain('Original for Recipient');
    });

    it(`${t}: B2C receipt stays short`, async () => {
      const tx = text(await render(t, 'invoices', b2cInvoiceRow, invoiceItems, defaults(t)));
      expect(tx).not.toContain('HSN: 07136000');
      expect(tx).not.toContain('Rev Chg');
    });
  }
});

describe('other GST documents', () => {
  it('export invoice prints the copy label and an IGST summary', async () => {
    const html = await render('export_invoice', 'invoices', exportRow, exportItems, allOff('export_invoice'));
    save('export__export_invoice', await render('export_invoice', 'invoices', exportRow, exportItems, defaults('export_invoice')));
    const tx = text(html);
    expect(tx).toContain('Original for Recipient');
    expect(html).toContain('kh-hsn-summary');
    expect(tx).toMatch(/HSN\/SAC Taxable Value IGST Total Tax/);
  });

  for (const t of ['composition_standard', 'composition_modern', 'tax_exempt']) {
    it(`bill of supply ${t} prints HSN, copy label and signatory but no tax lines`, async () => {
      const html = await render(t, 'invoices', bosRow, bosItems, allOff(t));
      save(`bill_of_supply__${t}`, await render(t, 'invoices', bosRow, bosItems, defaults(t)));
      const tx = text(html);
      expect(tx).toContain('27AAACG1234F1Z5');
      expect(tx).toContain('07136000');
      expect(tx).toContain('Original for Recipient');
      expect(tx).toMatch(/Authori[sz]ed Signatory/i);
      expect(tx).not.toContain('Reverse Charge');
      expect(html).not.toContain('kh-hsn-summary');
    });
  }

  it('credit note prints GSTINs and the copy label', async () => {
    const tx = text(await render('credit_standard', 'credit_notes', noteRow, noteItems, allOff('credit_standard')));
    save('credit_note__credit_standard', await render('credit_standard', 'credit_notes', noteRow, noteItems, defaults('credit_standard')));
    expect(tx).toContain('27AAACG1234F1Z5');
    expect(tx).toContain('27BBBPM5678K1Z2');
    expect(tx).toContain('Original for Recipient');
  });

  it('debit note prints GSTINs and the copy label', async () => {
    const tx = text(await render('debit_standard', 'debit_notes', debitRow, noteItems, allOff('debit_standard')));
    save('debit_note__debit_standard', await render('debit_standard', 'debit_notes', debitRow, noteItems, defaults('debit_standard')));
    expect(tx).toContain('27BBBPM5678K1Z2');
    expect(tx).toContain('Original for Recipient');
  });

  it('delivery challan is labelled for the consignee by default', async () => {
    const html = await render('challan_standard', 'delivery_challans', challanRow, challanItems, defaults('challan_standard'));
    save('delivery_challan__challan_standard', html);
    expect(text(html)).toContain('Original for Consignee');
  });
});

describe('non-GST documents keep their settings', () => {
  it('a proforma invoice has no copy label and honours switched-off fields', async () => {
    const proforma = { ...invoiceRow, document_type: 'proforma_invoice', invoice_number: 'SGT/PI/0015' };
    const tx = text(await render('gst_standard', 'invoices', proforma, invoiceItems, allOff('gst_standard')));
    expect(tx).not.toContain('Original for');
    expect(tx).not.toContain('27BBBPM5678K1Z2');
    expect(tx).not.toContain('Reverse Charge');
  });
});

describe('printing every copy', () => {
  it('copy=all prints original, duplicate and triplicate on separate pages', async () => {
    const html = await render('gst_standard', 'invoices', invoiceRow, invoiceItems, defaults('gst_standard'), { copy: 'all' });
    save('tax_invoice__gst_standard__all_copies', html);
    const tx = text(html);
    expect(tx).toContain('Original for Recipient');
    expect(tx).toContain('Duplicate for Transporter');
    expect(tx).toContain('Triplicate for Supplier');
    expect(html.match(/page-break-before: always/g)?.length).toBe(2);
    expect(html.match(/<\/body>/gi)?.length).toBe(1);
  });

  it('copy=duplicate prints just that label', async () => {
    const tx = text(await render('modern', 'invoices', invoiceRow, invoiceItems, defaults('modern'), { copy: 'duplicate' }));
    expect(tx).toContain('Duplicate for Transporter');
    expect(tx).not.toContain('Original for Recipient');
  });
});
