/**
 * Meta Cloud API webhook: message parsing, tenant signature enforcement (the platform secret must
 * not unlock a tenant webhook), and routing of owner vs customer messages.
 */
import { createHmac } from 'crypto';

const mockRouteCloud = jest.fn();
const mockRecord = jest.fn();
const mockAddJob = jest.fn();
const mockBizSecrets = jest.fn();
const mockPlatformSecrets = jest.fn();
const mockApplyPlatform = jest.fn();
const mockApplyTenant = jest.fn();

jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn() }));
jest.mock('@/lib/queue', () => ({ addWhatsAppMessageJob: (...a: unknown[]) => mockAddJob(...a) }));
jest.mock('@/lib/whatsapp/inbound-router', () => ({
  routeCloudInbound: (...a: unknown[]) => mockRouteCloud(...a),
  recordInbound: (...a: unknown[]) => mockRecord(...a),
}));
jest.mock('@/lib/meta-whatsapp-credentials', () => ({
  loadBusinessMetaWaSecrets: (...a: unknown[]) => mockBizSecrets(...a),
  loadPlatformMetaWaSecrets: (...a: unknown[]) => mockPlatformSecrets(...a),
}));
jest.mock('@/lib/platform-whatsapp-templates', () => ({ applyWebhookTemplateStatus: (...a: unknown[]) => mockApplyPlatform(...a) }));
jest.mock('@/lib/whatsapp/owner-summary', () => ({ applyTenantTemplateStatus: (...a: unknown[]) => mockApplyTenant(...a) }));

import { NextRequest } from 'next/server';
import { extractInboundMessages } from '@/lib/meta-whatsapp';
import { GET, POST } from '@/app/api/webhooks/meta-whatsapp/route';

const BIZ = '11111111-1111-4111-8111-111111111111';
const TENANT_SECRET = 'tenant-secret';
const PLATFORM_SECRET = 'platform-secret';

const payload = (messages: unknown[], field = 'messages') => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field,
          value: {
            metadata: { phone_number_id: 'PN1', display_phone_number: '+91 98000 00001' },
            contacts: [{ wa_id: '919811111111', profile: { name: 'Ravi' } }],
            messages,
          },
        },
      ],
    },
  ],
});

const textMsg = (id: string, from: string, body: string) => ({ id, from, timestamp: '1790000000', type: 'text', text: { body } });

function sign(body: string, secret: string) {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

function post(body: unknown, opts: { businessId?: string; secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const url = `http://localhost/api/webhooks/meta-whatsapp${opts.businessId ? `?business_id=${opts.businessId}` : ''}`;
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw, opts.secret ?? TENANT_SECRET) },
    body: raw,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBizSecrets.mockResolvedValue({ appSecret: TENANT_SECRET, verifyToken: 'tenant-token' });
  mockPlatformSecrets.mockResolvedValue({ appSecret: PLATFORM_SECRET, verifyToken: 'platform-token' });
  mockRecord.mockResolvedValue(true);
});

describe('extractInboundMessages', () => {
  it('parses text, button and interactive replies with the sender profile', () => {
    const out = extractInboundMessages(
      payload([
        textMsg('w1', '919811111111', 'sales today'),
        { id: 'w2', from: '919822222222', type: 'button', button: { text: 'Yes' } },
        { id: 'w3', from: '919822222222', type: 'interactive', interactive: { type: 'button_reply', button_reply: { title: 'Order status' } } },
      ]),
    );
    expect(out.map((m) => [m.messageId, m.from, m.text])).toEqual([
      ['w1', '919811111111', 'sales today'],
      ['w2', '919822222222', 'Yes'],
      ['w3', '919822222222', 'Order status'],
    ]);
    expect(out[0].profileName).toBe('Ravi');
    expect(out[0].displayPhoneNumber).toContain('98000');
  });

  it('parses a catalog cart, dropping empty or zero-quantity lines', () => {
    const [m] = extractInboundMessages(
      payload([
        {
          id: 'w9',
          from: '919811111111',
          type: 'order',
          order: {
            catalog_id: '194836987003835',
            text: 'Love these!',
            product_items: [
              { product_retailer_id: 'aaaa', quantity: 2, item_price: 30, currency: 'INR' },
              { product_retailer_id: 'bbbb', quantity: '1', item_price: '25', currency: 'INR' },
              { product_retailer_id: '', quantity: 3 },
              { product_retailer_id: 'cccc', quantity: 0 },
            ],
          },
        },
      ]),
    );
    expect(m.type).toBe('order');
    expect(m.text).toBeNull();
    expect(m.order).toEqual({
      catalogId: '194836987003835',
      note: 'Love these!',
      items: [
        { retailerId: 'aaaa', quantity: 2, itemPrice: 30, currency: 'INR' },
        { retailerId: 'bbbb', quantity: 1, itemPrice: 25, currency: 'INR' },
      ],
    });
  });

  it('has no order for ordinary messages', () => {
    const [m] = extractInboundMessages(payload([textMsg('w1', '919811111111', 'hi')]));
    expect(m.order).toBeNull();
  });

  it('ignores status-only and other fields', () => {
    expect(extractInboundMessages(payload([textMsg('w1', '91981', 'x')], 'message_template_status_update'))).toEqual([]);
    expect(extractInboundMessages({ entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'x' }] } }] }] })).toEqual([]);
    expect(extractInboundMessages(null)).toEqual([]);
  });
});

