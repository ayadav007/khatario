/**
 * Renders a fully populated dummy document through the real print pipeline
 * (generateDocumentHtml → presenter → Handlebars → finalizePrintHtml) for every
 * template, with only the database mocked. Every field carries a unique marker so
 * the report shows exactly which fields reach each template, and which
 * show_* settings actually hide them.
 *
 * Output: docs/qa/template-audit/{report.md, report.json, <case>.html}
 */
import fs from 'fs';
import path from 'path';

type Row = Record<string, unknown>;

const state: {
  doc: Row | null;
  items: Row[];
  assignment: { template_id: string; settings: Row } | null;
  itemSql: string[];
} = { doc: null, items: [], assignment: null, itemSql: [] };

jest.mock('@/lib/db', () => ({
  queryOne: jest.fn(async (sql: string) => {
    if (/FROM bank_accounts/.test(sql)) return BANK_ROW;
    if (/FROM business_template_assignments/.test(sql)) return state.assignment;
    if (/JOIN businesses b/.test(sql)) return state.doc;
    return null;
  }),
  queryRows: jest.fn(async (sql: string) => {
    if (/WHERE ii\./.test(sql)) {
      state.itemSql.push(sql);
      return state.items;
    }
    return [];
  }),
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
}));
jest.mock('@/lib/schema-columns', () => ({
  hasTableColumn: jest.fn(async (table: string, column: string) => {
    const itemCols = mockItemTableColumns[table];
    if (itemCols) return itemCols.includes(column);
    if ((table === 'credit_notes' || table === 'debit_notes') && /_address$/.test(column)) return false;
    return true;
  }),
}));
jest.mock('puppeteer', () => ({}));
jest.mock('@/lib/puppeteer-launch', () => ({ getPuppeteerLaunchOptions: () => ({}) }));
jest.mock('@/lib/print-branding', () => ({
  maybeAppendKhatarioPrintFooter: async (html: string) => html,
}));
jest.mock('@/lib/custom-fields-persist', () => ({
  fetchDefinitionsForBusiness: jest.fn(async () => [
    {
      id: 'cf1', business_id: BIZ_ID, entity_type: 'invoice', field_key: 'site_code',
      label: 'Site Code', field_type: 'text', options: [], is_required: false, sort_order: 1,
    },
    {
      id: 'cf2', business_id: BIZ_ID, entity_type: 'item', field_key: 'colour',
      label: 'Colour', field_type: 'text', options: [], is_required: false, sort_order: 1,
    },
  ]),
}));

import { generateDocumentHtml, finalizePrintHtml, type DocumentTable } from '@/lib/pdf-generator';
import { getDefaultTemplateSettings } from '@/lib/template-defaults';

const BIZ_ID = '11111111-1111-4111-8111-111111111111';
const OUT_DIR = path.join(process.cwd(), 'docs', 'qa', 'template-audit');

const BANK_ROW = {
  bank_name: 'ZQBANK of India',
  account_number: '001122334455',
  ifsc_code: 'ZQBK0001234',
  branch_name: 'ZQBR-Baner',
};

