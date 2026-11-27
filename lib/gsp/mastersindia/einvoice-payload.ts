// Masters India e-invoice: build the request body for one final sales invoice, or the plain-language problems
// the user must fix first. Pure apart from reads: no network call, nothing written, never throws for a data problem.
import type { PoolClient } from 'pg';
import { EwayBillInputError } from '@/lib/gst/eway-bills';
import { resolveSupplierRegistration } from '@/lib/gst/registration';
import { PIN, STATE, cut, customerParty, dmy, r2, sellerParty, splitAddress, type ShipToPlace } from '@/lib/gst/eway-json';
import type { EwayTransport } from './eway';

type Queryable = Pick<PoolClient, 'query'>;
type Row = Record<string, any>;
type Obj = Record<string, unknown>;

export type EinvoiceProblem = { field: string; message: string; fix?: { kind: 'customer' | 'item' | 'business' | 'invoice'; id: string | null } };
export type EinvoiceBuild = { payload: Record<string, unknown> | null; problems: EinvoiceProblem[]; sellerGstin: string | null; docNumber: string; docDate: string };
export type EinvoiceOpts = { ewb?: { distanceKm: number; transport: EwayTransport } | null; shipTo?: ShipToPlace | null };

const MAX_ITEMS = 1000;
const ROUND_OFF_LIMIT = 99.99;
const DOC_NUMBER = /^[1-9A-Za-z][0-9A-Za-z/-]{0,15}$/;
const SUPPLY: Record<string, (exportType: string | null) => string> = {
  b2b: () => 'B2B',
  deemed_export: () => 'DEXP',
  export: (t) => (t === 'wop' ? 'EXPWOP' : 'EXPWP'),
  sez: (t) => (t === 'wop' ? 'SEZWOP' : 'SEZWP'),
};
const MODE: Record<string, string> = { road: '1', rail: '2', air: '3', ship: '4' };

const two = (code: string | number | null | undefined) => String(code ?? '').trim().padStart(2, '0').slice(0, 2);
const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');
const validPin = (s: string | null | undefined) => /^\d{6}$/.test(digits(s));
const isService = (l: Row) => String(l.hsn_sac ?? '').startsWith('99');
const taxOf = (l: Row) => r2(l.cgst_amount) + r2(l.sgst_amount) + r2(l.igst_amount) + r2(l.cess_amount);
const itemValue = (l: Row) => r2(r2(l.taxable_value) + r2(l.cgst_amount) + r2(l.sgst_amount) + r2(l.igst_amount) + r2(l.cess_amount));
const factor = (l: Row) => Number(l.unit_factor) || 1;
/** Two address lines of at most 100 characters: line 1 as typed (overflow moves to line 2), then line 2. */
const addr100 = (a: string | null | undefined, b?: string | null): [string, string] => {
  const [head, tail] = splitAddress(a, 100);
  return [head, cut([tail, b].filter(Boolean).join(' '), 100)];
};

const lineAmount = (l: Row) => r2(r2(l.taxable_value) + r2(l.discount_amount));
const qtyOf = (l: Row) => Math.round((Number(l.quantity) || 0) * factor(l) * 1000) / 1000;
/** Pre-tax price per unit that fits total_amount: the stored price may include GST or leave out freight spread into the line. */
const unitPrice = (l: Row) => (qtyOf(l) > 0 ? Math.round((lineAmount(l) / qtyOf(l)) * 1000) / 1000 : lineAmount(l));

function itemList(lines: Row[]): Obj[] {
  return lines.map((l, i) => ({
    item_serial_number: String(i + 1),
    product_description: cut(l.item_name, 300),
    is_service: isService(l) ? 'Y' : 'N',
    hsn_code: digits(l.hsn_sac),
    // In the item's own unit: 5 BOX of 12 goes out as 60 PCS, so the price is per PCS.
    quantity: qtyOf(l),
    unit: cut(l.uqc || l.unit, 8).toUpperCase() || 'OTH',
    unit_price: unitPrice(l),
    total_amount: lineAmount(l),
    discount: r2(l.discount_amount),
    assessable_value: r2(l.taxable_value),
    gst_rate: Number(l.tax_rate) || 0,
    igst_amount: r2(l.igst_amount),
    cgst_amount: r2(l.cgst_amount),
    sgst_amount: r2(l.sgst_amount),
    cess_amount: r2(l.cess_amount),
    total_item_value: itemValue(l),
  }));
}

