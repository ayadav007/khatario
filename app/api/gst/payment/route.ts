import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { recordGstPayment, type GstTaxHead } from '@/lib/gst/gst-settlement';

/**
 * POST /api/gst/payment
 * Record GST challan payment: Dr output (or RCM) / Cr bank. Voucher type gst_payment.
 */
export async function POST(request: NextRequest) {
  try {
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 401 });
    }

    const body = await request.json();
    const amount = Number(body.amount);
    const taxHead = String(body.tax_head || '').toUpperCase() as GstTaxHead;
    const paymentDate = body.payment_date as string | undefined;
    const branchIdParam = body.branch_id as string | undefined;
    const bankAccountId = body.bank_account_id as string | undefined;
    const challanNumber = body.challan_number as string | undefined;
    const paymentMode = body.payment_mode as string | undefined;
    const narrationPrefix = body.narration_prefix as string | undefined;

    if (!['IGST', 'CGST', 'SGST', 'RCM'].includes(taxHead)) {
      return NextResponse.json({ error: 'tax_head must be IGST, CGST, SGST, or RCM' }, { status: 400 });
    }
    if (!paymentDate) {
      return NextResponse.json({ error: 'payment_date is required (YYYY-MM-DD)' }, { status: 400 });
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam,
        businessId: business_id,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      throw error;
    }

    try {
      await authorize(userId, 'journal', 'create', {
        businessId: business_id,
        branchId: finalBranchId,
        entry_date: paymentDate,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await enforceAccess({
        businessId: business_id,
        userId,
        branchId: finalBranchId,
        feature: FeatureKeys.LEDGER_ACCOUNTING,
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    const result = await recordGstPayment({
      businessId: business_id,
      branchId: finalBranchId,
      amount,
      taxHead,
      paymentDate,
      bankAccountId,
      challanNumber,
      paymentMode,
      narrationPrefix,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('GST payment error:', error);
    return NextResponse.json({ error: error?.message || 'GST payment failed' }, { status: 500 });
  }
}
