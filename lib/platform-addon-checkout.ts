/**
 * WhatsApp add-on checkout via Razorpay Payment Links.
 */

import type { PoolClient } from 'pg';
import { getPool, query } from '@/lib/db';
import { getBusinessPlatformRecipient } from '@/lib/platform-email';
import {
  notifyBillingTransactionStatus,
  recordBillingTransaction,
} from '@/lib/platform-billing';
import {
  assertBillingTransactionTransition,
  type BillingTxStatus,
} from '@/lib/platform-billing-transaction-state';
import {
  clearAddonCache,
  type WhatsAppAddonType,
} from '@/lib/subscription';
import { CONNECT_PLAN_ID } from '@/lib/product-lines';
import { KHATARIO_AI_PRICE_MONTHLY } from '@/lib/ai-agent/billing-constants';
import {
  getPlatformCheckoutProvider,
  isPlatformPaymentConfigured,
  isPlatformRazorpayConfigured,
  type PlatformPaymentProviderId,
} from '@/lib/platform-subscription-checkout';

export { isPlatformPaymentConfigured, isPlatformRazorpayConfigured };

export const WHATSAPP_ADDON_PRICING: Record<WhatsAppAddonType, number> = {
  whatsapp_bot: 499,
  whatsapp_send_message: 299,
  khatario_ai: KHATARIO_AI_PRICE_MONTHLY,
};

export const WHATSAPP_ADDON_LABELS: Record<WhatsAppAddonType, string> = {
  whatsapp_bot: 'WhatsApp Bot',
  whatsapp_send_message: 'Send Message',
  khatario_ai: 'Khatario AI',
};

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    'http://localhost:3000'
  );
}

export interface CreateAddonCheckoutInput {
  businessId: string;
  addonType: WhatsAppAddonType;
}

export interface CreateAddonCheckoutResult {
  checkoutUrl: string;
  amount: number;
  currency: string;
  billingTransactionId: string;
  paymentLinkId?: string;
}

export async function activateWhatsAppAddon(
  businessId: string,
  addonType: WhatsAppAddonType,
  price: number,
  client?: PoolClient,
): Promise<Record<string, unknown>> {
  const run = (sql: string, values: unknown[]) =>
    client ? client.query(sql, values) : query(sql, values);
  const runOne = async <T extends Record<string, unknown>>(sql: string, values: unknown[]) =>
    ((await run(sql, values)).rows[0] as T | undefined) ?? null;

  // One paid month per payment. A payment made while the add-on is still running extends it
  // from its current end date; one made after it ended (or on a row with no end date) starts today.
  await run(
    `INSERT INTO whatsapp_addons (
       business_id, addon_type, status, price_monthly, start_date, end_date
     ) VALUES ($1, $2, 'active', $3, CURRENT_DATE, (CURRENT_DATE + INTERVAL '1 month')::date)
     ON CONFLICT (business_id, addon_type) DO UPDATE
     SET start_date = CASE WHEN whatsapp_addons.status = 'active'
                           THEN whatsapp_addons.start_date ELSE CURRENT_DATE END,
         status = 'active',
         price_monthly = EXCLUDED.price_monthly,
         end_date = (GREATEST(COALESCE(whatsapp_addons.end_date, CURRENT_DATE), CURRENT_DATE)
                     + INTERVAL '1 month')::date,
         updated_at = CURRENT_TIMESTAMP`,
    [businessId, addonType, price],
  );

  const addon = await runOne(
    `SELECT * FROM whatsapp_addons
     WHERE business_id = $1 AND addon_type = $2`,
    [businessId, addonType],
  );

  if (!client) clearAddonCache(businessId);
  return addon ?? {};
}

