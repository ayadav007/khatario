import {
  BRIDGE_SOURCE,
  parseEditorMessage,
  parsePreviewMessage,
  appOriginsForStoreHost,
  resolveAddIndex,
  storeOriginFromPreviewUrl,
} from '@/lib/store/engine/editor/bridge';

const S = 'kh-studio';
const ref = { group: 'template', id: 'hero-1' };
const template = 'home';

describe('bridge parsers', () => {
  it('parses each valid message type', () => {
    expect(BRIDGE_SOURCE).toBe(S);
    expect(parseEditorMessage({ source: S, type: 'select', template, ref })).toEqual({ source: S, type: 'select', template, ref });
    expect(parseEditorMessage({ source: S, type: 'select', template, ref: null })).toEqual({ source: S, type: 'select', template, ref: null });
    expect(parseEditorMessage({ source: S, type: 'hover', ref: null })).toEqual({ source: S, type: 'hover', ref: null });
    expect(parseEditorMessage({ source: S, type: 'scroll-to', template, ref })).toEqual({ source: S, type: 'scroll-to', template, ref });
    expect(parseEditorMessage({ source: S, type: 'refresh', rev: 3 })).toEqual({ source: S, type: 'refresh', rev: 3 });
    expect(parsePreviewMessage({ source: S, type: 'ready', template, rev: null })).toEqual({ source: S, type: 'ready', template, rev: null });
    expect(parsePreviewMessage({ source: S, type: 'ready', template, rev: 0 })).toEqual({ source: S, type: 'ready', template, rev: 0 });
    expect(parsePreviewMessage({ source: S, type: 'hover', ref: null })).toEqual({ source: S, type: 'hover', ref: null });
    expect(parsePreviewMessage({ source: S, type: 'select', template, ref })).toEqual({ source: S, type: 'select', template, ref });
    expect(parsePreviewMessage({ source: S, type: 'add-at', template, after: 'hero-1' })).toEqual({
      source: S,
      type: 'add-at',
      template,
      after: 'hero-1',
    });
    expect(parsePreviewMessage({ source: S, type: 'add-at', template: 'page.sale', after: null })).toEqual({
      source: S,
      type: 'add-at',
      template: 'page.sale',
      after: null,
    });
  });

  it('drops unknown keys and returns a fresh object', () => {
    const input = { source: S, type: 'select', template, ref: { ...ref, extra: 1 }, junk: true };
    const out = parseEditorMessage(input);
    expect(out).toEqual({ source: S, type: 'select', template, ref });
    expect(out).not.toBe(input);
  });

  it('rejects wrong source, type, ids and after', () => {
    expect(parseEditorMessage(null)).toBeNull();
    expect(parseEditorMessage('x')).toBeNull();
    expect(parseEditorMessage([])).toBeNull();
    expect(parseEditorMessage({ source: 'other', type: 'select', template, ref })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'nope', template, ref })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'select', template, ref: { group: 'template', id: 'Bad Id' } })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'select', template, ref: { group: 'sidebar', id: 'a' } })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'select', template })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'scroll-to', template, ref: null })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'refresh', rev: -1 })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'refresh', rev: 1.5 })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'refresh', rev: '1' })).toBeNull();
    // preview-only types are not editor messages
    expect(parseEditorMessage({ source: S, type: 'add-at', template, after: null })).toBeNull();

    expect(parsePreviewMessage({ source: S, type: 'select', template, ref: null })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'add-at', template, after: 'Bad Id' })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'add-at', template, after: 3 })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'add-at', template })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'ready', template, rev: -2 })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'ready', template, rev: 1.2 })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'ready', template })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'refresh', rev: 1 })).toBeNull();
    expect(parsePreviewMessage({ source: 'x', type: 'ready', template, rev: null })).toBeNull();
  });

  it('requires a valid template on ready, select, add-at and scroll-to', () => {
    for (const t of [undefined, null, '', 'HOME', 'page.', 'page.Bad', 'page.cart', 'pages.sale', 'x'.repeat(81), 7]) {
      expect(parsePreviewMessage({ source: S, type: 'ready', template: t, rev: null })).toBeNull();
      expect(parsePreviewMessage({ source: S, type: 'select', template: t, ref })).toBeNull();
      expect(parsePreviewMessage({ source: S, type: 'add-at', template: t, after: null })).toBeNull();
      expect(parseEditorMessage({ source: S, type: 'select', template: t, ref })).toBeNull();
      expect(parseEditorMessage({ source: S, type: 'scroll-to', template: t, ref })).toBeNull();
    }
    for (const t of ['home', 'product', 'catalog', 'page.sale', 'page.about-us']) {
      expect(parsePreviewMessage({ source: S, type: 'ready', template: t, rev: null })).not.toBeNull();
    }
  });

  it('rejects the old add-at index field', () => {
    expect(parsePreviewMessage({ source: S, type: 'add-at', template, index: 1 })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'add-at', template, after: null, index: 1 })).toBeNull();
  });

  it('rejects non-plain objects', () => {
    class M { source = S; type = 'ready'; template = 'home'; rev = null; }
    expect(parsePreviewMessage(new M())).toBeNull();
  });
});

