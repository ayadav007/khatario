import {
  announcementSettings,
  bannerSettings,
  marqueeSettings,
  multicolumnSettings,
  productSectionSettings,
  slideshowSettings,
  testimonialItems,
  toStudioBox,
} from '@/lib/store/engine/studio-adapter';
import type { Section } from '@/lib/store/engine/types';

type BlockSpec = [string, string, Record<string, unknown>, boolean?];

function sec(type: string, settings: Record<string, unknown>, blocks: BlockSpec[] = []): Section {
  return {
    type,
    settings,
    blocks: Object.fromEntries(blocks.map(([id, t, s, d]) => [id, { type: t, settings: s, ...(d ? { disabled: true } : {}) }])),
    block_order: blocks.map(([id]) => id),
  };
}

describe('studio adapter', () => {
  it('toStudioBox maps spacing and falls back to schema defaults', () => {
    expect(toStudioBox(sec('rich-text', { spacing_top: 8, spacing_bottom: 12 }))).toEqual({ spacingTop: 8, spacingBottom: 12 });
    expect(toStudioBox(sec('rich-text', {}))).toEqual({ spacingTop: 32, spacingBottom: 32 });
  });

  it('slideshow: first enabled slide is the main one, up to 5 more become slides, disabled skipped', () => {
    const blocks: BlockSpec[] = [
      ['off', 'slide', { heading: 'Hidden' }, true],
      ...Array.from({ length: 7 }, (_, i): BlockSpec => [`s${i}`, 'slide', { heading: `H${i}`, image: `/i${i}.png` }]),
    ];
    const out = slideshowSettings(sec('slideshow', { autoplay: true, speed: 4 }, blocks));
    expect(out.heading).toBe('H0');
    expect(out.image).toBe('/i0.png');
    expect(out.buttonText).toBe('Shop now');
    expect(out.slides).toHaveLength(5);
    expect(out.slides?.map((s) => s.heading)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5']);
    expect(out.autoplay).toBe(4);
    expect(slideshowSettings(sec('slideshow', { autoplay: false }, blocks)).autoplay).toBe(0);
  });

  it('slideshow: text colour and photo darkening', () => {
    const blocks: BlockSpec[] = [['a', 'slide', { heading: 'H' }]];
    const out = slideshowSettings(sec('slideshow', { text_color: '#1c1917', overlay: 40 }, blocks));
    expect(out.textColor).toBe('#1c1917');
    expect(out.overlay).toBe(40);
    const plain = slideshowSettings(sec('slideshow', {}, blocks));
    expect(plain.textColor).toBeUndefined();
    expect(plain.overlay).toBe(0);
  });

  it('slideshow: image fit and phone images', () => {
    const blocks: BlockSpec[] = [
      ['a', 'slide', { image: '/d1.webp', mobile_image: '/m1.webp' }],
      ['b', 'slide', { image: '/d2.webp' }],
    ];
    const out = slideshowSettings(sec('slideshow', { image_fit: 'natural' }, blocks));
    expect(out.imageFit).toBe('natural');
    expect(out.mobileImage).toBe('/m1.webp');
    expect(out.slides?.[0]).not.toHaveProperty('mobileImage');
    expect(slideshowSettings(sec('slideshow', { image_fit: 'stretch' }, blocks)).imageFit).toBe('cover');
  });

  it('respects block_order and skips ids missing from blocks', () => {
    const s = sec('marquee', {}, [
      ['a', 'item', { text: 'One' }],
      ['b', 'item', { text: 'Two' }],
      ['c', 'item', { text: 'Three' }, true],
    ]);
    s.block_order = ['b', 'ghost', 'a', 'c'];
    expect(marqueeSettings(s).text).toBe('Two, One');
  });

  it('marquee joins in order and maps speed', () => {
    const s = sec('marquee', { speed: 15 }, [
      ['a', 'item', { text: 'A' }],
      ['b', 'item', { text: 'B' }],
    ]);
    expect(marqueeSettings(s)).toMatchObject({ text: 'A, B', speed: 'fast' });
    expect(marqueeSettings(sec('marquee', {})).speed).toBe('normal');
    expect(marqueeSettings(sec('marquee', { speed: 60 })).speed).toBe('slow');
  });

  it('marquee strips commas inside items and skips empty ones', () => {
    const s = sec('marquee', {}, [
      ['a', 'item', { text: 'Free delivery, today' }],
      ['b', 'item', { text: ' , ' }],
      ['c', 'item', { text: 'New' }],
    ]);
    expect(marqueeSettings(s).text).toBe('Free delivery today, New');
  });

  it('multicolumn builds usps from enabled columns', () => {
    const out = multicolumnSettings(
      sec('multicolumn', {}, [
        ['a', 'column', { icon: 'truck', title: 'Fast', text: 'x' }],
        ['b', 'column', { icon: 'star', title: 'Off' }, true],
        ['c', 'column', { icon: 'nope', title: 'Odd' }],
      ]),
    );
    expect(out.usps).toEqual([
      { icon: 'truck', title: 'Fast', text: 'x' },
      { icon: 'badge', title: 'Odd', text: '' },
    ]);
  });

  it('testimonials skip disabled blocks', () => {
    expect(
      testimonialItems(
        sec('testimonials', {}, [
          ['a', 'quote', { text: 'T', name: 'N', rating: 4 }],
          ['b', 'quote', { text: 'X' }, true],
        ]),
      ),
    ).toEqual([{ text: 'T', name: 'N', photo: '', rating: 4, title: '', location: '', purchased: '' }]);
  });

  it('product sections map fields', () => {
    const out = productSectionSettings(
      sec('featured-products', { heading: 'Hi', eyebrow: 'E', source: 'new', limit: 6, columns: 3, card_style: 'shadow', show_rating: false, show_badges: false }),
    );
    expect(out).toMatchObject({ title: 'Hi', eyebrow: 'E', source: 'new', limit: 6, columns: 3, cardStyle: 'shadow', showRating: false, showBadges: false });
  });

  it('banner and announcement', () => {
    expect(bannerSettings(sec('image-banner', { heading: 'B', description: 'D', button_text: 'Go', text_position: 'center' }))).toMatchObject({
      title: 'B',
      text: 'D',
      button: 'Go',
      textAlign: 'center',
    });
    expect(announcementSettings(sec('announcement', { text: 'Hello', link: '/x' }))).toMatchObject({ text: 'Hello', link: '/x', textAlign: 'center' });
  });

  it('productSectionSettings maps show_tagline and show_swatches, default off', () => {
    expect(productSectionSettings(sec('featured-products', { show_tagline: true }))).toMatchObject({ showTagline: true, showSwatches: false });
    expect(productSectionSettings(sec('featured-products', {}))).toMatchObject({ showTagline: false, showSwatches: false });
  });

  it('testimonialItems and multicolumnSettings carry the new fields', () => {
    expect(
      testimonialItems(sec('testimonials', {}, [['a', 'quote', { text: 'Great', name: 'A', title: 'Loved it', location: 'Delhi', purchased: 'Saree', rating: 5 }]]))[0],
    ).toMatchObject({ title: 'Loved it', location: 'Delhi', purchased: 'Saree' });
    expect(multicolumnSettings(sec('multicolumn', {}, [['a', 'column', { title: 'T', image: '/i.webp' }]])).usps![0]).toMatchObject({ image: '/i.webp' });
    expect(multicolumnSettings(sec('multicolumn', {}, [['a', 'column', { title: 'T' }]])).usps![0]).not.toHaveProperty('image');
  });
});
