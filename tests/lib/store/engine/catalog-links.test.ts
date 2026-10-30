import { catalogRedirect, engineCatalogHref, engineProductHref } from '@/lib/store/engine/links';
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
    expect(catalogRedirect(true, '/', '?cat=C')).toBe('/catalog/C');
  });

  it('sends a non-engine catalog to the home with cat and the rest of the query', () => {
    expect(catalogRedirect(false, '/catalog/C', '?q=a')).toBe('/?q=a&cat=C');
    expect(catalogRedirect(false, '/catalog', '?q=a')).toBe('/?q=a');
  });

  it('is null when there is nothing to redirect', () => {
    expect(catalogRedirect(true, '/', '')).toBeNull();
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
