/**
 * Product reviews for the online store (shopping features, phase 3).
 *
 * Rating-row rule: a review's `store_item_ratings` row exists exactly when the review is
 * `published`, so the items query (which reads that table) always averages published reviews plus
 * legacy star-only ratings. Insert as pending -> no row; publish -> upsert; hide -> delete.
 */
import type { PoolClient } from 'pg';
import { query, queryRows, getPool } from '@/lib/db';

export type ReviewStatus = 'published' | 'pending' | 'hidden';
export type ReviewSort = 'recent' | 'highest' | 'lowest' | 'with_photos';

export type StoreReview = {
  id: string;
  item_id: string;
  rating: number;
  title: string | null;
  body: string;
  photos: string[];
  status: ReviewStatus;
  merchant_reply: string | null;
  replied_at: string | null;
  created_at: string;
  customer_name: string;
  /** Public list only: true on the signed-in shopper's own review (from the session, never the request). */
  is_mine?: boolean;
};

export type ReviewErrorCode = 'not_found' | 'not_eligible' | 'already_reviewed' | 'edit_window_closed' | 'invalid';

export class ReviewError extends Error {
  code: ReviewErrorCode;
  /** For `not_eligible`: why `canReview` said no. */
  reason?: 'sign_in' | 'not_bought' | 'already_reviewed';
  constructor(code: ReviewErrorCode, message?: string, reason?: ReviewError['reason']) {
    super(message ?? code);
    this.name = 'ReviewError';
    this.code = code;
    this.reason = reason;
  }
}

export type ReviewInput = { rating: number; title?: string | null; body: string; photos?: string[] };

const EDIT_WINDOW_DAYS = 30;
const BODY_MIN = 10;
const BODY_MAX = 2000;
const TITLE_MAX = 120;
const MAX_PHOTOS = 4;
const REPLY_MAX = 1000;

/** Text-only reviews go live at once; reviews with photos wait for the merchant. */
export function reviewStatusFor(photos: string[]): ReviewStatus {
  return photos.length > 0 ? 'pending' : 'published';
}

/** Rows of {rating, n}; buckets run 5 stars first. `avg` is rounded to 1 decimal. */
export function histogram(rows: { rating: number; n: number }[]): {
  avg: number;
  count: number;
  histogram: [number, number, number, number, number];
} {
  const buckets: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let count = 0;
  let sum = 0;
  for (const r of rows) {
    const rating = Number(r.rating);
    const n = Number(r.n);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !(n > 0)) continue;
    buckets[5 - rating] += n;
    count += n;
    sum += rating * n;
  }
  return { avg: count ? Math.round((sum / count) * 10) / 10 : 0, count, histogram: buckets };
}

/** "Priya Sharma" -> "Priya S."; blank -> "Customer". */
function displayName(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Customer';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${Array.from(parts[parts.length - 1])[0].toUpperCase()}.`;
}

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function toReview(row: any): StoreReview {
  return {
    id: row.id,
    item_id: row.item_id,
    rating: Number(row.rating),
    title: row.title ?? null,
    body: row.body,
    photos: Array.isArray(row.photos) ? row.photos : [],
    status: row.status,
    merchant_reply: row.merchant_reply ?? null,
    replied_at: row.replied_at ? iso(row.replied_at) : null,
    created_at: iso(row.created_at),
    customer_name: displayName(row.customer_name),
  };
}

function cleanInput(input: ReviewInput): { rating: number; title: string | null; body: string; photos: string[] } {
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ReviewError('invalid', 'Rating must be 1 to 5');
  const body = String(input.body ?? '').trim();
  if (body.length < BODY_MIN || body.length > BODY_MAX) {
    throw new ReviewError('invalid', `Review must be ${BODY_MIN} to ${BODY_MAX} characters`);
  }
  const title = String(input.title ?? '').trim();
  if (title.length > TITLE_MAX) throw new ReviewError('invalid', `Title can be at most ${TITLE_MAX} characters`);
  const photos = input.photos ?? [];
  if (!Array.isArray(photos) || photos.length > MAX_PHOTOS || photos.some((p) => typeof p !== 'string' || !p)) {
    throw new ReviewError('invalid', `Up to ${MAX_PHOTOS} photos`);
  }
  return { rating, title: title || null, body, photos };
}