describe('tenant webhook signature', () => {
  it('rejects a tenant webhook signed with the platform secret', async () => {
    const res = await POST(post(payload([textMsg('w1', '919811111111', 'sales today')]), { businessId: BIZ, secret: PLATFORM_SECRET }));
    expect(res.status).toBe(401);
    expect(mockRouteCloud).not.toHaveBeenCalled();
  });

  it('rejects a tenant webhook when the tenant has no app secret saved', async () => {
    mockBizSecrets.mockResolvedValue({ appSecret: '', verifyToken: '' });
    process.env.META_WA_APP_SECRET = PLATFORM_SECRET;
    const res = await POST(post(payload([]), { businessId: BIZ, secret: PLATFORM_SECRET }));
    delete process.env.META_WA_APP_SECRET;
    expect(res.status).toBe(401);
  });

  it('rejects a malformed business id', async () => {
    const res = await POST(post(payload([]), { businessId: 'not-a-uuid' }));
    expect(res.status).toBe(401);
    expect(mockBizSecrets).not.toHaveBeenCalled();
  });

  it('does not verify a tenant subscription with the platform token', async () => {
    mockBizSecrets.mockResolvedValue({ appSecret: '', verifyToken: '' });
    process.env.META_WA_VERIFY_TOKEN = 'platform-token';
    const res = await GET(new NextRequest(`http://localhost/api/webhooks/meta-whatsapp?business_id=${BIZ}&hub.mode=subscribe&hub.verify_token=platform-token&hub.challenge=abc`));
    delete process.env.META_WA_VERIFY_TOKEN;
    expect(res.status).toBe(403);
  });
});

describe('tenant webhook routing', () => {
  it('sends customer messages to the CRM job and keeps owner messages out of it', async () => {
    mockRouteCloud.mockResolvedValueOnce('owner').mockResolvedValueOnce('other');
    const res = await POST(
      post(payload([textMsg('w1', '919811111111', 'sales today'), textMsg('w2', '919822222222', 'is the shop open?')]), { businessId: BIZ }),
    );
    expect(res.status).toBe(200);
    expect(mockRouteCloud).toHaveBeenCalledTimes(2);
    expect(mockAddJob).toHaveBeenCalledTimes(1);
    expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'cloud-incoming', businessId: BIZ, from: '919822222222', text: 'is the shop open?' }));
  });

  it('queues a customer cart even though it has no text', async () => {
    mockRouteCloud.mockResolvedValueOnce('other');
    const cart = {
      id: 'w5',
      from: '919822222222',
      type: 'order',
      order: { catalog_id: '123456', product_items: [{ product_retailer_id: 'item-1', quantity: 3, item_price: 10, currency: 'INR' }] },
    };
    const res = await POST(post(payload([cart]), { businessId: BIZ }));
    expect(res.status).toBe(200);
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cloud-incoming',
        messageType: 'order',
        text: '',
        order: { catalogId: '123456', note: null, items: [{ retailerId: 'item-1', quantity: 3 }] },
      }),
    );
  });

  it('still skips customer media without text or cart', async () => {
    mockRouteCloud.mockResolvedValueOnce('other');
    await POST(post(payload([{ id: 'w6', from: '919822222222', type: 'sticker' }]), { businessId: BIZ }));
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('acknowledges with 200 even when processing fails, so Meta stops retrying', async () => {
    mockRouteCloud.mockRejectedValueOnce(new Error('db down'));
    const res = await POST(post(payload([textMsg('w1', '919811111111', 'x')]), { businessId: BIZ }));
    expect(res.status).toBe(200);
  });
});

describe('platform webhook', () => {
  it('queues prospect messages once, skipping duplicates', async () => {
    mockRecord.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const res = await POST(
      post(payload([textMsg('p1', '919833333333', 'what is your price?'), textMsg('p1', '919833333333', 'what is your price?')]), { secret: PLATFORM_SECRET }),
    );
    expect(res.status).toBe(200);
    expect(mockAddJob).toHaveBeenCalledTimes(1);
    expect(mockAddJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'platform-incoming', businessId: 'platform', from: '919833333333' }));
    expect(mockRouteCloud).not.toHaveBeenCalled();
  });
});
