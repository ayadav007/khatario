import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import {
  Fraunces,
  Inter,
  Nunito,
  Playfair_Display,
  Outfit,
  Cormorant_Garamond,
  Source_Serif_4,
  Cinzel,
  Newsreader,
  Manrope,
  DM_Serif_Display,
  Lora,
  Poppins,
} from 'next/font/google';
import { StoreApp } from '@/components/store/StoreApp';
import { extractStoreSubdomain } from '@/lib/store/subdomain';
import { currentStore } from '@/lib/store/current-store';
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
  preload: false,
});

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-store-nunito',
  display: 'swap',
  preload: false,
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-store-playfair',
  display: 'swap',
  preload: false,
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-store-outfit',
  display: 'swap',
  preload: false,
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-store-cormorant',
  display: 'swap',
  preload: false,
});

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-store-source-serif',
  display: 'swap',
  preload: false,
});

const cinzel = Cinzel({
  subsets: ['latin'],
  variable: '--font-store-cinzel',
  display: 'swap',
  preload: false,
});

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-store-newsreader',
  display: 'swap',
  preload: false,
});

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-store-manrope',
  display: 'swap',
  preload: false,
});

const dmSerif = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-store-dm-serif',
  display: 'swap',
  preload: false,
});

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-store-lora',
  display: 'swap',
  preload: false,
});

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-store-poppins',
  display: 'swap',
  preload: false,
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
    <div className={`${fraunces.variable} ${nunito.variable} ${playfair.variable} ${outfit.variable} ${inter.variable} ${cormorant.variable} ${sourceSerif.variable} ${cinzel.variable} ${newsreader.variable} ${manrope.variable} ${dmSerif.variable} ${lora.variable} ${poppins.variable} store-root`}>
      <StoreApp subdomain={subdomain}>{children}</StoreApp>
    </div>
  );
}
