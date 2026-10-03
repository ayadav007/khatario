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

export interface CollectedCustomerDetails {
  name?: string;
  email?: string;
  address?: string;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.replace(/\s+/g, ' ').trim();
  return s && s.length <= max ? s : undefined;
}

/** The `CUSTOMER: {...}` details the model collected in chat (name, email, address), or null. */
export function parseCustomerTag(reply: string): CollectedCustomerDetails | null {
  const idx = reply.indexOf('CUSTOMER:');
  if (idx < 0) return null;
  const match = reply.slice(idx + 'CUSTOMER:'.length).match(/^\s*(\{[\s\S]*?\})/);
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const out: CollectedCustomerDetails = {};
  const name = cleanText(raw.name, 100);
  if (name && /\p{L}/u.test(name)) out.name = name;
  const email = cleanText(raw.email, 200);
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.email = email.toLowerCase();
  const address = cleanText(raw.address, 500);
  if (address) out.address = address;
  return Object.keys(out).length ? out : null;
}

/** The reply without the CUSTOMER and CREATE_ORDER tags, as the customer should see it. */
export function stripOrderTags(reply: string): string {
  return reply
    .replace(/CUSTOMER:\s*\{[\s\S]*?\}\s*/g, '')
    .replace(/CREATE_ORDER:.*$/gm, '')
    .trim();
}

export const CHAT_NAME_FIELD = 'customer_name';

/** True for names Khatario made up (phone number, "Customer 1234") or that only repeat the WhatsApp profile name. */
export function isPlaceholderName(name: string | null | undefined, profileNames: Array<string | null | undefined> = []): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  if (/^(whatsapp )?customer [0-9]{4}$/i.test(n) || /^\+?[0-9 ]+$/.test(n)) return true;
  return profileNames.some((p) => p && p.trim() === n);
}

/** The name the customer gave in this chat, kept on the conversation even before they are a customer. */
export async function loadChatCustomerName(businessId: string, conversationId: string): Promise<string | null> {
  const row = await queryOne<{ field_value: string | null }>(
    `SELECT field_value FROM whatsapp_conversation_custom_fields
      WHERE business_id = $1 AND conversation_id = $2 AND field_key = $3`,
    [businessId, conversationId, CHAT_NAME_FIELD],
  ).catch(() => null);
  return row?.field_value?.trim() || null;
}

export async function saveChatCustomerName(businessId: string, conversationId: string, name: string): Promise<void> {
  await queryOne(
    `INSERT INTO whatsapp_conversation_custom_fields (conversation_id, business_id, field_key, field_value)
     SELECT id, business_id, $3, $4 FROM whatsapp_conversations WHERE id = $1 AND business_id = $2
     ON CONFLICT (conversation_id, field_key) DO UPDATE SET field_value = EXCLUDED.field_value`,
    [conversationId, businessId, CHAT_NAME_FIELD, name],
  );
}

/**
 * Saves chat-collected details on the customer. The name only replaces a placeholder (blank, the
 * phone number, the WhatsApp display name or "Customer 1234"), never a name the business entered.
 */
export async function saveCollectedCustomerDetails(
  businessId: string,
  customerId: string,
  details: CollectedCustomerDetails,
  placeholderNames: Array<string | null | undefined>,
): Promise<void> {
  if (!details.name && !details.email && !details.address) return;
  await queryOne(
    `UPDATE customers SET
        name = CASE
          WHEN $3::text IS NOT NULL AND (
            COALESCE(TRIM(name), '') = ''
            OR name = ANY($6::text[])
            OR name ~* '^(whatsapp )?customer [0-9]{4}$'
            OR name ~ '^\\+?[0-9 ]+$'
          ) THEN $3 ELSE name END,
        email = COALESCE(NULLIF(TRIM(email), ''), $4),
        shipping_address = COALESCE($5, shipping_address),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2`,
    [
      customerId,
      businessId,
      details.name ?? null,
      details.email ?? null,
      details.address ?? null,
      placeholderNames.filter((n): n is string => Boolean(n && n.trim())).map((n) => n.trim()),
    ],
  );
}

export const ORDER_NOT_CREATED_REPLY =
  "Thanks! I've noted what you'd like. Our team will confirm your order and share the details shortly.";
