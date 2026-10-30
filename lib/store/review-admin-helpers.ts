/** Pure helpers for the merchant review moderation screen. */

export function pendingBadgeText(count: number | null | undefined): string | null {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 9 ? '9+' : String(Math.floor(n));
}

/** wa.me link for a shopper phone; null when it is not a usable number. */
export function reviewWhatsappLink(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `https://wa.me/91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `https://wa.me/${digits}`;
  return null;
}

export function reviewExcerpt(text: string, max = 160): { text: string; truncated: boolean } {
  const t = String(text ?? '').trim();
  if (t.length <= max) return { text: t, truncated: false };
  return { text: `${t.slice(0, max).trimEnd()}...`, truncated: true };
}
