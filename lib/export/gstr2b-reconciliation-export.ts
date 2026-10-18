import * as db from '@/lib/db';
import ExcelJS from 'exceljs';

export interface ReconciliationExportOptions {
  business_id: string;
  filing_period?: string;
  from_date?: string;
  to_date?: string;
  status?: string;
}

export function filingPeriodFromRange(fromDate?: string, toDate?: string): string | null {
  const source = fromDate || toDate;
  const match = source?.match(/^(\d{4}-\d{2})/);
  return match ? match[1] : null;
}

export async function generateReconciliationExcel(options: ReconciliationExportOptions): Promise<Buffer> {
  const { business_id, status } = options;
  const filingPeriod = options.filing_period || filingPeriodFromRange(options.from_date, options.to_date);
  if (!filingPeriod || !/^\d{4}-\d{2}$/.test(filingPeriod)) {
    throw new Error('filing_period must be in YYYY-MM format');
  }

  let query = `
    SELECT
      r.invoice_number as book_invoice_no,
      r.invoice_date as book_invoice_date,
      r.supplier_gstin as book_gstin,
      COALESCE(s.name, gi.supplier_name) as supplier_name,
      r.books_taxable_value as book_taxable,
      r.books_cgst as book_cgst,
      r.books_sgst as book_sgst,
      r.books_igst as book_igst,
      r.match_status,
      CASE WHEN r.gstr2b_invoice_id IS NULL THEN NULL ELSE r.invoice_number END as gstr2b_invoice_no,
      CASE WHEN r.gstr2b_invoice_id IS NULL THEN NULL ELSE r.invoice_date END as gstr2b_invoice_date,
      r.gstr2b_taxable_value as gstr2b_taxable,
      r.gstr2b_cgst,
      r.gstr2b_sgst,
      r.gstr2b_igst,
      rd.decision,
      rd.remarks,
      rd.decision_date
    FROM gstr2b_reconciliation r
    LEFT JOIN purchases p ON p.id = r.purchase_id AND p.business_id = r.business_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN gstr2b_invoices gi ON gi.id = r.gstr2b_invoice_id AND gi.business_id = r.business_id
    LEFT JOIN reconciliation_decisions rd ON rd.reconciliation_id = r.id
    WHERE r.business_id = $1
      AND r.filing_period = $2
  `;
  const params: any[] = [business_id, filingPeriod];

  if (status && status.toLowerCase() !== 'all') {
    query += ` AND r.match_status = $${params.length + 1}`;
    params.push(status);
  }

  query += ` ORDER BY r.invoice_date DESC, r.invoice_number`;

  const rows = await db.queryRows(query, params);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('GSTR-2B Reconciliation');

  // Define columns
  sheet.columns = [
    { header: 'Book Invoice No', key: 'book_invoice_no', width: 15 },
    { header: 'Book Date', key: 'book_invoice_date', width: 12 },
    { header: 'Supplier GSTIN', key: 'book_gstin', width: 18 },
    { header: 'Supplier Name', key: 'supplier_name', width: 25 },
    { header: 'Book Taxable', key: 'book_taxable', width: 12 },
    { header: 'Book CGST', key: 'book_cgst', width: 10 },
    { header: 'Book SGST', key: 'book_sgst', width: 10 },
    { header: 'Book IGST', key: 'book_igst', width: 10 },
    { header: 'Match Status', key: 'match_status', width: 15 },
    { header: '2B Invoice No', key: 'gstr2b_invoice_no', width: 15 },
    { header: '2B Date', key: 'gstr2b_invoice_date', width: 12 },
    { header: '2B Taxable', key: 'gstr2b_taxable', width: 12 },
    { header: '2B CGST', key: 'gstr2b_cgst', width: 10 },
    { header: '2B SGST', key: 'gstr2b_sgst', width: 10 },
    { header: '2B IGST', key: 'gstr2b_igst', width: 10 },
    { header: 'Decision', key: 'decision', width: 20 },
    { header: 'Decision Date', key: 'decision_date', width: 12 },
    { header: 'Remarks', key: 'remarks', width: 30 },
  ];

  // Add data
  rows.forEach(row => {
    sheet.addRow({
      ...row,
      book_invoice_date: row.book_invoice_date ? new Date(row.book_invoice_date).toLocaleDateString() : '',
      gstr2b_invoice_date: row.gstr2b_invoice_date ? new Date(row.gstr2b_invoice_date).toLocaleDateString() : '',
      decision_date: row.decision_date ? new Date(row.decision_date).toLocaleDateString() : '',
      decision: row.decision ? row.decision.replace(/_/g, ' ') : 'PENDING'
    });
  });

  // Style header
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };

  // Summary sheet
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Status / Decision', key: 'label', width: 30 },
    { header: 'Count', key: 'count', width: 15 },
    { header: 'ITC Amount (Total)', key: 'amount', width: 20 },
  ];

  // Calculate summaries
  const statusCounts: Record<string, { count: number, amount: number }> = {};
  const decisionCounts: Record<string, { count: number, amount: number }> = {};

  rows.forEach(row => {
    const status = row.match_status || 'UNRECONCILED';
    if (!statusCounts[status]) statusCounts[status] = { count: 0, amount: 0 };
    statusCounts[status].count++;
    statusCounts[status].amount += (parseFloat(row.book_cgst) || 0) + (parseFloat(row.book_sgst) || 0) + (parseFloat(row.book_igst) || 0);

    const decision = row.decision || 'PENDING';
    if (!decisionCounts[decision]) decisionCounts[decision] = { count: 0, amount: 0 };
    decisionCounts[decision].count++;
    decisionCounts[decision].amount += (parseFloat(row.book_cgst) || 0) + (parseFloat(row.book_sgst) || 0) + (parseFloat(row.book_igst) || 0);
  });

  summarySheet.addRow({ label: 'MATCH STATUS SUMMARY', count: '', amount: '' }).font = { bold: true };
  Object.entries(statusCounts).forEach(([label, data]) => {
    summarySheet.addRow({ label, count: data.count, amount: data.amount.toFixed(2) });
  });

  summarySheet.addRow({});
  summarySheet.addRow({ label: 'DECISION SUMMARY', count: '', amount: '' }).font = { bold: true };
  Object.entries(decisionCounts).forEach(([label, data]) => {
    summarySheet.addRow({ label: label.replace(/_/g, ' '), count: data.count, amount: data.amount.toFixed(2) });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

