'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import {
  BadgeCheck,
  Banknote,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gift,
  Heart,
  ImageIcon,
  Leaf,
  Minus,
  Phone,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Star,
  Tag,
  Truck,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { StoreCategoryStyle, StoreTestimonial } from '@/lib/store/store-theme';
import type { StudioBadge, StudioHeroSettings, StudioSection, StudioSettings, StudioSlide, StudioUsp } from '@/lib/store/studio-sections';
import type { StoreSwatch } from '@/lib/store/product-extras';
import { tileBadges } from '@/lib/store/engine/card-badges';
import {
  cardBadgeRow,
  cardButtonPlan,
  cardDiscount,
  cardOutOfStock,
  cardPhotoState,
  cardRating,
  cardUnits,
  designedCardRoot,
  isDesignedCard,
  type CardButtonPlan,
  type CardControl,
} from '@/lib/store/engine/card-render';
import type { ResolvedCardLook } from '@/lib/store/engine/product-card';
import type { ColorScheme } from '@/lib/store/engine/types';
import { heroGridClass } from '@/lib/store/engine/hero-layout';
import { sanitizeCssClass, scopeSectionCss, sectionDomId } from '@/lib/store/section-css';
import { splitList, studioEyebrow } from '@/lib/store/studio-layout';
import { isVideoUrl } from '@/lib/store/theme-media-url';
import './studio-theme.css';
import '../engine/product-card.css';

/**
 * Wrapper every Studio section renders in, on the store and in the editor: a stable
 * `#section-{id}` hook, `data-section-type`, the merchant's class names, and that section's own CSS.
 */
