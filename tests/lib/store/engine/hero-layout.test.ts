import { heroGridClass, heroImageLayers, heroRootClasses, heroZoomScale, type HeroLayer } from '@/lib/store/engine/hero-layout';

const POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

describe('heroGridClass', () => {
  it.each(POSITIONS)('places the words at %s', (position) => {
    expect(heroGridClass(position, 'left')).toBe(`hb-pos-${position} hb-align-left`);
  });

  it('aligns the text left, centre or right', () => {
    expect(heroGridClass('middle-left', 'left')).toBe('hb-pos-middle-left hb-align-left');
    expect(heroGridClass('top-right', 'center')).toBe('hb-pos-top-right hb-align-center');
    expect(heroGridClass('bottom-center', 'right')).toBe('hb-pos-bottom-center hb-align-right');
  });

  it('falls back to middle-left and left for unknown values', () => {
    expect(heroGridClass('nowhere', 'left')).toBe('hb-pos-middle-left hb-align-left');
    expect(heroGridClass('', '')).toBe('hb-pos-middle-left hb-align-left');
    expect(heroGridClass('top-centre', 'justify')).toBe('hb-pos-middle-left hb-align-left');
    expect(heroGridClass('bottom-right', 'middle')).toBe('hb-pos-bottom-right hb-align-left');
    expect(heroGridClass('left', 'right')).toBe('hb-pos-middle-left hb-align-right');
  });
});

describe('heroImageLayers', () => {
  it('has no layers without pictures', () => {
    expect(heroImageLayers({ image: '', image2: '', mobileImage: '' })).toEqual([]);
    expect(heroImageLayers({ image: '  ', image2: '', mobileImage: '' })).toEqual([]);
  });

  it('lists a picture, a video second picture and a phone picture in order', () => {
    expect(heroImageLayers({ image: '/a.webp', image2: '/b.mp4', mobileImage: '/m.jpg' })).toEqual([
      { url: '/a.webp', video: false, slot: 'main' },
      { url: '/b.mp4', video: true, slot: 'second' },
      { url: '/m.jpg', video: false, slot: 'phone' },
    ]);
  });

  it('treats MP4 and WebM as video and GIF as a picture', () => {
    expect(heroImageLayers({ image: '/clip.MP4?v=2', image2: '', mobileImage: '/p.webm' })).toEqual([
      { url: '/clip.MP4?v=2', video: true, slot: 'main' },
      { url: '/p.webm', video: true, slot: 'phone' },
    ]);
    expect(heroImageLayers({ image: '/loop.gif', image2: '', mobileImage: '' })).toEqual([{ url: '/loop.gif', video: false, slot: 'main' }]);
  });

  it('keeps a second picture without a first one, and a phone picture alone', () => {
    expect(heroImageLayers({ image: '', image2: '/b.webp', mobileImage: '' })).toEqual([{ url: '/b.webp', video: false, slot: 'second' }]);
    expect(heroImageLayers({ image: '', image2: '', mobileImage: '/m.webp' })).toEqual([{ url: '/m.webp', video: false, slot: 'phone' }]);
  });
});

