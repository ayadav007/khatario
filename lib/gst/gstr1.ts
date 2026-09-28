import { getPool } from '@/lib/db';
import { resolveItemUqc, toGstUqc } from '@/lib/gst/uqc';
import { loadAdvanceTables, type AdvanceTableRow } from '@/lib/gst/gstr1-advances';

export type { AdvanceTableRow };

export interface GSTR1Filters {
  business_id: string;
  branch_id?: string; // Optional: Filter by specific branch (for branch-wise GST reporting)
  month?: number;
  year?: number;
  from_date?: string;
  to_date?: string;
  customer_type?: 'b2b' | 'b2c';
}

export interface GSTR1Summary {
  total_outward_taxable_supplies: number;
  total_tax_amount: number;
  invoice_count: number;
  b2b_count: number;
  b2cl_count: number;
  b2cs_count: number;
}

export interface B2BInvoice {
  /** Source invoice UUID — links row to `invoices.id` and ledger `voucher_id`. */
  invoice_id: string;
  gstin: string;
  /** Customer / trade name — required column in GST offline Excel `b2b,sez,de` */
  receiver_name: string;
  invoice_number: string;
  invoice_date: string;
  invoice_value: number;
  place_of_supply: string;
  reverse_charge: string; // 'Y' or 'N'
  invoice_type: string; // 'Regular', 'SEZ supplies with payment', etc.
  ecommerce_gstin: string | null;
  rate: number;
  taxable_value: number;
  igst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  cess_amount: number;
}

export interface B2CLInvoice {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  invoice_value: number;
  place_of_supply: string;
  rate: number;
  taxable_value: number;
  igst_amount: number;
  cess_amount: number;
  ecommerce_gstin: string | null;
}

export interface B2CSInvoice {
  type: string; // 'E-Commerce' or 'OE' (Other than E-commerce)
  place_of_supply: string;
  rate: number;
  taxable_value: number;
  igst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  cess_amount: number;
  ecommerce_gstin: string | null;
}

export interface HSNEntry {
  hsn_sac: string;
  description: string;
  uqc: string;
  total_quantity: number;
  total_value: number;
  taxable_value: number;
  integrated_tax: number;
  central_tax: number;
  state_ut_tax: number;
  cess_amount: number;
  /** GST rate % — separate row per HSN+rate for portal HSN summary */
  rate: number;
}

export interface ExportInvoice {
  invoice_id: string;
  export_type: string; // 'Wpay' or 'Wopay'
  invoice_number: string;
  invoice_date: string;
  invoice_value: number;
  port_code: string | null;
  shipping_bill_number: string | null;
  shipping_bill_date: string | null;
  rate: number;
  taxable_value: number;
  igst_amount: number;
}

export interface SEZInvoice {
  invoice_id: string;
  sez_unit_gstin: string; // Required - SEZ unit's GSTIN
  invoice_number: string;
  invoice_date: string;
  invoice_value: number;
  place_of_supply: string;
  sez_type: 'WPAY' | 'WOPAY'; // With payment or Without payment
  rate: number;
  taxable_value: number;
  igst_amount: number;
  cess_amount: number;
}

export type NilSupplyType = 'INTRB2B' | 'INTRB2C' | 'INTRAB2B' | 'INTRAB2C';

/** Table 8 — one row per GSTN supply type (inter/intra-state × registered/unregistered). */
export interface NilRatedEntry {
  sply_ty: NilSupplyType;
  description: string;
  nil_supply: number;
  exempt_supply: number;
  non_gst_supply: number;
}

const NIL_DESCRIPTIONS: Record<NilSupplyType, string> = {
  INTRB2B: 'Inter-State supplies to registered persons',
  INTRAB2B: 'Intra-State supplies to registered persons',
  INTRB2C: 'Inter-State supplies to unregistered persons',
  INTRAB2C: 'Intra-State supplies to unregistered persons',
};

export type CdnurTyp = 'B2CL' | 'EXPWP' | 'EXPWOP';

export interface CDNEntry {
  /** Original sale invoice when linked; null if note has no invoice_id. */
  invoice_id: string | null;
  /** Credit/debit note UUID — ledger `voucher_id` for `credit_note` / `debit_note`. */
  document_id: string;
  document_type: 'credit_note' | 'debit_note';
  gstin_uin_recipient: string | null; // For B2B
  receiver_name: string | null; // For B2C
  note_number: string;
  note_date: string;
  note_type: 'C' | 'D'; // Credit or Debit
  place_of_supply: string;
  invoice_value: number; // Note grand total
  original_invoice_number: string | null;
  original_invoice_date: string | null;
  note_supply_type: string; // 'Regular', 'Deemed Exp', etc.
  reverse_charge: 'Y' | 'N';
  /** Set for supplies to unregistered (CDNUR `typ`); null when recipient has GSTIN */
  cdnur_typ: CdnurTyp | null;
  tax_rate: number;
  taxable_value: number;
  igst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  cess_amount: number;
}

/** Summary for GSTR-1 Table 13 — documents issued (outward invoices in period) */
export interface GSTR1DocIssueSummary {
  from: string;
  to: string;
  totnum: number;
  cancel: number;
}