/** Columns that really exist (database/schema.sql + migrations), for validating item SQL. */
const mockItemTableColumns: Record<string, string[]> = {
  invoice_items: ['id', 'invoice_id', 'item_id', 'item_name', 'description', 'hsn_sac', 'quantity', 'unit', 'unit_price', 'discount_percent', 'discount_amount', 'tax_rate', 'tax_amount', 'taxable_value', 'cgst_amount', 'sgst_amount', 'igst_amount', 'line_total', 'sort_order', 'variant_id', 'location_id', 'cess_amount'],
  credit_note_items: ['id', 'credit_note_id', 'item_id', 'description', 'qty', 'unit', 'unit_price', 'discount', 'tax_rate', 'tax_amount', 'line_total', 'sort_order', 'location_id'],
  debit_note_items: ['id', 'debit_note_id', 'item_id', 'description', 'hsn_sac', 'qty', 'unit', 'unit_price', 'discount', 'tax_rate', 'tax_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'taxable_value', 'line_total', 'sort_order'],
  delivery_challan_items: ['id', 'delivery_challan_id', 'item_id', 'item_name', 'description', 'hsn_sac', 'qty', 'unit', 'delivered_qty', 'sort_order'],
  sales_order_items: ['id', 'sales_order_id', 'item_id', 'item_name', 'description', 'hsn_sac', 'qty', 'unit', 'unit_price', 'discount_percent', 'discount_amount', 'tax_rate', 'tax_amount', 'taxable_value', 'cgst_amount', 'sgst_amount', 'igst_amount', 'line_total', 'fulfilled_qty', 'sort_order'],
  purchase_order_items: ['id', 'purchase_order_id', 'item_id', 'item_name', 'description', 'hsn_sac', 'qty', 'unit', 'unit_price', 'discount_percent', 'discount_amount', 'tax_rate', 'tax_amount', 'taxable_value', 'cgst_amount', 'sgst_amount', 'igst_amount', 'line_total', 'fulfilled_qty', 'sort_order'],
};

// ─── Fixture rows (shaped exactly like the SELECT in generateDocumentHtml) ───────

const businessCols = {
  business_id: BIZ_ID,
  business_name: 'ZQBIZ Enterprises',
  business_address: 'ZQBADDR Unit 4 Hinjewadi',
  business_city: 'Pune',
  business_state: 'Maharashtra',
  business_pincode: '411057',
  business_gstin: '27ZZZZZ9999Z1Z9',
  business_logo: 'https://cdn.example.com/zqlogo.png',
  business_signature: 'https://cdn.example.com/zqsign.png',
  business_phone: '9000011111',
  business_email: 'zqbiz@example.com',
  business_iec_code: 'ZQIEC12345',
  business_swift_code: 'ZQSWIFTX',
  business_state_code: '27',
};

const customerCols = {
  customer_id: '22222222-2222-4222-8222-222222222222',
  customer_name: 'ZQCUST Traders',
  customer_billing_address: 'ZQCBILL master address',
  customer_shipping_address: 'ZQCSHIP master address',
  customer_phone: '9812345670',
  customer_email: 'zqcust@example.com',
  customer_gstin: '27ABCDE1234F1Z5',
  customer_country: 'India',
  customer_current_balance: 20000,
  customer_state: 'Maharashtra',
  customer_state_code: '27',
};

const taxInvoiceRow: Row = {
  id: 'inv-1',
  ...businessCols,
  ...customerCols,
  document_type: 'tax_invoice',
  status: 'final',
  invoice_number: 'ZQINV-0042',
  invoice_date: '2026-09-20',
  due_date: '2026-10-21',
  place_of_supply_state_code: '27',
  is_reverse_charge: false,
  purchase_order_number: 'ZQPO-7781',
  purchase_order_date: '2026-09-01',
  eway_bill_number: 'ZQEWB-331122',
  reference_number: 'ZQREF-5566',
  delivery_note: 'ZQDN-11',
  payment_terms: 'ZQPT-Net45',
  other_references: 'ZQOR-22',
  dispatched_through: 'ZQDT-BlueDart',
  destination: 'ZQDEST-Chakan',
  terms_of_delivery: 'ZQTOD-DoorDelivery',
  transport_mode: 'ZQTM-Road',
  notes: 'ZQINVNOTE thanks for the order',
  terms: 'ZQINVTERMS goods once sold',
  billing_address: 'ZQIBILL 12 MG Road Pune',
  shipping_address: 'ZQISHIP Plot 9 Chakan',
  invoice_billing_address: 'ZQIBILL 12 MG Road Pune',
  invoice_shipping_address: 'ZQISHIP Plot 9 Chakan',
  subtotal: 4722.2,
  discount_total: 166.67,
  cgst_total: 378.33,
  sgst_total: 378.33,
  igst_total: 0,
  tax_total: 756.66,
  additional_charges: 150.25,
  round_off: 0.89,
  grand_total: 5630.0,
  paid_amount: 1234.56,
  balance_amount: 4395.44,
  custom_fields: { site_code: 'ZQCF-SITE9' },
  template_id: null,
};

const taxInvoiceItems: Row[] = [
  {
    id: 'ii-1', item_name: 'ZQAlpha Widget', description: 'ZQDESC-ALPHA', hsn_sac: '84713010',
    quantity: 3, unit: 'BOX', unit_price: 1111.11, discount_percent: 5, discount_amount: 166.67,
    tax_rate: 18, taxable_value: 3166.66, tax_amount: 570.0, cgst_amount: 285.0, sgst_amount: 285.0,
    igst_amount: 0, line_total: 3736.66, item_custom_fields: { colour: 'ZQCOLOUR-Teal' },
  },
  {
    id: 'ii-2', item_name: 'ZQBeta Gadget', description: 'ZQDESC-BETA', hsn_sac: '85176290',
    quantity: 7, unit: 'KGS', unit_price: 222.22, discount_percent: 0, discount_amount: 0,
    tax_rate: 12, taxable_value: 1555.54, tax_amount: 186.66, cgst_amount: 93.33, sgst_amount: 93.33,
    igst_amount: 0, line_total: 1742.2, item_custom_fields: {},
  },
];

const exportInvoiceRow: Row = {
  ...taxInvoiceRow,
  invoice_number: 'ZQEXP-0009',
  is_export: true,
  cgst_total: 0,
  sgst_total: 0,
  igst_total: 756.66,
  invoice_currency: 'USD',
  exchange_rate: 83.1234,
  country_of_origin: 'ZQCOO-India',
  port_of_loading: 'ZQPOL-Nhava Sheva',
  port_of_discharge: 'ZQPOD-Jebel Ali',
  place_of_delivery: 'ZQPODEL-Dubai',
  incoterms: 'ZQINCO-CIF',
  awb_number: 'ZQAWB-7788',
  bl_number: 'ZQBL-9900',
  buyer_tax_id: 'ZQTAXID-AE100',
  shipping_bill_number: 'ZQSB-4455',
  port_code: 'ZQPC-INNSA1',
  customer_country: 'ZQCOUNTRY-UAE',
  customer_state: 'Dubai',
  customer_state_code: '96',
  place_of_supply_state_code: '96',
};
const exportItems = taxInvoiceItems.map((i) => ({
  ...i, cgst_amount: 0, sgst_amount: 0, igst_amount: i.tax_amount,
}));

const billOfSupplyRow: Row = {
  ...taxInvoiceRow,
  document_type: 'bill_of_supply',
  invoice_number: 'ZQBOS-0003',
  cgst_total: 0, sgst_total: 0, igst_total: 0, tax_total: 0,
  grand_total: 4873.34,
  balance_amount: 3638.78,
};
const billOfSupplyItems = taxInvoiceItems.map((i) => ({
  ...i, tax_rate: 0, tax_amount: 0, cgst_amount: 0, sgst_amount: 0,
  line_total: i.taxable_value,
}));

const proformaRow: Row = { ...taxInvoiceRow, document_type: 'proforma_invoice', invoice_number: 'ZQPI-0015' };

const creditNoteRow: Row = {
  id: 'cn-1', ...businessCols, ...customerCols,
  credit_note_number: 'ZQCN-0007', credit_note_date: '2026-09-22',
  invoice_id: 'inv-1', original_invoice_date: '2026-09-20', original_invoice_number: 'ZQINV-0042',
  reason: 'ZQREASON damaged in transit', place_of_supply_state_code: '27',
  subtotal: 1000, discount_total: 0, tax_total: 180, cgst_total: 90, sgst_total: 90, igst_total: 0,
  round_off: 0, grand_total: 1180, notes: 'ZQCNNOTE credit note', status: undefined,
  invoice_billing_address: null, invoice_shipping_address: null,
};
/** credit_note_items has no item_name / hsn_sac / taxable_value (see mockItemTableColumns). */
const creditNoteItems: Row[] = [
  {
    id: 'cni-1', description: 'ZQCNITEM returned widget', qty: 2, unit: 'BOX', unit_price: 500,
    discount: 0, tax_rate: 18, tax_amount: 180, line_total: 1180,
    item_name: 'ZQAlpha Widget', hsn_sac: '84713010', item_custom_fields: {},
  },
];

const debitNoteRow: Row = {
  ...creditNoteRow, id: 'dn-1', credit_note_number: undefined, credit_note_date: undefined,
  debit_note_number: 'ZQDBN-0004', debit_note_date: '2026-09-23',
  reason: 'ZQREASON short billed', notes: 'ZQDNNOTE debit note',
};
const debitNoteItems: Row[] = [
  {
    id: 'dni-1', description: 'ZQDNITEM extra freight', hsn_sac: '996511', qty: 1, unit: 'NOS',
    unit_price: 1000, discount: 0, tax_rate: 18, tax_amount: 180, cgst_amount: 90, sgst_amount: 90,
    igst_amount: 0, taxable_value: 1000, line_total: 1180, item_name: 'ZQFreight', item_custom_fields: {},
  },
];

const challanRow: Row = {
  id: 'dc-1', ...businessCols, ...customerCols,
  challan_number: 'ZQDC-0011', challan_date: '2026-09-24', delivery_date: '2026-09-25',
  e_way_bill_number: 'ZQEWB-DC-5511', vehicle_number: 'ZQMH12AB1234', transporter_name: 'ZQTRANS Logistics',
  transporter_gstin: '27TRANS1234T1Z1', reason_for_transportation: 'job_work',
  dispatch_from_address: 'ZQDISPATCH Warehouse 2', place_of_delivery: 'ZQPLACEDEL Chakan',
  invoice_id: 'inv-1', original_invoice_number: 'ZQINV-0042', notes: 'ZQDCNOTE handle with care', terms: 'ZQDCTERMS',
  shipping_address: 'ZQDCSHIP Plot 9 Chakan', billing_address: 'ZQDCBILL 12 MG Road',
  invoice_billing_address: 'ZQDCBILL 12 MG Road', invoice_shipping_address: 'ZQDCSHIP Plot 9 Chakan',
  status: 'draft',
};
const challanItems: Row[] = [
  { id: 'dci-1', item_name: 'ZQAlpha Widget', description: 'ZQDESC-ALPHA', hsn_sac: '84713010', qty: 3, unit: 'BOX', delivered_qty: 0, item_custom_fields: {} },
];

const salesOrderRow: Row = {
  id: 'so-1', ...businessCols, ...customerCols,
  order_number: 'ZQSO-0021', order_date: '2026-09-18', expected_delivery_date: '2026-09-30',
  status: 'confirmed', subtotal: 4722.2, discount_total: 166.67, tax_total: 756.66, round_off: 0.89,
  grand_total: 5630.0, additional_charges: 150.25, additional_charges_label: 'ZQFreight charge',
  shipping_address: 'ZQSOSHIP', billing_address: 'ZQSOBILL', invoice_billing_address: 'ZQSOBILL',
  invoice_shipping_address: 'ZQSOSHIP', place_of_supply_state_code: '27',
  notes: 'ZQSONOTE', terms: 'ZQSOTERMS',
};
const orderItems = taxInvoiceItems.map(({ quantity, ...rest }) => ({ ...rest, qty: quantity }));
const purchaseOrderRow: Row = {
  ...salesOrderRow, id: 'po-1', order_number: 'ZQPUR-0031', notes: 'ZQPONOTE', terms: 'ZQPOTERMS',
};

// ─── Settings: everything switched on, plus content markers ─────────────────────

function allOnSettings(templateId: string): Row {
  const d = getDefaultTemplateSettings(templateId) as unknown as Row;
  const s: Row = { ...d };
  for (const k of Object.keys(s)) if (k.startsWith('show_')) s[k] = true;
  s.terms = 'ZQSETTERMS settings terms';
  s.notes = 'ZQSETNOTES settings notes';
  s.footer_text = 'ZQSETFOOTER';
  s.payment_terms = 'ZQSETPT settings payment terms';
  s.custom_field_layout = { invoice_meta: ['site_code'], item_table: ['colour'] };
  return s;
}

// ─── Fields to look for ─────────────────────────────────────────────────────────

type Check = {
  field: string;
  /** Any of these strings present in the visible text (or raw html for urls) = shown */
  markers: string[];
  setting?: string;
  raw?: boolean;
};

const money = (n: number) => [n.toFixed(2), n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })];

