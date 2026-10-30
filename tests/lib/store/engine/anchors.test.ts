import { catalogAnchor, categoriesAnchor, findAnchor, firstCatalogAnchorId } from '@/lib/store/engine/anchors';

function fakeDoc(ids: string[]) {
  const els = ids.map((id) => ({ id }));
  return {
    getElementById: (id: string) => (els.find((e) => e.id === id) as unknown as HTMLElement) ?? null,
    querySelector: (sel: string) => {
      const m = /^\.eng-sec \[id\^="([^"]+)"\]$/.exec(sel);
      if (!m) throw new Error(`unexpected selector ${sel}`);
      return (els.find((e) => e.id.startsWith(m[1])) as unknown as Element) ?? null;
    },
  } as unknown as Pick<Document, 'getElementById' | 'querySelector'>;
}

describe('engine section anchors', () => {
  it('builds per-section anchors', () => {
    expect(catalogAnchor('grid_1')).toBe('catalog-grid_1');
    expect(categoriesAnchor('cats')).toBe('categories-cats');
  });

  it('follows the old fixed ids to the first section of that kind', () => {
    const doc = fakeDoc(['section-a', 'categories-c1', 'catalog-g1', 'catalog-g2']);
    expect(findAnchor(doc, 'catalog')?.id).toBe('catalog-g1');
    expect(findAnchor(doc, 'st-categories')?.id).toBe('categories-c1');
    expect(findAnchor(doc, 'catalog-g2')?.id).toBe('catalog-g2');
    expect(findAnchor(doc, 'section-a')?.id).toBe('section-a');
    expect(findAnchor(doc, 'nothing')).toBeNull();
    expect(findAnchor(doc, 'toString')).toBeNull();
    expect(firstCatalogAnchorId(doc)).toBe('catalog-g1');
  });

  it('falls back to the old catalog id when no all-products grid is on the page', () => {
    expect(firstCatalogAnchorId(fakeDoc(['categories-c1']))).toBe('catalog');
  });
});
