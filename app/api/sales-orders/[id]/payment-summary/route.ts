import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
} from '@/lib/auth-helpers';
import {
  getSuccessfulPaymentsSumForOrder,
  PAYMENT_AMOUNT_EPS,
  remainingOrderAmountAfterSuccessSum,
} from '@/lib/services/payment-transactions';

function parseAmount(v: string | number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/**
 * GET /api/sales-orders/[id]/payment-summary
 *
 * Query: business_id (optional if session header), user_id (for authorization)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const orderId = params.id;
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const order = await queryOne<{
      id: string;
      business_id: string;
      grand_total: string;
      branch_id: string | null;
      payment_status: string | null;
      status: string;
      order_number: string;
    }>(
      `SELECT id, business_id, grand_total::text, branch_id, payment_status, status, order_number
       FROM sales_orders
       WHERE id = $1 AND business_id = $2`,
      [orderId, businessId]
    );

    if (!order) {
      return NextResponse.json({ error: 'Sales order not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'sales_orders', 'read', {
        branchId: order.branch_id ?? undefined,
        businessId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const grandTotal = parseAmount(order.grand_total);
    const totalPaid = await getSuccessfulPaymentsSumForOrder(businessId, order.id);
    const remaining = remainingOrderAmountAfterSuccessSum(grandTotal, totalPaid);

    return NextResponse.json({
      grand_total: grandTotal,
      total_paid: totalPaid,
      remaining,
      payment_status: order.payment_status,
      order_status: order.status,
      order_number: order.order_number,
      payment_amount_eps: PAYMENT_AMOUNT_EPS,
    });
  } catch (error: unknown) {
    console.error('[sales-orders/payment-summary]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load payment summary' },
      { status: 500 }
    );
  }
}
