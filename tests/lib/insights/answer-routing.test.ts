jest.mock('@/lib/rag/conversations', () => ({
  createConversation: jest.fn(async () => ({ id: 'conv-1' })),
  findOwnedConversation: jest.fn(async () => null),
  insertMessage: jest.fn(async () => 'msg-1'),
  loadHistory: jest.fn(async () => []),
}));
jest.mock('@/lib/rag/settings', () => ({ withinDailyBudget: jest.fn(async () => true) }));
jest.mock('@/lib/rag/retrieve', () => ({ retrieve: jest.fn(async () => ({ chunks: [], confident: false, diagnostics: {} })) }));
jest.mock('@/lib/insights/turn', () => ({
  NOT_OWNER_TEXT: 'owner only',
  canSeeBusinessData: jest.fn(),
  runInsights: jest.fn(),
}));

import { answerTurn, type AnswerEvent } from '@/lib/rag/answer';
import { insertMessage } from '@/lib/rag/conversations';
import { retrieve } from '@/lib/rag/retrieve';
import { canSeeBusinessData, runInsights } from '@/lib/insights/turn';

const BIZ = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

async function collect(message: string, audience: 'tenant_user' | 'prospect' = 'tenant_user') {
  const events: AnswerEvent[] = [];
  for await (const ev of answerTurn({ message, channel: 'in_app', audience, userId: USER, businessId: BIZ })) events.push(ev);
  return events;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GROQ_API_KEY = '';
  process.env.GEMINI_API_KEY = '';
});

it('staff asking for figures get the owner-only reply and no data is read', async () => {
  (canSeeBusinessData as jest.Mock).mockResolvedValue(false);
  const events = await collect('How was sale today?');
  expect(events).toContainEqual({ type: 'delta', text: 'owner only' });
  expect(runInsights).not.toHaveBeenCalled();
  expect(retrieve).not.toHaveBeenCalled();
});

it('the owner gets insight cards, stored on the message for restore', async () => {
  (canSeeBusinessData as jest.Mock).mockResolvedValue(true);
  const cards = [{ title: 'Sales: Today', rows: [{ label: 'Sales', value: '₹1,000' }] }];
  (runInsights as jest.Mock).mockResolvedValue({
    kind: 'data', text: '**Sales: Today**', cards, calls: [{ name: 'sales_summary', args: { period: 'today' } }], usage: null,
  });
  const events = await collect('aaj kitna sale hua');
  expect(events).toContainEqual({ type: 'insight', cards });
  expect(retrieve).not.toHaveBeenCalled();
  const stored = (insertMessage as jest.Mock).mock.calls.find((c) => c[0].role === 'assistant')[0];
  expect(stored.action).toEqual({ type: 'insight', cards });
  expect(stored.retrieval.toolCalls).toEqual([{ name: 'sales_summary', args: { period: 'today' } }]);
});

it('how-to questions still go to the guides', async () => {
  (canSeeBusinessData as jest.Mock).mockResolvedValue(true);
  await collect('How do I create a sales invoice?');
  expect(runInsights).not.toHaveBeenCalled();
  expect(retrieve).toHaveBeenCalled();
});

it('prospects never reach the insights route', async () => {
  await collect('How was sale today?', 'prospect');
  expect(canSeeBusinessData).not.toHaveBeenCalled();
  expect(runInsights).not.toHaveBeenCalled();
});
