import * as db from '@/lib/db';
import ExcelJS from 'exceljs';

export interface ReconciliationExportOptions {
  business_id: string;
  from_date?: string;
  to_date?: string;
  status?: string;
}

export async function generateReconciliationExcel(options: ReconciliationExportOptions): Promise<Buffer> {
  const { business_id, from_date, to_date, status } = options;

  let query = `
    SELECT 
      p.bill_number as book_invoice_no,
      p.bill_date as book_invoice_date,
      p.supplier_gstin as book_gstin,
      s.name as supplier_name,
      p.taxable_value as book_taxable,
      p.cgst_amount as book_cgst,
      p.sgst_amount as book_sgst,
      p.igst_amount as book_igst,
      gr.match_status,
      gr.gstr2b_invoice_no,
      gr.gstr2b_invoice_date,
      gr.gstr2b_taxable,
      gr.gstr2b_cgst,
      gr.gstr2b_sgst,
      gr.gstr2b_igst,
      rd.decision,
      rd.remarks,
      rd.decision_date
    FROM purchases p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN gstr2b_reconciliation gr ON p.id = gr.purchase_id
    LEFT JOIN reconciliation_decisions rd ON gr.id = rd.reconciliation_id
    WHERE p.business_id = $1
  `;
  const params: any[] = [business_id];

  if (from_date && to_date) {
    query += ` AND p.bill_date BETWEEN $2 AND $3`;
    params.push(from_date, to_date);
  }

  if (status && status !== 'all') {
    query += ` AND gr.match_status = $${params.length + 1}`;
    params.push(status);
  }

  query += ` ORDER BY p.bill_date DESC`;

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

