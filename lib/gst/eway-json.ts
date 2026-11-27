import type { PoolClient } from 'pg';
import { EwayBillInputError } from '@/lib/gst/eway-bills';
import { resolveSupplierRegistration, stateCodeFromName } from '@/lib/gst/registration';
import { warehouseStateCode } from '@/lib/gst/warehouse-registration';
import { loadTransferGodown } from '@/lib/stock-transfers/godowns';

/**
 * E-way bill JSON for the portal's bulk upload, built from a delivery challan or an invoice, so
 * Part A is not typed twice. Field names follow the NIC e-way bill generation payload. The
 * portal validates the file; check one upload against the current schema before relying on it.
 */

type Queryable = Pick<PoolClient, 'query'>;

/** NIC sub-supply type codes. */
export const SUB_SUPPLY_CODE: Record<string, number> = {
  supply: 1, import: 2, export: 3, job_work: 4, own_use: 5, job_work_returns: 6, sales_return: 7, others: 8,
  skd_ckd: 9, line_sales: 10, recipient_not_known: 11, exhibition: 12,
};

const STATE = (code: string | null | undefined) => Number(String(code || '').padStart(2, '0').slice(0, 2)) || 0;
const PIN = (p: string | null | undefined) => Number(String(p || '').replace(/\D/g, '').slice(0, 6)) || 0;
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
/** YYYY-MM-DD (dates are selected as text so no timezone shifts them) → DD/MM/YYYY. */
const dmy = (d: string) => {
  const s = String(d).slice(0, 10);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
};
const cut = (s: string | null | undefined, n: number) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Challan purpose or reason for transport → sub-supply type. */
export function challanSubSupply(c: { challan_kind?: string | null; purpose?: string | null; reason_for_transportation?: string | null }): { code: number; desc: string } {
  if (c.challan_kind === 'returnable' && c.purpose) {
    if (c.purpose === 'job_work') return { code: 4, desc: '' };
    if (c.purpose === 'exhibition') return { code: 12, desc: '' };
    return { code: 8, desc: cut(c.purpose.replace('_', ' '), 20) };
  }
  const code = SUB_SUPPLY_CODE[c.reason_for_transportation || 'supply'] ?? 1;
  return { code, desc: code === 8 ? 'Others' : '' };
}

/** Collapse whitespace and split at the last space or comma that fits, for the two NIC address lines. */
export function splitAddress(text: string | null | undefined, max = 120): [string, string] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return [t, ''];
  const head = t.slice(0, max + 1);
  const at = Math.max(head.lastIndexOf(' '), head.lastIndexOf(','));
  const i = at > 0 ? at : max;
  return [t.slice(0, i).trim(), t.slice(i).replace(/^[\s,]+/, '').slice(0, max)];
}

/** Ship-to city, PIN code and state code typed for a document whose address is not saved on the customer. */
export type ShipToPlace = { place: string; pincode: string; stateCode: string };

const norm = (s: string | null | undefined) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

interface Party {
  gstin: string | null;
  name: string;
  addr1: string;
  addr2: string;
  place: string;
  pincode: number;
  /** State of the GSTIN (fromStateCode / toStateCode). */
  state: number;
  /** State the goods actually leave from or reach, when it differs. */
  actState?: number;
  /** Seller only: goods leave from a pincode other than the registration's. */
  dispatchDiffers?: boolean;
  /** Customer only: goods go to a place other than the billing address. */
  shipTo?: { gstin: string; tradeName: string } | null;
}

/**
 * Consignor. GSTIN and fromStateCode are the registration the document is issued under (a branch
 * without its own GSTIN trades under the head office). The dispatch address and actFromStateCode
 * are where the goods physically leave: the godown when one is known, else the branch's own address.
 */
