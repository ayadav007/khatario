'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { withStoreDraft } from '@/lib/store/store-context';
import {
  mergeReviews,
  reviewRequestError,
  reviewsUrl,
  type CanReview,
  type ReviewDraft,
  type ReviewSort,
  type ReviewSummaryData,
  type StoreReview,
} from './review-logic';

type State = {
  summary: ReviewSummaryData | null;
  reviews: StoreReview[];
  hasMore: boolean;
  canReview: CanReview | null;
  /** The signed-in shopper's own review of this item, in any status. */
  myReview: StoreReview | null;
  page: number;
  loading: boolean;
  error: string | null;
};

const EMPTY: State = {
  summary: null,
  reviews: [],
  hasMore: false,
  canReview: null,
  myReview: null,
  page: 1,
  loading: true,
  error: null,
};

type ListResponse = {
  summary?: ReviewSummaryData;
  reviews?: StoreReview[];
  hasMore?: boolean;
  can_review?: CanReview;
  my_review?: StoreReview | null;
};

function draftQs(): string {
  const qs = withStoreDraft(new URLSearchParams()).toString();
  return qs ? `?${qs}` : '';
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/**
 * Reviews of one product: summary, a sorted and paged list, whether this shopper may review,
 * and the write / edit / photo-upload calls. A new item or sort drops answers still in flight.
 */
export function useProductReviews(subdomain: string | null | undefined, itemId: string | null | undefined) {
  const [sort, setSortState] = useState<ReviewSort>('recent');
  const [state, setState] = useState<State>(EMPTY);
  const [nonce, setNonce] = useState(0);
  // Bumped on every fresh load; a page that comes back under an older id is ignored.
  const loadId = useRef(0);

  const base = subdomain ? `/api/public/store/${encodeURIComponent(subdomain)}` : null;

  // A different product starts from an empty list rather than showing the last one's reviews.
  useEffect(() => {
    setState(EMPTY);
    setSortState('recent');
  }, [itemId]);

  useEffect(() => {
    if (!subdomain || !itemId) return;
    const id = ++loadId.current;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    void (async () => {
      try {
        const res = await fetch(reviewsUrl(subdomain, itemId, sort, 1, withStoreDraft(new URLSearchParams())), {
          credentials: 'include',
          signal: ctrl.signal,
        });
        const data = (await readJson(res)) as ListResponse | null;
        if (id !== loadId.current) return;
        if (!res.ok) {
          setState({ ...EMPTY, loading: false, error: reviewRequestError(res.status, data) });
          return;
        }
        setState({
          summary: data?.summary ?? null,
          reviews: data?.reviews ?? [],
          hasMore: !!data?.hasMore,
          canReview: data?.can_review ?? null,
          myReview: data?.my_review ?? null,
          page: 1,
          loading: false,
          error: null,
        });
      } catch {
        if (ctrl.signal.aborted || id !== loadId.current) return;
        setState((s) => ({ ...s, loading: false, error: 'Could not load reviews.' }));
      }
    })();
    return () => ctrl.abort();
  }, [subdomain, itemId, sort, nonce]);

  const setSort = useCallback((next: ReviewSort) => setSortState(next), []);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const loadMore = useCallback(async () => {
    if (!subdomain || !itemId || state.loading || !state.hasMore) return;
    const id = loadId.current;
    const page = state.page + 1;
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(reviewsUrl(subdomain, itemId, sort, page, withStoreDraft(new URLSearchParams())), {
        credentials: 'include',
      });
      const data = (await readJson(res)) as ListResponse | null;
      if (id !== loadId.current) return;
      if (!res.ok) {
        setState((s) => ({ ...s, loading: false, error: reviewRequestError(res.status, data) }));
        return;
      }
      setState((s) => ({
        ...s,
        reviews: mergeReviews(s.reviews, data?.reviews ?? []),
        hasMore: !!data?.hasMore,
        page,
        loading: false,
      }));
    } catch {
      if (id === loadId.current) setState((s) => ({ ...s, loading: false, error: 'Could not load more reviews.' }));
    }
  }, [subdomain, itemId, sort, state.loading, state.hasMore, state.page]);

  /** Posts a new review; throws an Error with a shopper-facing message on failure. */
  const submit = useCallback(
    async (input: ReviewDraft): Promise<StoreReview> => {
      if (!base || !itemId) throw new Error('Something went wrong. Please try again.');
      const res = await fetch(`${base}/reviews${draftQs()}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, ...input }),
      });
      const data = (await readJson(res)) as { review?: StoreReview } | null;
      if (!res.ok || !data?.review) throw new Error(reviewRequestError(res.status, data));
      reload();
      return data.review;
    },
    [base, itemId, reload],
  );

  /** Edits the shopper's own review (allowed for 30 days after posting). */
  const update = useCallback(
    async (reviewId: string, input: ReviewDraft): Promise<StoreReview> => {
      if (!base) throw new Error('Something went wrong. Please try again.');
      const res = await fetch(`${base}/reviews/${encodeURIComponent(reviewId)}${draftQs()}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await readJson(res)) as { review?: StoreReview } | null;
      if (!res.ok || !data?.review) throw new Error(reviewRequestError(res.status, data));
      reload();
      return data.review;
    },
    [base, reload],
  );

  /** Uploads one photo for this product's review and returns its URL. */
  const uploadPhoto = useCallback(
    async (file: File): Promise<string> => {
      if (!base || !itemId) throw new Error('Something went wrong. Please try again.');
      const form = new FormData();
      form.append('file', file);
      form.append('item_id', itemId);
      const res = await fetch(`${base}/reviews/photos${draftQs()}`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = (await readJson(res)) as { url?: unknown } | null;
      if (!res.ok || typeof data?.url !== 'string') throw new Error(reviewRequestError(res.status, data));
      return data.url;
    },
    [base, itemId],
  );

  return {
    summary: state.summary,
    reviews: state.reviews,
    hasMore: state.hasMore,
    canReview: state.canReview,
    myReview: state.myReview,
    sort,
    setSort,
    loadMore,
    loading: state.loading,
    error: state.error,
    submit,
    update,
    uploadPhoto,
    reload,
  };
}
