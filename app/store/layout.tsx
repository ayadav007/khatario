import type { Metadata } from 'next';
import { Fraunces, Nunito, Noto_Sans_Devanagari, Playfair_Display, Outfit } from 'next/font/google';
import { StoreApp } from '@/components/store/StoreApp';

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
  return (
    <div className={`${fraunces.variable} ${nunito.variable} ${notoDevanagari.variable} ${playfair.variable} ${outfit.variable}`}>
      <StoreApp>{children}</StoreApp>
    </div>
  );
}