export async function createAddonCheckout(
  input: CreateAddonCheckoutInput,
): Promise<CreateAddonCheckoutResult> {
  const price = WHATSAPP_ADDON_PRICING[input.addonType];
  if (!price || price <= 0) {
    throw new Error('Invalid addon type');
  }

  const checkout = await getPlatformCheckoutProvider();
  if (!checkout) {
    throw new Error('PAYMENT_NOT_CONFIGURED');
  }
  const provider = checkout.provider;

  const label = WHATSAPP_ADDON_LABELS[input.addonType];
  const recipient = await getBusinessPlatformRecipient(input.businessId);

  const pending = await recordBillingTransaction({
    businessId: input.businessId,
    planId: CONNECT_PLAN_ID,
    moduleKey: 'connect',
    amount: price,
    billingCycle: 'monthly',
    paymentMethod: checkout.id,
    status: 'pending',
    description: `${label} add-on — monthly`,
    skipEmails: true,
  });

  const returnUrl = `${appBaseUrl()}/settings/subscription?addon=success&type=${encodeURIComponent(input.addonType)}`;
  const cancelUrl = `${appBaseUrl()}/settings/subscription?addon=cancelled`;

  const link = await provider.createHostedPaymentLink({
    businessId: input.businessId,
    orderId: pending.id,
    amount: price,
    currency: 'INR',
    customerName: recipient?.businessName,
    customerEmail: recipient?.email ?? undefined,
    returnUrl,
    metadata: {
      description: `Khatario ${label} add-on`,
      checkout_type: 'whatsapp_addon',
      addon_type: input.addonType,
      plan_id: CONNECT_PLAN_ID,
      billing_cycle: 'monthly',
      module_key: 'connect',
      billing_transaction_id: pending.id,
      cancel_url: cancelUrl,
      ...(checkout.id === 'easebuzz' ? { easebuzz_context: 'PB' } : {}),
    },
  });

  if (link.providerPaymentId) {
    await query(
      `UPDATE billing_transactions
       SET payment_reference = $2,
           gateway_response = $3::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        pending.id,
        link.providerPaymentId,
        JSON.stringify({
          payment_link_id: link.providerPaymentId,
          short_url: link.paymentUrl,
          provider: checkout.id,
          checkout_type: 'whatsapp_addon',
          addon_type: input.addonType,
        }),
      ],
    );
  }

  if (!link.paymentUrl) {
    throw new Error('Payment provider did not return a checkout URL');
  }

  return {
    checkoutUrl: link.paymentUrl,
    amount: price,
    currency: 'INR',
    billingTransactionId: pending.id,
    paymentLinkId: link.providerPaymentId,
  };
}

export async function completeAddonCheckoutPayment(params: {
  businessId: string;
  addonType: WhatsAppAddonType;
  billingTransactionId?: string | null;
  providerPaymentId?: string | null;
  amount: number;
  gatewayResponse?: unknown;
  paymentMethod?: PlatformPaymentProviderId;
}): Promise<'activated' | 'already_completed'> {
  const price = WHATSAPP_ADDON_PRICING[params.addonType] ?? params.amount;

  if (!params.billingTransactionId) {
    await recordBillingTransaction({
      businessId: params.businessId,
      planId: CONNECT_PLAN_ID,
      moduleKey: 'connect',
      amount: params.amount,
      billingCycle: 'monthly',
      paymentMethod: params.paymentMethod ?? 'razorpay',
      paymentReference: params.providerPaymentId,
      status: 'completed',
      description: `${WHATSAPP_ADDON_LABELS[params.addonType]} add-on — monthly`,
      gatewayResponse: params.gatewayResponse,
    });
    await activateAddonForCheckout(params.businessId, params.addonType, price);
    return 'activated';
  }

  const billingTransactionId = params.billingTransactionId;
  const client: PoolClient = await getPool().connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query<{ status: BillingTxStatus }>(
      `SELECT status FROM billing_transactions
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [billingTransactionId, params.businessId],
    );
    const tx = locked.rows[0];
    if (!tx) {
      throw new Error('CHECKOUT_TRANSACTION_NOT_FOUND');
    }
    if (tx.status === 'completed') {
      await client.query('ROLLBACK');
      return 'already_completed';
    }
    assertBillingTransactionTransition(tx.status, 'completed');

    await client.query(
      `UPDATE billing_transactions
       SET status = 'completed',
           payment_reference = COALESCE(payment_reference, $2),
           gateway_response = COALESCE($3::jsonb, gateway_response),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        billingTransactionId,
        params.providerPaymentId?.trim() || null,
        params.gatewayResponse ? JSON.stringify(params.gatewayResponse) : null,
      ],
    );

    await activateAddonForCheckout(params.businessId, params.addonType, price, client);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  clearAddonCache(params.businessId);
  try {
    await notifyBillingTransactionStatus(billingTransactionId, 'completed');
  } catch (err) {
    console.error('[addon-checkout] payment success notification failed:', err);
  }
  return 'activated';
}

async function activateAddonForCheckout(
  businessId: string,
  addonType: WhatsAppAddonType,
  price: number,
  client?: PoolClient,
): Promise<void> {
  if (addonType === 'khatario_ai') {
    await activateWhatsAppAddon(businessId, addonType, price, client);
  } else {
    // Checkouts opened before the Bot/Send add-ons were folded into Connect.
    await grantConnectMonthForLegacyAddon(businessId, client);
  }
}

async function grantConnectMonthForLegacyAddon(businessId: string, client?: PoolClient): Promise<void> {
  const run = (sql: string, values: unknown[]) => (client ? client.query(sql, values) : query(sql, values));
  await run(
    `INSERT INTO business_module_subscriptions
       (business_id, module_key, plan_id, status, start_date, end_date, billing_cycle)
     VALUES ($1, 'connect', $2, 'active', CURRENT_DATE, (CURRENT_DATE + INTERVAL '1 month')::date, 'monthly')
     ON CONFLICT (business_id, module_key) DO UPDATE SET
       plan_id = $2,
       status = 'active',
       end_date = (
         GREATEST(
           CASE WHEN business_module_subscriptions.plan_id = $2 AND business_module_subscriptions.status = 'active'
                THEN COALESCE(business_module_subscriptions.end_date, CURRENT_DATE)
                ELSE CURRENT_DATE END,
           CURRENT_DATE
         ) + INTERVAL '1 month'
       )::date,
       trial_end_date = NULL,
       grace_period_end = NULL,
       scheduled_plan_id = NULL,
       cancel_at_period_end = false,
       updated_at = CURRENT_TIMESTAMP`,
    [businessId, CONNECT_PLAN_ID],
  );
  await run(
    `INSERT INTO business_modules (business_id, module_key, enabled, source)
     VALUES ($1, 'connect', true, 'legacy_addon_checkout')
     ON CONFLICT (business_id, module_key) DO UPDATE SET enabled = true`,
    [businessId],
  );
  if (!client) clearAddonCache(businessId);
}

export function isWhatsAppAddonType(value: unknown): value is WhatsAppAddonType {
  return value === 'whatsapp_bot' || value === 'whatsapp_send_message' || value === 'khatario_ai';
}
