import crypto from 'crypto';
import { query, queryOne } from '@/lib/db';
import { appBaseUrl } from './items';

export const SHOP_LINK_TTL_HOURS = 48;

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export type ShopLink = {
  businessId: string;
  phone: string;
  conversationUuid: string | null;
};

/** A cart page link for one customer chat; only its hash is stored, so a DB leak exposes no links. */
export async function createShopLink(input: {
  businessId: string;
  phone: string;
  conversationUuid?: string | null;
}): Promise<string> {
  const token = crypto.randomBytes(24).toString('base64url');
  await query(
    `INSERT INTO whatsapp_shop_links (token_hash, business_id, customer_phone, whatsapp_conversation_id, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' hours')::interval)`,
    [hashToken(token), input.businessId, input.phone.replace(/\D/g, '').slice(0, 20), input.conversationUuid ?? null, String(SHOP_LINK_TTL_HOURS)],
  );
  return `${appBaseUrl()}/wa-shop/${token}`;
}

export async function resolveShopLink(token: string): Promise<ShopLink | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const row = await queryOne<{ business_id: string; customer_phone: string; whatsapp_conversation_id: string | null }>(
    `SELECT business_id, customer_phone, whatsapp_conversation_id
       FROM whatsapp_shop_links
      WHERE token_hash = $1 AND expires_at > NOW()`,
    [hashToken(token)],
  ).catch(() => null);
  if (!row) return null;
  return { businessId: row.business_id, phone: row.customer_phone, conversationUuid: row.whatsapp_conversation_id };
}

export async function recordShopLinkOrder(token: string, orderId: string): Promise<void> {
  await query(`UPDATE whatsapp_shop_links SET last_order_id = $2 WHERE token_hash = $1`, [hashToken(token), orderId]).catch(
    () => undefined,
  );
}
