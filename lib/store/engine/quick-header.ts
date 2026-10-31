// Client-safe and pure. What the Quick preset's header shows (the old Quick store's header, on engine pages).

export interface QuickChip {
  key: string;
  label: string;
  /** A menu link (`href`) or a category (`categoryId`). */
  href?: string;
  categoryId?: string;
  /** Highlighted menu links (Offers) get the accent outline. */
  offers: boolean;
}

/**
 * First line of the location button: "Delivery in 30 minutes" for a delivery time, else the text as written,
 * else the store name.
 */
export function quickDeliveryLine(eta: string, storeName: string): string {
  const t = eta.trim();
  if (!t) return storeName;
  return /^(in|within|under)\b|^\d/i.test(t) ? `Delivery ${t}` : t;
}

/**
 * The pill row: menu links, then the store's categories (skipping one a link already names), then highlighted
 * links such as Offers last, as on the old Quick store.
 */
export function quickChips(
  links: Array<{ label: string; href: string; highlight: boolean }>,
  categories: Array<{ id: string; name: string }>,
): QuickChip[] {
  const named = new Set(links.map((l) => l.label.trim().toLowerCase()));
  const plain = links.filter((l) => !l.highlight && l.label.trim());
  const highlighted = links.filter((l) => l.highlight && l.label.trim());
  return [
    ...plain.map((l, i) => ({ key: `l${i}`, label: l.label, href: l.href, offers: false })),
    ...categories
      .filter((c) => !named.has(c.name.trim().toLowerCase()))
      .map((c) => ({ key: `c${c.id}`, label: c.name, categoryId: c.id, offers: false })),
    ...highlighted.map((l, i) => ({ key: `h${i}`, label: l.label, href: l.href, offers: true })),
  ];
}

/** Cycling search hints: "Search “Vegetables”" for up to 8 categories, else the plain placeholder. */
export function quickSearchHints(placeholder: string, categories: Array<{ name: string }>): string[] {
  const names = categories.slice(0, 8).map((c) => c.name).filter(Boolean);
  return names.length ? names.map((n) => `Search “${n}”`) : [placeholder];
}
