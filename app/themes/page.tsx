import { headers } from 'next/headers';
import Link from 'next/link';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';
import { ThemeStore } from '@/components/marketing/themes/ThemeStore';
import { demoStoreUrl } from '@/lib/store/demo-store-url';
import { THEME_CATALOG } from '@/lib/store/engine/theme-catalog';
import { themePopularity } from '@/lib/store/engine/theme-popularity';
import { popularityOrder } from '@/lib/store/engine/theme-store';

/** The public theme store: every theme drawn live from its demo store (lib/store/engine/demo-stores.ts). */
export default async function ThemesPage() {
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
    <div className="min-h-screen bg-white">
      <MarketingSiteHeader />
      <main>
        <ThemeStore themes={THEME_CATALOG} urls={urls} popularity={popularity} today={new Date().toISOString().slice(0, 10)} />
      </main>
      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-slate-500 sm:px-6 lg:px-8">
          <Link href="/" className="font-medium text-primary-600 hover:text-primary-700">
            Khatario
          </Link>{' '}
          · Online store themes
        </div>
      </footer>
    </div>
  );
}
