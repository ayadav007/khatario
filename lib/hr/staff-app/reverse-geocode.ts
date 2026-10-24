/**
 * Address for an office site's coordinates, from OpenStreetMap Nominatim (free, no API key).
 * Nominatim's policy asks for an identifying User-Agent, at most one request a second, and
 * attribution, so lookups are cached and spaced out here and the settings page credits OSM.
 */

const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'Khatario/1.0 (attendance office sites; support@khatario.com)';
const CACHE_MAX = 500;
const MIN_GAP_MS = 1100;

const cache = new Map<string, string | null>();
let lastCall = 0;

/** About 11 m of precision: nearby taps share one lookup. */
function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

export function isValidCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Street-level address, or null when OSM has nothing there. Throws when Nominatim cannot be reached. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = cacheKey(lat, lng);
  if (cache.has(key)) return cache.get(key) ?? null;

  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();

  const url = `${NOMINATIM_REVERSE}?format=jsonv2&zoom=18&addressdetails=0&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = (await res.json().catch(() => null)) as { display_name?: unknown } | null;
  const address = typeof data?.display_name === 'string' && data.display_name.trim() ? data.display_name.trim() : null;

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, address);
  return address;
}

/** OpenStreetMap page centred on the point, with a marker. */
export function osmMapUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}
