import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Khatario Partners',
  applicationName: 'Khatario Partners',
};

export default function PartnersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
