import { InvoiceRenderer } from '@/lib/invoice-renderer';
import { prepareInvoiceForRendering } from '@/lib/invoice-presenter';
import type { AccessibleExpense } from '@/lib/hr/expense-access';

/** Renders the expense voucher HTML for an expense already loaded and authorised for the caller. */
export async function renderExpenseVoucherHtml(expense: AccessibleExpense): Promise<string> {
  const renderData = await prepareInvoiceForRendering(
    {
      invoice: {
        invoice_number: expense.id.substring(0, 8),
        invoice_date: expense.expense_date,
        grand_total: expense.amount,
        subtotal: expense.amount,
        document_type: 'tax_invoice', // dummy
      },
      business: expense,
      customer: { name: expense.employee_name },
      items: [],
    } as never,
    { primary_color: '#000000' } as never,
  );

  const templateData = {
    business_id: expense.business_id,
    expense: {
      ...expense,
      id_short: expense.id.substring(0, 8).toUpperCase(),
      date: new Date(expense.expense_date as string).toLocaleDateString('en-IN'),
      amount: Number(expense.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      amount_in_words: renderData.invoice.amount_in_words,
      employee_name: expense.employee_name,
      category: expense.category,
      description: expense.description,
    },
    business: { name: expense.business_name },
    settings: { primary_color: '#000000' },
  };

  const renderer = new InvoiceRenderer();
  const html = await renderer.renderHtml('expense_voucher', templateData as never);
  const { maybeAppendKhatarioPrintFooter } = await import('@/lib/print-branding');
  return maybeAppendKhatarioPrintFooter(html, expense.business_id);
}
