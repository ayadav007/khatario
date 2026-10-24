import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { cache } from 'react';
import { Fraunces, Inter, Nunito, Playfair_Display, Outfit, Cormorant_Garamond, Source_Serif_4 } from 'next/font/google';
import { StoreApp } from '@/components/store/StoreApp';
import { extractStoreSubdomain } from '@/lib/store/subdomain';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { storeAccent, storeIconUrl } from '@/lib/store/pwa';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-khatario-ui',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-store-fraunces',
  display: 'swap',
});

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-store-nunito',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-store-playfair',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-store-outfit',
  display: 'swap',
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-store-cormorant',
  display: 'swap',
});

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-store-source-serif',
  display: 'swap',
});

const currentStore = cache(async () => {
  const subdomain = extractStoreSubdomain(headers().get('host'));
  return subdomain ? resolveStoreBySubdomain(subdomain) : null;
});

export async function generateMetadata(): Promise<Metadata> {
  const store = await currentStore();
  if (!store) return { robots: { index: true, follow: true } };
  const name = store.name.trim() || store.store_subdomain;
  const description = store.store_tagline || `Shop online at ${name}`;
  return {
    applicationName: name,
    title: { default: name, template: `%s | ${name}` },
    description,
    robots: { index: true, follow: true },
    manifest: '/site.webmanifest',
    icons: {
      icon: [{ url: storeIconUrl(store, 192), sizes: '192x192', type: 'image/png' }],
      apple: [{ url: storeIconUrl(store, 180), sizes: '180x180', type: 'image/png' }],
    },
    appleWebApp: { capable: true, title: name, statusBarStyle: 'default' },
    openGraph: { type: 'website', siteName: name, title: name, description },
    twitter: { card: 'summary', title: name, description },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const store = await currentStore();
  return { themeColor: store ? storeAccent(store) : '#0d9488' };
}

export default function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const subdomain = extractStoreSubdomain(headers().get('host'));
  return (
    <div className={`${fraunces.variable} ${nunito.variable} ${playfair.variable} ${outfit.variable} ${inter.variable} ${cormorant.variable} ${sourceSerif.variable} store-root`}>
      <StoreApp subdomain={subdomain}>{children}</StoreApp>
    </div>
  );
}
