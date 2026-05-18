/**
 * Payment Service
 * Handles payment link generation (UPI, bank transfer, etc.)
 */

import { queryOne } from '@/lib/db';
import { createPaymentProviderForBusiness, listBusinessPaymentProviderIds } from '@/lib/payments';
import type { CreateUpiCollectResult } from '@/lib/payments/types';
import {
  createPaymentTransaction,
  getSuccessfulPaymentsSumForOrder,
  PAYMENT_AMOUNT_EPS,
  remainingOrderAmountAfterSuccessSum,
  type PaymentTransactionMethod,
} from '@/lib/services/payment-transactions';
import { getPaymentLinkCallbackUrl } from '@/lib/payments/payment-link-callback';

function resolveHostedCheckoutReturnUrl(options: PaymentLinkOptions): string | undefined {
  if (options.transactionNote?.startsWith('http')) {
    return options.transactionNote;
  }
  return getPaymentLinkCallbackUrl();
}

export interface PaymentMethod {
  id: string;
  business_id: string;
  method_type: 'upi' | 'bank_transfer' | 'wallet' | 'card' | 'other';
  method_name: string;
  upi_id?: string;
  bank_account_id?: string;
  wallet_provider?: string;
  account_details?: any;
  is_active: boolean;
  is_default: boolean;
  priority: number;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentLinkOptions {
  /** sales_orders.id — required for PSP hosted links so webhooks can match a transaction */
  orderId?: string;
  amount: number;
  customerName?: string;
  invoiceNumber?: string;
  transactionNote?: string;
  currency?: string;
}

/**
 * Generate UPI payment link
 */
export function generateUPIPaymentLink(
  upiId: string,
  options: PaymentLinkOptions
): string {
  const {
    amount,
    customerName = 'Customer',
    invoiceNumber,
    transactionNote,
    currency = 'INR'
  } = options;

  // UPI payment link format: upi://pay?pa=UPI_ID&pn=PAYEE_NAME&am=AMOUNT&cu=CURRENCY&tn=TRANSACTION_NOTE
  const payeeName = encodeURIComponent(customerName);
  const note = transactionNote || 
    (invoiceNumber ? `Payment for Invoice ${invoiceNumber}` : 'Payment for order');
  const transactionNoteEncoded = encodeURIComponent(note);
  
  // Format amount to 2 decimal places
  const amountStr = amount.toFixed(2);
  
  return `upi://pay?pa=${upiId}&pn=${payeeName}&am=${amountStr}&cu=${currency}&tn=${transactionNoteEncoded}`;
}

/**
 * Get default payment method for business
 */
export async function getDefaultPaymentMethod(businessId: string): Promise<PaymentMethod | null> {
  return await queryOne<PaymentMethod>(
    `SELECT * FROM payment_methods 
     WHERE business_id = $1 AND is_active = true AND is_default = true 
     LIMIT 1`,
    [businessId]
  );
}

/**
 * Get all active payment methods for business
 */
export async function getActivePaymentMethods(businessId: string): Promise<PaymentMethod[]> {
  const { queryRows } = await import('@/lib/db');
  
  return await queryRows<PaymentMethod>(
    `SELECT * FROM payment_methods 
     WHERE business_id = $1 AND is_active = true 
     ORDER BY priority ASC, created_at ASC`,
    [businessId]
  );
}

/**
 * Generate payment link using default payment method
 */
export async function generatePaymentLinkForBusiness(
  businessId: string,
  options: PaymentLinkOptions
): Promise<{ link: string; source: 'psp' | 'manual'; provider?: string; method?: PaymentMethod } | null> {
  // 1) Try PSP hosted link if a default provider is configured.
  const configuredProviders = await listBusinessPaymentProviderIds(businessId).catch(() => []);

  // Older DBs may not have `business_settings.default_payment_provider` yet.
  // Treat it as "no preference" instead of throwing and breaking WhatsApp bot replies.
  let preferred = '';
  try {
    const pref = await queryOne<{ default_payment_provider: string | null }>(
      `SELECT default_payment_provider FROM business_settings WHERE business_id = $1`,
      [businessId]
    );
    preferred = pref?.default_payment_provider?.trim()?.toLowerCase() || '';
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.includes('default_payment_provider') && msg.includes('does not exist')) {
      preferred = '';
    } else {
      // Non-fatal: continue with manual fallback.
      preferred = '';
    }
  }

  const canUsePreferred =
    preferred &&
    configuredProviders.some((p) => p.provider.toLowerCase() === preferred);