describe('bridge parser hardening', () => {
  it('rejects prototype tricks and arrays', () => {
    expect(parsePreviewMessage(JSON.parse('{"__proto__":{"source":"kh-studio","type":"ready"}}'))).toBeNull();
    expect(parsePreviewMessage(Object.create({ source: S, type: 'ready', rev: null }))).toBeNull();
    expect(parseEditorMessage(Object.create({ source: S, type: 'refresh', rev: 1 }))).toBeNull();
    expect(parsePreviewMessage([S, 'ready'])).toBeNull();
    expect(parseEditorMessage([{ source: S, type: 'refresh', rev: 1 }])).toBeNull();
  });
  it('validates after strictly', () => {
    for (const after of [undefined, 0, '', 'A', 'x'.repeat(33), {}, []]) {
      expect(parsePreviewMessage({ source: S, type: 'add-at', template, after })).toBeNull();
    }
    expect(parsePreviewMessage({ source: S, type: 'add-at', template, after: 'x'.repeat(32) })).not.toBeNull();
  });
  it('validates rev strictly', () => {
    for (const rev of [-0, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1e300, '1']) {
      expect(parseEditorMessage({ source: S, type: 'refresh', rev })).toBeNull();
      expect(parsePreviewMessage({ source: S, type: 'ready', template, rev })).toBeNull();
    }
    expect(parseEditorMessage({ source: S, type: 'refresh', rev: Number.MAX_SAFE_INTEGER })).not.toBeNull();
  });
});

describe('resolveAddIndex', () => {
  it('inserts at the top, after the named section, or at the end when it is gone', () => {
    expect(resolveAddIndex(['a', 'b'], 'a')).toBe(1);
    expect(resolveAddIndex(['a', 'b'], 'b')).toBe(2);
    expect(resolveAddIndex(['a', 'b'], null)).toBe(0);
    expect(resolveAddIndex(['a'], 'gone')).toBe(1);
    expect(resolveAddIndex([], null)).toBe(0);
  });
});

describe('appOriginsForStoreHost hardening', () => {
  it('rejects ports on khatario hosts and bad protocols', () => {
    expect(appOriginsForStoreHost('https:', 'ganesh.khatario.com:8443')).toEqual([]);
    expect(appOriginsForStoreHost('https:', 'ganesh.staging.khatario.com:1')).toEqual([]);
    expect(appOriginsForStoreHost('ftp:' as any, 'ganesh.localhost:3000')).toEqual([]);
    expect(appOriginsForStoreHost('HTTPS:' as any, 'ganesh.khatario.com')).toEqual([]);
    expect(appOriginsForStoreHost(undefined as any, 'ganesh.localhost')).toEqual([]);
  });
  it('rejects look-alike and reserved hosts', () => {
    for (const h of [
      'ganesh.localhost.evil.com', 'ganesh.localhost.', 'user@ganesh.localhost', '[::1]:3000',
      'staging.khatario.com', 'www.khatario.com', 'app.khatario.com', 'api.khatario.com',
    ]) {
      expect(appOriginsForStoreHost('https:', h)).toEqual([]);
    }
    expect(appOriginsForStoreHost('http:', 'GANESH.LOCALHOST:3000')).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
  });
  it('preview url rejects script and data urls', () => {
    expect(storeOriginFromPreviewUrl('javascript:alert(1)')).toBeNull();
    expect(storeOriginFromPreviewUrl('data:text/html,x')).toBeNull();
  });
});

describe('appOriginsForStoreHost', () => {
  it('maps localhost stores, keeping the port', () => {
    expect(appOriginsForStoreHost('http:', 'shop.localhost:3016')).toEqual(['http://localhost:3016', 'http://127.0.0.1:3016']);
    expect(appOriginsForStoreHost('http:', 'Shop.Localhost')).toEqual(['http://localhost', 'http://127.0.0.1']);
    expect(appOriginsForStoreHost('https:', 'shop.localhost:3000')).toEqual(['https://localhost:3000', 'https://127.0.0.1:3000']);
  });

  it('maps staging and production stores', () => {
    expect(appOriginsForStoreHost('https:', 'shop.staging.khatario.com')).toEqual(['https://staging.khatario.com']);
    expect(appOriginsForStoreHost('https:', 'Shop.khatario.com')).toEqual([
      'https://khatario.com',
      'https://app.khatario.com',
      'https://www.khatario.com',
    ]);
  });

  it('returns [] for unknown hosts, reserved labels and http on khatario', () => {
    expect(appOriginsForStoreHost('https:', 'evil.com')).toEqual([]);
    expect(appOriginsForStoreHost('https:', 'shop.khatario.com.evil.com')).toEqual([]);
    expect(appOriginsForStoreHost('https:', 'www.khatario.com')).toEqual([]);
    expect(appOriginsForStoreHost('https:', 'localhost:3000')).toEqual([]);
    expect(appOriginsForStoreHost('http:', 'shop.khatario.com')).toEqual([]);
    expect(appOriginsForStoreHost('http:', 'shop.staging.khatario.com')).toEqual([]);
    expect(appOriginsForStoreHost('https:', '')).toEqual([]);
  });
});

describe('storeOriginFromPreviewUrl', () => {
  it('returns the origin', () => {
    expect(storeOriginFromPreviewUrl('https://shop.khatario.com/p/x?y=1')).toBe('https://shop.khatario.com');
    expect(storeOriginFromPreviewUrl('http://shop.localhost:3016/')).toBe('http://shop.localhost:3016');
  });
  it('returns null for non-URLs and non-http protocols', () => {
    expect(storeOriginFromPreviewUrl('not a url')).toBeNull();
    expect(storeOriginFromPreviewUrl('/relative')).toBeNull();
    expect(storeOriginFromPreviewUrl('javascript:alert(1)')).toBeNull();
    expect(storeOriginFromPreviewUrl('data:text/html,hi')).toBeNull();
  });
});
