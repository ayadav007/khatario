/**
 * Paying the khata online through the store's gateway (docs/plan/STORE_KHATA.md, section 6).
 * A khata payment row is made first; the gateway's verified notice settles it across the open
 * bills once (lib/khata/settle.ts). The business and customer come from the stored row, never
 * from the gateway payload.
 */
import { getPool, queryOne } from '@/lib/db';
import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';
import {
  getBusinessPaymentProviderConfig,
  getPreferredConfiguredProvider,
} from '@/lib/payments/business-provider-config';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { EasebuzzPaymentProvider } from '@/lib/payments/providers/easebuzz-payment-provider';
import { storePaymentAmountMatches } from '@/lib/store/fulfillment-rules';
import { storeReceiptPaymentMode } from '@/lib/store/store-receipt';
import { KhataError, getKhataSettings, loadKhataCustomer } from './service';
import { settleKhataPayment } from './settle';

export type KhataGatewayProvider = 'razorpay' | 'easebuzz';
const PROVIDERS: readonly KhataGatewayProvider[] = ['razorpay', 'easebuzz'];

/** The store's online gateway for khata payments, or null (then "My khata" is read-only). */
export async function khataGateway(businessId: string): Promise<KhataGatewayProvider | null> {
  if (!(await hasFeatureAccess(businessId, FeatureKeys.PAYMENT_GATEWAY))) return null;
  const providerId = (await getPreferredConfiguredProvider(businessId, PROVIDERS)) as KhataGatewayProvider | null;
  if (!providerId) return null;
  const cfg = await getBusinessPaymentProviderConfig(businessId, providerId);
  return cfg?.clientId && cfg.clientSecret ? providerId : null;
}

async function openBillsTotal(businessId: string, customerId: string): Promise<number> {
  const r = await queryOne<{ owed: string }>(
    `SELECT COALESCE(SUM(balance_amount), 0)::text AS owed FROM invoices
      WHERE business_id = $1 AND customer_id = $2 AND status = 'final' AND deleted_at IS NULL
        AND COALESCE(balance_amount, 0) > 0.005`,
    [businessId, customerId],
  );
  return round2(Number(r?.owed ?? 0));
}

export async function startKhataOnlinePayment(input: {
  businessId: string;
  customerId: string;
  storeCustomerId: string | null;
  /** Omit to pay everything owed. */
  amount?: number | null;
  storeSubdomain: string;
}): Promise<{ paymentUrl: string; amount: number; khataPaymentId: string }> {
  const provider = await khataGateway(input.businessId);
  if (!provider) throw new KhataError('Online payment is not available for this shop', 400, 'NO_GATEWAY');
  const customer = await loadKhataCustomer(input.businessId, input.customerId);
  if (!customer) throw new KhataError('Khata not found', 404, 'CUSTOMER_NOT_FOUND');
  const owed = await openBillsTotal(input.businessId, input.customerId);
  if (owed <= 0.005) throw new KhataError('Nothing is due on your khata', 400, 'NOTHING_DUE');
  const settings = await getKhataSettings(input.businessId);
  const asked = input.amount == null ? owed : round2(Number(input.amount));
  if (!Number.isFinite(asked) || asked < 1) throw new KhataError('Enter at least ₹1', 400, 'INVALID_AMOUNT');
  if (asked > owed + 0.005) {
    throw new KhataError(`You owe ₹${owed.toLocaleString('en-IN')}. Enter that amount or less.`, 400, 'MORE_THAN_OWED');
  }
  if (!settings.allowPartPayment && Math.abs(asked - owed) > 0.005) {
    throw new KhataError(`Please pay the full ₹${owed.toLocaleString('en-IN')}`, 400, 'FULL_PAYMENT_REQUIRED');
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO khata_payments (business_id, customer_id, store_customer_id, amount, provider)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.businessId, input.customerId, input.storeCustomerId, asked, provider],
  );
  const khataPaymentId = row!.id;
  const cfg = await getBusinessPaymentProviderConfig(input.businessId, provider);
  if (!cfg) throw new KhataError('Online payment is not available for this shop', 400, 'NO_GATEWAY');
  const psp = provider === 'easebuzz' ? new EasebuzzPaymentProvider(cfg) : new RazorpayPaymentProvider(cfg);
  const origin = (process.env.NEXT_PUBLIC_APP_URL || 'https://staging.khatario.com').replace(/\/$/, '');
  let link;
  try {
    link = await psp.createHostedPaymentLink({
      businessId: input.businessId,
      orderId: khataPaymentId,
      amount: asked,
      currency: 'INR',
      customerName: customer.name,
      customerPhone: customer.phone ?? '',
      returnUrl: `${origin}/pay/complete`,
      metadata: {
        description: 'Khata payment',
        khata_payment_id: khataPaymentId,
        store_subdomain: input.storeSubdomain,
        ...(provider === 'easebuzz' ? { easebuzz_context: 'KH' } : {}),
      },
    });
  } catch (err) {
    await getPool().query(
      `UPDATE khata_payments SET status = 'failed', error_message = $2 WHERE id = $1`,
      [khataPaymentId, err instanceof Error ? err.message.slice(0, 500) : 'Payment link failed'],
    );
    throw new KhataError('Could not start the online payment. Please try again.', 502, 'GATEWAY_ERROR');
  }
  if (!link.paymentUrl) throw new KhataError('Could not start the online payment. Please try again.', 502, 'GATEWAY_ERROR');
  await getPool().query(`UPDATE khata_payments SET payment_ref = $2 WHERE id = $1`, [
    khataPaymentId,
    link.providerPaymentId ?? null,
  ]);
  return { paymentUrl: link.paymentUrl, amount: asked, khataPaymentId };
}

