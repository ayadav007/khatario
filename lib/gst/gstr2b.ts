import { getPool } from '@/lib/db';

export interface GSTR2BFilters {
  business_id: string;
  month?: number;
  year?: number;
  from_date?: string;
  to_date?: string;
}

export interface GSTR2BSummary {
  total_inward_supplies: number;
  total_tax_amount: number;
  total_itc_eligible: number;
  total_itc_available?: number; // Total ITC available (sum of ITC from purchases)
  purchase_count: number;
  b2b_count: number;
  import_count: number;
}

export interface B2BPurchase {
  supplier_gstin: string;
  supplier_name: string;
  bill_number: string;
  bill_date: string;
  bill_value: number;
  place_of_supply: string;
  reverse_charge: string; // 'Y' or 'N'
  rate: number;
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
  itc_eligible: string; // 'Y' or 'N'
  itc_availed: string; // 'Y' or 'N'
  reconciliation_decision?: string | null;
  reconciliation_status?: string | null;
}

export interface ImportEntry {
  port_code: string;
  bill_number: string;
  bill_date: string;
  bill_value: number;
  taxable_value: number;
  igst: number;
  cess: number;
}

export interface CDNREntry {
  supplier_gstin: string | null;
  supplier_name: string | null;
  note_number: string;
  note_date: string;
  note_type: 'C' | 'D'; // Credit or Debit
  bill_number: string | null;
  bill_date: string | null;
  note_value: number;
  taxable_value: number;
  rate: number;
  igst: number;
  cgst: number;
  sgst: number;
}

