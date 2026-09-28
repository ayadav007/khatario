import { getPool } from '@/lib/db';
import { GSTR1Generator } from './gstr1';
import { GSTR3BGenerator, TaxBreakdown } from './gstr3b';
import { GSTR2BGenerator } from './gstr2b';

export interface GSTR9Filters {
  business_id: string;
  financial_year: number; // e.g., 2024 for FY 2024-25
}

export interface GSTR9Data {
  financial_year: string; // "2024-25"
  business_gstin: string;
  
  // Table 4: Details of advances, inwards and outward supplies on which tax is payable
  // Sourced from BOOKS (Sales Invoices)
  table_4: {
    A: TaxBreakdown; // B2C
    B: TaxBreakdown; // B2B
    C: TaxBreakdown; // Exports (WPAY)
    D: TaxBreakdown; // SEZ (WPAY)
    E: TaxBreakdown; // Deemed Exports
    F: TaxBreakdown; // Advances
    G: TaxBreakdown; // Inward RCM
    H: TaxBreakdown; // Sub-total (A to G)
    I: TaxBreakdown; // Credit Notes (-)
    J: TaxBreakdown; // Debit Notes (+)
    K: TaxBreakdown; // Amendments (+)
    L: TaxBreakdown; // Amendments (-)
    M: TaxBreakdown; // Sub-total (I to L)
    N: TaxBreakdown; // Total (H + M)
  };

  // Comparison data from GSTR-1
  table_4_return: {
    taxable_value: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  };
  
  // Table 5: Details of Outward supplies on which tax is not payable
  // Sourced from BOOKS
  table_5: {
    A: TaxBreakdown; // Exports (WOPAY)
    B: TaxBreakdown; // SEZ (WOPAY)
    C: TaxBreakdown; // RCM (Sales)
    D: TaxBreakdown; // Exempted
    E: TaxBreakdown; // Nil Rated
    F: TaxBreakdown; // Non-GST
    G: TaxBreakdown; // Sub-total (A to F)
    H: TaxBreakdown; // Credit Notes (-)
    I: TaxBreakdown; // Debit Notes (+)
    J: TaxBreakdown; // Amendments (+)
    K: TaxBreakdown; // Amendments (-)
    L: TaxBreakdown; // Sub-total (H to K)
    M: TaxBreakdown; // Turnover not liable to tax (G + L)
    N: TaxBreakdown; // Total Turnover (4N + 5M - 4G)
  };

  // Comparison data from GSTR-1
  table_5_return: {
    taxable_value: number;
  };
  
  // Table 6: Details of ITC availed during the financial year
  // 6A from GSTR-3B, 6B-6H from BOOKS
  table_6: {
    A: TaxBreakdown; // GSTR-3B Total
    B: { inputs: TaxBreakdown; capital_goods: TaxBreakdown; input_services: TaxBreakdown }; // Inward (non-RCM)
    C: { inputs: TaxBreakdown; capital_goods: TaxBreakdown; input_services: TaxBreakdown }; // RCM (Unregistered)
    D: { inputs: TaxBreakdown; capital_goods: TaxBreakdown; input_services: TaxBreakdown }; // RCM (Registered)
    E: { inputs: TaxBreakdown; capital_goods: TaxBreakdown }; // Import Goods
    F: TaxBreakdown; // Import Services
    G: TaxBreakdown; // ISD
    H: TaxBreakdown; // Reclaimed
    I: TaxBreakdown; // Sub-total (B to H)
    J: TaxBreakdown; // Difference (I - A)
    K: TaxBreakdown; // TRAN-1
    L: TaxBreakdown; // TRAN-2
    M: TaxBreakdown; // Other (ITC-01 etc)
    N: TaxBreakdown; // Sub-total (K to M)
    O: TaxBreakdown; // Total ITC (I + N)
  };
  
  // Table 7: Details of ITC Reversed and Ineligible ITC
  // MANUAL DECLARATION
  table_7: {
    A: TaxBreakdown; // Rule 37
    B: TaxBreakdown; // Rule 39
    C: TaxBreakdown; // Rule 42
    D: TaxBreakdown; // Rule 43
    E: TaxBreakdown; // Section 17(5)
    F: TaxBreakdown; // TRAN-1 Reversal
    G: TaxBreakdown; // TRAN-2 Reversal
    H: TaxBreakdown; // Other
    I: TaxBreakdown; // Total Reversal
    J: TaxBreakdown; // Net ITC (6O - 7I)
  };

