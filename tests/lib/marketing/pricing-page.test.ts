import {
  PRICING_BILLING_QUESTIONS,
  loadPricingCatalogOrNull,
  pricingFaqJsonLd,
} from '@/lib/marketing/pricing-page';
import type { PricingCatalog } from '@/lib/subscription/pricing-catalog';

it('has the six billing questions', () => {
  expect(PRICING_BILLING_QUESTIONS.map((q) => q.id)).toEqual(
    ['free-plan', 'how-to-pay', 'change-plan', 'plan-ends', 'gst-on-price', 'refund']);
});
it('never states a price or a limit in text', () => {
  for (const q of PRICING_BILLING_QUESTIONS) {
    const text = `${q.question} ${q.answer}`.replace('within 7 days', '');
    expect(text).not.toMatch(/₹|Rs\.?|\d/);
    expect(text).not.toMatch(/—|undefined/);
  }
});
it('sends refund questions to the refund policy', () => {
  const refund = PRICING_BILLING_QUESTIONS.find((q) => q.id === 'refund')!;
  expect(refund.answer).toContain('within 7 days');
  expect(refund.answer).toContain('](/refund-policy)');
});
it('returns null when the catalogue fails to load, and the catalogue when it loads', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(loadPricingCatalogOrNull(async () => { throw new Error('db down'); })).resolves.toBeNull();
  const catalog = { plans: [] } as unknown as PricingCatalog;
  await expect(loadPricingCatalogOrNull(async () => catalog)).resolves.toBe(catalog);
  spy.mockRestore();
});
it('builds FAQ data without link markup', () => {
  const ld = pricingFaqJsonLd(PRICING_BILLING_QUESTIONS) as any;
  expect(ld['@type']).toBe('FAQPage');
  expect(ld.mainEntity).toHaveLength(6);
  expect(JSON.stringify(ld)).not.toMatch(/\]\(/);
});
