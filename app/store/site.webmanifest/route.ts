import { NextRequest, NextResponse } from 'next/server';
import { extractStoreSubdomain } from '@/lib/store/subdomain';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { storeAccent, storeBackground, storeIconUrl } from '@/lib/store/pwa';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const subdomain = extractStoreSubdomain(request.headers.get('host'));
  const store = subdomain ? await resolveStoreBySubdomain(subdomain) : null;
  if (!store) return new NextResponse('Not found', { status: 404 });

  const name = store.name.trim() || store.store_subdomain;
  const shortName = name.length > 12 ? name.split(/\s+/)[0].slice(0, 12) : name;

  return NextResponse.json(
    {
      id: '/',
      name,
      short_name: shortName,
      description: store.store_tagline || `Shop online at ${name}`,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait-primary',
      background_color: storeBackground(store),
      theme_color: storeAccent(store),
      icons: [192, 512].flatMap((size) => [
        { src: storeIconUrl(store, size), sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' },
        { src: storeIconUrl(store, size, true), sizes: `${size}x${size}`, type: 'image/png', purpose: 'maskable' },
      ]),
    },
    {
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': 'no-cache',
      },
    },
  );
}
