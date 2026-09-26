import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  const staging = appUrl.includes('staging.') || appUrl.includes('localhost');
  const name = staging ? 'Khatario Admin (Staging)' : 'Khatario Admin';
  const shortName = staging ? 'Khatario STG' : 'Khatario Admin';
  const origin = appUrl || '';
  const icon = [
    {
      src: '/icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'maskable',
    },
    {
      src: '/icons/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icons/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ];

  return NextResponse.json(
    {
      id: origin ? `${origin}/admin` : '/admin',
      name,
      short_name: shortName,
      description: 'Khatario platform operator console',
      start_url: '/admin',
      scope: '/admin',
      display: 'standalone',
      background_color: '#111827',
      theme_color: '#4f46e5',
      orientation: 'portrait-primary',
      icons: icon,
    },
    {
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': 'no-store',
      },
    },
  );
}
