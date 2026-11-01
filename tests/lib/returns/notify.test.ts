import { TENANT_WA_EVENT_KEYS, TENANT_WA_EVENTS, TENANT_WA_FIELDS, previewTemplateBody } from '@/lib/whatsapp/tenant-events';
import { CUSTOMER_PUSH_EVENTS } from '@/lib/push/customer-push';

jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn() }));
jest.mock('@/lib/whatsapp/tenant-send', () => ({ notifyBusinessEvent: jest.fn() }));

import { buildReturnMessage } from '@/lib/returns/notify';

const base = { returnNumber: 'RET-0012', orderNumber: 'SO-1042' };

describe('buildReturnMessage', () => {
  test('approved with a courier pickup names the courier, AWB and tracking link', () => {
    expect(
      buildReturnMessage('approved', {
        ...base,
        method: 'courier_pickup',
        courier: 'Delhivery',
        awb: 'R123',
        trackingUrl: 'https://t/1',
      }),
    ).toBe('Your return RET-0012 for order SO-1042 is approved. Pickup booked with Delhivery, AWB R123. Track: https://t/1');
  });

  test('approved where the customer sends it gives the shop instructions', () => {
    expect(
      buildReturnMessage('approved', {
        ...base,
        method: 'customer_sends',
        instructions: 'Shop 4, MG Road, Pune',
      }),
    ).toBe('Your return RET-0012 for order SO-1042 is approved. Please send it to: Shop 4, MG Road, Pune');
  });

  test('approved with no return needed says so', () => {
    expect(buildReturnMessage('approved', { ...base, method: 'no_return' })).toBe(
      'Your return RET-0012 for order SO-1042 is approved. No need to send it back.',
    );
  });

  test('a pickup with no tracking link leaves the link out', () => {
    expect(buildReturnMessage('approved', { ...base, method: 'courier_pickup', courier: 'Delhivery', awb: 'R123' })).toBe(
      'Your return RET-0012 for order SO-1042 is approved. Pickup booked with Delhivery, AWB R123.',
    );
  });

  test('pickup booked later', () => {
    expect(
      buildReturnMessage('pickup_booked', { ...base, courier: 'Delhivery', awb: 'R123', trackingUrl: 'https://t/1' }),
    ).toBe('Pickup for return RET-0012 is booked with Delhivery, AWB R123. Track: https://t/1');
  });

  test('rejected gives the reason', () => {
    expect(buildReturnMessage('rejected', { ...base, reason: 'Used item' })).toBe(
      'Sorry, your return RET-0012 was not accepted: Used item',
    );
    expect(buildReturnMessage('rejected', base)).toBe('Sorry, your return RET-0012 was not accepted.');
  });

  test('received names the credit note and amount', () => {
    expect(buildReturnMessage('received', { ...base, creditNoteNumber: 'CN-0042', amount: 1180 })).toBe(
      'We received your return RET-0012. Credit note CN-0042 for ₹1,180.',
    );
  });

  test('refunded explains where the money went', () => {
    expect(buildReturnMessage('refunded', { ...base, amount: 1180, refundMethod: 'original_payment' })).toBe(
      '₹1,180 refunded to your original payment; it reaches you in 5–7 working days.',
    );
    expect(buildReturnMessage('refunded', { ...base, amount: 1180, refundMethod: 'store_credit' })).toBe(
      '₹1,180 kept as store credit for your next order.',
    );
    expect(buildReturnMessage('refunded', { ...base, amount: 1180, refundMethod: 'upi' })).toBe('₹1,180 paid back by UPI.');
    expect(buildReturnMessage('refunded', { ...base, amount: 99.5, refundMethod: 'cash' })).toBe('₹99.5 paid back by Cash.');
    expect(buildReturnMessage('refunded', { ...base, amount: 250.25, refundMethod: 'bank' })).toBe(
      '₹250.25 paid back by bank transfer.',
    );
  });
});

describe('return event registration', () => {
  const keys = ['return_approved', 'return_pickup_booked', 'return_rejected', 'return_received', 'return_refunded'] as const;

  test.each(keys)('%s is a template event with matching placeholders and a phone-app push', (key) => {
    expect(TENANT_WA_EVENT_KEYS).toContain(key);
    const event = TENANT_WA_EVENTS.find((e) => e.key === key)!;
    expect(event.recipient).toBe('customer');
    const { body, variableMap } = event.suggested;
    const placeholders = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    expect(Math.max(...placeholders)).toBe(variableMap.length);
    for (const k of variableMap) expect(event.fields).toContain(k);
    expect(previewTemplateBody(body, variableMap)).not.toMatch(/\{\{/);
    expect(CUSTOMER_PUSH_EVENTS[key]).toMatchObject({ href: '/account' });
  });

  test('push titles and new field samples', () => {
    expect(CUSTOMER_PUSH_EVENTS.return_approved?.title).toBe('Return approved');
    expect(CUSTOMER_PUSH_EVENTS.return_pickup_booked?.title).toBe('Return pickup booked');
    expect(CUSTOMER_PUSH_EVENTS.return_rejected?.title).toBe('Return not accepted');
    expect(CUSTOMER_PUSH_EVENTS.return_received?.title).toBe('Return received');
    expect(CUSTOMER_PUSH_EVENTS.return_refunded?.title).toBe('Refund sent');
    expect(TENANT_WA_FIELDS.return_number.sample).toBe('RET-0012');
    expect(TENANT_WA_FIELDS.instructions.sample).toBe('Please send it to: Shop 4, MG Road, Pune');
    expect(TENANT_WA_FIELDS.credit_note_number.sample).toBe('CN-0042');
  });
});
