import { defaultSettings, sanitizeSettings, sanitizeSettingValue } from '@/lib/store/engine/settings';
import type { SettingSchema, SettingType } from '@/lib/store/engine/schema-types';

const s = (type: SettingType, extra: Partial<SettingSchema> = {}): SettingSchema => ({ id: 'x', type, label: 'X', ...extra });
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('sanitizeSettingValue', () => {
  it('text clips, trims and rejects non-strings', () => {
    expect(sanitizeSettingValue(s('text'), '  hi  ')).toBe('hi');
    expect(sanitizeSettingValue(s('text'), 'a'.repeat(300))).toHaveLength(200);
    expect(sanitizeSettingValue(s('text', { max_length: 5 }), 'abcdefgh')).toBe('abcde');
    expect(sanitizeSettingValue(s('text'), 5)).toBeUndefined();
  });

  it('textarea clips to 2000 by default', () => {
    expect(sanitizeSettingValue(s('textarea'), 'a'.repeat(3000))).toHaveLength(2000);
    expect(sanitizeSettingValue(s('textarea', { max_length: 10 }), 'a'.repeat(30))).toHaveLength(10);
  });

  it('richtext keeps allowed tags and strips scripts, handlers and javascript hrefs', () => {
    const t = s('richtext');
    expect(sanitizeSettingValue(t, '<p><strong>x</strong></p>')).toBe('<p><strong>x</strong></p>');
    expect(sanitizeSettingValue(t, '<p onclick="a()">x</p><script>alert(1)</script>')).toBe('<p>x</p>');
    const link = sanitizeSettingValue(t, '<a href="javascript:x">go</a>') as string;
    expect(link).not.toContain('href');
    expect(sanitizeSettingValue(t, '<div>a</div><img src=x>')).toBe('a');
    expect(sanitizeSettingValue(t, 1)).toBeUndefined();
  });

  it('number and range clamp; range rounds to step', () => {
    expect(sanitizeSettingValue(s('number', { min: 0, max: 10 }), 50)).toBe(10);
    expect(sanitizeSettingValue(s('number', { min: 0, max: 10 }), -5)).toBe(0);
    expect(sanitizeSettingValue(s('number'), 'abc')).toBeUndefined();
    expect(sanitizeSettingValue(s('range', { min: 0, max: 100, step: 5 }), 52)).toBe(50);
    expect(sanitizeSettingValue(s('range', { min: 0, max: 100, step: 5 }), 999)).toBe(100);
    expect(sanitizeSettingValue(s('range'), 'abc')).toBeUndefined();
  });

  it('checkbox keeps only booleans', () => {
    expect(sanitizeSettingValue(s('checkbox'), true)).toBe(true);
    expect(sanitizeSettingValue(s('checkbox'), false)).toBe(false);
    expect(sanitizeSettingValue(s('checkbox'), 'true')).toBeUndefined();
    expect(sanitizeSettingValue(s('checkbox'), 1)).toBeUndefined();
  });

  it('select and radio require a listed option', () => {
    const opts = [{ value: 'a', label: 'A' }];
    expect(sanitizeSettingValue(s('select', { options: opts }), 'a')).toBe('a');
    expect(sanitizeSettingValue(s('select', { options: opts }), 'b')).toBeUndefined();
    expect(sanitizeSettingValue(s('radio', { options: opts }), 'b')).toBeUndefined();
    expect(sanitizeSettingValue(s('radio'), 'a')).toBeUndefined();
  });

  it('color accepts hex and empty only', () => {
    for (const ok of ['#abc', '#aabbcc', '#aabbccdd', '']) expect(sanitizeSettingValue(s('color'), ok)).toBe(ok);
    for (const bad of ['red', 'url(x)', '#abcd', 5]) expect(sanitizeSettingValue(s('color'), bad)).toBeUndefined();
  });

  it('image accepts https and root-relative, rejects data: and javascript:', () => {
    const t = s('image');
    expect(sanitizeSettingValue(t, 'https://cdn.x.com/a.png')).toBe('https://cdn.x.com/a.png');
    expect(sanitizeSettingValue(t, '/uploads/a.png')).toBe('/uploads/a.png');
    expect(sanitizeSettingValue(t, 'data:image/png;base64,AAAA')).toBeUndefined();
    expect(sanitizeSettingValue(t, 'data:image/svg+xml,<svg/>')).toBeUndefined();
    expect(sanitizeSettingValue(t, 'javascript:alert(1)')).toBeUndefined();
    expect(sanitizeSettingValue(t, '//evil.com/a.png')).toBeUndefined();
    expect(sanitizeSettingValue(t, 'http://x.com/a.png')).toBeUndefined();
  });

  it('url accepts internal paths, https and anchors; rejects javascript and protocol-relative', () => {
    const t = s('url');
    for (const ok of ['/', '/pages/sale', `/products/${U1}`, 'https://x.y', '#catalog']) {
      expect(sanitizeSettingValue(t, ok)).toBe(ok);
    }
    expect(sanitizeSettingValue(t, 'javascript:alert(1)')).toBeUndefined();
    expect(sanitizeSettingValue(t, '//evil.com')).toBeUndefined();
  });

  it('video_url allows only youtube and vimeo over https', () => {
    const t = s('video_url');
    expect(sanitizeSettingValue(t, 'https://www.youtube.com/watch?v=abc')).toBeTruthy();
    expect(sanitizeSettingValue(t, 'https://youtu.be/abc')).toBeTruthy();
    expect(sanitizeSettingValue(t, 'https://vimeo.com/123')).toBeTruthy();
    expect(sanitizeSettingValue(t, 'http://youtube.com/watch?v=abc')).toBeUndefined();
    expect(sanitizeSettingValue(t, 'https://evil.com/youtube.com')).toBeUndefined();
    expect(sanitizeSettingValue(t, 'https://youtube.com.evil.com/x')).toBeUndefined();
  });

  it('product and category take a uuid; lists dedupe and cap at 50', () => {
    expect(sanitizeSettingValue(s('product'), U1)).toBe(U1);
    expect(sanitizeSettingValue(s('category'), 'nope')).toBeUndefined();
    expect(sanitizeSettingValue(s('product_list'), [U1, U1, 'bad', U2])).toEqual([U1, U2]);
    expect(sanitizeSettingValue(s('category_list'), 'x')).toBeUndefined();
    const many = Array.from({ length: 80 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(sanitizeSettingValue(s('product_list'), many) as string[]).toHaveLength(50);
  });

  it('icon and font are allow-listed', () => {
    expect(sanitizeSettingValue(s('icon'), 'truck')).toBe('truck');
    expect(sanitizeSettingValue(s('icon'), 'rocket')).toBeUndefined();
    expect(sanitizeSettingValue(s('font'), 'playfair')).toBe('playfair');
    expect(sanitizeSettingValue(s('font'), 'comic-sans')).toBeUndefined();
  });

  it('html returns empty string until Task 2', () => {
    expect(sanitizeSettingValue(s('html'), '<script>x</script>')).toBe('');
  });
});

describe('sanitizeSettings and defaultSettings', () => {
  const schemas: SettingSchema[] = [
    { id: 'h', type: 'header', label: 'Heading' },
    { id: 'title', type: 'text', label: 'Title', default: 'Hello' },
    { id: 'show', type: 'checkbox', label: 'Show' },
  ];

  it('drops unknown keys, header ids and invalid values', () => {
    expect(sanitizeSettings(schemas, { h: 'x', title: ' T ', show: 'yes', evil: 1 })).toEqual({ title: 'T' });
    expect(sanitizeSettings(schemas, null)).toEqual({});
    expect(sanitizeSettings(schemas, [1])).toEqual({});
  });

  it('defaultSettings returns defaults and skips undefined and header', () => {
    expect(defaultSettings(schemas)).toEqual({ title: 'Hello' });
  });
});
