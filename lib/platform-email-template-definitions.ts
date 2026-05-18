/**
 * Platform email template metadata (client-safe — no DB).
 */

export type PlatformTemplateId =
  | 'payment_success'
  | 'payment_failed'
  | 'subscription_upgraded';

export interface TemplateDefinition {
  id: PlatformTemplateId;
  label: string;
  defaultSubject: string;
  defaultBodyHtml: string;
}

export const PLATFORM_TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    id: 'payment_success',
    label: 'Payment received (tenant)',
    defaultSubject: '[Khatario] Payment received — {{planName}}',
    defaultBodyHtml: `
      <p>Hi,</p>
      <p>We received your payment of <strong>₹{{amount}}</strong> for <strong>{{planName}}</strong> ({{billingCycle}}).</p>
      <p>Reference: {{paymentReference}}</p>
      <p><a href="{{appUrl}}/settings/subscription" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">View subscription</a></p>
    `,
  },
  {
    id: 'payment_failed',
    label: 'Payment failed (tenant)',
    defaultSubject: '[Khatario] Payment failed — action required',
    defaultBodyHtml: `
      <p>Hi,</p>
      <p>Your subscription payment for <strong>{{planName}}</strong> could not be completed.</p>
      <p>{{reason}}</p>
      <p><a href="{{appUrl}}/settings/subscription" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">Update payment</a></p>
    `,
  },
  {
    id: 'subscription_upgraded',
    label: 'Plan changed (tenant)',
    defaultSubject: '[Khatario] Your plan is now {{planName}}',
    defaultBodyHtml: `
      <p>Hi,</p>
      <p><strong>{{businessName}}</strong> is now on the <strong>{{planName}}</strong> plan ({{billingCycle}}).</p>
      <p><a href="{{appUrl}}/settings/subscription" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">View subscription</a></p>
    `,
  },
];
