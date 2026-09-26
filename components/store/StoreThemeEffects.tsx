'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store/store-context';
import { sanitizeStoreTheme, storeFontStack } from '@/lib/store/store-theme';

export function StoreThemeEffects() {
  const { store } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  useEffect(() => {
    if (!theme.favicon_url) return;
    let link = document.querySelector<HTMLLinkElement>('link[data-store-favicon="1"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.setAttribute('data-store-favicon', '1');
      document.head.appendChild(link);
    }
    link.href = theme.favicon_url;
  }, [theme.favicon_url]);
  return (
    <>
      <style>{`body,.store-root{font-family:${storeFontStack(theme.font_family)}}`}</style>
      {theme.custom_css ? <style data-store-custom-css>{theme.custom_css}</style> : null}
    </>
  );
}
