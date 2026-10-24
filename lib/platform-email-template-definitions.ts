/**
 * Platform email template metadata (client-safe — no DB).
 */

export type PlatformTemplateId =
  | 'welcome'
  | 'admin_new_signup'
  | 'payment_success'
  | 'payment_failed'
  | 'subscription_upgraded';

export interface TemplateDefinition {
  id: PlatformTemplateId;
  label: string;
  defaultSubject: string;
  defaultBodyHtml: string;
}

export type StoredEmailTemplate = {
  label?: string;
  subject?: string;
  body_html?: string;
};

export const PLATFORM_TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    id: 'welcome',
    label: 'Welcome (new signup)',
    defaultSubject: 'Welcome to Khatario, {{businessName}}!',
    defaultBodyHtml: `<p>Hi {{userName}},</p>
<p>Your account for <strong>{{businessName}}</strong> is ready.</p>
<p>{{trialLine}}</p>
<p>Sign in anytime to start billing, inventory, and GST workflows.</p>
<p><a href="{{appUrl}}/login">Sign in to Khatario</a></p>
<p>Need help? Email us at <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>.</p>`,
  },
  {
    id: 'admin_new_signup',
    label: 'Admin alert — new business',
    defaultSubject: '[Khatario Admin] New signup: {{businessName}}',
    defaultBodyHtml: `<p>A new business registered on Khatario.</p>
<ul>
  <li><strong>Business:</strong> {{businessName}}</li>
  <li><strong>Contact:</strong> {{userName}} ({{userPhone}})</li>
  <li><strong>Email:</strong> {{businessEmail}}</li>
  <li><strong>Plan:</strong> {{planLabel}}</li>
</ul>
<p><a href="{{appUrl}}/admin/businesses">View in admin panel</a></p>`,
  },
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

export const SYSTEM_TEMPLATE_IDS: PlatformTemplateId[] = PLATFORM_TEMPLATE_DEFINITIONS.map(
  (d) => d.id,
);

export function isSystemTemplateId(id: string): id is PlatformTemplateId {
  return SYSTEM_TEMPLATE_IDS.includes(id as PlatformTemplateId);
}

export function isAllowedTemplateId(id: string): boolean {
  if (isSystemTemplateId(id)) return true;
  return /^custom_[a-zA-Z0-9-]{1,80}$/.test(id);
}
