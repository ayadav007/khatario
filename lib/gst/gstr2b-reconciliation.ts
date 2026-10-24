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
import { applyStoredDecisionRetention } from '@/lib/gst/decision-retention';

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

/**
 * Supplier invoice numbers as typed in books and as filed by the supplier differ in separators,
 * case and zero padding ("inv/003" vs "INV-3"). Compare letters and digits only, without
 * leading zeros in each run of digits.
 */
export function normalizeDocNumber(no: unknown): string {
  return String(no ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/(^|[^0-9])0+(?=[0-9])/g, '$1');
}

/** A supplier invoice number we can store and match. Null, empty and whitespace are not numbers. */
export function isBlankInvoiceNumber(no: unknown): boolean {
  return String(no ?? '').trim() === '';
}

/** Books document types that are supplier-issued notes, not purchase invoices or purchase returns. */
export function booksNoteKind(documentType: unknown): 'credit_note' | 'debit_note' | null {
  const type = String(documentType || '');
  if (type === 'supplier_credit_note' || type === 'credit_note') return 'credit_note';
  if (type === 'supplier_debit_note' || type === 'debit_note') return 'debit_note';
  return null;
}

function portalMatchKey(inv: { document_type?: string; supplier_gstin?: string; invoice_number?: string }): string | null {
  const gstin = String(inv.supplier_gstin || '').trim().toUpperCase();
  const number = normalizeDocNumber(inv.invoice_number);
  if (inv.document_type === 'credit_note') return `credit_note|${gstin}|${number}`;
  if (inv.document_type === 'debit_note') return `debit_note|${gstin}|${number}`;
  if (inv.document_type === 'import_goods') return `IMPG|${number}`;
  if (inv.document_type === 'invoice') return `${gstin}|${number}`;
  return null;
}

export interface MissingReference {
  source: 'books' | 'gstr2b';
  reason: 'missing_invoice_number' | 'missing_invoice_date';
  purchase_id: string | null;
  gstr2b_invoice_id: string | null;
  supplier_gstin: string;
  bill_date: string | null;
}

export interface ReconciliationResult {
  matches: ReconciliationMatch[];
  missing_references: MissingReference[];
}

const TOLERANCE_DAYS = 2; // Allow 2 days tolerance for invoice date matching
const TOLERANCE_AMOUNT = 1; // Allow ₹1 tolerance per tax head and on taxable value

