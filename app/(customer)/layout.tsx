import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Minimal layout for public bills and customer portal (no staff app chrome). */
export default function CustomerSurfaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
