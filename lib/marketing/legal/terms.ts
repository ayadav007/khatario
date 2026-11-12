// Product facts used below, each confirmed from the code:
// Data export: app/(app)/settings/export redirects to app/(app)/settings/backup/page.tsx ("Backup & restore", downloads a full backup file).
// Plan payments through a payment gateway: lib/platform-subscription-checkout.ts (Razorpay or Easebuzz).
// Unpaid renewal: grace period, then the free plan; no data is deleted: lib/subscription/lifecycle.ts (processExpiredModuleSubscriptions), lib/subscription/module-plan-lifecycle.ts.
// Cancel at period end: lib/subscription/lifecycle.ts (cancel_at_period_end); Settings, Subscription path as in lib/marketing/legal/refund.ts.
// WhatsApp unsubscribes are recorded: app/api/whatsapp/unsubscribes/route.ts, lib/whatsapp/who-to-message.ts.

import { addressLines, companyName, fact } from '@/lib/marketing/company-facts';
import type { LegalContext, LegalDocumentData } from './types';

export function termsOfService(ctx: LegalContext): LegalDocumentData {
  const name = companyName(ctx.facts);
  const isLegalName = fact('legalName', ctx.facts) !== null;
  const address = addressLines(ctx.facts);
  const city = fact('jurisdictionCity', ctx.facts);
  const mail = `[${ctx.supportEmail}](mailto:${ctx.supportEmail})`;

  const acceptance = [
    'These terms apply when you use Khatario, on our website or in our apps. By creating an account or using Khatario, you agree to them.',
    isLegalName
      ? `In these terms, "we" and "us" mean ${name}, the company that runs Khatario. "You" means the business that uses Khatario.`
      : 'In these terms, "we" and "us" mean Khatario. "You" means the business that uses Khatario.',
    'If you accept these terms for a business, you confirm that you are allowed to act for that business.',
  ];

  const contact = [`Write to us at ${mail}, or see our [contact page](/contact) for other ways to reach us.`];
  if (address.length > 0) contact.push(`Our registered office is at ${address.join(', ')}.`);

  return {
    updatedOn: '2026-11-12',
    sections: [
      { id: 'acceptance', heading: 'Accepting these terms', paragraphs: acceptance },
      {
        id: 'your-account',
        heading: 'Your account',
        bullets: [
          'Each Khatario business has one owner. The owner is responsible for the account and for everything done in it.',
          'Give correct details when you sign up, and keep them up to date.',
          'Keep your password and login codes safe. Do not share them with anyone.',
          'You decide which staff can use your account and what each role can see and do. You are responsible for what they do in it.',
          `If you think someone has got into your account without your permission, tell us at once at ${mail}.`,
        ],
      },
      {
        id: 'plans-and-payments',
        heading: 'Plans, payments and renewal',
        bullets: [
          'Khatario has a free plan and paid plans. The current plans and prices are on our [pricing page](/pricing) and in the app.',
          'Paid plans are paid in advance for the period you choose, through our payment gateway.',
          'To keep a paid plan, renew it before the period ends. If a renewal is not paid, your business gets a short grace period and then moves to the free plan. Your data is not deleted.',
          'We may change plan prices. A new price applies from your next renewal, not to a period you have already paid for.',
        ],
      },
      {
        id: 'refunds',
        heading: 'Refunds and cancelling',
        paragraphs: [
          "You get a full refund of the plan fee if you ask within 7 days of your business's first payment. There is no refund on renewals.",
          'You can cancel any time. Your plan stays active until the end of the period you have paid for.',
          'The full rules are in our [refund policy](/refund-policy).',
        ],
      },
      {
        id: 'acceptable-use',
        heading: 'Acceptable use',
        paragraphs: ['You agree not to use Khatario to:'],
        bullets: [
          'Make false or unlawful bills, such as bills for goods or services that were never supplied.',
          'Break any law, including tax, consumer and data protection law.',
          'Send spam on WhatsApp. Message only people who have agreed to hear from you, and stop when they ask you to.',
          "Break Meta's WhatsApp Business policies. If Meta blocks your WhatsApp number, we cannot undo it.",
          'Upload anything harmful, such as viruses, or anything you do not have the right to share.',
          'Try to get into other businesses\' data, overload our servers or get around the limits of your plan.',
          'Copy, resell or rent out Khatario without our written permission.',
        ],
      },
      {
        id: 'your-data',
        heading: 'Your data',
        paragraphs: [
          'The data you put into Khatario belongs to your business. We use it only to run Khatario for you, as our [privacy policy](/privacy) explains.',
          'You can download a full copy of your business data at any time from Settings, then Backup and restore.',
          'You are responsible for having the right to the data you add, including your customers\' and staff\'s details.',
        ],
      },
      {
        id: 'online-store',
        heading: 'Your online store',
        paragraphs: [
          'If you sell through a Khatario online store, you are the seller, not Khatario. You are responsible for your products, prices, delivery, returns, refunds and the taxes on your sales, and for your store\'s own policies.',
          'Khatario provides the software for your store. We are not a party to the sale between you and your customer.',
        ],
      },
      {
        id: 'tax-responsibility',
        heading: 'GST and tax',
        paragraphs: [
          'Khatario helps you prepare GST bills and GST reports. You are responsible for checking them and for what you file with the tax department.',
          'Khatario does not give tax or legal advice. Please check with your CA or tax adviser when you are not sure.',
        ],
      },
      {
        id: 'availability',
        heading: 'Availability and changes to Khatario',
        paragraphs: [
          'We work to keep Khatario running at all times, but we do not guarantee uninterrupted service. It may sometimes be slow or unavailable, for example during maintenance or because of a problem with our providers or your internet connection.',
          'We keep improving Khatario, so we may add, change or remove features. If we remove a main feature of a paid plan, we will tell you in advance.',
        ],
      },
      {
        id: 'liability',
        heading: 'Limits on our responsibility',
        paragraphs: [
          'Khatario is provided as it is. We are not responsible for indirect losses, such as lost profit, lost business or lost goodwill, or for losses caused by wrong data entered in your account.',
          'As far as the law allows, our total responsibility for any claim is limited to the amount you paid us for Khatario in the 12 months before the claim.',
          'Nothing in these terms limits any responsibility that the law does not allow us to limit.',
        ],
      },
      {
        id: 'suspension',
        heading: 'Suspension and closing an account',
        paragraphs: [
          'We may suspend or close an account that breaks these terms, harms other people or Khatario, or when the law requires it. Where we can, we will tell you first and give you a chance to fix the problem.',
          `You can stop using Khatario at any time. To close your account and delete your data, write to the grievance officer named in our [privacy policy](/privacy#grievance-officer). Download a copy of your data first, because deleted data cannot be brought back.`,
        ],
      },
      {
        id: 'governing-law',
        heading: 'Governing law',
        paragraphs: [
          city
            ? `These terms are governed by the laws of India. Any dispute about them is subject to the courts at ${city}.`
            : 'These terms are governed by the laws of India. Any dispute about them is subject to the courts of India.',
        ],
      },
      {
        id: 'changes',
        heading: 'Changes to these terms',
        paragraphs: [
          'We may update these terms. We will post the new version on this page with a new date. If a change is important, we will also tell you in the app or by email before it applies. If you keep using Khatario after that, you accept the new terms.',
        ],
      },
      { id: 'contact', heading: 'Contact', paragraphs: contact },
    ],
  };
}
