'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useStore, withStoreDraft } from '@/lib/store/store-context';
import { StorePhoneAuth } from '@/components/store/StorePhoneAuth';
import { ReviewSummary } from './ReviewSummary';
import { ReviewList, ReviewPhotoLightbox } from './ReviewList';
import { ReviewForm, ReviewFormPanel } from './ReviewForm';
import { useProductReviews } from './useProductReviews';
import type { ReviewDraft } from './review-logic';

type FormMode = { kind: 'new' } | { kind: 'edit'; id: string; initial: ReviewDraft };

/**
 * The product page's review section (`id="reviews"`): summary, write / edit / sign-in action, the
 * form (inline, or a sheet on phones), the list and a photo lightbox. After a review goes live the
 * product is re-read and `onRated` gets its new average and count, so the page's stars update.
 */
export function ProductReviewsSection({
  itemId,
  onRated,
}: {
  itemId: string;
  onRated?: (avg: number, count: number) => void;
}) {
  const { store, refreshCustomer } = useStore();
  const subdomain = store?.store_subdomain;
  const reviews = useProductReviews(subdomain, itemId);
  const [form, setForm] = useState<FormMode | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const closeForm = useCallback(() => setForm(null), []);
  const closePhoto = useCallback(() => setPhoto(null), []);

  // Arriving from a quick view's "See all reviews" link: the section only exists once the product loads.
  useEffect(() => {
    if (window.location.hash === '#reviews') document.getElementById('reviews')?.scrollIntoView();
  }, []);

  const refreshRating = useCallback(async () => {
    if (!subdomain || !onRated) return;
    try {
      const res = await fetch(
        `/api/public/store/${encodeURIComponent(subdomain)}/items/${encodeURIComponent(itemId)}?${withStoreDraft(new URLSearchParams())}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { rating_avg?: unknown; rating_count?: unknown };
      onRated(Number(data.rating_avg) || 0, Number(data.rating_count) || 0);
    } catch {
      /* the stars catch up on the next visit */
    }
  }, [subdomain, itemId, onRated]);

  const mine = reviews.myReview;
  const summary = reviews.summary;
  return (
    <section id="reviews" className="scroll-mt-24 space-y-6" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading" className="text-[1.15rem] font-semibold">
        Customer reviews
      </h2>
      {!summary ? (
        reviews.loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" style={{ opacity: 0.5 }} aria-label="Loading reviews" />
          </div>
        ) : (
          <p className="text-[13px]" style={{ opacity: 0.6 }}>
            {reviews.error ?? 'Reviews are not available right now.'}
          </p>
        )
      ) : (
        <>
          <ReviewSummary
            summary={summary}
            canReview={reviews.canReview}
            myReview={mine}
            onWrite={() => setForm({ kind: 'new' })}
            onSignIn={() => setSigningIn(true)}
            onEdit={
              mine
                ? () =>
                    setForm({
                      kind: 'edit',
                      id: mine.id,
                      initial: { rating: mine.rating, title: mine.title, body: mine.body, photos: mine.photos },
                    })
                : undefined
            }
          />
          <ReviewFormPanel
            open={!!form}
            heading={form?.kind === 'edit' ? 'Edit your review' : 'Write a review'}
            onClose={closeForm}
          >
            {form ? (
              <ReviewForm
                key={form.kind === 'edit' ? form.id : 'new'}
                initial={form.kind === 'edit' ? form.initial : undefined}
                onSubmit={async (input) => {
                  const review =
                    form.kind === 'edit' ? await reviews.update(form.id, input) : await reviews.submit(input);
                  // Editing can also take a live review back to pending, so re-read either way.
                  if (review.status === 'published' || form.kind === 'edit') void refreshRating();
                  return review;
                }}
                onUploadPhoto={reviews.uploadPhoto}
                onCancel={closeForm}
              />
            ) : null}
          </ReviewFormPanel>
          {summary.count > 0 ? (
            <ReviewList
              reviews={reviews.reviews}
              sort={reviews.sort}
              onSort={reviews.setSort}
              hasMore={reviews.hasMore}
              onLoadMore={() => void reviews.loadMore()}
              onOpenPhoto={setPhoto}
              storeName={store?.name}
              loading={reviews.loading}
            />
          ) : null}
        </>
      )}
      <ReviewPhotoLightbox url={photo} onClose={closePhoto} />
      {store && signingIn ? (
        <StorePhoneAuth
          store={store}
          open
          onClose={() => setSigningIn(false)}
          onVerified={async () => {
            setSigningIn(false);
            await refreshCustomer();
            reviews.reload();
          }}
        />
      ) : null}
    </section>
  );
}
