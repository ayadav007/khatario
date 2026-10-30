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
    if (faviconUrl) setStoreFavicon(faviconUrl);
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
