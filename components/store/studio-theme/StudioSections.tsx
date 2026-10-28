'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BadgeCheck,
  Banknote,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gift,
  Heart,
  Leaf,
  Phone,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Star,
  Tag,
  Truck,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { StoreCategoryStyle, StoreTestimonial } from '@/lib/store/store-theme';
import type { StudioSettings, StudioSlide, StudioUsp } from '@/lib/store/studio-sections';
import { splitList, studioEyebrow } from '@/lib/store/studio-layout';
import './studio-theme.css';

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

export function StudioHeader({
  s,
  logoUrl,
  search,
  nav,
  cartCount,
  onCart,
  accountHref,
  homeHref,
}: {
  s: StudioSettings;
  logoUrl?: string | null;
  /** Live search field; the editor shows a static placeholder. */
  search?: ReactNode;
  nav?: StudioLink[];
  cartCount?: number;
  onCart?: () => void;
  accountHref?: string;
  homeHref?: string;
}) {
  const highlight = (s.highlightLink ?? '').trim().toLowerCase();
  const links: StudioLink[] =
    nav ?? splitList(s.navLinks, 'All Products').map((label) => ({ label }));
  const showAccount = s.showAccount !== false;
  const showCart = s.showCart !== false;
  const count = cartCount ?? 3;
  return (
    <div className="headerBlock" style={boxStyle(s)}>
      <div className={`header ${s.iconsPosition === 'left' ? 'iconsLeft' : ''}`}>
        <a className="logo" href={homeHref}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" />
          ) : null}
          <span className="logoText">
            <b>{s.logo || 'My store'}</b>
            {s.tagline ? <small>{s.tagline}</small> : null}
          </span>
        </a>
        {s.showSearch !== false
          ? search ?? (
              <div className="search">
                <Search />
                <span>Search for products, categories...</span>
              </div>
            )
          : null}
        {showAccount || showCart ? (
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
        ) : null}
      </div>
      {s.showNav !== false && links.length ? (
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

/** The hero's own fields are slide one; `s.slides` holds the rest. */
export function heroSlides(s: StudioSettings): StudioSlide[] {
  return [
    {
      image: s.image ?? '',
      heading: s.heading ?? '',
      description: s.description ?? '',
      buttonText: s.buttonText ?? '',
      link: s.link ?? '',
    },
    ...(s.slides ?? []),
  ];
}

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

export function StudioHero({
  s,
  onCta,
  live = false,
  showSlide,
}: {
  s: StudioSettings;
  /** Called with the slide's link (empty when it has none). */
  onCta?: (link: string) => void;
  /** Storefront: autoplay runs. The editor preview stays on `showSlide`. */
  live?: boolean;
  showSlide?: number;
}) {
  const height = s.height || 'medium';
  const alignItems = s.align === 'center' ? 'center' : s.align === 'right' ? 'flex-end' : 'flex-start';
  const shade = (s.overlay || 0) / 100;
  const benefits = splitList(s.benefits, '');
  const slides = heroSlides(s);
  const many = slides.length > 1;
  const [index, setIndex] = useState(0);
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

  return (
    <div
      className={`hero ${s.layout ?? 'image-text'} ${height} ${many ? 'slideshow' : ''}`}
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
      <div className="heroCopy" style={{ textAlign: s.align, alignItems }} key={many ? `copy-${active}` : 'copy'}>
        {s.eyebrow ? <small className="eyebrow">{s.eyebrow}</small> : null}
        <h1>{slide.heading}</h1>
        {slide.description ? <p>{slide.description}</p> : null}
        {slide.buttonText ? (
          <button type="button" className="st-btn" onClick={() => onCta?.(slide.link)}>
            {slide.buttonText} →
          </button>
        ) : null}
        {benefits.length ? (
          <div className="benefits">
            {benefits.map((b) => (
              <span key={b}>{b}</span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="heroImg" role="img" aria-label="">
        {slides.map((sl, i) => (
          <div
            key={i}
            className={`heroSlideImg ${i === active ? 'on' : ''}`}
            style={{
              backgroundImage: `linear-gradient(rgba(0,0,0,${shade}),rgba(0,0,0,${shade})),url(${JSON.stringify(sl.image || slides[0].image || '')})`,
            }}
          />
        ))}
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
}: {
  categories: StudioTileCategory[];
  style: StoreCategoryStyle;
  images: Record<string, string>;
  columns: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
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
              <div className="catMark">{style === 'icon' ? <Tag /> : c.name.charAt(0).toUpperCase()}</div>
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
}: {
  s: StudioSettings;
  categories: StudioTileCategory[];
  style: StoreCategoryStyle;
  images: Record<string, string>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  viewAll?: StudioLink;
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
      />
    </section>
  );
}

export interface StudioBadge {
  label: string;
  tone: 'sale' | 'new' | 'hot';
}

export function StudioProductTile({
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
}: {
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
}) {
  const off = discount ?? (mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0);
  const [broken, setBroken] = useState(false);
  const [altBroken, setAltBroken] = useState(false);
  useEffect(() => setBroken(false), [image]);
  useEffect(() => setAltBroken(false), [hoverImage]);
  const allBadges: StudioBadge[] = [...(off > 0 ? [{ label: `${off}% OFF`, tone: 'sale' as const }] : []), ...badges];
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
          {off > 0 && mrp ? <del>{rupees(mrp)}</del> : null}
        </div>
      ) : null}
      {lowStock && !outOfStock ? <div className="plow">Only {lowStock} left</div> : null}
      {add ? <div className="addWrap">{add}</div> : null}
    </article>
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
  children,
}: {
  s: StudioSettings;
  title?: string;
  count?: string;
  action?: StudioLink | null;
  mobileColumns?: 2 | 3;
  chips?: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  const className = productGridClass(s);
  const style = { '--columns': String(s.columns ?? 5), '--mcols': String(mobileColumns) } as CSSProperties;
  return (
    <section className="st-section" style={boxStyle(s)} id={id}>
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
    <div className={`banner ${s.image ? 'hasImage' : ''}`} style={boxStyle(s, bg)}>
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
              <span className="uspIcon">
                <Icon />
              </span>
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

export function StudioFooter({ s, links, badge }: { s: StudioSettings; links: StudioLink[]; badge?: string }) {
  return (
    <footer className="st-footer" style={boxStyle(s)}>
      <div className="footerBrand">
        <b>{s.brand || 'My store'}</b>
        {s.tagline ? <span>{s.tagline}</span> : null}
      </div>
      <nav className="footerLinks">
        {links.map((l) => (
          <Lnk key={l.label} link={l} />
        ))}
      </nav>
      {badge ? <div className="footerBadge">{badge}</div> : null}
    </footer>
  );
}
