jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  queryRows: jest.fn(),
}));
jest.mock('@/lib/subscription', () => ({
  getBusinessSubscription: jest.fn(),
  checkLimit: jest.fn(),
}));
jest.mock('@/lib/platform-email', () => ({
  sendPlatformEmail: jest.fn(),
}));
jest.mock('@/lib/platform-whatsapp-send', () => ({
  lookupTenantWhatsAppPhone: jest.fn(),
  sendPlatformEventWhatsApp: jest.fn(),
}));

import { query, queryOne, queryRows } from '@/lib/db';
import { sendPlatformEmail } from '@/lib/platform-email';
import { lookupTenantWhatsAppPhone, sendPlatformEventWhatsApp } from '@/lib/platform-whatsapp-send';
import {
  sendPendingNotifications,
  sendTrialExpiringEmail,
} from '@/lib/subscription/notifications';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;
const mockQueryRows = queryRows as jest.Mock;
const mockEmail = sendPlatformEmail as jest.Mock;
const mockLookupPhone = lookupTenantWhatsAppPhone as jest.Mock;
const mockWhatsApp = sendPlatformEventWhatsApp as jest.Mock;

const BIZ = '11111111-1111-4111-8111-111111111111';

/** Phone-only signup: business has no email, admin has no email. */
function phoneOnlyBusiness() {
  mockQueryOne.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM subscription_notifications')) return null;
    if (sql.includes('FROM businesses')) return { email: null, name: 'Test Traders' };
    if (sql.includes('FROM users')) return null;
    return null;
  });
}

function loggedChannels(): unknown[] {
  const logCall = mockQuery.mock.calls.find(([sql]) =>
    String(sql).includes('INSERT INTO subscription_notifications'),
  );
  if (!logCall) return [];
  return JSON.parse(logCall[1][2]).channels;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  mockEmail.mockResolvedValue(true);
});

describe('trial reminder delivery', () => {
  it('reaches a phone-only business through in-app and WhatsApp, and logs those channels', async () => {
    phoneOnlyBusiness();
    mockLookupPhone.mockResolvedValue('7769870606');
    mockWhatsApp.mockResolvedValue({ sent: true, skipped: null });

    const delivered = await sendTrialExpiringEmail(BIZ, 3);

    expect(delivered).toBe(true);
    expect(mockEmail).not.toHaveBeenCalled();
    expect(mockWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'trial_ending', toPhone: '7769870606' }),
    );
    const inApp = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO notifications'));
    expect(inApp?.[1]).toEqual([BIZ, 'Your trial ends in 3 days', expect.any(String)]);
    expect(loggedChannels()).toEqual(['whatsapp', 'in_app']);
  });

  it('does not log or count a reminder when no channel delivered', async () => {
    phoneOnlyBusiness();
    mockLookupPhone.mockResolvedValue('7769870606');
    mockWhatsApp.mockResolvedValue({ sent: false, skipped: 'NO_APPROVED_TEMPLATE' });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO notifications')) throw new Error('db down');
      return { rows: [], rowCount: 1 };
    });

    const delivered = await sendTrialExpiringEmail(BIZ, 7);

    expect(delivered).toBe(false);
    expect(loggedChannels()).toEqual([]);
  });

  it('skips a reminder already sent today', async () => {
    mockQueryOne.mockImplementation(async (sql: string) =>
      sql.includes('FROM subscription_notifications') ? { id: 'x' } : null,
    );

    expect(await sendTrialExpiringEmail(BIZ, 1)).toBe(false);
    expect(mockWhatsApp).not.toHaveBeenCalled();
  });

  it('cron count reflects only delivered reminders', async () => {
    phoneOnlyBusiness();
    mockLookupPhone.mockResolvedValue(null);
    mockQueryRows.mockImplementation(async (sql: string) => {
      if (sql.includes('IN (7, 3, 1)')) {
        return [
          { business_id: BIZ, days_remaining: 3 },
          { business_id: '22222222-2222-4222-8222-222222222222', days_remaining: 1 },
        ];
      }
      return [];
    });
    let inAppCalls = 0;
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO notifications')) {
        inAppCalls += 1;
        if (inAppCalls === 2) throw new Error('insert failed');
      }
      return { rows: [], rowCount: 1 };
    });

    expect(await sendPendingNotifications()).toBe(1);
  });
});
