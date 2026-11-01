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

/** Directory trust signals for a supplier (server side: lib/supplier-trust). */
export type SupplierTrust = {
  gst_verified: boolean;
  gst_legal_name: string | null;
  district: string | null;
  /** 0–1, or null until the supplier has answered enough orders */
  fill_rate: number | null;
  orders_answered: number;
  reply_hours: number | null;
  member_since: string | null;
};

/** Plain words for a typical reply time. */
export function replyLabel(hours: number | null | undefined): string | null {
  if (hours == null) return null;
  if (hours < 1) return 'Usually replies within an hour';
  if (hours < 24) return `Usually replies within ${Math.ceil(hours)} hours`;
  const days = Math.ceil(hours / 24);
  return days === 1 ? 'Usually replies within a day' : `Usually replies within ${days} days`;
}

/** Short trust chips for a supplier card, most convincing first. */
export function trustChips(trust: SupplierTrust | null | undefined): string[] {
  if (!trust) return [];
  const chips: string[] = [];
  if (trust.gst_verified) chips.push('GST verified');
  if (trust.fill_rate != null) chips.push(`Fills ${Math.round(trust.fill_rate * 100)}% of orders`);
  const reply = replyLabel(trust.reply_hours);
  if (reply) chips.push(reply);
  if (trust.member_since) chips.push(`On Khatario since ${new Date(trust.member_since).getFullYear()}`);
  return chips;
}
