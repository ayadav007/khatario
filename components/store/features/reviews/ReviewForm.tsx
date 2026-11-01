'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ImagePlus, Loader2, Star, X } from 'lucide-react';
import { useOverlay } from '@/components/store/features/product/useOverlay';
import { reviewButtonStyle } from './ReviewSummary';
import {
  REVIEW_BODY_MAX,
  REVIEW_BODY_MIN,
  REVIEW_MAX_PHOTOS,
  REVIEW_PHOTO_TYPES,
  REVIEW_TITLE_MAX,
  checkReviewPhoto,
  reviewDraftError,
  reviewThanks,
  type ReviewDraft,
} from './review-logic';

const HAIR = '1px solid color-mix(in srgb, currentColor 18%, transparent)';
const RATING_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

type PhotoSlot = {
  key: string;
  preview: string;
  url?: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
};

let slotSeq = 0;

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, n: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = Math.min(5, Math.max(1, n + step));
    onChange(next);
    refs.current[next - 1]?.focus();
  };
  return (
    <div>
      <div role="radiogroup" aria-label="Your rating" className="flex">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            ref={(el) => {
              refs.current[n - 1] = el;
            }}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
            tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
            onClick={() => onChange(n)}
            onKeyDown={(e) => onKey(e, n)}
            className="flex h-11 w-11 items-center justify-center rounded-lg"
          >
            <Star
              className={value >= n ? 'h-7 w-7 fill-amber-400 text-amber-400' : 'h-7 w-7 text-gray-300'}
              strokeWidth={1.6}
            />
          </button>
        ))}
      </div>
      <p className="mt-0.5 text-[12px]" style={{ opacity: 0.6 }} aria-live="polite">
        {value ? RATING_WORDS[value - 1] : 'Tap a star to rate'}
      </p>
    </div>
  );
}

/**
 * Write (or edit) a review: stars, optional title, text, and up to four photos uploaded as they are
 * picked. `onSubmit` throws an Error whose message is shown; on success the thanks note replaces the form.
 */
