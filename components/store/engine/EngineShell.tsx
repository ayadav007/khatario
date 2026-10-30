'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { ThemeRow } from '@/lib/store/engine/types';
import { useStore } from '@/lib/store/store-context';
import { previewStoreCss } from '@/lib/store/section-css';
import { setStoreFavicon } from '@/lib/store/store-favicon';
import { findAnchor } from '@/lib/store/engine/anchors';
import { StoreCartDrawer } from '../StoreCartDrawer';
import { StoreMobileNav } from '../StoreMobileNav';
import { QuickCartBar } from '../quick-theme/QuickChrome';
import '../phone-kit.css';
import '../studio-theme/studio-theme.css';

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
  // Image with text uses an h2 in the hero markup (the page's h1 belongs to the slideshow).
  '.st-root.eng-root .heroCopy .eng-heroTitle{font-size:clamp(24px,5cqi,40px);line-height:1.1;margin:12px 0;font-weight:700;overflow-wrap:anywhere}' +
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
  const storeCss = useMemo(() => previewStoreCss(settings.custom_css, '.eng-root'), [settings.custom_css]);

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

  const faviconUrl = settings.favicon_url;
  useEffect(() => {
    setStoreFavicon(faviconUrl || null);
    // Leaving the engine page: drop ours; StoreThemeEffects applies the old theme's again.
    return () => setStoreFavicon(null);
  }, [faviconUrl]);

  const kit = settings.phone_kit;
  const hideCartBar = pathname === '/checkout' || pathname === '/cart';
  const branch = branches.find((b) => b.id === selectedBranchId) ?? (branches.length === 1 ? branches[0] : undefined);
  const freeAbove = branch?.free_delivery_above ?? null;
  const showKitBar = kit && !hideCartBar && cartCount > 0;

  return (
    <EngineCartContext.Provider value={ctx}>
      <div
        className={`st-root store-studio st-cq eng-root${kit ? ' phone-kit' : ''}${editor ? ' eng-editor' : ''}`}
        style={{ minHeight: '100vh', ...rootStyle } as CSSProperties}
        data-store={subdomain}
      >
        <style dangerouslySetInnerHTML={{ __html: THEME_RULES }} />
        {/* Rebuilt rule by rule by previewStoreCss: brace-balanced, `<` removed, confined to .eng-root. */}
        {storeCss ? <style dangerouslySetInnerHTML={{ __html: storeCss }} /> : null}
        <div className="st-sticky st-cq">{header}</div>
        <main
          className={[
            'pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-10',
            showKitBar ? 'qk-kitRoom' : '',
          ].join(' ')}
        >
          {children}
        </main>
        <div className="st-cq">{footer}</div>
        <StoreMobileNav onSearch={focusSearch} onCart={openCart} />
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
    </EngineCartContext.Provider>
  );
}