type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };
const pooled: Db = { query: (sql, params) => query(sql, params) };

async function eligibility(
  db: Db,
  businessId: string,
  customerId: string | null,
  itemId: string,
): Promise<{ ok: true; orderId: string } | { ok: false; reason: 'sign_in' | 'not_bought' | 'already_reviewed' }> {
  if (!customerId) return { ok: false, reason: 'sign_in' };
  const dup = await db.query(
    `SELECT 1 FROM store_item_reviews WHERE business_id = $1 AND customer_id = $2 AND item_id = $3`,
    [businessId, customerId, itemId],
  );
  if (dup.rows.length) return { ok: false, reason: 'already_reviewed' };
  const o = await db.query(
    `SELECT o.id FROM store_orders o
       JOIN store_order_items oi ON oi.order_id = o.id
      WHERE o.business_id = $1 AND o.store_customer_id = $2 AND o.status = 'delivered' AND oi.item_id = $3
      ORDER BY o.created_at DESC LIMIT 1`,
    [businessId, customerId, itemId],
  );
  if (!o.rows.length) return { ok: false, reason: 'not_bought' };
  return { ok: true, orderId: o.rows[0].id };
}

export async function canReview(businessId: string, customerId: string | null, itemId: string) {
  if (!customerId) return { ok: false as const, reason: 'sign_in' as const };
  return eligibility(pooled, businessId, customerId, itemId);
}

async function syncRatingRow(
  c: PoolClient,
  businessId: string,
  customerId: string,
  itemId: string,
  rating: number,
  status: ReviewStatus,
) {
  if (status === 'published') {
    await c.query(
      `INSERT INTO store_item_ratings (business_id, customer_id, item_id, rating)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (business_id, customer_id, item_id)
       DO UPDATE SET rating = EXCLUDED.rating, updated_at = CURRENT_TIMESTAMP`,
      [businessId, customerId, itemId, rating],
    );
  } else {
    await c.query(`DELETE FROM store_item_ratings WHERE business_id = $1 AND customer_id = $2 AND item_id = $3`, [
      businessId,
      customerId,
      itemId,
    ]);
  }
}

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
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

async function loadReview(db: Db, id: string): Promise<StoreReview> {
  const r = await db.query(
    `SELECT r.*, sc.name AS customer_name FROM store_item_reviews r
       JOIN store_customers sc ON sc.id = r.customer_id WHERE r.id = $1`,
    [id],
  );
  return toReview(r.rows[0]);
}

export async function createReview(
  businessId: string,
  customerId: string,
  input: ReviewInput & { item_id: string },
): Promise<StoreReview> {
  const clean = cleanInput(input);
  return inTx(async (c) => {
    const item = await c.query(
      `SELECT 1 FROM items
        WHERE id = $1 AND business_id = $2 AND show_in_store = true
          AND (is_active IS NULL OR is_active = true) AND deleted_at IS NULL`,
      [input.item_id, businessId],
    );
    if (!item.rows.length) throw new ReviewError('not_found', 'Product not found');
    const elig = await eligibility(c, businessId, customerId, input.item_id);
    if (!elig.ok) {
      if (elig.reason === 'already_reviewed') throw new ReviewError('already_reviewed', 'You already reviewed this product');
      throw new ReviewError('not_eligible', 'Only buyers with a delivered order can review', elig.reason);
    }
    const status = reviewStatusFor(clean.photos);
    let id: string;
    try {
      const ins = await c.query(
        `INSERT INTO store_item_reviews (business_id, customer_id, item_id, order_id, rating, title, body, photos, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) RETURNING id`,
        [businessId, customerId, input.item_id, elig.orderId, clean.rating, clean.title, clean.body, JSON.stringify(clean.photos), status],
      );
      id = ins.rows[0].id;
    } catch (e: any) {
      if (e?.code === '23505') throw new ReviewError('already_reviewed', 'You already reviewed this product');
      throw e;
    }
    await syncRatingRow(c, businessId, customerId, input.item_id, clean.rating, status);
    return loadReview(c, id);
  });
}

