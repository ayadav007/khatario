import { NextResponse } from 'next/server';
import { GstCashLedgerError, recordGstCashDeposit, type GstCashHead } from '@/lib/gst/gst-settlement';
import { isGstJournalContext, openGstJournal } from '@/lib/gst/gst-journal-http';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

const CASH_HEADS: GstCashHead[] = ['IGST', 'CGST', 'SGST', 'CESS'];

/**
 * POST /api/gst/cash-ledger/deposit
 * Dr electronic cash ledger / Cr bank. Does not reduce GST liability.
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
    };
    const taxHead = String(parsed.tax_head || '').toUpperCase() as GstCashHead;
    if (!CASH_HEADS.includes(taxHead)) {
      return NextResponse.json({ error: 'tax_head must be IGST, CGST, SGST, or CESS' }, { status: 400 });
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
      action: 'deposit GST cash',
    });
    if (!isGstJournalContext(ctx)) return ctx;

    const result = await recordGstCashDeposit({
      businessId,
      branchId: ctx.branchId,
      amount: Number(parsed.amount),
      taxHead,
      paymentDate: parsed.payment_date,
      bankAccountId: parsed.bank_account_id,
      challanNumber: parsed.challan_number,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('GST cash deposit error:', error);
    if (error instanceof GstCashLedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error?.message || 'GST cash deposit failed' }, { status: 500 });
  }
});
