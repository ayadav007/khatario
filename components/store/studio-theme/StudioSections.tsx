'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Heart, Search, ShoppingCart, Tag, User } from 'lucide-react';
import type { StoreCategoryStyle, StoreTestimonial } from '@/lib/store/store-theme';
import type { StudioSettings } from '@/lib/store/studio-sections';
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

export function StudioHero({ s, onCta }: { s: StudioSettings; onCta?: () => void }) {
  const height = s.height || 'medium';
  const alignItems = s.align === 'center' ? 'center' : s.align === 'right' ? 'flex-end' : 'flex-start';
  const shade = (s.overlay || 0) / 100;
  const benefits = splitList(s.benefits, '');
  return (
    <div className={`hero ${s.layout ?? 'image-text'} ${height}`} style={boxStyle(s)}>
      <div className="heroCopy" style={{ textAlign: s.align, alignItems }}>
        {s.eyebrow ? <small className="eyebrow">{s.eyebrow}</small> : null}
        <h1>{s.heading}</h1>
        {s.description ? <p>{s.description}</p> : null}
        {s.buttonText ? (
          <button type="button" className="st-btn" onClick={onCta}>
            {s.buttonText} →
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
      <div
        className="heroImg"
        role="img"
        aria-label=""
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,${shade}),rgba(0,0,0,${shade})),url(${JSON.stringify(s.image ?? '')})`,
        }}
      />
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

export function StudioProductTile({
  name,
  unit,
  price,
  mrp,
  image,
  href,
  showPrice = true,
  discount,
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
  href?: string;
  showPrice?: boolean;
  /** Percent; 0 hides the badge. */
  discount?: number;
  outOfStock?: boolean;
  fav?: boolean;
  onFav?: () => void;
  add?: ReactNode;
}) {
  const off = discount ?? (mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [image]);
  return (
    <article className="product">
      <div className="pimg">
        <a href={href} style={{ display: 'block', width: '100%', height: '100%', opacity: outOfStock ? 0.45 : 1 }}>
          {image && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={name} loading="lazy" onError={() => setBroken(true)} />
          ) : (
            <span className="ph">{name.charAt(0).toUpperCase()}</span>
          )}
        </a>
        {off > 0 ? <em>{off}% OFF</em> : null}
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
      {showPrice ? (
        <div className="price">
          {off > 0 && mrp ? <del>{rupees(mrp)}</del> : null}
          {rupees(price)}
        </div>
      ) : null}
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
  return (
    <section className="st-section" style={boxStyle(s)} id={id}>
      <StudioSectionHead
        eyebrow={studioEyebrow('products', s.eyebrow)}
        title={title ?? s.title}
        count={count}
        action={action === undefined ? { label: 'View All' } : action}
      />
      {chips}
      <div
        className="productGrid"
        style={{ '--columns': String(s.columns ?? 5), '--mcols': String(mobileColumns) } as CSSProperties}
      >
        {children}
      </div>
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
