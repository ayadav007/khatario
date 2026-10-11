/**
 * WhatsApp agent memory: facts taken from what the customer wrote, kept for the whole chat,
 * and shown again on the next reply.
 */
const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
jest.mock('@/lib/db', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  queryRows: jest.fn().mockResolvedValue([]),
}));

import {
  applyStoredAnswers,
  emptyAgentMemory,
  formatMemoryBlock,
  memoryFromTranscript,
  mergeAgentMemory,
  parseAgentMemory,
} from '@/lib/ai-agent/memory';

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
});

describe('facts from the customer message', () => {
  it('keeps a name the customer wrote, without a CUSTOMER tag', () => {
    const next = mergeAgentMemory(emptyAgentMemory(), {
      userMessage: 'My name is Asha Rao',
      assistantReply: 'Thanks Asha, how can I help?',
    });
    expect(next.facts.name).toBe('Asha Rao');
    expect(next.summary).toContain('Customer: My name is Asha Rao');
    expect(next.summary).not.toContain('CUSTOMER:');
  });

  it('treats a short reply as the name after the agent asked', () => {
    const next = mergeAgentMemory(emptyAgentMemory(), {
      userMessage: 'Asha',
      assistantReply: 'Thanks!',
      priorMessages: [{ role: 'assistant', content: 'May I know your name?' }],
    });
    expect(next.facts.name).toBe('Asha');
  });

  it('does not treat "I am looking for rice" as a name', () => {
    const next = mergeAgentMemory(emptyAgentMemory(), {
      userMessage: 'I am looking for rice',
      assistantReply: 'We have basmati.',
    });
    expect(next.facts.name).toBeUndefined();
    expect(next.facts.items).toEqual([]);
  });

  it('does not treat an order-number question as an item', () => {
    const next = mergeAgentMemory(emptyAgentMemory(), {
      userMessage: 'What is my order number?',
      assistantReply: 'It is SO-12.',
    });
    expect(next.facts.items).toEqual([]);
  });

  it('keeps email, phone and address once they have been given', () => {
    let memory = mergeAgentMemory(emptyAgentMemory(), {
      userMessage: 'My email is Asha@Example.com and my phone is 9876543210',
      assistantReply: 'Please share your delivery address.',
    });
    memory = mergeAgentMemory(memory, {
      userMessage: '12 MG Road, Pune 411001',
      assistantReply: 'Got it.',
      priorMessages: [{ role: 'assistant', content: 'Please share your delivery address.' }],
    });
    expect(memory.facts.email).toBe('asha@example.com');
    expect(memory.facts.phone).toBe('9876543210');
    expect(memory.facts.address).toBe('12 MG Road, Pune 411001');
    expect(memory.facts.name).toBeUndefined();
  });

  it('does not ask again for a name already saved when a later message has none', () => {
    const saved = mergeAgentMemory(emptyAgentMemory(), {
      userMessage: 'My name is Ravi',
      assistantReply: 'Hi Ravi',
    });
    const next = mergeAgentMemory(saved, {
      userMessage: 'What is the price of hair oil?',
      assistantReply: 'Hair oil is ₹300.',
    });
    expect(next.facts.name).toBe('Ravi');
    expect(formatMemoryBlock(next)).toContain('Name: Ravi');
    expect(formatMemoryBlock(next)).toContain('never ask for these again');
  });

  it('reads the CUSTOMER tag and order lines from the agent reply', () => {
    const next = mergeAgentMemory(emptyAgentMemory(), {
      userMessage: 'Yes, place it',
      assistantReply:
        'Done. CUSTOMER: {"name":"Asha Rao","email":"asha@example.com"} CREATE_ORDER: [{"name":"Hair Oil","qty":2}]',
    });
    expect(next.facts.name).toBe('Asha Rao');
    expect(next.facts.email).toBe('asha@example.com');
    expect(next.facts.items).toEqual([{ name: 'Hair Oil', quantity: 2 }]);
    expect(next.summary).not.toContain('CREATE_ORDER');
  });

  it('keeps lead answers and the saved chat name', () => {
    const memory = applyStoredAnswers(emptyAgentMemory(), {
      customer_name: 'Asha',
      budget: '5000',
    });
    const next = mergeAgentMemory(memory, {
      userMessage: 'I need 2 hair oil',
      assistantReply: 'Sure.',
      leadData: { city: 'Pune' },
    });
    expect(next.facts.name).toBe('Asha');
    expect(next.leadAnswers).toEqual({ budget: '5000', city: 'Pune' });
    expect(next.facts.items[0].name).toBe('hair oil');
    expect(formatMemoryBlock(next)).toContain('budget: 5000');
  });
});

describe('transcript rebuild', () => {
  it('rebuilds facts from earlier messages in the chat', () => {
    const memory = memoryFromTranscript([
      { role: 'assistant', content: 'May I know your name?' },
      { role: 'user', content: 'Asha' },
      { role: 'assistant', content: 'Thanks Asha. What do you need?' },
      { role: 'user', content: 'I want hair oil' },
      { role: 'assistant', content: 'We have hair oil at ₹300.' },
    ]);
    expect(memory.facts.name).toBe('Asha');
    expect(memory.facts.items.map((item) => item.name)).toContain('hair oil');
    expect(memory.summary).toContain('Customer: Asha');
    expect(memory.summary).toContain('Customer: I want hair oil');
  });

  it('ignores a broken saved value', () => {
    expect(parseAgentMemory('not-json')).toEqual(emptyAgentMemory());
    expect(parseAgentMemory({ summary: 'Hi', facts: { name: 'Ravi', items: [] }, leadAnswers: {} }).facts.name).toBe('Ravi');
  });
});
