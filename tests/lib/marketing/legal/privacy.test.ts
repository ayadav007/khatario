import { privacyPolicy } from '@/lib/marketing/legal/privacy';
import { blank, expectCleanLegalDocument, filledAll } from './legal-checks';

it('reads cleanly with blank and with filled facts', () => {
  expectCleanLegalDocument(privacyPolicy(blank));
  expectCleanLegalDocument(privacyPolicy(filledAll));
});
it('has the agreed sections in order', () => {
  expect(privacyPolicy(blank).sections.map((s) => s.id)).toEqual([
    'who-we-are', 'what-we-collect', 'why-we-use-it', 'who-we-share-with', 'your-customers-data',
    'retention-and-deletion', 'your-rights', 'cookies', 'children', 'changes', 'grievance-officer']);
});
it('names the company and officer only when set', () => {
  expect(JSON.stringify(privacyPolicy(blank))).not.toMatch(/Pvt Ltd/);
  const text = JSON.stringify(privacyPolicy(filledAll));
  expect(text).toContain('Khatario Tech Pvt Ltd');
  expect(text).toContain('Asha Verma');
  expect(text).toContain('grievance@khatario.com');
});
it('falls back to the support email for grievances and states the timelines', () => {
  const text = JSON.stringify(privacyPolicy(blank));
  expect(text).toContain('help@khatario.com');
  expect(text).toMatch(/48 hours/);
  expect(text).toMatch(/15 days/);
  expect(text).toMatch(/Digital Personal Data Protection Act, 2023/);
});
it('says card numbers never reach Khatario and names no unproven provider', () => {
  const text = JSON.stringify(privacyPolicy(blank));
  expect(text).toMatch(/card number/i);
  expect(text).not.toMatch(/OpenAI|Anthropic|MSG91|Twilio|Google Analytics|Clarity|\bSMS\b/);
});
it('shows no blank officer or address label when facts are blank', () => {
  const officer = JSON.stringify(privacyPolicy(blank).sections.find((s) => s.id === 'grievance-officer'));
  expect(officer).not.toMatch(/Name:|Address:|registered office/i);
});
