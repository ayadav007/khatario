'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { ThemeRow } from '@/lib/store/engine/types';
import { useStore } from '@/lib/store/store-context';
import { previewStoreCss } from '@/lib/store/section-css';
import { setStoreFavicon } from '@/lib/store/store-favicon';
import { findAnchor } from '@/lib/store/engine/anchors';
import { withPreviewParams } from '@/lib/store/engine/links';
import { StoreCartDrawer } from '../StoreCartDrawer';
import { StoreMobileNav } from '../StoreMobileNav';
import { engineRootClass } from '@/lib/store/engine/root-class';
import { BROWSE_CATEGORIES_EVENT, QuickCartBar, QuickTabs } from '../quick-theme/QuickChrome';
import '../phone-kit.css';
import '../studio-theme/studio-theme.css';
// Preset layers (D27): each is scoped to .st-root.eng-root.eng-preset-<preset>, so loading all three is safe.
import { EngineCardContext } from './EngineCardContext';
import './presets/quick.css';
import './presets/grocery.css';
import './presets/khatario.css';

const EngineCartContext = createContext<{ openCart: () => void }>({ openCart: () => {} });

/** Lets the header (inside a section) open the shell's cart drawer. */
export function useEngineCart() {
  return useContext(EngineCartContext);
}