async function seller(db: Queryable, businessId: string, branchId: string | null, warehouseId?: string | null): Promise<Party> {
  const reg = await resolveSupplierRegistration(db as any, businessId, branchId);
  if (!reg.gstin) throw new EwayBillInputError('Add the GSTIN of this business (or branch) before making e-way bill JSON');
  const r = await db.query(
    `SELECT b.name,
            w.address_line1 AS w_a1, w.address_line2 AS w_a2, w.city AS w_city, w.pincode AS w_pin, w.state AS w_state, w.gstin AS w_gstin,
            br.address_line1 AS br_a1, br.address_line2 AS br_a2, br.city AS br_city, br.pincode AS br_pin,
            br.state AS br_state, br.state_code AS br_state_code
       FROM businesses b
       LEFT JOIN branches br ON br.id = $2::uuid AND br.business_id = b.id
       LEFT JOIN warehouses w ON w.id = $3::uuid AND w.business_id = b.id
      WHERE b.id = $1`,
    [businessId, branchId, warehouseId ?? null]
  );
  const x = r.rows[0] ?? {};
  const regState = STATE(reg.stateCode);
  let place = { a1: reg.addressLine1, a2: reg.addressLine2, city: reg.city, pin: reg.pincode, st: regState };
  if (x.w_a1 || x.w_pin) {
    const st = warehouseStateCode({ gstin: x.w_gstin, state: x.w_state });
    place = { a1: x.w_a1, a2: x.w_a2, city: x.w_city, pin: x.w_pin, st: st ? STATE(st) : regState };
  } else if (x.br_a1 || x.br_pin) {
    const st = x.br_state_code?.trim() || stateCodeFromName(x.br_state);
    place = { a1: x.br_a1, a2: x.br_a2, city: x.br_city, pin: x.br_pin, st: st ? STATE(st) : regState };
  }
  return {
    gstin: reg.gstin,
    name: cut(x.name, 100),
    addr1: cut(place.a1, 120),
    addr2: cut(place.a2, 120),
    place: cut(place.city, 50),
    pincode: PIN(place.pin),
    state: regState,
    actState: place.st,
    dispatchDiffers: PIN(place.pin) !== PIN(reg.pincode),
  };
}

async function party(
  db: Queryable, businessId: string, kind: 'customer' | 'supplier', id: string | null, docShipping?: string | null, shipToGstin?: string | null, shipTo?: ShipToPlace | null
): Promise<Party> {
  if (!id) throw new EwayBillInputError('The document has no party to send the goods to');
  const r = await db.query(
    kind === 'customer'
      ? `SELECT gstin, COALESCE(company_name, name) AS name, COALESCE(billing_address, address) AS billing, city, pincode AS pin, state_code AS st,
                shipping_address AS ship_addr, shipping_city AS ship_city, shipping_state AS ship_state, shipping_pincode AS ship_pin
           FROM customers WHERE id = $1 AND business_id = $2`
      : `SELECT gstin, name, address AS billing, city, pincode AS pin, state_code AS st FROM suppliers WHERE id = $1 AND business_id = $2`,
    [id, businessId]
  );
  const x = r.rows[0];
  if (!x) throw new EwayBillInputError('Party not found', 404);
  const shipAddr = String(docShipping || x.ship_addr || '').trim();
  const differs = (!!shipAddr && norm(shipAddr) !== norm(x.billing)) || !!shipToGstin;
  const state = STATE(x.st);
  // Where the goods go: typed by the caller, else the customer's saved shipping place, else (a gstin-only ship-to) the billing place.
  let place = { addr: x.billing as string, city: x.city as string, pin: x.pin as string, act: undefined as number | undefined };
  if (differs && shipTo) {
    place = { addr: shipAddr || x.billing, city: shipTo.place, pin: shipTo.pincode, act: STATE(shipTo.stateCode) || state };
  } else if (differs && shipAddr) {
    if (norm(shipAddr) !== norm(x.ship_addr)) {
      throw new EwayBillInputError('This document ships to an address that is not saved on the customer. Enter the ship-to city, PIN code and state.');
    }
    place = { addr: shipAddr, city: x.ship_city || x.city, pin: x.ship_pin || x.pin, act: STATE(stateCodeFromName(x.ship_state)) || state };
  }
  const [addr1, addr2] = splitAddress(place.addr);
  return {
    gstin: x.gstin || 'URP',
    name: cut(x.name, 100),
    addr1,
    addr2,
    place: cut(place.city, 50),
    pincode: PIN(place.pin),
    state,
    actState: place.act,
    // A ship-to GSTIN other than the buyer's is another business, whose name we do not hold: leave it blank (optional at the portal).
    shipTo: differs
      ? { gstin: shipToGstin || x.gstin || 'URP', tradeName: shipToGstin && shipToGstin !== x.gstin ? '' : cut(x.name, 100) }
      : null,
  };
}

/**
 * Both ends of a stock transfer's challan: each godown's own address, under the GSTIN of the branch
 * it belongs to (the same GSTIN at both ends, since only those transfers get a challan). The
 * godowns come from the transfer, so challans made before `to_warehouse_id` was set work too.
 */