export function StudioSectionFrame({
  section,
  className,
  children,
  ...rest
}: { section: StudioSection; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const css = useMemo(() => scopeSectionCss(section.settings.customCss, section.id), [section.settings.customCss, section.id]);
  return (
    <div
      {...rest}
      id={sectionDomId(section.id)}
      data-section-type={section.type}
      className={['st-sec', className, sanitizeCssClass(section.settings.cssClass)].filter(Boolean).join(' ')}
    >
      {/* Scoped and brace-balanced by scopeSectionCss, with every `<` removed. */}
      {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
      {children}
    </div>
  );
}

export function boxStyle(s: StudioSettings = {}, extras: CSSProperties = {}): CSSProperties {
  const style: CSSProperties = { ...extras };
  if (s.background) style.background = s.background;
  if (s.spacingTop != null) style.paddingTop = s.spacingTop;
  if (s.spacingBottom != null) style.paddingBottom = s.spacingBottom;
  if (s.radius != null) style.borderRadius = s.radius;
  return style;
}

export function rupees(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function isIconSvg(value: string | undefined): value is string {
  return !!value && value.startsWith('data:image/svg+xml') && value.length < 20000;
}

/** Renders a picked icon in the current text colour, or the fallback when none is chosen. */
export function IconGlyph({ svg, fallback, size = 20 }: { svg?: string; fallback: ReactNode; size?: number }) {
  if (!isIconSvg(svg)) return <>{fallback}</>;
  const url = `url("${svg}")`;
  return (
    <span
      className="iconGlyph"
      aria-hidden="true"
      style={{ width: size, height: size, WebkitMaskImage: url, maskImage: url }}
    />
  );
}

export interface StudioLink {
  label: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  highlight?: boolean;
}

/** Real link on the storefront, inert text in the editor preview. */
function Lnk({ link, className, children }: { link: StudioLink; className?: string; children?: ReactNode }) {
  const body = children ?? link.label;
  if (link.onClick) {
    return (
      <button type="button" className={className} onClick={link.onClick}>
        {body}
      </button>
    );
  }
  return (
    <a className={className} href={link.href}>
      {body}
    </a>
  );
}

export function StudioAnnouncement({ s, live = false }: { s: StudioSettings; live?: boolean }) {
  const justify = s.textAlign === 'left' ? 'flex-start' : s.textAlign === 'right' ? 'flex-end' : 'center';
  const auto = s.announceMode === 'auto' && !!s.autoText;
  const bar: CSSProperties = {
    background: s.background || undefined,
    color: s.textColor || undefined,
    borderRadius: s.radius,
    minHeight: 36 + (s.spacingTop ?? 0) + (s.spacingBottom ?? 0),
    justifyContent: justify,
    alignItems: s.textVAlign === 'top' ? 'flex-start' : s.textVAlign === 'bottom' ? 'flex-end' : 'center',
  };
  const copy: CSSProperties = {
    paddingTop: s.textPadTop ?? 0,
    paddingRight: s.textPadRight ?? 0,
    paddingBottom: s.textPadBottom ?? 0,
    paddingLeft: s.textPadLeft ?? 0,
    textAlign: s.textAlign || 'center',
    justifyContent: justify,
  };
  const text = auto ? s.autoText : s.text;
  return (
    <div className="announce" style={bar}>
      <div className="announceCopy" style={copy}>
        {s.link && live ? (
          <a className="announceMain linked" href={s.link}>
            {text}
          </a>
        ) : (
          <span className={`announceMain ${s.link ? 'linked' : ''}`}>{text}</span>
        )}
        {!auto && s.extra ? <span className="announceExtra">{s.extra}</span> : null}
      </div>
    </div>
  );
}

/** A logo's class plus `logo-w` / `logo-wm` when its style sets the desktop / phone width variable (`logoWidthStyle`). */
export function logoSizeClass(base: string, style?: CSSProperties | Record<string, string>): string {
  const vars = (style ?? {}) as Record<string, unknown>;
  return [base, vars['--logo-w'] ? 'logo-w' : '', vars['--logo-w-m'] ? 'logo-wm' : ''].filter(Boolean).join(' ');
}

export function StudioHeader({
  s,
  logoUrl,
  hideName,
  search,
  nav,
  cartCount,
  onCart,
  accountHref,
  homeHref,
  menuSlot,
  inlineSlot,
  menuButton,
  layoutClass,
  logoStyle,
}: {
  s: StudioSettings;
  logoUrl?: string | null;
  /** Engine header: the logo without the store name beside it. */
  hideName?: boolean;
  /**
   * Engine header layout classes (`headerLayoutClasses`) on the header root. `hdr-logo-center` puts the logo between
   * a left and a right group: search (or the inline menu) on the left, icons (and search after an inline menu) right.
   */
  layoutClass?: string;
  /** Logo width variables (`--logo-w`, `--logo-w-m`) on the logo link; absent keeps the automatic size. */
  logoStyle?: CSSProperties;
  /** Live search field; the editor shows a static placeholder. */
  search?: ReactNode;
  nav?: StudioLink[];
  cartCount?: number;
  onCart?: () => void;
  accountHref?: string;
  homeHref?: string;
  /** Store menu bar under the header row, drawn instead of the `nav` links when given (null draws nothing). */
  menuSlot?: ReactNode;
  /** Store menu in the header row, between the logo and the search. */
  inlineSlot?: ReactNode;
  /** Phone menu button, before the logo. */
  menuButton?: ReactNode;
}) {
  const highlight = (s.highlightLink ?? '').trim().toLowerCase();
  const links: StudioLink[] =
    nav ?? splitList(s.navLinks, 'All Products').map((label) => ({ label }));
  const showAccount = s.showAccount !== false;
  const showCart = s.showCart !== false;
  const count = cartCount ?? 3;
  const centred = (layoutClass ?? '').split(/\s+/).includes('hdr-logo-center');
  const logo = (
    <a className={logoSizeClass('logo', logoStyle)} href={homeHref} style={logoStyle}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" />
      ) : null}
      {hideName ? <span className="sr-only">{s.logo || 'My store'}</span> : null}
      {!hideName || s.tagline ? (
        <span className="logoText">
          {hideName ? null : <b>{s.logo || 'My store'}</b>}
          {s.tagline ? <small>{s.tagline}</small> : null}
        </span>
      ) : null}
    </a>
  );
  const searchBox =
    s.showSearch !== false
      ? search ?? (
          <div className="search">
            <Search />
            <span>Search for products, categories...</span>
          </div>
        )
      : null;
  const icons =
    showAccount || showCart ? (
      <div className="icons">
        {showAccount ? (
          <a href={accountHref} aria-label="Account">
            <IconGlyph svg={s.accountIconSvg} fallback={<User />} />
          </a>
        ) : null}
        {showCart ? (
          <button type="button" onClick={onCart} aria-label={count > 0 ? `Cart, ${count} items` : 'Cart'}>
            <span className="cartIcon">
              <IconGlyph svg={s.cartIconSvg} fallback={<ShoppingCart />} />
              {s.showCartCount !== false && count > 0 ? <sup>{count}</sup> : null}
            </span>
          </button>
        ) : null}
      </div>
    ) : null;
  return (
    <div className={['headerBlock', layoutClass].filter(Boolean).join(' ')} style={boxStyle(s)}>
      <div className={['header', s.iconsPosition === 'left' ? 'iconsLeft' : '', inlineSlot ? 'hasInline' : ''].filter(Boolean).join(' ')}>
        {menuButton}
        {centred ? (
          // Equal-width groups either side keep the logo in the middle; on phones they dissolve (display: contents).
          <>
            <div className="hdr-side hdr-start">{inlineSlot || searchBox}</div>
            {logo}
            <div className="hdr-side hdr-end">
              {inlineSlot ? searchBox : null}
              {icons}
            </div>
          </>
        ) : (
          <>
            {logo}
            {inlineSlot}
            {searchBox}
            {icons}
          </>
        )}
      </div>
      {menuSlot !== undefined ? (
        menuSlot
      ) : s.showNav !== false && links.length ? (
        <nav className="nav">
          {links.map((l) => (
            <Lnk
              key={l.label}
              link={l}
              className={[
                highlight && l.label.toLowerCase() === highlight ? 'offers' : '',
                l.active ? 'on' : '',
              ].join(' ')}
            />
          ))}
        </nav>
      ) : null}
    </div>
  );
}

/**
 * The hero's own fields are slide one; `s.slides` holds the rest. Engine slides carry their own look (they have a
 * `position`); the old store's extra slides take the hero's label, alignment, darkening and text colour, as before.
 */
export function heroSlides(s: StudioHeroSettings): StudioSlide[] {
  const first: StudioSlide = {
    image: s.image ?? '',
    ...(s.mobileImage ? { mobileImage: s.mobileImage } : {}),
    heading: s.heading ?? '',
    description: s.description ?? '',
    buttonText: s.buttonText ?? '',
    link: s.link ?? '',
    eyebrow: s.eyebrow,
    headingSize: s.headingSize,
    buttonStyle: s.buttonStyle,
    button2Text: s.button2Text,
    button2Link: s.button2Link,
    button2Style: s.button2Style,
    position: s.position,
    align: s.align,
    alignMobile: s.alignMobile,
    box: s.box,
    overlay: s.overlay,
    textColor: s.textColor,
    colorScheme: s.colorScheme,
    schemeStyle: s.schemeStyle,
  };
  const shared = { eyebrow: s.eyebrow, align: s.align, overlay: s.overlay, textColor: s.textColor };
  return [first, ...(s.slides ?? []).map((sl) => (sl.position ? sl : { ...shared, ...sl }))];
}

/** Every slide field cleared, so nothing of the old slide one survives a new lead slide. */
const NO_SLIDE: Record<keyof StudioSlide, undefined> = {
  image: undefined,
  mobileImage: undefined,
  heading: undefined,
  description: undefined,
  buttonText: undefined,
  link: undefined,
  eyebrow: undefined,
  headingSize: undefined,
  buttonStyle: undefined,
  button2Text: undefined,
  button2Link: undefined,
  button2Style: undefined,
  position: undefined,
  align: undefined,
  alignMobile: undefined,
  box: undefined,
  overlay: undefined,
  textColor: undefined,
  colorScheme: undefined,
  schemeStyle: undefined,
};

/** The hero settings with `slide` as slide one (engine slides, which carry their whole look). */
export function heroWithLeadSlide(s: StudioHeroSettings, slide: StudioSlide): StudioHeroSettings {
  return { ...s, ...NO_SLIDE, ...slide };
}

const SLIDE_ALIGNS = ['left', 'center', 'right'];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/**
 * `natural` fit: an invisible copy of the active slide's image sets the hero's height to the image's
 * own shape; the phone copy takes over in studio-theme.css's phone container query. A video stands in
 * as a box of its shape once its metadata has loaded (16:9 until then).
 */
function HeroSizer({ slide, fallback, ratios }: { slide: StudioSlide; fallback: StudioSlide; ratios: Record<string, number> }) {
  const desk = slide.image || fallback.image || '';
  const phone = slide.mobileImage || fallback.mobileImage || '';
  const one = (url: string, cls: 'desk' | 'phone') =>
    isVideoUrl(url) ? (
      <div className={`heroSizer ${cls}`} style={{ aspectRatio: String(ratios[url] ?? 16 / 9) }} aria-hidden />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={`heroSizer ${cls}`} src={url} alt="" aria-hidden loading="lazy" />
    );
  return (
    <>
      {desk ? one(desk, 'desk') : null}
      {phone ? one(phone, 'phone') : null}
    </>
  );
}

export function StudioHero({
  s,
  onCta,
  live = false,
  showSlide,
}: {
  s: StudioHeroSettings;
  /** Called with the slide's link (empty when it has none). */
  onCta?: (link: string) => void;
  /** Storefront: autoplay runs. The editor preview stays on `showSlide`. */
  live?: boolean;
  showSlide?: number;
}) {
  const height = s.height || 'medium';
  const benefits = splitList(s.benefits, '');
  const slides = heroSlides(s);
  const many = slides.length > 1;
  // `noImg`: no slide has an image. Engine pages drop the empty image panel (EngineShell); the old store does not.
  const noImg = slides.every((sl) => !sl.image && !sl.mobileImage);
  const fit = s.imageFit ?? 'cover';
  const hasPhoneImg = slides.some((sl) => sl.mobileImage);
  const [index, setIndex] = useState(0);
  // Video slides' width / height by URL, for the `natural` fit.
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();
  const touchX = useRef<number | null>(null);
  const active = Math.min(index, slides.length - 1);
  const slide = slides[active];
  const interval = s.autoplay ?? 6;

  useEffect(() => {
    if (showSlide != null) setIndex(Math.max(0, Math.min(showSlide, slides.length - 1)));
  }, [showSlide, slides.length]);

  useEffect(() => {
    if (!live || !many || paused || reduced || interval <= 0) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % slides.length), interval * 1000);
    return () => window.clearInterval(t);
  }, [live, many, paused, reduced, interval, slides.length]);

  const go = (dir: 1 | -1) => setIndex((i) => (i + dir + slides.length) % slides.length);

  // The active slide's words. An engine slide (it has a position) places them with classes styled in
  // components/store/engine/slideshow.css (position, alignment, phone alignment, box, scheme), and its words sit in
  // .heroWords so the box has something to paint. The old store's slides keep the inline alignment and markup they had.
  const look = slide.position !== undefined;
  const align = slide.align;
  const alignItems = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
  const copyClass = look
    ? [
        'heroCopy hs-look',
        heroGridClass(slide.position ?? '', align ?? 'left'),
        `hs-malign-${SLIDE_ALIGNS.includes(slide.alignMobile ?? '') ? slide.alignMobile : 'left'}`,
        slide.box ? 'hs-box' : '',
        slide.textColor ? 'customText' : '',
        slide.schemeStyle ? 'hs-scheme' : '',
      ]
        .filter(Boolean)
        .join(' ')
    : slide.textColor
      ? 'heroCopy customText'
      : 'heroCopy';
  const textVar = slide.textColor ? { ['--hero-text' as string]: slide.textColor } : {};
  const copyStyle: CSSProperties = look
    ? { ...(slide.schemeStyle as CSSProperties | undefined), ...textVar }
    : { textAlign: align, alignItems, ...textVar };
  // Default Large keeps the slide heading's own size rules (Studio, tablet, phone and each preset's); other sizes add a class.
  const headingClass = look && slide.headingSize && slide.headingSize !== 'large' ? `hs-size-${slide.headingSize}` : undefined;
  const cta = (text: string | undefined, link: string | undefined, style: StudioSlide['buttonStyle']) =>
    text ? (
      <button
        type="button"
        className={style === 'outline' ? 'st-btn eng-cta' : 'st-btn'}
        data-style={style === 'outline' ? 'outline' : undefined}
        onClick={() => onCta?.(link ?? '')}
      >
        {text} →
      </button>
    ) : null;
  const button1 = cta(slide.buttonText, slide.link, look ? slide.buttonStyle : 'filled');
  const button2 = look ? cta(slide.button2Text, slide.button2Link, slide.button2Style) : null;
  const words = (
    <>
      {slide.eyebrow ? <small className="eyebrow">{slide.eyebrow}</small> : null}
      <h1 className={headingClass}>{slide.heading}</h1>
      {slide.description ? <p>{slide.description}</p> : null}
      {button1 && button2 ? (
        <div className="heroBtns">
          {button1}
          {button2}
        </div>
      ) : (
        button1 ?? button2
      )}
      {benefits.length ? (
        <div className="benefits">
          {benefits.map((b) => (
            <span key={b}>{b}</span>
          ))}
        </div>
      ) : null}
    </>
  );

  return (
    <div
      className={`hero ${s.layout ?? 'image-text'} ${height} ${many ? 'slideshow' : ''} ${noImg ? 'noImg' : ''} ${fit === 'cover' ? '' : `fit-${fit}`} ${hasPhoneImg ? 'hasPhoneImg' : ''}${s.textBelowMobile && !noImg ? ' hs-below-m' : ''}`}
      style={boxStyle(s)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (!many || start == null || end == null || Math.abs(end - start) < 40) return;
        go(end < start ? 1 : -1);
      }}
      aria-roledescription={many ? 'carousel' : undefined}
    >
      <div className={copyClass} style={copyStyle} key={many ? `copy-${active}` : 'copy'}>
        {look ? <div className="heroWords">{words}</div> : words}
      </div>
      <div className="heroImg" role="img" aria-label="">
        {fit === 'natural' ? <HeroSizer slide={slide} fallback={slides[0]} ratios={ratios} /> : null}
        {slides.map((sl, i) => {
          const desk = sl.image || slides[0].image || '';
          const phone = sl.mobileImage || slides[0].mobileImage || '';
          // Each slide's own darkening (the old store's slides all carry the hero's).
          const shade = (sl.overlay || 0) / 100;
          const layer = (url: string) => `linear-gradient(rgba(0,0,0,${shade}),rgba(0,0,0,${shade})),url(${JSON.stringify(url)})`;
          // Videos play as a muted loop (the only kind browsers autoplay); brightness stands in for the shade layer.
          const video = (url: string, cls: 'desk' | 'phone') => (
            <video
              className={`heroVid ${cls}`}
              src={url}
              muted
              loop
              autoPlay={!reduced}
              ref={(v) => {
                if (v && reduced) v.pause();
              }}
              playsInline
              preload="metadata"
              aria-hidden
              style={shade ? { filter: `brightness(${1 - shade})` } : undefined}
              onLoadedMetadata={(e) => {
                const { videoWidth: w, videoHeight: h } = e.currentTarget;
                if (w && h) setRatios((r) => (r[url] ? r : { ...r, [url]: w / h }));
              }}
            />
          );
          return (
            <div
              key={i}
              className={`heroSlideImg ${i === active ? 'on' : ''} ${phone ? 'hasPhone' : ''}${sl.schemeStyle ? ' hs-scheme' : ''}`}
              style={{
                ...(sl.schemeStyle as CSSProperties | undefined),
                ...(isVideoUrl(desk) ? {} : { backgroundImage: layer(desk) }),
                // A phone image swaps in through studio-theme.css's phone container query; a phone video clears it.
                ...(phone ? { ['--hero-phone-img' as string]: isVideoUrl(phone) ? 'none' : layer(phone) } : {}),
              }}
            >
              {isVideoUrl(desk) ? video(desk, 'desk') : null}
              {isVideoUrl(phone) ? video(phone, 'phone') : null}
            </div>
          );
        })}
      </div>
      {many ? (
        <>
          <button type="button" className="heroArrow prev" onClick={() => go(-1)} aria-label="Previous slide">
            <ChevronLeft />
          </button>
          <button type="button" className="heroArrow next" onClick={() => go(1)} aria-label="Next slide">
            <ChevronRight />
          </button>
          <div className="heroDots">
            {slides.map((_, i) => (
              <button
                type="button"
                key={i}
                className={i === active ? 'on' : ''}
                onClick={() => setIndex(i)}
                aria-label={`Slide ${i + 1} of ${slides.length}`}
                aria-current={i === active}
              >
                {i === active && live && !paused && !reduced && interval > 0 ? (
                  <i key={`p-${active}`} style={{ animationDuration: `${interval}s` }} />
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function StudioSectionHead({
  eyebrow,
  title,
  count,
  action,
}: {
  eyebrow: string;
  title?: string;
  count?: string;
  action?: StudioLink | null;
}) {
  return (
    <div className="sectionTitle">
      <div>
        {eyebrow ? <small className="eyebrow">{eyebrow}</small> : null}
        {title ? <h2>{title}</h2> : null}
        {count ? <div className="count">{count}</div> : null}
      </div>
      {action ? <Lnk link={action} className="more">{`${action.label} →`}</Lnk> : null}
    </div>
  );
}

export interface StudioTileCategory {
  id: string;
  name: string;
  image?: string;
  count?: number;
}

export function StudioCategoryTiles({
  categories,
  style,
  images,
  columns,
  selectedId,
  onSelect,
  marks,
}: {
  categories: StudioTileCategory[];
  style: StoreCategoryStyle;
  images: Record<string, string>;
  columns: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Category id to short text shown in the tile mark (emoji tiles); absent keeps the icon or letter. */
  marks?: Record<string, string>;
}) {
  return (
    <div className="catGrid" style={{ '--columns': String(columns) } as CSSProperties}>
      {categories.map((c) => {
        const photo = images[c.id] || c.image;
        const inner = (
          <>
            {style === 'photo' && photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" loading="lazy" />
            ) : (
              <div className={marks?.[c.id] ? 'catMark catEmoji' : 'catMark'}>
                {marks?.[c.id] ? marks[c.id] : style === 'icon' ? <Tag /> : c.name.charAt(0).toUpperCase()}
              </div>
            )}
            <b>{c.name}</b>
            {c.count != null ? <small>{c.count} items</small> : null}
            <span aria-hidden="true">→</span>
          </>
        );
        return onSelect ? (
          <button
            type="button"
            className={`cat cat-${style} ${selectedId === c.id ? 'on' : ''}`}
            key={c.id}
            onClick={() => onSelect(c.id)}
            aria-pressed={selectedId === c.id}
          >
            {inner}
          </button>
        ) : (
          <div className={`cat cat-${style}`} key={c.id}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

export function StudioCategoriesSection({
  s,
  categories,
  style,
  images,
  selectedId,
  onSelect,
  viewAll,
  marks,
}: {
  s: StudioSettings;
  categories: StudioTileCategory[];
  style: StoreCategoryStyle;
  images: Record<string, string>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  viewAll?: StudioLink;
  /** Passed to the tiles (D38). */
  marks?: Record<string, string>;
}) {
  return (
    <section className="st-section" style={boxStyle(s)}>
      <StudioSectionHead eyebrow={studioEyebrow('categories', s.eyebrow)} title={s.title} action={viewAll ?? { label: 'View All' }} />
      <StudioCategoryTiles
        categories={categories}
        style={style}
        images={images}
        columns={s.columns ?? 6}
        selectedId={selectedId}
        onSelect={onSelect}
        marks={marks}
      />
    </section>
  );
}

export type { StudioBadge } from '@/lib/store/studio-sections';

export interface StudioProductTileProps {
  name: string;
  unit?: string;
  price: number;
  mrp?: number | null;
  image?: string | null;
  /** Second photo shown on hover (devices with a mouse). */
  hoverImage?: string | null;
  href?: string;
  showPrice?: boolean;
  /** Percent; 0 hides the badge. */
  discount?: number;
  /** Extra badges after the discount, e.g. New or Bestseller. */
  badges?: StudioBadge[];
  rating?: number;
  ratingCount?: number;
  /** Units left when stock is low; shows "Only N left". */
  lowStock?: number;
  outOfStock?: boolean;
  fav?: boolean;
  onFav?: () => void;
  add?: ReactNode;
  /** One line above the name. */
  tagline?: string | null;
  /** Colour dots under the price. */
  swatches?: StoreSwatch[];
  /** Leaves out the "% OFF" badge (a product's own badge replaces it); the struck-through MRP stays. */
  hideDiscountBadge?: boolean;
  /** Card design: the brand line. */
  brand?: string | null;
  /**
   * Engine stores: the card look (`useEngineCardLook().card`) and the theme's colour schemes. A design other than Theme's
   * own draws the designed card; without it, or with Theme's own, the tile is exactly today's.
   */
  card?: { look: ResolvedCardLook; schemes: ColorScheme[] };
  /** Card design: every photo of the product, in order (swipe and the hover photo). Falls back to `image` / `hoverImage`. */
  images?: string[];
  /** Card design: the store logo for the `logo` placeholder. */
  placeholderLogo?: string | null;
  /** Card design: what the buttons do; the design's button style draws them. Without it the card shows `add` as given. */
  actions?: StudioCardActions;
}

/** A designed card's buttons: add, buy now and the − 1 + stepper. Handlers are optional (previews draw them inert). */
export interface StudioCardActions {
  /** Units in the cart (all options together for a product with options). */
  inCart: number;
  /** The product has options: add and buy open the option chooser. */
  hasOptions: boolean;
  /** The stepper's + can add one more. */
  canInc: boolean;
  onAdd?: (e: React.MouseEvent) => void;
  onBuy?: (e: React.MouseEvent) => void;
  onInc?: (e: React.MouseEvent) => void;
  onDec?: (e: React.MouseEvent) => void;
}

export function StudioProductTile(props: StudioProductTileProps) {
  const { card } = props;
  if (card && isDesignedCard(card.look)) return <DesignedProductTile {...props} card={card} />;
  return <ThemeProductTile {...props} />;
}

/** Today's tile, unchanged: Theme's own and every store off the engine. */
function ThemeProductTile({
  name,
  unit,
  price,
  mrp,
  image,
  hoverImage,
  href,
  showPrice = true,
  discount,
  badges = [],
  rating = 0,
  ratingCount = 0,
  lowStock,
  outOfStock,
  fav,
  onFav,
  add,
  tagline,
  swatches,
  hideDiscountBadge,
}: StudioProductTileProps) {
  const off = discount ?? (mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0);
  const [broken, setBroken] = useState(false);
  const [altBroken, setAltBroken] = useState(false);
  useEffect(() => setBroken(false), [image]);
  useEffect(() => setAltBroken(false), [hoverImage]);
  const { badges: allBadges, struck } = tileBadges(off, badges, hideDiscountBadge);
  const showAlt = !!hoverImage && hoverImage !== image && !broken && !altBroken;
  return (
    <article className={`product ${showAlt ? 'hasAlt' : ''}`}>
      <div className="pimg">
        <a href={href} style={{ display: 'block', width: '100%', height: '100%', opacity: outOfStock ? 0.45 : 1 }}>
          {image && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="main" src={image} alt={name} loading="lazy" onError={() => setBroken(true)} />
          ) : (
            <span className="ph">{name.charAt(0).toUpperCase()}</span>
          )}
          {showAlt ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="alt" src={hoverImage!} alt="" loading="lazy" aria-hidden="true" onError={() => setAltBroken(true)} />
          ) : null}
        </a>
        {allBadges.length ? (
          <div className="badges">
            {allBadges.slice(0, 2).map((b) => (
              <em key={b.label} className={b.tone}>
                {b.label}
              </em>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className={`fav ${fav ? 'on' : ''}`}
          aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
          onClick={onFav}
        >
          <Heart />
        </button>
        {outOfStock ? <span className="out">Out of stock</span> : null}
      </div>
      {tagline ? <div className="ptag">{tagline}</div> : null}
      <a className="pname" href={href}>
        {name}
      </a>
      {unit ? <div className="punit">{unit}</div> : null}
      {ratingCount > 0 && rating > 0 ? (
        <div className="prating" aria-label={`Rated ${rating} out of 5 by ${ratingCount} ${ratingCount === 1 ? 'customer' : 'customers'}`}>
          <span className="star" aria-hidden="true">★</span>
          <b>{rating.toFixed(1)}</b>
          <small>({ratingCount})</small>
        </div>
      ) : null}
      {showPrice ? (
        <div className="price">
          {rupees(price)}
          {struck && mrp ? <del>{rupees(mrp)}</del> : null}
        </div>
      ) : null}
      {swatches?.length ? (
        <div className="pswatches">
          {swatches.map((s) => (
            <span key={s.hex + s.name} title={s.name} style={{ background: s.hex }} />
          ))}
        </div>
      ) : null}
      {lowStock && !outOfStock ? <div className="plow">Only {lowStock} left</div> : null}
      {add ? <div className="addWrap">{add}</div> : null}
    </article>
  );
}

/** Small inline badge icons (`badge_icon`), drawn in the badge's text colour. */
const BADGE_ICONS: Record<Exclude<ResolvedCardLook['badge_icon'], 'none'>, string> = {
  crown: 'M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7z',
  star: 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8L12 2.5z',
  flame: 'M12 2c1 3.5 5 5.5 5 11a5 5 0 0 1-10 0c0-2.5 1.2-4 2.5-5.5.3 1.8 1 2.8 2 3.3C11 8 11.5 5 12 2z',
  sparkle: 'M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2zm7 13l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z',
};

/**
 * The tile when a card design is active (spec §4): the root carries `pc-on`, the look's classes and variables and its
 * colour scheme; the details (`.pc-body`) follow `look.lines`. Styles: components/store/engine/product-card.css. The photo
 * (`.pimg`: shape, fit, swipe with dots, hover, placeholder, wishlist) and the buttons (`.addWrap`, in the details or on
 * the photo) follow the photo and button settings.
 */
function DesignedProductTile({
  name,
  brand,
  unit,
  price,
  mrp,
  image,
  hoverImage,
  images,
  placeholderLogo,
  href,
  showPrice = true,
  discount,
  badges = [],
  rating = 0,
  ratingCount = 0,
  lowStock,
  outOfStock,
  fav,
  onFav,
  add,
  actions,
  tagline,
  swatches,
  hideDiscountBadge,
  card,
}: StudioProductTileProps & { card: NonNullable<StudioProductTileProps['card']> }) {
  const { look, schemes } = card;
  const off = discount ?? (mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0);
  // Photos that failed to load drop out (the next one, or the placeholder, takes their place).
  const gallery = images?.length ? images : [image, hoverImage];
  const galleryKey = gallery.join('\n');
  const [broken, setBroken] = useState<string[]>([]);
  const [logoBroken, setLogoBroken] = useState(false);
  useEffect(() => setBroken((b) => (b.length ? [] : b)), [galleryKey]);
  useEffect(() => setLogoBroken(false), [placeholderLogo]);
  const drop = (src: string) => setBroken((b) => (b.includes(src) ? b : [...b, src]));
  const photo = cardPhotoState(
    gallery.filter((u) => !u || !broken.includes(u)),
    look,
    !!placeholderLogo && !logoBroken,
  );
  const slide = useSlideIndex(photo.swipe, photo.photos.length);
  // The discount beside the price, when the price line shows; it then replaces the automatic "% OFF" badge.
  const priceShown = showPrice && look.lines.some((l) => l.id === 'price' && l.on);
  const saving = priceShown ? cardDiscount(look.discount_style, price, mrp, off) : null;
  const { badges: shownBadges, struck } = cardBadgeRow(look, { off, badges, hideDiscountBadge, discount: saving });
  const hasAdd = !!add || !!actions;
  const oos = cardOutOfStock(look, outOfStock, hasAdd);
  const root = designedCardRoot(look, schemes, { outOfStock, hasAlt: !!photo.hover });
  const icon =
    look.badge_icon === 'none' ? null : (
      <svg className="pc-badge-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d={BADGE_ICONS[look.badge_icon]} fill="currentColor" />
      </svg>
    );
  const stars = cardRating(look.rating_style, rating, ratingCount);
  // With actions the design's button style draws the buttons; without (a preview given only `add`) `add` shows as given.
  const plan = actions
    ? cardButtonPlan(look, { outOfStock, hasAdd, inCart: actions.inCart, hasOptions: actions.hasOptions })
    : null;
  const legacyButton =
    actions || oos.button === 'none' ? null : oos.button === 'soldout' ? (
      <button type="button" className="addBtn pc-soldout" disabled>
        Sold out
      </button>
    ) : (
      add
    );
  const controls = plan && actions ? <DesignedCardButtons plan={plan} actions={actions} /> : null;
  const bodyButtons = plan?.place === 'body' ? controls : legacyButton ? <div className="addWrap">{legacyButton}</div> : null;
  const photoButtons = plan?.place === 'photo' ? controls : null;
  const low = lowStock && !outOfStock ? <div className="plow">Only {lowStock} left</div> : null;

  const nameLine = (
    <a className="pname" href={href}>
      {name}
    </a>
  );
  const priceLine = showPrice ? (
    <div className="price">
      <span className="pc-now">{rupees(price)}</span>
      {look.show_mrp && struck && mrp ? <del>{rupees(mrp)}</del> : null}
      {saving ? <span className="pc-disc">{saving.kind === 'save' ? `Save ${rupees(saving.amount)}` : `${saving.percent}% off`}</span> : null}
    </div>
  ) : null;

  const units = cardUnits(look);
  const lines = units.map((u): ReactNode => {
    switch (u) {
      case 'brand':
        return brand ? (
          <div key={u} className="pc-brand">
            {brand}
          </div>
        ) : null;
      case 'name':
        return <Fragment key={u}>{nameLine}</Fragment>;
      case 'unit':
        return unit ? (
          <div key={u} className="punit">
            {unit}
          </div>
        ) : null;
      case 'rating':
        return stars ? (
          <div key={u} className="prating" role="img" aria-label={stars.label}>
            {stars.stars ? (
              <span className="pc-stars" style={{ '--pc-rate': `${stars.percent}%` } as CSSProperties} aria-hidden="true">
                ★★★★★
              </span>
            ) : (
              <span className="star" aria-hidden="true">
                ★
              </span>
            )}
            {stars.number ? <b>{stars.number}</b> : null}
            {stars.count != null ? <small>({stars.count})</small> : null}
          </div>
        ) : null;
      case 'tagline':
        return tagline ? (
          <div key={u} className="ptag">
            {tagline}
          </div>
        ) : null;
      case 'price':
        return <Fragment key={u}>{priceLine}</Fragment>;
      case 'name-price':
        return (
          <div key={u} className="pc-np">
            {nameLine}
            {priceLine}
          </div>
        );
      case 'swatches':
        return swatches?.length ? (
          <div key={u} className="pswatches">
            {swatches.map((s) => (
              <span key={s.hex + s.name} title={s.name} style={{ background: s.hex }} />
            ))}
          </div>
        ) : null;
      case 'buttons':
        return (
          <Fragment key={u}>
            {low}
            {bodyButtons}
          </Fragment>
        );
    }
  });

  const placeholder =
    photo.placeholder === 'logo' && placeholderLogo ? (
      <span className="ph pc-ph-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={placeholderLogo} alt="" onError={() => setLogoBroken(true)} />
      </span>
    ) : photo.placeholder === 'icon' ? (
      <span className="ph pc-ph-icon">
        <ImageIcon aria-hidden="true" />
      </span>
    ) : (
      <span className="ph">{name.charAt(0).toUpperCase()}</span>
    );
  const first = photo.photos[0];
  const pimgClass = ['pimg', photo.swipe && slide.index > 0 ? 'pc-slid' : '', oos.label ? 'pc-has-out' : ''].filter(Boolean).join(' ');

  return (
    <article className={root.className} style={root.style as CSSProperties}>
      <div className={pimgClass}>
        <a href={href} aria-label={first ? undefined : name} style={{ display: 'block', width: '100%', height: '100%' }}>
          {!first ? (
            placeholder
          ) : photo.swipe ? (
            <div className="pc-track" ref={slide.ref} tabIndex={-1}>
              {photo.photos.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={src}
                  className={i === 0 ? 'main' : 'pc-more'}
                  src={src}
                  alt={i === 0 ? name : ''}
                  loading="lazy"
                  onError={() => drop(src)}
                />
              ))}
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="main" src={first} alt={name} loading="lazy" onError={() => drop(first)} />
          )}
          {photo.hover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="alt" src={photo.hover} alt="" loading="lazy" aria-hidden="true" onError={() => drop(photo.hover!)} />
          ) : null}
        </a>
        {photo.swipe ? (
          <div className="pc-dots" aria-hidden="true">
            {photo.photos.map((src, i) => (
              <i key={src} className={i === slide.index ? 'on' : undefined} />
            ))}
          </div>
        ) : null}
        {shownBadges.length ? (
          <div className="badges">
            {shownBadges.map((b) => (
              <em key={b.label} className={b.tone}>
                {icon}
                {b.label}
              </em>
            ))}
          </div>
        ) : null}
        {look.wishlist === 'off' ? null : (
          <button
            type="button"
            className={`fav ${fav ? 'on' : ''}`}
            aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
            onClick={onFav}
          >
            <Heart />
          </button>
        )}
        {oos.label ? <span className="out">Out of stock</span> : null}
        {photoButtons}
      </div>
      <div className="pc-body">
        {lines}
        {units.includes('buttons') ? null : low}
      </div>
    </article>
  );
}

/** Swipe track: a ref for the scroller and the photo in view, kept by a passive scroll listener (removed on cleanup). */
function useSlideIndex(active: boolean, count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) {
      setIndex(0);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const w = el.clientWidth;
      // Math.abs: a right-to-left page scrolls to negative offsets.
      setIndex(w ? Math.round(Math.abs(el.scrollLeft) / w) : 0);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, count]);
  return { ref, index: Math.min(index, Math.max(0, count - 1)) };
}

/** One control of a designed card: a full button, a pill or a round icon, the − 1 + stepper, or a disabled button. */
function designedCardControl(control: CardControl, shape: 'full' | 'pill' | 'icon' | 'side', actions: StudioCardActions): ReactNode {
  if (control === 'stepper') {
    return (
      <div className={`stepper pc-ctl-${shape}`}>
        <button type="button" onClick={actions.onDec} aria-label="Decrease quantity">
          <Minus strokeWidth={2.4} />
        </button>
        <b aria-live="polite">{actions.inCart}</b>
        <button type="button" onClick={actions.onInc} disabled={!actions.canInc} aria-label="Increase quantity">
          <Plus strokeWidth={2.4} />
        </button>
      </div>
    );
  }
  if (control === 'soldout' || control === 'out') {
    return (
      <button type="button" className={`addBtn pc-ctl-${shape} ${control === 'soldout' ? 'pc-soldout' : 'pc-outbtn'}`} disabled>
        {control === 'soldout' ? 'Sold out' : 'Out of stock'}
      </button>
    );
  }
  const buy = control === 'buy';
  const label = buy ? 'Buy now' : actions.hasOptions ? 'Choose options' : 'Add to cart';
  const count = !buy && actions.inCart > 0 ? actions.inCart : 0;
  const iconOnly = shape === 'icon' || shape === 'side';
  // The pill reads ADD / BUY; its spoken name starts with that word.
  const spoken = shape === 'pill' ? (buy ? 'Buy now' : actions.hasOptions ? 'Add, choose options' : 'Add to cart') : label;
  const Icon = buy ? ShoppingBag : shape === 'side' ? ShoppingCart : Plus;
  // An add button that stays a button (no stepper) stops at the stock limit, as the stepper's + does.
  const atLimit = !buy && !actions.hasOptions && actions.inCart > 0 && !actions.canInc;
  return (
    <button
      type="button"
      className={`addBtn pc-ctl-${shape} pc-do-${control}`}
      onClick={buy ? actions.onBuy : actions.onAdd}
      disabled={atLimit}
      aria-label={iconOnly || shape === 'pill' || count ? (count ? `${spoken}, ${count} in cart` : spoken) : undefined}
    >
      {iconOnly ? <Icon aria-hidden="true" /> : shape === 'pill' ? (buy ? 'BUY' : 'ADD') : label}
      {count ? (
        <span className="pc-count" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </button>
  );
}

/**
 * A designed card's buttons (`cardButtonPlan`): in the details (`.pc-btnrow`, the full button and, for `icon_full`, the
 * icon doing the other action) or on the photo's corner (`.pc-onphoto`). `pc-hold` keeps a stepper in view under
 * `button_reveal: hover`.
 */
function DesignedCardButtons({ plan, actions }: { plan: CardButtonPlan; actions: StudioCardActions }) {
  const hold = plan.main.control === 'stepper' || plan.side === 'stepper';
  return (
    <div className={['addWrap', plan.place === 'photo' ? 'pc-onphoto' : 'pc-btnrow', hold ? 'pc-hold' : ''].filter(Boolean).join(' ')}>
      {designedCardControl(plan.main.control, plan.main.shape, actions)}
      {plan.side ? designedCardControl(plan.side, 'side', actions) : null}
    </div>
  );
}

/** Static add button used by the editor preview. */
export function StudioAddButton({ label = 'Add', onClick, disabled }: { label?: string; onClick?: (e: React.MouseEvent) => void; disabled?: boolean }) {
  return (
    <button type="button" className="addBtn" onClick={onClick} disabled={disabled}>
      <ShoppingCart /> {label}
    </button>
  );
}

/** Grid classes for a product section's card options. */
export function productGridClass(s: StudioSettings): string {
  return [
    'productGrid',
    s.display === 'carousel' ? 'carousel' : '',
    s.cardStyle && s.cardStyle !== 'bordered' ? `card-${s.cardStyle}` : '',
    s.imageRatio && s.imageRatio !== 'square' ? `ratio-${s.imageRatio}` : '',
    s.showRating === false ? 'no-rating' : '',
    s.showBadges === false ? 'no-badges' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function ProductRail({ className, style, children }: { className: string; style: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);
  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.9, behavior: 'smooth' });
  return (
    <div className="productRail">
      <button type="button" className="railBtn prev" onClick={() => page(-1)} disabled={edges.start} aria-label="Previous products">
        <ChevronLeft />
      </button>
      <div ref={ref} className={className} style={style} onScroll={measure}>
        {children}
      </div>
      <button type="button" className="railBtn next" onClick={() => page(1)} disabled={edges.end} aria-label="More products">
        <ChevronRight />
      </button>
    </div>
  );
}

export function StudioProductsSection({
  s,
  title,
  count,
  action,
  mobileColumns = 2,
  chips,
  id,
  anchorKind,
  gridClassName,
  children,
}: {
  s: StudioSettings;
  title?: string;
  count?: string;
  action?: StudioLink | null;
  mobileColumns?: 2 | 3;
  chips?: ReactNode;
  id?: string;
  /** Engine pages: `data-eng-anchor` for links that target the first grid of a kind. */
  anchorKind?: string;
  /** Extra grid classes, e.g. `isRow` for a sourced row the phone kit turns into a swipe row. */
  gridClassName?: string;
  children: ReactNode;
}) {
  const className = [productGridClass(s), gridClassName].filter(Boolean).join(' ');
  const style = { '--columns': String(s.columns ?? 5), '--mcols': String(mobileColumns) } as CSSProperties;
  return (
    <section className="st-section" style={boxStyle(s)} id={id} data-eng-anchor={anchorKind}>
      <StudioSectionHead
        eyebrow={studioEyebrow('products', s.eyebrow, s.source)}
        title={title ?? s.title}
        count={count}
        action={action === undefined ? { label: 'View All' } : action}
      />
      {chips}
      {s.display === 'carousel' ? (
        <ProductRail className={className} style={style}>
          {children}
        </ProductRail>
      ) : (
        <div className={className} style={style}>
          {children}
        </div>
      )}
    </section>
  );
}

export function StudioBanner({ s, onCta }: { s: StudioSettings; onCta?: () => void }) {
  const bg: CSSProperties = s.image
    ? {
        backgroundImage: `linear-gradient(rgba(0,0,0,.4),rgba(0,0,0,.4)),url(${JSON.stringify(s.image)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        color: '#fff',
      }
    : {};
  const eyebrow = studioEyebrow('banner', s.eyebrow);
  return (
    // `bh-*` / `ta-*`: hooks for a height and text position; nothing styles them now that engine pages render the
    // Hero banner themselves (engine/sections/ImageBanner.tsx).
    <div
      className={['banner', s.image ? 'hasImage' : '', s.height ? `bh-${s.height}` : '', s.textAlign ? `ta-${s.textAlign}` : '']
        .filter(Boolean)
        .join(' ')}
      style={boxStyle(s, bg)}
    >
      <div>
        {eyebrow ? <small className="eyebrow">{eyebrow}</small> : null}
        <h2>{s.title}</h2>
        {s.text ? <p>{s.text}</p> : null}
        {s.button ? (
          <button type="button" className="st-btn" onClick={onCta}>
            {s.button} →
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function StudioTestimonials({
  s,
  testimonials,
  sample = false,
}: {
  s: StudioSettings;
  testimonials: StoreTestimonial[];
  /** Editor-only marker when the store has no real quotes yet. */
  sample?: boolean;
}) {
  const eyebrow = studioEyebrow('testimonials', s.eyebrow);
  return (
    <section className="st-section test" style={boxStyle(s)}>
      <div className="sectionTitle">
        <div>
          {eyebrow || sample ? (
            <small className="eyebrow">
              {eyebrow}
              {sample ? <span className="sample">(sample quotes)</span> : null}
            </small>
          ) : null}
          <h2>{s.title}</h2>
        </div>
      </div>
      <div className="quotes">
        {testimonials.slice(0, 3).map((t, i) => (
          <blockquote key={`${t.name}-${i}`}>
            “{t.text}”<b>— {t.name}</b>
          </blockquote>
        ))}
      </div>
    </section>
  );
}

export const USP_ICONS: Record<StudioUsp['icon'], LucideIcon> = {
  truck: Truck,
  cash: Banknote,
  return: RotateCcw,
  shield: ShieldCheck,
  clock: Clock,
  leaf: Leaf,
  star: Star,
  gift: Gift,
  phone: Phone,
  badge: BadgeCheck,
};

export const DEFAULT_USPS: StudioUsp[] = [
  { icon: 'truck', title: 'Fast delivery', text: 'Quick dispatch on every order' },
  { icon: 'cash', title: 'Cash on delivery', text: 'Pay when it reaches you' },
  { icon: 'return', title: 'Easy returns', text: 'Hassle-free replacements' },
  { icon: 'shield', title: 'Secure payments', text: 'UPI, cards and wallets' },
];

/** Row of icon + short promise ("Free delivery", "Easy returns"). */
export function StudioUspStrip({ s }: { s: StudioSettings }) {
  const items = (s.usps ?? DEFAULT_USPS).filter((u) => u.title || u.text);
  if (!items.length) return null;
  return (
    <section className="usp" style={boxStyle(s, s.textColor ? { color: s.textColor } : {})}>
      {s.title ? <h2 className="uspTitle">{s.title}</h2> : null}
      <div className="uspGrid" style={{ '--count': String(items.length) } as CSSProperties}>
        {items.map((u, i) => {
          const Icon = USP_ICONS[u.icon] ?? BadgeCheck;
          return (
            <div className="uspItem" key={`${u.icon}-${i}`}>
              {u.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.image} alt="" className="uspImg" loading="lazy" />
              ) : (
                <span className="uspIcon">
                  <Icon />
                </span>
              )}
              <span>
                {u.title ? <b>{u.title}</b> : null}
                {u.text ? <small>{u.text}</small> : null}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const MARQUEE_SECONDS = { slow: 60, normal: 36, fast: 20 } as const;

/** Endlessly scrolling line of short messages; pauses on hover and for reduced motion. */
export function StudioMarquee({ s }: { s: StudioSettings }) {
  const items = splitList(s.text, '');
  if (!items.length) return null;
  const run = (hidden: boolean) => (
    <div className="marqueeRun" aria-hidden={hidden || undefined}>
      {items.map((t, i) => (
        <span key={i}>
          {t}
          <i aria-hidden="true">✦</i>
        </span>
      ))}
    </div>
  );
  return (
    <div
      className="marquee"
      style={boxStyle(s, {
        ...(s.textColor ? { color: s.textColor } : {}),
        '--marquee-duration': `${MARQUEE_SECONDS[s.speed ?? 'normal']}s`,
      } as CSSProperties)}
    >
      <div className="marqueeTrack">
        {run(false)}
        {run(true)}
      </div>
    </div>
  );
}

export function StudioRichText({ s }: { s: StudioSettings }) {
  return (
    <div className="rich" style={boxStyle(s)}>
      {s.title ? <h2>{s.title}</h2> : null}
      {s.text ? <p>{s.text}</p> : null}
    </div>
  );
}

export function StudioFooter({
  s,
  links,
  columns,
  badge,
}: {
  s: StudioSettings;
  links: StudioLink[];
  /** Engine footer: link columns under their headings (linked when `href`), then `links` (social) as a last column. */
  columns?: { heading: string; href?: string; links: StudioLink[] }[];
  badge?: string;
}) {
  return (
    <footer className="st-footer" style={boxStyle(s)}>
      <div className="footerBrand">
        <b>{s.brand || 'My store'}</b>
        {s.tagline ? <span>{s.tagline}</span> : null}
      </div>
      {columns ? (
        <div className="footerCols">
          {[...columns, { heading: '', href: undefined, links }]
            .filter((c) => c.links.length > 0)
            .map((c, i) => (
              <nav key={i} className="footerLinks footerCol" aria-label={c.heading || undefined}>
                {c.heading ? <b>{c.href ? <a href={c.href}>{c.heading}</a> : c.heading}</b> : null}
                {c.links.map((l) => (
                  <Lnk key={l.label} link={l} />
                ))}
              </nav>
            ))}
        </div>
      ) : (
        <nav className="footerLinks">
          {links.map((l) => (
            <Lnk key={l.label} link={l} />
          ))}
        </nav>
      )}
      {badge ? <div className="footerBadge">{badge}</div> : null}
    </footer>
  );
}
