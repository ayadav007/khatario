/**
 * Evening summary timing and delivery (QR text, Cloud 24-hour window, template), and the owner
 * job gates: subscription, primary admin, rate limit, and the LINK flow.
 */
const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
const mockSendText = jest.fn();
const mockSendTemplate = jest.fn();
const mockTransport = jest.fn();
const mockCanSee = jest.fn();
const mockRunTool = jest.fn();
const mockAnswerTurn = jest.fn();
const mockOperational = jest.fn();

jest.mock('@/lib/db', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  queryRows: jest.fn(),
}));
jest.mock('@/lib/queue', () => ({ addWhatsAppMessageJob: jest.fn() }));
jest.mock('@/lib/meta-whatsapp', () => ({
  buildGraphComponents: jest.fn(),
  createMessageTemplate: jest.fn(),
  listMessageTemplates: jest.fn(),
  mapMetaStatus: (s: string) => String(s).toLowerCase(),
}));
jest.mock('@/lib/whatsapp/business-transport', () => ({
  ASSISTANT_MARKER: '\u2063',
  isAssistantEcho: (t: string | null) => typeof t === 'string' && t.startsWith('\u2063'),
  businessTransport: (...a: unknown[]) => mockTransport(...a),
  sendBusinessText: (...a: unknown[]) => mockSendText(...a),
  sendBusinessTemplate: (...a: unknown[]) => mockSendTemplate(...a),
}));
jest.mock('@/lib/insights/turn', () => ({ canSeeBusinessData: (...a: unknown[]) => mockCanSee(...a) }));
jest.mock('@/lib/insights/tools', () => ({ runInsightTool: (...a: unknown[]) => mockRunTool(...a) }));
jest.mock('@/lib/rag/answer', () => ({ answerTurn: (...a: unknown[]) => mockAnswerTurn(...a) }));
jest.mock('@/lib/security/require-operational-subscription', () => ({
  assertOperationalSubscription: (...a: unknown[]) => mockOperational(...a),
}));

import { chooseDelivery, isSummaryDue, nowIst, sendOwnerSummary, summaryTemplateVars } from '@/lib/whatsapp/owner-summary';
import { OWNER_MESSAGES_PER_HOUR, processOwnerCommand } from '@/lib/whatsapp/owner-command';
import { clearOwnerLinkCache } from '@/lib/whatsapp/inbound-router';
import type { OwnerCommandQueueJob } from '@/lib/whatsapp-queue-types';

const BIZ = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OWNER = '919811111111';
// 21:30 IST on 2 Oct 2026
const EVENING = new Date('2026-10-02T16:00:00Z');

beforeEach(() => {
  jest.clearAllMocks();
  clearOwnerLinkCache();
  mockQuery.mockResolvedValue({ rowCount: 1 });
  mockCanSee.mockResolvedValue(true);
  mockOperational.mockResolvedValue({ ok: true });
  mockSendText.mockResolvedValue({ transport: 'baileys', messageId: 'X' });
  mockSendTemplate.mockResolvedValue({ messageId: 'T' });
  mockRunTool.mockResolvedValue({
    ok: true,
    cards: [{ title: 'Today', rows: [{ label: 'Sales', value: '₹1,180' }] }],
    data: { sales: { sales_with_tax: 1180, invoice_count: 3 }, received: 500, overdueReceivable: { age_0_30: 100, age_30_60: 0, age_60_90: 0, age_90_plus: 50 } },
  });
});

