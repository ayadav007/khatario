import { NextRequest, NextResponse } from 'next/server';
import { extractStoreSubdomain } from '@/lib/store/subdomain';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { STORE_ICON_SIZES, renderStoreIcon } from '@/lib/store/pwa';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { size: string } }) {
  const size = Number(params.size);
  if (!(STORE_ICON_SIZES as readonly number[]).includes(size)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const subdomain = extractStoreSubdomain(request.headers.get('host'));
  const store = subdomain ? await resolveStoreBySubdomain(subdomain) : null;
  if (!store) return new NextResponse('Not found', { status: 404 });

  const maskable = request.nextUrl.searchParams.get('maskable') === '1';
  const png = await renderStoreIcon(store, size, maskable);

  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      // URLs carry a content version (?v=), so a long cache is safe.
      'Cache-Control': request.nextUrl.searchParams.has('v')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=300',
    },
  });
}
