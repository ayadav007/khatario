import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { refundableAmountPaise } from '@/lib/subscription/upgrade-credit';
import { previewFullRefundPlanEffects } from '@/lib/platform-refunds';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'support', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;

  try {
    const rows = await db.queryRows<Record<string, unknown> & {
      id: string;
      type: string;
      status: string;
      total_amount: string | number | null;
      taxable_amount: string | number | null;
      metadata: Record<string, unknown> | null;
      payment_method: string | null;
      payment_reference: string | null;
      plan_id: string | null;
      module_key: string | null;
    }>(
      `SELECT
         id,
         type,
         status,
         amount,
         total_amount,
         taxable_amount,
         currency,
         plan_id,
         module_key,
         billing_cycle,
         payment_method,
         payment_reference,
         description,
         invoice_number,
         metadata,
         created_at
       FROM billing_transactions
       WHERE business_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [params.id],
    );

    // What an admin may do with each row, worked out here so the screen only displays it: the most that can
    // still be refunded in cash (paid minus upgrade credit used, minus refunds done or waiting), the refunds
    // still waiting and whether each may be cancelled, and the date the plan runs to if it is left to end.
    const refundRows = rows.filter((r) => r.type === 'refund');
    const planEnds = new Map<string, string | null>();
    for (const r of rows) {
      if (r.type !== 'payment' || !r.plan_id) continue;
      const key = `${r.module_key ?? ''}|${r.plan_id}`;
      if (planEnds.has(key)) continue;
      const cur = await db.queryOne<{ end_date: string | null }>(
        `SELECT end_date::text AS end_date FROM business_module_subscriptions
         WHERE business_id = $1 AND module_key = COALESCE($2, module_key) AND plan_id = $3 AND status = 'active'
         LIMIT 1`,
        [params.id, r.module_key, r.plan_id],
      );
      planEnds.set(key, cur?.end_date ?? null);
    }
    // What refunding each refundable payment IN FULL would do to the plan, for each choice (same rule as the refund itself).
    const effects = new Map<string, { now: string; period_end: string } | null>();
    for (const r of rows) {
      if (r.type === 'payment' && r.status === 'completed') effects.set(r.id, await previewFullRefundPlanEffects(r.id).catch(() => null));
    }
    const transactions = rows.map((r) => {
      const { metadata, ...rest } = r;
      if (r.type === 'refund') {
        const gatewayAsked = Boolean(metadata?.gateway_requested) || Boolean(r.payment_reference);
        return {
          ...rest,
          refund_of: (metadata?.refund_of as string | undefined) ?? null,
          can_cancel_refund: r.status === 'pending' && !gatewayAsked,
        };
      }
      if (r.type !== 'payment') return rest;
      const mine = refundRows.filter((x) => x.metadata?.refund_of === r.id);
      const sum = (status: string) =>
        mine.filter((x) => x.status === status).reduce((a, x) => a + Math.round(Number(x.total_amount ?? 0) * 100), 0);
      const refundable = refundableAmountPaise({ total_amount: r.total_amount, metadata: metadata as { credit_used_paise?: number; credit_gross_saving_paise?: number } | null });
      const remaining = Math.max(0, refundable - sum('completed') - sum('pending'));
      const method = r.payment_method ?? '';
      return {
        ...rest,
        can_refund: r.status === 'completed' && (method === 'razorpay' || method === 'easebuzz' || method === 'manual') && remaining > 0,
        refundable_amount: remaining / 100,
        refunded_amount: sum('completed') / 100,
        pending_refund_amount: sum('pending') / 100,
        sent_through_gateway: method === 'razorpay' || method === 'easebuzz',
        plan_effects: effects.get(r.id) ?? null,
        plan_end_date: r.plan_id ? planEnds.get(`${r.module_key ?? ''}|${r.plan_id}`) ?? null : null,
      };
    });

    return NextResponse.json({ transactions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('billing_transactions')) {
      return NextResponse.json({ transactions: [], warning: 'Billing table not migrated' });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
