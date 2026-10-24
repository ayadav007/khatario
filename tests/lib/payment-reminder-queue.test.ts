/**
 * Scheduled payment reminders: QR (Baileys) sends are spaced per business, Cloud API sends are not,
 * and the cron falls back to paced inline sending when the queue is unavailable.
 */
jest.mock('@/lib/db', () => ({ queryOne: jest.fn(), queryRows: jest.fn(), query: jest.fn() }));
jest.mock('@/lib/subscription', () => ({ checkLimit: jest.fn(), hasFeature: jest.fn() }));
jest.mock('@/lib/whatsapp/business-transport', () => ({ businessTransport: jest.fn() }));
jest.mock('@/lib/payment-reminder-delivery', () => ({ deliverPaymentReminder: jest.fn() }));
jest.mock('@/lib/whatsapp/baileys-pacing', () => {
  const actual = jest.requireActual('@/lib/whatsapp/baileys-pacing');
  return { ...actual, sleep: jest.fn(() => Promise.resolve()) };
});
jest.mock('@/lib/queue/paymentReminderQueue', () => {
  const actual = jest.requireActual('@/lib/queue/paymentReminderQueue');
  return { ...actual, enqueuePaymentReminders: jest.fn() };
});

import * as db from '@/lib/db';
import { checkLimit, hasFeature } from '@/lib/subscription';
import { businessTransport } from '@/lib/whatsapp/business-transport';
import { deliverPaymentReminder } from '@/lib/payment-reminder-delivery';
import { sleep, BAILEYS_SCHEDULED_GAP_MS } from '@/lib/whatsapp/baileys-pacing';
import {
  enqueuePaymentReminders,
  planBaileysDelays,
  paymentReminderJobId,
  processPaymentReminderJob,
} from '@/lib/queue/paymentReminderQueue';
import {
  checkAndSendPaymentDueReminders,
  checkAndSendOverdueReminders,
  INLINE_BAILEYS_MAX_PER_RUN,
} from '@/lib/payment-reminder-checker';

const BIZ = 'b1b1b1b1-0000-4000-8000-000000000001';
const mocked = <T>(fn: T) => fn as unknown as jest.Mock;

function setupDueRun(invoiceCount: number, limit = { allowed: true, limit: -1, current: 0 }) {
  mocked(hasFeature).mockResolvedValue(true);
  mocked(checkLimit).mockResolvedValue(limit);
  mocked(db.queryOne).mockResolvedValue({ enabled: true, days_before: 1, message_template: 'Hi', include_pdf: false });
  mocked(db.queryRows).mockResolvedValue(
    Array.from({ length: invoiceCount }, (_, i) => ({ id: `inv-${i}`, last_reminder_sent: null })),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked(deliverPaymentReminder).mockResolvedValue({ outcome: 'sent' });
});

describe('planBaileysDelays', () => {
  it('spaces sends by the gap, starting now when nothing is booked', () => {
    const { delays, nextSlot } = planBaileysDelays(1_000, null, 3, () => 5_000);
    expect(delays).toEqual([0, 5_000, 10_000]);
    expect(nextSlot).toBe(16_000);
  });

  it('continues after a slot booked by an earlier run instead of overlapping it', () => {
    const { delays } = planBaileysDelays(1_000, 21_000, 2, () => 5_000);
    expect(delays).toEqual([20_000, 25_000]);
  });

  it('uses scheduled gaps wider than manual bulk sends by default', () => {
    const { delays } = planBaileysDelays(0, null, 2);
    expect(delays[1]).toBeGreaterThanOrEqual(BAILEYS_SCHEDULED_GAP_MS.min);
    expect(delays[1]).toBeLessThan(BAILEYS_SCHEDULED_GAP_MS.max);
  });
});

describe('paymentReminderJobId', () => {
  it('is deterministic per invoice and kind, with no colons (BullMQ restriction)', () => {
    expect(paymentReminderJobId({ kind: 'overdue', invoiceId: 'abc' })).toBe('pr-overdue-abc');
    expect(paymentReminderJobId({ kind: 'payment_due', invoiceId: 'abc' })).not.toContain(':');
  });
});