const COMMON_CHECKS: Check[] = [
  { field: 'business.name', markers: ['ZQBIZ Enterprises'], setting: 'show_business_name' },
  { field: 'business.address', markers: ['ZQBADDR'], setting: 'show_business_address' },
  { field: 'business.gstin', markers: ['27ZZZZZ9999Z1Z9'], setting: 'show_business_gstin' },
  { field: 'business.phone', markers: ['9000011111'], setting: 'show_business_phone' },
  { field: 'business.email', markers: ['zqbiz@example.com'], setting: 'show_business_email' },
  { field: 'business.logo', markers: ['zqlogo.png'], setting: 'show_logo', raw: true },
  { field: 'business.signature', markers: ['zqsign.png'], setting: 'show_signature', raw: true },
  { field: 'customer.name', markers: ['ZQCUST Traders'], setting: 'show_customer_name' },
  { field: 'customer.gstin', markers: ['27ABCDE1234F1Z5'], setting: 'show_customer_gstin' },
  { field: 'customer.phone', markers: ['9812345670'], setting: 'show_customer_phone' },
  { field: 'customer.email', markers: ['zqcust@example.com'], setting: 'show_customer_email' },
  { field: 'document.number', markers: ['ZQINV-0042', 'ZQEXP-0009', 'ZQBOS-0003', 'ZQPI-0015', 'ZQCN-0007', 'ZQDBN-0004', 'ZQDC-0011', 'ZQSO-0021', 'ZQPUR-0031'], setting: 'show_invoice_number' },
];

