import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { verifyShopImageSignature } from '@/lib/whatsapp-shop/items';

export const dynamic = 'force-dynamic';

const DATA_URL_RE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i;

/** Item cover photo for Meta's catalog crawler and the cart page; the signature is per item. */
export async function GET(request: NextRequest, { params }: { params: { itemId: string } }) {
  const itemId = params.itemId;
  if (!verifyShopImageSignature(itemId, request.nextUrl.searchParams.get('s'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const row = await queryOne<{ image_url: string | null }>(
    `SELECT image_url FROM items WHERE id = $1 AND deleted_at IS NULL`,
    [itemId],
  ).catch(() => null);
  const match = row?.image_url ? DATA_URL_RE.exec(row.image_url.trim()) : null;
  if (!match) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': match[1].toLowerCase().replace('image/jpg', 'image/jpeg'),
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