async function transferParties(db: Queryable, businessId: string, transferId: string): Promise<{ from: Party; to: Party } | null> {
  const t = (
    await db.query(`SELECT from_location_id, to_location_id FROM stock_transfers WHERE id = $1 AND business_id = $2`, [transferId, businessId])
  ).rows[0];
  if (!t) return null;
  const end = async (warehouseId: string): Promise<Party> => {
    const w = await loadTransferGodown(db, businessId, warehouseId);
    if (!w) throw new EwayBillInputError('Transfer godown not found', 404);
    if (!w.address_line1 || !PIN(w.pincode)) {
      throw new EwayBillInputError(`Add the address and PIN code of the ${w.name} godown before making e-way bill JSON`);
    }
    const s = await seller(db, businessId, w.branch_id, w.id);
    return { ...s, name: cut(`${s.name} (${w.name})`, 100) };
  };
  return { from: await end(t.from_location_id), to: await end(t.to_location_id) };
}

function bill(p: {
  docType: 'INV' | 'CHL' | 'BIL';
  docNo: string;
  docDate: string;
  sub: { code: number; desc: string };
  from: Party;
  to: Party;
  lines: any[];
  distanceKm: number;
  vehicle?: string | null;
  transporterGstin?: string | null;
  transporterName?: string | null;
  transactionType: 1 | 2 | 3 | 4;
  totInvValue?: number;
}) {
  const sum = (k: string) => r2(p.lines.reduce((s, l) => s + (Number(l[k]) || 0), 0));
  const taxable = sum('taxable_value');
  const cgst = sum('cgst_amount');
  const sgst = sum('sgst_amount');
  const igst = sum('igst_amount');
  const cess = sum('cess_amount');
  const main = [...p.lines].sort((a, b) => (Number(b.taxable_value) || 0) - (Number(a.taxable_value) || 0))[0];
  const inter = p.from.state !== p.to.state;
  return {
    supplyType: 'O',
    subSupplyType: p.sub.code,
    subSupplyDesc: p.sub.desc,
    docType: p.docType,
    docNo: p.docNo,
    docDate: dmy(p.docDate),
    fromGstin: p.from.gstin,
    fromTrdName: p.from.name,
    fromAddr1: p.from.addr1,
    fromAddr2: p.from.addr2,
    fromPlace: p.from.place,
    fromPincode: p.from.pincode,
    actFromStateCode: p.from.actState ?? p.from.state,
    fromStateCode: p.from.state,
    toGstin: p.to.gstin,
    toTrdName: p.to.name,
    toAddr1: p.to.addr1,
    toAddr2: p.to.addr2,
    toPlace: p.to.place,
    toPincode: p.to.pincode,
    actToStateCode: p.to.actState ?? p.to.state,
    toStateCode: p.to.state,
    transactionType: p.transactionType,
    otherValue: 0,
    totalValue: taxable,
    cgstValue: cgst,
    sgstValue: sgst,
    igstValue: igst,
    cessValue: cess,
    cessNonAdvolValue: 0,
    totInvValue: Math.max(r2(taxable + cgst + sgst + igst + cess), p.totInvValue ?? 0),
    transporterId: p.transporterGstin || '',
    transporterName: cut(p.transporterName, 100),
    transDocNo: '',
    transMode: '1',
    transDistance: String(Math.max(0, Math.round(p.distanceKm))),
    transDocDate: '',
    vehicleNo: String(p.vehicle || '').toUpperCase().replace(/\s+/g, ''),
    vehicleType: 'R',
    mainHsnCode: Number(String(main?.hsn_sac || '').replace(/\D/g, '')) || 0,
    itemList: p.lines.map((l, i) => {
      const rate = Number(l.tax_rate) || 0;
      return {
        itemNo: i + 1,
        productName: cut(l.item_name, 100),
        productDesc: cut(l.description || l.item_name, 100),
        hsnCode: Number(String(l.hsn_sac || '').replace(/\D/g, '')) || 0,
        // In the item's own unit: 5 BOX of 12 travels as 60 PCS under the item's UQC.
        quantity: Math.round((Number(l.qty ?? l.quantity) || 0) * (Number(l.unit_factor) || 1) * 1000) / 1000,
        qtyUnit: cut(l.uqc || ((Number(l.unit_factor) || 1) !== 1 ? l.item_unit : l.unit) || l.unit || 'OTH', 3).toUpperCase(),
        cgstRate: inter ? 0 : rate / 2,
        sgstRate: inter ? 0 : rate / 2,
        igstRate: inter ? rate : 0,
        cessRate: 0,
        cessNonadvol: 0,
        taxableAmount: r2(l.taxable_value),
      };
    }),
  };
}

export type NicEwayBill = ReturnType<typeof bill> & { shipToGstin: string | null; shipToTradeName: string | null };

