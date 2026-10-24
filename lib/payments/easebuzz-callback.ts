import { queryOne } from '@/lib/db';
import { getBusinessPaymentProviderConfig } from './business-provider-config';
import {
  EasebuzzPaymentProvider,
  easebuzzTxnContext,
  parseEasebuzzBody,
} from './providers/easebuzz-payment-provider';
import { applyVerifiedPaymentWebhook } from '@/lib/services/payment-webhook';

export type EasebuzzCallbackResult = {
  httpStatus: number;
  body: Record<string, unknown>;
  /** Same-origin path the browser return route redirects to. */
  redirectPath: string;
};

const PAY_COMPLETE = '/pay/complete';

function payComplete(status: 'paid' | 'failed' | 'pending' | 'unverified'): string {
  return `${PAY_COMPLETE}?status=${status}&provider=easebuzz`;
}

function outcomeFromStatus(status: string | undefined): 'paid' | 'failed' | 'pending' {
  return status === 'success' ? 'paid' : status === 'failed' ? 'failed' : 'pending';
}

/**
 * One entry point for every Easebuzz callback: the browser return (surl/furl) and the
 * dashboard webhook. The txnid prefix picks the flow; the tenant always comes from the row
 * Khatario stored when it created the payment, and the hash is checked with that tenant's salt.
 *
 * @param expectedBusinessId optional `?business_id=` from the merchant webhook URL; must match.
 */
export async function handleEasebuzzCallback(
  rawBody: string,
  options: { expectedBusinessId?: string | null; only?: 'PB' } = {},
): Promise<EasebuzzCallbackResult> {
  const unverified = parseEasebuzzBody(rawBody);
  const txnid = (unverified.txnid || '').trim();
  const context = txnid ? easebuzzTxnContext(txnid) : null;
  if (!txnid || !context || (options.only && context !== options.only)) {
    return {
      httpStatus: 400,
      body: { ok: false, error: 'Unknown Easebuzz transaction' },
      redirectPath: payComplete('unverified'),
    };
  }

  if (context === 'PB') {
    const { processPlatformEasebuzzCallback } = await import('@/lib/platform-billing');
    const r = await processPlatformEasebuzzCallback(rawBody);
    const status = r.ok ? 200 : r.httpStatus ?? 400;
    let redirectPath = payComplete('unverified');
    if (r.outcome) {
      const done = r.outcome === 'paid' || r.outcome === 'duplicate';
      if (r.checkoutType === 'whatsapp_addon') {
        redirectPath = done
          ? `/settings/subscription?addon=success&type=${encodeURIComponent(r.addonType ?? '')}`
          : `/settings/subscription?addon=${r.outcome === 'failed' ? 'cancelled' : 'pending'}`;
      } else {
        redirectPath = done
          ? `/settings/subscription?payment=success&plan=${encodeURIComponent(r.planId ?? '')}`
          : `/settings/subscription?payment=${r.outcome === 'failed' ? 'cancelled' : 'pending'}`;
      }
    }
    return { httpStatus: status, body: { ...r }, redirectPath };
  }

  if (context === 'ST') {
    return handleStoreCallback(rawBody, txnid, options.expectedBusinessId);
  }
  return handleSalesOrderCallback(rawBody, txnid, options.expectedBusinessId);
}

async function verifierFor(businessId: string): Promise<EasebuzzPaymentProvider | null> {
  const cfg = await getBusinessPaymentProviderConfig(businessId, 'easebuzz');
  return cfg?.clientId && cfg.clientSecret ? new EasebuzzPaymentProvider(cfg) : null;
}

