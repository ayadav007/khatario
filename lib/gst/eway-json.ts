import type { PoolClient } from 'pg';
import { EwayBillInputError } from '@/lib/gst/eway-bills';

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

interface Party {
  gstin: string | null;
  name: string;
  addr1: string;
  addr2: string;
  place: string;
  pincode: number;
  state: number;
}

async function seller(db: Queryable, businessId: string, branchId: string | null): Promise<Party> {
  const r = await db.query(
    `SELECT COALESCE(br.gstin, b.gstin) AS gstin, b.name,
            COALESCE(br.address_line1, b.address_line1) AS a1, COALESCE(br.address_line2, b.address_line2) AS a2,
            COALESCE(br.city, b.city) AS city, COALESCE(br.pincode, b.pincode) AS pin, COALESCE(br.state_code, b.state_code) AS st
       FROM businesses b LEFT JOIN branches br ON br.id = $2 AND br.business_id = b.id
      WHERE b.id = $1`,
    [businessId, branchId]
  );
  const x = r.rows[0];
  if (!x?.gstin) throw new EwayBillInputError('Add the GSTIN of this business (or branch) before making e-way bill JSON');
  return { gstin: x.gstin, name: cut(x.name, 100), addr1: cut(x.a1, 120), addr2: cut(x.a2, 120), place: cut(x.city, 50), pincode: PIN(x.pin), state: STATE(x.st) };
}

async function party(db: Queryable, businessId: string, kind: 'customer' | 'supplier', id: string | null, shipTo?: string | null): Promise<Party> {
  if (!id) throw new EwayBillInputError('The document has no party to send the goods to');
  const r = await db.query(
    kind === 'customer'
      ? `SELECT gstin, COALESCE(company_name, name) AS name, COALESCE(shipping_address, address) AS a1, COALESCE(shipping_city, city) AS city,
                COALESCE(shipping_pincode, pincode) AS pin, state_code AS st FROM customers WHERE id = $1 AND business_id = $2`
      : `SELECT gstin, name, address AS a1, city, pincode AS pin, state_code AS st FROM suppliers WHERE id = $1 AND business_id = $2`,
    [id, businessId]
  );
  const x = r.rows[0];
  if (!x) throw new EwayBillInputError('Party not found', 404);
  return {
    gstin: x.gstin || 'URP',
    name: cut(x.name, 100),
    addr1: cut(shipTo || x.a1, 120),
    addr2: '',
    place: cut(x.city, 50),
    pincode: PIN(x.pin),
    state: STATE(x.st),
  };
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
    docNo: cut(p.docNo, 16),
    docDate: dmy(p.docDate),
    fromGstin: p.from.gstin,
    fromTrdName: p.from.name,
    fromAddr1: p.from.addr1,
    fromAddr2: p.from.addr2,
    fromPlace: p.from.place,
    fromPincode: p.from.pincode,
    actFromStateCode: p.from.state,
    fromStateCode: p.from.state,
    toGstin: p.to.gstin,
    toTrdName: p.to.name,
    toAddr1: p.to.addr1,
    toAddr2: p.to.addr2,
    toPlace: p.to.place,
    toPincode: p.to.pincode,
    actToStateCode: p.to.state,
    toStateCode: p.to.state,
    transactionType: 1,
    otherValue: 0,
    totalValue: taxable,
    cgstValue: cgst,
    sgstValue: sgst,
    igstValue: igst,
    cessValue: cess,
    cessNonAdvolValue: 0,
    totInvValue: r2(taxable + cgst + sgst + igst + cess),
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
        quantity: Number(l.qty ?? l.quantity) || 0,
        qtyUnit: cut(l.uqc || l.unit || 'OTH', 3).toUpperCase(),
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

/** Bulk-upload file for one document: `{ version, billLists: [bill] }`. */
export async function ewayBulkJson(
  db: Queryable,
  businessId: string,
  sourceType: 'delivery_challan' | 'invoice',
  sourceId: string,
  opts: { distanceKm: number }
) {
  if (!Number.isFinite(opts.distanceKm) || opts.distanceKm < 0 || opts.distanceKm > 4000) {
    throw new EwayBillInputError('Enter the distance in km (0 to 4000)');
  }
  if (sourceType === 'delivery_challan') {
    const c = (await db.query(`SELECT *, challan_date::text AS challan_date FROM delivery_challans WHERE id = $1 AND business_id = $2`, [sourceId, businessId])).rows[0];
    if (!c) throw new EwayBillInputError('Delivery challan not found', 404);
    const lines = (
      await db.query(
        `SELECT dci.*, i.uqc FROM delivery_challan_items dci LEFT JOIN items i ON i.id = dci.item_id
          WHERE dci.delivery_challan_id = $1 ORDER BY dci.sort_order`,
        [sourceId]
      )
    ).rows;
    const to = c.supplier_id
      ? await party(db, businessId, 'supplier', c.supplier_id)
      : await party(db, businessId, 'customer', c.customer_id, c.shipping_address);
    return {
      version: '1.0.0621',
      billLists: [
        bill({
          docType: 'CHL', docNo: c.challan_number, docDate: c.challan_date, sub: challanSubSupply(c),
          from: await seller(db, businessId, c.branch_id), to, lines, distanceKm: opts.distanceKm,
          vehicle: c.vehicle_number, transporterGstin: c.transporter_gstin, transporterName: c.transporter_name,
        }),
      ],
    };
  }
  const inv = (await db.query(`SELECT *, invoice_date::text AS invoice_date FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`, [sourceId, businessId])).rows[0];
  if (!inv) throw new EwayBillInputError('Invoice not found', 404);
  if (inv.status !== 'final') throw new EwayBillInputError('Finalise the invoice first', 409);
  const lines = (
    await db.query(
      `SELECT ii.*, i.uqc FROM invoice_items ii LEFT JOIN items i ON i.id = ii.item_id
        WHERE ii.invoice_id = $1 AND COALESCE(ii.hsn_sac, '') NOT LIKE '99%'`,
      [sourceId]
    )
  ).rows;
  if (!lines.length) throw new EwayBillInputError('This invoice has no goods lines');
  return {
    version: '1.0.0621',
    billLists: [
      bill({
        docType: inv.document_type === 'bill_of_supply' ? 'BIL' : 'INV', docNo: inv.invoice_number, docDate: inv.invoice_date,
        sub: { code: inv.export_type ? 3 : 1, desc: '' }, from: await seller(db, businessId, inv.branch_id),
        to: await party(db, businessId, 'customer', inv.customer_id, inv.shipping_address), lines, distanceKm: opts.distanceKm,
      }),
    ],
  };
}
