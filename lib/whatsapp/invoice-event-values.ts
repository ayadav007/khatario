import { format } from 'date-fns';
import { ensureInvoicePublicToken } from '@/lib/customer-surface/public-token';
import { publicInvoiceUrl } from '@/lib/customer-surface/urls';
import type { EventValues } from '@/lib/whatsapp/tenant-send';

function money(v: unknown): string {
  return Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Template values for invoice and reminder messages. */
export async function invoiceEventValues(invoice: {
  id: string;
  invoice_number?: string | null;
  grand_total?: unknown;
  balance_amount?: unknown;
  due_date?: string | Date | null;
  customer_name?: string | null;
  business_name?: string | null;
}): Promise<EventValues> {
  let link = '';
  try {
    link = publicInvoiceUrl(await ensureInvoicePublicToken(invoice.id));
  } catch (err) {
    console.warn('[wa event] invoice link unavailable', err instanceof Error ? err.message : err);
  }
  const balance = invoice.balance_amount ?? invoice.grand_total;
  return {
    customer_name: invoice.customer_name || 'Customer',
    business_name: invoice.business_name || '',
    invoice_number: invoice.invoice_number || '',
    amount: money(invoice.grand_total),
    amount_due: money(balance),
    due_date: invoice.due_date ? format(new Date(invoice.due_date), 'dd MMM yyyy') : '-',
    invoice_link: link || '-',
  };
}

/** Overdue once the due date has passed; otherwise a due reminder. */
export function reminderEventKey(
  source: 'manual' | 'auto_payment_due' | 'auto_overdue',
  dueDate: string | Date | null | undefined,
): 'payment_due_reminder' | 'payment_overdue_reminder' {
  if (source === 'auto_overdue') return 'payment_overdue_reminder';
  if (source === 'auto_payment_due') return 'payment_due_reminder';
  if (!dueDate) return 'payment_due_reminder';
  const due = new Date(dueDate);
  due.setHours(23, 59, 59, 999);
  return due.getTime() < Date.now() ? 'payment_overdue_reminder' : 'payment_due_reminder';
}
