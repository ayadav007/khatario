/** Client-safe pure helpers for abandoned carts (no db imports); re-exported from abandoned-carts.ts. */

export type CartLine = {
  item_id: string;
  variant_id: string | null;
  quantity: number;
  price: number;
  name: string;
  image_url: string | null;
};

const MANUAL_GAP_MS = 24 * 3600_000;

/** Template values: up to three item names plus "and N more", and the total in Indian format. */
export function cartReminderMessage(
  lines: CartLine[],
  store: { name: string },
  total: number,
): { item_names: string; total: string } {
  void store;
  const names = lines.map((l) => (typeof l.name === 'string' ? l.name.trim() : '')).filter(Boolean);
  const head = names.slice(0, 3).join(', ');
  const rest = names.length - 3;
  return {
    item_names: rest > 0 ? `${head} and ${rest} more` : head,
    total: total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  };
}

export function canRemindManually(remindedAt: Date | null, now: Date): boolean {
  return !remindedAt || now.getTime() - remindedAt.getTime() >= MANUAL_GAP_MS;
}

/** "5 min ago", "5 h ago", "3 d ago". */
export function agoText(iso: string, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** "Reminded by WhatsApp 2 h ago" / "Not reminded". */
export function reminderStatusText(
  remindedAt: string | null,
  via: string | null,
  now: Date = new Date(),
): string {
  if (!remindedAt) return 'Not reminded';
  const by = via === 'push' ? 'app notification' : via === 'whatsapp' ? 'WhatsApp' : via === 'manual' ? 'you' : null;
  return `Reminded${by ? ` by ${by}` : ''} ${agoText(remindedAt, now)}`;
}

/** wa.me link with the reminder text prefilled; null when the phone is not a usable number. */
export function cartWhatsappLink(
  phone: string | null | undefined,
  text: string,
): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  let full: string | null = null;
  if (digits.length === 10) full = `91${digits}`;
  else if (digits.length === 12 && digits.startsWith('91')) full = digits;
  if (!full) return null;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}

/** Prefilled WhatsApp text; the cart link is left out when the store host is unknown. */
export function cartWhatsappText(
  customerName: string | null,
  lines: CartLine[],
  storeName: string,
  total: number,
  cartUrl: string | null,
): string {
  const msg = cartReminderMessage(lines, { name: storeName }, total);
  const who = customerName?.trim() || 'there';
  const base = `Hi ${who}, you left ${msg.item_names} in your cart at ${storeName}. Total ₹${msg.total}.`;
  return cartUrl ? `${base} Finish your order here: ${cartUrl}` : base;
}
