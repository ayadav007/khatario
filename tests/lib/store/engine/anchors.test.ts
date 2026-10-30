import { catalogAnchor, categoriesAnchor, findAnchor, firstCatalogAnchorId } from '@/lib/store/engine/anchors';

/** Ids; an id's anchor kind (data-eng-anchor) is the part before the first '-' for catalog-/categories- ids. */
function fakeDoc(ids: string[]) {
  const els = ids.map((id) => {
    const kind = /^(catalog|categories)-/.exec(id)?.[1] ?? null;
    return { id, kind };
  });
  return {
    getElementById: (id: string) => (els.find((e) => e.id === id) as unknown as HTMLElement) ?? null,
    querySelector: (sel: string) => {
      const m = /^\[data-eng-anchor="([^"]+)"\]$/.exec(sel);
      if (!m) throw new Error(`unexpected selector ${sel}`);
      return (els.find((e) => e.kind === m[1]) as unknown as Element) ?? null;
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
    // A look-alike id without the anchor attribute (e.g. merchant markup) is not followed.
    expect(findAnchor(fakeDoc(['catalogue-x']), 'catalog')).toBeNull();
  });

  it('falls back to the old catalog id when no all-products grid is on the page', () => {
    expect(firstCatalogAnchorId(fakeDoc(['categories-c1']))).toBe('catalog');
  });
});
