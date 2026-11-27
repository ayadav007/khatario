import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { applySubscriptionMutationGuard } from '@/lib/security/apply-subscription-mutation-guard';
import { queryRows } from '@/lib/db';
import { documentKind, type GstMode } from '@/lib/platform-tax';
import {
  formatModulePlanReceiptLabel,
  moduleLabelForKey,
  productLineToModuleKey,
} from '@/lib/subscription/billing-labels';

export const dynamic = 'force-dynamic';

type BillingTxRow = {
  id: string;
  created_at: string;
  description: string | null;
  amount: string | number;
  total_amount: string | number;
  status: string;
  plan_id: string | null;
  module_key: string | null;
  billing_cycle: string | null;
  plan_display_name: string | null;
  product_line: string | null;
  type: string;
  refunded_payment_date: string | null;
  invoice_number: string | null;
  tax_amount: string | number | null;
  taxable_amount: string | number | null;
  cgst_amount: string | number | null;
  sgst_amount: string | number | null;
  igst_amount: string | number | null;
  gst_rate: string | number | null;
  gst_mode: string | null;
};

function mapStatusForUi(status: string): string {
  if (status === 'completed') return 'paid';
  return status;
}

export async function GET(request: NextRequest) {
  try {
    const tenant = requireTenantBusinessId(request);
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;

    // Billing history is for the people who may change the plan (owner or primary admin), not every staff user.
    const guard = await applySubscriptionMutationGuard(request, businessId);
    if (guard) return guard;

    let transactions: BillingTxRow[] = [];
    try {
      transactions = await queryRows<BillingTxRow>(
        `SELECT
           bt.id,
           bt.created_at,
           bt.description,
           bt.amount,
           bt.total_amount,
           bt.status,
           bt.plan_id,
           bt.module_key,
           bt.billing_cycle,
           sp.display_name AS plan_display_name,
           sp.product_line,
           bt.type,
           to_char(orig.created_at, 'DD Mon YYYY') AS refunded_payment_date,
           bt.invoice_number, bt.tax_amount, bt.taxable_amount, bt.cgst_amount, bt.sgst_amount, bt.igst_amount,
           bt.gst_rate, bt.gst_mode
         FROM billing_transactions bt
         LEFT JOIN subscription_plans sp ON sp.id = bt.plan_id
         LEFT JOIN billing_transactions orig
           ON bt.type = 'refund' AND orig.id::text = bt.metadata->>'refund_of' AND orig.business_id = bt.business_id
         WHERE bt.business_id = $1
           AND (bt.type <> 'refund' OR bt.status = 'completed')
         ORDER BY bt.created_at DESC
         LIMIT 50`,
        [businessId],
      );
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === '42703') {
        transactions = await queryRows<BillingTxRow>(
          `SELECT
             bt.id,
             bt.created_at,
             bt.description,
             bt.amount,
             bt.total_amount,
             bt.status,
             bt.plan_id,
             NULL::varchar AS module_key,
             bt.billing_cycle,
             sp.display_name AS plan_display_name,
             sp.product_line,
             bt.type,
             to_char(orig.created_at, 'DD Mon YYYY') AS refunded_payment_date,
             NULL::varchar AS invoice_number, NULL::numeric AS tax_amount, NULL::numeric AS taxable_amount,
             NULL::numeric AS cgst_amount, NULL::numeric AS sgst_amount, NULL::numeric AS igst_amount,
             NULL::numeric AS gst_rate, NULL::varchar AS gst_mode
           FROM billing_transactions bt
           LEFT JOIN subscription_plans sp ON sp.id = bt.plan_id
           LEFT JOIN billing_transactions orig
             ON bt.type = 'refund' AND orig.id::text = bt.metadata->>'refund_of' AND orig.business_id = bt.business_id
           WHERE bt.business_id = $1
             AND (bt.type <> 'refund' OR bt.status = 'completed')
           ORDER BY bt.created_at DESC
           LIMIT 50`,
          [businessId],
        );
      } else {
        throw err;
      }
    }

    const history = transactions.map((tx) => {
      const moduleKey =
        tx.module_key ?? productLineToModuleKey(tx.product_line ?? 'billing');
      const planName = tx.plan_display_name ?? 'Plan';
      const isRefund = tx.type === 'refund';
      // A refund is shown as money going back: negative, with a plain label (never the internal row id).
      const amount = (isRefund ? -1 : 1) * Number(tx.total_amount ?? tx.amount ?? 0);
      const description = isRefund
        ? `Refund for ${planName} payment${tx.refunded_payment_date ? ` of ${tx.refunded_payment_date}` : ''}`
        : tx.description || formatModulePlanReceiptLabel(moduleKey, planName, tx.billing_cycle);

      const sign = isRefund ? -1 : 1;
      const taxed = tx.gst_mode === 'inclusive' || tx.gst_mode === 'exclusive';
      const money = (v: string | number | null) => (v === null || v === undefined ? 0 : sign * Number(v));
      const completed = tx.status === 'completed' || tx.status === 'refunded';

      return {
        id: tx.id,
        date: tx.created_at,
        created_at: tx.created_at,
        description,
        amount,
        total_amount: amount,
        type: isRefund ? 'refund' : 'payment',
        status: isRefund ? 'refunded' : mapStatusForUi(tx.status),
        raw_status: tx.status,
        plan_id: tx.plan_id,
        plan_display_name: planName,
        module_key: moduleKey,
        module_label: moduleLabelForKey(moduleKey),
        billing_cycle: tx.billing_cycle,
        // Receipt and tax breakdown (a refund's figures are negative, like its amount). Rows from before GST
        // was recorded have gst_mode 'none' and no tax.
        invoice_number: tx.invoice_number,
        receipt_url: completed ? `/api/subscriptions/receipts/${tx.id}` : null,
        document_kind: documentKind(tx.type, taxed ? (tx.gst_mode as GstMode) : 'none'),
        gst_mode: taxed ? tx.gst_mode : 'none',
        gst_rate: taxed ? Number(tx.gst_rate ?? 0) : 0,
        taxable_amount: taxed ? money(tx.taxable_amount) : amount,
        tax_amount: taxed ? money(tx.tax_amount) : 0,
        cgst_amount: taxed ? money(tx.cgst_amount) : 0,
        sgst_amount: taxed ? money(tx.sgst_amount) : 0,
        igst_amount: taxed ? money(tx.igst_amount) : 0,
      };
    });

    const events = await queryRows(
      `SELECT * FROM subscription_events
       WHERE business_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [businessId],
    );

    return NextResponse.json({ transactions: history, history, events });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error fetching billing history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch billing history', details: message },
      { status: 500 },
    );
  }
}
