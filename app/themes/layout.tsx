import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Online store themes for every business | Khatario' },
  description:
    'Browse Khatario’s online store themes for grocery, fashion, jewellery, electronics and more. See each one live on computer and phone, then apply it to your store.',
  alternates: { canonical: '/themes' },
};

export default function ThemesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
