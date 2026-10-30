import { sanitizeCustomHtml, CUSTOM_HTML_MAX } from '@/lib/store/engine/html';

describe('sanitizeCustomHtml', () => {
  it('removes dangerous tags and attributes', () => {
    const out = sanitizeCustomHtml(
      '<p>hi</p><script>alert(1)</script><style>p{}</style><img src="https://a.com/x.png" onerror="x()"><a href="javascript:alert(1)">l</a><object data="x"></object><embed src="x"><form><input name="a"></form>',
    );
    expect(out).toContain('<p>hi</p>');
    for (const bad of ['<script', '<style', 'onerror', 'javascript:', '<object', '<embed', '<form', '<input', 'alert(1)']) {
      expect(out).not.toContain(bad);
    }
    expect(out).toContain('src="https://a.com/x.png"');
  });

  it('keeps the allowed structural tags', () => {
    const html =
      '<section><div class="a"><span>s</span><h1>1</h1><h6>6</h6><ul><li>x</li></ul><ol><li>y</li></ol><table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table><figure><figcaption>c</figcaption></figure><blockquote>q</blockquote><strong>b</strong><em>i</em><br /><hr /></div></section>';
    const out = sanitizeCustomHtml(html);
    for (const t of ['section', 'div', 'span', 'h1', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'blockquote', 'strong', 'em']) {
      expect(out).toContain(`<${t}`);
    }
    expect(out).toContain('<br />');
    expect(out).toContain('<hr />');
    expect(out).toContain('class="a"');
  });

  it('keeps style but drops values with url( or expression(', () => {
    expect(sanitizeCustomHtml('<p style="color:red">a</p>')).toContain('style="color:red"');
    expect(sanitizeCustomHtml('<p style="background:url(https://x.com/a.png)">a</p>')).not.toContain('style');
    expect(sanitizeCustomHtml('<p style="width:expression(alert(1))">a</p>')).not.toContain('style');
  });

  it('keeps allowed iframes with forced sandbox and lazy loading', () => {
    const out = sanitizeCustomHtml('<iframe src="https://www.youtube.com/embed/abc" sandbox="allow-top-navigation" loading="eager"></iframe>');
    expect(out).toContain('src="https://www.youtube.com/embed/abc"');
    expect(out).toContain('sandbox="allow-scripts allow-same-origin allow-presentation"');
    expect(out).toContain('loading="lazy"');
    expect(out).not.toContain('allow-top-navigation');
  });

  it('allows the nocookie and maps embed prefixes only', () => {
    expect(sanitizeCustomHtml('<iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe>')).toContain('<iframe');
    expect(sanitizeCustomHtml('<iframe src="https://www.google.com/maps/embed?pb=1"></iframe>')).toContain('<iframe');
    expect(sanitizeCustomHtml('<iframe src="https://www.google.com/search?q=1"></iframe>')).not.toContain('<iframe');
    expect(sanitizeCustomHtml('<iframe src="https://www.youtube.com/watch?v=1"></iframe>')).not.toContain('<iframe');
  });

  it('removes embeds that escape their path through dot segments or lookalike paths', () => {
    for (const src of [
      'https://www.youtube.com/embed/../../redirect?q=https://evil.com',
      'https://www.google.com/maps/embed/../../url?q=https://evil.com',
      'https://www.google.com/maps/embed/&#x2e;&#x2e;/&#x2e;&#x2e;/url?q=https://evil.com',
      'https://www.youtube.com/embed/&#x2e;&#x2e;/&#x2e;&#x2e;/redirect?q=https://evil.com',
      'https://www.google.com/maps/embedx',
    ]) {
      expect(sanitizeCustomHtml(`<iframe src="${src}"></iframe>`)).not.toContain('<iframe');
    }
    expect(sanitizeCustomHtml('<iframe src="https://www.youtube.com/embed/abc"></iframe>')).toContain('src="https://www.youtube.com/embed/abc"');
  });

  it('removes foreign iframes entirely', () => {
    expect(sanitizeCustomHtml('<p>a</p><iframe src="https://evil.com"></iframe>')).toBe('<p>a</p>');
  });

  it('cuts input over the limit before sanitising and rejects non-strings', () => {
    const out = sanitizeCustomHtml('a'.repeat(CUSTOM_HTML_MAX + 500));
    expect(out.length).toBe(CUSTOM_HTML_MAX);
    expect(sanitizeCustomHtml(undefined)).toBe('');
    expect(sanitizeCustomHtml(42)).toBe('');
  });

  it('drops an inline style that can fetch or execute, and keeps a harmless one', () => {
    const denied = [
      'background:url(https://a.com/x.png)',
      'width:expression(alert(1))',
      '@import "x"',
      'background:javascript:alert(1)',
      'behavior:url(x.htc)',
      '-moz-binding:x',
      'color:\\72ed',
    ];
    for (const style of denied) {
      const out = sanitizeCustomHtml(`<div style="${style}">x</div>`);
      expect(out).toContain('<div');
      expect(out).not.toContain('style=');
    }
    expect(sanitizeCustomHtml('<div style="color:red">x</div>')).toContain('style="color:red"');
  });
});
