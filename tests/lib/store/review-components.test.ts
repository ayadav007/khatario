import {
  barPercent,
  canEditReview,
  myReviewNote,
  basedOnLabel,
  checkReviewPhoto,
  formatReviewDate,
  mergeReviews,
  reviewCta,
  reviewDraftError,
  reviewRequestError,
  reviewThanks,
  reviewsHref,
  reviewsUrl,
  type StoreReview,
} from '@/components/store/features/reviews/review-logic';

const review = (id: string): StoreReview => ({
  id,
  item_id: 'item',
  rating: 5,
  title: null,
  body: 'Lovely fabric, fits well',
  photos: [],
  status: 'published',
  merchant_reply: null,
  replied_at: null,
  created_at: '2026-10-05T10:00:00Z',
  customer_name: 'Priya S.',
});

describe('formatReviewDate', () => {
  it('formats an ISO date as an en-IN short date', () => {
    expect(formatReviewDate('2026-10-05T10:00:00Z')).toBe('5 Oct 2026');
  });
  it('is blank for missing or bad dates', () => {
    expect(formatReviewDate(null)).toBe('');
    expect(formatReviewDate('not a date')).toBe('');
  });
});

describe('reviewCta', () => {
  it('maps can_review to the summary action', () => {
    expect(reviewCta({ ok: true })).toEqual({ kind: 'write', label: 'Write a review' });
    expect(reviewCta({ ok: false, reason: 'sign_in' })).toEqual({ kind: 'sign_in', label: 'Sign in to review' });
    expect(reviewCta({ ok: false, reason: 'not_bought' })).toEqual({
      kind: 'not_bought',
      label: 'Only customers who received this product can review it',
    });
    expect(reviewCta({ ok: false, reason: 'already_reviewed' })).toEqual({ kind: 'reviewed', label: 'You reviewed this' });
  });
  it('offers nothing before the answer arrives or for an unknown reason', () => {
    expect(reviewCta(null)).toEqual({ kind: 'none' });
    expect(reviewCta({ ok: false })).toEqual({ kind: 'none' });
  });
});

describe('checkReviewPhoto', () => {
  it('accepts jpeg, png and webp up to 2 MB', () => {
    expect(checkReviewPhoto({ type: 'image/jpeg', size: 2 * 1024 * 1024 })).toBeNull();
    expect(checkReviewPhoto({ type: 'image/png', size: 10 })).toBeNull();
    expect(checkReviewPhoto({ type: 'image/webp', size: 10 })).toBeNull();
  });
  it('rejects other types and larger files', () => {
    expect(checkReviewPhoto({ type: 'image/gif', size: 10 })).toBe('Use a JPEG, PNG or WebP photo.');
    expect(checkReviewPhoto({ type: 'image/heic', size: 10 })).toBe('Use a JPEG, PNG or WebP photo.');
    expect(checkReviewPhoto({ type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 })).toBe('Photos must be 2 MB or smaller.');
  });
});

describe('reviewDraftError', () => {
  const ok = { rating: 4, title: 'Good', body: 'Nice and soft cotton', photos: [] };
  it('passes a valid draft', () => {
    expect(reviewDraftError(ok)).toBeNull();
  });
  it('needs a star rating', () => {
    expect(reviewDraftError({ ...ok, rating: 0 })).toBe('Choose a star rating.');
    expect(reviewDraftError({ ...ok, rating: 6 })).toBe('Choose a star rating.');
  });
  it('checks body length after trimming, title length and photo count', () => {
    expect(reviewDraftError({ ...ok, body: '   short   ' })).toBe('Write at least 10 characters.');
    expect(reviewDraftError({ ...ok, body: 'x'.repeat(2001) })).toBe('Keep your review under 2000 characters.');
    expect(reviewDraftError({ ...ok, title: 'x'.repeat(121) })).toBe('Keep the title under 120 characters.');
    expect(reviewDraftError({ ...ok, photos: ['a', 'b', 'c', 'd', 'e'] })).toBe('Add up to 4 photos.');
  });
});

describe('labels and numbers', () => {
  it('says how many reviews the average is based on', () => {
    expect(basedOnLabel(1)).toBe('Based on 1 review');
    expect(basedOnLabel(1250)).toBe('Based on 1,250 reviews');
  });
  it('sizes bars in whole percent', () => {
    expect(barPercent(1, 3)).toBe(33);
    expect(barPercent(3, 3)).toBe(100);
    expect(barPercent(0, 3)).toBe(0);
    expect(barPercent(2, 0)).toBe(0);
  });
  it('thanks differently when photos wait for approval', () => {
    expect(reviewThanks(2)).toBe('Thanks! Your review will appear once the shop approves the photos.');
    expect(reviewThanks(0)).toBe('Thanks! Your review is live.');
  });
});

describe('reviewRequestError', () => {
  it('prefers the API message', () => {
    expect(reviewRequestError(400, { error: 'Review must be at least 10 characters' })).toBe(
      'Review must be at least 10 characters',
    );
    expect(reviewRequestError(403, { error: 'Only buyers can review', reason: 'not_bought' })).toBe('Only buyers can review');
  });
  it('covers sign-in, size and fallbacks', () => {
    expect(reviewRequestError(401, { error: 'Sign in required' })).toBe('Sign in to post a review.');
    expect(reviewRequestError(413, null)).toBe('Photos must be 2 MB or smaller.');
    expect(reviewRequestError(409, null)).toBe('You have already reviewed this product.');
    expect(reviewRequestError(429, null)).toBe('Too many photos. Try again in a while.');
    expect(reviewRequestError(500, null)).toBe('Something went wrong. Please try again.');
  });
});

describe('urls', () => {
  it('builds the list url with sort, page and the draft token', () => {
    expect(reviewsUrl('my shop', 'abc', 'recent', 1)).toBe('/api/public/store/my%20shop/items/abc/reviews?sort=recent');
    expect(reviewsUrl('s', 'abc', 'with_photos', 3, new URLSearchParams({ td: 'tok' }))).toBe(
      '/api/public/store/s/items/abc/reviews?td=tok&sort=with_photos&page=3',
    );
  });
  it('links to the product page review section', () => {
    expect(reviewsHref('abc')).toBe('/products/abc#reviews');
  });
});

describe('mergeReviews', () => {
  it('appends a page without repeating reviews already shown', () => {
    const merged = mergeReviews([review('a'), review('b')], [review('b'), review('c')]);
    expect(merged.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('own review', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  it('can be edited for 30 days after posting', () => {
    expect(canEditReview({ created_at: '2026-10-01T13:00:00Z' }, now)).toBe(true);
    expect(canEditReview({ created_at: '2026-09-30T11:00:00Z' }, now)).toBe(false);
    expect(canEditReview(null, now)).toBe(false);
    expect(canEditReview({ created_at: 'bad' }, now)).toBe(false);
  });
  it('explains a review that is not public yet', () => {
    expect(myReviewNote({ status: 'pending' })).toBe('Your review is waiting for approval.');
    expect(myReviewNote({ status: 'hidden' })).toBe('Your review is not shown on the store.');
    expect(myReviewNote({ status: 'published' })).toBeNull();
    expect(myReviewNote(null)).toBeNull();
  });
});
