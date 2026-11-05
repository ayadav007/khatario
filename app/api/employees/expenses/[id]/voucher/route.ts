import { NextRequest, NextResponse } from 'next/server';
import { loadAccessibleExpense } from '@/lib/hr/expense-access';
import { renderExpenseVoucherHtml } from '@/lib/hr/expense-voucher';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employees/expenses/[id]/voucher
 * Voucher HTML for one expense. Business users need `expenses` read; a portal employee may
 * only open their own expense. The expense is loaded inside the caller's business only.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const access = await loadAccessibleExpense(req, params.id, 'read');
    if (!access.ok) return access.response;

    const html = await renderExpenseVoucherHtml(access.expense);
    return NextResponse.json({ html });
  } catch (error: any) {
    console.error('Error generating expense voucher:', error);
    return NextResponse.json({ error: 'Failed to generate voucher' }, { status: 500 });
  }
}
