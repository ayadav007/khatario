import { getPool } from '@/lib/db';

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

export interface NilRatedEntry {
  description: string;
  nil_supply: number;
  exempt_supply: number;
  non_gst_supply: number;
}

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
          ii.tax_rate, ii.hsn_sac, ii.quantity, ii.unit, ii.taxable_value as item_taxable_value,
          ii.cgst_amount, ii.sgst_amount, ii.igst_amount,
          COALESCE(ii.cess_amount, 0) AS item_cess_amount,
          ii.item_name
        FROM invoices i
        JOIN invoice_items ii ON i.id = ii.invoice_id
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

      // Classify Data
      const b2b: B2BInvoice[] = [];
      const b2cl: B2CLInvoice[] = [];
      const b2cs: B2CSInvoice[] = [];
      const exports: ExportInvoice[] = [];
      const sez: SEZInvoice[] = [];
      const hsn: HSNEntry[] = [];
      const nil: NilRatedEntry[] = [];
      const cdn: CDNEntry[] = []; // Credit/Debit Notes - empty for now since tables may not exist

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

        // --- HSN Summary Logic (one row per HSN + tax rate) ---
        items.forEach(item => {
          const key = item.hsn_sac || 'NA';
          const rate = parseFloat(item.tax_rate) || 0;
          let entry = hsn.find(h => h.hsn_sac === key && h.rate === rate);
          if (!entry) {
            entry = {
              hsn_sac: key,
              description: item.item_name, // Simplified
              uqc: item.unit,
              total_quantity: 0,
              total_value: 0,
              taxable_value: 0,
              integrated_tax: 0,
              central_tax: 0,
              state_ut_tax: 0,
              cess_amount: 0,
              rate,
            };
            hsn.push(entry);
          }
          entry.total_quantity += parseFloat(item.quantity);
          // Total value per item logic (taxable + tax)
          const itemTax = parseFloat(item.cgst_amount) + parseFloat(item.sgst_amount) + parseFloat(item.igst_amount);
          const itemVal = parseFloat(item.item_taxable_value) + itemTax;
          
          entry.total_value += itemVal;
          entry.taxable_value += parseFloat(item.item_taxable_value);
          entry.integrated_tax += parseFloat(item.igst_amount);
          entry.central_tax += parseFloat(item.cgst_amount);
          entry.state_ut_tax += parseFloat(item.sgst_amount);
          entry.cess_amount += parseFloat(item.item_cess_amount ?? 0);

          // --- Nil/Exempt Logic (0% lines: bill_of_supply → exempt, else nil) ---
          if (parseFloat(item.tax_rate) === 0) {
            let nilEntry = nil.find(n => n.description === 'Nil and exempt supplies');
            if (!nilEntry) {
              nilEntry = { description: 'Nil and exempt supplies', nil_supply: 0, exempt_supply: 0, non_gst_supply: 0 };
              nil.push(nilEntry);
            }
            const tv = parseFloat(item.item_taxable_value);
            if (inv.document_type === 'bill_of_supply') nilEntry.exempt_supply += tv;
            else nilEntry.nil_supply += tv;
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
              invoice_date: new Date(inv.invoice_date).toLocaleDateString('en-IN'),
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
               export_type: inv.export_type === 'wp' ? 'WPAY' : 'WOPAY',
               invoice_number: inv.invoice_number,
               invoice_date: new Date(inv.invoice_date).toLocaleDateString('en-IN'),
               invoice_value: totalValue,
               port_code: inv.port_code,
               shipping_bill_number: inv.shipping_bill_number,
               shipping_bill_date: inv.shipping_bill_date ? new Date(inv.shipping_bill_date).toLocaleDateString('en-IN') : null,
               rate: rate,
               taxable_value: val.taxable,
               igst_amount: val.igst
             });
          }
        } else if (isB2B) {
          // B2B
          summary.b2b_count++;
          for (const [rate, val] of itemsByRate) {
            b2b.push({
              invoice_id: invoiceId,
              gstin: inv.customer_gstin,
              receiver_name: inv.customer_name || '',
              invoice_number: inv.invoice_number,
              invoice_date: new Date(inv.invoice_date).toLocaleDateString('en-IN'),
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
          
          // WORKAROUND: If IGST > 0, it is inter-state (place_of_supply is invoice-level)
          const hasIgst = items.some(i => parseFloat(i.igst_amount) > 0);
          
          if (totalValue > b2clThreshold && hasIgst) {
             summary.b2cl_count++;
             for (const [rate, val] of itemsByRate) {
                b2cl.push({
                  invoice_id: invoiceId,
                  invoice_number: inv.invoice_number,
                  invoice_date: new Date(inv.invoice_date).toLocaleDateString('en-IN'),
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
             summary.b2cs_count++; // This counts invoices, but B2CS is aggregated in GSTR1
             
             // For the report array, we should probably aggregate.
             // But the prompt says "B2C Small... Each tab shows a paginated table."
             // Usually B2CS is shown aggregated. I will push individual entries and let UI/Export aggregate if needed, 
             // OR aggregate here. GSTR-1 JSON requires aggregation.
             // Let's aggregate here for the array.
             
             const b2csChannel: 'E-Commerce' | 'OE' =
               inv.ecommerce_operator_gstin || inv.is_ecommerce_supply ? 'E-Commerce' : 'OE';
             for (const [rate, val] of itemsByRate) {
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

      // Table 13 — document series from outward invoices in period
      const outwardDocNumbers: string[] = [];
      for (const [, invItems] of invoicesMap) {
        outwardDocNumbers.push(String(invItems[0].invoice_number));
      }
      const uniqueDocNums = [...new Set(outwardDocNumbers)].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );
      const doc_issue_summary: GSTR1DocIssueSummary | null =
        uniqueDocNums.length > 0
          ? {
              from: uniqueDocNums[0],
              to: uniqueDocNums[uniqueDocNums.length - 1],
              totnum: uniqueDocNums.length,
              cancel: 0,
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
          cn.original_invoice_date,
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
          CASE WHEN cn.subtotal > 0
            THEN ROUND((cn.tax_total / cn.subtotal) * 100, 2)
            ELSE 0
          END                             AS tax_rate,
          cn.id                           AS document_id,
          'credit_note'::text             AS document_type
        FROM credit_notes cn
        LEFT JOIN invoices i ON cn.invoice_id  = i.id AND i.deleted_at IS NULL
        LEFT JOIN customers c ON cn.customer_id = c.id AND c.deleted_at IS NULL
        WHERE cn.business_id = $1::uuid
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
          dn.original_invoice_date,
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
          CASE WHEN dn.subtotal > 0
            THEN ROUND((dn.tax_total / dn.subtotal) * 100, 2)
            ELSE 0
          END                             AS tax_rate,
          dn.id                           AS document_id,
          'debit_note'::text              AS document_type
        FROM debit_notes dn
        LEFT JOIN invoices i ON dn.invoice_id  = i.id AND i.deleted_at IS NULL
        LEFT JOIN customers c ON dn.customer_id = c.id AND c.deleted_at IS NULL
        WHERE dn.business_id = $1::uuid
          ${cdnBranchDn}
          ${cdnDebitDate}
        ORDER BY note_date ASC
      `;

      const cdnResult = await client.query(cdnQuery, cdnParams);
      cdnResult.rows.forEach((row) => {
        const gstin = row.customer_gstin ? String(row.customer_gstin).trim() : null;
        const isRegRecipient = !!gstin && gstin.length === 15;
        const noteIgst = parseFloat(row.igst_amount) || 0;
        const linkedInv = row.linked_invoice_id ? String(row.linked_invoice_id) : null;
        cdn.push({
          invoice_id: linkedInv,
          document_id: String(row.document_id),
          document_type: row.document_type as 'credit_note' | 'debit_note',
          gstin_uin_recipient: gstin,
          receiver_name: row.customer_name || null,
          note_number: row.note_number,
          note_date: new Date(row.note_date).toLocaleDateString('en-IN'),
          note_type: row.note_type as 'C' | 'D',
          place_of_supply: row.place_of_supply || '',
          invoice_value: parseFloat(row.invoice_value),
          original_invoice_number: row.original_invoice_number || null,
          original_invoice_date: row.original_invoice_date
            ? new Date(row.original_invoice_date).toLocaleDateString('en-IN')
            : null,
          note_supply_type: deriveNoteSupplyType(row.orig_supply_type ?? null, noteIgst),
          reverse_charge: row.orig_is_reverse_charge ? 'Y' : 'N',
          cdnur_typ: isRegRecipient
            ? null
            : deriveCdnurTyp({
                place_of_supply: row.place_of_supply || '',
                orig_invoice_pos: row.orig_invoice_pos ?? null,
                orig_supply_type: row.orig_supply_type ?? null,
                orig_document_type: row.orig_document_type ?? null,
                orig_export_type: row.orig_export_type ?? null,
                igst_amount: row.igst_amount,
              }),
          tax_rate: parseFloat(row.tax_rate) || 0,
          taxable_value: parseFloat(row.taxable_value),
          igst_amount: noteIgst,
          cgst_amount: parseFloat(row.cgst_amount) || 0,
          sgst_amount: parseFloat(row.sgst_amount) || 0,
          cess_amount: parseFloat(row.cess_amount) || 0,
        });
      });

      return {
        summary,
        b2b,
        b2cl,
        b2cs,
        hsn,
        nil,
        exports,
        sez,
        cdn,
        doc_issue_summary,
      };

    } finally {
      client.release();
    }
  }
}

