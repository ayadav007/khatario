import { NextRequest, NextResponse } from 'next/server';
import { storeReviewPhoto } from '@/lib/store/review-media';
import { canReview } from '@/lib/store/reviews';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { storeAndShopper, reviewErrorResponse, isUuid } from '@/lib/store/review-http';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 2 * 1024 * 1024;
// A little headroom for the multipart framing around a 2 MB file.
const MAX_BODY_BYTES = Math.floor(2.1 * 1024 * 1024);
const ONE_HOUR = 60 * 60 * 1000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Image type from the file's own first bytes, so a renamed file or a spoofed Content-Type cannot pass. */
function sniff(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 7 && b.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (b.length > 11 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Review photo upload: validated here, re-encoded to webp and stored on disk (lib/store/review-media).
 */
export async function POST(request: NextRequest, { params }: { params: { subdomain: string } }) {
  try {
    const { store, customerId } = await storeAndShopper(request, params.subdomain);
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    if (store.is_demo) return NextResponse.json({ error: 'Reviews are not available on a demo store' }, { status: 403 });
    if (!customerId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

    // Refuse oversized bodies before formData() buffers them.
    const length = Number(request.headers.get('content-length'));
    if (!request.headers.get('content-length') || !Number.isFinite(length)) {
      return NextResponse.json({ error: 'Content-Length required' }, { status: 411 });
    }
    if (length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Photos must be 2 MB or smaller.' }, { status: 413 });

    const perShopper = checkRateLimit(`store-review-photo:${store.business_id}:${customerId}`, 12, ONE_HOUR);
    const perIp = checkRateLimit(`store-review-photo-ip:${store.business_id}:${getClientIp(request)}`, 30, ONE_HOUR);
    if (!perShopper.allowed || !perIp.allowed) {
      return NextResponse.json({ error: 'Too many photos. Try again in a while.' }, { status: 429 });
    }

    const form = await request.formData().catch(() => null);
    const itemId = form?.get('item_id');
    if (!isUuid(itemId)) return NextResponse.json({ error: 'item_id required' }, { status: 400 });
    // Only a shopper who may review (or already has reviewed) this product can upload photos for it.
    const can = await canReview(store.business_id, customerId, itemId);
    if (!can.ok && can.reason !== 'already_reviewed') {
      return NextResponse.json({ error: 'Only buyers of this product can add photos', reason: can.reason }, { status: 403 });
    }

    const file = form?.get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG or WebP photos are allowed' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Photos must be 2 MB or smaller.' }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = sniff(bytes);
    if (!type || type !== file.type) return NextResponse.json({ error: 'That file is not a valid photo' }, { status: 400 });
    return NextResponse.json(await storeReviewPhoto(store.business_id, bytes));
  } catch (e) {
    return reviewErrorResponse(e);
  }
}