/** The NIC-shaped bill for one document, plus the ship-to GSTIN and name an API call needs. */
export async function buildEwayBill(
  db: Queryable,
  businessId: string,
  sourceType: 'delivery_challan' | 'invoice',
  sourceId: string,
  opts: { distanceKm: number; shipToGstin?: string | null; shipTo?: ShipToPlace | null }
): Promise<NicEwayBill> {
  if (!Number.isFinite(opts.distanceKm) || opts.distanceKm < 0 || opts.distanceKm > 4000) {
    throw new EwayBillInputError('Enter the distance in km (0 to 4000)');
  }
  const finish = (p: Omit<Parameters<typeof bill>[0], 'transactionType' | 'distanceKm'>): NicEwayBill => {
    if (String(p.docNo || '').length > 16) {
      throw new EwayBillInputError(`Document number ${p.docNo} is longer than 16 characters, the limit for an e-way bill. Use a shorter number series.`);
    }
    const ship = !!p.to.shipTo;
    const disp = !!p.from.dispatchDiffers;
    const transactionType = ship && disp ? 4 : ship ? 2 : disp ? 3 : 1;
    return {
      ...bill({ ...p, distanceKm: opts.distanceKm, transactionType }),
      shipToGstin: p.to.shipTo?.gstin ?? null,
      shipToTradeName: p.to.shipTo?.tradeName ?? null,
    };
  };
  if (sourceType === 'delivery_challan') {
    const c = (await db.query(`SELECT *, challan_date::text AS challan_date FROM delivery_challans WHERE id = $1 AND business_id = $2`, [sourceId, businessId])).rows[0];
    if (!c) throw new EwayBillInputError('Delivery challan not found', 404);
    const lines = (
      await db.query(
        `SELECT dci.*, i.uqc, i.unit AS item_unit FROM delivery_challan_items dci LEFT JOIN items i ON i.id = dci.item_id
          WHERE dci.delivery_challan_id = $1 ORDER BY dci.sort_order`,
        [sourceId]
      )
    ).rows;
    // A stock transfer on one GSTIN ships to ourselves: same GSTIN, godown to godown.
    const transferEnds = c.stock_transfer_id ? await transferParties(db, businessId, c.stock_transfer_id) : null;
    const from = transferEnds ? transferEnds.from : await seller(db, businessId, c.branch_id, c.warehouse_id);
    const to = transferEnds
      ? transferEnds.to
      : c.supplier_id
        ? await party(db, businessId, 'supplier', c.supplier_id, null, opts.shipToGstin, opts.shipTo)
        : await party(db, businessId, 'customer', c.customer_id, c.shipping_address, opts.shipToGstin, opts.shipTo);
    return finish({
      docType: 'CHL', docNo: c.challan_number, docDate: c.challan_date, sub: challanSubSupply(c),
      from, to, lines,
      vehicle: c.vehicle_number, transporterGstin: c.transporter_gstin, transporterName: c.transporter_name,
    });
  }
  const inv = (await db.query(`SELECT *, invoice_date::text AS invoice_date FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`, [sourceId, businessId])).rows[0];
  if (!inv) throw new EwayBillInputError('Invoice not found', 404);
  if (inv.status !== 'final') throw new EwayBillInputError('Finalise the invoice first', 409);
  const lines = (
    await db.query(
      `SELECT ii.*, i.uqc, i.unit AS item_unit FROM invoice_items ii LEFT JOIN items i ON i.id = ii.item_id
        WHERE ii.invoice_id = $1 AND COALESCE(ii.hsn_sac, '') NOT LIKE '99%'`,
      [sourceId]
    )
  ).rows;
  if (!lines.length) throw new EwayBillInputError('This invoice has no goods lines');
  return finish({
    docType: inv.document_type === 'bill_of_supply' ? 'BIL' : 'INV', docNo: inv.invoice_number, docDate: inv.invoice_date,
    sub: { code: inv.export_type ? 3 : 1, desc: '' }, from: await seller(db, businessId, inv.branch_id, lines.find((l: any) => l.location_id)?.location_id),
    to: await party(db, businessId, 'customer', inv.customer_id, inv.shipping_address, opts.shipToGstin, opts.shipTo), lines,
    totInvValue: Number(inv.grand_total) || 0,
  });
}

/** Bulk-upload file for one document: `{ version, billLists: [bill] }`, without the API-only ship-to fields. */
export async function ewayBulkJson(
  db: Queryable,
  businessId: string,
  sourceType: 'delivery_challan' | 'invoice',
  sourceId: string,
  opts: { distanceKm: number; shipTo?: ShipToPlace | null }
) {
  const { shipToGstin: _g, shipToTradeName: _n, ...b } = await buildEwayBill(db, businessId, sourceType, sourceId, opts);
  return { version: '1.0.0621', billLists: [b] };
}
