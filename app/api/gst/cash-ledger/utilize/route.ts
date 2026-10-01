import { NextResponse } from 'next/server';
import {
  GST_TAX_HEADS,
  GstCashLedgerError,
  recordGstCashUtilization,
  type GstTaxHead,
} from '@/lib/gst/gst-settlement';
import { isGstJournalContext, openGstJournal } from '@/lib/gst/gst-journal-http';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/gst/cash-ledger/utilize
 * Dr GST liability / Cr electronic cash ledger. Amount cannot exceed that head's cash balance.
 * Pooled RCM (tax_head RCM, liability 2155) uses cash_head; omitted cash_head is IGST 1130.
 */
export const POST = withPremiumSubscriptionApi({ parseJsonBody: true }, async ({ body, businessId, userId }) => {
  try {
    const parsed = (body ?? {}) as {
      amount?: unknown;
      tax_head?: string;
      cash_head?: string;
      payment_date?: string;
      branch_id?: string;
      challan_number?: string;
    };
    const taxHead = String(parsed.tax_head || '').toUpperCase() as GstTaxHead;
    if (!GST_TAX_HEADS.includes(taxHead)) {
      return NextResponse.json({ error: `tax_head must be one of ${GST_TAX_HEADS.join(', ')}` }, { status: 400 });
    }
    if (!parsed.payment_date) {
      return NextResponse.json({ error: 'payment_date is required (YYYY-MM-DD)' }, { status: 400 });
    }

    const ctx = await openGstJournal({
      businessId,
      userId,
      branchIdParam: parsed.branch_id,
      entryDate: parsed.payment_date,
      permission: 'create',
      action: 'utilise GST cash',
    });
    if (!isGstJournalContext(ctx)) return ctx;

    const result = await recordGstCashUtilization({
      businessId,
      branchId: ctx.branchId,
      amount: Number(parsed.amount),
      taxHead,
      cashHead: parsed.cash_head,
      paymentDate: parsed.payment_date,
      challanNumber: parsed.challan_number,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('GST cash utilisation error:', error);
    if (error instanceof GstCashLedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error?.message || 'GST cash utilisation failed' }, { status: 500 });
  }
});
