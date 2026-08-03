/**
 * WhatsApp add-on checkout via Razorpay Payment Links.
 */

import { query, queryOne } from '@/lib/db';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { getBusinessPlatformRecipient } from '@/lib/platform-email';
import {
  recordBillingTransaction,
  updateBillingTransactionStatus,
} from '@/lib/platform-billing';
import {
  clearAddonCache,
  type WhatsAppAddonType,
} from '@/lib/subscription';
import { CONNECT_PLAN_ID } from '@/lib/product-lines';
import {
  getPlatformRazorpayProvider,
  isPlatformRazorpayConfigured,
} from '@/lib/platform-subscription-checkout';

export { isPlatformRazorpayConfigured };

export const WHATSAPP_ADDON_PRICING: Record<WhatsAppAddonType, number> = {
  whatsapp_bot: 499,
  whatsapp_send_message: 299,
};

export const WHATSAPP_ADDON_LABELS: Record<WhatsAppAddonType, string> = {
  whatsapp_bot: 'WhatsApp Bot',
  whatsapp_send_message: 'Send Message',
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
): Promise<Record<string, unknown>> {
  const existingAddon = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM whatsapp_addons
     WHERE business_id = $1 AND addon_type = $2`,
    [businessId, addonType],
  );

  if (existingAddon) {
    await query(
      `UPDATE whatsapp_addons
       SET status = 'active',
           start_date = CURRENT_DATE,
           end_date = NULL,
           price_monthly = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $2 AND addon_type = $3`,
      [price, businessId, addonType],
    );
  } else {
    await query(
      `INSERT INTO whatsapp_addons (
         business_id, addon_type, status, price_monthly, start_date, end_date
       ) VALUES ($1, $2, 'active', $3, CURRENT_DATE, NULL)`,
      [businessId, addonType, price],
    );
  }

  const addon = await queryOne(
    `SELECT * FROM whatsapp_addons
     WHERE business_id = $1 AND addon_type = $2`,
    [businessId, addonType],
  );

  clearAddonCache(businessId);
  return addon ?? {};
}

export async function createAddonCheckout(
  input: CreateAddonCheckoutInput,
): Promise<CreateAddonCheckoutResult> {
  const price = WHATSAPP_ADDON_PRICING[input.addonType];
  if (!price || price <= 0) {
    throw new Error('Invalid addon type');
  }

  const provider = getPlatformRazorpayProvider();
  if (!provider) {
    throw new Error('PAYMENT_NOT_CONFIGURED');
  }

  const label = WHATSAPP_ADDON_LABELS[input.addonType];
  const recipient = await getBusinessPlatformRecipient(input.businessId);

  const pending = await recordBillingTransaction({
    businessId: input.businessId,
    planId: CONNECT_PLAN_ID,
    moduleKey: 'connect',
    amount: price,
    billingCycle: 'monthly',
    paymentMethod: 'razorpay',
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
          checkout_type: 'whatsapp_addon',
          addon_type: input.addonType,
        }),
      ],
    );
  }

  if (!link.paymentUrl) {
    throw new Error('Razorpay did not return a checkout URL');
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
}): Promise<void> {
  const price = WHATSAPP_ADDON_PRICING[params.addonType] ?? params.amount;

  if (params.billingTransactionId) {
    await updateBillingTransactionStatus(
      params.billingTransactionId,
      'completed',
      params.gatewayResponse,
    );

    if (params.providerPaymentId) {
      await query(
        `UPDATE billing_transactions
         SET payment_reference = COALESCE(payment_reference, $2)
         WHERE id = $1`,
        [params.billingTransactionId, params.providerPaymentId],
      );
    }
  } else {
    await recordBillingTransaction({
      businessId: params.businessId,
      planId: CONNECT_PLAN_ID,
      moduleKey: 'connect',
      amount: params.amount,
      billingCycle: 'monthly',
      paymentMethod: 'razorpay',
      paymentReference: params.providerPaymentId,
      status: 'completed',
      description: `${WHATSAPP_ADDON_LABELS[params.addonType]} add-on — monthly`,
      gatewayResponse: params.gatewayResponse,
    });
  }

  await activateWhatsAppAddon(params.businessId, params.addonType, price);
}

export function isWhatsAppAddonType(value: unknown): value is WhatsAppAddonType {
  return value === 'whatsapp_bot' || value === 'whatsapp_send_message';
}