function valueDetails(lines: Row[], grandTotal: number): Obj {
  const sum = (k: string) => r2(lines.reduce((s, l) => s + r2(l[k]), 0));
  return {
    total_assessable_value: sum('taxable_value'),
    total_cgst_value: sum('cgst_amount'),
    total_sgst_value: sum('sgst_amount'),
    total_igst_value: sum('igst_amount'),
    total_cess_value: sum('cess_amount'),
    total_discount: 0,
    total_other_charge: 0,
    round_off_amount: r2(grandTotal - lines.reduce((s, l) => s + itemValue(l), 0)),
    total_invoice_value: grandTotal,
  };
}

function sellerDetails(reg: Awaited<ReturnType<typeof resolveSupplierRegistration>>, name: string): Obj {
  const [address1, address2] = addr100(reg.addressLine1, reg.addressLine2);
  const phone = digits(reg.phone);
  const out: Obj = {
    gstin: reg.gstin, legal_name: name, address1, address2, location: cut(reg.city, 50), pincode: PIN(reg.pincode),
    state_code: two(reg.stateCode ?? reg.gstin?.slice(0, 2)),
  };
  if (phone.length >= 6 && phone.length <= 12) out.phone_number = phone;
  if (reg.email?.trim()) out.email = reg.email.trim();
  return out;
}

function buyerDetails(inv: Row, c: Row, gstin: string, pos: string, isExport: boolean): Obj {
  const [address1, address2] = addr100(c.billing);
  if (isExport) return { gstin: 'URP', legal_name: cut(c.name, 100), address1, address2, location: cut(c.city, 50) || 'Other Country', pincode: 999999, state_code: '96', place_of_supply: '96' };
  return {
    gstin, legal_name: cut(c.name, 100), address1, address2, location: cut(c.city, 50), pincode: PIN(c.pin),
    state_code: two(gstin.slice(0, 2)), place_of_supply: pos,
  };
}

type Placed = { name: string; addr1: string; addr2: string; place: string; pincode: number; state: number; actState?: number };
const placeBlock = (p: Placed) => {
  const [address1, address2] = addr100(p.addr1, p.addr2);
  return { address1, address2, location: p.place, pincode: p.pincode, state_code: two(p.actState ?? p.state) };
};

function ewaybillDetails(e: NonNullable<EinvoiceOpts['ewb']>): Obj {
  const t = e.transport;
  return {
    transporter_id: t.transporterId ?? '',
    transporter_name: cut(t.transporterName, 100),
    transportation_mode: MODE[t.mode] ?? '1',
    transportation_distance: Math.max(0, Math.round(e.distanceKm)),
    transporter_document_number: t.docNumber ?? '',
    transporter_document_date: t.docDate ? dmy(t.docDate) : '',
    vehicle_number: String(t.vehicleNumber ?? '').toUpperCase().replace(/\s+/g, ''),
    vehicle_type: t.isOdc ? 'O' : 'R',
  };
}