function periodWindow(filing_period: string) {
  const [year, month] = filing_period.split('-').map(Number);
  const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
  const endDate = `${year}-${month.toString().padStart(2, '0')}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
  const fyStart = month >= 4 ? year : year - 1;
  const carryFrom = `${fyStart - 1}-04-01`;
  return { startDate, endDate, carryFrom };
}

export class GSTR2BReconciliationEngine {
  private pool = getPool();

  /**
   * Perform reconciliation for a given filing period.
   * Purchases and statement lines with no invoice number are left out of matching and returned
   * as missing_references. They are not written to gstr2b_reconciliation and the source bills
   * are not changed.
   */
  async reconcile(business_id: string, filing_period: string): Promise<ReconciliationResult> {
    const client = await this.pool.connect();
    
    try {
      const missing_references = await this.listMissingReferences(client, business_id, filing_period);
      const blankPurchases = new Set(
        missing_references.filter((row) => row.purchase_id).map((row) => row.purchase_id)
      );
      const blankStatements = new Set(
        missing_references.filter((row) => row.gstr2b_invoice_id).map((row) => row.gstr2b_invoice_id)
      );

      const booksInvoices = (await this.fetchBooksInvoices(client, business_id, filing_period))
        .filter((row: any) => !blankPurchases.has(row.purchase_id) && !isBlankInvoiceNumber(row.invoice_number) && row.invoice_date);
      const gstr2bInvoices = (await this.fetchGSTR2BInvoices(client, business_id, filing_period))
        .filter((row: any) => !blankStatements.has(row.gstr2b_invoice_id) && !isBlankInvoiceNumber(row.invoice_number) && row.invoice_date);

      const matches = await this.matchInvoices(client, business_id, filing_period, booksInvoices, gstr2bInvoices);
      await this.storeReconciliationRecords(client, business_id, filing_period, matches);

      return { matches, missing_references };
    } finally {
      client.release();
    }
  }

  /**
   * Purchases in the filing window, and statement lines for the period, that have no invoice
   * number. Same date window as the books query, including carry-forward. Read-only.
   */
  async listMissingReferences(client: any, business_id: string, filing_period: string): Promise<MissingReference[]> {
    const { startDate, endDate, carryFrom } = periodWindow(filing_period);
    const books = await client.query(
      `SELECT p.id AS purchase_id, to_char(p.bill_date, 'YYYY-MM-DD') AS bill_date,
              UPPER(TRIM(COALESCE(NULLIF(TRIM(p.supplier_gstin), ''), s.gstin, ''))) AS supplier_gstin,
              p.bill_number
         FROM purchases p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.business_id = $1
          AND COALESCE(p.status, '') NOT IN ('cancelled', 'draft')
          AND p.deleted_at IS NULL
          AND (
            (p.bill_date >= $2::date AND p.bill_date <= $3::date)
            OR (p.bill_date >= $4::date AND p.bill_date < $2::date)
          )
          AND (p.bill_number IS NULL OR btrim(p.bill_number) = '' OR p.bill_date IS NULL)`,
      [business_id, startDate, endDate, carryFrom]
    );
    const statements = await client.query(
      `SELECT id AS gstr2b_invoice_id, supplier_gstin, invoice_date, invoice_number
         FROM gstr2b_invoices
        WHERE business_id = $1 AND filing_period = $2
          AND (invoice_number IS NULL OR btrim(invoice_number) = '')`,
      [business_id, filing_period]
    );
    const out: MissingReference[] = [];
    for (const row of books.rows) {
      out.push({
        source: 'books',
        reason: !row.bill_date ? 'missing_invoice_date' : 'missing_invoice_number',
        purchase_id: row.purchase_id,
        gstr2b_invoice_id: null,
        supplier_gstin: row.supplier_gstin || '',
        bill_date: row.bill_date ? String(row.bill_date).slice(0, 10) : null,
      });
    }
    for (const row of statements.rows) {
      out.push({
        source: 'gstr2b',
        reason: 'missing_invoice_number',
        purchase_id: null,
        gstr2b_invoice_id: row.gstr2b_invoice_id,
        supplier_gstin: row.supplier_gstin || '',
        bill_date: row.invoice_date ? String(row.invoice_date).slice(0, 10) : null,
      });
    }
    return out;
  }

  /**
   * Fetch invoices from purchase register (books): bills of the period, plus earlier bills (from
   * the previous financial year on, the s.16(4) window) that no earlier reconciliation found in
   * 2B — a supplier who files late shows the bill in a later month's 2B. Earlier bills are kept
   * only if they match this period's 2B. Blocked credit (s.17(5)) is included so its 2B line is
   * not reported as "only in 2B".
   */
  private async fetchBooksInvoices(client: any, business_id: string, filing_period: string) {
    const { startDate, endDate, carryFrom } = periodWindow(filing_period);

    const query = `
      SELECT
        p.id as purchase_id,
        pi.id as purchase_item_id,
        UPPER(TRIM(COALESCE(NULLIF(TRIM(p.supplier_gstin), ''), s.gstin, ''))) as supplier_gstin,
        p.bill_number as invoice_number,
        p.bill_date as invoice_date,
        COALESCE(p.document_type, 'invoice') as document_type,
        pi.taxable_value,
        pi.igst_amount,
        pi.cgst_amount,
        pi.sgst_amount,
        COALESCE(pi.cess_amount, 0) AS cess_amount,
        (pi.igst_amount + pi.cgst_amount + pi.sgst_amount + COALESCE(pi.cess_amount, 0)) as itc_amount,
        p.is_reverse_charge,
        p.document_type as purchase_document_type,
        p.supplier_state_code,
        (p.itc_eligible IS DISTINCT FROM false) AS itc_eligible,
        (p.bill_date < $2::date) AS carried,
        COALESCE(pi.line_item_type, i.item_type) AS item_type
      FROM purchases p
      JOIN purchase_items pi ON p.id = pi.purchase_id
      LEFT JOIN items i ON pi.item_id = i.id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.business_id = $1
        AND COALESCE(p.status, '') NOT IN ('cancelled', 'draft')
        AND p.deleted_at IS NULL
        AND (
          (p.bill_date >= $2::date AND p.bill_date <= $3::date)
          OR (
            p.bill_date >= $4::date AND p.bill_date < $2::date
            AND NOT EXISTS (
              SELECT 1 FROM gstr2b_reconciliation r
               WHERE r.purchase_id = p.id AND r.filing_period < $5
                 AND r.match_status IN ('MATCHED', 'PARTIALLY_MATCHED', 'NOT_ELIGIBLE')
            )
            AND NOT EXISTS (
              SELECT 1 FROM gstr2b_reconciliation r
                JOIN reconciliation_decisions d ON d.reconciliation_id = r.id
               WHERE r.purchase_id = p.id AND d.decision IN ('ITC_NOT_ELIGIBLE', 'IGNORE')
            )
          )
        )
      ORDER BY p.bill_date, p.bill_number
    `;

    const result = await client.query(query, [business_id, startDate, endDate, carryFrom, filing_period]);

    // Group by bill (aggregate items at invoice level)
    const invoiceMap = new Map<string, any>();

    result.rows.forEach((row: any) => {
      const key = row.purchase_id;

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
          supplier_state_code: row.supplier_state_code,
          itc_eligible: row.itc_eligible,
          carried: row.carried,
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

    // Supplier invoices match on GSTIN + invoice number. Import goods match on the bill of
    // entry. Supplier credit and debit notes match on GSTIN + note number + note type, never
    // against an invoice or a purchase return.
    const gstr2bMap = new Map<string, any[]>();
    gstr2bInvoices.forEach((inv: any) => {
      const key = portalMatchKey(inv);
      if (!key) return;
      if (!gstr2bMap.has(key)) gstr2bMap.set(key, []);
      gstr2bMap.get(key)!.push(inv);
    });

    for (const bookInv of booksInvoices) {
      const noteKind = booksNoteKind(bookInv.purchase_document_type || bookInv.document_type);
      const isImportGoods = !noteKind && (bookInv.purchase_document_type === 'bill_of_entry' ||
        (bookInv.supplier_state_code === '96' && !bookInv.has_service_item));
      const isImportService = !isImportGoods && bookInv.supplier_state_code === '96' && bookInv.is_reverse_charge;
      // s.9(4): a domestic reverse-charge bill from an unregistered supplier is self-invoiced and
      // never appears in 2B.
      if (!isImportGoods && !isImportService && !bookInv.supplier_gstin && bookInv.is_reverse_charge) continue;

      const base = {
        supplier_gstin: bookInv.supplier_gstin || '',
        invoice_number: bookInv.invoice_number,
        invoice_date: bookInv.invoice_date,
        document_type: noteKind || bookInv.document_type,
        books_taxable_value: bookInv.taxable_value,
        books_igst: bookInv.igst_amount,
        books_cgst: bookInv.cgst_amount,
        books_sgst: bookInv.sgst_amount,
        books_cess: bookInv.cess_amount,
        books_itc_amount: bookInv.itc_amount,
        purchase_id: bookInv.purchase_id,
        is_import_goods: isImportGoods,
        is_import_services: isImportService,
        is_credit_note: noteKind === 'credit_note',
      };

      if (isImportService) {
        // Import of services is paid under reverse charge and has no 2B section to match.
        matches.push({
          ...base,
          match_status: 'MATCHED',
          gstr2b_taxable_value: 0, gstr2b_igst: 0, gstr2b_cgst: 0, gstr2b_sgst: 0, gstr2b_cess: 0,
          gstr2b_itc_eligibility: 'eligible',
          difference_taxable_value: 0, difference_igst: 0, difference_cgst: 0, difference_sgst: 0, difference_cess: 0,
        });
        continue;
      }

      const key = noteKind
        ? `${noteKind}|${String(bookInv.supplier_gstin || '').trim().toUpperCase()}|${normalizeDocNumber(bookInv.invoice_number)}`
        : isImportGoods
          ? `IMPG|${normalizeDocNumber(bookInv.invoice_number)}`
          : `${String(bookInv.supplier_gstin || '').trim().toUpperCase()}|${normalizeDocNumber(bookInv.invoice_number)}`;
      const matched2B = this.findMatch(bookInv, gstr2bMap.get(key) ?? [], matched2BIds);

      if (!matched2B) {
        // An earlier month's bill is reported only in the period whose 2B shows it.
        if (bookInv.carried) continue;
        matches.push({
          ...base,
          match_status: 'MISSING_IN_2B',
          gstr2b_taxable_value: 0, gstr2b_igst: 0, gstr2b_cgst: 0, gstr2b_sgst: 0, gstr2b_cess: 0,
          gstr2b_itc_eligibility: '',
          difference_taxable_value: bookInv.taxable_value,
          difference_igst: bookInv.igst_amount,
          difference_cgst: bookInv.cgst_amount,
          difference_sgst: bookInv.sgst_amount,
          difference_cess: bookInv.cess_amount,
        });
        continue;
      }

      matched2BIds.add(matched2B.gstr2b_invoice_id);
      const n = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
      const isFullyMatched = this.isAmountMatch(bookInv, matched2B);
      // Not eligible when 2B says so, or the books block the credit under s.17(5).
      const isEligible = (matched2B.itc_eligibility || 'eligible') === 'eligible' && bookInv.itc_eligible !== false;

      matches.push({
        ...base,
        match_status: isEligible ? (isFullyMatched ? 'MATCHED' : 'PARTIALLY_MATCHED') : 'NOT_ELIGIBLE',
        gstr2b_taxable_value: n(matched2B.taxable_value),
        gstr2b_igst: n(matched2B.igst_amount),
        gstr2b_cgst: n(matched2B.cgst_amount),
        gstr2b_sgst: n(matched2B.sgst_amount),
        gstr2b_cess: n(matched2B.cess_amount),
        gstr2b_itc_eligibility: matched2B.itc_eligibility || 'eligible',
        difference_taxable_value: bookInv.taxable_value - n(matched2B.taxable_value),
        difference_igst: bookInv.igst_amount - n(matched2B.igst_amount),
        difference_cgst: bookInv.cgst_amount - n(matched2B.cgst_amount),
        difference_sgst: bookInv.sgst_amount - n(matched2B.sgst_amount),
        difference_cess: bookInv.cess_amount - n(matched2B.cess_amount),
        gstr2b_invoice_id: matched2B.gstr2b_invoice_id,
      });
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
          is_import_goods: gstr2bInv.document_type === 'import_goods',
          is_import_services: false,
          is_credit_note: gstr2bInv.document_type === 'credit_note'
        });
      }
    });

    return matches;
  }

  /**
   * The unused 2B line with the same normalised number whose date is closest to the bill's,
   * within TOLERANCE_DAYS. A 2B line is never matched to two bills.
   */
  private findMatch(bookInv: any, candidates: any[], used: Set<string>): any | null {
    const day = (d: unknown) => {
      if (d instanceof Date) return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
      const m = String(d ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
    };
    const bookDay = day(bookInv.invoice_date);
    let best: any = null;
    let bestDiff = Infinity;
    for (const c of candidates) {
      if (used.has(c.gstr2b_invoice_id)) continue;
      const diff = Math.abs(bookDay - day(c.invoice_date));
      if (diff <= TOLERANCE_DAYS && diff < bestDiff) {
        best = c;
        bestDiff = diff;
      }
    }
    return best;
  }

  /**
   * Amounts match head by head and on taxable value. Comparing only the total would pass an
   * inter-state bill booked as IGST that the supplier reported as CGST + SGST (credit is taken in
   * the head the supplier charged), or a wrong taxable value with the same tax.
   */
  private isAmountMatch(bookInv: any, gstr2bInv: any): boolean {
    const n = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
    const pairs: Array<[number, number]> = [
      [bookInv.taxable_value, n(gstr2bInv.taxable_value)],
      [bookInv.igst_amount, n(gstr2bInv.igst_amount)],
      [bookInv.cgst_amount, n(gstr2bInv.cgst_amount)],
      [bookInv.sgst_amount, n(gstr2bInv.sgst_amount)],
      [bookInv.cess_amount, n(gstr2bInv.cess_amount)],
    ];
    return pairs.every(([a, b]) => Math.abs(a - b) <= TOLERANCE_AMOUNT);
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
    // Re-reconciliation updates rows in place (same id) so user decisions stay attached. Rows no
    // longer produced are removed only when nobody has decided on them.
    await client.query('BEGIN');
    try {
      await applyStoredDecisionRetention(client, business_id, filing_period, matches);
      const keptIds: string[] = [];
      for (const match of matches) {
        if (isBlankInvoiceNumber(match.invoice_number) || !match.invoice_date) {
          throw new Error('Reconciliation row is missing an invoice number or date');
        }
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
          RETURNING id
        `;
      
        const saved = await client.query(query, [
          business_id,
          filing_period,
          match.purchase_id || null,
          match.gstr2b_invoice_id || null,
          match.match_status,
          match.supplier_gstin || '',
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
        keptIds.push(saved.rows[0].id);
        match.reconciliation_id = saved.rows[0].id;
      }
      await client.query(
        `DELETE FROM gstr2b_reconciliation r
          WHERE r.business_id = $1 AND r.filing_period = $2 AND NOT (r.id = ANY($3::uuid[]))
            AND NOT EXISTS (SELECT 1 FROM reconciliation_decisions d WHERE d.reconciliation_id = r.id)`,
        [business_id, filing_period, keptIds]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  }

  /**
   * Record user decision for a reconciliation record
   */
  async recordDecision(business_id: string, decision: UserDecision): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      await client.query(
        `INSERT INTO reconciliation_decision_history (
           reconciliation_id, business_id, decision, decision_date, decided_by_user_id,
           remarks, eligible_itc_amount, deferred_to_period,
           supplier_gstin, invoice_number, invoice_date, document_type, filing_period,
           books_igst, books_cgst, books_sgst, books_cess, match_status, retention_reason
         )
         SELECT d.reconciliation_id, d.business_id, d.decision, d.decision_date, d.decided_by_user_id,
                d.remarks, d.eligible_itc_amount, d.deferred_to_period,
                r.supplier_gstin, r.invoice_number, r.invoice_date, r.document_type, r.filing_period,
                r.books_igst, r.books_cgst, r.books_sgst, r.books_cess, r.match_status, 'superseded'
           FROM reconciliation_decisions d
           JOIN gstr2b_reconciliation r ON r.id = d.reconciliation_id
          WHERE d.reconciliation_id = $1`,
        [decision.reconciliation_id]
      );

      // The current row is replaced. The history insert above keeps the previous decision.
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

