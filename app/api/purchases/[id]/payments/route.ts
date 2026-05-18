import { NextRequest, NextResponse } from 'next/server';
import { queryOne, getPool } from '@/lib/db';
import { createPaymentLedgerEntries } from '@/lib/ledger-utils';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
  getUserIdFromRequest,
} from '@/lib/auth-helpers';

/**
 * PATCH /api/purchases/[id]/payments
 * Record a payment against a purchase
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const purchaseId = params.id;
  try {
    const body = await request.json();
    const { amount, payment_mode = 'cash', reference, payment_date } = body;
    const userId = getUserIdFromRequest(request, body) || body.user_id;

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const businessScope =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request, body);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const purchase = await queryOne(
      `SELECT * FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [purchaseId, businessScope]
    );
    
    if (!purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }
    
    if (purchase.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot pay a cancelled purchase' }, { status: 400 });
    }

    // AUTHORIZATION: Check update permission (recording payment is an update operation)
    try {
      await authorize(userId, 'purchases', 'update', { 
        branchId: purchase.branch_id,
        businessId: purchase.business_id,
        resourceId: purchaseId
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(purchase.business_id, 'purchase_management');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const paidAmount = Number(purchase.paid_amount || 0) + Number(amount);
    const balance = Math.max(0, Number(purchase.grand_total || 0) - paidAmount);
    
    // Calculate payment_status
    let paymentStatus: 'unpaid' | 'partially_paid' | 'paid' = 'unpaid';
    if (paidAmount <= 0) {
      paymentStatus = 'unpaid';
    } else if (balance <= 0) {
      paymentStatus = 'paid';
    } else {
      paymentStatus = 'partially_paid';
    }

    // PHASE-5: wrap payment INSERT, balance updates, and ledger posting in one
    // transaction so the deferred validate_voucher_balance trigger sees both
    // ledger lines at COMMIT. If any step throws, we ROLLBACK everything.
    const client = await getPool().connect();
    let updated: any = null;
    try {
      await client.query('BEGIN');

      const paymentRes = await client.query<{ id: string }>(
        `INSERT INTO payments (
          business_id, branch_id, type, supplier_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
        [
          purchase.business_id,
          purchase.branch_id,
          'payable',
          purchase.supplier_id,
          'purchase',
          purchase.id,
          amount,
          payment_mode,
          payment_date || new Date(),
          reference ? String(reference) : null,
        ],
      );
      const paymentId = paymentRes.rows[0]?.id;

      if (paymentId && purchase.supplier_id) {
        await createPaymentLedgerEntries({
          businessId: purchase.business_id,
          paymentId: paymentId,
          paymentDate: payment_date || new Date(),
          amount: amount,
          type: 'payable',
          supplierId: purchase.supplier_id,
          paymentMode: payment_mode || 'cash',
          referenceNumber: purchase.bill_number || purchaseId.substring(0, 8),
          description: `Payment for purchase ${purchase.bill_number || purchaseId}${reference ? ` - Ref: ${reference}` : ''}`,
          branchId: purchase.branch_id,
          poolClient: client,
        });
      }

      const updatedRes = await client.query(
        `UPDATE purchases
         SET paid_amount = $1,
             balance_amount = $2,
             payment_status = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING *`,
        [paidAmount, balance, paymentStatus, purchase.id],
      );
      updated = updatedRes.rows[0];

      if (purchase.supplier_id) {
        await client.query(
          `UPDATE suppliers
           SET current_balance = current_balance - $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [amount, purchase.supplier_id],
        );
      }

      await client.query('COMMIT');
    } catch (txError: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Purchase payment error (transaction rolled back):', txError);
      return NextResponse.json(
        {
          error: txError.message || 'Failed to record payment',
          details: txError.detail || undefined,
        },
        { status: 500 },
      );
    } finally {
      client.release();
    }

    return NextResponse.json({ purchase: updated });
  } catch (error: any) {
    console.error('Payment error', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

