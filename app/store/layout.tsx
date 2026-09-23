import type { Metadata } from 'next';
import { StoreApp } from '@/components/store/StoreApp';

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <StoreApp>{children}</StoreApp>;
}
