import { isReviewPhotoUrl } from '@/lib/store/review-media';

const B = '3f2b8c1e-9a4d-4e57-8b1a-0c6d2e7f9a10';
const OTHER = '11111111-2222-4333-8444-555555555555';
const HASH = 'a'.repeat(64);

describe('isReviewPhotoUrl', () => {
  test('accepts exactly this business and a sha256.webp name', () => {
    expect(isReviewPhotoUrl(`/media/store-reviews/${B}/${HASH}.webp`, B)).toBe(true);
  });
  test.each([
    ['other business', `/media/store-reviews/${OTHER}/${HASH}.webp`],
    ['wrong extension', `/media/store-reviews/${B}/${HASH}.png`],
    ['short hash', `/media/store-reviews/${B}/abc.webp`],
    ['encoded traversal', `/media/store-reviews/${B}/..%2F${HASH}.webp`],
    ['dot traversal', `/media/store-reviews/${B}/../${OTHER}/${HASH}.webp`],
    ['extra segment', `/media/store-reviews/${B}/x/${HASH}.webp`],
    ['query string', `/media/store-reviews/${B}/${HASH}.webp?x=1`],
    ['absolute url', `https://evil.example/media/store-reviews/${B}/${HASH}.webp`],
    ['data url', 'data:image/png;base64,iVBORw0KGgo='],
    ['empty', ''],
  ])('rejects %s', (_n, url) => {
    expect(isReviewPhotoUrl(url, B)).toBe(false);
  });
  test('rejects non-strings and a bad business id', () => {
    expect(isReviewPhotoUrl(null, B)).toBe(false);
    expect(isReviewPhotoUrl(`/media/store-reviews/x/${HASH}.webp`, 'x')).toBe(false);
  });
});
