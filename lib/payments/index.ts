/**
 * Payment provider abstraction — register factories and create PSP instances.
 */

export type {
  PaymentProvider,
  PaymentProviderConfig,
  CreateUpiCollectParams,
  CreateUpiCollectResult,
  CreateVirtualAccountParams,
  CreateVirtualAccountResult,
  VerifyWebhookParams,
  VerifyWebhookResult,
  WebhookPaymentStatus,
} from './types';

export {
  registerPaymentProviderFactory,
  createPaymentProvider,
  createPaymentProviderForBusiness,
  getRegisteredProviderIds,
  registerBuiltinPaymentProviders,
} from './registry';

export {
  getBusinessPaymentProviderConfig,
  getEnvPaymentProviderFallback,
  resolvePaymentProviderConfigForBusiness,
  mergePaymentProviderConfigWithEnv,
  listBusinessPaymentProviderIds,
  upsertBusinessPaymentProviderConfig,
} from './business-provider-config';

export type {
  BusinessPaymentProviderConfigRow,
  DecryptedBusinessPaymentConfig,
  UpsertBusinessPaymentProviderInput,
} from './business-provider-config';

/** Prefer `upsertBusinessPaymentProviderConfig`; raw encrypt only for trusted server scripts. */
export { encryptPaymentSecret } from './secret-encryption';

export { MockPaymentProvider } from './providers/mock-payment-provider';
export { CashfreePaymentProvider } from './providers/cashfree-payment-provider';
export { RazorpayPaymentProvider } from './providers/razorpay-payment-provider';
export { PayuPaymentProvider } from './providers/payu-payment-provider';
export { PhonePePaymentProvider } from './providers/phonepe-payment-provider';
export { InstamojoPaymentProvider } from './providers/instamojo-payment-provider';
