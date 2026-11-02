/** A used-up daily email limit comes back as a limit result, so routes can answer with the upgrade reply. */
const mockCheckLimit = jest.fn();
jest.mock('@/lib/subscription', () => ({ checkLimit: (...a: unknown[]) => mockCheckLimit(...a) }));
jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn() }));
jest.mock('@/lib/secret-encryption', () => ({ decryptSecret: jest.fn(), encryptSecret: jest.fn() }));
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

import { sendBusinessEmail } from '@/lib/business-email';

it('reports the email limit with the standard code', async () => {
  mockCheckLimit.mockResolvedValue({ allowed: false, limit: 10, current: 10, message: 'Daily email limit reached' });
  const result = await sendBusinessEmail('b', { to: 'a@b.in', subject: 's', html: '<p>x</p>' });
  expect(result).toMatchObject({ success: false, code: 'SUBSCRIPTION_LIMIT_EXCEEDED', limit: 10, current: 10 });
});
