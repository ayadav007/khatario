/**
 * Owner knowledge for the shop agent (FAQs, notes, uploaded files): kept to one business,
 * only active items reach the index, edits trigger a re-index, and FAQ matching is literal.
 */
const mockNoteChanged = jest.fn();

jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn() }));
jest.mock('@/lib/rag/tenant-reindex', () => ({
  noteAgentKnowledgeChanged: (...a: unknown[]) => mockNoteChanged(...a),
}));

import { query, queryOne, queryRows } from '@/lib/db';
import {
  agentKnowledgeDocument,
  loadTenantFaqSource,
  loadTenantFileSource,
  loadTenantTextSource,
} from '@/lib/rag/ingest/tenant-sources';
import {
  createKnowledge,
  deleteKnowledge,
  matchFaqs,
  parseKnowledgeInput,
  updateKnowledge,
  validateKnowledge,
} from '@/lib/ai-agent/knowledge';

const mQueryRows = queryRows as jest.Mock;
const mQueryOne = queryOne as jest.Mock;
const mQuery = query as jest.Mock;
const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';

const row = (over: Record<string, unknown> = {}) => ({
  id: ITEM,
  kind: 'faq',
  title: null,
  question: 'Do you deliver on Sunday?',
  answer: 'Yes, 10am to 2pm.',
  content: null,
  file_name: null,
  file_size: null,
  status: 'active',
  created_at: new Date('2026-10-01T00:00:00Z'),
  updated_at: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mQueryRows.mockResolvedValue([]);
  mQuery.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe('knowledge loaders', () => {
  it.each([
    ['faq', loadTenantFaqSource, 'tenant_faq'],
    ['text', loadTenantTextSource, 'tenant_text'],
    ['file', loadTenantFileSource, 'tenant_file'],
  ] as const)('%s: reads only active rows of that business and tags the source with it', async (kind, load, sourceKind) => {
    const src = await load(BIZ_A);
    const [sql, params] = mQueryRows.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('business_id = $1');
    expect(sql).toContain("status = 'active'");
    expect(params).toEqual([BIZ_A, kind]);
    expect(params).not.toContain(BIZ_B);
    expect(src).toMatchObject({ kind: sourceKind, businessId: BIZ_A, audiences: ['tenant_customer'] });
  });

  it('builds customer-only documents and skips empty rows', () => {
    expect(agentKnowledgeDocument(row() as never)).toMatchObject({
      docKey: `faq:${ITEM}`,
      audiences: ['tenant_customer'],
      body: '# Do you deliver on Sunday?\n\nYes, 10am to 2pm.',
    });
    expect(agentKnowledgeDocument(row({ answer: '  ' }) as never)).toBeNull();
    const file = agentKnowledgeDocument(row({ kind: 'file', content: 'x'.repeat(100_000), file_name: 'menu.pdf' }) as never);
    expect(file?.title).toBe('menu.pdf');
    expect(file!.body.length).toBeLessThan(61_000);
  });
});

describe('knowledge writes', () => {
  it('validates required fields per kind', () => {
    expect(validateKnowledge({ kind: 'faq', question: 'Q?', answer: '' })).toBe('Enter the answer');
    expect(validateKnowledge({ kind: 'text', content: '   ' })).toBe('Add some text');
    expect(validateKnowledge({ kind: 'bogus' as never })).toBe('Unknown knowledge type');
    expect(validateKnowledge({ kind: 'faq', question: 'Q?', answer: 'A' })).toBeNull();
  });

  it('clips oversized input', () => {
    const parsed = parseKnowledgeInput({ kind: 'faq', question: 'q'.repeat(1000), answer: 'a'.repeat(5000), status: 'weird' });
    expect(parsed.question).toHaveLength(300);
    expect(parsed.answer).toHaveLength(2000);
    expect(parsed.status).toBe('active');
  });

  it('scopes update and delete to the business and re-indexes only on change', async () => {
    mQueryOne.mockResolvedValueOnce(null);
    await expect(updateKnowledge(BIZ_B, ITEM, { answer: 'hacked' })).resolves.toBeNull();
    expect((mQueryOne.mock.calls[0] as [string, unknown[]])[1].slice(0, 2)).toEqual([BIZ_B, ITEM]);
    expect(mockNoteChanged).not.toHaveBeenCalled();

    mQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(deleteKnowledge(BIZ_B, ITEM)).resolves.toBe(false);
    expect(mQuery.mock.calls[0][0]).toContain('business_id = $1 AND id = $2');
    expect(mockNoteChanged).not.toHaveBeenCalled();

    mQueryOne.mockResolvedValueOnce(row());
    await createKnowledge(BIZ_A, { kind: 'faq', question: 'Q', answer: 'A' }, null);
    expect(mockNoteChanged).toHaveBeenCalledWith(BIZ_A, 'ai_agent_knowledge');
  });
});

describe('matchFaqs', () => {
  it('matches on meaningful words and ignores filler', async () => {
    mQueryRows.mockResolvedValue([
      { question: 'Do you deliver on Sunday?', answer: 'Yes' },
      { question: 'What is your return policy?', answer: '7 days' },
    ]);
    const hits = await matchFaqs(BIZ_A, 'sunday deliver hoti hai?');
    expect(hits.map((h) => h.question)).toEqual(['Do you deliver on Sunday?']);
    expect((mQueryRows.mock.calls[0] as [string, unknown[]])[1]).toEqual([BIZ_A]);
  });

  it('skips the database for messages with no real words', async () => {
    await expect(matchFaqs(BIZ_A, 'hi?')).resolves.toEqual([]);
    expect(mQueryRows).not.toHaveBeenCalled();
  });
});
