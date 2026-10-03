import { createHash } from 'crypto';
import sharp from 'sharp';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { DEFAULT_STORE_THEME, chowkOnAccent, storeCanvas } from '@/lib/store/store-theme';

export const STORE_ICON_SIZES = [180, 192, 512] as const;

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

export function storeAccent(store: StoreBusinessContext): string {
  return store.store_theme?.accent ?? DEFAULT_STORE_THEME.accent;
}

export function storeBackground(store: StoreBusinessContext): string {
  return store.store_theme ? storeCanvas(store.store_theme) : '#ffffff';
}

/** Same precedence as the storefront header, then the favicon. */
function storeLogoSource(store: StoreBusinessContext): string {
  return store.store_theme?.logo_url || store.logo_url || store.store_theme?.favicon_url || '';
}

/** Changes whenever the icon would render differently, so installed apps pick up a new logo. */
export function storeIconVersion(store: StoreBusinessContext): string {
  return createHash('sha1')
    .update(`${storeLogoSource(store)}|${store.name}|${storeAccent(store)}`)
    .digest('hex')
    .slice(0, 10);
}

export function storeIconUrl(store: StoreBusinessContext, size: number, maskable = false): string {
  const v = storeIconVersion(store);
  return `/pwa-icon/${size}?v=${v}${maskable ? '&maskable=1' : ''}`;
}

/**
 * Only inline uploads are decoded. Remote logo URLs are merchant-supplied, so they are
 * never fetched server-side; those stores get the initial-letter icon instead.
 */
function decodeDataImage(url: string): Buffer | null {
  const m = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(url);
  return m ? Buffer.from(m[1], 'base64') : null;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function letterIconSvg(store: StoreBusinessContext, size: number, maskable: boolean): string {
  const accent = storeAccent(store);
  const ink = chowkOnAccent(accent);
  const initial = escapeXml((Array.from(store.name.trim())[0] ?? 'S').toUpperCase());
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const fontSize = Math.round(size * (maskable ? 0.42 : 0.55));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${accent}"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Inter, Arial, Helvetica, sans-serif" font-weight="700" font-size="${fontSize}" fill="${ink}">${initial}</text>
</svg>`;
}

/**
 * Square PNG for the home-screen icon. Maskable icons keep the logo inside the
 * centre safe zone because launchers crop them to circles or squircles.
 */
export async function renderStoreIcon(
  store: StoreBusinessContext,
  size: number,
  maskable: boolean,
): Promise<Buffer> {
  const logo = decodeDataImage(storeLogoSource(store));
  if (logo) {
    try {
      const inner = Math.round(size * (maskable ? 0.62 : 0.86));
      const fitted = await sharp(logo, { animated: false })
        .resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toBuffer();
      return await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
        .composite([{ input: fitted, gravity: 'center' }])
        .png()
        .toBuffer();
    } catch {
      // Corrupt or unsupported upload: fall through to the letter icon.
    }
  }
  return sharp(Buffer.from(letterIconSvg(store, size, maskable))).png().toBuffer();
}
