import {
  announcementSettings,
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
    const blocks: BlockSpec[] = [['a', 'slide', { heading: 'H', text_color: '#1c1917', overlay: 40 }]];
    const out = slideshowSettings(sec('slideshow', {}, blocks));
    expect(out.textColor).toBe('#1c1917');
    expect(out.overlay).toBe(40);
    const plain = slideshowSettings(sec('slideshow', {}, [['a', 'slide', { heading: 'H' }]]));
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

  it('slideshow: every slide carries its own look, with defaults', () => {
    const out = slideshowSettings(sec('slideshow', {}, [['a', 'slide', { heading: 'A' }], ['b', 'slide', { heading: 'B' }]]));
    const defaults = {
      eyebrow: '',
      headingSize: 'large',
      buttonStyle: 'filled',
      button2Text: '',
      button2Link: '',
      button2Style: 'filled',
      position: 'middle-left',
      align: 'left',
      alignMobile: 'left',
      box: false,
      overlay: 0,
    };
    expect(out).toMatchObject(defaults);
    expect(out.slides?.[0]).toMatchObject(defaults);
    expect(out.slides?.[0]).not.toHaveProperty('textColor');
    expect(out.slides?.[0]).not.toHaveProperty('colorScheme');
    expect(out).not.toHaveProperty('colorScheme');
    expect(out.textBelowMobile).toBe(false);
  });

  it('slideshow: maps every new slide field, each slide its own (no slide-one shim)', () => {
    const one = {
      heading: 'One',
      eyebrow: 'NEW',
      heading_size: 'xl',
      description: 'Sub',
      button_text: 'Shop',
      link: '/catalog',
      button_style: 'outline',
      button_2_text: 'More',
      button_2_link: '/about',
      button_2_style: 'outline',
      position: 'bottom-right',
      align: 'right',
      align_mobile: 'center',
      box: true,
      overlay: 35,
      text_color: '#ffeeaa',
      color_scheme: 'scheme-3',
    };
    const two = { heading: 'Two', overlay: 60, text_color: '#112233', position: 'top-center', heading_size: 'small', color_scheme: 'scheme-gone' };
    const out = slideshowSettings(sec('slideshow', { text_below_mobile: true }, [['a', 'slide', one], ['b', 'slide', two], ['c', 'slide', { heading: 'Three' }]]));
    expect(out).toMatchObject({
      heading: 'One',
      eyebrow: 'NEW',
      headingSize: 'xl',
      description: 'Sub',
      buttonText: 'Shop',
      link: '/catalog',
      buttonStyle: 'outline',
      button2Text: 'More',
      button2Link: '/about',
      button2Style: 'outline',
      position: 'bottom-right',
      align: 'right',
      alignMobile: 'center',
      box: true,
      overlay: 35,
      textColor: '#ffeeaa',
      colorScheme: 'scheme-3',
      textBelowMobile: true,
    });
    expect(out.slides?.[0]).toMatchObject({ heading: 'Two', overlay: 60, textColor: '#112233', position: 'top-center', headingSize: 'small', colorScheme: 'scheme-gone' });
    // Slide three keeps its own defaults, not slide one's (or two's) darkening and colour.
    expect(out.slides?.[1]).toMatchObject({ heading: 'Three', overlay: 0, position: 'middle-left', box: false });
    expect(out.slides?.[1]).not.toHaveProperty('textColor');
  });

  it('slideshow: bad slide values fall back to the defaults', () => {
    const out = slideshowSettings(
      sec('slideshow', {}, [
        ['a', 'slide', { heading_size: 'huge', button_style: 'ghost', button_2_style: 3, position: 'middle', align: 'justify', align_mobile: '', box: 'yes', overlay: 120, text_color: 'red', color_scheme: 7 }],
      ]),
    );
    expect(out).toMatchObject({ headingSize: 'large', buttonStyle: 'filled', button2Style: 'filled', position: 'middle-left', align: 'left', alignMobile: 'left', box: false, overlay: 80 });
    expect(out.textColor).toBeUndefined();
    expect(out).not.toHaveProperty('colorScheme');
    expect(slideshowSettings(sec('slideshow', {}, [['a', 'slide', { overlay: -5 }]])).overlay).toBe(0);
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

  it('announcement', () => {
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