const INVOICE_CHECKS: Check[] = [
  ...COMMON_CHECKS,
  { field: 'invoice.date', markers: ['20 September 2026'], setting: 'show_invoice_date' },
  { field: 'invoice.due_date', markers: ['21 October 2026'], setting: 'show_due_date' },
  { field: 'bill_to (invoice billing address)', markers: ['ZQIBILL'], setting: 'show_customer_address' },
  { field: 'ship_to (invoice shipping address)', markers: ['ZQISHIP'], setting: 'show_ship_to' },
  { field: 'customer.state', markers: ['Maharashtra'], setting: 'show_customer_state' },
  {
    field: 'place_of_supply',
    markers: ['POS: Maharashtra', 'Place of Supply: Maharashtra', 'Place Of Supply: Maharashtra', 'PLACE OF SUPPLY Maharashtra', 'Place of Supply Maharashtra', 'Other Country'],
    setting: 'show_place_of_supply',
  },
  { field: 'po_number (purchase_order_number)', markers: ['ZQPO-7781'], setting: 'show_po_number' },
  { field: 'eway_bill_number', markers: ['ZQEWB-331122'], setting: 'show_eway_bill_number' },
  { field: 'reference_number', markers: ['ZQREF-5566'], setting: 'show_reference_number' },
  { field: 'delivery_note', markers: ['ZQDN-11'], setting: 'show_delivery_note' },
  { field: 'payment_terms (invoice)', markers: ['ZQPT-Net45'], setting: 'show_payment_terms' },
  { field: 'payment_terms (settings text)', markers: ['ZQSETPT'], setting: 'show_payment_terms' },
  { field: 'other_references', markers: ['ZQOR-22'], setting: 'show_other_references' },
  { field: 'dispatched_through', markers: ['ZQDT-BlueDart'], setting: 'show_dispatched_through' },
  { field: 'destination', markers: ['ZQDEST-Chakan'], setting: 'show_destination' },
  { field: 'terms_of_delivery', markers: ['ZQTOD-DoorDelivery'], setting: 'show_terms_of_delivery' },
  { field: 'item.name', markers: ['ZQAlpha Widget'], setting: 'show_item_name' },
  { field: 'item.description', markers: ['ZQDESC-ALPHA'] },
  { field: 'item.hsn', markers: ['84713010'], setting: 'show_hsn' },
  { field: 'item.unit', markers: ['BOX'], setting: 'show_unit' },
  { field: 'item.rate', markers: money(1111.11), setting: 'show_rate' },
  { field: 'item.discount_percent', markers: ['5%', '5.00%', '5 %'], setting: 'show_discount_percent' },
  { field: 'item.discount_amount', markers: money(166.67), setting: 'show_discount_amount' },
  { field: 'item.taxable_value', markers: money(3166.66) },
  { field: 'item.tax_amount', markers: money(570), setting: 'show_tax_amount' },
  { field: 'item.line_total', markers: money(3736.66), setting: 'show_line_total' },
  { field: 'item.custom_field (Colour)', markers: ['ZQCOLOUR-Teal'] },
  { field: 'invoice.custom_field (Site Code)', markers: ['ZQCF-SITE9'] },
  { field: 'subtotal', markers: money(4722.2), setting: 'show_subtotal' },
  { field: 'discount_total', markers: money(166.67), setting: 'show_discount_total' },
  { field: 'additional_charges', markers: money(150.25), setting: 'show_additional_charges' },
  { field: 'cgst_total', markers: money(378.33), setting: 'show_cgst' },
  { field: 'sgst_total', markers: money(378.33), setting: 'show_sgst' },
  { field: 'tax_total', markers: money(756.66), setting: 'show_tax_total' },
  { field: 'round_off', markers: money(0.89), setting: 'show_round_off' },
  { field: 'grand_total', markers: money(5630), setting: 'show_grand_total' },
  { field: 'amount_in_words', markers: ['Five Thousand Six Hundred Thirty'], setting: 'show_amount_in_words' },
  { field: 'paid_amount', markers: money(1234.56), setting: 'show_paid_amount' },
  { field: 'balance_amount', markers: money(4395.44), setting: 'show_balance_amount' },
  { field: 'bank.name', markers: ['ZQBANK of India'], setting: 'show_bank_name' },
  { field: 'bank.account_number', markers: ['001122334455'], setting: 'show_account_number' },
  { field: 'bank.ifsc', markers: ['ZQBK0001234'], setting: 'show_ifsc_code' },
  { field: 'bank.branch', markers: ['ZQBR-Baner'], setting: 'show_branch_name' },
  // The document's own notes/terms take precedence over the template's default text.
  { field: 'terms (invoice)', markers: ['ZQINVTERMS'], setting: 'show_terms' },
  { field: 'notes (invoice)', markers: ['ZQINVNOTE'], setting: 'show_notes' },
  { field: 'footer_text', markers: ['ZQSETFOOTER'] },
];

