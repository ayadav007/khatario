import { asString, asStringArray, parseFrontmatter } from '@/lib/rag/ingest/frontmatter';

describe('parseFrontmatter', () => {
  it('parses scalars, inline lists and block lists', () => {
    const src = [
      '---',
      'title: "Billing & invoicing"',
      'audience: [prospect, tenant_user]',
      'locale: hinglish',
      'tags:',
      '  - invoice',
      '  - gst',
      'draft: false',
      '---',
      '# Body',
      'Text',
    ].join('\n');
    const { data, body } = parseFrontmatter(src);
    expect(data.title).toBe('Billing & invoicing');
    expect(data.audience).toEqual(['prospect', 'tenant_user']);
    expect(data.locale).toBe('hinglish');
    expect(data.tags).toEqual(['invoice', 'gst']);
    expect(data.draft).toBe(false);
    expect(body).toBe('# Body\nText');
  });

  it('returns the whole text as body when there is no frontmatter', () => {
    expect(parseFrontmatter('# Just markdown')).toEqual({ data: {}, body: '# Just markdown' });
  });

  it('handles CRLF and BOM', () => {
    const { data, body } = parseFrontmatter('\uFEFF---\r\ntitle: X\r\n---\r\nHello');
    expect(data.title).toBe('X');
    expect(body).toBe('Hello');
  });

  it('coerces helper values', () => {
    expect(asStringArray('prospect')).toEqual(['prospect']);
    expect(asStringArray(undefined)).toEqual([]);
    expect(asString('  x ')).toBe('x');
    expect(asString(3)).toBeNull();
  });
});
