import {
  BRIDGE_SOURCE,
  parseEditorMessage,
  parsePreviewMessage,
  appOriginsForStoreHost,
  storeOriginFromPreviewUrl,
} from '@/lib/store/engine/editor/bridge';

const S = 'kh-studio';
const ref = { group: 'template', id: 'hero-1' };

describe('bridge parsers', () => {
  it('parses each valid message type', () => {
    expect(BRIDGE_SOURCE).toBe(S);
    expect(parseEditorMessage({ source: S, type: 'select', ref })).toEqual({ source: S, type: 'select', ref });
    expect(parseEditorMessage({ source: S, type: 'select', ref: null })).toEqual({ source: S, type: 'select', ref: null });
    expect(parseEditorMessage({ source: S, type: 'hover', ref: null })).toEqual({ source: S, type: 'hover', ref: null });
    expect(parseEditorMessage({ source: S, type: 'scroll-to', ref })).toEqual({ source: S, type: 'scroll-to', ref });
    expect(parseEditorMessage({ source: S, type: 'refresh', rev: 3 })).toEqual({ source: S, type: 'refresh', rev: 3 });
    expect(parsePreviewMessage({ source: S, type: 'ready', rev: null })).toEqual({ source: S, type: 'ready', rev: null });
    expect(parsePreviewMessage({ source: S, type: 'ready', rev: 0 })).toEqual({ source: S, type: 'ready', rev: 0 });
    expect(parsePreviewMessage({ source: S, type: 'hover', ref: null })).toEqual({ source: S, type: 'hover', ref: null });
    expect(parsePreviewMessage({ source: S, type: 'select', ref })).toEqual({ source: S, type: 'select', ref });
    expect(parsePreviewMessage({ source: S, type: 'add-at', index: 25 })).toEqual({ source: S, type: 'add-at', index: 25 });
    expect(parsePreviewMessage({ source: S, type: 'add-at', index: 0 })).toEqual({ source: S, type: 'add-at', index: 0 });
  });

  it('drops unknown keys and returns a fresh object', () => {
    const input = { source: S, type: 'select', ref: { ...ref, extra: 1 }, junk: true };
    const out = parseEditorMessage(input);
    expect(out).toEqual({ source: S, type: 'select', ref });
    expect(out).not.toBe(input);
  });

  it('rejects wrong source, type, ids and index', () => {
    expect(parseEditorMessage(null)).toBeNull();
    expect(parseEditorMessage('x')).toBeNull();
    expect(parseEditorMessage([])).toBeNull();
    expect(parseEditorMessage({ source: 'other', type: 'select', ref })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'nope', ref })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'select', ref: { group: 'template', id: 'Bad Id' } })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'select', ref: { group: 'sidebar', id: 'a' } })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'select' })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'scroll-to', ref: null })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'refresh', rev: -1 })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'refresh', rev: 1.5 })).toBeNull();
    expect(parseEditorMessage({ source: S, type: 'refresh', rev: '1' })).toBeNull();
    // preview-only types are not editor messages
    expect(parseEditorMessage({ source: S, type: 'add-at', index: 1 })).toBeNull();

    expect(parsePreviewMessage({ source: S, type: 'select', ref: null })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'add-at', index: -1 })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'add-at', index: 26 })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'add-at', index: 1.5 })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'add-at' })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'ready', rev: -2 })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'ready', rev: 1.2 })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'ready' })).toBeNull();
    expect(parsePreviewMessage({ source: S, type: 'refresh', rev: 1 })).toBeNull();
    expect(parsePreviewMessage({ source: 'x', type: 'ready', rev: null })).toBeNull();
  });

  it('rejects non-plain objects', () => {
    class M { source = S; type = 'ready'; rev = null; }
    expect(parsePreviewMessage(new M())).toBeNull();
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