// Theme fonts on headings and the theme's button radius over the Studio defaults.
const THEME_RULES =
  '.st-root.eng-root.store-studio :is(h1,h2,h3,.logo b){font-family:var(--font-heading)}' +
  '.st-root.eng-root.store-studio :is(.st-btn,.addBtn){border-radius:var(--btn-radius)}' +
  // Buttons follow the section's colour scheme (button / button text), else the store's primary colour.
  '.st-root.eng-root .st-btn{background:var(--c-btn,var(--primary));color:var(--c-btn-text,var(--on-primary))}' +
  '.st-root.eng-root .addBtn:not(:disabled){border-color:var(--c-btn,var(--primary));color:var(--c-btn,var(--primary))}' +
  '.st-root.eng-root .addBtn:not(:disabled):hover{background:var(--c-btn,var(--primary));color:var(--c-btn-text,var(--on-primary))}' +
  '.st-root.eng-root .stepper{background:var(--c-btn,var(--primary));color:var(--c-btn-text,var(--on-primary))}' +
  // Muted text and hairlines come from the section's own text colour: declared once on .st-root they would keep the
  // theme's text colour, so a dark section's secondary text stayed dark grey. Shared components' fixed Tailwind greys
  // (catalog filters, product page) follow the section's text, muted text, card and line colours too.
  '.st-root.eng-root .eng-sec{--st-line:var(--c-border,color-mix(in srgb,var(--text) 14%,transparent));--st-muted:color-mix(in srgb,var(--text) 62%,transparent);--qk-card:var(--st-card)}' +
  // A section with its own scheme: the announcement bar and footer take the scheme's paint (the frame) instead of
  // their own fixed accent / dark colours; the low-stock note stays orange but readable on any paper.
  '.st-root.eng-root .eng-sec[data-scheme] :is(.announce,.st-footer){background:transparent;color:inherit}' +
  '.st-root.eng-root .plow{color:color-mix(in srgb,#ea580c 72%,var(--text))}' +
  '.st-root.eng-root .eng-sec :is(.text-gray-900,.text-gray-800,.text-gray-700,.text-black){color:var(--text)}' +
  '.st-root.eng-root .eng-sec :is(.text-gray-600,.text-gray-500,.text-gray-400){color:var(--st-muted)}' +
  '.st-root.eng-root .eng-sec :is(.bg-white,.bg-gray-50){background-color:var(--st-card)}' +
  '.st-root.eng-root .eng-sec :is(.border-gray-100,.border-gray-200,.border-gray-300){border-color:var(--st-line)}' +
  // A hero with no image on any slide: copy only, full width (the old Grocery and Khatario heroes had no empty panel).
  // Testimonials: star rating above the quote, photo beside the name.
  '.st-root.eng-root .quotes .eng-stars{display:block;color:#f59e0b;font:14px/1 Inter,sans-serif;letter-spacing:2px;margin-bottom:10px}' +
  '.st-root.eng-root .quotes .eng-stars-off{opacity:.25}' +
  '.st-root.eng-root .quotes .eng-quote-by{display:flex;align-items:center;gap:8px;margin-top:14px}' +
  '.st-root.eng-root .quotes .eng-quote-by b{margin-top:0}' +
  '.st-root.eng-root .quotes .eng-quote-by img{width:32px;height:32px;border-radius:50%;object-fit:cover}' +
  // Footer link columns, each under its heading.
  '.st-root.eng-root .footerCols{margin-left:auto;display:flex;gap:36px;flex-wrap:wrap}' +
  '.st-root.eng-root .footerCols .footerCol{margin-left:0;flex-direction:column;gap:8px}' +
  '.st-root.eng-root .footerCol>b{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.6}' +
  '@container store (max-width:640px){.st-root.eng-root .footerCols{margin-left:0;gap:24px}}' +
  // Image banner height and text position.
  '.st-root.eng-root .banner.bh-small{padding-block:22px}' +
  '.st-root.eng-root .banner.bh-large{min-height:360px}' +
  '.st-root.eng-root .banner.ta-center{justify-content:center;text-align:center}' +
  '.st-root.eng-root .banner.ta-right{justify-content:flex-end;text-align:right}' +
  // Category grid styles: circles (round photos or marks), cards (raised tiles). Tiles is the default look.
  '.st-root.eng-root .eng-cats--circles .cat{background:none;text-align:center;box-shadow:none}' +
  '.st-root.eng-root .eng-cats--circles .cat :is(img,.catMark){width:min(100%,120px);height:auto;aspect-ratio:1;border-radius:50%;margin:0 auto}' +
  '.st-root.eng-root .eng-cats--circles .cat :is(b,small){padding-inline:4px}' +
  '.st-root.eng-root .eng-cats--cards .cat{background:var(--st-card,#fff);border:1px solid rgba(0,0,0,.08);box-shadow:0 2px 8px rgba(0,0,0,.06)}' +
  '.st-root.eng-root .hero.noImg:not(.full){grid-template-columns:1fr}' +
  '.st-root.eng-root .hero.noImg:not(.full) .heroImg{display:none}' +
  // A product grid's "Columns on phone" beats each preset's phone default (Quick's 3, the others' 2).
  '@container store (max-width:640px){' +
  '.st-root.eng-root.eng-root .eng-sec .productGrid.mcols-2:not(.carousel){grid-template-columns:repeat(2,minmax(0,1fr))}' +
  '.st-root.eng-root.eng-root .eng-sec .productGrid.mcols-3:not(.carousel){grid-template-columns:repeat(3,minmax(0,1fr))}' +
  '}' +
  // Image with text uses an h2 in the hero markup (the page's h1 belongs to the slideshow).
  '.st-root.eng-root .heroCopy .eng-heroTitle{font-size:clamp(24px,5cqi,40px);line-height:1.1;margin:12px 0;font-weight:700;overflow-wrap:anywhere}' +
  // Full width (eng-sec--full): the section's content drops its side gutter and centred width caps.
  '.st-root.eng-root .eng-sec--full :is(.eng-html,.eng-collections,.eng-logos,.eng-video,.eng-faq,.eng-news,.eng-countdown){padding-left:0;padding-right:0}' +
  '.st-root.eng-root .eng-sec--full :is(.eng-faq,.eng-video-frame,.rich p){max-width:none}' +
  // Product cards follow the theme's card style (data-card on the root); "bordered" is the card's own look.
  '.st-root.eng-root[data-card="plain"] main article.g-surface{border-color:transparent;box-shadow:none}' +
  '.st-root.eng-root[data-card="shadow"] main article.g-surface{border-color:transparent;box-shadow:0 6px 18px rgba(0,0,0,.08)}' +
  // Footer payment icons: small text badges under the footer.
  '.st-root.eng-root .eng-pay{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;padding:12px 16px 20px}' +
  '.st-root.eng-root .eng-pay li{list-style:none;border:1px solid rgba(0,0,0,.15);border-radius:6px;padding:3px 9px;font-size:11px;font-weight:700;letter-spacing:.3px;opacity:.75}' +
  // A section that rendered nothing (an empty row, a hidden failure) takes no space; separate rules so
  // a browser without :has still applies :empty.
  '.st-root.eng-root .eng-sec:empty{display:none}' +
  '.st-root.eng-root .eng-sec:not(:has(>:not(style))){display:none}' +
  // Custom HTML gets Studio's rich-text gutter and keeps its images inside the page.
  '.st-root.eng-root .eng-html{padding:0 30px;overflow-wrap:anywhere}' +
  '.st-root.eng-root .eng-html :is(img,iframe,video,table){max-width:100%}' +
  '.st-root.eng-root .eng-html :is(img,video){height:auto}' +
  '@container store (max-width: 640px){.st-root.eng-root .eng-html{padding:0 16px}}' +
  // Collection list, logo list, video, FAQ, newsletter and countdown share one padded, centred block.
  '.st-root.eng-root :is(.eng-collections,.eng-logos,.eng-video,.eng-faq,.eng-news,.eng-countdown){padding:0 30px;overflow-wrap:anywhere}' +
  '.st-root.eng-root :is(.eng-collections,.eng-logos,.eng-video,.eng-faq,.eng-news,.eng-countdown)>h2{margin:0 0 16px;text-align:center}' +
  '.st-root.eng-root .eng-collections-grid{display:grid;grid-template-columns:repeat(var(--eng-cols,4),minmax(0,1fr));gap:14px}' +
  '.st-root.eng-root .eng-collection{display:block;text-decoration:none;color:inherit}' +
  '.st-root.eng-root .eng-collection-img{display:block;aspect-ratio:1/1;background:#eee center/cover no-repeat;border-radius:var(--btn-radius,10px)}' +
  '.st-root.eng-root .eng-collection-title{display:block;margin-top:8px;font-weight:600;text-align:center}' +
  '.st-root.eng-root .eng-logos ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:20px 32px}' +
  '.st-root.eng-root .eng-logos img{display:block;max-height:48px;max-width:140px;width:auto;height:auto;object-fit:contain}' +
  '.st-root.eng-root .eng-video-frame{position:relative;aspect-ratio:16/9;max-width:960px;margin:0 auto;background:#000;border-radius:var(--btn-radius,10px);overflow:hidden}' +
  '.st-root.eng-root .eng-video-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}' +
  '.st-root.eng-root .eng-video-cover{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000 center/cover no-repeat;cursor:pointer;color:#fff;font-size:44px}' +
  '.st-root.eng-root .eng-faq{max-width:760px;margin:0 auto}' +
  '.st-root.eng-root .eng-faq details{border-bottom:1px solid rgba(0,0,0,.12);padding:12px 0}' +
  '.st-root.eng-root .eng-faq summary{cursor:pointer;font-weight:600}' +
  '.st-root.eng-root .eng-faq details>div{margin-top:8px}' +
  '.st-root.eng-root .eng-news{text-align:center}' +
  '.st-root.eng-root .eng-news>p{margin:0 0 14px}' +
  '.st-root.eng-root .eng-news-form{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;max-width:480px;margin:0 auto}' +
  '.st-root.eng-root .eng-news-form input{flex:1 1 220px;min-width:0;padding:10px 12px;border:1px solid rgba(0,0,0,.25);border-radius:var(--btn-radius,10px);font:inherit}' +
  '.st-root.eng-root .eng-news-error{flex-basis:100%;margin:0;color:#b91c1c;font-size:14px}' +
  '.st-root.eng-root .eng-countdown{text-align:center}' +
  '.st-root.eng-root .eng-countdown-boxes{display:flex;justify-content:center;gap:12px;margin-bottom:14px}' +
  '.st-root.eng-root .eng-countdown-boxes>div{min-width:64px;padding:10px 6px;border-radius:var(--btn-radius,10px);background:rgba(0,0,0,.06)}' +
  '.st-root.eng-root .eng-countdown-boxes b{display:block;font-size:28px;line-height:1.1;font-variant-numeric:tabular-nums}' +
  '.st-root.eng-root .eng-countdown-boxes span{font-size:12px;text-transform:uppercase;letter-spacing:.04em}' +
  '@container store (max-width: 640px){.st-root.eng-root :is(.eng-collections,.eng-logos,.eng-video,.eng-faq,.eng-news,.eng-countdown){padding:0 16px}.st-root.eng-root .eng-collections-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
  // Promo cards: a grid of cards; split = copy plus image, overlay = image cover, gradient and caption.
  '.st-root.eng-root .eng-promos-block{padding:0 30px}' +
  '.st-root.eng-root .eng-promos-block>h2{margin:0 0 16px}' +
  '.st-root.eng-root .eng-promos{display:grid;grid-template-columns:repeat(var(--eng-cols,2),minmax(0,1fr));gap:14px}' +
  '.st-root.eng-root .eng-promo{position:relative;display:flex;min-height:180px;overflow:hidden;border-radius:var(--btn-radius,10px);background:var(--c-card,var(--st-card,#fff));border:1px solid var(--c-border,rgba(0,0,0,.1));overflow-wrap:anywhere}' +
  '.st-root.eng-root .eng-promo-img{background:#eee center/cover no-repeat}' +
  '.st-root.eng-root .eng-promo-copy{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:8px;padding:20px}' +
  '.st-root.eng-root .eng-promo-copy h3{margin:0;font-size:20px;line-height:1.2}' +
  '.st-root.eng-root .eng-promo-copy p{margin:0;opacity:.85}' +
  '.st-root.eng-root .eng-promos[data-style="split"] .eng-promo-img{flex:0 0 42%;order:2}' +
  '.st-root.eng-root .eng-promos[data-style="split"] .eng-promo-copy{flex:1 1 auto}' +
  '.st-root.eng-root .eng-promos[data-style="overlay"] .eng-promo.has-img{min-height:240px;border:0;color:#fff;align-items:flex-end}' +
  '.st-root.eng-root .eng-promos[data-style="overlay"] .eng-promo.has-img .eng-promo-img{position:absolute;inset:0}' +
  '.st-root.eng-root .eng-promos[data-style="overlay"] .eng-promo.has-img::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 30%,rgba(0,0,0,.7))}' +
  '.st-root.eng-root .eng-promos[data-style="overlay"] .eng-promo.has-img .eng-promo-copy{position:relative;z-index:1;justify-content:flex-end}' +
  '.st-root.eng-root .eng-promos[data-style="overlay"] .eng-promo.has-img .eyebrow{color:#fff}' +
  '@container store (max-width: 640px){.st-root.eng-root .eng-promos-block{padding:0 16px}.st-root.eng-root .eng-promos{grid-template-columns:minmax(0,1fr)}.st-root.eng-root .eng-promos[data-style="split"] .eng-promo-img{flex-basis:38%}}' +
  '.st-root.eng-root .eng-sec--full .eng-promos-block{padding-left:0;padding-right:0}' +
  // Emoji category tiles: the emoji fills the tile mark.
  '.st-root.eng-root .catMark.catEmoji{font-family:inherit;font-size:52px;line-height:1}' +
  // Category shelves: one rail per category, stacked.
  '.st-root.eng-root .eng-shelves{display:flex;flex-direction:column;gap:28px}' +
  // Header category chips: a scrolling pill row under the header row.
  '.st-root.eng-root .eng-chips{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding:8px 30px 10px}' +
  '.st-root.eng-root .eng-chips::-webkit-scrollbar{display:none}' +
  '.st-root.eng-root .eng-chips button{flex:0 0 auto;border:1px solid var(--st-line,rgba(0,0,0,.15));background:var(--st-card,#fff);color:var(--text);border-radius:999px;padding:6px 14px;font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer}' +
  '.st-root.eng-root .eng-chips button.on{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}' +
  '@container store (max-width: 640px){.st-root.eng-root .eng-chips{padding:6px 16px 8px}}' +
  // Scrolling announcement: two copies of the items loop; paused on hover and under reduced motion.
  '.st-root.eng-root a.eng-announce{text-decoration:none;color:inherit;display:flex}' +
  '.st-root.eng-root .eng-announce{padding-left:0;padding-right:0}' +
  '.st-root.eng-root .eng-announce-scroll{overflow:hidden;width:100%}' +
  '.st-root.eng-root .eng-announce-track{display:flex;width:max-content;animation:eng-announce 30s linear infinite}' +
  '.st-root.eng-root .eng-announce:hover .eng-announce-track{animation-play-state:paused}' +
  '.st-root.eng-root .eng-announce-run{display:flex;flex:0 0 auto}' +
  '.st-root.eng-root .eng-announce-run span{white-space:nowrap;padding:0 28px}' +
  '@keyframes eng-announce{to{transform:translateX(-50%)}}' +
  '@media (prefers-reduced-motion: reduce){.st-root.eng-root .eng-announce-track{animation:none}}' +
  // Editor mode: an empty section stays visible and clickable, with a placeholder naming its type.
  // Prefixed with the root classes to outrank the display:none rules above; separate rules as above.
  '.st-root.eng-root.eng-editor .eng-sec:empty{display:block;min-height:48px}' +
  '.st-root.eng-root.eng-editor .eng-sec:not(:has(>:not(style))){display:block;min-height:48px}' +
  '.st-root.eng-root.eng-editor .eng-sec:empty::after{content:attr(data-section-type) " (nothing to show yet)";display:block;padding:14px 16px;font-size:13px;color:#6b7280;text-align:center}' +
  '.st-root.eng-root.eng-editor .eng-sec:not(:has(>:not(style)))::after{content:attr(data-section-type) " (nothing to show yet)";display:block;padding:14px 16px;font-size:13px;color:#6b7280;text-align:center}';

