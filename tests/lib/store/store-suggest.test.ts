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

  it('applies the out-of-stock place to products only, and not at all by default', () => {
    const plain = buildSuggestQuery('b1', 'milk')!;
    expect(buildSuggestQuery('b1', 'milk', 'stay')).toEqual(plain);
    expect(plain.products.sql).not.toContain('ovs');
    const hide = buildSuggestQuery('b1', 'milk', 'hide')!;
    expect(hide.products.sql).toContain('AND NOT (CASE WHEN COALESCE(i.has_variants, false)');
    expect(hide.products.params).toEqual(plain.products.params);
    const end = buildSuggestQuery('b1', 'milk', 'end')!;
    expect(end.categories).toEqual(plain.categories);
    expect(end.products.sql).toMatch(/ORDER BY CASE WHEN \(CASE WHEN COALESCE\(i\.has_variants, false\)[\s\S]*THEN 1 ELSE 0 END, CASE WHEN/);
    assertQueryBinds(hide.products.sql, hide.products.params);
    assertQueryBinds(end.products.sql, end.products.params);
  });

  it('under hide, suggests only categories that still have an in-stock product', () => {
    const plain = buildSuggestQuery('b1', 'milk')!;
    const hide = buildSuggestQuery('b1', 'milk', 'hide')!;
    expect(plain.categories.sql).not.toContain('ovs');
    expect(hide.categories.sql).toMatch(/AND EXISTS \(SELECT 1 FROM items i WHERE[\s\S]*?i\.deleted_at IS NULL\s+AND NOT \(CASE WHEN COALESCE\(i\.has_variants, false\)/);
    expect(hide.categories.params).toEqual(plain.categories.params);
    assertQueryBinds(hide.categories.sql, hide.categories.params);
  });
});
