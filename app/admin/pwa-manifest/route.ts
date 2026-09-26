import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const staging = appUrl.includes('staging.') || appUrl.includes('localhost');
  const name = staging ? 'Khatario Admin (Staging)' : 'Khatario Admin';
  const shortName = staging ? 'Admin STG' : 'Admin';

  return NextResponse.json(
    {
      name,
      short_name: shortName,
      description: 'Khatario platform operator console',
      start_url: '/admin',
      scope: '/admin',
      display: 'standalone',
      background_color: '#111827',
      theme_color: '#4f46e5',
      orientation: 'portrait-primary',
      icons: [
        {
          src: '/icons/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any maskable',
        },
        {
          src: '/icons/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable',
        },
      ],
    },
    {
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': 'no-store',
      },
    },
  );
}
