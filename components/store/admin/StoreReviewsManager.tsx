'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Loader2, MessageCircle, Phone, Star, X } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { pendingBadgeText, reviewExcerpt, reviewWhatsappLink } from '@/lib/store/review-admin-helpers';

type ReviewStatus = 'pending' | 'published' | 'hidden';
type Action = 'hide' | 'publish' | 'reply' | 'delete_reply';

interface AdminReview {
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
  item_name: string;
  phone: string;
}

type TabKey = ReviewStatus | 'all';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'published', label: 'Published' },
  { key: 'hidden', label: 'Hidden' },
  { key: 'all', label: 'All' },
];

const EMPTY: Record<TabKey, string> = {
  pending: 'No reviews waiting for approval',
  published: 'No published reviews yet',
  hidden: 'No hidden reviews',
  all: 'No reviews yet',
};

const STATUS_STYLE: Record<ReviewStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  published: 'bg-green-100 text-green-800',
  hidden: 'bg-gray-100 text-gray-600',
};

const REPLY_MAX = 1000;

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={clsx('h-4 w-4', n <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300')}
        />
      ))}
    </span>
  );
}

export function StoreReviewsManager() {
  const { business } = useAuth();
  const businessId = business?.id;
  const [tab, setTab] = useState<TabKey>('pending');
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [replyDraft, setReplyDraft] = useState<{ id: string; text: string } | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (status: TabKey, p: number) => {
      const params = new URLSearchParams({ business_id: businessId ?? '', page: String(p) });
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`/api/settings/online-store/reviews?${params}`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not load reviews');
      return data as { reviews: AdminReview[]; hasMore: boolean };
    },
    [businessId],
  );

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setPage(1);
    setReplyDraft(null);
    fetchPage(tab, 1)
      .then((data) => {
        if (cancelled) return;
        setReviews(data.reviews);
        setHasMore(data.hasMore);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load reviews');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, tab, fetchPage]);

  // Pending count for the tab badge (first page only, so 20+ shows as 9+).
  const refreshPending = useCallback(async () => {
    if (!businessId) return;
    try {
      const params = new URLSearchParams({ business_id: businessId, status: 'pending' });
      const res = await fetch(`/api/settings/online-store/reviews?${params}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setPendingCount(Array.isArray(data.reviews) ? data.reviews.length : null);
    } catch {
      /* badge only */
    }
  }, [businessId]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await fetchPage(tab, page + 1);
      setReviews((list) => {
        const seen = new Set(list.map((r) => r.id));
        return [...list, ...data.reviews.filter((r) => !seen.has(r.id))];
      });
      setHasMore(data.hasMore);
      setPage((p) => p + 1);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load reviews');
    } finally {
      setLoadingMore(false);
    }
  };

  const act = async (review: AdminReview, action: Action, reply?: string) => {
    if (!businessId) return;
    setBusyId(review.id);
    setRowErrors((e) => ({ ...e, [review.id]: '' }));
    try {
      const res = await fetch(`/api/settings/online-store/reviews/${review.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, action, reply }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not update review');
      const merged: AdminReview = { ...review, ...(data.review as AdminReview), item_name: review.item_name, phone: review.phone };
      setReviews((list) =>
        list.map((r) => (r.id === review.id ? merged : r)).filter((r) => tab === 'all' || r.status === tab),
      );
      if (action === 'reply') setReplyDraft(null);
      if (action === 'hide' || action === 'publish') void refreshPending();
    } catch (e) {
      setRowErrors((errs) => ({ ...errs, [review.id]: e instanceof Error ? e.message : 'Could not update review' }));
    } finally {
      setBusyId(null);
    }
  };

  const toggleExpanded = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pendingLabel = pendingBadgeText(pendingCount);

  return (
    <div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={clsx(
              'flex flex-shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              tab === t.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {t.label}
            {t.key === 'pending' && pendingLabel ? (
              <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{pendingLabel}</span>
            ) : null}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : loadError && reviews.length === 0 ? (
        <p className="py-12 text-center text-sm text-red-600">{loadError}</p>
      ) : reviews.length === 0 ? (
        <div className="py-12 text-center">
          <Star className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">{EMPTY[tab]}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => {
            const isOpen = expanded.has(r.id);
            const ex = reviewExcerpt(r.body);
            const wa = reviewWhatsappLink(r.phone);
            const busy = busyId === r.id;
            const drafting = replyDraft?.id === r.id ? replyDraft : null;
            return (
              <Card key={r.id} className={clsx('p-4', r.status === 'pending' && 'border-amber-200')}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{r.item_name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                      <span>{r.customer_name}</span>
                      {r.phone ? (
                        <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                          <Phone className="h-3 w-3" />
                          {r.phone}
                        </a>
                      ) : null}
                      {wa ? (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-green-700 hover:underline"
                        >
                          <MessageCircle className="h-3 w-3" />
                          WhatsApp
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_STYLE[r.status])}>
                      {r.status}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Clock className="h-3 w-3" />
                      {formatDate(r.created_at)}
                    </span>
                  </div>
                </div>

                <div className="mt-2">
                  <Stars rating={r.rating} />
                  {r.title ? <p className="mt-1 text-sm font-medium text-gray-900">{r.title}</p> : null}
                  <p className="mt-1 whitespace-pre-line break-words text-sm text-gray-700">{isOpen ? r.body : ex.text}</p>
                  {ex.truncated ? (
                    <button type="button" className="mt-1 text-xs text-blue-600 hover:underline" onClick={() => toggleExpanded(r.id)}>
                      {isOpen ? 'Show less' : 'Read more'}
                    </button>
                  ) : null}
                </div>

                {r.photos.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.photos.map((src) => (
                      <button key={src} type="button" onClick={() => setZoom(src)} className="overflow-hidden rounded-lg border border-gray-200">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="Review photo" className="h-16 w-16 object-cover" loading="lazy" />
                      </button>
                    ))}
                  </div>
                ) : null}

                {r.merchant_reply && !drafting ? (
                  <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                    <p className="mb-0.5 text-xs font-medium text-gray-500">Your reply</p>
                    <p className="whitespace-pre-line break-words">{r.merchant_reply}</p>
                  </div>
                ) : null}

                {drafting ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={drafting.text}
                      onChange={(e) => setReplyDraft({ id: r.id, text: e.target.value.slice(0, REPLY_MAX) })}
                      maxLength={REPLY_MAX}
                      rows={3}
                      placeholder="Write a reply shoppers will see under this review"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400">
                        {drafting.text.length}/{REPLY_MAX}
                      </span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => setReplyDraft(null)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          type="button"
                          disabled={busy || !drafting.text.trim()}
                          onClick={() => void act(r, 'reply', drafting.text.trim())}
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save reply'}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.status !== 'published' ? (
                      <Button size="sm" type="button" disabled={busy} onClick={() => void act(r, 'publish')}>
                        Publish
                      </Button>
                    ) : null}
                    {r.status !== 'hidden' ? (
                      <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={() => void act(r, 'hide')}>
                        Hide
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => setReplyDraft({ id: r.id, text: r.merchant_reply ?? '' })}
                    >
                      {r.merchant_reply ? 'Edit reply' : 'Reply'}
                    </Button>
                    {r.merchant_reply ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm('Delete your reply to this review?')) void act(r, 'delete_reply');
                        }}
                      >
                        Delete reply
                      </Button>
                    ) : null}
                    {busy ? <Loader2 className="h-4 w-4 animate-spin self-center text-gray-400" /> : null}
                  </div>
                )}

                {rowErrors[r.id] ? <p className="mt-2 text-xs text-red-600">{rowErrors[r.id]}</p> : null}
              </Card>
            );
          })}

          {loadError ? <p className="text-center text-xs text-red-600">{loadError}</p> : null}
          {hasMore ? (
            <div className="flex justify-center pt-2">
              <Button variant="ghost" size="sm" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load more'}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {zoom ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-label="Review photo"
          onClick={() => setZoom(null)}
        >
          <button
            type="button"
            aria-label="Close photo"
            className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-gray-900"
            onClick={() => setZoom(null)}
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Review photo" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      ) : null}
    </div>
  );
}
