import { describe, expect, it } from '@jest/globals';
import { buildPushMessage, PUSH_BODY_MAX, pushHrefFor } from '@/lib/push/payload';
import { classifyPushError, nextRetryDelayMs, PUSH_MAX_ATTEMPTS } from '@/lib/push/errors';
import type { PushJobRow } from '@/lib/push/types';

const INVOICE = '5620687e-e3d1-464c-afdc-5cf3c29f9c2d';
const NOTE = '7a0e5d3e-1c2b-4f6a-8d9e-0a1b2c3d4e5f';
const BIZ = '22222222-2222-4222-8222-222222222222';

function job(over: Partial<PushJobRow> = {}): PushJobRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'notification',
    audience: 'business',
    notification_id: NOTE,
    notification_seq: '1000000000042',
    business_id: BIZ,
    user_id: null,
    customer_id: null,
    title: 'Invoice INV-7 is overdue',
    body: "Rahul Traders's invoice for ₹2500.00 was due on 29/10/2026",
    data: { type: 'invoice_overdue', reference_type: 'invoice', reference_id: INVOICE },
    status: 'pending',
    attempts: 1,
    next_attempt_at: '2026-10-29T00:00:00Z',
    last_error: null,
    sent_count: 0,
    ...over,
  };
}

describe('push payload', () => {
  it('builds a notification plus data message that both apps can route', () => {
    const m = buildPushMessage(job());
    expect(m.notification).toEqual({ title: 'Invoice INV-7 is overdue', body: "Rahul Traders's invoice for ₹2500.00 was due on 29/10/2026" });
    expect(m.data).toMatchObject({
      kind: 'notification',
      audience: 'business',
      business_id: BIZ,
      notification_id: NOTE,
      notification_seq: '1000000000042',
      href: `/invoices/${INVOICE}`,
      type: 'invoice_overdue',
      channel: 'khatario_alerts',
    });
    expect(m.android.priority).toBe('high');
    expect(m.android.notification).toMatchObject({
      channelId: 'khatario_alerts',
      icon: 'ic_stat_khatario',
      sound: 'default',
      visibility: 'private',
      tag: `n-${NOTE}`,
    });
    expect(m.android.collapseKey).toBe(`n-${NOTE}`);
    // Every data value must be a string for FCM.
    for (const v of Object.values(m.data)) expect(typeof v).toBe('string');
  });

  it('clips long bodies and keeps the title short', () => {
    const m = buildPushMessage(job({ body: 'x'.repeat(1000), title: 't'.repeat(200) }));
    expect(m.notification.body.length).toBe(PUSH_BODY_MAX);
    expect(m.notification.body.endsWith('…')).toBe(true);
    expect(m.notification.title.length).toBe(80);
  });

  it('uses the customer job href and tag, and no notification id', () => {
    const m = buildPushMessage(
      job({ kind: 'customer', audience: 'customer', notification_id: null, notification_seq: null, customer_id: NOTE, data: { event: 'order_delivered', href: '/account' } }),
    );
    expect(m.data.href).toBe('/account');
    expect(m.data.notification_id).toBeUndefined();
    expect(m.android.notification.tag).toBe('j-11111111-1111-4111-8111-111111111111');
  });

  it('ignores a client-looking href that is not a site path', () => {
    expect(pushHrefFor({ kind: 'customer', data: { href: 'https://evil.example/x' } })).toBeNull();
    expect(pushHrefFor({ kind: 'notification', data: { href: 'javascript:alert(1)', type: 'todo_reminder' } })).toBe('/tools/todo');
  });
});

describe('push error classes and retry schedule', () => {
  it('revokes dead tokens, retries transient provider errors, fails the rest', () => {
    expect(classifyPushError('messaging/registration-token-not-registered')).toBe('invalid_token');
    expect(classifyPushError('messaging/mismatched-credential')).toBe('invalid_token');
    expect(classifyPushError('messaging/invalid-argument', 'The registration token is not a valid FCM registration token')).toBe('invalid_token');
    expect(classifyPushError('messaging/server-unavailable')).toBe('retry');
    expect(classifyPushError('messaging/internal-error')).toBe('retry');
    expect(classifyPushError('messaging/batch-failed')).toBe('retry');
    expect(classifyPushError(undefined)).toBe('retry');
    expect(classifyPushError('messaging/invalid-argument', 'Invalid notification payload')).toBe('failed');
    expect(classifyPushError('app/invalid-credential')).toBe('failed');
  });

  it('backs off 30s, 2m, 10m, 1h and then gives up', () => {
    expect(nextRetryDelayMs(1)).toBe(30_000);
    expect(nextRetryDelayMs(2)).toBe(120_000);
    expect(nextRetryDelayMs(3)).toBe(600_000);
    expect(nextRetryDelayMs(4)).toBe(3_600_000);
    expect(nextRetryDelayMs(5)).toBeNull();
    expect(PUSH_MAX_ATTEMPTS).toBe(5);
  });
});