async function handleSalesOrderCallback(
  rawBody: string,
  txnid: string,
  expectedBusinessId?: string | null,
): Promise<EasebuzzCallbackResult> {
  const tx = await queryOne<{ business_id: string }>(
    `SELECT business_id FROM payment_transactions
      WHERE LOWER(provider) = 'easebuzz' AND (raw_payload->>'provider_order_id') = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [txnid],
  );
  if (!tx) {
    return { httpStatus: 404, body: { ok: false, error: 'no_matching_transaction' }, redirectPath: payComplete('pending') };
  }
  if (expectedBusinessId && expectedBusinessId !== tx.business_id) {
    return { httpStatus: 400, body: { ok: false, error: 'business_id mismatch' }, redirectPath: payComplete('unverified') };
  }
  const verifier = await verifierFor(tx.business_id);
  if (!verifier) {
    return { httpStatus: 400, body: { ok: false, error: 'Easebuzz is not configured' }, redirectPath: payComplete('unverified') };
  }
  const verified = await verifier.verifyWebhook({ rawBody, headers: {} });
  if (!verified.verified) {
    return {
      httpStatus: 401,
      body: { ok: false, error: verified.reason || 'Webhook verification failed' },
      redirectPath: payComplete('unverified'),
    };
  }
  const result = await applyVerifiedPaymentWebhook({
    businessId: tx.business_id,
    provider: 'easebuzz',
    verified,
    rawBody: JSON.stringify(verified.rawPayload ?? {}),
  });
  return {
    httpStatus: result.httpStatus ?? (result.ok ? 200 : 422),
    body: { ...result },
    redirectPath: payComplete(outcomeFromStatus(verified.status)),
  };
}

async function handleStoreCallback(
  rawBody: string,
  txnid: string,
  expectedBusinessId?: string | null,
): Promise<EasebuzzCallbackResult> {
  const order = await queryOne<{ id: string; business_id: string }>(
    `SELECT id, business_id FROM store_orders
      WHERE payment_provider = 'easebuzz' AND payment_ref = $1
      LIMIT 1`,
    [txnid],
  );
  if (!order) {
    return { httpStatus: 200, body: { ok: true, ignored: true }, redirectPath: payComplete('pending') };
  }
  if (expectedBusinessId && expectedBusinessId !== order.business_id) {
    return { httpStatus: 400, body: { ok: false, error: 'business_id mismatch' }, redirectPath: payComplete('unverified') };
  }
  const verifier = await verifierFor(order.business_id);
  if (!verifier) {
    return { httpStatus: 400, body: { ok: false, error: 'Unknown store payment config' }, redirectPath: payComplete('unverified') };
  }
  const verified = await verifier.verifyWebhook({ rawBody, headers: {} });
  if (!verified.verified) {
    return { httpStatus: 401, body: { ok: false, verified: false }, redirectPath: payComplete('unverified') };
  }

  const { fulfillStoreOrderPayment, recordStorePaymentFailure } = await import('@/lib/store/fulfill-paid-order');
  const payload = JSON.stringify(verified.rawPayload ?? {});
  const redirectPath = payComplete(outcomeFromStatus(verified.status));

  if (verified.status === 'failed') {
    const outcome = await recordStorePaymentFailure(order.id, order.business_id, {
      provider: 'easebuzz',
      idempotencyKey: `failed|${verified.providerPaymentId || txnid}`,
      amount: verified.amount ?? null,
      currency: verified.currency,
      payload,
    });
    return { httpStatus: 200, body: { ok: true, outcome }, redirectPath };
  }
  if (verified.status !== 'success') {
    return { httpStatus: 200, body: { ok: true, verified: true, ignored: true }, redirectPath };
  }
  try {
    const result = await fulfillStoreOrderPayment(order.id, order.business_id, {
      provider: 'easebuzz',
      idempotencyKey: verified.providerPaymentId || `paid|${txnid}`,
      amount: verified.amount,
      currency: verified.currency,
      payload,
      providerPaymentId: verified.providerPaymentId,
      providerOrderId: txnid,
    });
    return { httpStatus: 200, body: { ok: true, ...result }, redirectPath };
  } catch (err) {
    console.error('[store easebuzz callback]', err);
    return { httpStatus: 500, body: { ok: false, error: 'Fulfilment failed' }, redirectPath };
  }
}
