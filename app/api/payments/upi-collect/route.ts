import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
} from '@/lib/auth-helpers';
import { createPaymentProviderForBusiness } from '@/lib/payments';
import type { CreateUpiCollectResult } from '@/lib/payments/types';
import {
  createPaymentTransaction,
  failStaleUpiCollectIfAmountMismatch,
  getPendingUpiCollectTransactionForOrder,
  getSuccessfulPaymentsSumForOrder,
  PAYMENT_AMOUNT_EPS,
  remainingOrderAmountAfterSuccessSum,
  type PaymentTransactionRow
} from '@/lib/services/payment-transactions';

type SalesOrderRow = {
  id: string;
  business_id: string;
  status: string;
  grand_total: string;
  branch_id: string | null;
  payment_status: string | null;
};

function parseAmount(v: string | number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Normalize PSP response into persisted + API-friendly payload */
function buildUpiCollectRawPayload(
  collect: CreateUpiCollectResult,
  orderId: string
): Record<string, unknown> {
  const raw = collect.raw ?? {};
  const ro = raw as Record<string, unknown>;
  const prNested = ro.payment_request as Record<string, unknown> | undefined;
  const providerOrderId =
    (typeof ro.order_id === 'string' && ro.order_id) ||
    (typeof ro.cf_order_id === 'string' && ro.cf_order_id) ||
    (typeof ro.id === 'string' && ro.id.startsWith('plink_') ? ro.id : null) ||
    (typeof ro.merchantTransactionId === 'string' && ro.merchantTransactionId) ||
    (typeof prNested?.id === 'string' && prNested.id) ||
    collect.providerPaymentId ||
    null;

  return {
    khatario_order_id: orderId,
    provider_order_id: providerOrderId,
    provider_payment_id: collect.providerPaymentId ?? null,
    payment_session_id: collect.paymentSessionId ?? null,
    session_reference:
      collect.paymentSessionId ?? collect.providerPaymentId ?? null,
    payment_url: collect.paymentUrl ?? null,
    upi_intent: collect.upiIntent ?? null,
    qr_data: collect.qrData ?? null,
    expires_at:
      collect.expiresAt instanceof Date
        ? collect.expiresAt.toISOString()
        : collect.expiresAt ?? null,
    collect_raw: raw
  };
}

/** PayU hosted checkout: HTML POST fields from `collect_raw` (see PayuPaymentProvider). */
function payuHostedFormFromPayload(payload: Record<string, unknown>): {
  payu_post_endpoint?: string;
  payu_post_fields?: Record<string, string>;
} {
  const cr = payload.collect_raw as Record<string, unknown> | undefined;
  if (!cr || typeof cr !== 'object') return {};
  const endpoint = typeof cr.endpoint === 'string' ? cr.endpoint.trim() : '';
  const pf = cr.post_fields as Record<string, unknown> | undefined;
  if (!endpoint || !pf || typeof pf !== 'object') return {};
  const payu_post_fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(pf)) {
    payu_post_fields[k] = v == null ? '' : String(v);
  }
  return { payu_post_endpoint: endpoint, payu_post_fields };
}

function buildCollectResponse(
  collect: CreateUpiCollectResult,
  payload: Record<string, unknown>
) {
  const payuForm = payuHostedFormFromPayload(payload);
  return {
    payment_session_id:
      (payload.payment_session_id as string | undefined) ??
      collect.paymentSessionId,
    provider_order_id: payload.provider_order_id as string | undefined,
    provider_payment_id:
      collect.providerPaymentId ?? (payload.provider_payment_id as string | undefined),
    session_reference:
      (payload.session_reference as string | undefined) ??
      collect.paymentSessionId ??
      collect.providerPaymentId,
    upi_intent: collect.upiIntent,
    qr_data: collect.qrData,
    payment_url: collect.paymentUrl,
    expires_at:
      collect.expiresAt instanceof Date
        ? collect.expiresAt.toISOString()
        : (collect.expiresAt as string | undefined),
    ...payuForm,
  };
}