/** Request body for one invoice, or the list of things to fix first (payload is then null). */
export async function buildEinvoice(db: Queryable, businessId: string, invoiceId: string, opts: EinvoiceOpts = {}): Promise<EinvoiceBuild> {
  const problems: EinvoiceProblem[] = [];
  const add = (field: string, message: string, fix?: EinvoiceProblem['fix']) => problems.push(fix ? { field, message, fix } : { field, message });

  const inv = (
    await db.query(
      `SELECT *, invoice_date::text AS invoice_date, shipping_bill_date::text AS shipping_bill_date
         FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [invoiceId, businessId]
    )
  ).rows[0];
  if (!inv) return { payload: null, problems: [{ field: 'invoice', message: 'Invoice not found' }], sellerGstin: null, docNumber: '', docDate: '' };
  const docNumber = String(inv.invoice_number ?? '');
  const docDate = dmy(inv.invoice_date);
  const supplyType = String(inv.supply_type ?? '');
  const result = (payload: Obj | null, sellerGstin: string | null): EinvoiceBuild => ({ payload: problems.length ? null : payload, problems, sellerGstin, docNumber, docDate });
  const invFix = { kind: 'invoice' as const, id: String(inv.id) };

  // Document level.
  if (['proforma_invoice', 'bill_of_supply'].includes(inv.document_type) || !SUPPLY[supplyType]) {
    add('invoice', 'This invoice does not need an e-invoice');
    return result(null, null);
  }
  if (inv.status !== 'final') add('invoice', 'Finalise the invoice first', invFix);
  if (inv.irn_status === 'active') add('invoice', 'This invoice already has an e-invoice', invFix);
  if (!DOC_NUMBER.test(docNumber)) {
    add('document_number', `Invoice number ${docNumber} cannot be used for an e-invoice. It must be at most 16 characters, use only letters, digits, / and -, and not start with 0, / or -.`, invFix);
  }
  const isExport = supplyType === 'export';

  const lines: Row[] = (
    await db.query(
      `SELECT ii.*, i.uqc, i.unit AS item_unit FROM invoice_items ii LEFT JOIN items i ON i.id = ii.item_id
        WHERE ii.invoice_id = $1 ORDER BY ii.sort_order`,
      [invoiceId]
    )
  ).rows;
  const c = (
    await db.query(
      `SELECT gstin, COALESCE(company_name, name) AS name, COALESCE(billing_address, address) AS billing, city, pincode AS pin, state_code AS st
         FROM customers WHERE id = $1 AND business_id = $2`,
      [inv.customer_id, businessId]
    )
  ).rows[0];

  // Seller.
  const reg = await resolveSupplierRegistration(db as any, businessId, inv.branch_id);
  const sellerGstin = reg.gstin;
  const seller = sellerGstin ? await sellerParty(db, businessId, inv.branch_id, lines.find((l) => l.location_id)?.location_id) : null;
  if (!sellerGstin) add('seller_gstin', 'Add your GSTIN in Business settings', { kind: 'business', id: null });
  if (!validPin(reg.pincode)) add('seller_pincode', 'Add the PIN code of your business address', { kind: 'business', id: null });
  if (cut(reg.addressLine1, 100).length < 3) add('seller_address', 'Add your business address in Business settings', { kind: 'business', id: null });
  if (cut(reg.city, 50).length < 3) add('seller_city', 'Add the city of your business address in Business settings', { kind: 'business', id: null });

  // Buyer.
  const custFix = { kind: 'customer' as const, id: inv.customer_id ?? null };
  const buyerGstin = String(inv.customer_gstin || c?.gstin || '').trim().toUpperCase();
  if (!c) add('customer', 'Choose the customer', invFix);
  const buyerState = buyerGstin ? two(buyerGstin.slice(0, 2)) : c?.st ? two(c.st) : '';
  const pos = isExport ? '96' : inv.place_of_supply_state_code ? two(inv.place_of_supply_state_code) : buyerState;
  if (c) {
    if (!isExport && !buyerGstin) add('buyer_gstin', "Add the customer's GSTIN", custFix);
    if (!isExport && !validPin(c.pin)) add('buyer_pincode', `Add the PIN code of ${c.name}`, custFix);
    if (cut(c.billing, 100).length < 3) add('buyer_address', `Add the address of ${c.name}`, custFix);
    if (!isExport && cut(c.city, 50).length < 3) add('buyer_city', `Add the city of ${c.name}`, custFix);
  }
  if (c && !isExport) {
    if (!pos) add('place_of_supply', 'Choose the place of supply', invFix);
  }

  // Ship-to: only a problem when an e-way bill is asked for with an address the customer does not have saved.
  let ship: Awaited<ReturnType<typeof customerParty>> | null = null;
  if (c && isExport) {
    // The foreign customer's own state and PIN code mean nothing here: only a typed Indian port place counts.
    if (opts.shipTo) {
      ship = { gstin: 'URP', name: cut(c.name, 100), addr1: cut(inv.shipping_address || c.billing, 120), addr2: '', place: cut(opts.shipTo.place, 50), pincode: PIN(opts.shipTo.pincode), state: STATE(opts.shipTo.stateCode), shipTo: { gstin: 'URP', tradeName: cut(c.name, 100) } };
    }
  } else if (c) {
    try {
      ship = await customerParty(db, businessId, 'customer', inv.customer_id, inv.shipping_address, null, opts.shipTo);
    } catch (e) {
      if (!(e instanceof EwayBillInputError) || !/not saved on the customer/.test(e.message)) throw e;
      if (opts.ewb) add('ship_to', 'Enter the ship-to city, PIN code and state', invFix);
    }
  }

  // Lines.
  const inter = (reg.stateCode ? two(reg.stateCode) : '') !== pos || isExport || supplyType === 'sez';
  let wrongTax = false;
  lines.forEach((l) => {
    const fix = { kind: 'item' as const, id: l.item_id ?? null };
    if (!/^\d{4,8}$/.test(String(l.hsn_sac ?? '').trim())) add('hsn', `Add the HSN code for ${l.item_name}`, fix);
    else if (!isService(l) && !(Number(l.quantity) > 0)) add('quantity', `Enter the quantity for ${l.item_name}`, fix);
    const zero = !(Number(l.tax_rate) > 0) && taxOf(l) === 0;
    if (!zero && !wrongTax && pos) {
      if (inter && (r2(l.cgst_amount) || r2(l.sgst_amount))) { add('tax_type', 'This is an inter-state supply, so it must carry IGST', invFix); wrongTax = true; }
      else if (!inter && r2(l.igst_amount)) { add('tax_type', 'This is a supply within the state, so it must carry CGST and SGST', invFix); wrongTax = true; }
    }
  });
  if (!lines.length) add('items', 'The invoice has no items', invFix);
  if (lines.length > MAX_ITEMS) add('items', `An e-invoice can carry at most ${MAX_ITEMS} items`, invFix);

  // Totals and e-way bill.
  const values = valueDetails(lines, r2(inv.grand_total));
  if (Math.abs(values.round_off_amount as number) > ROUND_OFF_LIMIT) add('total', `The invoice total differs from its lines by more than ₹${ROUND_OFF_LIMIT}`, invFix);
  if (opts.ewb && lines.length && lines.every(isService)) add('ewaybill', 'An e-way bill needs at least one goods line', invFix);
  if (problems.length || !seller || !c) return result(null, sellerGstin);

  const payload: Obj = {
    user_gstin: sellerGstin,
    data_source: 'erp',
    transaction_details: {
      supply_type: SUPPLY[supplyType](inv.export_type ?? null),
      charge_type: inv.is_reverse_charge ? 'Y' : 'N',
      igst_on_intra: 'N',
      ecommerce_gstin: inv.ecommerce_operator_gstin || '',
    },
    document_details: { document_type: 'INV', document_number: docNumber, document_date: docDate },
    seller_details: sellerDetails(reg, seller.name),
    buyer_details: buyerDetails(inv, c, buyerGstin, pos, isExport),
  };
  if (seller.dispatchDiffers) payload.dispatch_details = { company_name: seller.name, ...placeBlock(seller) };
  if (ship?.shipTo) payload.ship_details = { gstin: ship.shipTo.gstin === 'URP' ? 'URP' : buyerGstin || ship.shipTo.gstin, legal_name: cut(c.name, 100), ...placeBlock(ship) };
  if (isExport) {
    payload.export_details = {
      ship_bill_number: cut(inv.shipping_bill_number, 16), ship_bill_date: inv.shipping_bill_date ? dmy(inv.shipping_bill_date) : '',
      port_code: cut(inv.port_code, 10), refund_claim: 'N',
    };
  }
  payload.value_details = values;
  payload.item_list = itemList(lines);
  if (opts.ewb) payload.ewaybill_details = ewaybillDetails(opts.ewb);
  return result(payload, sellerGstin);
}
