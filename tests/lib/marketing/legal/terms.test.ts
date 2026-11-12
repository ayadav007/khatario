import { termsOfService } from '@/lib/marketing/legal/terms';
import type { LegalContext } from '@/lib/marketing/legal/types';
import { blank, expectCleanLegalDocument, filledAll } from './legal-checks';

it('reads cleanly with blank and with filled facts', () => {
  expectCleanLegalDocument(termsOfService(blank));
  expectCleanLegalDocument(termsOfService(filledAll));
});
it('has the agreed sections in order', () => {
  expect(termsOfService(blank).sections.map((s) => s.id)).toEqual([
    'acceptance', 'your-account', 'plans-and-payments', 'refunds', 'acceptable-use', 'your-data',
    'online-store', 'tax-responsibility', 'availability', 'liability', 'suspension', 'governing-law', 'changes', 'contact']);
});
it('links refunds to the refund policy', () => {
  const refunds = termsOfService(blank).sections.find((s) => s.id === 'refunds')!;
  expect(JSON.stringify(refunds)).toContain('](/refund-policy)');
});
it('names a court city only when set', () => {
  const law = (ctx: LegalContext) => JSON.stringify(termsOfService(ctx).sections.find((s) => s.id === 'governing-law'));
  expect(law(blank)).toContain('the courts of India');
  expect(law(filledAll)).toContain('the courts at Indore');
});
it('names the company only when set and states the refund rule', () => {
  expect(JSON.stringify(termsOfService(blank))).not.toMatch(/Pvt Ltd|registered office/i);
  expect(JSON.stringify(termsOfService(filledAll))).toContain('Khatario Tech Pvt Ltd');
  const refunds = JSON.stringify(termsOfService(blank).sections.find((s) => s.id === 'refunds'));
  expect(refunds).toMatch(/within 7 days/);
  expect(refunds).toMatch(/first payment/);
  expect(refunds).toMatch(/renewal/i);
});
it('points to data export and states no plan price', () => {
  const text = JSON.stringify(termsOfService(blank));
  expect(text).toMatch(/Backup and restore/);
  expect(text).not.toMatch(/₹|Rs\.?\s?\d|INR/);
});
