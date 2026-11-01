// Client-safe, no imports: geometry for the storefront editor overlay.

export interface TemplateSectionBox {
  /** Position in the template's `order`, hidden sections included. */
  index: number;
  top: number;
  bottom: number;
}

export interface InsertionPoint {
  /** `add-at` index: the new section goes before the section now at this order position. */
  index: number;
  y: number;
}

/**
 * Where the "+" buttons go, for template sections in page order: before the first, halfway between
 * each pair, after the last. With nothing rendered, one point at `emptyTop` that inserts at 0.
 */
export function insertionPoints(sections: TemplateSectionBox[], emptyTop: number): InsertionPoint[] {
  if (sections.length === 0) return [{ index: 0, y: emptyTop }];
  const out: InsertionPoint[] = [{ index: sections[0].index, y: sections[0].top }];
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1];
    const next = sections[i];
    out.push({ index: next.index, y: (prev.bottom + next.top) / 2 });
  }
  const last = sections[sections.length - 1];
  out.push({ index: last.index + 1, y: last.bottom });
  return out;
}