/** Table 13 row: one number series of one document nature (GSTN doc_num 1 = invoices, 4 = debit notes, 5 = credit notes). */
export interface GSTR1DocIssueRow {
  doc_num: DocNum;
  nature: string;
  from: string;
  to: string;
  totnum: number;
  cancel: number;
  net_issue: number;
}

type DocNum = 1 | 4 | 5 | 6 | 8;

const DOC_NATURE: Record<DocNum, string> = {
  1: 'Invoices for outward supply',
  4: 'Debit Note',
  5: 'Credit Note',
  6: 'Receipt voucher',
  8: 'Refund voucher',
};

/** GSTN date format (dd-mm-yyyy). pg returns DATE columns as local-midnight Dates. */
export function formatGstDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') {
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

/** Groups document numbers into series by their non-numeric prefix (e.g. INV-, EXP/). */
function buildDocSeries(
  docNum: DocNum,
  docs: Array<{ number: string; cancelled: boolean }>
): GSTR1DocIssueRow[] {
  const bySeries = new Map<string, Array<{ number: string; cancelled: boolean }>>();
  for (const d of docs) {
    const prefix = d.number.replace(/\d+$/, '');
    if (!bySeries.has(prefix)) bySeries.set(prefix, []);
    bySeries.get(prefix)!.push(d);
  }
  const rows: GSTR1DocIssueRow[] = [];
  for (const [, list] of bySeries) {
    const unique = [...new Map(list.map((d) => [d.number, d])).values()].sort((a, b) =>
      a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: 'base' })
    );
    const cancel = unique.filter((d) => d.cancelled).length;
    rows.push({
      doc_num: docNum,
      nature: DOC_NATURE[docNum],
      from: unique[0].number,
      to: unique[unique.length - 1].number,
      totnum: unique.length,
      cancel,
      net_issue: unique.length - cancel,
    });
  }
  return rows;
}

const STANDARD_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

function snapRate(rate: number): number {
  const hit = STANDARD_RATES.find((r) => Math.abs(r - rate) < 0.05);
  return hit ?? rate;
}

/** Map invoice supply_type + is_reverse_charge to GSTN invoice_type string */
function resolveInvoiceType(supplyType: string | null, isReverseCharge: boolean): string {
  if (supplyType === 'sez') return 'SEZ supplies with payment'; // refined later from igst
  if (supplyType === 'deemed_export') return 'Deemed Exp';
  return 'Regular'; // includes RCM — reverse_charge field carries the Y/N flag
}

function deriveNoteSupplyType(origSupplyType: string | null, noteIgst: number): string {
  if (origSupplyType === 'sez') {
    return noteIgst > 0 ? 'SEZ supplies with payment' : 'SEZ supplies without payment';
  }
  if (origSupplyType === 'deemed_export') return 'Deemed Exp';
  return 'Regular';
}

function deriveCdnurTyp(
  row: {
    place_of_supply: string;
    orig_invoice_pos: string | null;
    orig_supply_type: string | null;
    orig_document_type: string | null;
    orig_export_type: string | null;
    igst_amount: string | number;
  }
): CdnurTyp {
  const igst = parseFloat(String(row.igst_amount)) || 0;
  const pos = String(row.place_of_supply || row.orig_invoice_pos || '');
  const supply = row.orig_supply_type || '';
  const docType = row.orig_document_type || '';

  const isExport = pos === '96' || supply === 'export' || docType === 'export_invoice';

  if (isExport) {
    if (row.orig_export_type === 'wp' || igst > 0) return 'EXPWP';
    return 'EXPWOP';
  }

  return 'B2CL';
}

export class GSTR1Generator {
  private pool = getPool();