export async function updateReview(
  businessId: string,
  customerId: string,
  reviewId: string,
  input: ReviewInput,
): Promise<StoreReview> {
  const clean = cleanInput(input);
  return inTx(async (c) => {
    const cur = await c.query(
      `SELECT id, item_id, status, photos, created_at < now() - ($4 || ' days')::interval AS expired
         FROM store_item_reviews WHERE id = $1 AND business_id = $2 AND customer_id = $3 FOR UPDATE`,
      [reviewId, businessId, customerId, String(EDIT_WINDOW_DAYS)],
    );
    if (!cur.rows.length) throw new ReviewError('not_found', 'Review not found');
    const row = cur.rows[0];
    if (row.expired) throw new ReviewError('edit_window_closed', `Reviews can be edited for ${EDIT_WINDOW_DAYS} days`);
    // A review the merchant hid stays hidden; a published one keeping exactly the same photos stays
    // published (nothing new to approve); otherwise the photo rule decides again.
    const before = new Set<string>(Array.isArray(row.photos) ? row.photos.map(String) : []);
    const samePhotos = before.size === new Set(clean.photos).size && clean.photos.every((p) => before.has(p));
    const status: ReviewStatus =
      row.status === 'hidden'
        ? 'hidden'
        : row.status === 'published' && samePhotos
          ? 'published'
          : reviewStatusFor(clean.photos);
    await c.query(
      `UPDATE store_item_reviews
          SET rating = $2, title = $3, body = $4, photos = $5::jsonb, status = $6, updated_at = now()
        WHERE id = $1`,
      [reviewId, clean.rating, clean.title, clean.body, JSON.stringify(clean.photos), status],
    );
    await syncRatingRow(c, businessId, customerId, row.item_id, clean.rating, status);
    return loadReview(c, reviewId);
  });
}

export async function reviewSummary(businessId: string, itemId: string) {
  const rows = await queryRows<{ rating: number; n: string }>(
    `SELECT rating::int AS rating, COUNT(*)::int AS n FROM store_item_reviews
      WHERE business_id = $1 AND item_id = $2 AND status = 'published' GROUP BY rating`,
    [businessId, itemId],
  );
  return histogram(rows.map((r) => ({ rating: Number(r.rating), n: Number(r.n) })));
}

const ORDER_BY: Record<ReviewSort, string> = {
  recent: 'r.created_at DESC, r.id DESC',
  highest: 'r.rating DESC, r.created_at DESC, r.id DESC',
  lowest: 'r.rating ASC, r.created_at DESC, r.id DESC',
  with_photos: 'r.created_at DESC, r.id DESC',
};

/** Unknown sort values fall back to recent; only these keys ever reach SQL. */
export function parseReviewSort(v: unknown): ReviewSort {
  return typeof v === 'string' && Object.hasOwn(ORDER_BY, v) ? (v as ReviewSort) : 'recent';
}


export async function listReviews(opts: {
  businessId: string;
  itemId: string;
  sort: ReviewSort;
  page: number;
  pageSize?: number;
  /** Session shopper of this store; flags their own row with `is_mine`. */
  viewerCustomerId?: string | null;
}): Promise<{ reviews: StoreReview[]; hasMore: boolean }> {
  const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 10));
  const page = Math.max(1, Math.floor(opts.page) || 1);
  const sort = parseReviewSort(opts.sort);
  const photosOnly = sort === 'with_photos' ? `AND jsonb_array_length(r.photos) > 0` : '';
  const rows = await queryRows(
    `SELECT r.*, sc.name AS customer_name FROM store_item_reviews r
       JOIN store_customers sc ON sc.id = r.customer_id
      WHERE r.business_id = $1 AND r.item_id = $2 AND r.status = 'published' ${photosOnly}
      ORDER BY ${ORDER_BY[sort]}
      LIMIT $3 OFFSET $4`,
    [opts.businessId, opts.itemId, pageSize + 1, (page - 1) * pageSize],
  );
  const viewer = opts.viewerCustomerId ?? null;
  return {
    reviews: rows
      .slice(0, pageSize)
      .map((row) => ({ ...toReview(row), is_mine: viewer !== null && row.customer_id === viewer })),
    hasMore: rows.length > pageSize,
  };
}

