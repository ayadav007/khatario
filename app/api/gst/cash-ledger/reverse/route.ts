import { NextResponse } from 'next/server';
import {
  GST_CASH_DEPOSIT_VOUCHER,
  GST_CASH_UTILIZATION_VOUCHER,
  GstCashLedgerError,
  reverseGstCashLedgerVoucher,
} from '@/lib/gst/gst-settlement';
import { isGstJournalContext, openGstJournal } from '@/lib/gst/gst-journal-http';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/gst/cash-ledger/reverse
 * Reverses a deposit or utilisation with reverseVoucherLedgerEntries.
 * A deposit is rejected when reversing it would make the cash ledger negative.
 */
export const POST = withPremiumSubscriptionApi({ parseJsonBody: true }, async ({ body, businessId, userId }) => {
  try {
    const parsed = (body ?? {}) as {
      voucher_id?: string;
      voucher_type?: string;
      reason?: string;
      entry_date?: string;
      branch_id?: string;
    };
    const voucherType = parsed.voucher_type;
    if (voucherType !== GST_CASH_DEPOSIT_VOUCHER && voucherType !== GST_CASH_UTILIZATION_VOUCHER) {
      return NextResponse.json(
        { error: 'voucher_type must be gst_cash_deposit or gst_cash_utilization' },
        { status: 400 }
      );
    }
    if (!parsed.voucher_id) {
      return NextResponse.json({ error: 'voucher_id is required' }, { status: 400 });
    }
    const reason = (parsed.reason || '').trim();
    if (!reason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 });
    }
    const entryDate = parsed.entry_date || new Date().toISOString().slice(0, 10);

    const ctx = await openGstJournal({
      businessId,
      userId,
      branchIdParam: parsed.branch_id,
      entryDate,
      permission: 'create',
      action: 'reverse this GST cash ledger entry',
    });
    if (!isGstJournalContext(ctx)) return ctx;

    const result = await reverseGstCashLedgerVoucher({
      businessId,
      branchId: ctx.branchId,
      voucherId: parsed.voucher_id,
      voucherType,
      reason,
      entryDate,
      actorId: userId,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('GST cash ledger reversal error:', error);
    if (error instanceof GstCashLedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error?.message || 'GST cash ledger reversal failed' }, { status: 500 });
  }
});