describe('heroRootClasses', () => {
  const main: HeroLayer = { url: '/a.webp', video: false, slot: 'main' };
  const second: HeroLayer = { url: '/b.webp', video: false, slot: 'second' };
  const phone: HeroLayer = { url: '/m.webp', video: false, slot: 'phone' };
  const base = {
    height: 'medium',
    motion: 'none',
    box: false,
    textColor: false,
    textBelowMobile: false,
    twoImagesMobile: 'stack',
    alignMobile: 'left',
    words: true,
    layers: [main],
  };
  const classes = (o: Partial<typeof base>) => heroRootClasses({ ...base, ...o }).split(' ');

  it('a converted old banner: medium height, white words over the picture, left on phones', () => {
    expect(heroRootClasses(base)).toBe('hb-h-medium hb-white hb-white-m hb-malign-left');
  });

  it('no picture: section colours, no motion, adapt falls back to medium', () => {
    expect(heroRootClasses({ ...base, layers: [], motion: 'drift', height: 'adapt' })).toBe('hb-h-medium hb-malign-left');
  });

  it('height values and an unknown height', () => {
    expect(classes({ height: 'adapt' })).toContain('hb-h-adapt');
    expect(classes({ height: 'small' })).toContain('hb-h-small');
    expect(classes({ height: 'large' })).toContain('hb-h-large');
    expect(classes({ height: 'huge' })).toContain('hb-h-medium');
  });

  it('a box or a text colour stops the white words', () => {
    expect(classes({ box: true })).toEqual(expect.arrayContaining(['hb-box']));
    expect(classes({ box: true })).not.toContain('hb-white');
    expect(classes({ box: true })).not.toContain('hb-white-m');
    expect(classes({ textColor: true })).toEqual(expect.arrayContaining(['hb-text']));
    expect(classes({ textColor: true })).not.toContain('hb-white');
  });

  it('only a phone picture: white words on phones only', () => {
    const c = classes({ layers: [phone] });
    expect(c).toEqual(expect.arrayContaining(['hb-has-phone', 'hb-white-m']));
    expect(c).not.toContain('hb-white');
  });

  it('two pictures, stacked or first only on phones', () => {
    expect(classes({ layers: [main, second] })).toContain('hb-two');
    expect(classes({ layers: [main, second] })).not.toContain('hb-m-first');
    expect(classes({ layers: [main, second], twoImagesMobile: 'first' })).toEqual(expect.arrayContaining(['hb-two', 'hb-m-first']));
    expect(classes({ layers: [main], twoImagesMobile: 'first' })).not.toContain('hb-m-first');
    expect(classes({ layers: [second] })).not.toContain('hb-two');
  });

  it('words under the picture on phones are not white there', () => {
    const c = classes({ textBelowMobile: true });
    expect(c).toEqual(expect.arrayContaining(['hb-below-m', 'hb-white']));
    expect(c).not.toContain('hb-white-m');
    expect(classes({ textBelowMobile: true, layers: [] })).not.toContain('hb-below-m');
  });

  it('motion values need a picture; unknown motion is none', () => {
    expect(classes({ motion: 'drift' })).toContain('hb-motion-drift');
    expect(classes({ motion: 'zoom_scroll' })).toContain('hb-motion-zoom');
    expect(classes({ motion: 'fixed' })).toContain('hb-motion-fixed');
    expect(classes({ motion: 'spin' }).some((c) => c.startsWith('hb-motion'))).toBe(false);
    expect(classes({ motion: 'none' }).some((c) => c.startsWith('hb-motion'))).toBe(false);
  });

  it('a picture without words keeps a height (hb-bare), except when the picture sets it', () => {
    expect(heroRootClasses({ ...base, words: false })).toBe('hb-h-medium hb-white hb-white-m hb-bare hb-malign-left');
    expect(classes({ words: false, height: 'small' })).toContain('hb-bare');
    expect(classes({ words: false, height: 'large' })).toContain('hb-bare');
    expect(classes({ words: false, height: 'adapt' })).not.toContain('hb-bare');
    expect(classes({ words: true })).not.toContain('hb-bare');
    // Nothing at all: no picture to show (the renderer draws nothing then).
    expect(classes({ words: false, layers: [] })).not.toContain('hb-bare');
  });

  it('only a phone picture and no words: nothing to show on desktop (hb-phone-only)', () => {
    expect(classes({ words: false, layers: [phone] })).toEqual(expect.arrayContaining(['hb-bare', 'hb-phone-only']));
    expect(classes({ words: true, layers: [phone] })).not.toContain('hb-phone-only');
    expect(classes({ words: false, layers: [main, phone] })).not.toContain('hb-phone-only');
  });

  it('phone alignment, unknown → left', () => {
    expect(classes({ alignMobile: 'center' })).toContain('hb-malign-center');
    expect(classes({ alignMobile: 'right' })).toContain('hb-malign-right');
    expect(classes({ alignMobile: 'up' })).toContain('hb-malign-left');
  });
});

describe('heroZoomScale', () => {
  it('is 1 until the hero enters the window and 1.15 once it has left at the top', () => {
    expect(heroZoomScale(900, 400, 800)).toBe(1);
    expect(heroZoomScale(800, 400, 800)).toBe(1);
    expect(heroZoomScale(-400, 400, 800)).toBe(1.15);
    expect(heroZoomScale(-1000, 400, 800)).toBe(1.15);
  });

  it('grows with scroll progress', () => {
    // Halfway: (800 - 200) / (800 + 400) = 0.5.
    expect(heroZoomScale(200, 400, 800)).toBe(1.075);
  });

  it('is 1 for an empty window or hero', () => {
    expect(heroZoomScale(0, 0, 0)).toBe(1);
    expect(heroZoomScale(Number.NaN, 400, 800)).toBe(1);
  });
});
