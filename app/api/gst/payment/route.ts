import { NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { recordGstPayment, type GstTaxHead } from '@/lib/gst/gst-settlement';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/gst/payment
 * Record GST challan payment: Dr output (or RCM) / Cr bank. Voucher type gst_payment.
 */
export const POST = withPremiumSubscriptionApi({ parseJsonBody: true }, async ({ body, businessId, userId }) => {
  try {
    const parsed = (body ?? {}) as {
      amount?: unknown;
      tax_head?: string;
      payment_date?: string;
      branch_id?: string;
      bank_account_id?: string;
      challan_number?: string;
      payment_mode?: string;
      narration_prefix?: string;
    };
    const amount = Number(parsed.amount);
    const taxHead = String(parsed.tax_head || '').toUpperCase() as GstTaxHead;
    const paymentDate = parsed.payment_date;
    const branchIdParam = parsed.branch_id;
    const bankAccountId = parsed.bank_account_id;
    const challanNumber = parsed.challan_number;
    const paymentMode = parsed.payment_mode;
    const narrationPrefix = parsed.narration_prefix;

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
        businessId,
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
        businessId,
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
        businessId,
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
      businessId,
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
});
