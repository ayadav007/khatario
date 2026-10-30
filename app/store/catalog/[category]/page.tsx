import type { Metadata } from 'next';
import { EngineCatalogPage, engineCatalogMetadata } from '@/components/store/engine/EngineCatalogPage';
import type { HomeSearchParams } from '@/lib/store/engine/page-loader';

export const dynamic = 'force-dynamic';

type Props = { params: { category: string }; searchParams: HomeSearchParams };

export function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  return engineCatalogMetadata(searchParams, params.category);
}

/** One category's catalog (D14): `[category]` is the category id; the grid is locked to it. */
export default function StoreCategoryCatalogPage({ params, searchParams }: Props) {
  return <EngineCatalogPage searchParams={searchParams} categoryId={params.category} />;
}
