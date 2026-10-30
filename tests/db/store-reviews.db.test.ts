/**
 * Store reviews on a real database (store shopping features, phase 3, task 14): eligibility from
 * delivered orders, status and rating-row rule, one review per shopper per item, the 30-day edit
 * window and business-scoped moderation. Opt-in, disposable DB only:
 *   STORE_FEATURES_DB_TEST=1 npx jest tests/db/store-reviews.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test; migration 448 must be applied there.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';
import { config as loadEnv } from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = 'kh_phase2_test';
const enabled = !!process.env.PHASE2_TEST_DATABASE_URL || process.env.STORE_FEATURES_DB_TEST === '1';
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
} else if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}
const d = enabled ? describe : describe.skip;

jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn().mockResolvedValue(true),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));
process.env.JWT_SECRET = process.env.JWT_SECRET || 'store-reviews-test-secret';

import { getPool, closePool } from '@/lib/db';
import { signStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { GET as getItemReviews } from '@/app/api/public/store/[subdomain]/items/[id]/reviews/route';
import { POST as postReview } from '@/app/api/public/store/[subdomain]/reviews/route';
import { PATCH as patchReview } from '@/app/api/public/store/[subdomain]/reviews/[id]/route';
import { POST as postPhoto } from '@/app/api/public/store/[subdomain]/reviews/photos/route';
import { POST as postRating } from '@/app/api/public/store/[subdomain]/ratings/route';
import { GET as adminList } from '@/app/api/settings/online-store/reviews/route';
import { GET as serveMedia } from '@/app/media/store-reviews/[business]/[file]/route';
import { PATCH as adminPatch } from '@/app/api/settings/online-store/reviews/[id]/route';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import {
  canReview,
  createReview,
  updateReview,
  moderateReview,
  reviewSummary,
  listReviews,
  listReviewsForMerchant,
} from '@/lib/store/reviews';

d('store reviews (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const OTHER_B = randomUUID();
  const ITEM = randomUUID();
  const ITEM2 = randomUUID();
  const OWNER = randomUUID();
  const tag = B.slice(0, 8);
  const SUB = `rv-${tag}`;

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  let seq = 0;
  async function shopper(name = 'Priya Sharma'): Promise<string> {
    const id = randomUUID();
    seq += 1;
    await pool.query(`INSERT INTO store_customers (id, business_id, phone, name) VALUES ($1, $2, $3, $4)`, [
      id,
      B,
      `98${String(Date.now()).slice(-6)}${String(seq).padStart(2, '0')}`,
      name,
    ]);
    return id;
  }
  async function order(customerId: string, itemId: string, status: string, ago = '0 days'): Promise<string> {
    const id = randomUUID();
    seq += 1;
    await pool.query(
      `INSERT INTO store_orders (id, business_id, order_number, customer_name, customer_phone, status, store_customer_id, created_at)
       VALUES ($1, $2, $3, 'Buyer', '9000000000', $4, $5, now() - $6::interval)`,
      [id, B, `RV-${tag}-${seq}`, status, customerId, ago],
    );
    await pool.query(
      `INSERT INTO store_order_items (order_id, item_id, item_name, quantity, unit, unit_price, tax_rate, line_total)
       VALUES ($1, $2, 'Thing', 1, 'PCS', 100, 0, 100)`,
      [id, itemId],
    );
    return id;
  }
  const ratingRow = async (customerId: string, itemId = ITEM) =>
    (
      await pool.query(`SELECT rating FROM store_item_ratings WHERE business_id=$1 AND customer_id=$2 AND item_id=$3`, [
        B,
        customerId,
        itemId,
      ])
    ).rows;

  beforeAll(async () => {
    pool = getPool();
    const db = (await pool.query(`SELECT current_database() AS db`)).rows[0].db;
    if (db !== TEST_DB) throw new Error(`Refusing: connected to ${db}`);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, phone)
       VALUES ($1, $2, $3, '27', 'regular', '9000000005'), ($4, $5, $6, '27', 'regular', '9000000006')`,
      [
        B, `Review Traders ${tag}`, `27AABCR${tag.slice(0, 4).toUpperCase()}K1Z5`,
        OTHER_B, `Other Review ${tag}`, `27AABCS${tag.slice(0, 4).toUpperCase()}K1Z5`,
      ],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, is_active) VALUES ($1, $2, 'Owner', $3, true, true)`,
      [OWNER, B, `91${Date.now().toString().slice(-9)}`],
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled) VALUES ($1, $2, true)
       ON CONFLICT (business_id) DO UPDATE SET store_subdomain = EXCLUDED.store_subdomain, store_enabled = true`,
      [B, SUB],
    );
    for (const id of [ITEM, ITEM2]) {
      await pool.query(
        `INSERT INTO items (id, business_id, name, unit, selling_price, tax_rate, current_stock, show_in_store, is_active, item_type)
         VALUES ($1, $2, $3, 'PCS', 100, 0, 10, true, true, 'goods')`,
        [id, B, id === ITEM ? 'Reviewed Mug' : 'Other Mug'],
      );
    }
  });

  const MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-review-media-'));
  process.env.STORE_REVIEW_MEDIA_DIR = MEDIA_DIR;

  afterAll(async () => {
    fs.rmSync(MEDIA_DIR, { recursive: true, force: true });
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          // Order lines restrict item deletion, so orders go first.
          await c.query(`DELETE FROM store_orders WHERE business_id = ANY($1::uuid[])`, [[B, OTHER_B]]);
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER_B]]);
        });
      });
    } finally {
      await closePool();
    }
  });

  test('anonymous visitor is asked to sign in', async () => {
    expect(await canReview(B, null, ITEM)).toEqual({ ok: false, reason: 'sign_in' });
  });

  test('refuses a shopper without a delivered order', async () => {
    const s = await shopper();
    await order(s, ITEM, 'pending');
    expect(await canReview(B, s, ITEM)).toEqual({ ok: false, reason: 'not_bought' });
    await expect(createReview(B, s, { item_id: ITEM, rating: 5, body: 'Lovely mug indeed' })).rejects.toMatchObject({
      code: 'not_eligible',
    });
  });

  test('refuses a shopper whose only order with the item is cancelled', async () => {
    const s = await shopper();
    await order(s, ITEM, 'cancelled');
    expect(await canReview(B, s, ITEM)).toEqual({ ok: false, reason: 'not_bought' });
  });

  test('publishes a text review and writes the rating row', async () => {
    const s = await shopper('Priya Sharma');
    await order(s, ITEM2, 'delivered');
    const older = await order(s, ITEM, 'delivered', '5 days');
    const latest = await order(s, ITEM, 'delivered', '1 day');
    expect(await canReview(B, s, ITEM)).toEqual({ ok: true, orderId: latest });
    expect(older).not.toBe(latest);
    const r = await createReview(B, s, { item_id: ITEM, rating: 4, title: ' Nice ', body: '  Works really well  ' });
    expect(r).toMatchObject({
      status: 'published',
      rating: 4,
      title: 'Nice',
      body: 'Works really well',
      customer_name: 'Priya S.',
    });
    expect(Number((await ratingRow(s))[0].rating)).toBe(4);
    expect((await pool.query(`SELECT order_id FROM store_item_reviews WHERE id=$1`, [r.id])).rows[0].order_id).toBe(latest);
    expect(await canReview(B, s, ITEM)).toEqual({ ok: false, reason: 'already_reviewed' });
  });

  test('one review per shopper per item', async () => {
    const s = await shopper();
    await order(s, ITEM, 'delivered');
    await createReview(B, s, { item_id: ITEM, rating: 5, body: 'First review here' });
    await expect(createReview(B, s, { item_id: ITEM, rating: 3, body: 'Second review here' })).rejects.toMatchObject({
      code: 'already_reviewed',
    });
  });

  test('rejects invalid input', async () => {
    const s = await shopper();
    await order(s, ITEM, 'delivered');
    await expect(createReview(B, s, { item_id: ITEM, rating: 6, body: 'Long enough body' })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(createReview(B, s, { item_id: ITEM, rating: 5, body: 'short' })).rejects.toMatchObject({
      code: 'invalid',
    });
  });

  test('keeps a photo review pending with no rating row until published', async () => {
    const s = await shopper('Ravi');
    await order(s, ITEM, 'delivered');
    const r = await createReview(B, s, { item_id: ITEM, rating: 2, body: 'Photo of the damage', photos: ['/u/a.jpg'] });
    expect(r.status).toBe('pending');
    expect(r.customer_name).toBe('Ravi');
    expect(await ratingRow(s)).toHaveLength(0);
    const pub = await moderateReview(B, r.id, 'publish');
    expect(pub.status).toBe('published');
    expect(Number((await ratingRow(s))[0].rating)).toBe(2);
  });

  test('hide removes the rating row and publish restores it; summary excludes hidden', async () => {
    const s = await shopper('Meena Iyer');
    await order(s, ITEM2, 'delivered');
    const r = await createReview(B, s, { item_id: ITEM2, rating: 5, body: 'Five stars from me' });
    expect((await reviewSummary(B, ITEM2)).count).toBe(1);
    const hidden = await moderateReview(B, r.id, 'hide');
    expect(hidden.status).toBe('hidden');
    expect(await ratingRow(s, ITEM2)).toHaveLength(0);
    expect(await reviewSummary(B, ITEM2)).toEqual({ avg: 0, count: 0, histogram: [0, 0, 0, 0, 0] });
    expect((await listReviews({ businessId: B, itemId: ITEM2, sort: 'recent', page: 1 })).reviews).toHaveLength(0);
    await moderateReview(B, r.id, 'publish');
    expect(Number((await ratingRow(s, ITEM2))[0].rating)).toBe(5);
    expect(await reviewSummary(B, ITEM2)).toEqual({ avg: 5, count: 1, histogram: [1, 0, 0, 0, 0] });
  });

  test('author edit follows the resulting status', async () => {
    const s = await shopper('Asha Rao');
    await order(s, ITEM, 'delivered');
    const r = await createReview(B, s, { item_id: ITEM, rating: 5, body: 'Original review text' });
    const e = await updateReview(B, s, r.id, { rating: 3, body: 'Edited with a photo', photos: ['/u/b.jpg'] });
    expect(e.status).toBe('pending');
    expect(await ratingRow(s)).toHaveLength(0);
    const e2 = await updateReview(B, s, r.id, { rating: 3, body: 'Edited without photo' });
    expect(e2.status).toBe('published');
    expect(Number((await ratingRow(s))[0].rating)).toBe(3);
    // A hidden review stays hidden after an edit.
    await moderateReview(B, r.id, 'hide');
    const e3 = await updateReview(B, s, r.id, { rating: 4, body: 'Edited while hidden' });
    expect(e3.status).toBe('hidden');
    expect(await ratingRow(s)).toHaveLength(0);
    // Another shopper cannot edit it.
    const other = await shopper();
    await expect(updateReview(B, other, r.id, { rating: 1, body: 'Not my review text' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  test('a published photo review edited with the same photos stays published; a new photo makes it pending', async () => {
    const s = await shopper('Kavya');
    await order(s, ITEM, 'delivered');
    const r = await createReview(B, s, { item_id: ITEM, rating: 4, body: 'Nice mug with photos', photos: ['/u/p1.jpg', '/u/p2.jpg'] });
    await moderateReview(B, r.id, 'publish');
    // Same set in a different order: no re-approval, rating row kept with the new rating.
    const same = await updateReview(B, s, r.id, { rating: 5, body: 'Even nicer after a week', photos: ['/u/p2.jpg', '/u/p1.jpg'] });
    expect(same.status).toBe('published');
    expect(Number((await ratingRow(s))[0].rating)).toBe(5);
    const added = await updateReview(B, s, r.id, { rating: 5, body: 'Added one more photo', photos: ['/u/p1.jpg', '/u/p2.jpg', '/u/p3.jpg'] });
    expect(added.status).toBe('pending');
    expect(await ratingRow(s)).toHaveLength(0);
  });

  test('author cannot edit after 30 days', async () => {
    const s = await shopper();
    await order(s, ITEM, 'delivered');
    const r = await createReview(B, s, { item_id: ITEM, rating: 5, body: 'Old review text' });
    await pool.query(`UPDATE store_item_reviews SET created_at = now() - interval '31 days' WHERE id = $1`, [r.id]);
    await expect(updateReview(B, s, r.id, { rating: 1, body: 'Too late to change' })).rejects.toMatchObject({
      code: 'edit_window_closed',
    });
  });

  test('merchant of another business cannot moderate', async () => {
    const s = await shopper();
    await order(s, ITEM, 'delivered');
    const r = await createReview(B, s, { item_id: ITEM, rating: 5, body: 'Guarded review text' });
    await expect(moderateReview(OTHER_B, r.id, 'hide')).rejects.toMatchObject({ code: 'not_found' });
    expect((await pool.query(`SELECT status FROM store_item_reviews WHERE id=$1`, [r.id])).rows[0].status).toBe(
      'published',
    );
  });

  test('reply and delete_reply, listing sorts and merchant list', async () => {
    const s = await shopper('Dev Patel');
    await order(s, ITEM, 'delivered');
    const r = await createReview(B, s, { item_id: ITEM, rating: 1, body: 'Arrived broken, sadly' });
    await expect(moderateReview(B, r.id, 'reply', '   ')).rejects.toMatchObject({ code: 'invalid' });
    const replied = await moderateReview(B, r.id, 'reply', 'So sorry, we will replace it');
    expect(replied.merchant_reply).toBe('So sorry, we will replace it');
    expect(replied.replied_at).toBeTruthy();
    const cleared = await moderateReview(B, r.id, 'delete_reply');
    expect(cleared.merchant_reply).toBeNull();
    expect(cleared.replied_at).toBeNull();

    const lowest = await listReviews({ businessId: B, itemId: ITEM, sort: 'lowest', page: 1, pageSize: 2 });
    expect(lowest.reviews[0].rating).toBe(1);
    expect(lowest.hasMore).toBe(true);
    expect(lowest.reviews[0]).not.toHaveProperty('phone');
    const highest = await listReviews({ businessId: B, itemId: ITEM, sort: 'highest', page: 1 });
    expect(highest.reviews[0].rating).toBe(5);
    const withPhotos = await listReviews({ businessId: B, itemId: ITEM, sort: 'with_photos', page: 1 });
    expect(withPhotos.reviews.every((x) => x.photos.length > 0)).toBe(true);

    const m = await listReviewsForMerchant({ businessId: B, status: 'published', page: 1 });
    expect(m.reviews.length).toBeGreaterThan(0);
    expect(m.reviews[0].item_name).toBeTruthy();
    expect(m.reviews[0].phone).toBeTruthy();
    expect((await listReviewsForMerchant({ businessId: OTHER_B, page: 1 })).reviews).toHaveLength(0);
  });

  describe('hardening', () => {
    test('cannot review an item hidden from the store', async () => {
      const s = await shopper();
      const hidden = randomUUID();
      await pool.query(
        `INSERT INTO items (id, business_id, name, unit, selling_price, tax_rate, current_stock, show_in_store, is_active, item_type)
         VALUES ($1, $2, 'Offline Mug', 'PCS', 100, 0, 10, false, true, 'goods')`,
        [hidden, B],
      );
      await order(s, hidden, 'delivered');
      await expect(createReview(B, s, { item_id: hidden, rating: 5, body: 'Lovely mug indeed' })).rejects.toMatchObject({
        code: 'not_found',
      });
    });

    test('unknown sort falls back to recent', async () => {
      const r = await listReviews({ businessId: B, itemId: ITEM, sort: 'constructor' as any, page: 1 });
      expect(Array.isArray(r.reviews)).toBe(true);
    });
  });

  describe('review routes', () => {
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    /** Multipart request with the Content-Length a browser would send. */
    const photoReq = async (file: File | null, cust?: string, itemId: string | null = ITEM, extra: Record<string, string> = {}) => {
      const fd = new FormData();
      if (file) fd.append('file', file);
      if (itemId) fd.append('item_id', itemId);
      const raw = new Response(fd);
      const buf = Buffer.from(await raw.arrayBuffer());
      return new NextRequest(`http://localhost${reviewsUrl}/photos`, {
        method: 'POST',
        headers: {
          'content-type': raw.headers.get('content-type') as string,
          'content-length': String(buf.length),
          ...(cust ? { cookie: cookie(cust) } : {}),
          ...extra,
        },
        body: buf,
      });
    };
    const uploadPhoto = async (cust: string): Promise<string> => {
      const res = await postPhoto(await await photoReq(new File([PNG], 'a.png', { type: 'image/png' }), cust), { params: sub });
      expect(res.status).toBe(200);
      return (await res.json()).url;
    };
    const cookie = (cust: string, biz = B) => `${STORE_CUSTOMER_COOKIE}=${signStoreCustomer(biz, cust)}`;
    const pubReq = (url: string, method = 'GET', body?: unknown, cust?: string) =>
      new NextRequest(`http://localhost${url}`, {
        method,
        headers: { 'content-type': 'application/json', ...(cust ? { cookie: cookie(cust) } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const adminReq = (url: string, method = 'GET', body?: unknown, businessId = B) =>
      new NextRequest(`http://localhost${url}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': OWNER,
          'x-authenticated-business-id': businessId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const sub = { subdomain: SUB };
    const reviewsUrl = `/api/public/store/${SUB}/reviews`;
    const buyer = async (item = ITEM) => {
      const s = await shopper();
      await order(s, item, 'delivered');
      return s;
    };

    test('POST without a cookie is 401', async () => {
      const res = await postReview(pubReq(reviewsUrl, 'POST', { item_id: ITEM, rating: 5, body: 'Lovely mug indeed' }), { params: sub });
      expect(res.status).toBe(401);
    });

    test('POST creates a review for a buyer and ignores client-sent ids; non-buyer gets 403 with reason', async () => {
      const s = await buyer();
      const res = await postReview(
        pubReq(reviewsUrl, 'POST', {
          item_id: ITEM, rating: 5, body: 'Lovely mug indeed', customer_id: randomUUID(), business_id: OTHER_B,
        }, s),
        { params: sub },
      );
      expect(res.status).toBe(201);
      const { review } = await res.json();
      expect(review.status).toBe('published');
      const row = (await pool.query(`SELECT business_id, customer_id FROM store_item_reviews WHERE id=$1`, [review.id])).rows[0];
      expect(row).toEqual({ business_id: B, customer_id: s });

      const stranger = await shopper();
      const denied = await postReview(pubReq(reviewsUrl, 'POST', { item_id: ITEM, rating: 5, body: 'Lovely mug indeed' }, stranger), { params: sub });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ reason: 'not_bought' });

      const dup = await postReview(pubReq(reviewsUrl, 'POST', { item_id: ITEM, rating: 4, body: 'Second try here ok' }, s), { params: sub });
      expect(dup.status).toBe(409);
    });

    test('POST with a non-uuid item_id is 400, not a database error', async () => {
      const s = await buyer();
      const res = await postReview(pubReq(reviewsUrl, 'POST', { item_id: 'not-a-uuid', rating: 5, body: 'Lovely mug indeed' }, s), { params: sub });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'item_id is not valid' });
    });

    test('POST with a photo that did not come from our upload route is 400', async () => {
      const s = await buyer();
      for (const photo of ['https://evil.example/x.jpg', '/store-reviews/other/x.jpg', 'data:image/png;base64,iVBORw0KGgo=', 'javascript:alert(1)', `/media/store-reviews/${OTHER_B}/${'a'.repeat(64)}.webp`, `/media/store-reviews/${B}/..%2F${'a'.repeat(64)}.webp`]) {
        const res = await postReview(
          pubReq(reviewsUrl, 'POST', { item_id: ITEM, rating: 5, body: 'Lovely mug indeed', photos: [photo] }, s),
          { params: sub },
        );
        expect(res.status).toBe(400);
      }
      const ok = await postReview(pubReq(reviewsUrl, 'POST', { item_id: ITEM, rating: 5, body: 'Lovely mug indeed', photos: [await uploadPhoto(s)] }, s), { params: sub });
      expect(ok.status).toBe(201);
      expect((await ok.json()).review.status).toBe('pending');
    });

    test('PATCH edits own review; another shopper gets 404; closed window is 403', async () => {
      const s = await buyer();
      const created = await (
        await postReview(pubReq(reviewsUrl, 'POST', { item_id: ITEM, rating: 5, body: 'Lovely mug indeed' }, s), { params: sub })
      ).json();
      const id = created.review.id;
      const ctx = { params: { ...sub, id } };
      const edit = (body: unknown, cust?: string) => patchReview(pubReq(`${reviewsUrl}/${id}`, 'PATCH', body, cust), ctx);
      const edited = await edit({ rating: 3, body: 'Changed my mind a bit' }, s);
      expect(edited.status).toBe(200);
      expect((await edited.json()).review.rating).toBe(3);
      const other = await shopper();
      expect((await edit({ rating: 1, body: 'Not my review at all' }, other)).status).toBe(404);
      expect((await edit({ rating: 1, body: 'Not signed in at all' })).status).toBe(401);
      await pool.query(`UPDATE store_item_reviews SET created_at = now() - interval '31 days' WHERE id = $1`, [id]);
      expect((await edit({ rating: 2, body: 'Too late to change' }, s)).status).toBe(403);
    });

    test('admin hide removes the review from the public GET; reply and scoping work', async () => {
      const item = randomUUID();
      await pool.query(
        `INSERT INTO items (id, business_id, name, unit, selling_price, tax_rate, current_stock, show_in_store, is_active, item_type)
         VALUES ($1, $2, 'Moderated Mug', 'PCS', 100, 0, 10, true, true, 'goods')`,
        [item, B],
      );
      const s = await buyer(item);
      const created = await (
        await postReview(pubReq(reviewsUrl, 'POST', { item_id: item, rating: 4, body: 'Decent mug overall' }, s), { params: sub })
      ).json();
      const id = created.review.id;
      const itemCtx = { params: { ...sub, id: item } };
      const list = async (qs = '', cust: string | null = s) =>
        (await getItemReviews(pubReq(`/api/public/store/${SUB}/items/${item}/reviews${qs}`, 'GET', undefined, cust ?? undefined), itemCtx)).json();
      let pubList = await list();
      expect(pubList.reviews.map((r: any) => r.id)).toEqual([id]);
      expect(pubList.summary.count).toBe(1);
      expect(pubList.can_review).toEqual({ ok: false, reason: 'already_reviewed' });
      expect(pubList.reviews[0]).not.toHaveProperty('phone');
      expect((await list('?sort=bogus&page=-3', null)).can_review).toEqual({ ok: false, reason: 'sign_in' });

      const adm = await adminList(adminReq('/api/settings/online-store/reviews?status=published'));
      expect(adm.status).toBe(200);
      expect((await adm.json()).reviews.some((r: any) => r.id === id)).toBe(true);

      const act = (body: unknown, biz = B) =>
        adminPatch(adminReq(`/api/settings/online-store/reviews/${id}`, 'PATCH', body, biz), { params: { id } });
      const reply = await act({ action: 'reply', reply: 'Thanks for the feedback' });
      expect((await reply.json()).review.merchant_reply).toBe('Thanks for the feedback');
      expect((await act({ action: 'nuke' })).status).toBe(400);
      // another business's session cannot touch it
      expect((await act({ action: 'hide' }, OTHER_B)).status).toBe(404);
      expect((await pool.query(`SELECT status FROM store_item_reviews WHERE id=$1`, [id])).rows[0].status).toBe('published');

      expect((await act({ action: 'hide' })).status).toBe(200);
      pubList = await list();
      expect(pubList.reviews).toHaveLength(0);
      expect(pubList.summary.count).toBe(0);
    });

    test('photo route: needs a session, rejects PDF and big files, stores an image on disk and serves it', async () => {
      const s = await buyer();
      const png = new File([PNG], 'a.png', { type: 'image/png' });
      expect((await postPhoto(await photoReq(png), { params: sub })).status).toBe(401);
      expect((await postPhoto(await photoReq(new File([PNG], 'a.pdf', { type: 'application/pdf' }), s), { params: sub })).status).toBe(400);
      expect((await postPhoto(await photoReq(new File([Buffer.alloc(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }), s), { params: sub })).status).toBe(400);
      expect((await postPhoto(await photoReq(new File([Buffer.from('<html>')], 'x.png', { type: 'image/png' }), s), { params: sub })).status).toBe(400);
      expect((await postPhoto(await photoReq(null, s), { params: sub })).status).toBe(400);
      const ok = await postPhoto(await photoReq(png, s), { params: sub });
      expect(ok.status).toBe(200);
      const { url } = await ok.json();
      expect(url).toMatch(new RegExp(`^/media/store-reviews/${B}/[a-f0-9]{64}\.webp$`));
      const [, , , biz, file] = url.split('/');
      expect(fs.existsSync(path.join(MEDIA_DIR, biz, file))).toBe(true);
      const served = await serveMedia(new NextRequest(`http://localhost${url}`), { params: { business: biz, file } });
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('image/webp');
      expect((await served.arrayBuffer()).byteLength).toBeGreaterThan(0);
      for (const [b2, f2] of [[biz, 'x.webp'], [biz, '..%2Fa.webp'], ['..', file], [OTHER_B, file]]) {
        expect((await serveMedia(new NextRequest('http://localhost/media/store-reviews/x/y'), { params: { business: b2, file: f2 } })).status).toBe(404);
      }
    });

    test('photo route: oversize Content-Length is 413 before parsing; missing is 411', async () => {
      const s = await buyer();
      const before = fs.readdirSync(MEDIA_DIR).length;
      const png = new File([PNG], 'a.png', { type: 'image/png' });
      const big = await photoReq(png, s, ITEM, { 'content-length': String(3 * 1024 * 1024) });
      expect((await postPhoto(big, { params: sub })).status).toBe(413);
      const none = await photoReq(png, s);
      none.headers.delete('content-length');
      expect((await postPhoto(none, { params: sub })).status).toBe(411);
      expect(fs.readdirSync(MEDIA_DIR).length).toBe(before);
    });

    test('photo route: only a buyer (or past reviewer) of the item may upload', async () => {
      const png = new File([PNG], 'a.png', { type: 'image/png' });
      const stranger = await shopper();
      const denied = await postPhoto(await photoReq(png, stranger), { params: sub });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ reason: 'not_bought' });
      const s = await buyer();
      expect((await postPhoto(await photoReq(png, s, null), { params: sub })).status).toBe(400);
      expect((await postPhoto(await photoReq(png, s, 'not-a-uuid'), { params: sub })).status).toBe(400);
      await createReview(B, s, { item_id: ITEM, rating: 5, body: 'Reviewed already ok' });
      expect((await postPhoto(await photoReq(png, s), { params: sub })).status).toBe(200);
    });

    test('photo route: 13th upload by one shopper in an hour is 429', async () => {
      const s = await buyer();
      const pdf = new File([PNG], 'a.pdf', { type: 'application/pdf' });
      let last = 0;
      for (let i = 0; i < 13; i++) last = (await postPhoto(await photoReq(pdf, s), { params: sub })).status;
      expect(last).toBe(429);
    });

    test('malformed ids are 404 and a hidden item has no public reviews', async () => {
      const s = await buyer();
      expect((await getItemReviews(pubReq(`/api/public/store/${SUB}/items/nope/reviews`), { params: { ...sub, id: 'nope' } })).status).toBe(404);
      const offline = randomUUID();
      await pool.query(
        `INSERT INTO items (id, business_id, name, unit, selling_price, tax_rate, current_stock, show_in_store, is_active, item_type)
         VALUES ($1, $2, 'Hidden Mug', 'PCS', 100, 0, 10, false, true, 'goods')`,
        [offline, B],
      );
      expect((await getItemReviews(pubReq(`/api/public/store/${SUB}/items/${offline}/reviews`), { params: { ...sub, id: offline } })).status).toBe(404);
      expect((await patchReview(pubReq(`${reviewsUrl}/nope`, 'PATCH', { rating: 3, body: 'Edited text here' }, s), { params: { ...sub, id: 'nope' } })).status).toBe(404);
      expect((await adminPatch(adminReq('/api/settings/online-store/reviews/nope', 'PATCH', { action: 'hide' }), { params: { id: 'nope' } })).status).toBe(404);
    });

    test('legacy ratings route refuses a shopper who has a review and leaves ratings alone', async () => {
      const s = await buyer(ITEM2);
      await createReview(B, s, { item_id: ITEM2, rating: 5, body: 'Five stars from me' });
      const res = await postRating(pubReq(`/api/public/store/${SUB}/ratings`, 'POST', { item_id: ITEM2, rating: 1 }, s), { params: sub });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('You have reviewed this product. Edit your review to change the rating.');
      expect(Number((await ratingRow(s, ITEM2))[0].rating)).toBe(5);
      const plain = await shopper();
      expect((await postRating(pubReq(`/api/public/store/${SUB}/ratings`, 'POST', { item_id: ITEM2, rating: 4 }, plain), { params: sub })).status).toBe(200);
    });

    test("GET flags the session shopper's own row with is_mine and returns my_review in any status", async () => {
      const [published, pendingItem] = [randomUUID(), randomUUID()];
      for (const [id, name] of [[published, 'Mine Mug'], [pendingItem, 'Pending Mug']]) {
        await pool.query(
          `INSERT INTO items (id, business_id, name, unit, selling_price, tax_rate, current_stock, show_in_store, is_active, item_type)
           VALUES ($1, $2, $3, 'PCS', 100, 0, 10, true, true, 'goods')`,
          [id, B, name],
        );
      }
      const author = await buyer(published);
      await order(author, pendingItem, 'delivered');
      const other = await buyer(published);
      const mine = await createReview(B, author, { item_id: published, rating: 5, body: 'My own published review' });
      const theirs = await createReview(B, other, { item_id: published, rating: 3, body: 'Someone else wrote this' });
      const pending = await createReview(B, author, {
        item_id: pendingItem, rating: 4, body: 'Waiting on the photo check', photos: [`/media/store-reviews/${B}/${'b'.repeat(64)}.webp`],
      });
      expect(pending.status).toBe('pending');
      const get = async (item: string, cust?: string) =>
        (await getItemReviews(pubReq(`/api/public/store/${SUB}/items/${item}/reviews`, 'GET', undefined, cust), { params: { ...sub, id: item } })).json();

      const asAuthor = await get(published, author);
      const flags = Object.fromEntries(asAuthor.reviews.map((r: any) => [r.id, r.is_mine]));
      expect(flags).toEqual({ [mine.id]: true, [theirs.id]: false });
      expect(asAuthor.my_review).toMatchObject({ id: mine.id, status: 'published', is_mine: true });
      expect(asAuthor.my_review).not.toHaveProperty('customer_id');
      expect(asAuthor.reviews[0]).not.toHaveProperty('customer_id');

      const pendingView = await get(pendingItem, author);
      expect(pendingView.reviews).toHaveLength(0);
      expect(pendingView.my_review).toMatchObject({ id: pending.id, status: 'pending', is_mine: true });

      const anon = await get(published);
      expect(anon.my_review).toBeNull();
      expect(anon.reviews.length).toBe(2);
      expect(anon.reviews.every((r: any) => r.is_mine === false)).toBe(true);
      // another store's session for the same customer id is not this store's shopper
      const foreign = (await getItemReviews(
        new NextRequest(`http://localhost/api/public/store/${SUB}/items/${published}/reviews`, { headers: { cookie: cookie(author, OTHER_B) } }),
        { params: { ...sub, id: published } },
      ).then((r) => r.json()));
      expect(foreign.my_review).toBeNull();
      expect(foreign.reviews.every((r: any) => r.is_mine === false)).toBe(true);
    });
  });
});
