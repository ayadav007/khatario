import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { loadShopBusiness, loadShopItems, shopImageUrl } from '@/lib/whatsapp-shop/items';
import { recordShopLinkOrder, resolveShopLink } from '@/lib/whatsapp-shop/links';
import { placeShopOrder, sendShopOrderReply, SHOP_MAX_LINES } from '@/lib/whatsapp-shop/order';
import { getShopSettings } from '@/lib/whatsapp-shop/settings';

export const dynamic = 'force-dynamic';

const expired = () =>
  NextResponse.json({ error: 'This shop link has expired. Send "menu" to the shop on WhatsApp for a new one.' }, { status: 404 });

function waMeLink(phone: string | null): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
}

/** GET: the shop's items for the customer the link was sent to. Tenant comes only from the token. */
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const link = await resolveShopLink(params.token);
  if (!link) return expired();
  const settings = await getShopSettings(link.businessId);
  if (!settings.enabled) return expired();

  const [business, items, customer] = await Promise.all([
    loadShopBusiness(link.businessId),
    loadShopItems(link.businessId, settings),
    queryOne<{ name: string | null; address: string | null }>(
      `SELECT COALESCE(c.name, wc.whatsapp_display_name) AS name,
              COALESCE(c.shipping_address, c.address, c.billing_address) AS address
         FROM whatsapp_conversations wc
         LEFT JOIN customers c ON c.id = wc.customer_id AND c.deleted_at IS NULL
        WHERE wc.business_id = $1 AND wc.conversation_id = $2
        LIMIT 1`,
      [link.businessId, link.phone],
    ).catch(() => null),
  ]);

  return NextResponse.json(
    {
      shop: { name: business.name, whatsappUrl: waMeLink(business.phone), welcomeText: settings.welcomeText },
      customer: { name: customer?.name ?? '', address: customer?.address ?? '' },
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        price: i.price,
        mrp: i.mrp,
        unit: i.unit,
        category: i.categoryName,
        inStock: i.inStock,
        image: shopImageUrl(i),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** POST: place the cart as an order; the summary and payment link also go to the WhatsApp chat. */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const rl = checkRateLimit(`wa-shop-order:${params.token}`, 8, 10 * 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });

  const link = await resolveShopLink(params.token);
  if (!link) return expired();

  let body: { lines?: unknown; name?: unknown; address?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const lines = Array.isArray(body.lines)
    ? body.lines.slice(0, SHOP_MAX_LINES).map((l) => ({
        itemId: String((l as { item_id?: unknown })?.item_id ?? ''),
        quantity: Number((l as { quantity?: unknown })?.quantity ?? 0),
      }))
    : [];
  if (lines.length === 0) return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 });

  const outcome = await placeShopOrder({
    businessId: link.businessId,
    phone: link.phone,
    conversationUuid: link.conversationUuid,
    customerName: typeof body.name === 'string' ? body.name : null,
    address: typeof body.address === 'string' ? body.address : null,
    lines,
  });

  await sendShopOrderReply(link.businessId, link.phone, outcome).catch((e) =>
    console.error('[whatsapp-shop] order reply failed:', e instanceof Error ? e.message : e),
  );

  if (!outcome.ok) {
    const error =
      outcome.reason === 'SHOP_OFF'
        ? 'This shop is not taking WhatsApp orders right now.'
        : 'None of the items in your cart are available any more.';
    return NextResponse.json({ error, unavailable: outcome.unavailable }, { status: 409 });
  }
  await recordShopLinkOrder(params.token, outcome.orderId);
  return NextResponse.json({
    orderNumber: outcome.orderNumber,
    total: outcome.total,
    lines: outcome.lines,
    unavailable: outcome.unavailable,
    paymentLink: outcome.paymentLink,
    manualPayment: outcome.manualPayment,
  });
}