/** The shopper's own review of an item in any status (pending and hidden included), or null. */
export async function myReview(
  businessId: string,
  customerId: string | null,
  itemId: string,
): Promise<StoreReview | null> {
  if (!customerId) return null;
  const rows = await queryRows(
    `SELECT r.*, sc.name AS customer_name FROM store_item_reviews r
       JOIN store_customers sc ON sc.id = r.customer_id
      WHERE r.business_id = $1 AND r.customer_id = $2 AND r.item_id = $3
      ORDER BY r.created_at DESC LIMIT 1`,
    [businessId, customerId, itemId],
  );
  return rows.length ? { ...toReview(rows[0]), is_mine: true } : null;
}

export async function listReviewsForMerchant(opts: {
  businessId: string;
  status?: ReviewStatus;
  page: number;
}): Promise<{ reviews: (StoreReview & { item_name: string; phone: string })[]; hasMore: boolean }> {
  const pageSize = 20;
  const page = Math.max(1, Math.floor(opts.page) || 1);
  const params: any[] = [opts.businessId, pageSize + 1, (page - 1) * pageSize];
  let statusSql = '';
  if (opts.status) {
    params.push(opts.status);
    statusSql = `AND r.status = $4`;
  }
  const rows = await queryRows(
    `SELECT r.*, sc.name AS customer_name, sc.phone, i.name AS item_name
       FROM store_item_reviews r
       JOIN store_customers sc ON sc.id = r.customer_id
       JOIN items i ON i.id = r.item_id
      WHERE r.business_id = $1 ${statusSql}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $2 OFFSET $3`,
    params,
  );
  return {
    reviews: rows.slice(0, pageSize).map((r: any) => ({ ...toReview(r), item_name: r.item_name, phone: r.phone })),
    hasMore: rows.length > pageSize,
  };
}

export async function moderateReview(
  businessId: string,
  reviewId: string,
  action: 'hide' | 'publish' | 'reply' | 'delete_reply',
  reply?: string,
): Promise<StoreReview> {
  let text = '';
  if (action === 'reply') {
    text = String(reply ?? '').trim();
    if (!text || text.length > REPLY_MAX) throw new ReviewError('invalid', `Reply must be 1 to ${REPLY_MAX} characters`);
  }
  return inTx(async (c) => {
    const cur = await c.query(
      `SELECT id, customer_id, item_id, rating FROM store_item_reviews WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [reviewId, businessId],
    );
    if (!cur.rows.length) throw new ReviewError('not_found', 'Review not found');
    const row = cur.rows[0];
    if (action === 'hide' || action === 'publish') {
      const status: ReviewStatus = action === 'hide' ? 'hidden' : 'published';
      await c.query(`UPDATE store_item_reviews SET status = $2, updated_at = now() WHERE id = $1`, [reviewId, status]);
      await syncRatingRow(c, businessId, row.customer_id, row.item_id, Number(row.rating), status);
    } else if (action === 'reply') {
      await c.query(
        `UPDATE store_item_reviews SET merchant_reply = $2, replied_at = now(), updated_at = now() WHERE id = $1`,
        [reviewId, text],
      );
    } else if (action === 'delete_reply') {
      await c.query(
        `UPDATE store_item_reviews SET merchant_reply = NULL, replied_at = NULL, updated_at = now() WHERE id = $1`,
        [reviewId],
      );
    } else {
      throw new ReviewError('invalid', 'Unknown action');
    }
    return loadReview(c, reviewId);
  });
}
