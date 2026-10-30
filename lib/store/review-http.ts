import { NextRequest, NextResponse } from 'next/server';
import { resolveStoreBySubdomain, type StoreBusinessContext } from '@/lib/store/resolve-store';
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { ReviewError } from '@/lib/store/reviews';
import { isReviewPhotoUrl } from '@/lib/store/review-media';

/** Store plus the signed-in shopper of that store (null when absent or from another store). */
export async function storeAndShopper(request: NextRequest, subdomain: string) {
  const store = await resolveStoreBySubdomain(subdomain);
  const session = store ? readStoreCustomer(request.cookies.get(STORE_CUSTOMER_COOKIE)?.value) : null;
  const customerId = store && session && session.businessId === store.business_id ? session.customerId : null;
  return { store: store as StoreBusinessContext | null, customerId };
}

export function reviewErrorResponse(e: unknown): NextResponse {
  if (e instanceof ReviewError) {
    switch (e.code) {
      case 'invalid':
        return NextResponse.json({ error: e.message }, { status: 400 });
      case 'not_eligible':
        return NextResponse.json({ error: e.message, reason: e.reason }, { status: 403 });
      case 'already_reviewed':
        return NextResponse.json({ error: e.message }, { status: 409 });
      case 'edit_window_closed':
        return NextResponse.json({ error: e.message }, { status: 403 });
      case 'not_found':
        return NextResponse.json({ error: e.message }, { status: 404 });
    }
  }
  console.error('store review error:', e);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

/** Reads `{rating, title, body, photos}` from a JSON body; photos must be ones our photo route made. */
export function parseReviewBody(body: any, businessId: string):
  | { ok: true; input: { rating: number; title: string | null; body: string; photos: string[] } }
  | { ok: false; response: NextResponse } {
  const photos = body?.photos ?? [];
  if (!Array.isArray(photos) || !photos.every((u) => isReviewPhotoUrl(u, businessId))) {
    return { ok: false, response: NextResponse.json({ error: 'Photos must be uploaded through the store' }, { status: 400 }) };
  }
  return {
    ok: true,
    input: {
      rating: Number(body?.rating),
      title: typeof body?.title === 'string' ? body.title : null,
      body: typeof body?.body === 'string' ? body.body : '',
      photos,
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route ids reach uuid columns; a malformed one must be a 404, not a Postgres error. */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
