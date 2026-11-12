import { loadPricingCatalog, type PricingCatalog } from '@/lib/subscription/pricing-catalog';
import { splitLegalLinks } from '@/lib/marketing/legal/links';

export type BillingQuestion = { id: string; question: string; answer: string }; // answer may hold [label](/path) links

/** No prices or limits here: the plan cards above the questions carry those from the live catalogue. */
export const PRICING_BILLING_QUESTIONS: BillingQuestion[] = [
  {
    id: 'free-plan',
    question: 'Is there a free plan?',
    answer:
      'Yes. The free plan works in the Khatario phone app, and you can stay on it as long as you like. Move to a paid plan when the shop needs more.',
  },
  {
    id: 'how-to-pay',
    question: 'How do I pay for a paid plan?',
    answer:
      'You pay online with UPI or card when you pick a paid plan. The plan starts right after the payment goes through.',
  },
  {
    id: 'change-plan',
    question: 'Can I change my plan later?',
    answer:
      'Yes. You can move up to a bigger plan from your account settings, and it works right after payment. A move to a smaller plan starts when your current paid period ends.',
  },
  {
    id: 'plan-ends',
    question: 'What happens when my plan ends?',
    answer:
      'If you do not renew, you get a short grace period. After that your account moves to the free plan. If you cancel, the plan keeps running until the end of the period you paid for.',
  },
  {
    id: 'gst-on-price',
    question: 'Is GST added to the plan price?',
    answer:
      'Please ask our team before you pay and they will tell you what applies to your plan. You can reach them on the [contact page](/contact).',
  },
  {
    id: 'refund',
    question: 'Can I get a refund?',
    answer:
      'Yes, if you ask within 7 days of your first payment, you get a full refund of the plan fee. Renewals are not refunded, but you can cancel any time and the plan runs to the end of the period you paid for. Read the full [refund policy](/refund-policy).',
  },
];

/** Loads the live plan catalogue for the page; null lets the pricing section fetch it in the browser. */
export async function loadPricingCatalogOrNull(
  load: () => Promise<PricingCatalog> = loadPricingCatalog,
): Promise<PricingCatalog | null> {
  try {
    return await load();
  } catch (error) {
    console.error('Pricing page plans failed to load:', error);
    return null;
  }
}

function plainText(text: string): string {
  return splitLegalLinks(text)
    .map((p) => (typeof p === 'string' ? p : p.label))
    .join('');
}

export function pricingFaqJsonLd(questions: BillingQuestion[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: { '@type': 'Answer', text: plainText(q.answer) },
    })),
  };
}
