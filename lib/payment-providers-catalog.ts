/**
 * Payment providers available for in-app configuration (DB + encryption).
 * Server and client can import the static catalog; status comes from the API.
 */

/** Form fields POSTed as `client_id`, `client_secret`, `environment` (sandbox | production). */
export type PaymentProviderFieldDef =
  | {
      key: 'client_id';
      label: string;
      type: 'text';
      placeholderNew: string;
      placeholderConfigured: string;
    }
  | {
      key: 'client_secret';
      label: string;
      type: 'password';
      placeholderNew: string;
      placeholderConfigured: string;
      /** Optional muted hint below the password field */
      hint?: string;
    }
  | {
      key: 'environment';
      label: string;
      type: 'select';
      options: Array<{ value: 'sandbox' | 'production'; label: string }>;
    };

export type PaymentProviderCatalogEntry = {
  id: string;
  displayName: string;
  description: string;
  /**
   * When `false`, hidden from payment provider settings and listing APIs.
   * Omitted or `true` = shown (backward compatible).
   */
  supported?: boolean;
  fields: PaymentProviderFieldDef[];
  /** Copy in the connected-summary strip (masked id / secret status) */
  summary?: {
    clientIdCaption: string;
    secretCaption: string;
  };
  /** Optional webhook URL callout (PSP dashboard configuration). */
  webhookUrl?: {
    pathSegment: string;
    title: string;
    hint?: string;
  };
  saveButtonLabel: string;
  saveButtonVariant: 'primary' | 'secondary';
};

