import { headers } from 'next/headers';
import { ExploreThemesShell } from '@/components/store/library/ExploreThemesShell';
import { ThemeStore } from '@/components/marketing/themes/ThemeStore';
import { demoStoreUrl } from '@/lib/store/demo-store-url';
import { THEME_CATALOG } from '@/lib/store/engine/theme-catalog';
import { themePopularity } from '@/lib/store/engine/theme-popularity';
import { popularityOrder } from '@/lib/store/engine/theme-store';

/**
 * The theme store inside the app (Explore themes in the theme library): the same store as khatario.com/themes, in the
 * app's settings frame, with links that stay in the app and Apply straight to the apply page. Reads no business data.
 */
export default async function ExploreThemesPage() {
  const h = headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'khatario.com';
  const proto = h.get('x-forwarded-proto') || 'https';
  const urls: Record<string, { home: string; phone: string }> = {};
  for (const t of THEME_CATALOG) {
    if (!t.demo) continue;
    const home = demoStoreUrl(host, proto, t.demo.subdomain, '/', true);
    urls[t.slug] = { home, phone: home };
  }
  const popularity = popularityOrder(await themePopularity());
  return (
    <ExploreThemesShell title="Explore themes" back={{ href: '/settings/online-store/themes', label: 'Themes' }}>
      <ThemeStore themes={THEME_CATALOG} urls={urls} popularity={popularity} today={new Date().toISOString().slice(0, 10)} inApp />
    </ExploreThemesShell>
  );
}