type CollectResponseShape = ReturnType<typeof buildCollectResponse>;

function jsonResponseFromTransaction(
  row: PaymentTransactionRow,
  collectFromPayload: CollectResponseShape
) {
  return {
    transaction: {
      id: row.id,
      order_id: row.order_id,
      provider: row.provider,
      provider_payment_id: row.provider_payment_id,
      method: row.method,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      created_at: row.created_at
    },
    collect: collectFromPayload
  };
}

function collectResponseFromStoredRow(row: PaymentTransactionRow) {
  const p = (row.raw_payload || {}) as Record<string, unknown>;
  const payuForm = payuHostedFormFromPayload(p);
  return {
    payment_session_id:
      typeof p.payment_session_id === 'string' ? p.payment_session_id : undefined,
    provider_order_id:
      typeof p.provider_order_id === 'string' ? p.provider_order_id : undefined,
    provider_payment_id: row.provider_payment_id ?? undefined,
    session_reference:
      typeof p.session_reference === 'string'
        ? p.session_reference
        : typeof p.payment_session_id === 'string'
          ? p.payment_session_id
          : row.provider_payment_id ?? undefined,
    upi_intent: typeof p.upi_intent === 'string' ? p.upi_intent : undefined,
    qr_data: typeof p.qr_data === 'string' ? p.qr_data : undefined,
    payment_url: typeof p.payment_url === 'string' ? p.payment_url : undefined,
    expires_at: p.expires_at as string | undefined,
    ...payuForm,
  };
}

