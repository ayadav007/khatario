import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Fraunces, Inter, Nunito, Noto_Sans_Devanagari, Playfair_Display, Outfit, Cormorant_Garamond } from 'next/font/google';
import { StoreApp } from '@/components/store/StoreApp';
import { extractStoreSubdomain } from '@/lib/store/subdomain';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-khatario-ui',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-chowk-display',
  display: 'swap',
});

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-chowk-ui',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-atelier-display',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-atelier-ui',
  display: 'swap',
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-noir-display',
  display: 'swap',
});

const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '500', '600'],
  variable: '--font-chowk-devanagari',
  display: 'swap',
});

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const subdomain = extractStoreSubdomain(headers().get('host'));
  return (
    <div className={`${fraunces.variable} ${nunito.variable} ${notoDevanagari.variable} ${playfair.variable} ${outfit.variable} ${inter.variable} ${cormorant.variable} store-root`}>
      <StoreApp subdomain={subdomain}>{children}</StoreApp>
    </div>
  );
}