  if (canUsePreferred && options.orderId) {
    try {
      const psp = await createPaymentProviderForBusiness(businessId, preferred);
      const supportsHosted =
        typeof psp.supportsHostedPaymentLinks === 'function'
          ? psp.supportsHostedPaymentLinks()
          : typeof psp.createHostedPaymentLink === 'function';

      if (supportsHosted) {
        // Strict amount: use remaining balance (EPS) to avoid double-collect.
        const order = await queryOne<{ grand_total: string }>(
          `SELECT grand_total::text AS grand_total
           FROM sales_orders
           WHERE id = $1 AND business_id = $2`,
          [options.orderId, businessId]
        );
        if (order) {
          const grandTotal = parseFloat(order.grand_total || '0') || 0;
          const paidSum = await getSuccessfulPaymentsSumForOrder(businessId, options.orderId);
          const remaining = remainingOrderAmountAfterSuccessSum(grandTotal, paidSum);
          if (remaining > PAYMENT_AMOUNT_EPS) {
            const amount = remaining;

            const collectParams = {
              businessId,
              orderId: options.orderId,
              amount,
              currency: options.currency || 'INR',
              customerName: options.customerName,
              metadata: {
                description:
                  options.transactionNote ||
                  (options.invoiceNumber
                    ? `Payment for Invoice ${options.invoiceNumber}`
                    : `Order payment (${options.orderId.slice(0, 8)}…)`),
              },
              returnUrl: resolveHostedCheckoutReturnUrl(options),
              notifyUrl: undefined,
            };

            let collect: CreateUpiCollectResult;
            if (typeof psp.createHostedPaymentLink === 'function') {
              collect = await psp.createHostedPaymentLink(collectParams);
            } else {
              collect = await psp.createUpiCollect(collectParams);
            }

            if (collect.paymentUrl) {
              // Persist a payment_transactions row so webhook processing can match it later.
              const rawPayload: Record<string, unknown> = {
                khatario_order_id: options.orderId,
                provider_order_id:
                  collect.providerPaymentId ?? collect.paymentSessionId ?? null,
                provider_payment_id: collect.providerPaymentId ?? null,
                payment_session_id: collect.paymentSessionId ?? null,
                payment_url: collect.paymentUrl,
                collect_raw: collect.raw ?? {},
              };

              await createPaymentTransaction({
                businessId,
                orderId: options.orderId,
                provider: preferred,
                providerPaymentId: collect.providerPaymentId ?? null,
                method: 'upi_collect' as PaymentTransactionMethod,
                amount,
                currency: options.currency || 'INR',
                status: 'pending',
                rawPayload,
                syncSalesOrder: true,
              });

              return {
                link: collect.paymentUrl,
                source: 'psp',
                provider: preferred,
              };
            }
          }
        }
      }
    } catch (e) {
      // Non-fatal: fall back to manual link.
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[payments] preferred PSP hosted link failed; falling back', {
          businessId,
          preferred,
          hasOrderId: !!options.orderId,
          error: (e as any)?.message || String(e || ''),
        });
      }
    }
  }

  // 1b) Heuristic fallback: if there is exactly one configured PSP and we have an order id,
  // try it even without a preferred provider.
  if (!canUsePreferred && configuredProviders.length === 1 && options.orderId) {
    const only = String(configuredProviders[0]?.provider || '').trim().toLowerCase();
    if (only) {
      try {
        const psp = await createPaymentProviderForBusiness(businessId, only);
        const supportsHosted =
          typeof psp.supportsHostedPaymentLinks === 'function'
            ? psp.supportsHostedPaymentLinks()
            : typeof psp.createHostedPaymentLink === 'function';

        if (supportsHosted) {
          const order = await queryOne<{ grand_total: string }>(
            `SELECT grand_total::text AS grand_total
             FROM sales_orders
             WHERE id = $1 AND business_id = $2`,
            [options.orderId, businessId]
          );
          if (order) {
            const grandTotal = parseFloat(order.grand_total || '0') || 0;
            const paidSum = await getSuccessfulPaymentsSumForOrder(businessId, options.orderId);
            const remaining = remainingOrderAmountAfterSuccessSum(grandTotal, paidSum);
            if (remaining > PAYMENT_AMOUNT_EPS) {
              const amount = remaining;
              const collectParams = {
                businessId,
                orderId: options.orderId,
                amount,
                currency: options.currency || 'INR',
                customerName: options.customerName,
                metadata: {
                  description:
                    options.transactionNote ||
                    (options.invoiceNumber
                      ? `Payment for Invoice ${options.invoiceNumber}`
                      : `Order payment (${options.orderId.slice(0, 8)}…)`),
                },
                returnUrl: resolveHostedCheckoutReturnUrl(options),
                notifyUrl: undefined,
              };

              let collect: CreateUpiCollectResult;
              if (typeof psp.createHostedPaymentLink === 'function') {
                collect = await psp.createHostedPaymentLink(collectParams);
              } else {
                collect = await psp.createUpiCollect(collectParams);
              }

              if (collect.paymentUrl) {
                const rawPayload: Record<string, unknown> = {
                  khatario_order_id: options.orderId,
                  provider_order_id:
                    collect.providerPaymentId ?? collect.paymentSessionId ?? null,
                  provider_payment_id: collect.providerPaymentId ?? null,
                  payment_session_id: collect.paymentSessionId ?? null,
                  payment_url: collect.paymentUrl,
                  collect_raw: collect.raw ?? {},
                };

                await createPaymentTransaction({
                  businessId,
                  orderId: options.orderId,
                  provider: only,
                  providerPaymentId: collect.providerPaymentId ?? null,
                  method: 'upi_collect' as PaymentTransactionMethod,
                  amount,
                  currency: options.currency || 'INR',
                  status: 'pending',
                  rawPayload,
                  syncSalesOrder: true,
                });

                return { link: collect.paymentUrl, source: 'psp', provider: only };
              }
            }
          }
        }
      } catch (e) {
        // Non-fatal: fall back to manual link.
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[payments] heuristic PSP hosted link failed; falling back', {
            businessId,
            provider: only,
            hasOrderId: !!options.orderId,
            error: (e as any)?.message || String(e || ''),
          });
        }
      }
    }
  }

  // 2) Fallback: manual payment method (UPI deep link)
  const method = await getDefaultPaymentMethod(businessId);
  
  if (!method) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[payments] no default payment method; cannot build manual link', {
        businessId,
        preferred,
        configuredProviders,
        hasOrderId: !!options.orderId,
      });
    }
    return null;
  }
  
  if (method.method_type === 'upi' && method.upi_id) {
    const link = generateUPIPaymentLink(method.upi_id, options);
    return { link, source: 'manual', method };
  }
  
  // For other payment methods (bank transfer, etc.), generate appropriate link
  // This can be extended for other payment types
  return null;
}
