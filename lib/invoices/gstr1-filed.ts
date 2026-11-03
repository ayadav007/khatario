type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };

/**
 * True once the invoice is part of a GSTR-1 return marked filed.
 * Do not use invoices.is_editable for this: every finalized invoice is saved with it false.
 */
export async function isInvoiceInFiledGstr1(db: Queryable, invoiceId: string): Promise<boolean> {
  const filed = await db.query(
    `SELECT 1 FROM gstr1_filing_invoices fi
       JOIN gstr1_filings f ON f.id = fi.gstr1_filing_id
      WHERE fi.invoice_id = $1 AND f.status = 'filed'
      LIMIT 1`,
    [invoiceId],
  );
  return filed.rows.length > 0;
}
