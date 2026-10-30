import { assertQueryBinds } from '@/lib/store/store-items-query';
import { buildSuggestQuery, escapeLike } from '@/lib/store/store-suggest';

describe('store suggest', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('100%_off')).toBe('100\\%\\_off');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
    const q = buildSuggestQuery('b1', '100%_off')!;
    expect(q.products.params).toContain('100\\%\\_off%');
    expect(q.products.params).toContain('%100\\%\\_off%');
    expect(q.products.sql).toContain("ESCAPE '\\'");
    assertQueryBinds(q.products.sql, q.products.params);
    assertQueryBinds(q.categories.sql, q.categories.params);
  });

  it('returns null under 2 characters', () => {
    expect(buildSuggestQuery('b1', ' a ')).toBeNull();
    expect(buildSuggestQuery('b1', '')).toBeNull();
  });

  it('ranks word-start matches first and keeps visibility rules', () => {
    const q = buildSuggestQuery('b1', 'milk')!;
    expect(q.products.sql).toMatch(/ORDER BY[\s\S]*CASE WHEN/);
    expect(q.products.sql).toContain('i.show_in_store = true');
    expect(q.products.sql).toContain('LIMIT 6');
    expect(q.categories.sql).toContain('LIMIT 3');
    expect(q.categories.sql).toContain('c.business_id = $1');
    expect(q.categories.sql).toContain('i.deleted_at IS NULL');
  });

  it('cuts q to 60 chars', () => {
    const q = buildSuggestQuery('b1', 'x'.repeat(100))!;
    expect(q.products.params).toContain('x'.repeat(60) + '%');
  });
});
