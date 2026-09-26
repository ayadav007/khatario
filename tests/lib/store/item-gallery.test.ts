import { extraGalleryUrls, sanitizeGalleryUrls } from '@/lib/store/item-gallery';

describe('sanitizeGalleryUrls', () => {
  it('keeps cover first and drops duplicates and junk', () => {
    expect(
      sanitizeGalleryUrls(
        ['https://cdn.example/b.jpg', 'javascript:alert(1)', 'https://cdn.example/a.jpg'],
        'https://cdn.example/a.jpg',
      ),
    ).toEqual(['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg']);
  });
});

describe('extraGalleryUrls', () => {
  it('omits the cover image', () => {
    expect(extraGalleryUrls(['https://a', 'https://b'], 'https://a')).toEqual(['https://b']);
  });
});