const EXPORT_CHECKS: Check[] = [
  ...INVOICE_CHECKS.filter((c) => !['cgst_total', 'sgst_total', 'document.number'].includes(c.field)),
  { field: 'document.number', markers: ['ZQEXP-0009'], setting: 'show_invoice_number' },
  { field: 'igst_total', markers: money(756.66), setting: 'show_igst' },
  { field: 'invoice_currency', markers: ['USD'], setting: 'show_invoice_currency' },
  { field: 'exchange_rate', markers: ['83.1234', '83.12'], setting: 'show_exchange_rate' },
  { field: 'country_of_origin', markers: ['ZQCOO-India'], setting: 'show_country_of_origin' },
  { field: 'port_of_loading', markers: ['ZQPOL-Nhava Sheva'], setting: 'show_port_of_loading' },
  { field: 'port_of_discharge', markers: ['ZQPOD-Jebel Ali'], setting: 'show_port_of_discharge' },
  { field: 'place_of_delivery', markers: ['ZQPODEL-Dubai'], setting: 'show_place_of_delivery' },
  { field: 'incoterms', markers: ['ZQINCO-CIF'], setting: 'show_incoterms' },
  { field: 'transport_mode', markers: ['ZQTM-Road'], setting: 'show_transport_mode' },
  { field: 'awb_number', markers: ['ZQAWB-7788'], setting: 'show_awb_number' },
  { field: 'bl_number', markers: ['ZQBL-9900'], setting: 'show_bl_number' },
  { field: 'buyer_tax_id', markers: ['ZQTAXID-AE100'], setting: 'show_buyer_tax_id' },
  { field: 'customer.country', markers: ['ZQCOUNTRY-UAE'], setting: 'show_customer_country' },
  { field: 'shipping_bill_number', markers: ['ZQSB-4455'] },
  { field: 'port_code', markers: ['ZQPC-INNSA1'] },
  { field: 'business.iec_code', markers: ['ZQIEC12345'], setting: 'show_business_iec' },
  { field: 'business.swift_code', markers: ['ZQSWIFTX'], setting: 'show_business_swift' },
];

