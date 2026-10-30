import { notFound, redirect } from 'next/navigation';
import { StoreCatalogView } from '@/components/store/StoreCatalogView';
import { RenderTemplate } from '@/components/store/engine/RenderTemplate';
import { currentStoreForPreview } from '@/lib/store/current-store';
import { loadEngineHome, type HomeSearchParams } from '@/lib/store/engine/home-page';
import { catalogRedirect } from '@/lib/store/engine/links';
import { hasEnabledSection, searchString } from '@/lib/store/engine/page-loader';

export const dynamic = 'force-dynamic';

function param(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : null;
}

export default async function StoreHomePage({ searchParams }: { searchParams: HomeSearchParams }) {
  // A store that is not launched yet resolves only for a verified theme preview (D10)...
  const resolved = await currentStoreForPreview(param(searchParams.preview_theme), param(searchParams.pt));
  const store = resolved?.store ?? null;
  const engine = store ? await loadEngineHome(store, searchParams) : null;
  // ...and then renders only that preview, never as a normal storefront.
  if (resolved?.offline && !engine?.preview) notFound();

  if (!store || !engine) return <StoreCatalogView />;

  // D14: browsing (`cat`, `q`) moves to the catalog page, unless the theme's catalog is empty (D15),
  // whose fallback is this page's narrowed grid.
  if (hasEnabledSection(engine.theme.data.templates.catalog)) {
    const to = catalogRedirect(true, '/', searchString(searchParams));
    if (to) redirect(to);
  }

  return (
    <RenderTemplate
      store={store}
      theme={engine.theme}
      templateKey="home"
      data={engine.data}
      preview={engine.preview}
      editor={engine.editor}
    />
  );
}