describe('checker hands reminders to the queue', () => {
  it('queues every due invoice with the business transport', async () => {
    setupDueRun(3);
    mocked(businessTransport).mockResolvedValue('baileys');
    mocked(enqueuePaymentReminders).mockResolvedValue(3);

    const result = await checkAndSendPaymentDueReminders(BIZ);

    expect(enqueuePaymentReminders).toHaveBeenCalledTimes(1);
    const [businessId, transport, jobs] = mocked(enqueuePaymentReminders).mock.calls[0];
    expect(businessId).toBe(BIZ);
    expect(transport).toBe('baileys');
    expect(jobs.map((j: { invoiceId: string }) => j.invoiceId)).toEqual(['inv-0', 'inv-1', 'inv-2']);
    expect(jobs[0]).toMatchObject({ kind: 'payment_due', includePdf: false, messageTemplate: 'Hi' });
    expect(deliverPaymentReminder).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, queued: 3, skipped: 0, errors: 0 });
  });

  it('queues no more than the remaining monthly WhatsApp quota', async () => {
    setupDueRun(5, { allowed: true, limit: 10, current: 8 });
    mocked(businessTransport).mockResolvedValue('cloud');
    mocked(enqueuePaymentReminders).mockResolvedValue(2);

    const result = await checkAndSendOverdueReminders(BIZ);

    expect(mocked(enqueuePaymentReminders).mock.calls[0][2]).toHaveLength(2);
    expect(result).toEqual({ sent: 0, queued: 2, skipped: 3, errors: 0 });
  });

  it('counts invoices already waiting in the queue as skipped, not queued twice', async () => {
    setupDueRun(4);
    mocked(businessTransport).mockResolvedValue('baileys');
    mocked(enqueuePaymentReminders).mockResolvedValue(1);

    const result = await checkAndSendPaymentDueReminders(BIZ);
    expect(result).toEqual({ sent: 0, queued: 1, skipped: 3, errors: 0 });
  });
});

describe('inline fallback when the queue is unavailable', () => {
  beforeEach(() => mocked(enqueuePaymentReminders).mockResolvedValue(null));

  it('spaces QR sends with a gap between each one', async () => {
    setupDueRun(3);
    mocked(businessTransport).mockResolvedValue('baileys');

    const result = await checkAndSendPaymentDueReminders(BIZ);

    expect(deliverPaymentReminder).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    for (const [ms] of mocked(sleep).mock.calls) {
      expect(ms).toBeGreaterThanOrEqual(BAILEYS_SCHEDULED_GAP_MS.min);
    }
    expect(result).toEqual({ sent: 3, queued: 0, skipped: 0, errors: 0 });
  });

  it('caps QR sends per run so the cron request stays bounded', async () => {
    setupDueRun(INLINE_BAILEYS_MAX_PER_RUN + 5);
    mocked(businessTransport).mockResolvedValue('baileys');

    const result = await checkAndSendPaymentDueReminders(BIZ);

    expect(deliverPaymentReminder).toHaveBeenCalledTimes(INLINE_BAILEYS_MAX_PER_RUN);
    expect(result.skipped).toBe(5);
  });

  it('sends Cloud API reminders without artificial gaps or a cap', async () => {
    setupDueRun(INLINE_BAILEYS_MAX_PER_RUN + 5);
    mocked(businessTransport).mockResolvedValue('cloud');

    await checkAndSendPaymentDueReminders(BIZ);

    expect(deliverPaymentReminder).toHaveBeenCalledTimes(INLINE_BAILEYS_MAX_PER_RUN + 5);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('worker pacing', () => {
  const job = (businessId: string, transport: 'baileys' | 'cloud', invoiceId: string) => ({
    businessId,
    invoiceId,
    transport,
    kind: 'overdue' as const,
    messageTemplate: 'Hi',
    includePdf: false,
  });

  it('waits the minimum gap between two QR sends for the same business', async () => {
    const biz = 'pace-same-business';
    await processPaymentReminderJob(job(biz, 'baileys', 'a'));
    await processPaymentReminderJob(job(biz, 'baileys', 'b'));

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(mocked(sleep).mock.calls[0][0]).toBeGreaterThan(BAILEYS_SCHEDULED_GAP_MS.min - 100);
  });

  it('runs concurrent QR jobs for one business one at a time', async () => {
    const biz = 'pace-serial-business';
    const order: string[] = [];
    mocked(deliverPaymentReminder).mockImplementation(async (j: { invoiceId: string }) => {
      order.push(`start-${j.invoiceId}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end-${j.invoiceId}`);
      return { outcome: 'sent' };
    });

    await Promise.all([
      processPaymentReminderJob(job(biz, 'baileys', 'a')),
      processPaymentReminderJob(job(biz, 'baileys', 'b')),
    ]);

    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b']);
  });

  it('does not pace Cloud API sends', async () => {
    const biz = 'pace-cloud-business';
    await processPaymentReminderJob(job(biz, 'cloud', 'a'));
    await processPaymentReminderJob(job(biz, 'cloud', 'b'));
    expect(sleep).not.toHaveBeenCalled();
  });
});