const BOS_CHECKS: Check[] = INVOICE_CHECKS.filter(
  (c) => !['cgst_total', 'sgst_total', 'tax_total', 'item.tax_amount', 'amount_in_words', 'grand_total', 'balance_amount', 'item.line_total', 'item.taxable_value'].includes(c.field),
).concat([
  { field: 'amount_in_words', markers: ['Four Thousand Eight Hundred Seventy Three'], setting: 'show_amount_in_words' },
  { field: 'grand_total', markers: money(4873.34), setting: 'show_grand_total' },
  { field: 'balance_amount', markers: money(3638.78), setting: 'show_balance_amount' },
  { field: 'item.line_total (= taxable value)', markers: money(3166.66), setting: 'show_line_total' },
]);

const NOTE_CHECKS = (numberMarker: string, noteMarker: string, itemMarker: string): Check[] => [
  ...COMMON_CHECKS,
  { field: 'note.date', markers: ['22 September 2026', '23 September 2026'], setting: 'show_invoice_date' },
  { field: 'note.reason', markers: ['ZQREASON'] },
  { field: 'note.original_invoice', markers: ['ZQINV-0042', '20 September 2026'] },
  { field: 'note.notes', markers: [noteMarker], setting: 'show_notes' },
  { field: 'item.name/description', markers: [itemMarker], setting: 'show_item_name' },
  { field: 'item.hsn', markers: ['84713010', '996511'], setting: 'show_hsn' },
  { field: 'item.qty', markers: ['2', '1'] },
  { field: 'item.rate', markers: [...money(500), ...money(1000)], setting: 'show_rate' },
  { field: 'subtotal', markers: money(1000), setting: 'show_subtotal' },
  { field: 'cgst_total', markers: money(90), setting: 'show_cgst' },
  { field: 'grand_total', markers: money(1180), setting: 'show_grand_total' },
  { field: 'document.number (this note)', markers: [numberMarker] },
];

const CHALLAN_CHECKS: Check[] = [
  ...COMMON_CHECKS,
  { field: 'challan.date', markers: ['24 September 2026'], setting: 'show_invoice_date' },
  { field: 'ship_to', markers: ['ZQDCSHIP'], setting: 'show_customer_address' },
  { field: 'e_way_bill_number', markers: ['ZQEWB-DC-5511'], setting: 'show_eway_bill_number' },
  { field: 'vehicle_number', markers: ['ZQMH12AB1234'] },
  { field: 'transporter_name', markers: ['ZQTRANS Logistics'] },
  { field: 'transporter_gstin', markers: ['27TRANS1234T1Z1'] },
  { field: 'reason_for_transportation', markers: ['job_work', 'Job Work', 'JOB WORK'] },
  { field: 'dispatch_from_address', markers: ['ZQDISPATCH'] },
  { field: 'place_of_delivery', markers: ['ZQPLACEDEL'] },
  { field: 'linked invoice', markers: ['ZQINV-0042'] },
  { field: 'notes', markers: ['ZQDCNOTE'], setting: 'show_notes' },
  { field: 'item.name', markers: ['ZQAlpha Widget'], setting: 'show_item_name' },
  { field: 'item.hsn', markers: ['84713010'], setting: 'show_hsn' },
  { field: 'item.qty', markers: ['3'] },
  { field: 'item.unit', markers: ['BOX'], setting: 'show_unit' },
];

