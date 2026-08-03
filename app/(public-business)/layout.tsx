import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
  },
};

export default function PublicBusinessLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
