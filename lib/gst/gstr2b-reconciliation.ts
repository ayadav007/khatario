/**
 * GSTR-2B Reconciliation Engine
 * 
 * GST-law compliant reconciliation between:
 * - Books of accounts (Purchase Register)
 * - GSTR-2B data (from GST portal)
 * 
 * PRINCIPLES:
 * - GSTR-2B is the FINAL authority for ITC eligibility
 * - NO auto-adjustments
 * - All mismatches require USER decision
 * - Full audit trail maintained
 */

import { getPool } from '@/lib/db';

export interface ReconciliationMatch {
  reconciliation_id?: string;
  match_status: 'MATCHED' | 'PARTIALLY_MATCHED' | 'MISSING_IN_2B' | 'ONLY_IN_2B' | 'NOT_ELIGIBLE';
  
  // Invoice identifiers
  supplier_gstin: string;
  invoice_number: string;
  invoice_date: Date | string;
  document_type: string;
  
  // Books values (from purchase register)
  books_taxable_value: number;
  books_igst: number;
  books_cgst: number;
  books_sgst: number;
  books_cess: number;
  books_itc_amount: number;
  
  // GSTR-2B values (from portal)
  gstr2b_taxable_value: number;
  gstr2b_igst: number;
  gstr2b_cgst: number;
  gstr2b_sgst: number;
  gstr2b_cess: number;
  gstr2b_itc_eligibility: string;
  
  // Differences
  difference_taxable_value: number;
  difference_igst: number;
  difference_cgst: number;
  difference_sgst: number;
  difference_cess: number;
  
  // References
  purchase_id?: string;
  purchase_item_id?: string;
  gstr2b_invoice_id?: string;
  
  // Special cases
  is_import_goods: boolean;
  is_import_services: boolean;
  is_credit_note: boolean;
}

export interface UserDecision {
  reconciliation_id: string;
  decision: 'PENDING_SUPPLIER_CORRECTION' | 'ITC_ELIGIBLE_THIS_PERIOD' | 'ITC_DEFERRED_TO_FUTURE' | 'ITC_NOT_ELIGIBLE' | 'IGNORE';
  remarks?: string;
  eligible_itc_amount?: number;
  deferred_to_period?: string; // YYYY-MM format
  decided_by_user_id: string;
}

const TOLERANCE_DAYS = 2; // Allow 2 days tolerance for invoice date matching
const TOLERANCE_AMOUNT = 1; // Allow ₹1 tolerance for amount matching

export class GSTR2BReconciliationEngine {
  private pool = getPool();