export function ReviewForm({
  initial,
  onSubmit,
  onUploadPhoto,
  onCancel,
}: {
  initial?: ReviewDraft;
  onSubmit: (input: ReviewDraft) => Promise<unknown>;
  onUploadPhoto: (file: File) => Promise<string>;
  onCancel: () => void;
}) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [photos, setPhotos] = useState<PhotoSlot[]>(() =>
    (initial?.photos ?? []).map((url) => ({ key: `p${++slotSeq}`, preview: url, url, status: 'done' as const })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const uploading = photos.some((p) => p.status === 'uploading');
  const bodyLength = body.trim().length;

  const patchSlot = (key: string, patch: Partial<PhotoSlot>) =>
    setPhotos((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const room = REVIEW_MAX_PHOTOS - photos.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) setError(`You can add up to ${REVIEW_MAX_PHOTOS} photos.`);
    const slots: PhotoSlot[] = picked.map((file) => {
      const preview = URL.createObjectURL(file);
      objectUrls.current.push(preview);
      const problem = checkReviewPhoto(file);
      return problem
        ? { key: `p${++slotSeq}`, preview, status: 'error', error: problem }
        : { key: `p${++slotSeq}`, preview, status: 'uploading' };
    });
    setPhotos((list) => [...list, ...slots]);
    slots.forEach((slot, i) => {
      if (slot.status !== 'uploading') return;
      onUploadPhoto(picked[i])
        .then((url) => patchSlot(slot.key, { url, status: 'done' }))
        .catch((e: unknown) =>
          patchSlot(slot.key, { status: 'error', error: e instanceof Error ? e.message : 'Upload failed.' }),
        );
    });
  };

  const removePhoto = (key: string) => setPhotos((list) => list.filter((p) => p.key !== key));

  const submit = async () => {
    const urls = photos.filter((p) => p.status === 'done' && p.url).map((p) => p.url as string);
    const draft: ReviewDraft = { rating, title: title.trim() || null, body: body.trim(), photos: urls };
    const problem = reviewDraftError(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(draft);
      setThanks(reviewThanks(urls.length));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (thanks) {
    return (
      <div className="space-y-4 py-2" role="status">
        <p className="text-[15px] font-semibold">{thanks}</p>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-xl px-5 text-[14px] font-semibold"
          style={reviewButtonStyle}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <StarPicker value={rating} onChange={setRating} />

      <div>
        <label htmlFor="review-title" className="block text-[13px] font-medium">
          Title <span style={{ opacity: 0.55 }}>(optional)</span>
        </label>
        <input
          id="review-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={REVIEW_TITLE_MAX}
          placeholder="Sum it up in a line"
          className="mt-1.5 min-h-11 w-full rounded-xl bg-transparent px-3 text-[14px]"
          style={{ border: HAIR, color: 'inherit' }}
        />
      </div>

      <div>
        <label htmlFor="review-body" className="block text-[13px] font-medium">
          Your review
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={REVIEW_BODY_MAX}
          rows={5}
          placeholder="What did you like or dislike? How was the quality?"
          className="mt-1.5 w-full rounded-xl bg-transparent px-3 py-2.5 text-[14px]"
          style={{ border: HAIR, color: 'inherit' }}
          aria-describedby="review-body-count"
        />
        <p id="review-body-count" className="mt-1 flex justify-between text-[12px]" style={{ opacity: 0.6 }}>
          <span>{bodyLength < REVIEW_BODY_MIN ? `At least ${REVIEW_BODY_MIN} characters` : ''}</span>
          <span className="tabular-nums">
            {body.length}/{REVIEW_BODY_MAX}
          </span>
        </p>
      </div>

      <div>
        <p className="text-[13px] font-medium">
          Photos <span style={{ opacity: 0.55 }}>(optional, up to {REVIEW_MAX_PHOTOS}, 2 MB each)</span>
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {photos.map((p) => (
            <li key={p.key} className="w-20">
              <div className="relative h-20 w-20 overflow-hidden rounded-lg" style={{ border: HAIR }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt="" className="h-full w-full object-cover" />
                {p.status === 'uploading' ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                    <Loader2 className="h-5 w-5 animate-spin" aria-label="Uploading photo" />
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => removePhoto(p.key)}
                  className="absolute -right-0 -top-0 flex h-11 w-11 items-start justify-end p-1"
                  aria-label="Remove photo"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white">
                    <X className="h-3.5 w-3.5" />
                  </span>
                </button>
              </div>
              {p.status === 'error' ? (
                <p className="mt-1 text-[11px] leading-tight text-red-600" role="alert">
                  {p.error}
                </p>
              ) : null}
            </li>
          ))}
          {photos.length < REVIEW_MAX_PHOTOS ? (
            <li>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg text-[11px]"
                style={{ border: '1px dashed color-mix(in srgb, currentColor 30%, transparent)' }}
              >
                <ImagePlus className="h-5 w-5" style={{ opacity: 0.6 }} aria-hidden />
                Add photo
              </button>
            </li>
          ) : null}
        </ul>
        <input
          ref={fileRef}
          type="file"
          accept={REVIEW_PHOTO_TYPES.join(',')}
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {photos.length ? (
          <p className="mt-2 text-[12px]" style={{ opacity: 0.6 }}>
            Reviews with photos appear once the shop approves them.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="text-[13px] text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy || uploading}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-[14px] font-semibold disabled:opacity-50"
          style={reviewButtonStyle}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {uploading ? 'Uploading photos…' : initial ? 'Save review' : 'Post review'}
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-xl px-4 text-[14px]" style={{ border: HAIR }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** True below the md breakpoint; false on the server and first render. */
function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return phone;
}

/**
 * Where the form opens: inline on wider screens, a bottom sheet on phones. The sheet is not
 * portalled, so it keeps the page's --primary / --paper.
 */
export function ReviewFormPanel({
  open,
  heading = 'Write a review',
  onClose,
  children,
}: {
  open: boolean;
  heading?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const phone = usePhoneLayout();
  const sheetRef = useRef<HTMLDivElement>(null);
  useOverlay(open && phone, onClose, sheetRef);
  if (!open) return null;

  if (!phone) {
    return (
      <div className="rounded-2xl p-5" style={{ border: HAIR }}>
        <h3 className="mb-4 text-[16px] font-semibold">{heading}</h3>
        {children}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 outline-none"
        style={{ backgroundColor: 'var(--paper, #fff)' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold">{heading}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