function focusSearch() {
  const input = document.getElementById('store-search') as HTMLInputElement | null;
  if (!input) return;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  input.focus();
}

/** Scheme 6 as variables the Grocery layer paints its "deep" promo cards with. */
function deepSchemeVars(settings: ThemeRow['data']['settings']): Record<string, string> {
  const deep = settings.color_schemes?.find((s) => s.id === 'scheme-6');
  if (!deep) return {};
  return {
    '--eng-deep-bg': deep.background,
    '--eng-deep-text': deep.text,
    '--eng-deep-accent': deep.accent,
    '--eng-deep-btn-text': deep.button_text,
  };
}

/**
 * Storefront chrome for an engine theme: the Studio root classes, the theme's variables
 * (computed on the server and passed as `rootStyle`), store-wide CSS, cart drawer and phone nav.
 */
export function EngineShell({
  theme,
  subdomain,
  preview,
  editor = false,
  rootStyle,
  header,
  footer,
  children,
}: {
  /** Only `data.settings` is read; the server sends the theme without its templates. */
  theme: ThemeRow;
  subdomain: string;
  preview: boolean;
  /** Studio 2 editor mode: adds `eng-editor` (empty-section placeholders). */
  editor?: boolean;
  rootStyle: Record<string, string | number | undefined>;
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const settings = theme.data.settings;
  const { cartCount, branches, selectedBranchId, setEngineActive } = useStore();
  const pathname = usePathname();
  const [cartOpen, setCartOpen] = useState(false);
  const openCart = useCallback(() => setCartOpen(true), []);
  const ctx = useMemo(() => ({ openCart }), [openCart]);
  const root = engineRootClass({
    preset: theme.preset,
    phoneKit: settings.phone_kit === true,
    editor,
    schemeBackground: settings.color_schemes?.[0]?.background,
  });
  const { kit, quick } = root;
  const cardLook = useMemo(() => ({ quick, phoneKit: kit }), [quick, kit]);
  const storeCss = useMemo(() => previewStoreCss(settings.custom_css, '.eng-root'), [settings.custom_css]);

  // In a theme preview, a plain store link (menu, footer, pill) gets the preview params before the browser follows it,
  // so the visitor stays in the theme being previewed.
  useEffect(() => {
    if (!preview) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement) || a.origin !== window.location.origin) return;
      const raw = a.getAttribute('href') ?? '';
      const next = withPreviewParams(window.location.search, raw);
      if (next !== raw) a.setAttribute('href', next);
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('auxclick', onClick, true);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('auxclick', onClick, true);
    };
  }, [preview]);

  // The engine renders this page: the old store theme's CSS, font and favicon stay off (D11).
  useEffect(() => {
    setEngineActive(true);
    return () => setEngineActive(false);
  }, [setEngineActive]);

  // `#catalog` / `#st-categories` in the URL (phone nav, links from other pages) have no element of that
  // id on engine pages; scroll to the first section anchor of that kind instead (D12).
  useEffect(() => {
    const followHash = () => {
      let id = '';
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (id && !document.getElementById(id)) findAnchor(document, id)?.scrollIntoView({ block: 'start' });
    };
    followHash();
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);

  // Quick's Categories tab: on the home page it asks for the category view (an event), elsewhere it opens
  // /?browse=categories. Engine pages have no category view, so both scroll to the first category grid.
  useEffect(() => {
    if (!quick) return;
    const toCategories = () => findAnchor(document, 'st-categories')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (new URLSearchParams(window.location.search).get('browse') === 'categories') toCategories();
    window.addEventListener(BROWSE_CATEGORIES_EVENT, toCategories);
    return () => window.removeEventListener(BROWSE_CATEGORIES_EVENT, toCategories);
  }, [quick]);

  const faviconUrl = settings.favicon_url;
  useEffect(() => {
    setStoreFavicon(faviconUrl || null);
    // Leaving the engine page: drop ours; StoreThemeEffects applies the old theme's again.
    return () => setStoreFavicon(null);
  }, [faviconUrl]);

  const hideCartBar = pathname === '/checkout' || pathname === '/cart';
  const branch = branches.find((b) => b.id === selectedBranchId) ?? (branches.length === 1 ? branches[0] : undefined);
  const freeAbove = branch?.free_delivery_above ?? null;
  // Quick mounts its own cart bar (always, as the old Quick shell did); the kit bar is for the other presets.
  const showKitBar = !quick && kit && !hideCartBar && cartCount > 0;
  const deepVars = useMemo(() => deepSchemeVars(settings), [settings]);

  return (
    <EngineCartContext.Provider value={ctx}>
      <EngineCardContext.Provider value={cardLook}>
      <div
        className={root.className}
        style={{ minHeight: '100vh', ...deepVars, ...rootStyle } as CSSProperties}
        data-store={subdomain}
        data-card={settings.card_style}
      >
        <style dangerouslySetInnerHTML={{ __html: THEME_RULES }} />
        {/* Rebuilt rule by rule by previewStoreCss: brace-balanced, `<` removed, confined to .eng-root. */}
        {storeCss ? <style dangerouslySetInnerHTML={{ __html: storeCss }} /> : null}
        <div className="st-sticky st-cq">{header}</div>
        {quick ? (
          // Quick's shell (D29): qk-main leaves room for the cart bar and tabs; noBar on cart and checkout.
          <main className={hideCartBar ? 'qk-main noBar' : 'qk-main'}>{children}</main>
        ) : (
          <main
            className={[
              'pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-10',
              showKitBar ? 'qk-kitRoom' : '',
            ].join(' ')}
          >
            {children}
          </main>
        )}
        <div className="st-cq">{footer}</div>
        {quick ? (
          <>
            {/* Not inside .qk-kit: Quick's bar shows on every width (it hides itself when the cart is empty). */}
            {hideCartBar ? null : <QuickCartBar freeAbove={freeAbove} onCart={openCart} />}
            <QuickTabs onSearch={focusSearch} onCart={openCart} />
          </>
        ) : (
          <StoreMobileNav onSearch={focusSearch} onCart={openCart} />
        )}
        {showKitBar ? (
          <div className="qk-kit">
            <QuickCartBar freeAbove={freeAbove} onCart={openCart} />
          </div>
        ) : null}
        <StoreCartDrawer
          open={cartOpen}
          onClose={() => setCartOpen(false)}
          onCheckout={() => {
            setCartOpen(false);
            window.location.href = '/checkout';
          }}
        />
        {preview ? (
          <div
            role="status"
            className="pointer-events-none fixed bottom-3 left-3 z-[60] rounded-full bg-black/80 px-3 py-1 text-xs font-semibold text-white shadow-lg"
          >
            Preview
          </div>
        ) : null}
      </div>
      </EngineCardContext.Provider>
    </EngineCartContext.Provider>
  );
}
