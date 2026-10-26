import type { PoolClient } from 'pg';
import { computeValidUntil, EwayBillInputError } from '@/lib/gst/eway-bills';

/**
 * Import of the e-way bills other parties generated against our GSTIN (the portal's report of
 * e-way bills for goods coming to us), matched to purchase bills by supplier GSTIN and document
 * number. A matched row is recorded as an inward e-way bill on that purchase. An unmatched row
 * is the audit signal: goods were sent to us and no bill is booked, or the bill is booked under
 * another number.
 *
 * Column names vary between exports, so headers are matched loosely (case, spaces and
 * punctuation ignored) against the aliases below.
 */

type Queryable = Pick<PoolClient, 'query'>;

const ALIASES: Record<string, string[]> = {
  ewb_number: ['ewbno', 'ewaybillno', 'ewbnumber', 'ewaybillnumber', 'ewb', 'eway', 'ewaybill'],
  ewb_date: ['ewbdate', 'ewaybilldate', 'generateddate', 'generationdate', 'ewbgenerateddate', 'generatedon', 'ewbgenerationdate'],
  from_gstin: ['fromgstin', 'suppliergstin', 'gstinofsupplier', 'generatorgstin', 'gstinofgenerator', 'consignorgstin', 'gstin'],
  supplier_name: ['fromtradename', 'suppliername', 'tradename', 'fromname', 'legalname'],
  doc_number: ['docno', 'documentno', 'docnumber', 'documentnumber', 'invoiceno', 'billno', 'invoicenumber'],
  doc_date: ['docdate', 'documentdate', 'invoicedate', 'billdate'],
  value: ['totalinvvalue', 'totalinvoicevalue', 'totalvalue', 'invoicevalue', 'assessablevalue', 'value', 'totinvvalue'],
  valid_until: ['validupto', 'validuntil', 'validtill', 'validity', 'validuptodate'],
  distance_km: ['distance', 'approxdistance', 'distancekm', 'transdistance'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const docKey = (s: string | null | undefined) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');

/** Splits CSV text into rows; handles quoted cells with commas, quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** dd/mm/yyyy[ hh:mm[:ss][ AM|PM]] or yyyy-mm-dd[Thh:mm], read as Indian time. */
export function parsePortalDate(value: string | null | undefined, endOfDay = false): Date | null {
  const s = String(value || '').trim();
  if (!s) return null;
  let y: number, mo: number, d: number;
  let rest = '';
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(.*)$/);
  if (m) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = m[4];
  } else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = m[4];
  } else return null;
  let hh = endOfDay ? 23 : 0;
  let mm = endOfDay ? 59 : 0;
  let ss = endOfDay ? 59 : 0;
  const t = rest.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (t) {
    hh = Number(t[1]) % 12 + (t[4] && t[4].toUpperCase() === 'PM' ? 12 : 0);
    if (!t[4]) hh = Number(t[1]);
    mm = Number(t[2]);
    ss = Number(t[3] || 0);
  }
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}+05:30`;
  const out = new Date(iso);
  return Number.isNaN(out.getTime()) ? null : out;
}

export interface InwardEwbRow {
  ewb_number: string;
  generated_at: Date;
  valid_until: Date | null;
  from_gstin: string | null;
  supplier_name: string | null;
  doc_number: string | null;
  doc_date: Date | null;
  value: number;
  distance_km: number;
}

export function readInwardEwbCsv(text: string): { rows: InwardEwbRow[]; invalid: Array<{ line: number; reason: string }> } {
  const table = parseCsv(text);
  if (table.length < 2) throw new EwayBillInputError('The file needs a header row and at least one e-way bill');
  const header = table[0].map(norm);
  const col = (field: string) => {
    for (const a of ALIASES[field]) {
      const i = header.indexOf(a);
      if (i >= 0) return i;
    }
    return header.findIndex((h) => ALIASES[field].some((a) => h.startsWith(a)));
  };
  const at = Object.fromEntries(Object.keys(ALIASES).map((f) => [f, col(f)]));
  if (at.ewb_number < 0) throw new EwayBillInputError('No e-way bill number column found (looked for "EWB No")');
  if (at.from_gstin < 0 && at.doc_number < 0) throw new EwayBillInputError('No supplier GSTIN or document number column found');
  const rows: InwardEwbRow[] = [];
  const invalid: Array<{ line: number; reason: string }> = [];
  table.slice(1).forEach((cells, i) => {
    const get = (f: string) => (at[f] >= 0 ? String(cells[at[f]] ?? '').trim() : '');
    const ewb = get('ewb_number').replace(/\D/g, '');
    if (!/^\d{12}$/.test(ewb)) return invalid.push({ line: i + 2, reason: 'E-way bill number is not 12 digits' });
    const generated = parsePortalDate(get('ewb_date')) ?? parsePortalDate(get('doc_date'));
    if (!generated) return invalid.push({ line: i + 2, reason: 'No readable e-way bill date' });
    rows.push({
      ewb_number: ewb,
      generated_at: generated,
      valid_until: parsePortalDate(get('valid_until'), true),
      from_gstin: get('from_gstin').toUpperCase() || null,
      supplier_name: get('supplier_name') || null,
      doc_number: get('doc_number') || null,
      doc_date: parsePortalDate(get('doc_date')),
      value: Math.round((Number(get('value').replace(/[^0-9.]/g, '')) || 0) * 100) / 100,
      distance_km: Math.max(0, Math.min(4000, Math.round(Number(get('distance_km').replace(/[^0-9.]/g, '')) || 0))),
    });
  });
  return { rows, invalid };
}

export interface ImportResult {
  matched: Array<{ ewb_number: string; purchase_id: string; bill_number: string | null }>;
  already: string[];
  unmatched: Array<{ ewb_number: string; from_gstin: string | null; supplier_name: string | null; doc_number: string | null; doc_date: string | null; value: number }>;
  invalid: Array<{ line: number; reason: string }>;
}

export async function importInwardEwayBills(client: PoolClient, businessId: string, text: string, userId: string | null): Promise<ImportResult> {
  const { rows, invalid } = readInwardEwbCsv(text);
  const result: ImportResult = { matched: [], already: [], unmatched: [], invalid };
  const existing = new Set(
    (await client.query(`SELECT ewb_number FROM eway_bills WHERE business_id = $1 AND ewb_number = ANY($2::text[])`, [businessId, rows.map((r) => r.ewb_number)])).rows.map(
      (r: any) => r.ewb_number
    )
  );
  const bills = (
    await client.query(
      `SELECT p.id, p.bill_number, p.bill_date::text AS bill_date, p.grand_total::float AS total, UPPER(s.gstin) AS gstin
         FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.business_id = $1 AND p.deleted_at IS NULL AND COALESCE(p.status, '') NOT IN ('draft', 'cancelled')`,
      [businessId]
    )
  ).rows;
  const istDay = (d: Date | null) => (d ? new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10) : null);

  for (const r of rows) {
    if (existing.has(r.ewb_number)) {
      result.already.push(r.ewb_number);
      continue;
    }
    const sameSupplier = bills.filter((b: any) => !r.from_gstin || b.gstin === r.from_gstin);
    let bill = r.doc_number ? sameSupplier.find((b: any) => docKey(b.bill_number) === docKey(r.doc_number)) : undefined;
    if (!bill && r.from_gstin) {
      // Same supplier, same day, same value: the bill was booked under another number.
      const day = istDay(r.doc_date ?? r.generated_at);
      const close = sameSupplier.filter((b: any) => b.bill_date === day && Math.abs(b.total - r.value) <= 1);
      if (close.length === 1) bill = close[0];
    }
    if (!bill) {
      result.unmatched.push({
        ewb_number: r.ewb_number, from_gstin: r.from_gstin, supplier_name: r.supplier_name, doc_number: r.doc_number,
        doc_date: istDay(r.doc_date), value: r.value,
      });
      continue;
    }
    await client.query(
      `INSERT INTO eway_bills (business_id, source_type, source_id, direction, ewb_number, doc_type, sub_supply_type, from_gstin,
         distance_km, goods_value, generated_at, valid_until, notes, created_by)
       VALUES ($1, 'purchase', $2, 'inward', $3, 'tax_invoice', 'supply', $4, $5, $6, $7, $8, 'Imported from the portal', $9)`,
      [businessId, bill.id, r.ewb_number, r.from_gstin, r.distance_km, r.value, r.generated_at,
       r.valid_until ?? computeValidUntil(r.generated_at, r.distance_km), userId]
    );
    existing.add(r.ewb_number);
    result.matched.push({ ewb_number: r.ewb_number, purchase_id: bill.id, bill_number: bill.bill_number });
  }
  return result;
}
