jest.mock('@/lib/db', () => ({ queryRows: jest.fn(), query: jest.fn(), queryOne: jest.fn() }));

import { buildTsQuery, reciprocalRankFusion, scopeFilter, termCoverage } from '@/lib/rag/retrieve';

const row = (id: string, score = 0) => ({
  id,
  document_id: `doc-${id}`,
  title: `T${id}`,
  url: null,
  heading_path: '',
  content: '',
  score,
});

describe('scopeFilter', () => {
  it('restricts platform audiences to rows with no business', () => {
    const f = scopeFilter({ audience: 'prospect' }, 3);
    expect(f.sql).toContain('c.business_id IS NULL');
    expect(f.sql).toContain('$3');
    expect(f.params).toEqual(['prospect']);
  });

  it('requires and binds businessId for tenant_customer', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const f = scopeFilter({ audience: 'tenant_customer', businessId: id }, 2);
    expect(f.sql).toContain('c.business_id = $3::uuid');
    expect(f.params).toEqual(['tenant_customer', id]);
    expect(() => scopeFilter({ audience: 'tenant_customer' }, 1)).toThrow(/businessId/);
  });

  it('rejects a businessId on platform audiences and unknown audiences', () => {
    expect(() => scopeFilter({ audience: 'tenant_user', businessId: 'x' }, 1)).toThrow();
    expect(() => scopeFilter({ audience: 'hacker' as never }, 1)).toThrow(/Invalid audience/);
  });

  it('never interpolates the audience into SQL', () => {
    const f = scopeFilter({ audience: 'prospect' }, 1);
    expect(f.sql).not.toContain('prospect');
  });
});

describe('buildTsQuery', () => {
  it('ORs alternatives and prefixes longer tokens', () => {
    const q = buildTsQuery([
      { term: 'udhaar', alternatives: ['udhaar', 'credit'] },
      { term: 'gst', alternatives: ['gst'] },
    ]);
    expect(q).toBe('udhaar:* | credit:* | gst');
  });

  it('returns null for no terms', () => {
    expect(buildTsQuery([])).toBeNull();
  });

  it('strips tsquery operators from user input', () => {
    expect(buildTsQuery([{ term: 'x', alternatives: ["ab'|c&!(d):*"] }])).toBe('abcd:*');
  });

  it('keeps Devanagari tokens intact', () => {
    expect(buildTsQuery([{ term: 'बिल', alternatives: ['बिल'] }])).toBe('बिल');
  });
});

describe('termCoverage', () => {
  it('counts a group as hit when any alternative appears', () => {
    const groups = [
      { term: 'udhaar', alternatives: ['udhaar', 'credit'] },
      { term: 'reminder', alternatives: ['reminder'] },
    ];
    expect(termCoverage(groups, 'Send a credit reminder on WhatsApp')).toBe(1);
    expect(termCoverage(groups, 'Credit limits for customers')).toBe(0.5);
    expect(termCoverage([], 'anything')).toBe(0);
    expect(termCoverage([{ term: 'logins', alternatives: ['logins'] }], 'each with their own login')).toBe(1);
  });
});

describe('reciprocalRankFusion', () => {
  it('ranks items found by several methods above single-method hits', () => {
    const fused = reciprocalRankFusion([
      { name: 'vector', rows: [row('a', 0.8), row('b', 0.7)] },
      { name: 'text', rows: [row('b'), row('c')] },
      { name: 'trigram', rows: [row('b')] },
    ]);
    expect(fused[0].row.id).toBe('b');
    expect(fused[0].vectorRank).toBe(2);
    expect(fused[0].textRank).toBe(1);
    expect(fused.find((f) => f.row.id === 'a')?.vectorSimilarity).toBe(0.8);
    expect(fused.map((f) => f.row.id).sort()).toEqual(['a', 'b', 'c']);
  });
});
