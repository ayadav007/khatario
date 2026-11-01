'use client';

import Link from 'next/link';
import { Star } from 'lucide-react';
import { StoreStars } from '@/components/store/StoreStars';
import {
  barPercent,
  basedOnLabel,
  canEditReview,
  myReviewNote,
  reviewCta,
  reviewsHref,
  type CanReview,
  type ReviewSummaryData,
  type StoreReview,
} from './review-logic';

const HAIR = 'color-mix(in srgb, currentColor 14%, transparent)';

/** Primary-coloured action; themes set --primary / --on-primary, plain pages fall back to dark. */
export const reviewButtonStyle = {
  backgroundColor: 'var(--primary, #111827)',
  color: 'var(--on-primary, #fff)',
} as const;

type CtaProps = {
  canReview: CanReview | null;
  myReview?: StoreReview | null;
  onWrite: () => void;
  onSignIn: () => void;
  onEdit?: () => void;
};

function Cta({ canReview, myReview, onWrite, onSignIn, onEdit }: CtaProps) {
  const cta = reviewCta(canReview);
  const note = myReviewNote(myReview);
  if (cta.kind === 'reviewed') {
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px]" style={{ opacity: 0.6 }}>
            {cta.label}
          </p>
          {onEdit && canEditReview(myReview) ? (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex min-h-11 items-center rounded-xl px-4 text-[14px] font-medium"
              style={{ border: '1px solid color-mix(in srgb, currentColor 18%, transparent)' }}
            >
              Edit
            </button>
          ) : null}
        </div>
        {note ? (
          <p className="text-[12px]" style={{ opacity: 0.6 }}>
            {note}
          </p>
        ) : null}
      </div>
    );
  }
  if (cta.kind === 'none') return null;
  if (cta.kind === 'write' || cta.kind === 'sign_in') {
    return (
      <button
        type="button"
        onClick={cta.kind === 'write' ? onWrite : onSignIn}
        className="inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-[14px] font-semibold"
        style={reviewButtonStyle}
      >
        {cta.label}
      </button>
    );
  }
  return (
    <p className="max-w-[16rem] text-[13px]" style={{ opacity: 0.6 }}>
      {cta.label}
    </p>
  );
}

/**
 * Average, stars, a 5-to-1 star breakdown and the write-a-review action (or why the shopper
 * cannot review). Colours come from the surrounding text colour, so it sits on any theme.
 */
export function ReviewSummary({
  summary,
  canReview,
  myReview,
  onWrite,
  onSignIn,
  onEdit,
}: {
  summary: ReviewSummaryData;
  canReview: CanReview | null;
  /** The shopper's own review (any status), for "Edit" and the waiting-for-approval note. */
  myReview?: StoreReview | null;
  onWrite: () => void;
  onSignIn: () => void;
  onEdit?: () => void;
}) {
  const cta = <Cta canReview={canReview} myReview={myReview} onWrite={onWrite} onSignIn={onSignIn} onEdit={onEdit} />;
  if (summary.count === 0) {
    return (
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[15px] font-semibold">No reviews yet</p>
          <p className="mt-0.5 text-[13px]" style={{ opacity: 0.6 }}>
            Bought this? Tell other shoppers what you think.
          </p>
        </div>
        {cta}
      </div>
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-8">
      <div className="flex items-center gap-3 sm:block">
        <p className="text-[2.5rem] font-semibold leading-none tabular-nums">{summary.avg.toFixed(1)}</p>
        <div className="sm:mt-2">
          <StoreStars value={summary.avg} size="md" />
          <p className="mt-1 text-[12px]" style={{ opacity: 0.6 }}>
            {basedOnLabel(summary.count)}
          </p>
        </div>
      </div>
      <ul className="space-y-1.5" aria-label="Rating breakdown">
        {[5, 4, 3, 2, 1].map((stars, i) => {
          const n = Number(summary.histogram[i]) || 0;
          const pct = barPercent(n, summary.count);
          return (
            <li key={stars} className="flex items-center gap-2 text-[12px]">
              <span className="flex w-7 shrink-0 items-center gap-0.5 tabular-nums" style={{ opacity: 0.7 }}>
                {stars}
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" strokeWidth={1.6} aria-hidden />
              </span>
              <span
                className="relative h-2 flex-1 overflow-hidden rounded-full"
                style={{ backgroundColor: HAIR }}
                role="img"
                aria-label={`${stars} stars: ${n} ${n === 1 ? 'review' : 'reviews'}`}
              >
                <span className="absolute inset-y-0 left-0 rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
              </span>
              <span className="w-8 shrink-0 text-right tabular-nums" style={{ opacity: 0.6 }}>
                {n.toLocaleString('en-IN')}
              </span>
            </li>
          );
        })}
      </ul>
      <div>
        {cta}
      </div>
    </div>
  );
}

/** One-line rating for the quick-view modal and sheet, linking to the product page's reviews. */
export function ReviewSummaryCompact({
  itemId,
  avg,
  count,
  stars = true,
}: {
  itemId: string;
  avg: number;
  count: number;
  /** False when the view already shows the stars next to it. */
  stars?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {stars && count > 0 ? <StoreStars value={avg} count={count} size="md" /> : null}
      <Link
        href={reviewsHref(itemId)}
        className="inline-flex min-h-11 items-center text-[13px] font-medium underline underline-offset-2"
      >
        {count > 0 ? 'See all reviews' : 'No reviews yet'}
      </Link>
    </div>
  );
}
