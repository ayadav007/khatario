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
  sendRenewalReminders,
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

describe('renewal reminders', () => {
  const row = {
    business_id: BIZ, module_key: 'billing', plan_name: 'Growth', scheduled_plan_name: null, end_date: '2026-12-04',
    end_label: '4 December 2026', grace_end: '2026-12-11', grace_label: '11 December 2026', days_left: 7,
  };
  const claimCalls = () => mockQuery.mock.calls.filter(([q]) => String(q).includes('INSERT INTO subscription_notifications'));
  function knownBusiness() {
    mockQueryOne.mockImplementation(async (sql: string) =>
      sql.includes('FROM businesses') ? { email: 'o@example.test', name: 'Test Traders' } : null);
  }

  it('selects a -1..7 day window in SQL against CURRENT_DATE, paid by price and never by plan id, excluding only free-tier schedules', async () => {
    mockQueryRows.mockResolvedValue([]);
    await sendRenewalReminders();
    const [sql, params] = mockQueryRows.mock.calls[0];
    expect(String(sql)).toContain('CURRENT_DATE');
    expect(String(sql)).toContain('BETWEEN -1 AND 7');
    expect(String(sql)).toContain("bs.status = 'active'");
    expect(String(sql)).toContain('cancel_at_period_end');
    expect(String(sql)).toMatch(/price_monthly.*price_yearly.*price_3year/s);
    expect(String(sql)).not.toMatch(/plan_id\s*(=|IN)\s*\(?'(free|billing_)/);
    expect(params[0]).toEqual(expect.arrayContaining(['free', 'hr_free', 'hr_staff_lite', 'connect_free']));
  });

  it('claims first, then sends the agreed text on email and in-app only, naming the product, and records the channels', async () => {
    knownBusiness();
    mockQueryRows.mockResolvedValue([row]);
    expect(await sendRenewalReminders()).toBe(1);

    const text = mockEmail.mock.calls[0][0].text as string;
    expect(text).toContain('Your Growth plan for Test Traders (Billing) ends on 4 December 2026. Renew before then to keep your current period running without a break. If you do nothing, you keep full access until 11 December 2026 and then move to the Free plan. Your data stays safe.');
    expect(mockEmail.mock.calls[0][0].subject).toBe('[Khatario] Your Billing plan ends in 7 days');
    expect(mockWhatsApp).not.toHaveBeenCalled();
    const claim = claimCalls()[0];
    expect(claim[1][1]).toBe('renewal_reminder_7:billing:2026-12-04');
    const finish = mockQuery.mock.calls.find(([q]) => String(q).startsWith('UPDATE subscription_notifications'))!;
    expect(JSON.parse(finish[1][2]).channels).toEqual(['email', 'in_app']);
  });

  it('sends nothing when the claim insert created no row (already sent, or another run won)', async () => {
    knownBusiness();
    mockQuery.mockImplementation(async (sql: string) =>
      String(sql).includes('INSERT INTO subscription_notifications') ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 });
    mockQueryRows.mockResolvedValue([row]);
    expect(await sendRenewalReminders()).toBe(0);
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('uses the real days left in the tightest bucket: 5 days out is the 7 bucket, "in 5 days"; the day after the end is lapsed', async () => {
    knownBusiness();
    mockQueryRows.mockResolvedValue([{ ...row, days_left: 5 }, { ...row, module_key: 'hr', days_left: -1 }]);
    expect(await sendRenewalReminders()).toBe(2);
    expect(claimCalls().map((c) => c[1][1])).toEqual(['renewal_reminder_7:billing:2026-12-04', 'renewal_reminder_lapsed:hr:2026-12-04']);
    expect(mockEmail.mock.calls[0][0].subject).toContain('ends in 5 days');
    expect(mockEmail.mock.calls[1][0].text).toContain('(HR) ended on 4 December 2026. You keep full access until 11 December 2026');
  });

  it('names the plan that will apply when a cheaper paid plan is scheduled', async () => {
    knownBusiness();
    mockQueryRows.mockResolvedValue([{ ...row, scheduled_plan_name: 'Starter' }]);
    await sendRenewalReminders();
    expect(mockEmail.mock.calls[0][0].text).toContain('You scheduled a change to Starter');
  });

  it('releases the claim and does not count the reminder when no channel delivered', async () => {
    mockQueryOne.mockImplementation(async (sql: string) =>
      sql.includes('FROM businesses') ? { email: null, name: 'Test Traders' } : null);
    mockQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('INSERT INTO notifications')) throw new Error('db down');
      return { rows: [], rowCount: 1 };
    });
    mockQueryRows.mockResolvedValue([row]);
    expect(await sendRenewalReminders()).toBe(0);
    const del = mockQuery.mock.calls.find(([q]) => String(q).startsWith('DELETE FROM subscription_notifications'))!;
    expect(del[1]).toEqual([BIZ, 'renewal_reminder_7:billing:2026-12-04']);
  });

  it('releases the claim when sending throws', async () => {
    knownBusiness();
    mockEmail.mockRejectedValue(new Error('smtp down'));
    mockQueryRows.mockResolvedValue([row]);
    expect(await sendRenewalReminders()).toBe(0);
    expect(mockQuery.mock.calls.some(([q]) => String(q).startsWith('DELETE FROM subscription_notifications'))).toBe(true);
  });
});