/** The khata payment a gateway notice refers to, by the link id / txnid or captured payment id. */
export async function findKhataPayment(
  provider: KhataGatewayProvider,
  refs: { paymentRef?: string | null; providerPaymentId?: string | null },
): Promise<{ id: string; business_id: string } | null> {
  const ref = refs.paymentRef || '';
  const pid = refs.providerPaymentId || '';
  if (!ref && !pid) return null;
  return queryOne<{ id: string; business_id: string }>(
    `SELECT id, business_id FROM khata_payments
      WHERE provider = $1 AND (($2 <> '' AND payment_ref = $2) OR ($3 <> '' AND provider_payment_id = $3))
      LIMIT 1`,
    [provider, ref, pid],
  );
}

export type KhataPaymentOutcome =
  | { outcome: 'settled'; settled: number; advance: number }
  | { outcome: 'duplicate' }
  | { outcome: 'rejected'; reason: 'AMOUNT_MISMATCH' | 'NOT_FOUND' };

/** Applies one verified successful gateway notice. Idempotent: a paid row is never settled twice. */
export async function applyKhataGatewayPayment(input: {
  khataPaymentId: string;
  businessId: string;
  amount: number | null | undefined;
  providerPaymentId?: string | null;
  payload: unknown;
}): Promise<KhataPaymentOutcome> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{ id: string; customer_id: string; amount: string; status: string }>(
      `SELECT id, customer_id, amount::text, status FROM khata_payments
        WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [input.khataPaymentId, input.businessId],
    );
    const row = r.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { outcome: 'rejected', reason: 'NOT_FOUND' };
    }
    if (row.status === 'paid') {
      await client.query('COMMIT');
      return { outcome: 'duplicate' };
    }
    const expected = Number(row.amount);
    if (!storePaymentAmountMatches(input.amount ?? null, expected)) {
      await client.query(
        `UPDATE khata_payments SET error_message = 'AMOUNT_MISMATCH' WHERE id = $1`,
        [row.id],
      );
      await client.query('COMMIT');
      return { outcome: 'rejected', reason: 'AMOUNT_MISMATCH' };
    }
    const settlement = await settleKhataPayment(client, {
      businessId: input.businessId,
      customerId: row.customer_id,
      amount: expected,
      paymentMode: storeReceiptPaymentMode(input.payload),
      createdBy: null,
      reference: `KP-${row.id.slice(0, 8).toUpperCase()}`,
      allowAdvance: true,
    });
    await client.query(
      `UPDATE khata_payments
          SET status = 'paid', paid_at = CURRENT_TIMESTAMP, settled_amount = $2,
              provider_payment_id = COALESCE($3, provider_payment_id), error_message = NULL
        WHERE id = $1`,
      [row.id, settlement.settled, input.providerPaymentId ?? null],
    );
    await client.query('COMMIT');
    return { outcome: 'settled', settled: settlement.settled, advance: settlement.advance };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function markKhataPaymentFailed(khataPaymentId: string, businessId: string): Promise<void> {
  await getPool().query(
    `UPDATE khata_payments SET status = 'failed', error_message = 'PAYMENT_FAILED'
      WHERE id = $1 AND business_id = $2 AND status = 'pending'`,
    [khataPaymentId, businessId],
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
