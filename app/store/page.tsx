import { StoreCatalogView } from '@/components/store/StoreCatalogView';
import { RenderTemplate } from '@/components/store/engine/RenderTemplate';
import { currentStore } from '@/lib/store/current-store';
import { loadEngineHome, type HomeSearchParams } from '@/lib/store/engine/home-page';

export const dynamic = 'force-dynamic';

export default async function StoreHomePage({ searchParams }: { searchParams: HomeSearchParams }) {
  const store = await currentStore();
  const engine = store ? await loadEngineHome(store, searchParams) : null;

  if (!store || !engine) return <StoreCatalogView />;

  return (
    <RenderTemplate store={store} theme={engine.theme} templateKey="home" data={engine.data} preview={engine.preview} />
  );
}