/**
 * POST /api/payments/upi-collect
 *
 * Body:
 * - order_id (required) — sales_orders.id
 * - business_id (optional if session sets tenant)
 * - provider (optional) — default `mock`; e.g. `cashfree`
 * - Credentials: payment_provider_configs + PAYMENT_ENCRYPTION_KEY, or ENV fallback (never accept secrets in body)
 * - customer_name, customer_phone, customer_email — forwarded to PSP
 * - return_url, notify_url — forwarded to PSP where supported
 *
 * Hosted checkout (`createHostedPaymentLink`): forced for **PhonePe** and **Instamojo** when implemented;
 * other PSPs use it when `supportsHostedPaymentLinks()` is true.
 *
 * Response `collect` always includes **`payment_url`** and **`provider_order_id`** (when the PSP returns them),
 * e.g. Instamojo payment request id / PhonePe merchant txn id — same shape as other hosted PSPs.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request, body);
    const userId = getUserIdFromRequest(request, body);

    const {
      order_id: orderId,
      provider: providerId = 'mock',
      customer_name,
      customer_phone,
      customer_email,
      return_url,
      notify_url,
    } = body as Record<string, unknown>;

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }
    if (!orderId || typeof orderId !== 'string') {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    }

    const order = await queryOne<SalesOrderRow>(
      `SELECT id, business_id, status, grand_total::text, branch_id, payment_status
       FROM sales_orders
       WHERE id = $1 AND business_id = $2`,
      [orderId, businessId]
    );

    if (!order) {
      return NextResponse.json(
        { error: 'Sales order not found for this business' },
        { status: 404 }
      );
    }

    if (order.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Cannot collect payment for a cancelled order' },
        { status: 400 }
      );
    }

    const grandTotal = parseAmount(order.grand_total);
    if (grandTotal <= 0) {
      return NextResponse.json(
        { error: 'Order grand_total must be greater than zero' },
        { status: 400 }
      );
    }

    try {
      await authorize(userId, 'sales_orders', 'update', {
        branchId: order.branch_id ?? undefined,
        businessId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const totalPaidSuccess = await getSuccessfulPaymentsSumForOrder(
      businessId,
      order.id
    );
    const remainingAmount = remainingOrderAmountAfterSuccessSum(
      grandTotal,
      totalPaidSuccess
    );

    if (totalPaidSuccess > grandTotal + PAYMENT_AMOUNT_EPS) {
      console.warn('[upi-collect] overpayment vs order total', {
        order_id: order.id,
        business_id: businessId,
        grand_total: grandTotal,
        total_paid_success: totalPaidSuccess
      });
    }

    if (remainingAmount <= PAYMENT_AMOUNT_EPS) {
      return NextResponse.json(
        {
          already_paid: true,
          message: 'Order is already fully paid',
          grand_total: grandTotal,
          total_paid: totalPaidSuccess
        },
        { status: 200 }
      );
    }

    await failStaleUpiCollectIfAmountMismatch(
      businessId,
      order.id,
      remainingAmount
    );

    const existingPending = await getPendingUpiCollectTransactionForOrder(
      businessId,
      order.id
    );
    if (existingPending) {
      return NextResponse.json({
        ...jsonResponseFromTransaction(
          existingPending,
          collectResponseFromStoredRow(existingPending)
        ),
        deduplicated: true,
        message:
          'An active UPI collect session already exists for this order; returning it instead of creating a duplicate.'
      });
    }

    let psp;
    try {
      psp = await createPaymentProviderForBusiness(
        businessId,
        String(providerId).toLowerCase()
      );
    } catch (e) {
      return NextResponse.json(
        {
          error: e instanceof Error ? e.message : 'Invalid payment provider',
        },
        { status: 400 }
      );
    }

    const collectParams = {
      businessId,
      orderId: order.id,
      amount: remainingAmount,
      currency: 'INR',
      customerName:
        typeof customer_name === 'string' ? customer_name : undefined,
      customerPhone:
        typeof customer_phone === 'string' ? customer_phone : undefined,
      customerEmail:
        typeof customer_email === 'string' ? customer_email : undefined,
      returnUrl: typeof return_url === 'string' ? return_url : undefined,
      notifyUrl: typeof notify_url === 'string' ? notify_url : undefined,
      metadata: {
        sales_order_number_context: orderId,
        business_id: businessId,
      },
    };

    const providerLower = String(providerId).toLowerCase();

    let collect;
    try {
      const canHosted =
        typeof psp.createHostedPaymentLink === 'function' &&
        (providerLower === 'phonepe' ||
          providerLower === 'instamojo' ||
          (typeof psp.supportsHostedPaymentLinks === 'function' &&
            psp.supportsHostedPaymentLinks()));

      if (canHosted) {
        collect = await psp.createHostedPaymentLink!(collectParams);
      } else {
        collect = await psp.createUpiCollect(collectParams);
      }
    } catch (e) {
      console.error('[upi-collect] PSP payment session failed', e);
      return NextResponse.json(
        {
          error: 'Payment provider failed to create payment session',
          details: e instanceof Error ? e.message : String(e),
        },
        { status: 502 }
      );
    }

    const rawPayload = {
      ...buildUpiCollectRawPayload(collect, order.id),
      order_grand_total: grandTotal,
      collect_remaining_amount: remainingAmount,
      total_paid_success_before_collect: totalPaidSuccess
    };

    const transaction = await createPaymentTransaction({
      businessId,
      orderId: order.id,
      provider: psp.id,
      providerPaymentId: collect.providerPaymentId ?? null,
      method: 'upi_collect',
      amount: remainingAmount,
      currency: 'INR',
      status: 'pending',
      rawPayload,
      syncSalesOrder: true,
    });

    return NextResponse.json({
      ...jsonResponseFromTransaction(
        transaction,
        buildCollectResponse(collect, rawPayload)
      ),
      deduplicated: false
    });
  } catch (error) {
    console.error('[upi-collect] Unexpected error', error);
    return NextResponse.json(
      { error: 'Failed to create UPI collect request' },
      { status: 500 }
    );
  }
}
