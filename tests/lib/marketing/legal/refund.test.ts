import { refundPolicy } from '@/lib/marketing/legal/refund';
import { formatLegalDate } from '@/lib/marketing/legal/types';
import { blank, expectCleanLegalDocument, filledAll } from './legal-checks';

it('reads cleanly with blank and with filled facts', () => {
  expectCleanLegalDocument(refundPolicy(blank));
  expectCleanLegalDocument(refundPolicy(filledAll));
});
it('states the refund rule', () => {
  const text = JSON.stringify(refundPolicy(blank));
  expect(text).toMatch(/within 7 days/);
  expect(text).toMatch(/first payment/);
  expect(text).toMatch(/renewal/i);
  expect(text).toMatch(/5 to 7 working days/);
  expect(text).toContain('help@khatario.com');
  expect(text).toMatch(/cancel any time/i);
  expect(text).toContain('your plan stays active until the end of the period you have paid for');
  expect(text).not.toMatch(/reason/);
});
it('has the agreed sections in order', () => {
  expect(refundPolicy(blank).sections.map((s) => s.id)).toEqual(
    ['seven-day-refund', 'not-refunded', 'cancelling', 'how-to-ask', 'timing', 'free-plan', 'contact']);
});
it('formats the date', () => expect(formatLegalDate('2026-11-12')).toBe('12 November 2026'));
