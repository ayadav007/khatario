import { createPendingFilters } from '@/components/store/features/catalog/pending-filters';
import { EMPTY_CATALOG_FILTERS, type CatalogFilterValue } from '@/components/store/features/catalog/catalog-filters';

describe('createPendingFilters', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const make = () => {
    const sent: CatalogFilterValue[] = [];
    const p = createPendingFilters(EMPTY_CATALOG_FILTERS, (v) => sent.push(v), () => {}, 400);
    return { p, sent };
  };

  it('keeps min when max is typed within the debounce window', () => {
    const { p, sent } = make();
    p.patch({ min: 100 }, true);
    jest.advanceTimersByTime(100);
    p.patch({ max: 500 }, true);
    jest.advanceTimersByTime(400);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ min: 100, max: 500 });
  });

  it('does not lose a checkbox when stale props re-render before the URL updates', () => {
    const { p, sent } = make();
    p.patch({ inStock: true }, false);
    p.sync(EMPTY_CATALOG_FILTERS); // parent re-renders with the old value
    p.patch({ min: 50 }, true);
    jest.advanceTimersByTime(400);
    expect(sent[sent.length - 1]).toMatchObject({ inStock: true, min: 50 });
  });

  it('adopts props that change to something we did not send, and ignores echoes of our own', () => {
    const { p } = make();
    p.patch({ inStock: true }, false);
    p.sync({ ...EMPTY_CATALOG_FILTERS, inStock: true }); // echo of what we sent
    expect(p.get().inStock).toBe(true);
    p.sync({ ...EMPTY_CATALOG_FILTERS, brands: ['A'] }); // external change
    expect(p.get()).toMatchObject({ brands: ['A'], inStock: false });
  });

  it('ignores late echoes of every earlier send (two quick clicks)', () => {
    const { p, sent } = make();
    const B = { ...EMPTY_CATALOG_FILTERS, inStock: true };
    const C = { ...B, brands: ['A'] };
    p.patch({ inStock: true }, false);
    p.patch({ brands: ['A'] }, false);
    expect(sent).toEqual([B, C]);
    p.sync(B);
    p.sync(C);
    expect(p.get()).toMatchObject({ inStock: true, brands: ['A'] });
  });

  it('adopts an external change back to a previously sent value after a foreign adoption', () => {
    const { p } = make();
    const B = { ...EMPTY_CATALOG_FILTERS, inStock: true };
    p.patch({ inStock: true }, false);
    p.sync(B);
    p.sync({ ...EMPTY_CATALOG_FILTERS, brands: ['X'] }); // foreign
    p.sync(B); // external back to a value we once sent
    expect(p.get()).toMatchObject({ inStock: true, brands: [] });
  });

  it('adopts an external change back to the initial value once the echo has arrived', () => {
    const { p } = make();
    p.patch({ inStock: true }, false);
    p.sync({ ...EMPTY_CATALOG_FILTERS, inStock: true }); // echo
    p.sync(EMPTY_CATALOG_FILTERS); // Back button
    expect(p.get().inStock).toBe(false);
  });
});