describe('summary timing', () => {
  it('reads Indian date and time', () => {
    expect(nowIst(EVENING)).toEqual({ date: '2026-10-02', time: '21:30' });
    expect(nowIst(new Date('2026-10-02T19:00:00Z'))).toEqual({ date: '2026-10-03', time: '00:30' });
  });

  const l = { daily_summary_enabled: true, linked_phone: OWNER, daily_summary_time: '21:00', last_summary_sent_on: null };
  it('is due once the time has passed and nothing was sent today', () => {
    expect(isSummaryDue(l, EVENING)).toBe(true);
    expect(isSummaryDue({ ...l, daily_summary_time: '22:00:00' }, EVENING)).toBe(false);
    expect(isSummaryDue({ ...l, last_summary_sent_on: '2026-10-02' }, EVENING)).toBe(false);
    expect(isSummaryDue({ ...l, last_summary_sent_on: '2026-10-01' }, EVENING)).toBe(true);
    expect(isSummaryDue({ ...l, daily_summary_enabled: false }, EVENING)).toBe(false);
    expect(isSummaryDue({ ...l, linked_phone: null }, EVENING)).toBe(false);
  });
});

describe('chooseDelivery', () => {
  it('always uses text on QR', () => {
    expect(chooseDelivery('baileys', null, null, EVENING)).toBe('text');
  });
  it('uses text inside the 24-hour window on Cloud API', () => {
    expect(chooseDelivery('cloud', new Date(EVENING.getTime() - 3600_000), null, EVENING)).toBe('text');
  });
  it('needs an approved template outside the window', () => {
    const old = new Date(EVENING.getTime() - 24 * 3600_000);
    expect(chooseDelivery('cloud', old, 'approved', EVENING)).toBe('template');
    expect(chooseDelivery('cloud', old, 'pending', EVENING)).toBe('no_template');
    expect(chooseDelivery('cloud', null, null, EVENING)).toBe('no_template');
  });
  it('does not risk free text in the last minutes of the window', () => {
    expect(chooseDelivery('cloud', new Date(EVENING.getTime() - (24 * 3600_000 - 60_000)), null, EVENING)).toBe('no_template');
  });
});

describe('summaryTemplateVars', () => {
  it('fills all four variables, never empty', () => {
    expect(summaryTemplateVars({ sales: 125000, bills: 4, received: 0, overdue: null })).toEqual(['₹1,25,000', '4', '₹0', 'not on your plan']);
  });
});

