import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Fraunces, Inter, Nunito, Playfair_Display, Outfit, Cormorant_Garamond, Source_Serif_4 } from 'next/font/google';
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
    <div className={`${fraunces.variable} ${nunito.variable} ${playfair.variable} ${outfit.variable} ${inter.variable} ${cormorant.variable} ${sourceSerif.variable} store-root`}>
      <StoreApp subdomain={subdomain}>{children}</StoreApp>
    </div>
  );
}
