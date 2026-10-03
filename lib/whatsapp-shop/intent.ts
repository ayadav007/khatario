import { queryOne } from '@/lib/db';
import { sendCatalogMessage } from '@/lib/meta-whatsapp';
import { businessTransport } from '@/lib/whatsapp/business-transport';
import { createShopLink } from './links';
import { storeShopBotMessage } from './order';
import { getShopSettings } from './settings';

const SHOP_WORDS =
  'menu|shop|catalog|catalogue|store|products?|product list|price ?list|rate ?list|items|' +
  'order|order now|place (?:an |my )?order|i want to order|i would like to order|' +
  'how (?:can|do) i order|how to order|want to buy|buy';

const SHOP_REQUEST_RE = new RegExp(
  `^(?:(?:hi|hello|hey|hii+|namaste)\\s+)?(?:(?:please\\s+)?(?:show|send|see|view|share|open)\\s+(?:me\\s+)?(?:the\\s+|your\\s+)?)?(?:${SHOP_WORDS})(?:\\s+(?:please|pls|plz))?$`,
);

/** Short "show me what you sell" messages; longer questions go to the agent as usual. */
export function isShopRequest(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 40) return false;
  return SHOP_REQUEST_RE.test(t);
}

/**
 * Replies to a shop request when the business has the WhatsApp shop on. Cloud API numbers with a
 * synced catalog get WhatsApp's own "View catalog" card (sent here); everyone else gets a link to
 * the cart page, returned as the reply text. Null means "not handled", so the normal bot runs.
 */
export async function respondToShopRequest(input: {
  businessId: string;
  phone: string;
  conversationUuid: string | null;
  text: string;
}): Promise<{ response?: string } | null> {
  if (!isShopRequest(input.text)) return null;
  const settings = await getShopSettings(input.businessId).catch(() => null);
  if (!settings?.enabled) return null;

  if (settings.metaCatalogId && (await businessTransport(input.businessId)) === 'cloud') {
    const thumb = await queryOne<{ item_id: string }>(
      `SELECT item_id FROM whatsapp_catalog_items WHERE business_id = $1 AND catalog_id = $2 ORDER BY synced_at ASC LIMIT 1`,
      [input.businessId, settings.metaCatalogId],
    ).catch(() => null);
    if (thumb) {
      try {
        const { messageId } = await sendCatalogMessage({
          businessId: input.businessId,
          to: input.phone,
          body: settings.welcomeText,
          thumbnailRetailerId: thumb.item_id,
        });
        await storeShopBotMessage(input.businessId, input.phone, `🛍️ ${settings.welcomeText}\n[View catalog]`, messageId);
        return {};
      } catch (e) {
        console.error('[whatsapp-shop] catalog message failed, sending cart link:', e instanceof Error ? e.message : e);
      }
    }
  }

  const link = await createShopLink({
    businessId: input.businessId,
    phone: input.phone,
    conversationUuid: input.conversationUuid,
  });
  return { response: `${settings.welcomeText}\n\n🛍️ Open our shop: ${link}` };
}
