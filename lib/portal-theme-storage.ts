import {
  mergePortalTheme,
  portalThemeToCssVars,
  type PortalTheme,
} from '@/lib/portal-theme';

/** Legacy unscoped key — migrated away on successful session fetch. */
export const PORTAL_THEME_LEGACY_KEY = 'portalTheme';

const PORTAL_THEME_CSS_VARS_PREFIX = 'portalThemeCssVars';

export function portalThemeStorageKey(businessId: string): string {
  return `${PORTAL_THEME_LEGACY_KEY}:${businessId}`;
}

export function portalThemeCssVarsStorageKey(businessId: string): string {
  return `${PORTAL_THEME_CSS_VARS_PREFIX}:${businessId}`;
}

export function readBusinessIdFromClientStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const storedBusiness = localStorage.getItem('business');
    if (storedBusiness) {
      const id = JSON.parse(storedBusiness)?.id;
      if (typeof id === 'string' && id) return id;
    }
    const direct = localStorage.getItem('businessId');
    if (direct) return direct;
  } catch {
    /* ignore */
  }
  return null;
}

export function readCachedPortalThemeFromClientStorage(): PortalTheme | null {
  if (typeof window === 'undefined') return null;
  try {
    const bizId = readBusinessIdFromClientStorage();
    const rawTheme = bizId
      ? localStorage.getItem(portalThemeStorageKey(bizId))
      : localStorage.getItem(PORTAL_THEME_LEGACY_KEY);
    if (!rawTheme) return null;
    return mergePortalTheme(JSON.parse(rawTheme));
  } catch {
    return null;
  }
}

export function persistPortalThemeToClientStorage(theme: PortalTheme, businessId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(portalThemeStorageKey(businessId), JSON.stringify(theme));
  localStorage.setItem(
    portalThemeCssVarsStorageKey(businessId),
    JSON.stringify(portalThemeToCssVars(theme))
  );
  localStorage.removeItem(PORTAL_THEME_LEGACY_KEY);
}

export function removeAllPortalThemeClientStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (
        k === PORTAL_THEME_LEGACY_KEY ||
        k.startsWith(`${PORTAL_THEME_LEGACY_KEY}:`) ||
        k.startsWith(`${PORTAL_THEME_CSS_VARS_PREFIX}:`)
      ) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/**
 * Inline script run before React paint — applies cached CSS vars from localStorage.
 * Falls back to primary_hex on legacy cache entries until full vars are backfilled.
 */
export const PORTAL_THEME_BOOT_SCRIPT = `(function(){try{var b=localStorage.getItem('business');var id=null;if(b){try{id=JSON.parse(b).id}catch(e){}}if(!id)id=localStorage.getItem('businessId');if(!id)return;var el=document.documentElement;var r=localStorage.getItem('portalThemeCssVars:'+id);if(r){var v=JSON.parse(r);for(var p in v){if(Object.prototype.hasOwnProperty.call(v,p))el.style.setProperty(p,v[p]);}return;}var tr=localStorage.getItem('portalTheme:'+id)||localStorage.getItem('portalTheme');if(!tr)return;var t=JSON.parse(tr);if(t&&t.primary_hex){el.style.setProperty('--color-primary-500',t.primary_hex);el.style.setProperty('--color-primary-600',t.primary_hex);}if(t&&t.accent_hex){el.style.setProperty('--color-accent-500',t.accent_hex);el.style.setProperty('--color-accent-600',t.accent_hex);}}catch(e){}})();`;
