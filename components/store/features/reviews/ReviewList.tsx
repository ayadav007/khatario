'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, Loader2, X } from 'lucide-react';
import { StoreStars } from '@/components/store/StoreStars';
import { useMounted, useOverlay } from '@/components/store/features/product/useOverlay';
import { REVIEW_SORTS, formatReviewDate, type ReviewSort, type StoreReview } from './review-logic';

const HAIR = '1px solid color-mix(in srgb, currentColor 14%, transparent)';

/** Review text clamped to six lines, with "Read more" only when it actually overflows. */
function ReviewBody({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el && !open) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);

  return (
    <div>
      <p ref={ref} className={open ? 'whitespace-pre-line' : 'line-clamp-6 whitespace-pre-line'}>
        {text}
      </p>
      {overflows || open ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-h-11 text-[13px] font-medium underline underline-offset-2"
          aria-expanded={open}
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      ) : null}
    </div>
  );
}

function ReviewItem({
  review,
  storeName,
  onOpenPhoto,
}: {
  review: StoreReview;
  storeName: string;
  onOpenPhoto: (url: string) => void;
}) {
  const date = formatReviewDate(review.created_at);
  return (
    <article className="py-5 text-[14px] leading-relaxed" style={{ borderTop: HAIR }}>
      <StoreStars value={review.rating} size="md" />
      <span className="sr-only">{review.rating} out of 5 stars</span>
      {review.title ? <h3 className="mt-2 text-[15px] font-semibold leading-snug">{review.title}</h3> : null}
      <div className="mt-1.5">
        <ReviewBody text={review.body} />
      </div>
      {review.photos.length ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {review.photos.map((url, i) => (
            <li key={url}>
              <button
                type="button"
                onClick={() => onOpenPhoto(url)}
                className="block h-16 w-16 overflow-hidden rounded-lg"
                style={{ border: HAIR }}
                aria-label={`Open photo ${i + 1} from ${review.customer_name}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <span className="font-medium">
          {review.customer_name}
          {review.is_mine ? <span style={{ opacity: 0.6 }}> (you)</span> : null}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: 'color-mix(in srgb, currentColor 8%, transparent)' }}
        >
          <BadgeCheck className="h-3.5 w-3.5" style={{ color: 'var(--primary, currentColor)' }} aria-hidden />
          Verified buyer
        </span>
        {date ? <span style={{ opacity: 0.55 }}>{date}</span> : null}
      </p>
      {review.merchant_reply ? (
        <div className="ml-4 mt-3 rounded-lg px-3 py-2.5 text-[13px]" style={{ borderLeft: '3px solid var(--primary, #9ca3af)', backgroundColor: 'color-mix(in srgb, currentColor 5%, transparent)' }}>
          <p className="text-[12px] font-semibold">Reply from {storeName}</p>
          <p className="mt-1 whitespace-pre-line">{review.merchant_reply}</p>
        </div>
      ) : null}
    </article>
  );
}

/** Sort control, the reviews and a "Show more reviews" button while there are more pages. */
export function ReviewList({
  reviews,
  sort,
  onSort,
  hasMore,
  onLoadMore,
  onOpenPhoto,
  storeName = 'the shop',
  loading = false,
}: {
  reviews: StoreReview[];
  sort: ReviewSort;
  onSort: (sort: ReviewSort) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpenPhoto: (url: string) => void;
  storeName?: string;
  loading?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-end gap-2 pb-3">
        <label htmlFor="review-sort" className="text-[13px]" style={{ opacity: 0.65 }}>
          Sort by
        </label>
        <select
          id="review-sort"
          value={sort}
          onChange={(e) => onSort(e.target.value as ReviewSort)}
          className="min-h-11 rounded-lg bg-transparent px-3 text-[13px]"
          style={{ border: HAIR, color: 'inherit' }}
        >
          {REVIEW_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {reviews.length === 0 && !loading ? (
        <p className="py-6 text-center text-[13px]" style={{ borderTop: HAIR, opacity: 0.6 }}>
          {sort === 'with_photos' ? 'No reviews with photos yet.' : 'No reviews to show yet.'}
        </p>
      ) : (
        <div aria-busy={loading}>
          {reviews.map((r) => (
            <ReviewItem key={r.id} review={r} storeName={storeName} onOpenPhoto={onOpenPhoto} />
          ))}
        </div>
      )}
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin" style={{ opacity: 0.5 }} aria-label="Loading reviews" />
        </div>
      ) : hasMore ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onLoadMore}
            className="min-h-11 rounded-xl px-5 text-[14px] font-medium"
            style={{ border: HAIR }}
          >
            Show more reviews
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Full-screen view of one review photo. */
export function ReviewPhotoLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  const mounted = useMounted();
  const closeRef = useRef<HTMLButtonElement>(null);
  useOverlay(!!url, onClose, closeRef);
  if (!mounted || !url) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Review photo"
      onClick={onClose}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"
        aria-label="Close photo"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Review photo"
        className="max-h-full max-w-full rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
