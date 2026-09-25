import type { Metadata } from 'next';
import { Fraunces, IBM_Plex_Sans, Noto_Sans_Devanagari } from 'next/font/google';
import { StoreApp } from '@/components/store/StoreApp';

const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-chowk-display',
  display: 'swap',
});

const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-chowk-ui',
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
    <div className={`${fraunces.variable} ${plex.variable} ${notoDevanagari.variable}`}>
      <StoreApp>{children}</StoreApp>
    </div>
  );
}
