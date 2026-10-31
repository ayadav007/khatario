import { catalogRedirect, engineCatalogHref, engineProductHref, shareUrl, isEditorFrameSearch, withPreviewParams } from '@/lib/store/engine/links';
import { getSectionSchema } from '@/lib/store/engine/registry';

describe('engineCatalogHref', () => {
  it('builds /catalog/<id> with the search, keeping preview params (editor only with a preview)', () => {
    expect(engineCatalogHref('?preview_theme=T&pt=P&editor=1&utm=x', { categoryId: 'C', q: 'rice' })).toBe(
      '/catalog/C?preview_theme=T&pt=P&editor=1&q=rice',
    );
  });

  it('is /catalog with no category, and drops editor without a preview', () => {
    expect(engineCatalogHref('?editor=1', { q: null })).toBe('/catalog');
    expect(engineCatalogHref('', { q: 'dal' })).toBe('/catalog?q=dal');
  });
});

describe('engineProductHref', () => {
  it('keeps preview params only', () => {
    expect(engineProductHref('?preview_theme=T&pt=P&q=x', 'abc')).toBe('/products/abc?preview_theme=T&pt=P');
    expect(engineProductHref('?q=x', 'abc')).toBe('/products/abc');
  });
});

describe('catalogRedirect', () => {
  it('sends an engine home with cat to the catalog', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    expect(catalogRedirect(true, '/', `?cat=${id}`)).toBe(`/catalog/${id}`);
    expect(catalogRedirect(true, '/', `?cat=${id.toUpperCase()}&q=rice`)).toBe(`/catalog/${id.toUpperCase()}?q=rice`);
  });

  it('drops a malformed cat on an engine home', () => {
    expect(catalogRedirect(true, '/', '?cat=foo&q=rice')).toBe('/catalog?q=rice');
  });

  it('sends a non-engine catalog to the home with cat and the rest of the query', () => {
    expect(catalogRedirect(false, '/catalog/C', '?q=a')).toBe('/?q=a&cat=C');
    expect(catalogRedirect(false, '/catalog', '?q=a')).toBe('/?q=a');
  });

  it('is null when there is nothing to redirect', () => {
    expect(catalogRedirect(true, '/', '')).toBeNull();
    expect(catalogRedirect(true, '/', '?cat=foo')).toBeNull();
    expect(catalogRedirect(true, '/catalog', '?q=a')).toBeNull();
    expect(catalogRedirect(false, '/', '?cat=C')).toBeNull();
  });
});

describe('catalog section schemas', () => {
  it.each(['catalog-banner', 'main-catalog'])('%s is one per catalog template', (type) => {
    const schema = getSectionSchema(type);
    expect(schema?.limit).toBe(1);
    expect(schema?.templates).toEqual(['catalog']);
  });
});

describe('engine product links keep preview params (I3)', () => {
  // Rendering these client views needs the store context and router; a source check keeps the rule cheap.
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const files = [
    'components/store/engine/EngineViews.tsx',
    'components/store/engine/product/ProductSections.tsx',
    'components/store/engine/catalog/MainCatalogView.tsx',
  ];
  it.each(files)('%s opens products through engineProductHref', (file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    expect(src).not.toMatch(/router\.push\(`\/products\//);
    expect(src).toContain('engineProductHref(window.location.search');
  });
});

describe('the header search keeps preview params (final review I1)', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const src = readFileSync(join(process.cwd(), 'components/store/features/catalog/HeaderSearch.tsx'), 'utf8');
  it('opens a picked product through engineProductHref', () => {
    expect(src).not.toMatch(/router\.push\(`\/products\//);
    expect(src).toContain('engineProductHref(window.location.search, p.id)');
  });
  it('opens the catalog (search or category) through catalogHref', () => {
    expect(src).toContain('catalogHref(window.location.search, next)');
    expect(src.match(/router\.push\(/g)).toHaveLength(2);
  });
  it('a product pick from a version preview keeps its token', () => {
    const id = '0b6f5f39-6a52-4d8e-9a0e-0c6d8a3b1f21';
    expect(engineProductHref('?preview_theme=v&pt=tok&q=ri', id)).toBe(`/products/${id}?preview_theme=v&pt=tok`);
    expect(engineProductHref('?td=abc', id)).toBe(`/products/${id}?td=abc`);
  });
});

describe('shareUrl (Share never carries a preview token)', () => {
  const id = '0b6f5f39-6a52-4d8e-9a0e-0c6d8a3b1f21';
  it('keeps origin and path, dropping the query and hash', () => {
    expect(shareUrl(`https://a.khatario.com/products/${id}?preview_theme=x&pt=y#r`)).toBe(
      `https://a.khatario.com/products/${id}`,
    );
    expect(shareUrl(`https://a.khatario.com/products/${id}?td=abc`)).toBe(`https://a.khatario.com/products/${id}`);
  });
  it('gives an empty string for an unparsable href', () => {
    expect(shareUrl('nope')).toBe('');
    expect(shareUrl('')).toBe('');
  });
});

describe('the product Share block shares shareUrl', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  it('never shares window.location.href as is', () => {
    const src = readFileSync(join(process.cwd(), 'components/store/engine/product/ProductBlocks.tsx'), 'utf8');
    expect(src).toContain('shareUrl(window.location.href)');
    expect(src).not.toMatch(/const url = window\.location\.href/);
  });
});

describe('isEditorFrameSearch', () => {
  it('is true only for a theme preview opened with editor=1', () => {
    expect(isEditorFrameSearch('?preview_theme=t1&pt=x&editor=1')).toBe(true);
    expect(isEditorFrameSearch('?preview_theme=t1&pt=x')).toBe(false);
    expect(isEditorFrameSearch('?editor=1')).toBe(false);
    expect(isEditorFrameSearch('?preview_theme=t1&editor=1')).toBe(false);
    expect(isEditorFrameSearch('')).toBe(false);
  });
});

describe('withPreviewParams', () => {
  const PREVIEW = '?preview_theme=T&pt=P&utm=x';
  it('adds the preview to an internal link, keeping its own path, query and hash', () => {
    expect(withPreviewParams(PREVIEW, '/catalog?qx=1')).toBe('/catalog?qx=1&preview_theme=T&pt=P');
    expect(withPreviewParams(PREVIEW, '/pages/about#team')).toBe('/pages/about?preview_theme=T&pt=P#team');
    expect(withPreviewParams(PREVIEW, '/')).toBe('/?preview_theme=T&pt=P');
  });
  it('leaves a link that sets its own preview params, external links, anchors and non-preview pages alone', () => {
    expect(withPreviewParams(PREVIEW, '/x?preview_theme=OTHER')).toBe('/x?preview_theme=OTHER&pt=P');
    expect(withPreviewParams(PREVIEW, 'https://example.com/a')).toBe('https://example.com/a');
    expect(withPreviewParams(PREVIEW, '//evil.example/a')).toBe('//evil.example/a');
    expect(withPreviewParams(PREVIEW, '#catalog')).toBe('#catalog');
    expect(withPreviewParams('?utm=x', '/catalog')).toBe('/catalog');
  });
});
