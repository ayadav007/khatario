/**
 * Owner messages on a business number: LINK codes, the linked phone, QR self-chat and the
 * loop guard that stops our own replies from becoming new commands. Anyone else must never
 * reach the owner assistant.
 */
const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
const mockAddJob = jest.fn();
jest.mock('@/lib/db', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  queryRows: jest.fn(),
}));
jest.mock('@/lib/queue', () => ({ addWhatsAppMessageJob: (...a: unknown[]) => mockAddJob(...a) }));
jest.mock('@/lib/meta-whatsapp', () => ({ getMetaWaConfig: jest.fn(), sendTemplateMessage: jest.fn(), sendTextMessage: jest.fn() }));

import { ASSISTANT_MARKER } from '@/lib/whatsapp/business-transport';
import {
  classifyInbound,
  clearOwnerLinkCache,
  linkCodeValid,
  parseLinkCode,
  routeBaileysInbound,
  routeCloudInbound,
  samePhone,
  type OwnerLink,
} from '@/lib/whatsapp/inbound-router';

const BIZ = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const BUSINESS_PHONE = '919800000001';
const OWNER_PHONE = '919811111111';
const CUSTOMER = '919822222222';
const NOW = new Date('2026-10-02T10:00:00Z');
const LATER = new Date('2026-10-02T10:30:00Z').toISOString();

const link = (over: Partial<OwnerLink> = {}): OwnerLink => ({
  business_id: BIZ,
  user_id: USER,
  linked_phone: OWNER_PHONE,
  self_chat: false,
  link_code: null,
  link_code_expires_at: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  clearOwnerLinkCache();
  mockQuery.mockResolvedValue({ rowCount: 1 });
});

describe('phone and code helpers', () => {
  it('matches numbers with or without the country code', () => {
    expect(samePhone('9811111111', '+91 98111 11111')).toBe(true);
    expect(samePhone('919811111111', '919811111112')).toBe(false);
    expect(samePhone('', OWNER_PHONE)).toBe(false);
  });

  it('parses only an exact LINK message', () => {
    expect(parseLinkCode('LINK 1234')).toBe('1234');
    expect(parseLinkCode('  link 4321 ')).toBe('4321');
    expect(parseLinkCode('please LINK 1234')).toBeNull();
    expect(parseLinkCode('LINK 12')).toBeNull();
  });

  it('rejects a wrong or expired code', () => {
    const l = link({ link_code: '1234', link_code_expires_at: LATER });
    expect(linkCodeValid(l, '1234', NOW)).toBe(true);
    expect(linkCodeValid(l, '9999', NOW)).toBe(false);
    expect(linkCodeValid(l, '1234', new Date('2026-10-02T11:00:00Z'))).toBe(false);
  });
});

describe('classifyInbound', () => {
  const base = { businessPhone: BUSINESS_PHONE, isFromMe: false, now: NOW };

  it('sends the linked phone to the owner assistant', () => {
    expect(classifyInbound({ ...base, link: link(), from: OWNER_PHONE, text: 'sales today' })).toBe('owner');
  });

  it('never sends a customer to the owner assistant', () => {
    expect(classifyInbound({ ...base, link: link(), from: CUSTOMER, text: 'sales today' })).toBe('other');
    expect(classifyInbound({ ...base, link: null, from: CUSTOMER, text: 'sales today' })).toBe('other');
  });

  it('lets any sender with the valid code link, but not with a wrong or expired code', () => {
    const l = link({ linked_phone: null, link_code: '1234', link_code_expires_at: LATER });
    expect(classifyInbound({ ...base, link: l, from: CUSTOMER, text: 'LINK 1234' })).toBe('link');
    expect(classifyInbound({ ...base, link: l, from: CUSTOMER, text: 'LINK 9999' })).toBe('other');
    expect(classifyInbound({ ...base, link: l, from: CUSTOMER, text: 'LINK 1234', now: new Date('2026-10-03T00:00:00Z') })).toBe('other');
  });

  it('treats our own marked reply as an echo', () => {
    expect(classifyInbound({ ...base, link: link(), from: BUSINESS_PHONE, isFromMe: true, text: `${ASSISTANT_MARKER}*Sales today*` })).toBe('echo');
  });

  it('only accepts self-chat when the link is a self-chat link', () => {
    const self = link({ linked_phone: BUSINESS_PHONE, self_chat: true });
    expect(classifyInbound({ ...base, link: self, from: BUSINESS_PHONE, isFromMe: true, text: 'sales today' })).toBe('owner');
    expect(classifyInbound({ ...base, link: link(), from: BUSINESS_PHONE, isFromMe: true, text: 'sales today' })).toBe('other');
  });

  it('ignores messages the business sends to customers', () => {
    const self = link({ linked_phone: BUSINESS_PHONE, self_chat: true });
    expect(classifyInbound({ ...base, link: self, from: CUSTOMER, isFromMe: true, text: 'sales today' })).toBe('other');
  });

  it('does not let the linked phone in through self-chat when it is a separate phone', () => {
    expect(classifyInbound({ ...base, link: link({ self_chat: true }), from: OWNER_PHONE, text: 'sales today' })).toBe('other');
  });
});

