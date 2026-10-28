import { previewStoreCss, sanitizeCssClass, scopeSectionCss, sectionDomId } from '@/lib/store/section-css';
import { sanitizeStudioSections } from '@/lib/store/studio-sections';

describe('scopeSectionCss', () => {
  it('prefixes every selector with the section wrapper id', () => {
    expect(scopeSectionCss('h2 { color: red } .st-btn, .price del { border-radius: 99px; }', 'banner-1')).toBe(
      '#section-banner-1 h2{color: red}#section-banner-1 .st-btn,#section-banner-1 .price del{border-radius: 99px;}',
    );
  });

  it('maps &, :scope, body and .st-root to the section box itself', () => {
    expect(scopeSectionCss('& { padding: 4px } :scope > div {} body .x {} .st-root .hero h1 {}', 'h')).toBe(
      '#section-h{padding: 4px}#section-h > div{}#section-h .x{}#section-h .hero h1{}',
    );
  });

  it('does not split commas inside :is() or attribute selectors', () => {
    expect(scopeSectionCss(':is(h1, h2) a[title="a,b"] { x: y }', 's')).toBe('#section-s :is(h1, h2) a[title="a,b"]{x: y}');
  });

  it('keeps @media rules scoped and copies @keyframes', () => {
    const out = scopeSectionCss('@media (max-width: 600px) { h2 { font-size: 20px } } @keyframes pop { from { opacity: 0 } to { opacity: 1 } }', 's');
    expect(out).toBe('@media (max-width: 600px){#section-s h2{font-size: 20px}}@keyframes pop{ from { opacity: 0 } to { opacity: 1 } }');
  });

  it('drops other at-rules, imports, scripts and comments', () => {
    const out = scopeSectionCss('@import url(x.css); @font-face { font-family: X } /* hi */ h2 { color: red }', 's');
    expect(out).toBe('#section-s h2{color: red}');
  });

  it('cannot break out of its scope with stray or unbalanced braces', () => {
    expect(scopeSectionCss('} body { display:none } h2 { color: red', 's')).toBe('#section-s{display:none}');
    expect(scopeSectionCss('}}}* { display: none }', 's')).toBe('#section-s *{display: none}');
  });

  it('cannot close the style tag', () => {
    const out = scopeSectionCss('h2 { content: "</style><script>alert(1)</script>" }', 's');
    expect(out).not.toMatch(/<\/?(style|script)/i);
    expect(out).not.toContain('<');
  });

  it('ignores braces inside strings', () => {
    expect(scopeSectionCss('h2::after { content: "}" } p { color: red }', 's')).toBe(
      '#section-s h2::after{content: "}"}#section-s p{color: red}',
    );
  });

  it('returns nothing for empty input', () => {
    expect(scopeSectionCss(undefined, 's')).toBe('');
    expect(scopeSectionCss('   ', 's')).toBe('');
  });

  it('uses a wrapper id that is always a valid CSS id', () => {
    expect(sectionDomId('1abc')).toBe('section-1abc');
  });
});

describe('previewStoreCss', () => {
  it('confines store-wide CSS to the preview root without changing selectors', () => {
    expect(previewStoreCss('.st-root .hero h1 { color: red } body { background: #000 } .product {}', '.ks-root .store')).toBe(
      '@scope (.ks-root .store){:scope .hero h1{color: red}:scope{background: #000}.product{}}',
    );
  });

  it('returns nothing when there is no usable rule', () => {
    expect(previewStoreCss('@import url(x.css);', '.x')).toBe('');
  });
});

describe('section class and CSS settings', () => {
  it('keeps up to three plain class names', () => {
    expect(sanitizeCssClass('.diwali  big-banner 9bad x"y a b')).toBe('diwali big-banner a');
    expect(sanitizeCssClass(42)).toBe('');
  });

  it('stores section CSS clipped and without <', () => {
    const [s] = sanitizeStudioSections([
      { id: 'b', type: 'banner', settings: { cssClass: 'sale  .hot', customCss: '</style>' + 'a'.repeat(4000) } },
    ]);
    expect(s.settings.cssClass).toBe('sale hot');
    expect(s.settings.customCss).not.toContain('<');
    expect(s.settings.customCss!.length).toBeLessThanOrEqual(3000);
  });
});