const ORDER_CHECKS = (numberMarker: string, noteMarker: string): Check[] => [
  ...INVOICE_CHECKS.filter(
    (c) => !['document.number', 'invoice.date', 'invoice.due_date', 'bill_to (invoice billing address)', 'ship_to (invoice shipping address)', 'po_number (purchase_order_number)', 'eway_bill_number', 'reference_number', 'delivery_note', 'payment_terms (invoice)', 'other_references', 'dispatched_through', 'destination', 'terms_of_delivery', 'invoice.custom_field (Site Code)', 'paid_amount', 'balance_amount', 'terms (invoice)', 'notes (invoice)', 'cgst_total', 'sgst_total'].includes(c.field),
  ),
  { field: 'document.number', markers: [numberMarker], setting: 'show_invoice_number' },
  { field: 'order.date', markers: ['18 September 2026'], setting: 'show_invoice_date' },
  { field: 'order.expected_delivery', markers: ['30 September 2026'], setting: 'show_due_date' },
  { field: 'bill_to', markers: ['ZQSOBILL'], setting: 'show_customer_address' },
  { field: 'ship_to', markers: ['ZQSOSHIP'], setting: 'show_ship_to' },
  { field: 'notes (order)', markers: [noteMarker], setting: 'show_notes' },
  { field: 'item.qty (qty column)', markers: ['3 BOX', '3.00', '>3<'] },
];

type Case = {
  id: string;
  templateId: string;
  table: DocumentTable;
  doc: Row;
  items: Row[];
  itemTable: string;
  checks: Check[];
  expectTitle?: string;
};

const TAX_TEMPLATES = ['gst_standard', 'modern', 'classic', 'elegant', 'minimal', 'business_pro', 'tally_style', 'gst_detailed', 'thermal_58mm', 'thermal_80mm'];

const CASES: Case[] = [
  ...TAX_TEMPLATES.map((t) => ({
    id: `tax_invoice__${t}`, templateId: t, table: 'invoices' as DocumentTable, doc: taxInvoiceRow,
    items: taxInvoiceItems, itemTable: 'invoice_items', checks: INVOICE_CHECKS, expectTitle: 'TAX INVOICE',
  })),
  {
    id: 'export__export_invoice', templateId: 'export_invoice', table: 'invoices', doc: exportInvoiceRow,
    items: exportItems, itemTable: 'invoice_items', checks: EXPORT_CHECKS, expectTitle: 'EXPORT INVOICE',
  },
  ...['composition_standard', 'composition_modern', 'tax_exempt'].map((t) => ({
    id: `bill_of_supply__${t}`, templateId: t, table: 'invoices' as DocumentTable, doc: billOfSupplyRow,
    items: billOfSupplyItems, itemTable: 'invoice_items', checks: BOS_CHECKS, expectTitle: 'BILL OF SUPPLY',
  })),
  {
    id: 'proforma__gst_standard', templateId: 'gst_standard', table: 'invoices', doc: proformaRow,
    items: taxInvoiceItems, itemTable: 'invoice_items', checks: INVOICE_CHECKS, expectTitle: 'PROFORMA',
  },
  {
    id: 'credit_note__credit_standard', templateId: 'credit_standard', table: 'credit_notes', doc: creditNoteRow,
    items: creditNoteItems, itemTable: 'credit_note_items',
    checks: NOTE_CHECKS('ZQCN-0007', 'ZQCNNOTE', 'ZQCNITEM'), expectTitle: 'CREDIT NOTE',
  },
  {
    id: 'debit_note__debit_standard', templateId: 'debit_standard', table: 'debit_notes', doc: debitNoteRow,
    items: debitNoteItems, itemTable: 'debit_note_items',
    checks: NOTE_CHECKS('ZQDBN-0004', 'ZQDNNOTE', 'ZQDNITEM'), expectTitle: 'DEBIT NOTE',
  },
  {
    id: 'delivery_challan__challan_standard', templateId: 'challan_standard', table: 'delivery_challans',
    doc: challanRow, items: challanItems, itemTable: 'delivery_challan_items', checks: CHALLAN_CHECKS,
    expectTitle: 'DELIVERY CHALLAN',
  },
  {
    id: 'sales_order__gst_standard', templateId: 'gst_standard', table: 'sales_orders', doc: salesOrderRow,
    items: orderItems, itemTable: 'sales_order_items', checks: ORDER_CHECKS('ZQSO-0021', 'ZQSONOTE'),
    expectTitle: 'SALES ORDER',
  },
  {
    id: 'purchase_order__gst_standard', templateId: 'gst_standard', table: 'purchase_orders', doc: purchaseOrderRow,
    items: orderItems, itemTable: 'purchase_order_items', checks: ORDER_CHECKS('ZQPUR-0031', 'ZQPONOTE'),
    expectTitle: 'PURCHASE ORDER',
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x3D;/g, '=')
    .replace(/\s+/g, ' ');
}

