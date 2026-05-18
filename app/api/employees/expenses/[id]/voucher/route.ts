import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { InvoiceRenderer } from '@/lib/invoice-renderer';
import { prepareInvoiceForRendering } from '@/lib/invoice-presenter';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // 1. Fetch Expense Data
    const expense = await db.queryOne(
      `SELECT ee.*, 
        u.name as employee_name,
        b.name as business_name, b.address_line1 as business_address, b.city as business_city
       FROM employee_expenses ee
       LEFT JOIN users u ON ee.employee_id = u.id
       JOIN businesses b ON ee.business_id = b.id
       WHERE ee.id = $1`,
      [id]
    );

    if (!expense) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
    }

    // 2. Transform for template
    const renderData = await prepareInvoiceForRendering({
      invoice: {
        invoice_number: expense.id.substring(0, 8),
        invoice_date: expense.expense_date,
        grand_total: expense.amount,
        subtotal: expense.amount,
        document_type: 'tax_invoice' // dummy
      },
      business: expense,
      customer: { name: expense.employee_name },
      items: []
    }, { primary_color: '#000000' });

    const templateData = {
      expense: {
        ...expense,
        id_short: expense.id.substring(0, 8).toUpperCase(),
        date: new Date(expense.expense_date).toLocaleDateString('en-IN'),
        amount: Number(expense.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        amount_in_words: renderData.invoice.amount_in_words,
        employee_name: expense.employee_name,
        category: expense.category,
        description: expense.description
      },
      business: {
        name: expense.business_name
      },
      settings: { primary_color: '#000000' }
    };

    const renderer = new InvoiceRenderer();
    let html = await renderer.renderHtml('expense_voucher', templateData as any);
    const { maybeAppendKhatarioPrintFooter } = await import('@/lib/print-branding');
    html = await maybeAppendKhatarioPrintFooter(html, expense.business_id);

    return NextResponse.json({ html });

  } catch (error: any) {
    console.error('Error generating expense voucher:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

