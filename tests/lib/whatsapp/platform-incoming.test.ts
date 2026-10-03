/**
 * Messages to Khatario's own WhatsApp number: prospects get the sales assistant, registered users
 * get how-to help (never business figures from this number), replies are WhatsApp-formatted.
 */
const mockQueryOne = jest.fn();
const mockSendText = jest.fn();
const mockAnswerTurn = jest.fn();
const mockChannelEnabled = jest.fn();
const mockFunnel = jest.fn();

jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: (...a: unknown[]) => mockQueryOne(...a), queryRows: jest.fn() }));
jest.mock('@/lib/meta-whatsapp', () => ({ sendTextMessage: (...a: unknown[]) => mockSendText(...a) }));
jest.mock('@/lib/rag/answer', () => ({ answerTurn: (...a: unknown[]) => mockAnswerTurn(...a) }));
jest.mock('@/lib/rag/settings', () => ({ isChannelEnabled: (...a: unknown[]) => mockChannelEnabled(...a) }));
jest.mock('@/lib/sales-funnel/engine', () => ({ handleFunnelMessage: (...a: unknown[]) => mockFunnel(...a) }));

import { actionToText, PLATFORM_MESSAGES_PER_HOUR, PLATFORM_REPLY_MAX, platformReplyText, processPlatformIncoming } from '@/lib/whatsapp/platform-incoming';
import type { PlatformIncomingQueueJob } from '@/lib/whatsapp-queue-types';

const PHONE = '919833333333';
const BIZ = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

const job = (text: string): PlatformIncomingQueueJob => ({
  type: 'platform-incoming', businessId: 'platform', messageId: 'p1', conversationId: PHONE, timestamp: Date.now(), from: PHONE, text,
});

async function* events(list: unknown[]) {
  for (const e of list) yield e;
}

let user: { user_id: string; business_id: string } | null = null;
let hourly = 1;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://khatario.com';
  user = null;
  hourly = 1;
  mockChannelEnabled.mockResolvedValue(true);
  mockFunnel.mockResolvedValue(false);
  mockSendText.mockResolvedValue({ messageId: 'out1' });
  mockQueryOne.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM users')) return user;
    if (sql.includes('COUNT(*)')) return { n: String(hourly) };
    return null;
  });
  mockAnswerTurn.mockImplementation(() =>
    events([
      { type: 'meta', conversationId: 'c1' },
      { type: 'delta', text: '**Khatario** makes GST invoices [1].' },
      { type: 'citations', citations: [{ title: 'Invoices', url: '/guides/invoices', headingPath: '' }] },
      { type: 'action', action: { type: 'book_demo' } },
      { type: 'done', messageId: 'm1', answered: true },
    ]),
  );
});

describe('formatting', () => {
  it('turns actions into links on the site', () => {
    expect(actionToText({ type: 'book_demo' })).toBe('Book a free demo: https://khatario.com/book-demo');
    expect(actionToText({ type: 'start_trial', url: '/signup?src=assistant' })).toBe('Start your free trial: https://khatario.com/signup?src=whatsapp');
    expect(actionToText({ type: 'insight', cards: [] })).toBeNull();
  });

  it('strips citation markers, adds the first source link and caps the length', () => {
    const out = platformReplyText({
      text: `**Hi** there [1]. ${'word '.repeat(400)}`,
      citations: [{ title: 'No link', url: null, headingPath: '' }, { title: 'Guide', url: '/guides/x', headingPath: '' }],
      actions: [{ type: 'talk_to_human' }],
    });
    const [body, more, human] = out.split('\n\n');
    expect(body.startsWith('*Hi* there.')).toBe(true);
    expect(body.length).toBeLessThanOrEqual(PLATFORM_REPLY_MAX);
    expect(body.endsWith('…')).toBe(true);
    expect(more).toBe('More: https://khatario.com/guides/x');
    expect(human).toContain('team');
  });
});

describe('processPlatformIncoming', () => {
  it('answers an unknown number as a prospect on the whatsapp channel', async () => {
    await processPlatformIncoming(job('what does khatario do?'));
    expect(mockAnswerTurn).toHaveBeenCalledWith(expect.objectContaining({ channel: 'whatsapp', audience: 'prospect', phone: PHONE, userId: null, businessId: null }));
    expect(mockSendText).toHaveBeenCalledWith({
      to: PHONE,
      body: '*Khatario* makes GST invoices.\n\nMore: https://khatario.com/guides/invoices\n\nBook a free demo: https://khatario.com/book-demo',
    });
  });

  it('gives a registered user how-to help without a user id, so no business figures', async () => {
    user = { user_id: USER, business_id: BIZ };
    await processPlatformIncoming(job('how do I create an invoice?'));
    expect(mockAnswerTurn).toHaveBeenCalledWith(expect.objectContaining({ audience: 'tenant_user', businessId: BIZ, userId: null }));
  });

  it('points a registered user asking for figures to their own business number', async () => {
    user = { user_id: USER, business_id: BIZ };
    await processPlatformIncoming(job('sales today'));
    expect(mockAnswerTurn).not.toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalledWith({ to: PHONE, body: expect.stringContaining('Owner updates') });
  });

  it('stays silent when the whatsapp channel is off', async () => {
    mockChannelEnabled.mockResolvedValue(false);
    await processPlatformIncoming(job('hi'));
    expect(mockAnswerTurn).not.toHaveBeenCalled();
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('rate limits per phone, telling them once', async () => {
    hourly = PLATFORM_MESSAGES_PER_HOUR + 1;
    await processPlatformIncoming(job('hi'));
    expect(mockSendText).toHaveBeenCalledTimes(1);
    hourly = PLATFORM_MESSAGES_PER_HOUR + 2;
    mockSendText.mockClear();
    await processPlatformIncoming(job('hi'));
    expect(mockSendText).not.toHaveBeenCalled();
    expect(mockAnswerTurn).not.toHaveBeenCalled();
  });

  it('lets the sales flow handle a prospect, without a second assistant reply', async () => {
    mockFunnel.mockResolvedValue(true);
    await processPlatformIncoming(job('I want to know about GST billing'));
    expect(mockFunnel).toHaveBeenCalledWith(expect.objectContaining({ from: PHONE }), expect.any(Function), { knownUser: false });
    expect(mockAnswerTurn).not.toHaveBeenCalled();
  });

  it('tells the flow when the sender is a registered user', async () => {
    user = { user_id: USER, business_id: BIZ };
    await processPlatformIncoming(job('how do I create an invoice?'));
    expect(mockFunnel).toHaveBeenCalledWith(expect.anything(), expect.any(Function), { knownUser: true });
    expect(mockAnswerTurn).toHaveBeenCalled();
  });

  it('falls back to the assistant when the sales flow fails', async () => {
    mockFunnel.mockRejectedValue(new Error('db down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await processPlatformIncoming(job('hi'));
    spy.mockRestore();
    expect(mockAnswerTurn).toHaveBeenCalled();
  });

  it('never throws', async () => {
    mockSendText.mockRejectedValue(new Error('meta down'));
    await expect(processPlatformIncoming(job('hi'))).resolves.toBeUndefined();
  });
});