function occurrences(html: string, check: Check): number {
  const hay = check.raw ? html : visibleText(html);
  let n = 0;
  for (const m of check.markers) {
    const src = m.startsWith('>') ? html : hay;
    n += src.split(m).length - 1;
  }
  return n;
}

function isShown(html: string, check: Check): boolean {
  return occurrences(html, check) > 0;
}

/** Snippet after a label, for fields whose value cannot carry a marker (place of supply). */
function valueAfter(html: string, label: string): string {
  const t = visibleText(html);
  const i = t.indexOf(label);
  return i < 0 ? '' : t.slice(i + label.length, i + label.length + 40).trim();
}

async function render(c: Case, settings: Row) {
  state.doc = { ...c.doc, template_id: c.templateId };
  state.items = c.items;
  state.assignment = { template_id: c.templateId, settings };
  state.itemSql = [];
  const { html, templateId, settings: finalSettings, businessId } = await generateDocumentHtml(
    String(c.doc.id), c.table,
  );
  const printed = await finalizePrintHtml(html, templateId, finalSettings, businessId);
  return { html: printed, itemSql: state.itemSql[0] || '' };
}

function badItemColumns(sql: string, table: string): string[] {
  const cols = new Set(mockItemTableColumns[table] || []);
  const refs = Array.from(sql.matchAll(/\bii\.([a-z_]+)/g)).map((m) => m[1]);
  return Array.from(new Set(refs.filter((r) => r !== '*' && !cols.has(r))));
}

// ─── Audit ─────────────────────────────────────────────────────────────────────

type CaseResult = {
  id: string;
  templateId: string;
  error?: string;
  title?: string;
  titleOk?: boolean;
  missing: string[];
  shown: string[];
  toggleIgnored: string[];
  badItemSql: string[];
  placeOfSupply?: string;
};

const results: CaseResult[] = [];

beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(results, null, 2));
  const lines: string[] = ['# Template field audit', ''];
  for (const r of results) {
    lines.push(`## ${r.id}`);
    if (r.error) {
      lines.push(`- **Render failed:** ${r.error}`, '');
      continue;
    }
    lines.push(`- Title: ${r.title} ${r.titleOk ? '' : '(unexpected)'}`);
    if (r.placeOfSupply !== undefined) lines.push(`- Place of supply value: "${r.placeOfSupply}"`);
    if (r.badItemSql.length) lines.push(`- **Item SQL references missing columns:** ${r.badItemSql.join(', ')}`);
    lines.push(`- Missing with every setting on (${r.missing.length}): ${r.missing.join('; ') || '—'}`);
    lines.push(`- Setting has no effect (${r.toggleIgnored.length}): ${r.toggleIgnored.join('; ') || '—'}`);
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), lines.join('\n'));
});

describe('template field audit', () => {
  for (const c of CASES) {
    it(c.id, async () => {
      const result: CaseResult = {
        id: c.id, templateId: c.templateId, missing: [], shown: [], toggleIgnored: [], badItemSql: [],
      };
      results.push(result);
      const settings = allOnSettings(c.templateId);
      let html: string;
      try {
        const out = await render(c, settings);
        html = out.html;
        result.badItemSql = badItemColumns(out.itemSql, c.itemTable);
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
        return;
      }
      fs.writeFileSync(path.join(OUT_DIR, `${c.id}.html`), html);

      const text = visibleText(html);
      const titleMatch = text.match(/(TAX INVOICE|EXPORT INVOICE|BILL OF SUPPLY|PROFORMA[A-Z ]*|CREDIT NOTE|DEBIT NOTE|DELIVERY CHALLAN|SALES ORDER|PURCHASE ORDER|QUOTATION|ESTIMATE|INVOICE)/i);
      result.title = titleMatch?.[0];
      result.titleOk = !!c.expectTitle && text.toUpperCase().includes(c.expectTitle);
      if (c.checks.some((k) => k.field === 'place_of_supply')) {
        result.placeOfSupply = valueAfter(html, 'Place of Supply');
      }

      for (const check of c.checks) {
        if (isShown(html, check)) result.shown.push(check.field);
        else result.missing.push(check.field);
      }

      // For every field that shows, switching its setting off should hide it.
      for (const check of c.checks) {
        if (!check.setting || !result.shown.includes(check.field)) continue;
        if (check.field === 'place_of_supply') continue;
        const off = { ...settings, [check.setting]: false };
        const { html: offHtml } = await render(c, off);
        if (occurrences(offHtml, check) >= occurrences(html, check)) {
          result.toggleIgnored.push(`${check.setting} (${check.field})`);
        }
      }
    });
  }
});
