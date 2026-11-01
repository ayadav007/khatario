'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store/store-context';
import { setStoreFavicon } from '@/lib/store/store-favicon';
import { storeThemeEffects } from './theme-effects-logic';

export function StoreThemeEffects() {
  const { store, engineActive } = useStore();
  const { fontCss, customCss, faviconUrl } = storeThemeEffects(store?.store_theme, engineActive);
  useEffect(() => {
    // While the engine renders the page, EngineShell owns the favicon.
    if (!engineActive) setStoreFavicon(faviconUrl);
  }, [faviconUrl, engineActive]);
  return (
    <>
      {fontCss ? <style>{fontCss}</style> : null}
      {customCss ? <style data-store-custom-css>{customCss}</style> : null}
    </>
  );
}