describe('sendOwnerSummary', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    business_id: BIZ, user_id: USER, linked_phone: OWNER, daily_summary_enabled: true, daily_summary_time: '21:00:00',
    last_summary_sent_on: null, last_owner_message_at: null, template_status: null, ...over,
  });

  it('sends text over QR and marks the day', async () => {
    mockQueryOne.mockResolvedValueOnce(row());
    mockTransport.mockResolvedValue('baileys');
    expect(await sendOwnerSummary(BIZ, { now: EVENING })).toEqual({ sent: true, delivery: 'text' });
    expect(mockSendText).toHaveBeenCalledWith(BIZ, OWNER, expect.stringContaining('Today'));
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('last_summary_sent_on'), [BIZ, '2026-10-02', null]);
  });

  it('uses the template on Cloud API outside the window', async () => {
    mockQueryOne.mockResolvedValueOnce(row({ template_status: 'approved' }));
    mockTransport.mockResolvedValue('cloud');
    expect(await sendOwnerSummary(BIZ, { now: EVENING })).toEqual({ sent: true, delivery: 'template' });
    const [, , tpl] = mockSendTemplate.mock.calls[0];
    expect(tpl.name).toBe('khatario_daily_summary');
    expect(tpl.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(['₹1,180', '3', '₹500', '₹150']);
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('does not send when the template is missing', async () => {
    mockQueryOne.mockResolvedValueOnce(row());
    mockTransport.mockResolvedValue('cloud');
    expect(await sendOwnerSummary(BIZ, { now: EVENING })).toEqual({ sent: false, reason: 'no_template' });
    expect(mockSendText).not.toHaveBeenCalled();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it('refuses when the linked user is no longer the primary admin', async () => {
    mockQueryOne.mockResolvedValueOnce(row());
    mockCanSee.mockResolvedValue(false);
    expect(await sendOwnerSummary(BIZ, { now: EVENING })).toEqual({ sent: false, reason: 'not_owner' });
    expect(mockRunTool).not.toHaveBeenCalled();
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('marks the day after a send failure so it does not retry all night', async () => {
    mockQueryOne.mockResolvedValueOnce(row());
    mockTransport.mockResolvedValue('baileys');
    mockSendText.mockRejectedValueOnce(new Error('not connected'));
    expect(await sendOwnerSummary(BIZ, { now: EVENING })).toEqual({ sent: false, reason: 'failed', error: 'not connected' });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('last_summary_sent_on'), [BIZ, '2026-10-02', 'not connected']);
  });
});

describe('processOwnerCommand', () => {
  const job = (over: Partial<OwnerCommandQueueJob> = {}): OwnerCommandQueueJob => ({
    type: 'owner-command', kind: 'owner', provider: 'baileys', businessId: BIZ, messageId: 'M1',
    conversationId: `owner_${OWNER}`, timestamp: Date.now(), from: OWNER, text: 'sales today', selfChat: false, ...over,
  });
  const linked = { business_id: BIZ, user_id: USER, linked_phone: OWNER, self_chat: false, link_code: null, link_code_expires_at: null };

  async function* reply(text: string) {
    yield { type: 'delta', text };
  }

  it('answers the owner through answerTurn as tenant_owner on WhatsApp', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM owner_whatsapp_links')) return linked;
      if (sql.includes('COUNT(*)')) return { n: '1' };
      return null;
    });
    mockAnswerTurn.mockImplementation(() => reply('**Sales today** ₹1,180 [1]'));
    await processOwnerCommand(job());
    expect(mockAnswerTurn).toHaveBeenCalledWith(expect.objectContaining({ channel: 'whatsapp', audience: 'tenant_owner', businessId: BIZ, userId: USER, textFormat: 'whatsapp' }));
    expect(mockSendText).toHaveBeenCalledWith(BIZ, OWNER, '*Sales today* ₹1,180');
  });

  it('pauses when the linked user is not the primary admin', async () => {
    mockQueryOne.mockResolvedValue(linked);
    mockCanSee.mockResolvedValue(false);
    await processOwnerCommand(job());
    expect(mockAnswerTurn).not.toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalledWith(BIZ, OWNER, expect.stringContaining('paused'));
  });

  it('does nothing for a business without an active subscription', async () => {
    mockOperational.mockResolvedValue({ ok: false });
    await processOwnerCommand(job());
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('rate limits, telling the owner only once', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes('COUNT(*)') ? { n: String(OWNER_MESSAGES_PER_HOUR + 1) } : linked));
    await processOwnerCommand(job());
    expect(mockSendText).toHaveBeenCalledTimes(1);
    expect(mockSendText).toHaveBeenCalledWith(BIZ, OWNER, expect.stringContaining('try again'));

    mockSendText.mockClear();
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes('COUNT(*)') ? { n: String(OWNER_MESSAGES_PER_HOUR + 2) } : linked));
    await processOwnerCommand(job());
    expect(mockSendText).not.toHaveBeenCalled();
    expect(mockAnswerTurn).not.toHaveBeenCalled();
  });

  it('links with a valid code and confirms', async () => {
    mockQueryOne.mockResolvedValue({ ...linked, linked_phone: null, link_code: '1234', link_code_expires_at: new Date(Date.now() + 600_000).toISOString() });
    await processOwnerCommand(job({ kind: 'link', text: 'LINK 1234' }));
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('SET linked_phone'), [BIZ, OWNER, false, '1234']);
    expect(mockSendText).toHaveBeenCalledWith(BIZ, OWNER, expect.stringContaining('Linked'));
  });

  it('does not link or reply when the code was already used', async () => {
    mockQueryOne.mockResolvedValue({ ...linked, link_code: '1234', link_code_expires_at: new Date(Date.now() + 600_000).toISOString() });
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    await processOwnerCommand(job({ kind: 'link', text: 'LINK 1234' }));
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('never throws, so a retry cannot send twice', async () => {
    mockQueryOne.mockRejectedValue(new Error('db down'));
    await expect(processOwnerCommand(job())).resolves.toBeUndefined();
  });
});