  /**
   * Perform reconciliation for a given filing period
   * Returns invoice-level matches
   */
  async reconcile(business_id: string, filing_period: string): Promise<ReconciliationMatch[]> {
    const client = await this.pool.connect();
    
    try {
      // 1. Fetch purchases from books (purchase register)
      const booksInvoices = await this.fetchBooksInvoices(client, business_id, filing_period);
      
      // 2. Fetch GSTR-2B invoices (from portal data)
      const gstr2bInvoices = await this.fetchGSTR2BInvoices(client, business_id, filing_period);
      
      // 3. Perform matching
      const matches = await this.matchInvoices(client, business_id, filing_period, booksInvoices, gstr2bInvoices);
      
      // 4. Store reconciliation records
      await this.storeReconciliationRecords(client, business_id, filing_period, matches);
      
      return matches;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch invoices from purchase register (books)
   */
  private async fetchBooksInvoices(client: any, business_id: string, filing_period: string) {
    const [year, month] = filing_period.split('-').map(Number);
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of month
    
    const query = `
      SELECT 
        p.id as purchase_id,
        pi.id as purchase_item_id,
        p.supplier_gstin,
        p.bill_number as invoice_number,
        p.bill_date as invoice_date,
        COALESCE(p.document_type, 'invoice') as document_type,
        pi.taxable_value,
        pi.igst_amount,
        pi.cgst_amount,
        pi.sgst_amount,
        pi.cess_amount,
        (pi.igst_amount + pi.cgst_amount + pi.sgst_amount) as itc_amount,
        p.is_reverse_charge,
        p.document_type as purchase_document_type,
        i.item_type
      FROM purchases p
      JOIN purchase_items pi ON p.id = pi.purchase_id
      LEFT JOIN items i ON pi.item_id = i.id
      WHERE p.business_id = $1
        AND p.bill_date >= $2
        AND p.bill_date <= $3
        AND (p.itc_eligible = true OR p.itc_availed = true)
        AND p.status = 'final'
        AND p.deleted_at IS NULL
      ORDER BY p.supplier_gstin, p.bill_number, p.bill_date
    `;
    
    const result = await client.query(query, [business_id, startDate, endDate]);
    
    // Group by invoice (aggregate items at invoice level)
    const invoiceMap = new Map<string, any>();
    
    result.rows.forEach((row: any) => {
      const key = `${row.supplier_gstin || 'NO_GSTIN'}_${row.invoice_number}_${row.invoice_date}`;
      
      if (!invoiceMap.has(key)) {
        invoiceMap.set(key, {
          purchase_id: row.purchase_id,
          purchase_item_ids: [row.purchase_item_id],
          supplier_gstin: row.supplier_gstin || '',
          invoice_number: row.invoice_number,
          invoice_date: row.invoice_date,
          document_type: row.document_type,
          taxable_value: 0,
          igst_amount: 0,
          cgst_amount: 0,
          sgst_amount: 0,
          cess_amount: 0,
          itc_amount: 0,
          is_reverse_charge: row.is_reverse_charge,
          purchase_document_type: row.purchase_document_type,
          has_service_item: row.item_type === 'service'
        });
      }
      
      const invoice = invoiceMap.get(key)!;
      invoice.taxable_value += parseFloat(row.taxable_value) || 0;
      invoice.igst_amount += parseFloat(row.igst_amount) || 0;
      invoice.cgst_amount += parseFloat(row.cgst_amount) || 0;
      invoice.sgst_amount += parseFloat(row.sgst_amount) || 0;
      invoice.cess_amount += parseFloat(row.cess_amount) || 0;
      invoice.itc_amount += parseFloat(row.itc_amount) || 0;
      
      if (row.item_type === 'service') {
        invoice.has_service_item = true;
      }
    });
    
    return Array.from(invoiceMap.values());
  }

  /**
   * Fetch invoices from GSTR-2B (portal data)
   */
  private async fetchGSTR2BInvoices(client: any, business_id: string, filing_period: string) {
    const query = `
      SELECT 
        id as gstr2b_invoice_id,
        supplier_gstin,
        invoice_number,
        invoice_date,
        document_type,
        taxable_value,
        igst_amount,
        cgst_amount,
        sgst_amount,
        cess_amount,
        itc_eligibility,
        itc_reversal_type,
        original_invoice_number,
        original_invoice_date
      FROM gstr2b_invoices
      WHERE business_id = $1
        AND filing_period = $2
      ORDER BY supplier_gstin, invoice_number, invoice_date
    `;
    
    const result = await client.query(query, [business_id, filing_period]);
    return result.rows;
  }

  /**
   * Match invoices between books and GSTR-2B
   */
  private async matchInvoices(
    client: any,
    business_id: string,
    filing_period: string,
    booksInvoices: any[],
    gstr2bInvoices: any[]
  ): Promise<ReconciliationMatch[]> {
    const matches: ReconciliationMatch[] = [];
    const matched2BIds = new Set<string>();
    
    // Create lookup map for GSTR-2B invoices
    const gstr2bMap = new Map<string, any>();
    gstr2bInvoices.forEach((inv: any) => {
      const key = `${inv.supplier_gstin}_${inv.invoice_number}_${inv.invoice_date}`;
      if (!gstr2bMap.has(key)) {
        gstr2bMap.set(key, []);
      }
      gstr2bMap.get(key)!.push(inv);
    });
    
    // Match books invoices with GSTR-2B
    for (const bookInv of booksInvoices) {
      // Skip imports (they don't appear in GSTR-2B)
      const isImportGoods = bookInv.purchase_document_type === 'bill_of_entry' || 
                           (bookInv.igst_amount > 0 && bookInv.cgst_amount === 0 && 
                            bookInv.sgst_amount === 0 && !bookInv.supplier_gstin && 
                            !bookInv.has_service_item);
      
      const isImportService = bookInv.has_service_item && 
                             (!bookInv.supplier_gstin || bookInv.supplier_gstin.length < 15) &&
                             bookInv.is_reverse_charge;
      
      if (isImportGoods || isImportService) {
        // Imports are handled separately - don't reconcile with GSTR-2B
        matches.push({
          match_status: 'MATCHED', // Special case: imports are always "matched" as they're not expected in 2B
          supplier_gstin: bookInv.supplier_gstin || '',
          invoice_number: bookInv.invoice_number,
          invoice_date: bookInv.invoice_date,
          document_type: bookInv.document_type,
          books_taxable_value: bookInv.taxable_value,
          books_igst: bookInv.igst_amount,
          books_cgst: bookInv.cgst_amount,
          books_sgst: bookInv.sgst_amount,
          books_cess: bookInv.cess_amount,
          books_itc_amount: bookInv.itc_amount,
          gstr2b_taxable_value: 0,
          gstr2b_igst: 0,
          gstr2b_cgst: 0,
          gstr2b_sgst: 0,
          gstr2b_cess: 0,
          gstr2b_itc_eligibility: 'eligible',
          difference_taxable_value: 0,
          difference_igst: 0,
          difference_cgst: 0,
          difference_sgst: 0,
          difference_cess: 0,
          purchase_id: bookInv.purchase_id,
          is_import_goods: isImportGoods,
          is_import_services: isImportService,
          is_credit_note: bookInv.document_type === 'credit_note'
        });
        continue;
      }
      
      // Try to find match in GSTR-2B (with tolerance)
      const matchKey = this.findMatchKey(bookInv, gstr2bMap);
      const matched2B = matchKey ? gstr2bMap.get(matchKey)?.[0] : null;
      
      if (matched2B) {
        matched2BIds.add(matched2B.gstr2b_invoice_id);
        
        // Check if values match (with tolerance)
        const isFullyMatched = this.isAmountMatch(bookInv, matched2B);
        
        // Check eligibility
        const isEligible = matched2B.itc_eligibility === 'eligible';
        
        const match: ReconciliationMatch = {
          match_status: isEligible ? (isFullyMatched ? 'MATCHED' : 'PARTIALLY_MATCHED') : 'NOT_ELIGIBLE',
          supplier_gstin: bookInv.supplier_gstin,
          invoice_number: bookInv.invoice_number,
          invoice_date: bookInv.invoice_date,
          document_type: bookInv.document_type,
          books_taxable_value: bookInv.taxable_value,
          books_igst: bookInv.igst_amount,
          books_cgst: bookInv.cgst_amount,
          books_sgst: bookInv.sgst_amount,
          books_cess: bookInv.cess_amount,
          books_itc_amount: bookInv.itc_amount,
          gstr2b_taxable_value: parseFloat(matched2B.taxable_value) || 0,
          gstr2b_igst: parseFloat(matched2B.igst_amount) || 0,
          gstr2b_cgst: parseFloat(matched2B.cgst_amount) || 0,
          gstr2b_sgst: parseFloat(matched2B.sgst_amount) || 0,
          gstr2b_cess: parseFloat(matched2B.cess_amount) || 0,
          gstr2b_itc_eligibility: matched2B.itc_eligibility || 'eligible',
          difference_taxable_value: bookInv.taxable_value - (parseFloat(matched2B.taxable_value) || 0),
          difference_igst: bookInv.igst_amount - (parseFloat(matched2B.igst_amount) || 0),
          difference_cgst: bookInv.cgst_amount - (parseFloat(matched2B.cgst_amount) || 0),
          difference_sgst: bookInv.sgst_amount - (parseFloat(matched2B.sgst_amount) || 0),
          difference_cess: bookInv.cess_amount - (parseFloat(matched2B.cess_amount) || 0),
          purchase_id: bookInv.purchase_id,
          gstr2b_invoice_id: matched2B.gstr2b_invoice_id,
          is_import_goods: false,
          is_import_services: false,
          is_credit_note: bookInv.document_type === 'credit_note'
        };
        
        matches.push(match);
      } else {
        // Missing in GSTR-2B
        matches.push({
          match_status: 'MISSING_IN_2B',
          supplier_gstin: bookInv.supplier_gstin,
          invoice_number: bookInv.invoice_number,
          invoice_date: bookInv.invoice_date,
          document_type: bookInv.document_type,
          books_taxable_value: bookInv.taxable_value,
          books_igst: bookInv.igst_amount,
          books_cgst: bookInv.cgst_amount,
          books_sgst: bookInv.sgst_amount,
          books_cess: bookInv.cess_amount,
          books_itc_amount: bookInv.itc_amount,
          gstr2b_taxable_value: 0,
          gstr2b_igst: 0,
          gstr2b_cgst: 0,
          gstr2b_sgst: 0,
          gstr2b_cess: 0,
          gstr2b_itc_eligibility: '',
          difference_taxable_value: bookInv.taxable_value,
          difference_igst: bookInv.igst_amount,
          difference_cgst: bookInv.cgst_amount,
          difference_sgst: bookInv.sgst_amount,
          difference_cess: bookInv.cess_amount,
          purchase_id: bookInv.purchase_id,
          is_import_goods: false,
          is_import_services: false,
          is_credit_note: bookInv.document_type === 'credit_note'
        });
      }
    }
    
    // Find invoices only in GSTR-2B (not in books)
    gstr2bInvoices.forEach((gstr2bInv: any) => {
      if (!matched2BIds.has(gstr2bInv.gstr2b_invoice_id)) {
        matches.push({
          match_status: 'ONLY_IN_2B',
          supplier_gstin: gstr2bInv.supplier_gstin,
          invoice_number: gstr2bInv.invoice_number,
          invoice_date: gstr2bInv.invoice_date,
          document_type: gstr2bInv.document_type,
          books_taxable_value: 0,
          books_igst: 0,
          books_cgst: 0,
          books_sgst: 0,
          books_cess: 0,
          books_itc_amount: 0,
          gstr2b_taxable_value: parseFloat(gstr2bInv.taxable_value) || 0,
          gstr2b_igst: parseFloat(gstr2bInv.igst_amount) || 0,
          gstr2b_cgst: parseFloat(gstr2bInv.cgst_amount) || 0,
          gstr2b_sgst: parseFloat(gstr2bInv.sgst_amount) || 0,
          gstr2b_cess: parseFloat(gstr2bInv.cess_amount) || 0,
          gstr2b_itc_eligibility: gstr2bInv.itc_eligibility || 'eligible',
          difference_taxable_value: -(parseFloat(gstr2bInv.taxable_value) || 0),
          difference_igst: -(parseFloat(gstr2bInv.igst_amount) || 0),
          difference_cgst: -(parseFloat(gstr2bInv.cgst_amount) || 0),
          difference_sgst: -(parseFloat(gstr2bInv.sgst_amount) || 0),
          difference_cess: -(parseFloat(gstr2bInv.cess_amount) || 0),
          gstr2b_invoice_id: gstr2bInv.gstr2b_invoice_id,
          is_import_goods: false,
          is_import_services: false,
          is_credit_note: gstr2bInv.document_type === 'credit_note'
        });
      }
    });
    
    return matches;
  }

  /**
   * Find matching key in GSTR-2B map (with tolerance)
   */
  private findMatchKey(bookInv: any, gstr2bMap: Map<string, any[]>): string | null {
    // Try exact match first
    const exactKey = `${bookInv.supplier_gstin}_${bookInv.invoice_number}_${bookInv.invoice_date}`;
    if (gstr2bMap.has(exactKey)) {
      return exactKey;
    }
    
    // Try with date tolerance
    const bookDate = new Date(bookInv.invoice_date);
    for (const [key, invoices] of gstr2bMap.entries()) {
      const [gstin, invNum, invDate] = key.split('_');
      if (gstin === bookInv.supplier_gstin && invNum === bookInv.invoice_number) {
        const gstr2bDate = new Date(invDate);
        const diffDays = Math.abs((bookDate.getTime() - gstr2bDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= TOLERANCE_DAYS) {
          return key;
        }
      }
    }
    
    return null;
  }

  /**
   * Check if amounts match (with tolerance)
   */
  private isAmountMatch(bookInv: any, gstr2bInv: any): boolean {
    const bookTotal = bookInv.igst_amount + bookInv.cgst_amount + bookInv.sgst_amount;
    const gstr2bTotal = (parseFloat(gstr2bInv.igst_amount) || 0) + 
                       (parseFloat(gstr2bInv.cgst_amount) || 0) + 
                       (parseFloat(gstr2bInv.sgst_amount) || 0);
    
    return Math.abs(bookTotal - gstr2bTotal) <= TOLERANCE_AMOUNT;
  }

  /**
   * Store reconciliation records in database
   */
  private async storeReconciliationRecords(
    client: any, 
    business_id: string, 
    filing_period: string, 
    matches: ReconciliationMatch[]
  ) {
    // Delete existing reconciliation for this period (to allow re-reconciliation)
    await client.query(
      'DELETE FROM gstr2b_reconciliation WHERE business_id = $1 AND filing_period = $2',
      [business_id, filing_period]
    );
    
    for (const match of matches) {
      const query = `
        INSERT INTO gstr2b_reconciliation (
          business_id, filing_period,
          purchase_id, gstr2b_invoice_id,
          match_status, supplier_gstin, invoice_number, invoice_date, document_type,
          books_taxable_value, books_igst, books_cgst, books_sgst, books_cess, books_itc_amount,
          gstr2b_taxable_value, gstr2b_igst, gstr2b_cgst, gstr2b_sgst, gstr2b_cess, gstr2b_itc_eligibility,
          difference_taxable_value, difference_igst, difference_cgst, difference_sgst, difference_cess,
          is_import_goods, is_import_services, is_credit_note, matched_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21,
          $22, $23, $24, $25, $26,
          $27, $28, $29, CURRENT_TIMESTAMP
        )
        ON CONFLICT (business_id, filing_period, supplier_gstin, invoice_number, invoice_date, document_type)
        DO UPDATE SET
          purchase_id = EXCLUDED.purchase_id,
          gstr2b_invoice_id = EXCLUDED.gstr2b_invoice_id,
          match_status = EXCLUDED.match_status,
          books_taxable_value = EXCLUDED.books_taxable_value,
          books_igst = EXCLUDED.books_igst,
          books_cgst = EXCLUDED.books_cgst,
          books_sgst = EXCLUDED.books_sgst,
          books_cess = EXCLUDED.books_cess,
          books_itc_amount = EXCLUDED.books_itc_amount,
          gstr2b_taxable_value = EXCLUDED.gstr2b_taxable_value,
          gstr2b_igst = EXCLUDED.gstr2b_igst,
          gstr2b_cgst = EXCLUDED.gstr2b_cgst,
          gstr2b_sgst = EXCLUDED.gstr2b_sgst,
          gstr2b_cess = EXCLUDED.gstr2b_cess,
          gstr2b_itc_eligibility = EXCLUDED.gstr2b_itc_eligibility,
          difference_taxable_value = EXCLUDED.difference_taxable_value,
          difference_igst = EXCLUDED.difference_igst,
          difference_cgst = EXCLUDED.difference_cgst,
          difference_sgst = EXCLUDED.difference_sgst,
          difference_cess = EXCLUDED.difference_cess,
          is_import_goods = EXCLUDED.is_import_goods,
          is_import_services = EXCLUDED.is_import_services,
          is_credit_note = EXCLUDED.is_credit_note,
          matched_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `;
      
      await client.query(query, [
        business_id,
        filing_period,
        match.purchase_id || null,
        match.gstr2b_invoice_id || null,
        match.match_status,
        match.supplier_gstin,
        match.invoice_number,
        match.invoice_date,
        match.document_type,
        match.books_taxable_value,
        match.books_igst,
        match.books_cgst,
        match.books_sgst,
        match.books_cess,
        match.books_itc_amount,
        match.gstr2b_taxable_value,
        match.gstr2b_igst,
        match.gstr2b_cgst,
        match.gstr2b_sgst,
        match.gstr2b_cess,
        match.gstr2b_itc_eligibility,
        match.difference_taxable_value,
        match.difference_igst,
        match.difference_cgst,
        match.difference_sgst,
        match.difference_cess,
        match.is_import_goods,
        match.is_import_services,
        match.is_credit_note
      ]);
    }
  }

  /**
   * Record user decision for a reconciliation record
   */
  async recordDecision(business_id: string, decision: UserDecision): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert/Update decision (one decision per reconciliation record)
      const insertQuery = `
        INSERT INTO reconciliation_decisions (
          reconciliation_id, business_id, decision, decided_by_user_id,
          remarks, eligible_itc_amount, deferred_to_period
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (reconciliation_id) 
        DO UPDATE SET
          decision = EXCLUDED.decision,
          decided_by_user_id = EXCLUDED.decided_by_user_id,
          remarks = EXCLUDED.remarks,
          eligible_itc_amount = EXCLUDED.eligible_itc_amount,
          deferred_to_period = EXCLUDED.deferred_to_period,
          decision_date = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `;
      
      await client.query(insertQuery, [
        decision.reconciliation_id,
        business_id,
        decision.decision,
        decision.decided_by_user_id,
        decision.remarks || null,
        decision.eligible_itc_amount || 0,
        decision.deferred_to_period || null
      ]);
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get eligible ITC amount for a reconciliation record
   * Only returns ITC if decision is 'ITC_ELIGIBLE_THIS_PERIOD'
   */
  async getEligibleITC(business_id: string, filing_period: string): Promise<number> {
    const client = await this.pool.connect();
    
    try {
      const query = `
        SELECT COALESCE(SUM(rd.eligible_itc_amount), 0) as total_eligible_itc
        FROM gstr2b_reconciliation r
        JOIN reconciliation_decisions rd ON r.id = rd.reconciliation_id
        WHERE r.business_id = $1
          AND r.filing_period = $2
          AND rd.decision = 'ITC_ELIGIBLE_THIS_PERIOD'
      `;
      
      const result = await client.query(query, [business_id, filing_period]);
      return parseFloat(result.rows[0]?.total_eligible_itc || '0');
    } finally {
      client.release();
    }
  }
}