export interface ITCSummary {
  description: string;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export class GSTR2BGenerator {
  private pool = getPool();

  async generate(filters: GSTR2BFilters) {
    const { business_id, month, year, from_date, to_date } = filters;
    let dateCondition = '';
    const params: any[] = [business_id];
    let pIdx = 2;

    if (from_date && to_date) {
      dateCondition = `AND p.bill_date BETWEEN $${pIdx} AND $${pIdx + 1}`;
      params.push(from_date, to_date);
    } else if (month && year) {
      const start = `${year}-${month.toString().padStart(2, '0')}-01`;
      dateCondition = `AND p.bill_date >= $${pIdx}::date AND p.bill_date < ($${pIdx}::date + INTERVAL '1 month')`;
      params.push(start);
    }

    const client = await this.pool.connect();
    try {
      // 1. Fetch Purchases with Items
      const purchasesQuery = `
        SELECT 
          p.id, p.bill_number, p.bill_date, p.grand_total, 
          p.place_of_supply_state_code, p.is_reverse_charge,
          p.supplier_gstin, p.itc_eligible, p.itc_availed,
          p.cgst_total, p.sgst_total, p.igst_total, p.subtotal,
          p.document_type, p.port_code,
          s.name as supplier_name,
          pi.tax_rate, pi.taxable_value,
          pi.cgst_amount, pi.sgst_amount, pi.igst_amount,
          rd.decision as reconciliation_decision,
          gr.match_status as reconciliation_status
        FROM purchases p
        JOIN purchase_items pi ON p.id = pi.purchase_id
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        LEFT JOIN gstr2b_reconciliation gr ON p.id = gr.purchase_id
        LEFT JOIN reconciliation_decisions rd ON gr.id = rd.reconciliation_id
        WHERE p.business_id = $1
          ${dateCondition}
          AND p.deleted_at IS NULL
      `;

      const result = await client.query(purchasesQuery, params);
      const rows = result.rows;

      // Initialize arrays
      const b2b: B2BPurchase[] = [];
      const imports: ImportEntry[] = [];
      const cdnr: CDNREntry[] = [];
      const itcSummary: ITCSummary[] = [];

      const summary: GSTR2BSummary = {
        total_inward_supplies: 0,
        total_tax_amount: 0,
        total_itc_eligible: 0,
        total_itc_available: 0,
        purchase_count: 0,
        b2b_count: 0,
        import_count: 0
      };

      // Group by purchase
      const purchasesMap = new Map<string, any[]>();
      rows.forEach(row => {
        if (!purchasesMap.has(row.id)) purchasesMap.set(row.id, []);
        purchasesMap.get(row.id)!.push(row);
      });

      for (const [purchaseId, items] of purchasesMap) {
        const purchase = items[0];
        const totalValue = parseFloat(purchase.grand_total);
        
        // Import classification logic (as per GST law):
        // 1. Bill of Entry (document_type = 'bill_of_entry') - Import of goods
        // 2. Import Service (document_type = 'import_service') - Import of services
        // 3. Reverse charge + No supplier GSTIN - Likely import of services
        const isImportGoods = purchase.document_type === 'bill_of_entry';
        const isImportService = purchase.document_type === 'import_service' || 
                               (purchase.is_reverse_charge && 
                                (purchase.supplier_gstin === null || purchase.supplier_gstin === ''));
        const isImport = isImportGoods || isImportService;

        summary.total_inward_supplies += parseFloat(purchase.subtotal);
        const taxTotal = parseFloat(purchase.cgst_total) + parseFloat(purchase.sgst_total) + parseFloat(purchase.igst_total);
        summary.total_tax_amount += taxTotal;
        
        if (purchase.itc_eligible) {
          summary.total_itc_eligible += taxTotal;
          if (purchase.itc_availed) {
            summary.total_itc_available = (summary.total_itc_available || 0) + taxTotal;
          }
        }

        summary.purchase_count++;

        // Group items by tax rate
        const itemsByRate = new Map<number, { taxable: number, cgst: number, sgst: number, igst: number }>();
        items.forEach(item => {
          const rate = parseFloat(item.tax_rate);
          if (!itemsByRate.has(rate)) {
            itemsByRate.set(rate, { taxable: 0, cgst: 0, sgst: 0, igst: 0 });
          }
          const group = itemsByRate.get(rate)!;
          group.taxable += parseFloat(item.taxable_value);
          group.cgst += parseFloat(item.cgst_amount);
          group.sgst += parseFloat(item.sgst_amount);
          group.igst += parseFloat(item.igst_amount);
        });

        if (isImport) {
          // Import classification
          summary.import_count++;
          for (const [rate, val] of itemsByRate) {
            imports.push({
              port_code: purchase.port_code || 'NA', // Port code for imports (if available)
              bill_number: purchase.bill_number || 'N/A',
              bill_date: new Date(purchase.bill_date).toLocaleDateString('en-IN'),
              bill_value: totalValue,
              taxable_value: val.taxable,
              igst: val.igst,
              cess: 0
            });
          }
        } else {
          // B2B Purchase
          summary.b2b_count++;
          for (const [rate, val] of itemsByRate) {
          b2b.push({
            supplier_gstin: purchase.supplier_gstin,
            supplier_name: purchase.supplier_name || 'Unknown',
            bill_number: purchase.bill_number || 'N/A',
            bill_date: new Date(purchase.bill_date).toLocaleDateString('en-IN'),
            bill_value: totalValue,
            place_of_supply: purchase.place_of_supply_state_code || '',
            reverse_charge: purchase.is_reverse_charge ? 'Y' : 'N',
            rate: rate,
            taxable_value: val.taxable,
            igst: val.igst,
            cgst: val.cgst,
            sgst: val.sgst,
            itc_eligible: purchase.itc_eligible ? 'Y' : 'N',
            itc_availed: purchase.itc_availed ? 'Y' : 'N',
            reconciliation_decision: purchase.reconciliation_decision,
            reconciliation_status: purchase.reconciliation_status
          });
          }
        }

        // ITC Summary aggregation
        const existingITC = itcSummary.find(i => i.description === 'All Other ITC');
        if (existingITC && purchase.itc_eligible) {
          existingITC.igst += parseFloat(purchase.igst_total);
          existingITC.cgst += parseFloat(purchase.cgst_total);
          existingITC.sgst += parseFloat(purchase.sgst_total);
        } else if (purchase.itc_eligible) {
          itcSummary.push({
            description: 'All Other ITC',
            igst: parseFloat(purchase.igst_total),
            cgst: parseFloat(purchase.cgst_total),
            sgst: parseFloat(purchase.sgst_total),
            cess: 0
          });
        }
      }

      return {
        summary,
        b2b,
        imports,
        cdnr, // Empty for now
        itc_summary: itcSummary
      };

    } finally {
      client.release();
    }
  }
}