export const PAYMENT_PROVIDER_CATALOG: PaymentProviderCatalogEntry[] = [
  {
    id: 'cashfree',
    displayName: 'Cashfree',
    description:
      'UPI collect and online payments via Cashfree Payment Gateway.',
    summary: {
      clientIdCaption: 'Saved client ID:',
      secretCaption: 'Secret:',
    },
    fields: [
      {
        key: 'client_id',
        label: 'Client ID (App ID)',
        type: 'text',
        placeholderNew: 'Cashfree App / Client ID',
        placeholderConfigured: 'Leave blank to keep existing client ID',
      },
      {
        key: 'client_secret',
        label: 'Client secret',
        type: 'password',
        placeholderNew: 'Secret key',
        placeholderConfigured: 'Leave blank to keep existing secret',
        hint: 'Stored encrypted. Never shown after save.',
      },
      {
        key: 'environment',
        label: 'Environment',
        type: 'select',
        options: [
          { value: 'sandbox', label: 'Sandbox (test)' },
          { value: 'production', label: 'Production (live)' },
        ],
      },
    ],
    saveButtonLabel: 'Save configuration',
    saveButtonVariant: 'primary',
  },
  {
    id: 'razorpay',
    displayName: 'Razorpay',
    description:
      'Hosted payment links via Razorpay (Key Id + Key Secret stored encrypted per business).',
    summary: {
      clientIdCaption: 'Saved Key Id:',
      secretCaption: 'Key secret:',
    },
    webhookUrl: {
      pathSegment: 'razorpay',
      title: 'Webhook URL (Razorpay Dashboard)',
      hint:
        'Use this exact URL — it must be reachable without logging in. Use your stored Key secret for webhook signing. Allowlist your app domain for Payment Link redirects too (customers land on …/pay/complete after UPI).',
    },
    fields: [
      {
        key: 'client_id',
        label: 'Key Id',
        type: 'text',
        placeholderNew: 'rzp_test_… or rzp_live_…',
        placeholderConfigured: 'Leave blank to keep existing Key Id',
      },
      {
        key: 'client_secret',
        label: 'Key secret',
        type: 'password',
        placeholderNew: 'From Razorpay Dashboard → API Keys',
        placeholderConfigured: 'Leave blank to keep existing secret',
        hint:
          "Stored encrypted. Webhook HMAC uses this secret unless you rely on Razorpay's separate webhook secret (same value is accepted by our integration).",
      },
      {
        key: 'environment',
        label: 'Mode',
        type: 'select',
        options: [
          { value: 'sandbox', label: 'Test mode (rzp_test_* keys)' },
          { value: 'production', label: 'Live mode (rzp_live_* keys)' },
        ],
      },
    ],
    saveButtonLabel: 'Save Razorpay configuration',
    saveButtonVariant: 'secondary',
  },
  {
    id: 'payu',
    displayName: 'PayU',
    description:
      'PayU payment gateway — Merchant Key and Salt stored encrypted per business.',
    summary: {
      clientIdCaption: 'Saved Merchant Key:',
      secretCaption: 'Merchant Salt:',
    },
    fields: [
      {
        key: 'client_id',
        label: 'Merchant Key',
        type: 'text',
        placeholderNew: 'PayU Merchant Key',
        placeholderConfigured: 'Leave blank to keep existing Merchant Key',
      },
      {
        key: 'client_secret',
        label: 'Merchant Salt',
        type: 'password',
        placeholderNew: 'PayU Merchant Salt',
        placeholderConfigured: 'Leave blank to keep existing Merchant Salt',
        hint: 'Stored encrypted. Never shown after save.',
      },
      {
        key: 'environment',
        label: 'Environment',
        type: 'select',
        options: [
          { value: 'sandbox', label: 'Sandbox (test)' },
          { value: 'production', label: 'Production (live)' },
        ],
      },
    ],
    saveButtonLabel: 'Save PayU configuration',
    saveButtonVariant: 'secondary',
  },
  {
    id: 'phonepe',
    supported: true,
    displayName: 'PhonePe Business',
    description:
      'PhonePe for Business — Merchant ID and API Key stored encrypted per business.',
    summary: {
      clientIdCaption: 'Saved Merchant ID:',
      secretCaption: 'API Key:',
    },
    fields: [
      {
        key: 'client_id',
        label: 'Merchant ID',
        type: 'text',
        placeholderNew: 'PhonePe Merchant ID',
        placeholderConfigured: 'Leave blank to keep existing Merchant ID',
      },
      {
        key: 'client_secret',
        label: 'API Key',
        type: 'password',
        placeholderNew: 'PhonePe API Key',
        placeholderConfigured: 'Leave blank to keep existing API Key',
        hint: 'Stored encrypted. Never shown after save.',
      },
      {
        key: 'environment',
        label: 'Environment',
        type: 'select',
        options: [
          { value: 'sandbox', label: 'Sandbox (test)' },
          { value: 'production', label: 'Production (live)' },
        ],
      },
    ],
    saveButtonLabel: 'Save PhonePe configuration',
    saveButtonVariant: 'secondary',
  },
  {
    id: 'instamojo',
    supported: true,
    displayName: 'Instamojo',
    description:
      'Instamojo — API Key and Auth Token stored encrypted per business.',
    summary: {
      clientIdCaption: 'Saved API Key:',
      secretCaption: 'Auth token:',
    },
    fields: [
      {
        key: 'client_id',
        label: 'API Key',
        type: 'text',
        placeholderNew: 'Instamojo API Key',
        placeholderConfigured: 'Leave blank to keep existing API Key',
      },
      {
        key: 'client_secret',
        label: 'Auth Token',
        type: 'password',
        placeholderNew: 'Instamojo Auth Token',
        placeholderConfigured: 'Leave blank to keep existing Auth Token',
        hint: 'Stored encrypted. Never shown after save.',
      },
      {
        key: 'environment',
        label: 'Environment',
        type: 'select',
        options: [
          { value: 'sandbox', label: 'Sandbox (test)' },
          { value: 'production', label: 'Production (live)' },
        ],
      },
    ],
    saveButtonLabel: 'Save Instamojo configuration',
    saveButtonVariant: 'secondary',
  },
];

/** Catalog entries eligible for in-app configuration (excludes `supported: false`). */
export function getSupportedPaymentProviderCatalog(): PaymentProviderCatalogEntry[] {
  return PAYMENT_PROVIDER_CATALOG.filter((p) => p.supported !== false);
}

export function isSupportedPaymentProviderId(id: string): boolean {
  return getSupportedPaymentProviderCatalog().some(
    (p) => p.id === id.toLowerCase()
  );
}

export function isKnownPaymentProviderId(id: string): boolean {
  return PAYMENT_PROVIDER_CATALOG.some((p) => p.id === id.toLowerCase());
}
