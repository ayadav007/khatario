import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
  getUserIdFromRequest,
} from '@/lib/auth-helpers';
import { isPrimaryAdminForBusiness } from '@/lib/enforce-access';
import {
  PAYMENT_AMOUNT_EPS,
  getSuccessfulPaymentsSumForOrder,
  remainingOrderAmountAfterSuccessSum,
  updatePaymentTransactionStatus,
} from '@/lib/services/payment-transactions';
import { logActivity, getClientIP, getUserAgent } from '@/lib/activity-logger';

type ManualAction =
  | 'mark_paid'
  | 'mark_failed'
  | 'retry_verification';

export async function POST(request: NextRequest) {
  const sessionBusinessId = getSessionScopedBusinessId(request);
  const businessId = sessionBusinessId ?? getBusinessIdFromRequest(request);
  const userId = getUserIdFromRequest(request);

  if (!businessId) {
    return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const transactionId = String(body?.transaction_id || body?.transactionId || '').trim();
  const action = String(body?.action || '').trim() as ManualAction;

  if (!transactionId || !action) {
    return NextResponse.json(
      { error: 'transaction_id and action are required' },
      { status: 400 }
    );
  }

  // Auth: admin-only reconciliation actions.
  try {
    await authorize(userId, 'payments', 'read');
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const primaryForBusiness = await isPrimaryAdminForBusiness(userId, businessId).catch(
    () => false
  );
  let settingsAdmin = false;
  try {
    const { checkUserPermission } = await import('@/lib/permissions');
    settingsAdmin = await checkUserPermission(userId, 'settings', 'read');
  } catch {
    settingsAdmin = false;
  }
  if (!primaryForBusiness && !settingsAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const tx = await queryOne<{
    id: string;
    order_id: string;
    business_id: string;
    status: string;
    amount: string;
    provider: string;
    provider_payment_id: string | null;
    utr: string | null;
  }>(
    `SELECT id, order_id, business_id, status, amount::text, provider, provider_payment_id, utr
     FROM payment_transactions
     WHERE id = $1 AND business_id = $2`,
    [transactionId, businessId]
  );

  if (!tx) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const basePatch = {
    manual_reconciliation: {
      action,
      by_user_id: userId,
      at: now,
    },
  } as Record<string, unknown>;

  if (action === 'retry_verification') {
    if (tx.status !== 'pending') {
      return NextResponse.json(
        { error: 'retry_verification is only allowed for pending transactions' },
        { status: 422 }
      );
    }

    await updatePaymentTransactionStatus(businessId, tx.id, {
      status: 'pending',
      rawPayloadPatch: {
        ...basePatch,
        manual_retry_requested: true,
      },
      syncSalesOrder: true,
    });

    await logActivity({
      business_id: businessId,
      user_id: userId,
      action_type: 'update',
      module: 'payments',
      entity_id: tx.id,
      entity_type: 'payment_transaction',
      description: `Requested retry verification for gateway transaction`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: { transaction_id: tx.id, order_id: tx.order_id, provider: tx.provider },
    });

    return NextResponse.json({ ok: true });
  }

  if (action === 'mark_failed') {
    if (tx.status !== 'requires_review') {
      return NextResponse.json(
        { error: 'mark_failed is only allowed for requires_review transactions' },
        { status: 422 }
      );
    }

    await updatePaymentTransactionStatus(businessId, tx.id, {
      status: 'failed',
      rawPayloadPatch: basePatch,
      syncSalesOrder: true,
    });

    await logActivity({
      business_id: businessId,
      user_id: userId,
      action_type: 'update',
      module: 'payments',
      entity_id: tx.id,
      entity_type: 'payment_transaction',
      description: `Marked gateway transaction as failed (manual reconciliation)`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: { transaction_id: tx.id, order_id: tx.order_id, provider: tx.provider },
    });

    return NextResponse.json({ ok: true });
  }

  if (action === 'mark_paid') {
    if (tx.status !== 'requires_review') {
      return NextResponse.json(
        { error: 'mark_paid is only allowed for requires_review transactions' },
        { status: 422 }
      );
    }

    const order = await queryOne<{ grand_total: string }>(
      `SELECT grand_total::text AS grand_total
       FROM sales_orders
       WHERE id = $1 AND business_id = $2`,
      [tx.order_id, businessId]
    );
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const expectedGrandTotal = parseFloat(order.grand_total || '0') || 0;
    const paidSumSuccess = await getSuccessfulPaymentsSumForOrder(businessId, tx.order_id);
    const remaining = remainingOrderAmountAfterSuccessSum(expectedGrandTotal, paidSumSuccess);
    const txAmount = parseFloat(tx.amount || '0') || 0;

    if (Math.abs(txAmount - remaining) > PAYMENT_AMOUNT_EPS) {
      await updatePaymentTransactionStatus(businessId, tx.id, {
        status: 'requires_review',
        rawPayloadPatch: {
          ...basePatch,
          manual_validation: {
            ok: false,
            reason: 'amount_remaining_mismatch',
            tx_amount: txAmount,
            order_remaining: remaining,
            eps: PAYMENT_AMOUNT_EPS,
          },
        },
        syncSalesOrder: true,
      });

      return NextResponse.json(
        {
          error: 'Amount does not match remaining balance (within EPS). Kept as requires_review.',
          remaining,
          txAmount,
          eps: PAYMENT_AMOUNT_EPS,
        },
        { status: 422 }
      );
    }

    await updatePaymentTransactionStatus(businessId, tx.id, {
      status: 'success',
      rawPayloadPatch: {
        ...basePatch,
        manual_validation: {
          ok: true,
          tx_amount: txAmount,
          order_remaining: remaining,
          eps: PAYMENT_AMOUNT_EPS,
        },
      },
      syncSalesOrder: true,
    });

    await logActivity({
      business_id: businessId,
      user_id: userId,
      action_type: 'update',
      module: 'payments',
      entity_id: tx.id,
      entity_type: 'payment_transaction',
      description: `Marked gateway transaction as paid (manual reconciliation)`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: {
        transaction_id: tx.id,
        order_id: tx.order_id,
        provider: tx.provider,
        provider_payment_id: tx.provider_payment_id,
        utr: tx.utr,
        amount: txAmount,
      },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
}