describe('routeBaileysInbound', () => {
  const msg = { businessId: BIZ, businessPhone: BUSINESS_PHONE, isGroup: false, messageId: 'M1' };

  it('consumes owner messages and queues one owner job', async () => {
    mockQueryOne.mockResolvedValueOnce(link());
    const consumed = await routeBaileysInbound({ ...msg, from: OWNER_PHONE, isFromMe: false, text: 'sales today' });
    expect(consumed).toBe(true);
    expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'owner-command', kind: 'owner', businessId: BIZ, from: OWNER_PHONE }));
  });

  it('leaves customer messages for the CRM and bot', async () => {
    mockQueryOne.mockResolvedValueOnce(link());
    const consumed = await routeBaileysInbound({ ...msg, from: CUSTOMER, isFromMe: false, text: 'price of rice?' });
    expect(consumed).toBe(false);
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('skips the database entirely when no owner is linked', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await routeBaileysInbound({ ...msg, from: CUSTOMER, isFromMe: false, text: 'hi' })).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('swallows our own reply in self-chat without queueing', async () => {
    mockQueryOne.mockResolvedValueOnce(link({ linked_phone: BUSINESS_PHONE, self_chat: true }));
    const consumed = await routeBaileysInbound({ ...msg, from: BUSINESS_PHONE, isFromMe: true, text: `${ASSISTANT_MARKER}Sales today: ₹0` });
    expect(consumed).toBe(true);
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('swallows a recorded outbound id even if the marker was stripped', async () => {
    mockQueryOne
      .mockResolvedValueOnce(link({ linked_phone: BUSINESS_PHONE, self_chat: true }))
      .mockResolvedValueOnce({ ok: 1 });
    const consumed = await routeBaileysInbound({ ...msg, from: BUSINESS_PHONE, isFromMe: true, text: 'Sales today: ₹0' });
    expect(consumed).toBe(true);
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('does not queue a duplicate message twice', async () => {
    mockQueryOne.mockResolvedValueOnce(link());
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    expect(await routeBaileysInbound({ ...msg, from: OWNER_PHONE, isFromMe: false, text: 'sales today' })).toBe(true);
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('ignores groups', async () => {
    expect(await routeBaileysInbound({ ...msg, isGroup: true, from: OWNER_PHONE, isFromMe: false, text: 'sales' })).toBe(false);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });
});

describe('routeCloudInbound', () => {
  const msg = { businessId: BIZ, businessPhone: BUSINESS_PHONE, messageId: 'wamid.1' };

  it('queues a link job for a valid code', async () => {
    mockQueryOne.mockResolvedValueOnce(link({ linked_phone: null, link_code: '1234', link_code_expires_at: new Date(Date.now() + 600_000).toISOString() }));
    expect(await routeCloudInbound({ ...msg, from: OWNER_PHONE, text: 'LINK 1234' })).toBe('link');
    expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'owner-command', kind: 'link', provider: 'cloud' }));
  });

  it('returns duplicate for a retried webhook', async () => {
    mockQueryOne.mockResolvedValueOnce(link());
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    expect(await routeCloudInbound({ ...msg, from: OWNER_PHONE, text: 'sales today' })).toBe('duplicate');
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('passes customer messages back as other', async () => {
    mockQueryOne.mockResolvedValueOnce(link());
    expect(await routeCloudInbound({ ...msg, from: CUSTOMER, text: 'is the shop open?' })).toBe('other');
    expect(mockAddJob).not.toHaveBeenCalled();
  });
});
