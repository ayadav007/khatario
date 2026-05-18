/** Suppliers Hub — shared limits and helpers (migration 178). */

export const SUPPLIERS_HUB_MAX_PUBLIC_PREVIEW_LISTINGS = 20;

export function normalizeCategoryList(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  return [];
}
