import { notFound } from 'next/navigation';
import { RenderTemplate } from '@/components/store/engine/RenderTemplate';
import { currentStoreForPreview } from '@/lib/store/current-store';
import { hasEnabledSection, loadEnginePage, type HomeSearchParams } from '@/lib/store/engine/page-loader';
import ClassicProductPage from './ClassicProductPage';

export const dynamic = 'force-dynamic';

function param(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : null;
}

export default async function StoreProductPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: HomeSearchParams;
}) {
  // A store that is not launched yet resolves only for a verified theme preview (D10)...
  const resolved = await currentStoreForPreview(param(searchParams.preview_theme), param(searchParams.pt));
  const store = resolved?.store ?? null;
  const engine = store ? await loadEnginePage(store, searchParams, 'product') : null;
  // ...and then renders only that preview, never as a normal storefront.
  if (resolved?.offline && !engine?.preview) notFound();

  // D15: a product template with no enabled section renders the classic page.
  if (!store || !engine || !hasEnabledSection(engine.template)) return <ClassicProductPage />;

  return (
    <RenderTemplate
      store={store}
      theme={engine.theme}
      templateKey="product"
      data={engine.data}
      preview={engine.preview}
      editor={engine.editor}
      route={{ productId: params.id }}
    />
  );
}
