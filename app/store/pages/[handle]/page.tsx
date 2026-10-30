import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { RenderTemplate } from '@/components/store/engine/RenderTemplate';
import { currentStoreForPreview } from '@/lib/store/current-store';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { first, loadEnginePage, type HomeSearchParams } from '@/lib/store/engine/page-loader';
import { pageHandle, pageKey } from '@/lib/store/engine/shared';

export const dynamic = 'force-dynamic';

type Props = { params: { handle: string }; searchParams: HomeSearchParams };

/**
 * The engine page for one handle. Cached per request on primitive keys (the store object comes from the
 * cached currentStoreForPreview), so the page and generateMetadata share one load.
 */
const loadCustomPage = cache(
  (store: StoreBusinessContext, handle: string, previewTheme: string | null, pt: string | null, editor: string | null) =>
    loadEnginePage(
      store,
      { preview_theme: previewTheme ?? undefined, pt: pt ?? undefined, editor: editor ?? undefined },
      pageKey(handle),
    ),
);

async function resolve(handle: string, searchParams: HomeSearchParams) {
  // An invalid or reserved handle is never a custom page.
  if (!pageHandle(pageKey(handle))) return null;
  const resolved = await currentStoreForPreview(first(searchParams.preview_theme), first(searchParams.pt));
  const store = resolved?.store;
  if (!store) return null;
  const engine = await loadCustomPage(
    store,
    handle,
    first(searchParams.preview_theme),
    first(searchParams.pt),
    first(searchParams.editor),
  );
  // A store that is not launched yet renders only a verified theme preview (D10).
  if (!engine || !engine.template || (resolved.offline && !engine.preview)) return null;
  return { store, engine };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const found = await resolve(params.handle, searchParams);
  if (!found) return { title: 'Page not found' };
  const t = found.engine.template!;
  // Absolute: the store layout's title template would add the store name a second time.
  const title = { absolute: t.seo_title || t.title || found.store.name };
  return t.seo_description ? { title, description: t.seo_description } : { title };
}

/** A merchant custom page (`page.<handle>` template). It has no classic page, so an absent template is a 404. */
export default async function StoreCustomPage({ params, searchParams }: Props) {
  const found = await resolve(params.handle, searchParams);
  if (!found) notFound();
  const { store, engine } = found;
  return (
    <RenderTemplate
      store={store}
      theme={engine.theme}
      templateKey={pageKey(params.handle)}
      data={engine.data}
      preview={engine.preview}
      editor={engine.editor}
    />
  );
}
