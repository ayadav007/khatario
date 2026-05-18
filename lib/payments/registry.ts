import type { PaymentProvider, PaymentProviderConfig } from './types';
import { MockPaymentProvider } from './providers/mock-payment-provider';
import { CashfreePaymentProvider } from './providers/cashfree-payment-provider';
import { RazorpayPaymentProvider } from './providers/razorpay-payment-provider';
import { PayuPaymentProvider } from './providers/payu-payment-provider';
import { PhonePePaymentProvider } from './providers/phonepe-payment-provider';
import { InstamojoPaymentProvider } from './providers/instamojo-payment-provider';
import {
  mergePaymentProviderConfigWithEnv,
  resolvePaymentProviderConfigForBusiness,
} from './business-provider-config';

export type PaymentProviderFactory = (config: PaymentProviderConfig) => PaymentProvider;

const factories = new Map<string, PaymentProviderFactory>();

/**
 * Register a PSP factory at runtime (e.g. from a plugin or test).
 * Later registrations override earlier ones for the same id.
 */
export function registerPaymentProviderFactory(
  id: string,
  factory: PaymentProviderFactory
): void {
  factories.set(id.toLowerCase(), factory);
}

export function getRegisteredProviderIds(): string[] {
  return Array.from(factories.keys());
}

/**
 * Build a provider instance. Unknown id throws.
 * Fills missing credential fields from process.env for the given provider (see getEnvPaymentProviderFallback).
 */
export function createPaymentProvider(
  id: string,
  config: PaymentProviderConfig = {}
): PaymentProvider {
  const factory = factories.get(id.toLowerCase());
  if (!factory) {
    throw new Error(
      `Unknown payment provider "${id}". Registered: ${getRegisteredProviderIds().join(', ') || '(none)'}`
    );
  }
  const merged = mergePaymentProviderConfigWithEnv(id, config);
  return factory(merged);
}

/**
 * Resolve DB-backed credentials for the business, then ENV fallback, then optional override.
 * Use from API routes instead of passing secrets from the client.
 */
export async function createPaymentProviderForBusiness(
  businessId: string,
  providerId: string,
  configOverride: PaymentProviderConfig = {}
): Promise<PaymentProvider> {
  const base = await resolvePaymentProviderConfigForBusiness(
    businessId,
    providerId.toLowerCase()
  );
  return createPaymentProvider(providerId, { ...base, ...configOverride });
}

/** Default registrations — safe to call multiple times */
export function registerBuiltinPaymentProviders(): void {
  registerPaymentProviderFactory('mock', () => new MockPaymentProvider());
  registerPaymentProviderFactory(
    'cashfree',
    (config) => new CashfreePaymentProvider(config)
  );
  registerPaymentProviderFactory(
    'razorpay',
    (config) => new RazorpayPaymentProvider(config)
  );
  registerPaymentProviderFactory(
    'payu',
    (config) => new PayuPaymentProvider(config)
  );
  registerPaymentProviderFactory(
    'phonepe',
    (config) => new PhonePePaymentProvider(config)
  );
  registerPaymentProviderFactory(
    'instamojo',
    (config) => new InstamojoPaymentProvider(config)
  );
}

registerBuiltinPaymentProviders();