  // Table 8: Other ITC related information
  // READ-ONLY REFERENCE
  table_8: {
    A: TaxBreakdown; // GSTR-2B (Reference)
    B: TaxBreakdown; // 6B + 6H (Books)
    C: TaxBreakdown; // Next FY ITC
    D: TaxBreakdown; // Difference (A - (B+C))
    E: TaxBreakdown; // Available but not availed
    F: TaxBreakdown; // Available but ineligible
    G: TaxBreakdown; // IGST on Imports
    H: TaxBreakdown; // IGST on Imports (availed in 6E)
    I: TaxBreakdown; // Difference (G - H)
    J: TaxBreakdown; // Lapsed (I)
    K: TaxBreakdown; // Total Lapsed (E + F + J)
  };

  // Table 9: Details of tax paid
  table_9: {
    igst: { payable: number; cash: number; credit: number };
    cgst: { payable: number; cash: number; credit: number };
    sgst: { payable: number; cash: number; credit: number };
    cess: { payable: number; cash: number; credit: number };
    interest: { payable: number; cash: number };
    late_fee: { payable: number; cash: number };
    penalty: { payable: number; cash: number };
    other: { payable: number; cash: number };
  };

  // Tables 10-14: Transactions of FY declared in next FY
  // MANUAL DECLARATION
  table_10_14: {
    10: TaxBreakdown; // Supplies (+)
    11: TaxBreakdown; // Supplies (-)
    12: TaxBreakdown; // ITC Reversal (-)
    13: TaxBreakdown; // ITC Availed (+)
    14: { igst: number; cgst: number; sgst: number; cess: number; interest: number }; // Differential tax paid
  };

  // Table 15-16: Manual declaration required
  table_15: {
    A: TaxBreakdown; // Refund claimed
    B: TaxBreakdown; // Refund sanctioned
    C: TaxBreakdown; // Refund rejected
    D: TaxBreakdown; // Refund pending
    E: TaxBreakdown; // Demand of taxes
    F: TaxBreakdown; // Demand paid
    G: TaxBreakdown; // Demand pending
  };
  table_16: {
    A: TaxBreakdown; // Composition supplies
    B: TaxBreakdown; // Deemed supply
    C: TaxBreakdown; // Approval basis
  };

  // Table 17-18: HSN Summary
  hsn_outward: Array<{
    hsn_sac: string;
    description: string;
    uqc: string;
    total_quantity: number;
    total_value: number;
    taxable_value: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  }>;
  hsn_inward: Array<{
    hsn_sac: string;
    description: string;
    uqc: string;
    total_quantity: number;
    total_value: number;
    taxable_value: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  }>;

  validation: {
    warnings: string[];
    errors: string[];
  };
  flags: {
    manual_declaration_required: string[];
  };

  /**
   * FY aggregate of RCM on pooled ledger (2155) where tax heads are unknown.
   * Not added to Table 9 IGST/CGST/SGST — RCM not split into tax heads; cannot classify.
   */
  rcm_unclassified: number;
}