  async generate(filters: GSTR1Filters) {
    const { business_id, branch_id, month, year, from_date, to_date } = filters;
    let dateCondition = '';
    const params: any[] = [business_id];
    let pIdx = 2;

    // Add branch filter if provided
    let branchCondition = '';
    if (branch_id) {
      branchCondition = `AND i.branch_id = $${pIdx}`;
      params.push(branch_id);
      pIdx++;
    }

    if (from_date && to_date) {
      dateCondition = `AND i.invoice_date BETWEEN $${pIdx} AND $${pIdx + 1}`;
      params.push(from_date, to_date);
      pIdx += 2;
    } else if (month && year) {
      // Calculate start and end of month
      const start = `${year}-${month.toString().padStart(2, '0')}-01`;
      // For end date, we can cast to date or use interval
      dateCondition = `AND i.invoice_date >= $${pIdx}::date AND i.invoice_date < ($${pIdx}::date + INTERVAL '1 month')`;
      params.push(start);
      pIdx++;
    }

    const client = await this.pool.connect();
    try {
      let periodStartStr: string | undefined = filters.from_date;
      if (!periodStartStr && filters.month && filters.year) {
        periodStartStr = `${filters.year}-${String(filters.month).padStart(2, '0')}-01`;
      }
      const b2clThreshold =
        periodStartStr && periodStartStr < '2024-08-01' ? 250000 : 100000;

      // 1. Fetch Invoices with Items
      // We need to group by invoice for document level, and split by tax rate/item for line level
      const invoicesQuery = `
        SELECT 
          i.id, i.invoice_number, i.invoice_date, i.grand_total, i.place_of_supply_state_code,
          i.is_reverse_charge, i.document_type, i.supply_type, i.export_type,
          i.shipping_bill_number, i.shipping_bill_date, i.port_code,
          i.ecommerce_operator_gstin, i.is_ecommerce_supply, i.subtotal, i.branch_id,
          c.gstin as customer_gstin, c.name as customer_name,
          ii.tax_rate, COALESCE(NULLIF(TRIM(ii.hsn_sac), ''), it.hsn_sac) AS hsn_sac,
          ii.quantity, ii.unit, ii.taxable_value as item_taxable_value,
          CASE WHEN UPPER(TRIM(COALESCE(ii.unit, ''))) = UPPER(TRIM(COALESCE(it.unit, ''))) THEN it.uqc END AS item_uqc,
          ii.cgst_amount, ii.sgst_amount, ii.igst_amount,
          COALESCE(ii.cess_amount, 0) AS item_cess_amount,
          ii.item_name
        FROM invoices i
        JOIN invoice_items ii ON i.id = ii.invoice_id
        LEFT JOIN items it ON it.id = ii.item_id
        LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
        WHERE i.business_id = $1 
          AND i.deleted_at IS NULL
          AND i.status = 'final'
          AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
          ${branchCondition}
          ${dateCondition}
      `;

      const result = await client.query(invoicesQuery, params);
      const rows = result.rows;

      const bizRes = await client.query<{ gstin: string | null }>(
        'SELECT gstin FROM businesses WHERE id = $1',
        [business_id]
      );
      const bizGstin = bizRes.rows[0]?.gstin ? String(bizRes.rows[0].gstin).trim() : '';
      const selfState = /^\d{2}/.test(bizGstin) ? bizGstin.slice(0, 2) : null;
      const isInterState = (pos: string | null | undefined, igst: number): boolean => {
        const p = String(pos || '').slice(0, 2);
        if (selfState && /^\d{2}$/.test(p)) return p !== selfState;
        return igst > 0;
      };

      // Classify Data
      const b2b: B2BInvoice[] = [];
      const b2cl: B2CLInvoice[] = [];
      const b2cs: B2CSInvoice[] = [];
      const exports: ExportInvoice[] = [];
      const sez: SEZInvoice[] = [];
      const hsn: HSNEntry[] = [];
      const hsn_b2b: HSNEntry[] = [];
      const hsn_b2c: HSNEntry[] = [];
      const nil: NilRatedEntry[] = [];
      const cdn: CDNEntry[] = [];
      /** Notes on B2C (small) supplies: netted into `b2cs` / `nil`, listed here for audit and reconciliation. */
      const cdn_b2cs: CDNEntry[] = [];

      const nilRow = (sply: NilSupplyType): NilRatedEntry => {
        let entry = nil.find((n) => n.sply_ty === sply);
        if (!entry) {
          entry = { sply_ty: sply, description: NIL_DESCRIPTIONS[sply], nil_supply: 0, exempt_supply: 0, non_gst_supply: 0 };
          nil.push(entry);
        }
        return entry;
      };

      const addHsn = (list: HSNEntry[], item: any, rate: number) => {
        const key = item.hsn_sac || 'NA';
        const uqc = resolveItemUqc({ uqc: item.item_uqc, unit: item.unit, hsn_sac: item.hsn_sac });
        let entry = list.find((h) => h.hsn_sac === key && h.rate === rate && h.uqc === uqc);
        if (!entry) {
          entry = {
            hsn_sac: key,
            description: item.item_name,
            uqc,
            total_quantity: 0,
            total_value: 0,
            taxable_value: 0,
            integrated_tax: 0,
            central_tax: 0,
            state_ut_tax: 0,
            cess_amount: 0,
            rate,
          };
          list.push(entry);
        }
        const igst = parseFloat(item.igst_amount) || 0;
        const cgst = parseFloat(item.cgst_amount) || 0;
        const sgst = parseFloat(item.sgst_amount) || 0;
        const cess = parseFloat(item.item_cess_amount ?? 0) || 0;
        const taxable = parseFloat(item.item_taxable_value) || 0;
        entry.total_quantity += parseFloat(item.quantity) || 0;
        entry.total_value += taxable + igst + cgst + sgst + cess;
        entry.taxable_value += taxable;
        entry.integrated_tax += igst;
        entry.central_tax += cgst;
        entry.state_ut_tax += sgst;
        entry.cess_amount += cess;
      };

      // Summary
      const summary: GSTR1Summary = {
        total_outward_taxable_supplies: 0,
        total_tax_amount: 0,
        invoice_count: 0,
        b2b_count: 0,
        b2cl_count: 0,
        b2cs_count: 0
      };

      const uniqueInvoiceIds = new Set<string>();

      // Group rows by invoice to handle invoice-level classification
      const invoicesMap = new Map<string, any[]>();
      rows.forEach(row => {
        if (!invoicesMap.has(row.id)) invoicesMap.set(row.id, []);
        invoicesMap.get(row.id)!.push(row);
      });

      for (const [invoiceId, items] of invoicesMap) {
        uniqueInvoiceIds.add(invoiceId);
        const inv = items[0]; // First item contains invoice details
        const isB2B = !!inv.customer_gstin;
        const isExport = inv.place_of_supply_state_code === '96'; // 96: Foreign Country
        const isSEZ = inv.place_of_supply_state_code === '97' || inv.supply_type === 'sez'; // 97: SEZ/Other Territory
        const totalValue = parseFloat(inv.grand_total);
        const placeOfSupply = inv.place_of_supply_state_code; // 2-digit code
        
        // Accumulate Summary
        // Note: Summing totals from invoice level, assuming items add up
        summary.total_outward_taxable_supplies += parseFloat(inv.subtotal);
        // Calculate tax total from items to be precise
        const taxTotal = items.reduce((sum, item) => sum + parseFloat(item.cgst_amount) + parseFloat(item.sgst_amount) + parseFloat(item.igst_amount), 0);
        summary.total_tax_amount += taxTotal;

        const invIgst = items.reduce((s, i) => s + (parseFloat(i.igst_amount) || 0), 0);
        const interState = isInterState(placeOfSupply, invIgst);

        // --- HSN Summary (Table 12): one row per HSN + UQC + rate, split B2B / B2C ---
        items.forEach(item => {
          const rate = parseFloat(item.tax_rate) || 0;
          addHsn(hsn, item, rate);
          addHsn(isB2B || isSEZ ? hsn_b2b : hsn_b2c, item, rate);

          // --- Table 8 (0% domestic lines; zero-rated exports/SEZ stay in Table 6) ---
          if (rate === 0 && !isExport && !isSEZ) {
            const sply: NilSupplyType = interState ? (isB2B ? 'INTRB2B' : 'INTRB2C') : (isB2B ? 'INTRAB2B' : 'INTRAB2C');
            const entry = nilRow(sply);
            const tv = parseFloat(item.item_taxable_value) || 0;
            if (inv.document_type === 'bill_of_supply') entry.exempt_supply += tv;
            else entry.nil_supply += tv;
          }
        });

        // --- Invoice Classification Logic ---
        
        // Group items by tax rate for GSTR-1 line items; aggregate stored tax amounts (no recalculation)
        const itemsByRate = new Map<
          number,
          { taxable: number; igst: number; cgst: number; sgst: number; cess: number }
        >();
        items.forEach((item) => {
          const rate = parseFloat(item.tax_rate);
          if (!itemsByRate.has(rate)) itemsByRate.set(rate, { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
          const group = itemsByRate.get(rate)!;
          group.taxable += parseFloat(item.item_taxable_value);
          group.igst += parseFloat(item.igst_amount || 0);
          group.cgst += parseFloat(item.cgst_amount || 0);
          group.sgst += parseFloat(item.sgst_amount || 0);
          group.cess += parseFloat(item.item_cess_amount ?? 0);
        });
        const taxableRates = [...itemsByRate].filter(([rate]) => rate > 0);

        if (isSEZ) {
          // SEZ supplies - Table 6B
          if (!inv.customer_gstin) {
            // Log warning - SEZ requires GSTIN
            console.warn(`Invoice ${inv.invoice_number} marked as SEZ but missing customer GSTIN`);
          }
          for (const [rate, val] of itemsByRate) {
            const sezType: 'WPAY' | 'WOPAY' = val.igst > 0 ? 'WPAY' : (inv.export_type === 'wp' ? 'WPAY' : 'WOPAY');
            sez.push({
              sez_unit_gstin: inv.customer_gstin || '',
              invoice_id: invoiceId,
              invoice_number: inv.invoice_number,
              invoice_date: formatGstDate(inv.invoice_date),
              invoice_value: totalValue,
              place_of_supply: placeOfSupply || '',
              sez_type: sezType,
              rate: rate,
              taxable_value: val.taxable,
              igst_amount: val.igst,
              cess_amount: val.cess
            });
          }
        } else if (isExport) {
          // Regular exports - Table 6A
          for (const [rate, val] of itemsByRate) {
             exports.push({
               invoice_id: invoiceId,
               // Tax actually charged decides WPAY; a stale export_type flag must not hide IGST paid.
               export_type: inv.export_type === 'wp' || val.igst > 0 ? 'WPAY' : 'WOPAY',
               invoice_number: inv.invoice_number,
               invoice_date: formatGstDate(inv.invoice_date),
               invoice_value: totalValue,
               port_code: inv.port_code,
               shipping_bill_number: inv.shipping_bill_number,
               shipping_bill_date: inv.shipping_bill_date ? formatGstDate(inv.shipping_bill_date) : null,
               rate: rate,
               taxable_value: val.taxable,
               igst_amount: val.igst
             });
          }
        } else if (isB2B) {
          // B2B (0% lines are reported only in Table 8)
          if (taxableRates.length > 0) summary.b2b_count++;
          for (const [rate, val] of taxableRates) {
            b2b.push({
              invoice_id: invoiceId,
              gstin: inv.customer_gstin,
              receiver_name: inv.customer_name || '',
              invoice_number: inv.invoice_number,
              invoice_date: formatGstDate(inv.invoice_date),
              invoice_value: totalValue,
              place_of_supply: placeOfSupply ? `${placeOfSupply}-State` : '',
              reverse_charge: inv.is_reverse_charge ? 'Y' : 'N',
              invoice_type: resolveInvoiceType(inv.supply_type, !!inv.is_reverse_charge),
              ecommerce_gstin: inv.ecommerce_operator_gstin,
              rate: rate,
              taxable_value: val.taxable,
              igst_amount: val.igst,
              cgst_amount: val.cgst,
              sgst_amount: val.sgst,
              cess_amount: val.cess
            });
          }
        } else {
          // B2C
          // Check if Large or Small
          // B2CL: Inter-state AND > 2.5L
          // Need Business State to check Inter-state
          // Assumption: If place_of_supply is different from business state, it's inter-state.
          // We assume API passed business_id, we might need business state code.
          // For now, let's rely on logic: isB2CL = totalValue > 250000 && isInterState
          
          if (totalValue > b2clThreshold && interState) {
             if (taxableRates.length > 0) summary.b2cl_count++;
             for (const [rate, val] of taxableRates) {
                b2cl.push({
                  invoice_id: invoiceId,
                  invoice_number: inv.invoice_number,
                  invoice_date: formatGstDate(inv.invoice_date),
                  invoice_value: totalValue,
                  place_of_supply: placeOfSupply || '',
                  rate: rate,
                  taxable_value: val.taxable,
                  igst_amount: val.igst,
                  cess_amount: val.cess,
                  ecommerce_gstin: inv.ecommerce_operator_gstin
                });
             }
          } else {
             // B2CS
             // Aggregated by Rate and Place of Supply
             if (taxableRates.length > 0) summary.b2cs_count++;
             const b2csChannel: 'E-Commerce' | 'OE' =
               inv.ecommerce_operator_gstin || inv.is_ecommerce_supply ? 'E-Commerce' : 'OE';
             for (const [rate, val] of taxableRates) {
               const existing = b2cs.find(
                 b =>
                   b.type === b2csChannel &&
                   b.place_of_supply === placeOfSupply &&
                   b.rate === rate
               );
               if (existing) {
                 existing.taxable_value += val.taxable;
                 existing.igst_amount += val.igst;
                 existing.cgst_amount += val.cgst;
                 existing.sgst_amount += val.sgst;
                 existing.cess_amount += val.cess;
               } else {
                 b2cs.push({
                   type: b2csChannel,
                   place_of_supply: placeOfSupply || '',
                   rate: rate,
                   taxable_value: val.taxable,
                   igst_amount: val.igst,
                   cgst_amount: val.cgst,
                   sgst_amount: val.sgst,
                   cess_amount: val.cess,
                   ecommerce_gstin: inv.ecommerce_operator_gstin
                 });
               }
             }
          }
        }
      }

      summary.invoice_count = uniqueInvoiceIds.size;

      // Table 13 — every number issued in the period, including invoices cancelled later
      const issuedInvoices = await client.query(
        `SELECT i.invoice_number, i.status
           FROM invoices i
          WHERE i.business_id = $1
            AND i.deleted_at IS NULL
            AND i.status IN ('final', 'cancelled')
            AND i.invoice_number IS NOT NULL
            AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
            ${branchCondition}
            ${dateCondition}`,
        params
      );
      const invoiceDocs = issuedInvoices.rows.map((r) => ({
        number: String(r.invoice_number),
        cancelled: r.status === 'cancelled',
      }));
      const doc_issues: GSTR1DocIssueRow[] = buildDocSeries(1, invoiceDocs);

      const sortedInvoiceNums = [...new Set(invoiceDocs.map((d) => d.number))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );
      const doc_issue_summary: GSTR1DocIssueSummary | null =
        sortedInvoiceNums.length > 0
          ? {
              from: sortedInvoiceNums[0],
              to: sortedInvoiceNums[sortedInvoiceNums.length - 1],
              totnum: sortedInvoiceNums.length,
              cancel: new Set(invoiceDocs.filter((d) => d.cancelled).map((d) => d.number)).size,
            }
          : null;

      // ─── Fetch Credit & Debit Notes ────────────────────────────────────────
      let cdnCreditDate = '';
      let cdnDebitDate = '';
      let cdnBranchCn = '';
      let cdnBranchDn = '';
      const cdnParams: any[] = [business_id];
      let cdnPIdx = 2;

      if (branch_id) {
        cdnBranchCn = `AND cn.branch_id = $${cdnPIdx}::uuid`;
        cdnBranchDn = `AND dn.branch_id = $${cdnPIdx}::uuid`;
        cdnParams.push(branch_id);
        cdnPIdx++;
      }

      if (from_date && to_date) {
        cdnCreditDate = `AND cn.credit_note_date BETWEEN $${cdnPIdx} AND $${cdnPIdx + 1}`;
        cdnDebitDate = `AND dn.debit_note_date  BETWEEN $${cdnPIdx} AND $${cdnPIdx + 1}`;
        cdnParams.push(from_date, to_date);
        cdnPIdx += 2;
      } else if (month && year) {
        const start = `${year}-${month.toString().padStart(2, '0')}-01`;
        cdnCreditDate = `AND cn.credit_note_date >= $${cdnPIdx}::date AND cn.credit_note_date < ($${cdnPIdx}::date + INTERVAL '1 month')`;
        cdnDebitDate = `AND dn.debit_note_date  >= $${cdnPIdx}::date AND dn.debit_note_date  < ($${cdnPIdx}::date + INTERVAL '1 month')`;
        cdnParams.push(start);
        cdnPIdx++;
      }

      const cdnQuery = `
        SELECT
          cn.credit_note_number           AS note_number,
          cn.credit_note_date             AS note_date,
          'C'                             AS note_type,
          cn.grand_total                  AS invoice_value,
          cn.subtotal                     AS taxable_value,
          cn.cgst_total                   AS cgst_amount,
          cn.sgst_total                   AS sgst_amount,
          cn.igst_total                   AS igst_amount,
          0::numeric                      AS cess_amount,
          cn.place_of_supply_state_code   AS place_of_supply,
          COALESCE(cn.original_invoice_date, i.invoice_date) AS original_invoice_date,
          cn.reason,
          i.invoice_number                AS original_invoice_number,
          i.id                            AS linked_invoice_id,
          c.gstin                         AS customer_gstin,
          c.name                          AS customer_name,
          COALESCE(i.is_reverse_charge, false) AS orig_is_reverse_charge,
          i.supply_type                   AS orig_supply_type,
          i.export_type                   AS orig_export_type,
          i.grand_total                   AS orig_invoice_grand_total,
          i.document_type                 AS orig_document_type,
          i.place_of_supply_state_code    AS orig_invoice_pos,
          COALESCE(
            (SELECT CASE WHEN COUNT(DISTINCT cni.tax_rate) = 1 THEN MAX(cni.tax_rate) END
               FROM credit_note_items cni WHERE cni.credit_note_id = cn.id),
            CASE WHEN cn.subtotal > 0 THEN ROUND((cn.tax_total / cn.subtotal) * 100, 2) ELSE 0 END
          )                               AS tax_rate,
          i.ecommerce_operator_gstin      AS orig_etin,
          COALESCE(i.is_ecommerce_supply, false) AS orig_is_ecommerce,
          cn.id                           AS document_id,
          'credit_note'::text             AS document_type
        FROM credit_notes cn
        LEFT JOIN invoices i ON cn.invoice_id  = i.id AND i.deleted_at IS NULL
        LEFT JOIN customers c ON cn.customer_id = c.id AND c.deleted_at IS NULL
        WHERE cn.business_id = $1::uuid
          AND cn.status = 'active'
          ${cdnBranchCn}
          ${cdnCreditDate}

        UNION ALL

        SELECT
          dn.debit_note_number            AS note_number,
          dn.debit_note_date              AS note_date,
          'D'                             AS note_type,
          dn.grand_total                  AS invoice_value,
          dn.subtotal                     AS taxable_value,
          dn.cgst_total                   AS cgst_amount,
          dn.sgst_total                   AS sgst_amount,
          dn.igst_total                   AS igst_amount,
          0::numeric                      AS cess_amount,
          dn.place_of_supply_state_code   AS place_of_supply,
          COALESCE(dn.original_invoice_date, i.invoice_date) AS original_invoice_date,
          dn.reason,
          i.invoice_number                AS original_invoice_number,
          i.id                            AS linked_invoice_id,
          c.gstin                         AS customer_gstin,
          c.name                          AS customer_name,
          COALESCE(i.is_reverse_charge, false) AS orig_is_reverse_charge,
          i.supply_type                   AS orig_supply_type,
          i.export_type                   AS orig_export_type,
          i.grand_total                   AS orig_invoice_grand_total,
          i.document_type                 AS orig_document_type,
          i.place_of_supply_state_code    AS orig_invoice_pos,
          COALESCE(
            (SELECT CASE WHEN COUNT(DISTINCT dni.tax_rate) = 1 THEN MAX(dni.tax_rate) END
               FROM debit_note_items dni WHERE dni.debit_note_id = dn.id),
            CASE WHEN dn.subtotal > 0 THEN ROUND((dn.tax_total / dn.subtotal) * 100, 2) ELSE 0 END
          )                               AS tax_rate,
          i.ecommerce_operator_gstin      AS orig_etin,
          COALESCE(i.is_ecommerce_supply, false) AS orig_is_ecommerce,
          dn.id                           AS document_id,
          'debit_note'::text              AS document_type
        FROM debit_notes dn
        LEFT JOIN invoices i ON dn.invoice_id  = i.id AND i.deleted_at IS NULL
        LEFT JOIN customers c ON dn.customer_id = c.id AND c.deleted_at IS NULL
        WHERE dn.business_id = $1::uuid
          AND dn.status = 'active'
          ${cdnBranchDn}
          ${cdnDebitDate}
        ORDER BY note_date ASC
      `;

      const noteDocsRes = await client.query(
        `SELECT 5 AS doc_num, cn.credit_note_number AS number, cn.status
           FROM credit_notes cn
          WHERE cn.business_id = $1::uuid ${cdnBranchCn} ${cdnCreditDate}
         UNION ALL
         SELECT 4 AS doc_num, dn.debit_note_number AS number, dn.status
           FROM debit_notes dn
          WHERE dn.business_id = $1::uuid ${cdnBranchDn} ${cdnDebitDate}`,
        cdnParams
      );
      for (const docNum of [4, 5] as const) {
        const docs = noteDocsRes.rows
          .filter((r) => Number(r.doc_num) === docNum && r.number)
          .map((r) => ({ number: String(r.number), cancelled: r.status === 'cancelled' }));
        if (docs.length > 0) doc_issues.push(...buildDocSeries(docNum, docs));
      }

      let at: AdvanceTableRow[] = [];
      let atadj: AdvanceTableRow[] = [];
      const periodFrom = from_date || periodStartStr;
      let periodTo = to_date;
      if (!periodTo && month && year) {
        const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
        periodTo = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
      }
      if (periodFrom && periodTo) {
        ({ at, atadj } = await loadAdvanceTables(client, {
          businessId: business_id,
          branchId: branch_id || null,
          from: periodFrom,
          to: periodTo,
        }));
        const voucherDocs = await client.query<{ doc_num: number; number: string }>(
          `SELECT 6 AS doc_num, a.voucher_number AS number
             FROM advance_payments a
            WHERE a.business_id = $1 AND a.type = 'received' AND a.voucher_number IS NOT NULL
              AND a.payment_date BETWEEN $2::date AND $3::date ${branch_id ? 'AND a.branch_id = $4' : ''}
           UNION ALL
           SELECT 8, aa.voucher_number
             FROM advance_adjustments aa
             JOIN advance_payments a ON a.id = aa.advance_id
            WHERE aa.business_id = $1 AND aa.kind = 'refund' AND a.type = 'received'
              AND aa.adjustment_date BETWEEN $2::date AND $3::date ${branch_id ? 'AND a.branch_id = $4' : ''}`,
          branch_id ? [business_id, periodFrom, periodTo, branch_id] : [business_id, periodFrom, periodTo]
        );
        for (const docNum of [6, 8] as const) {
          const docs = voucherDocs.rows
            .filter((r) => Number(r.doc_num) === docNum && r.number)
            .map((r) => ({ number: String(r.number), cancelled: false }));
          if (docs.length > 0) doc_issues.push(...buildDocSeries(docNum, docs));
        }
      }

      const cdnResult = await client.query(cdnQuery, cdnParams);
      cdnResult.rows.forEach((row) => {
        const gstin = row.customer_gstin ? String(row.customer_gstin).trim() : null;
        const isRegRecipient = !!gstin && gstin.length === 15;
        const noteIgst = parseFloat(row.igst_amount) || 0;
        const linkedInv = row.linked_invoice_id ? String(row.linked_invoice_id) : null;
        const cdnurTyp = isRegRecipient
          ? null
          : deriveCdnurTyp({
              place_of_supply: row.place_of_supply || '',
              orig_invoice_pos: row.orig_invoice_pos ?? null,
              orig_supply_type: row.orig_supply_type ?? null,
              orig_document_type: row.orig_document_type ?? null,
              orig_export_type: row.orig_export_type ?? null,
              igst_amount: row.igst_amount,
            });
        const entry: CDNEntry = {
          invoice_id: linkedInv,
          document_id: String(row.document_id),
          document_type: row.document_type as 'credit_note' | 'debit_note',
          gstin_uin_recipient: gstin,
          receiver_name: row.customer_name || null,
          note_number: row.note_number,
          note_date: formatGstDate(row.note_date),
          note_type: row.note_type as 'C' | 'D',
          place_of_supply: row.place_of_supply || '',
          invoice_value: parseFloat(row.invoice_value),
          original_invoice_number: row.original_invoice_number || null,
          original_invoice_date: row.original_invoice_date ? formatGstDate(row.original_invoice_date) : null,
          note_supply_type: deriveNoteSupplyType(row.orig_supply_type ?? null, noteIgst),
          reverse_charge: row.orig_is_reverse_charge ? 'Y' : 'N',
          cdnur_typ: cdnurTyp,
          tax_rate: snapRate(parseFloat(row.tax_rate) || 0),
          taxable_value: parseFloat(row.taxable_value),
          igst_amount: noteIgst,
          cgst_amount: parseFloat(row.cgst_amount) || 0,
          sgst_amount: parseFloat(row.sgst_amount) || 0,
          cess_amount: parseFloat(row.cess_amount) || 0,
        };

        // CDNUR covers only notes on B2CL invoices and exports; other unregistered-recipient
        // notes are netted into Table 7 (B2CS) or Table 8 for the period.
        const pos = String(row.place_of_supply || row.orig_invoice_pos || '').slice(0, 2);
        const noteInter = isInterState(pos, noteIgst);
        const origValue = parseFloat(row.orig_invoice_grand_total) || 0;
        const origIsB2cl = !!linkedInv && noteInter && origValue > b2clThreshold;
        if (isRegRecipient || cdnurTyp !== 'B2CL' || origIsB2cl) {
          cdn.push(entry);
          return;
        }

        cdn_b2cs.push(entry);
        const sign = entry.note_type === 'C' ? -1 : 1;
        if (entry.tax_rate === 0) {
          const target = nilRow(noteInter ? 'INTRB2C' : 'INTRAB2C');
          if (row.orig_document_type === 'bill_of_supply') target.exempt_supply += sign * entry.taxable_value;
          else target.nil_supply += sign * entry.taxable_value;
          return;
        }
        const channel: 'E-Commerce' | 'OE' = row.orig_etin || row.orig_is_ecommerce ? 'E-Commerce' : 'OE';
        let b2csRow = b2cs.find((b) => b.type === channel && b.place_of_supply === pos && b.rate === entry.tax_rate);
        if (!b2csRow) {
          b2csRow = {
            type: channel,
            place_of_supply: pos,
            rate: entry.tax_rate,
            taxable_value: 0,
            igst_amount: 0,
            cgst_amount: 0,
            sgst_amount: 0,
            cess_amount: 0,
            ecommerce_gstin: row.orig_etin || null,
          };
          b2cs.push(b2csRow);
        }
        b2csRow.taxable_value += sign * entry.taxable_value;
        b2csRow.igst_amount += sign * entry.igst_amount;
        b2csRow.cgst_amount += sign * entry.cgst_amount;
        b2csRow.sgst_amount += sign * entry.sgst_amount;
        b2csRow.cess_amount += sign * entry.cess_amount;
      });

      // Table 12 is reported net of credit/debit notes issued in the period.
      const noteLines = await client.query(
        `SELECT -1 AS sign, COALESCE(NULLIF(TRIM(cni.hsn_sac), ''), it.hsn_sac, 'NA') AS hsn_sac, cni.description AS item_name, cni.unit,
                cni.qty AS quantity, cni.tax_rate,
                (cni.line_total - cni.tax_amount) AS item_taxable_value,
                CASE WHEN cn.igst_total > 0 THEN cni.tax_amount ELSE 0 END AS igst_amount,
                CASE WHEN cn.igst_total > 0 THEN 0 ELSE ROUND(cni.tax_amount / 2, 2) END AS cgst_amount,
                CASE WHEN cn.igst_total > 0 THEN 0 ELSE cni.tax_amount - ROUND(cni.tax_amount / 2, 2) END AS sgst_amount,
                c.gstin AS customer_gstin
           FROM credit_note_items cni
           JOIN credit_notes cn ON cn.id = cni.credit_note_id
           LEFT JOIN items it ON it.id = cni.item_id
           LEFT JOIN customers c ON c.id = cn.customer_id
          WHERE cn.business_id = $1::uuid AND cn.status = 'active' ${cdnBranchCn} ${cdnCreditDate}
         UNION ALL
         SELECT 1 AS sign, COALESCE(dni.hsn_sac, it.hsn_sac, 'NA'), dni.description, dni.unit,
                dni.qty, dni.tax_rate, dni.taxable_value,
                dni.igst_amount, dni.cgst_amount, dni.sgst_amount,
                c.gstin
           FROM debit_note_items dni
           JOIN debit_notes dn ON dn.id = dni.debit_note_id
           LEFT JOIN items it ON it.id = dni.item_id
           LEFT JOIN customers c ON c.id = dn.customer_id
          WHERE dn.business_id = $1::uuid AND dn.status = 'active' ${cdnBranchDn} ${cdnDebitDate}`,
        cdnParams
      );
      for (const line of noteLines.rows) {
        const sign = Number(line.sign);
        const signed = {
          hsn_sac: line.hsn_sac,
          item_name: line.item_name,
          unit: line.unit,
          quantity: sign * (parseFloat(line.quantity) || 0),
          item_taxable_value: sign * (parseFloat(line.item_taxable_value) || 0),
          igst_amount: sign * (parseFloat(line.igst_amount) || 0),
          cgst_amount: sign * (parseFloat(line.cgst_amount) || 0),
          sgst_amount: sign * (parseFloat(line.sgst_amount) || 0),
        };
        const rate = parseFloat(line.tax_rate) || 0;
        const gstin = line.customer_gstin ? String(line.customer_gstin).trim() : '';
        const netInto = (list: HSNEntry[]) => {
          const key = signed.hsn_sac || 'NA';
          const uqc = toGstUqc(signed.unit, signed.hsn_sac);
          const sameUnit = list.some((h) => h.hsn_sac === key && h.rate === rate && h.uqc === uqc);
          const sameHsn = sameUnit ? null : list.find((h) => h.hsn_sac === key && h.rate === rate);
          addHsn(list, sameHsn ? { ...signed, unit: sameHsn.uqc } : signed, rate);
        };
        netInto(hsn);
        netInto(gstin.length === 15 ? hsn_b2b : hsn_b2c);
      }

      return {
        summary,
        b2b,
        b2cl,
        b2cs,
        hsn,
        hsn_b2b,
        hsn_b2c,
        nil,
        exports,
        sez,
        cdn,
        cdn_b2cs,
        at,
        atadj,
        doc_issue_summary,
        doc_issues,
      };

    } finally {
      client.release();
    }
  }
}

