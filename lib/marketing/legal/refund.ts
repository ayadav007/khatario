import type { LegalContext, LegalDocumentData } from './types';

export function refundPolicy(ctx: LegalContext): LegalDocumentData {
  const mail = `[${ctx.supportEmail}](mailto:${ctx.supportEmail})`;
  return {
    updatedOn: '2026-11-12',
    sections: [
      {
        id: 'seven-day-refund',
        heading: 'Full refund within 7 days of your first payment',
        paragraphs: [
          "If you ask within 7 days of your business's first payment on Khatario, we refund the full plan fee.",
        ],
      },
      {
        id: 'not-refunded',
        heading: 'What is not refunded',
        paragraphs: ['Even within 7 days, we do not refund:'],
        bullets: [
          'Renewals. Once a plan has renewed, that payment is not refunded.',
          'A first payment that is more than 7 days old.',
          'WhatsApp message charges and other usage that has already been consumed.',
          'Add-on services that have already been delivered.',
        ],
      },
      {
        id: 'cancelling',
        heading: 'Cancelling your plan',
        paragraphs: [
          'You can cancel any time. In the app, go to Settings, then Subscription. You can also write to support and we will cancel it for you.',
          'After you cancel, your plan stays active until the end of the period you have paid for. It will not renew.',
        ],
      },
      {
        id: 'how-to-ask',
        heading: 'How to ask for a refund',
        paragraphs: [
          `Email ${mail} from the email address registered with your Khatario account, or tell us the mobile number registered with it. Please send your business name and the date of your payment.`,
        ],
      },
      {
        id: 'timing',
        heading: 'How long a refund takes',
        paragraphs: ['An approved refund reaches your original payment method in 5 to 7 working days.'],
      },
      {
        id: 'free-plan',
        heading: 'Free plan',
        paragraphs: ['The free plan costs nothing, so there is nothing to refund.'],
      },
      {
        id: 'contact',
        heading: 'Questions',
        paragraphs: [`Write to us at ${mail}, or see our [contact page](/contact) for other ways to reach us.`],
      },
    ],
  };
}
