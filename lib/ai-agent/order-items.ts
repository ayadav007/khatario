import { queryOne } from '@/lib/db';

export interface AgentOrderLine {
  name?: unknown;
  qty?: unknown;
  quantity?: unknown;
}

export interface ResolvedOrderItem {
  item_id: string;
  name: string;
  quantity: number;
  price: number;
}

export interface ResolvedOrder {
  items: ResolvedOrderItem[];
  /** Names the model wrote that match no catalogue item (fees and charges are dropped silently). */
  unmatched: string[];
}

const CHARGE_LINE = /\b(delivery|shipping|courier|packing|packaging|handling|service charge|convenience fee|gst|tax|discount)\b/i;

/** "Biryani Rice – 1kg @ ₹95" → "Biryani Rice – 1kg"; the price and quantity the model adds are not part of the name. */
export function cleanOrderLineName(raw: string): string {
  return raw
    .replace(/[@×x]\s*₹?\s*\d[\d,.]*.*$/i, '')
    .replace(/₹\s*\d[\d,.]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isChargeLine(name: string): boolean {
  return CHARGE_LINE.test(name);
}

/** The first `[...]` after `CREATE_ORDER:` as order lines, or null when the tag or JSON is missing. */
export function parseCreateOrderTag(reply: string): AgentOrderLine[] | null {
  const idx = reply.indexOf('CREATE_ORDER:');
  if (idx < 0) return null;
  const match = reply.slice(idx + 'CREATE_ORDER:'.length).match(/\[[\s\S]*?\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Catalogue items for the model's order lines, always at the catalogue price. Exact name first, then
 * the closest name (the model often adds a pack size or drops a word). Fee lines are skipped.
 */
export async function resolveOrderItems(businessId: string, lines: AgentOrderLine[]): Promise<ResolvedOrder> {
  const items: ResolvedOrderItem[] = [];
  const unmatched: string[] = [];
  for (const line of lines) {
    const name = cleanOrderLineName(String(line?.name ?? ''));
    if (!name || isChargeLine(name)) continue;
    const quantity = Math.max(1, Number(line?.qty ?? line?.quantity ?? 1) || 1);
    const row = await queryOne<{ id: string; name: string; selling_price: string | number | null }>(
      `SELECT id, name, selling_price
         FROM items
        WHERE business_id = $1
          AND deleted_at IS NULL
          AND (is_active IS NULL OR is_active = true)
          AND (lower(name) = lower($2) OR $2 ILIKE '%' || name || '%' OR name ILIKE '%' || $2 || '%' OR similarity(name, $2) > 0.45)
        ORDER BY (lower(name) = lower($2)) DESC, similarity(name, $2) DESC, length(name) DESC
        LIMIT 1`,
      [businessId, name],
    );
    if (!row) {
      unmatched.push(name);
      continue;
    }
    items.push({ item_id: row.id, name: row.name, quantity, price: Number(row.selling_price) || 0 });
  }
  return { items, unmatched };
}

export const ORDER_NOT_CREATED_REPLY =
  "Thanks! I've noted what you'd like. Our team will confirm your order and share the details shortly.";
