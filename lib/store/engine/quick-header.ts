// Client-safe and pure. What the Quick preset's header shows (the old Quick store's header, on engine pages).

export interface QuickChip {
  key: string;
  label: string;
  /** A menu link (`href`) or a category (`categoryId`). */
  href?: string;
  categoryId?: string;
  /** Highlighted menu links (Offers) get the accent outline. */
  offers: boolean;
  /** A menu item with children: the pill shows ▾ and opens the side panel at this item instead of navigating. */
  menuItemId?: string;
}

type QuickLink = { label: string; href: string; highlight: boolean; itemId?: string; hasChildren?: boolean };

function linkChip(l: QuickLink, key: string, offers: boolean): QuickChip {
  return { key, label: l.label, href: l.href, offers, ...(l.hasChildren && l.itemId ? { menuItemId: l.itemId } : {}) };
}

/**
 * First line of the location button: "Delivery in 30 minutes" for a delivery time, a line that already starts
 * with "Deliver…" as written, else the store name (a tagline carried into the field is not a delivery time).
 */
export function quickDeliveryLine(eta: string, storeName: string): string {
  const t = eta.trim();
  if (/^(in|within|under)\b|^\d/i.test(t)) return `Delivery ${t}`;
  if (/^deliver/i.test(t)) return t;
  return storeName;
}

/**
 * The pill row: menu links, then the store's categories (skipping one a link already names), then highlighted
 * links such as Offers last, as on the old Quick store.
 */
export function quickChips(
  links: QuickLink[],
  categories: Array<{ id: string; name: string }>,
): QuickChip[] {
  const named = new Set(links.map((l) => l.label.trim().toLowerCase()));
  const plain = links.filter((l) => !l.highlight && l.label.trim());
  const highlighted = links.filter((l) => l.highlight && l.label.trim());
  return [
    ...plain.map((l, i) => linkChip(l, `l${i}`, false)),
    ...categories
      .filter((c) => !named.has(c.name.trim().toLowerCase()))
      .map((c) => ({ key: `c${c.id}`, label: c.name, categoryId: c.id, offers: false })),
    ...highlighted.map((l, i) => linkChip(l, `h${i}`, true)),
  ];
}

/** Cycling search hints: "Search “Vegetables”" for up to 8 categories, else the plain placeholder. */
export function quickSearchHints(placeholder: string, categories: Array<{ name: string }>): string[] {
  const names = categories.slice(0, 8).map((c) => c.name).filter(Boolean);
  return names.length ? names.map((n) => `Search “${n}”`) : [placeholder];
}

/** The category a page shows: `/catalog/<id>` or the home grid's `?cat=<id>`; null otherwise. */
export function activeQuickCategory(pathname: string, cat: string | null): string | null {
  const m = /^\/catalog\/([^/?#]+)/.exec(pathname);
  if (m) return decodeURIComponent(m[1]);
  return cat || null;
}
