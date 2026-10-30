// Client-safe: no imports. Per-section DOM anchors on engine pages (D12).

/** Anchor of an all-products grid section. */
export function catalogAnchor(sectionId: string): string {
  return `catalog-${sectionId}`;
}

/** Anchor of a category grid section. */
export function categoriesAnchor(sectionId: string): string {
  return `categories-${sectionId}`;
}

/** `data-eng-anchor` value an anchor of each kind carries. */
export const ANCHOR_KIND = { catalog: 'catalog', categories: 'categories' } as const;

/**
 * The old fixed ids (`#catalog` in preset links and CTA defaults, `#st-categories` in the phone nav)
 * point at the first anchor of that kind on the page.
 */
const ALIASES: Record<string, string> = {
  catalog: ANCHOR_KIND.catalog,
  'st-categories': ANCHOR_KIND.categories,
};

type AnchorDoc = Pick<Document, 'getElementById' | 'querySelector'>;

/** The element an in-page `#id` link scrolls to, following the old fixed ids to the first matching section. */
export function findAnchor(doc: AnchorDoc, id: string): Element | null {
  const exact = doc.getElementById(id);
  if (exact) return exact;
  const kind = Object.prototype.hasOwnProperty.call(ALIASES, id) ? ALIASES[id] : null;
  return kind ? doc.querySelector(`[data-eng-anchor="${kind}"]`) : null;
}

/** The DOM id of the first all-products grid on the page, or the old `catalog` id when there is none. */
export function firstCatalogAnchorId(doc: AnchorDoc): string {
  return findAnchor(doc, 'catalog')?.id || 'catalog';
}
