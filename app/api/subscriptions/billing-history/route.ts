import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
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
           to_char(orig.created_at, 'DD Mon YYYY') AS refunded_payment_date
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
             to_char(orig.created_at, 'DD Mon YYYY') AS refunded_payment_date
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
      const planName = tx.plan_display_name ?? tx.plan_id ?? 'Plan';
      const isRefund = tx.type === 'refund';
      // A refund is shown as money going back: negative, with a plain label (never the internal row id).
      const amount = (isRefund ? -1 : 1) * Number(tx.total_amount ?? tx.amount ?? 0);
      const description = isRefund
        ? `Refund for ${planName} payment${tx.refunded_payment_date ? ` of ${tx.refunded_payment_date}` : ''}`
        : tx.description || formatModulePlanReceiptLabel(moduleKey, planName, tx.billing_cycle);

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
