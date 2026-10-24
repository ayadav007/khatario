import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { sanitizeContactForm } from '@/lib/store/store-theme';
import { validateEnquiry } from '@/lib/store/enquiry';
import { notifyStoreMerchantEnquiry } from '@/lib/store/notify-merchant';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const TEN_MINUTES = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

/** POST /api/public/store/[subdomain]/enquiries — storefront contact form. */
export async function POST(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  const store = await resolveStoreBySubdomain(params.subdomain);
  if (!store) {
    return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  }
  if (store.is_demo) {
    return NextResponse.json({ error: 'This is a theme preview. Messages are not sent.' }, { status: 403 });
  }

  const form = sanitizeContactForm(store.store_theme?.contact_form);
  if (!form.enabled) {
    return NextResponse.json({ error: 'This store is not accepting messages' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const result = validateEnquiry(body, form);
  // Typos are not counted against the limit; only real sends and spam are.
  if (!result.ok && !result.spam) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const ip = getClientIp(request);
  const perVisitor = checkRateLimit(`store-enquiry:${store.business_id}:${ip}`, 3, TEN_MINUTES);
  const perStore = checkRateLimit(`store-enquiry:${store.business_id}`, 40, ONE_HOUR);
  if (!perVisitor.allowed || !perStore.allowed) {
    const wait = Math.max(perVisitor.retryAfterMs, perStore.retryAfterMs);
    return NextResponse.json(
      { error: 'Too many messages. Please try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(wait / 1000)) } },
    );
  }

  // Bots get the same success shape so they don't learn to dodge the trap.
  if (!result.ok) return NextResponse.json({ success: true });

  const { name, phone, email, topic, message, source_path } = result.value;
  const ipHash = createHash('sha256').update(`${store.business_id}:${ip}`).digest('hex');
  const row = await queryOne<{ id: string }>(
    `INSERT INTO store_enquiries (business_id, name, phone, email, topic, message, source_path, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [store.business_id, name, phone, email, topic, message, source_path, ipHash],
  );
  if (!row) {
    return NextResponse.json({ error: 'Could not send your message' }, { status: 500 });
  }

  void notifyStoreMerchantEnquiry({
    businessId: store.business_id,
    enquiryId: row.id,
    name,
    phone,
    email,
    topic,
    message,
  }).catch((err) => console.error('[store-enquiry] notify failed', err));

  return NextResponse.json({ success: true });
}
