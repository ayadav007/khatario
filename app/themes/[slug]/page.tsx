import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';
import { ThemeDetail } from '@/components/marketing/themes/ThemeDetail';
import { demoStoreUrl } from '@/lib/store/demo-store-url';
import { catalogTheme } from '@/lib/store/engine/theme-catalog';
import { previewPath } from '@/lib/store/engine/theme-store';

/** A theme with a demo store, or null (Blank and unknown slugs have no page). */
function themeOf(slug: string) {
  const theme = catalogTheme(slug);
  return theme?.demo ? theme : null;
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const theme = themeOf(params.slug);
  if (!theme) return { title: 'Theme not found' };
  return {
    title: { absolute: `${theme.name} theme for online stores | Khatario` },
    description: theme.about,
    alternates: { canonical: `/themes/${theme.slug}` },
  };
}

export default function ThemePage({ params }: { params: { slug: string } }) {
  const theme = themeOf(params.slug);
  if (!theme?.demo) notFound();
  const h = headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'khatario.com';
  const proto = h.get('x-forwarded-proto') || 'https';
  const { subdomain, catalog } = theme.demo;
  const url = (page: 'home' | 'catalog' | 'product') => demoStoreUrl(host, proto, subdomain, previewPath(page, catalog), true);
  return (
    <div className="min-h-screen bg-white">
      <MarketingSiteHeader />
      <main>
        <ThemeDetail
          theme={theme}
          urls={{ home: url('home'), catalog: url('catalog'), product: url('product') }}
          open={demoStoreUrl(host, proto, subdomain, '/', false)}
        />
      </main>
    </div>
  );
}
