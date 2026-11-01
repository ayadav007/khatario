import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ExploreThemesShell } from '@/components/store/library/ExploreThemesShell';
import { ThemeDetail } from '@/components/marketing/themes/ThemeDetail';
import { demoStoreUrl } from '@/lib/store/demo-store-url';
import { catalogTheme } from '@/lib/store/engine/theme-catalog';
import { previewPath, themeStorePaths } from '@/lib/store/engine/theme-store';

/** One theme's page inside the app: the same live preview and details as /themes/<slug>, in the settings frame. */
export default function ExploreThemePage({ params }: { params: { slug: string } }) {
  const theme = catalogTheme(params.slug);
  if (!theme?.demo) notFound();
  const h = headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'khatario.com';
  const proto = h.get('x-forwarded-proto') || 'https';
  const { subdomain, catalog } = theme.demo;
  const url = (page: 'home' | 'catalog' | 'product') => demoStoreUrl(host, proto, subdomain, previewPath(page, catalog), true);
  return (
    <ExploreThemesShell title={theme.name} back={{ href: themeStorePaths(true).store, label: 'Explore themes' }}>
      <ThemeDetail
        theme={theme}
        urls={{ home: url('home'), catalog: url('catalog'), product: url('product') }}
        open={demoStoreUrl(host, proto, subdomain, '/', false)}
        inApp
      />
    </ExploreThemesShell>
  );
}
