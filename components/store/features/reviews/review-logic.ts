/**
 * Pure helpers for the product review components (no React, no fetch), unit-tested in
 * tests/lib/store/review-components.test.ts.
 */
import type { ReviewSort, StoreReview } from '@/lib/store/reviews';

export type { ReviewSort, StoreReview };

export type ReviewSummaryData = {
  avg: number;
  count: number;
  /** 5 stars first. */
  histogram: number[];
};

export type CanReview = { ok: boolean; reason?: 'sign_in' | 'not_bought' | 'already_reviewed' };

export type ReviewDraft = { rating: number; title?: string | null; body: string; photos?: string[] };

export const REVIEW_BODY_MIN = 10;
export const REVIEW_BODY_MAX = 2000;
export const REVIEW_TITLE_MAX = 120;
export const REVIEW_MAX_PHOTOS = 4;
export const REVIEW_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const REVIEW_EDIT_DAYS = 30;
export const REVIEW_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const REVIEW_SORTS: { value: ReviewSort; label: string }[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'highest', label: 'Highest rating' },
  { value: 'lowest', label: 'Lowest rating' },
  { value: 'with_photos', label: 'With photos' },
];

export const EMPTY_SUMMARY: ReviewSummaryData = { avg: 0, count: 0, histogram: [0, 0, 0, 0, 0] };

/** "5 Oct 2026" (en-IN short date); blank for a missing or bad date. */
export function formatReviewDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export type ReviewCta =
  | { kind: 'write'; label: string }
  | { kind: 'sign_in'; label: string }
  | { kind: 'not_bought'; label: string }
  | { kind: 'reviewed'; label: string }
  | { kind: 'none' };

/** What the summary offers the shopper, from the API's `can_review`. */
export function reviewCta(can: CanReview | null | undefined): ReviewCta {
  if (!can) return { kind: 'none' };
  if (can.ok) return { kind: 'write', label: 'Write a review' };
  switch (can.reason) {
    case 'sign_in':
      return { kind: 'sign_in', label: 'Sign in to review' };
    case 'not_bought':
      return { kind: 'not_bought', label: 'Only customers who received this product can review it' };
    case 'already_reviewed':
      return { kind: 'reviewed', label: 'You reviewed this' };
    default:
      return { kind: 'none' };
  }
}

/** Client-side check before uploading a photo; the server checks again. */
export function checkReviewPhoto(file: { size: number; type: string }): string | null {
  if (!(REVIEW_PHOTO_TYPES as readonly string[]).includes(file.type)) return 'Use a JPEG, PNG or WebP photo.';
  if (file.size > REVIEW_PHOTO_MAX_BYTES) return 'Photos must be 2 MB or smaller.';
  return null;
}

/** First problem with a draft, or null when it can be sent. */
export function reviewDraftError(draft: ReviewDraft): string | null {
  if (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5) return 'Choose a star rating.';
  const body = draft.body.trim();
  if (body.length < REVIEW_BODY_MIN) return `Write at least ${REVIEW_BODY_MIN} characters.`;
  if (body.length > REVIEW_BODY_MAX) return `Keep your review under ${REVIEW_BODY_MAX} characters.`;
  if ((draft.title ?? '').trim().length > REVIEW_TITLE_MAX) return `Keep the title under ${REVIEW_TITLE_MAX} characters.`;
  if ((draft.photos?.length ?? 0) > REVIEW_MAX_PHOTOS) return `Add up to ${REVIEW_MAX_PHOTOS} photos.`;
  return null;
}

/** "Based on 1 review" / "Based on 12 reviews". */
export function basedOnLabel(count: number): string {
  return `Based on ${count.toLocaleString('en-IN')} ${count === 1 ? 'review' : 'reviews'}`;
}

/** Bar width in whole percent. */
export function barPercent(n: number, count: number): number {
  if (!(count > 0) || !(n > 0)) return 0;
  return Math.min(100, Math.round((n / count) * 100));
}

/** Message the form shows once a review is accepted. */
export function reviewThanks(photoCount: number): string {
  return photoCount > 0
    ? 'Thanks! Your review will appear once the shop approves the photos.'
    : 'Thanks! Your review is live.';
}

/** A readable message for a failed review request: the API's `error` when it sent one. */
export function reviewRequestError(status: number, data: unknown): string {
  const msg = (data as { error?: unknown } | null)?.error;
  if (status === 401) return 'Sign in to post a review.';
  if (status === 411 || status === 413) return 'Photos must be 2 MB or smaller.';
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (status === 409) return 'You have already reviewed this product.';
  if (status === 429) return 'Too many photos. Try again in a while.';
  return 'Something went wrong. Please try again.';
}

/** Review list URL relative to the store API; `extra` carries the draft token. */
export function reviewsUrl(
  subdomain: string,
  itemId: string,
  sort: ReviewSort,
  page: number,
  extra?: URLSearchParams,
): string {
  const params = new URLSearchParams(extra);
  params.set('sort', sort);
  if (page > 1) params.set('page', String(page));
  return `/api/public/store/${encodeURIComponent(subdomain)}/items/${encodeURIComponent(itemId)}/reviews?${params}`;
}

/** Link to a product page's review section, the same shape product cards link with. */
export function reviewsHref(itemId: string): string {
  return `/products/${itemId}#reviews`;
}

/** Appends a page of reviews, dropping any already shown (a new review can shift pages). */
export function mergeReviews(current: StoreReview[], next: StoreReview[]): StoreReview[] {
  const seen = new Set(current.map((r) => r.id));
  return [...current, ...next.filter((r) => !seen.has(r.id))];
}

/** The author may edit for 30 days after posting (the server enforces the same window). */
export function canEditReview(review: Pick<StoreReview, 'created_at'> | null | undefined, now = Date.now()): boolean {
  if (!review) return false;
  const created = new Date(review.created_at).getTime();
  if (Number.isNaN(created)) return false;
  return now - created < REVIEW_EDIT_DAYS * 24 * 60 * 60 * 1000;
}

/** Note for the shopper about their own review when it is not public. */
export function myReviewNote(review: Pick<StoreReview, 'status'> | null | undefined): string | null {
  if (review?.status === 'pending') return 'Your review is waiting for approval.';
  if (review?.status === 'hidden') return 'Your review is not shown on the store.';
  return null;
}
