import type { DocumentTable } from '@/lib/pdf-generator';

export type DocumentEmailKind = DocumentTable;

export interface DocumentEmailTemplateInput {
  documentTable: DocumentEmailKind;
  documentNumber: string;
  documentDate?: string | null;
  amount?: number | string | null;
  partyName: string;
  businessName: string;
  currencyLabel?: string;
}

function formatInr(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function docLabel(table: DocumentEmailKind): string {
  const labels: Record<DocumentEmailKind, string> = {
    invoices: 'Invoice',
    sales_orders: 'Sales Order',
    delivery_challans: 'Delivery Challan',
    credit_notes: 'Credit Note',
    debit_notes: 'Debit Note',
    purchase_orders: 'Purchase Order',
    work_orders: 'Work Order',
  };
  return labels[table] || 'Document';
}

function docNumberPrefix(table: DocumentEmailKind): string {
  if (table === 'purchase_orders') return 'Purchase Order #';
  if (table === 'sales_orders') return 'Sales Order #';
  if (table === 'delivery_challans') return 'Delivery Challan #';
  if (table === 'credit_notes') return 'Credit Note #';
  if (table === 'debit_notes') return 'Debit Note #';
  if (table === 'work_orders') return 'Work Order #';
  return 'Invoice #';
}

function closingLine(table: DocumentEmailKind): string {
  if (table === 'purchase_orders') {
    return 'Please go through it and confirm the order. We look forward to working with you again.';
  }
  if (table === 'sales_orders') {
    return 'Please review the order details and let us know if you have any questions.';
  }
  return 'Please find the details above. Let us know if you have any questions.';
}

/** Default subject + HTML body (Zoho-style) for document emails. */
export function buildDocumentEmailTemplate(input: DocumentEmailTemplateInput): {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  attachmentLabel: string;
} {
  const {
    documentTable,
    documentNumber,
    documentDate,
    amount,
    partyName,
    businessName,
    currencyLabel = 'INR',
  } = input;

  const label = docLabel(documentTable);
  const numPrefix = docNumberPrefix(documentTable);
  const dateStr = formatDate(documentDate ?? null);
  const amountStr = formatInr(amount);

  const subject = `${label} from ${businessName} (${numPrefix}: ${documentNumber})`;

  const bodyText = [
    `Dear ${partyName},`,
    '',
    `The ${label.toLowerCase()} (${documentNumber}) is attached with this email. An overview is available below:`,
    '',
    `${numPrefix} : ${documentNumber}`,
    `Date: ${dateStr}`,
    `Amount: ${amountStr} (in ${currencyLabel})`,
    '',
    closingLine(documentTable),
  ].join('\n');

  const bodyHtml = `
<div style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #222;">
  <p>Dear ${escapeHtml(partyName)},</p>
  <p>The ${escapeHtml(label.toLowerCase())} (<strong>${escapeHtml(documentNumber)}</strong>) is attached with this email. An overview of the ${escapeHtml(label.toLowerCase())} is available below:</p>
  <hr style="border: none; border-top: 1px dashed #ccc; margin: 16px 0;" />
  <p style="font-size: 18px; font-weight: bold; margin: 8px 0;">${escapeHtml(numPrefix)} : ${escapeHtml(documentNumber)}</p>
  <table style="font-size: 14px; margin: 8px 0 16px;">
    <tr><td style="padding: 4px 12px 4px 0; color: #555;">Date</td><td>${escapeHtml(dateStr)}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #555;">Amount</td><td><strong>${escapeHtml(amountStr)}</strong> (in ${escapeHtml(currencyLabel)})</td></tr>
  </table>
  <hr style="border: none; border-top: 1px dashed #ccc; margin: 16px 0;" />
  <p>${escapeHtml(closingLine(documentTable))}</p>
</div>`.trim();

  const attachmentLabel = `Attach ${label} PDF`;

  return { subject, bodyHtml, bodyText, attachmentLabel };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function pdfFilenameForDocument(table: DocumentEmailKind, documentNumber: string): string {
  const safe = documentNumber.replace(/[^\w.-]+/g, '_');
  return `${table.replace(/_/g, '-')}-${safe}.pdf`;
}