function emptyTaxBreakdown(): TaxBreakdown {
  return { taxable_value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
}

function addTaxBreakdown(target: TaxBreakdown, source: TaxBreakdown) {
  target.taxable_value += source.taxable_value || 0;
  target.igst += source.igst || 0;
  target.cgst += source.cgst || 0;
  target.sgst += source.sgst || 0;
  target.cess += source.cess || 0;
}

export type ItcType = 'inputs' | 'capital_goods' | 'input_services';

/** Explicit itc_type wins; otherwise services → input services, everything else → inputs. */
export function classifyItcType(row: {
  itc_type?: string | null;
  line_item_type?: string | null;
  item_type?: string | null;
  hsn_sac?: string | null;
}): ItcType {
  if (row.itc_type === 'inputs' || row.itc_type === 'capital_goods' || row.itc_type === 'input_services') {
    return row.itc_type;
  }
  if (row.line_item_type === 'capital_goods') return 'capital_goods';
  if (row.line_item_type === 'service' || row.item_type === 'service') return 'input_services';
  if (!row.line_item_type && !row.item_type && String(row.hsn_sac || '').startsWith('99')) return 'input_services';
  return 'inputs';
}

export class GSTR9Generator {
  private pool = getPool();
  private gstr1Generator = new GSTR1Generator();
  private gstr3bGenerator = new GSTR3BGenerator();
  private gstr2bGenerator = new GSTR2BGenerator();

  async generate(filters: GSTR9Filters, overrides: any = {}): Promise<GSTR9Data> {
    const { business_id, financial_year } = filters;
    const client = await this.pool.connect();
    
    try {
      const businessRes = await client.query('SELECT gstin FROM businesses WHERE id = $1', [business_id]);
      const businessGstin = businessRes.rows[0]?.gstin || '';

      const data: GSTR9Data = {
        financial_year: `${financial_year}-${(financial_year + 1).toString().slice(-2)}`,
        business_gstin: businessGstin,
        table_4: {
          A: emptyTaxBreakdown(), B: emptyTaxBreakdown(), C: emptyTaxBreakdown(),
          D: emptyTaxBreakdown(), E: emptyTaxBreakdown(), F: emptyTaxBreakdown(),
          G: emptyTaxBreakdown(), H: emptyTaxBreakdown(), I: emptyTaxBreakdown(),
          J: emptyTaxBreakdown(), K: emptyTaxBreakdown(), L: emptyTaxBreakdown(),
          M: emptyTaxBreakdown(), N: emptyTaxBreakdown()
        },
        table_4_return: { taxable_value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
        table_5: {
          A: emptyTaxBreakdown(), B: emptyTaxBreakdown(), C: emptyTaxBreakdown(),
          D: emptyTaxBreakdown(), E: emptyTaxBreakdown(), F: emptyTaxBreakdown(),
          G: emptyTaxBreakdown(), H: emptyTaxBreakdown(), I: emptyTaxBreakdown(),
          J: emptyTaxBreakdown(), K: emptyTaxBreakdown(), L: emptyTaxBreakdown(),
          M: emptyTaxBreakdown(), N: emptyTaxBreakdown()
        },
        table_5_return: { taxable_value: 0 },
        table_6: {
          A: emptyTaxBreakdown(),
          B: { inputs: emptyTaxBreakdown(), capital_goods: emptyTaxBreakdown(), input_services: emptyTaxBreakdown() },
          C: { inputs: emptyTaxBreakdown(), capital_goods: emptyTaxBreakdown(), input_services: emptyTaxBreakdown() },
          D: { inputs: emptyTaxBreakdown(), capital_goods: emptyTaxBreakdown(), input_services: emptyTaxBreakdown() },
          E: { inputs: emptyTaxBreakdown(), capital_goods: emptyTaxBreakdown() },
          F: emptyTaxBreakdown(), G: emptyTaxBreakdown(), H: emptyTaxBreakdown(),
          I: emptyTaxBreakdown(), J: emptyTaxBreakdown(), K: emptyTaxBreakdown(),
          L: emptyTaxBreakdown(), M: emptyTaxBreakdown(), N: emptyTaxBreakdown(),
          O: emptyTaxBreakdown()
        },
        table_7: {
          A: emptyTaxBreakdown(), B: emptyTaxBreakdown(), C: emptyTaxBreakdown(),
          D: emptyTaxBreakdown(), E: emptyTaxBreakdown(), F: emptyTaxBreakdown(),
          G: emptyTaxBreakdown(), H: emptyTaxBreakdown(), I: emptyTaxBreakdown(),
          J: emptyTaxBreakdown()
        },
        table_8: {
          A: emptyTaxBreakdown(), B: emptyTaxBreakdown(), C: emptyTaxBreakdown(),
          D: emptyTaxBreakdown(), E: emptyTaxBreakdown(), F: emptyTaxBreakdown(),
          G: emptyTaxBreakdown(), H: emptyTaxBreakdown(), I: emptyTaxBreakdown(),
          J: emptyTaxBreakdown(), K: emptyTaxBreakdown()
        },
        table_9: {
          igst: { payable: 0, cash: 0, credit: 0 },
          cgst: { payable: 0, cash: 0, credit: 0 },
          sgst: { payable: 0, cash: 0, credit: 0 },
          cess: { payable: 0, cash: 0, credit: 0 },
          interest: { payable: 0, cash: 0 },
          late_fee: { payable: 0, cash: 0 },
          penalty: { payable: 0, cash: 0 },
          other: { payable: 0, cash: 0 }
        },
        table_10_14: {
          10: emptyTaxBreakdown(), 11: emptyTaxBreakdown(), 12: emptyTaxBreakdown(), 13: emptyTaxBreakdown(),
          14: { igst: 0, cgst: 0, sgst: 0, cess: 0, interest: 0 }
        },
        table_15: {
          A: emptyTaxBreakdown(), B: emptyTaxBreakdown(), C: emptyTaxBreakdown(),
          D: emptyTaxBreakdown(), E: emptyTaxBreakdown(), F: emptyTaxBreakdown(), G: emptyTaxBreakdown()
        },
        table_16: {
          A: emptyTaxBreakdown(), B: emptyTaxBreakdown(), C: emptyTaxBreakdown()
        },
        hsn_outward: [],
        hsn_inward: [],
        validation: { warnings: [], errors: [] },
        flags: { manual_declaration_required: ['Table 7', 'Table 10-14', 'Table 15', 'Table 16'] },
        rcm_unclassified: 0,
      };

      const hsnOutMap = new Map<string, any>();
      const hsnInMap = new Map<string, any>();

      // Date range for BOOKS
      const fyFrom = `${financial_year}-04-01`;
      const fyTo = `${financial_year + 1}-03-31`;

      // 1. SOURCING FROM BOOKS (Sales) - Primary for Table 4 & 5
      const salesQuery = `
        SELECT i.*, c.gstin as customer_gstin
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
        WHERE i.business_id = $1 AND i.invoice_date >= $2 AND i.invoice_date <= $3
        AND i.status = 'final'
        AND i.deleted_at IS NULL
      `;
      const salesRes = await client.query(salesQuery, [business_id, fyFrom, fyTo]);
      
      salesRes.rows.forEach(inv => {
        const tb = { 
          taxable_value: parseFloat(inv.subtotal) || 0, 
          igst: parseFloat(inv.igst_total) || 0, 
          cgst: parseFloat(inv.cgst_total) || 0, 
          sgst: parseFloat(inv.sgst_total) || 0, 
          cess: 0 
        };
        const isB2B = !!inv.customer_gstin;
        const isExport = inv.place_of_supply_state_code === '96';
        const isSEZ = inv.place_of_supply_state_code === '97' || inv.supply_type === 'sez';
        
        if ((tb.igst + tb.cgst + tb.sgst) > 0) {
          // Table 4
          if (isSEZ) addTaxBreakdown(data.table_4.D, tb);
          else if (isExport) addTaxBreakdown(data.table_4.C, tb);
          else if (isB2B) addTaxBreakdown(data.table_4.B, tb);
          else addTaxBreakdown(data.table_4.A, tb);
        } else {
          // Table 5
          if (isSEZ) addTaxBreakdown(data.table_5.B, tb);
          else if (isExport) addTaxBreakdown(data.table_5.A, tb);
          else if (inv.document_type === 'bill_of_supply') addTaxBreakdown(data.table_5.D, tb);
          else addTaxBreakdown(data.table_5.E, tb);
        }
      });

      // Credit / debit notes issued to customers: taxed notes → 4I / 4J, untaxed → 5H / 5I.
      const notesRes = await client.query(
        `SELECT 'credit' AS kind, subtotal, igst_total, cgst_total, sgst_total
           FROM credit_notes
          WHERE business_id = $1 AND credit_note_date BETWEEN $2 AND $3
            AND COALESCE(status, 'active') <> 'cancelled'
         UNION ALL
         SELECT 'debit' AS kind, subtotal, igst_total, cgst_total, sgst_total
           FROM debit_notes
          WHERE business_id = $1 AND debit_note_date BETWEEN $2 AND $3
            AND COALESCE(status, 'active') <> 'cancelled'`,
        [business_id, fyFrom, fyTo]
      );
      notesRes.rows.forEach((n) => {
        const tb = {
          taxable_value: parseFloat(n.subtotal) || 0,
          igst: parseFloat(n.igst_total) || 0,
          cgst: parseFloat(n.cgst_total) || 0,
          sgst: parseFloat(n.sgst_total) || 0,
          cess: 0,
        };
        const taxed = tb.igst + tb.cgst + tb.sgst > 0;
        if (n.kind === 'credit') addTaxBreakdown(taxed ? data.table_4.I : data.table_5.H, tb);
        else addTaxBreakdown(taxed ? data.table_4.J : data.table_5.I, tb);
      });

      // Table 4G: inward supplies liable to reverse charge (tax payable by us).
      const rcmRes = await client.query(
        `SELECT COALESCE(SUM(subtotal), 0) AS taxable, COALESCE(SUM(igst_total), 0) AS igst,
                COALESCE(SUM(cgst_total), 0) AS cgst, COALESCE(SUM(sgst_total), 0) AS sgst
           FROM purchases
          WHERE business_id = $1 AND bill_date BETWEEN $2 AND $3
            AND status = 'final' AND deleted_at IS NULL AND is_reverse_charge = true`,
        [business_id, fyFrom, fyTo]
      );
      const rcm = rcmRes.rows[0] || {};
      addTaxBreakdown(data.table_4.G, {
        taxable_value: parseFloat(rcm.taxable) || 0,
        igst: parseFloat(rcm.igst) || 0,
        cgst: parseFloat(rcm.cgst) || 0,
        sgst: parseFloat(rcm.sgst) || 0,
        cess: 0,
      });

      data.table_5_return = { taxable_value: 0 };

      // 2. SOURCING FROM BOOKS (Purchases) - Table 6B-6F, ITC availed per books.
      // Excludes bills whose 2B reconciliation decision defers or denies the credit.
      const purchasesQuery = `
        SELECT pi.*, p.supplier_gstin, p.is_reverse_charge, p.document_type, p.itc_eligible, i.item_type
        FROM purchase_items pi
        JOIN purchases p ON pi.purchase_id = p.id AND p.deleted_at IS NULL
        LEFT JOIN items i ON pi.item_id = i.id
        WHERE p.business_id = $1 AND p.bill_date >= $2 AND p.bill_date <= $3
          AND p.status = 'final'
          AND NOT EXISTS (
            SELECT 1 FROM gstr2b_reconciliation gr
            JOIN reconciliation_decisions rd ON rd.reconciliation_id = gr.id
            WHERE gr.purchase_id = p.id
              AND rd.decision IN ('ITC_DEFERRED_TO_FUTURE', 'ITC_NOT_ELIGIBLE', 'PENDING_SUPPLIER_CORRECTION', 'IGNORE')
          )
      `;
      const purchasesRes = await client.query(purchasesQuery, [business_id, fyFrom, fyTo]);

      purchasesRes.rows.forEach(row => {
        const type = classifyItcType(row);
        const tb = { taxable_value: parseFloat(row.taxable_value) || 0, igst: parseFloat(row.igst_amount) || 0, cgst: parseFloat(row.cgst_amount) || 0, sgst: parseFloat(row.sgst_amount) || 0, cess: 0 };
        const itcAllowed = row.itc_eligible !== false;

        if (itcAllowed) {
          // IMPORT CLASSIFICATION LOGIC (for GSTR-9 Table 6E and 6F)
          // Import of Goods: Typically has IGST only (paid at customs), no CGST/SGST, document_type = 'bill_of_entry'
          // OR: IGST > 0, CGST = 0, SGST = 0, and no supplier GSTIN (foreign supplier) with goods item
          const isImportGoods = row.document_type === 'bill_of_entry' || 
                                (tb.igst > 0 && tb.cgst === 0 && tb.sgst === 0 && 
                                 !row.supplier_gstin && row.item_type !== 'service');
          
          // Import of Services: Services from outside India (no supplier GSTIN, service item type)
          // OR: Reverse charge on services from foreign supplier
          const isImportService = row.item_type === 'service' && 
                                 (!row.supplier_gstin || row.supplier_gstin.length < 15) &&
                                 (row.document_type === 'import_service' || 
                                  (row.is_reverse_charge && tb.igst > 0));
          
          if (isImportGoods) {
            // Import of goods (Table 6E) - Only Inputs and Capital Goods apply
            if (type === 'capital_goods') {
              addTaxBreakdown(data.table_6.E.capital_goods, tb);
            } else if (type === 'inputs') {
              addTaxBreakdown(data.table_6.E.inputs, tb);
            }
            // Note: Input Services cannot be import of goods, so skip if type is input_services
          } else if (isImportService) {
            // Import of services (Table 6F) - All ITC types go here for services
            addTaxBreakdown(data.table_6.F, tb);
          } else if (row.is_reverse_charge) {
            // Reverse charge (Table 6C or 6D) - Domestic reverse charge supplies
            const isReg = row.supplier_gstin && row.supplier_gstin.length >= 15;
            if (isReg) {
              // Registered supplier RCM (Table 6D)
              addTaxBreakdown(data.table_6.D[type], tb);
            } else {
              // Unregistered supplier RCM (Table 6C)
              addTaxBreakdown(data.table_6.C[type], tb);
            }
          } else {
            // Regular inward supplies (Table 6B) - Normal domestic purchases
            addTaxBreakdown(data.table_6.B[type], tb);
          }
        }

        // HSN Inward (Always from Books)
        if (row.hsn_sac) {
          const lineTotal = parseFloat(row.line_total) || 0;
          if (!hsnInMap.has(row.hsn_sac)) {
            hsnInMap.set(row.hsn_sac, { 
              hsn_sac: row.hsn_sac, 
              description: row.item_name || '', 
              uqc: 'NOS', 
              total_quantity: parseFloat(row.quantity) || 0, 
              total_value: lineTotal, 
              taxable_value: tb.taxable_value, 
              igst: tb.igst, 
              cgst: tb.cgst, 
              sgst: tb.sgst, 
              cess: tb.cess 
            });
          } else {
            const existing = hsnInMap.get(row.hsn_sac);
            existing.total_quantity += parseFloat(row.quantity) || 0;
            existing.total_value += lineTotal;
            existing.taxable_value += tb.taxable_value;
            existing.igst += tb.igst;
            existing.cgst += tb.cgst;
            existing.sgst += tb.sgst;
            existing.cess += tb.cess;
          }
        }
      });

      // Purchase returns (debit notes to suppliers) reduce ITC availed on the original bill.
      const returnsRes = await client.query(
        `SELECT pr.subtotal, pr.igst_total, pr.cgst_total, pr.sgst_total, p.is_reverse_charge, p.supplier_gstin,
                EXISTS (
                  SELECT 1 FROM purchase_items pi
                  LEFT JOIN items it ON it.id = pi.item_id
                  WHERE pi.purchase_id = p.id AND COALESCE(pi.line_item_type, it.item_type) = 'service'
                ) AND NOT EXISTS (
                  SELECT 1 FROM purchase_items pi
                  LEFT JOIN items it ON it.id = pi.item_id
                  WHERE pi.purchase_id = p.id AND COALESCE(pi.line_item_type, it.item_type, 'goods') <> 'service'
                ) AS all_services,
                EXISTS (
                  SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = p.id AND pi.itc_type = 'capital_goods'
                ) AND NOT EXISTS (
                  SELECT 1 FROM purchase_items pi
                  WHERE pi.purchase_id = p.id AND COALESCE(pi.itc_type, '') <> 'capital_goods'
                ) AS all_capital_goods
           FROM purchase_returns pr
           JOIN purchases p ON p.id = pr.purchase_id
          WHERE pr.business_id = $1 AND pr.return_date BETWEEN $2 AND $3
            AND COALESCE(pr.status, 'final') <> 'cancelled'
            AND COALESCE(p.itc_eligible, true)`,
        [business_id, fyFrom, fyTo]
      );
      returnsRes.rows.forEach((r) => {
        const neg = {
          taxable_value: -(parseFloat(r.subtotal) || 0),
          igst: -(parseFloat(r.igst_total) || 0),
          cgst: -(parseFloat(r.cgst_total) || 0),
          sgst: -(parseFloat(r.sgst_total) || 0),
          cess: 0,
        };
        const bucket: ItcType = r.all_capital_goods
          ? 'capital_goods'
          : r.all_services
            ? 'input_services'
            : 'inputs';
        if (r.is_reverse_charge) {
          const isReg = r.supplier_gstin && r.supplier_gstin.length >= 15;
          addTaxBreakdown((isReg ? data.table_6.D : data.table_6.C)[bucket], neg);
        } else {
          addTaxBreakdown(data.table_6.B[bucket], neg);
        }
      });

      // 3. COMPARISON DATA FROM RETURNS (12 Months)
      for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
        const actualMonth = monthIndex < 9 ? monthIndex + 4 : monthIndex - 8;
        const actualYear = monthIndex < 9 ? financial_year : financial_year + 1;

        // GSTR-1 (Returns Comparison)
        try {
          const gstr1 = await this.gstr1Generator.generate({ business_id, month: actualMonth, year: actualYear });
          
          // Calculate tax breakdown from HSN data (which has all tax details)
          let totalIgst = 0, totalCgst = 0, totalSgst = 0, totalCess = 0;
          gstr1.hsn.forEach(h => {
            totalIgst += h.integrated_tax || 0;
            totalCgst += h.central_tax || 0;
            totalSgst += h.state_ut_tax || 0;
            totalCess += h.cess_amount || 0;
          });
          
          // Add to Table 4 Return Comparison
          data.table_4_return.taxable_value += gstr1.summary.total_outward_taxable_supplies || 0;
          data.table_4_return.igst += totalIgst;
          data.table_4_return.cgst += totalCgst;
          data.table_4_return.sgst += totalSgst;
          data.table_4_return.cess += totalCess;

          // Calculate Table 5 Return Comparison from exports (WOPAY), nil, and non-taxable
          let totalExportsWOPAY = 0;
          gstr1.exports.forEach(exp => {
            if (exp.export_type === 'WOPAY') {
              totalExportsWOPAY += exp.taxable_value || 0;
            }
          });
          
          let totalNilRated = 0;
          gstr1.nil.forEach(n => {
            totalNilRated += (n.nil_supply || 0) + (n.exempt_supply || 0) + (n.non_gst_supply || 0);
          });
          
          data.table_5_return.taxable_value += totalExportsWOPAY + totalNilRated;
          
          // HSN Outward (Always from returns as reported)
          gstr1.hsn.forEach(h => {
            if (!hsnOutMap.has(h.hsn_sac)) {
              hsnOutMap.set(h.hsn_sac, { ...h, igst: h.integrated_tax, cgst: h.central_tax, sgst: h.state_ut_tax, cess: h.cess_amount });
            } else {
              const existing = hsnOutMap.get(h.hsn_sac);
              existing.total_quantity += h.total_quantity;
              existing.total_value += h.total_value;
              existing.taxable_value += h.taxable_value;
              existing.igst += h.integrated_tax;
              existing.cgst += h.central_tax;
              existing.sgst += h.state_ut_tax;
              existing.cess += h.cess_amount;
            }
          });
        } catch (e) {
          console.error(`Error processing GSTR-1 for ${actualMonth}/${actualYear}:`, e);
        }

        // GSTR-3B (Returns Primary for 6A and 9)
        try {
          const gstr3b = await this.gstr3bGenerator.generate({ business_id, month: actualMonth, year: actualYear });
          addTaxBreakdown(data.table_6.A, gstr3b.itc_details.net_itc);
          
          // Table 9 - Tax Paid (Sourced from 3B)
          // gross_output_tax: output 2150–2152 plus RCM by head when split; output only when RCM is pooled.
          const g3Gross = gstr3b.gross_output_tax;
          const rcm = gstr3b.rcm;
          // RCM not split into tax heads — cannot classify into IGST/CGST/SGST for Table 9.
          // Do not assign pooled RCM to any head; accumulate for disclosure only.
          if (gstr3b.rcm_mode === 'pooled' && (rcm.total || 0) > 0) {
            data.rcm_unclassified += rcm.total;
          }
          const igstPay = g3Gross.igst || 0;
          const cgstPay = g3Gross.cgst || 0;
          const sgstPay = g3Gross.sgst || 0;
          data.table_9.igst.payable += igstPay;
          data.table_9.cgst.payable += cgstPay;
          data.table_9.sgst.payable += sgstPay;
          data.table_9.cess.payable += g3Gross.cess || 0;
          
          // Paid through ITC (estimated from 3B net_itc used)
          const totalTax = igstPay + cgstPay + sgstPay;
          const totalITC = (gstr3b.itc_details.net_itc.igst || 0) + (gstr3b.itc_details.net_itc.cgst || 0) + (gstr3b.itc_details.net_itc.sgst || 0);
          
          if (totalTax > 0 && totalITC > 0) {
            const itcRatio = Math.min(1, totalITC / totalTax);
            data.table_9.igst.credit += igstPay * itcRatio;
            data.table_9.cgst.credit += cgstPay * itcRatio;
            data.table_9.sgst.credit += sgstPay * itcRatio;
            
            data.table_9.igst.cash += igstPay * (1 - itcRatio);
            data.table_9.cgst.cash += cgstPay * (1 - itcRatio);
            data.table_9.sgst.cash += sgstPay * (1 - itcRatio);
          } else {
            data.table_9.igst.cash += igstPay;
            data.table_9.cgst.cash += cgstPay;
            data.table_9.sgst.cash += sgstPay;
          }
          
          data.table_9.interest.payable += gstr3b.interest_late_fee.igst || 0;
          data.table_9.late_fee.payable += gstr3b.interest_late_fee.cgst || 0;
        } catch (e) {
          console.error(`Error processing GSTR-3B for ${actualMonth}/${actualYear}:`, e);
        }

        // GSTR-2B (Read-only Reference for Table 8A)
        try {
          const gstr2b = await this.gstr2bGenerator.generate({ business_id, month: actualMonth, year: actualYear });
          if (gstr2b.summary?.total_itc_available) {
            // Add ITC available to table 8.A IGST directly
            data.table_8.A.igst = (data.table_8.A.igst || 0) + (gstr2b.summary.total_itc_available || 0);
          }
        } catch (e) {
          console.error(`Error processing GSTR-2B for ${actualMonth}/${actualYear}:`, e);
        }
      }

      // GSTR-1 summary counts every invoice; Table 4 covers only supplies on which tax is payable.
      data.table_4_return.taxable_value -= data.table_5_return.taxable_value;

      // Manual overrides replace computed components before sub-totals are derived.
      Object.keys(overrides).forEach(path => {
        const parts = path.split('.');
        let current: any = data;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) current[parts[i]] = {};
          current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = overrides[path];
      });

      // Finalize Table 4 Sub-totals & Totals
      const t4 = data.table_4;
      [t4.A, t4.B, t4.C, t4.D, t4.E, t4.F, t4.G].forEach(tb => addTaxBreakdown(t4.H, tb));
      [t4.I, t4.J, t4.K, t4.L].forEach(tb => addTaxBreakdown(t4.M, tb));
      addTaxBreakdown(t4.N, t4.H);
      addTaxBreakdown(t4.N, t4.M);

      // Finalize Table 5 Sub-totals & Totals
      const t5 = data.table_5;
      [t5.A, t5.B, t5.C, t5.D, t5.E, t5.F].forEach(tb => addTaxBreakdown(t5.G, tb));
      [t5.H, t5.I, t5.J, t5.K].forEach(tb => addTaxBreakdown(t5.L, tb));
      addTaxBreakdown(t5.M, t5.G);
      addTaxBreakdown(t5.M, t5.L);
      addTaxBreakdown(t5.N, t4.N);
      addTaxBreakdown(t5.N, t5.M);
      t5.N.taxable_value -= t4.G.taxable_value;

      // Finalize Table 6 Sub-totals & Totals
      const t6 = data.table_6;
      [t6.B.inputs, t6.B.capital_goods, t6.B.input_services, 
       t6.C.inputs, t6.C.capital_goods, t6.C.input_services,
       t6.D.inputs, t6.D.capital_goods, t6.D.input_services,
       t6.E.inputs, t6.E.capital_goods, t6.F, t6.G, t6.H].forEach(tb => addTaxBreakdown(t6.I, tb));
      
      t6.J.igst = t6.I.igst - t6.A.igst;
      t6.J.cgst = t6.I.cgst - t6.A.cgst;
      t6.J.sgst = t6.I.sgst - t6.A.sgst;
      t6.J.cess = t6.I.cess - t6.A.cess;

      addTaxBreakdown(t6.N, t6.K); addTaxBreakdown(t6.N, t6.L); addTaxBreakdown(t6.N, t6.M);
      addTaxBreakdown(t6.O, t6.I); addTaxBreakdown(t6.O, t6.N);

      // Finalize Table 7 & 8
      const t7 = data.table_7;
      [t7.A, t7.B, t7.C, t7.D, t7.E, t7.F, t7.G, t7.H].forEach(tb => addTaxBreakdown(t7.I, tb));
      t7.J.igst = t6.O.igst - t7.I.igst;
      t7.J.cgst = t6.O.cgst - t7.I.cgst;
      t7.J.sgst = t6.O.sgst - t7.I.sgst;
      t7.J.cess = t6.O.cess - t7.I.cess;

      const t8 = data.table_8;
      // 8B is sourced from 6B and 6H as per Excel notes
      addTaxBreakdown(t8.B, t6.B.inputs); 
      addTaxBreakdown(t8.B, t6.B.capital_goods); 
      addTaxBreakdown(t8.B, t6.B.input_services); 
      addTaxBreakdown(t8.B, t6.H);

      // CA: Display differences only, no auto-adjustments.
      t8.D.igst = t8.A.igst - (t8.B.igst + t8.C.igst);
      t8.D.cgst = t8.A.cgst - (t8.B.cgst + t8.C.cgst);
      t8.D.sgst = t8.A.sgst - (t8.B.sgst + t8.C.sgst);
      
      t8.I.igst = t8.G.igst - t8.H.igst;
      t8.J.igst = t8.I.igst;
      t8.K.igst = t8.E.igst + t8.F.igst + t8.J.igst;

      // Validation warnings (DECLARATIVE)
      // 1. Books vs GSTR-1 (invoice-level outward taxable supplies: 4A–4E)
      const booksOutward = t4.A.taxable_value + t4.B.taxable_value + t4.C.taxable_value + t4.D.taxable_value + t4.E.taxable_value;
      if (Math.abs(booksOutward - data.table_4_return.taxable_value) > 10) {
        data.validation.warnings.push(`Books vs GSTR-1 Mismatch (Table 4A-4E): Books (₹${booksOutward.toFixed(2)}) vs GSTR-1 (₹${data.table_4_return.taxable_value.toFixed(2)})`);
      }
      const books5 = t5.A.taxable_value + t5.B.taxable_value + t5.D.taxable_value + t5.E.taxable_value + t5.F.taxable_value;
      if (Math.abs(books5 - data.table_5_return.taxable_value) > 10) {
        data.validation.warnings.push(`Books vs GSTR-1 Mismatch (Table 5): Books (₹${books5.toFixed(2)}) vs GSTR-1 exports WOPAY + nil/exempt/non-GST (₹${data.table_5_return.taxable_value.toFixed(2)})`);
      }
      
      // 2. ITC Register vs GSTR-3B
      const bookITC = t6.I.igst + t6.I.cgst + t6.I.sgst;
      const returnITC = t6.A.igst + t6.A.cgst + t6.A.sgst;
      if (Math.abs(bookITC - returnITC) > 10) {
        data.validation.warnings.push(`ITC Mismatch (Table 6): Purchase Register (₹${bookITC.toFixed(2)}) vs GSTR-3B (₹${returnITC.toFixed(2)})`);
      }

      // 3. Tax Paid vs Liability
      const totalPayable = data.table_9.igst.payable + data.table_9.cgst.payable + data.table_9.sgst.payable + data.table_9.cess.payable;
      const totalPaid = (data.table_9.igst.cash + data.table_9.igst.credit) + 
                        (data.table_9.cgst.cash + data.table_9.cgst.credit) + 
                        (data.table_9.sgst.cash + data.table_9.sgst.credit) + 
                        (data.table_9.cess.cash + data.table_9.cess.credit);
      
      if (Math.abs(totalPayable - totalPaid) > 10) {
        data.validation.warnings.push(`Tax Mismatch (Table 9): Payable (₹${totalPayable.toFixed(2)}) vs Paid (₹${totalPaid.toFixed(2)})`);
      }

      if (data.rcm_unclassified > 0.005) {
        data.validation.warnings.push(
          `Pooled RCM (FY total ₹${data.rcm_unclassified.toFixed(2)}) is not included in Table 9 tax heads — see field rcm_unclassified. Configure ledger 2156/2157/2158 or map manually.`
        );
      }

      data.hsn_outward = Array.from(hsnOutMap.values());
      data.hsn_inward = Array.from(hsnInMap.values());

      return data;
    } finally {
      client.release();
    }
  }
}
