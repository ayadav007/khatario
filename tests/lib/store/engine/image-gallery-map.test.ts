import { galleryAlt, galleryClass, galleryImages } from '@/lib/store/engine/image-gallery-map';
import type { GalleryImage } from '@/lib/store/engine/image-gallery-map';
import type { Block, Section } from '@/lib/store/engine/types';

const blk = (type: string, settings: Record<string, unknown>, disabled = false): Block => ({ type, settings, ...(disabled ? { disabled: true } : {}) });
function sec(blocks: Block[]): Section {
  const entries = blocks.map((b, i) => [`b${i}`, b] as const);
  return { type: 'image-gallery', settings: {}, blocks: Object.fromEntries(entries), block_order: entries.map(([id]) => id) };
}
const read = (b: Block) => ({ ...b.settings });

describe('galleryImages', () => {
  it('drops imageless, disabled and unknown blocks and keeps block order', () => {
    const images = galleryImages(
      sec([
        blk('image', { image: '/a.webp', caption: 'Kashi', subcaption: 'Banarasi' }),
        blk('image', { caption: 'No picture' }),
        blk('image', { image: '/off.webp' }, true),
        blk('other', { image: '/other.webp' }),
        blk('image', { image: '  /b.webp  ' }),
      ]),
      read,
    );
    expect(images).toEqual([
      { id: 'b0', image: '/a.webp', caption: 'Kashi', subcaption: 'Banarasi', href: null },
      { id: 'b4', image: '/b.webp', caption: '', subcaption: '', href: null },
    ]);
  });

  it('maps the link like a button: internal, external https and anchors; anything else is no link', () => {
    const hrefs = galleryImages(
      sec([
        blk('image', { image: '/1.webp', link: '/collections/sarees' }),
        blk('image', { image: '/2.webp', link: 'https://example.com/x' }),
        blk('image', { image: '/3.webp', link: '#story' }),
        blk('image', { image: '/4.webp', link: 'javascript:alert(1)' }),
        blk('image', { image: '/5.webp', link: 'http://example.com' }),
      ]),
      read,
    ).map((i) => i.href);
    expect(hrefs).toEqual(['/collections/sarees', 'https://example.com/x', '#story', null, null]);
  });

  it('skips a block whose settings cannot be read, and tolerates a section with no blocks', () => {
    expect(galleryImages(sec([blk('image', { image: '/a.webp' })]), () => null)).toEqual([]);
    expect(galleryImages({ type: 'image-gallery', settings: {} }, read)).toEqual([]);
  });
});

describe('galleryClass', () => {
  it('names the layout, shape and hover', () => {
    expect(galleryClass({ layout: 'strip', shape: 'natural', hover: 'none' })).toBe('eng-gallery eng-gallery--strip eng-gallery--natural eng-gallery--hover-none');
    expect(galleryClass({ layout: 'masonry', shape: 'portrait', hover: 'caption-link' })).toBe(
      'eng-gallery eng-gallery--masonry eng-gallery--portrait eng-gallery--hover-caption-link',
    );
  });

  it('falls back to grid, square and caption for missing or unknown values', () => {
    const fallback = 'eng-gallery eng-gallery--grid eng-gallery--square eng-gallery--hover-caption';
    expect(galleryClass({})).toBe(fallback);
    expect(galleryClass({ layout: 'carousel', shape: 'wide', hover: 'zoom' })).toBe(fallback);
    expect(galleryClass({ layout: 3, shape: null, hover: undefined })).toBe(fallback);
  });
});

describe('galleryAlt', () => {
  const img = (over: Partial<GalleryImage> = {}): GalleryImage => ({ id: 'b0', image: '/a.webp', caption: '', subcaption: '', href: null, ...over });

  it('leaves alt empty when a caption is shown, so the text is not announced twice', () => {
    expect(galleryAlt(img({ caption: 'Kashi', href: '/x' }), 'caption', 0)).toEqual({ alt: '', ariaLabel: undefined });
    expect(galleryAlt(img({ subcaption: 'Banarasi' }), 'caption-link', 3)).toEqual({ alt: '', ariaLabel: undefined });
    expect(galleryAlt(img({ caption: 'Kashi' }), undefined, 0).alt).toBe('');
  });

  it('puts the caption (else the subcaption) in alt when no caption is shown', () => {
    expect(galleryAlt(img({ caption: 'Kashi', subcaption: 'Banarasi' }), 'none', 0).alt).toBe('Kashi');
    expect(galleryAlt(img({ subcaption: 'Banarasi' }), 'none', 0).alt).toBe('Banarasi');
  });

  it('names a linked picture with no text by its position, and leaves an unlinked one decorative', () => {
    expect(galleryAlt(img({ href: '/x' }), 'caption', 2)).toEqual({ alt: '', ariaLabel: 'Gallery image 3' });
    expect(galleryAlt(img({ href: '/x' }), 'none', 0)).toEqual({ alt: '', ariaLabel: 'Gallery image 1' });
    expect(galleryAlt(img(), 'caption', 0)).toEqual({ alt: '', ariaLabel: undefined });
  });
});
