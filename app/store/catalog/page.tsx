import type { Metadata } from 'next';
import { EngineCatalogPage, engineCatalogMetadata } from '@/components/store/engine/EngineCatalogPage';
import type { HomeSearchParams } from '@/lib/store/engine/page-loader';

export const dynamic = 'force-dynamic';

export function generateMetadata({ searchParams }: { searchParams: HomeSearchParams }): Promise<Metadata> {
  return engineCatalogMetadata(searchParams, null);
}

/** All products (D14): the engine catalog template, or the classic home's catalog for other stores. */
export default function StoreCatalogPage({ searchParams }: { searchParams: HomeSearchParams }) {
  return <EngineCatalogPage searchParams={searchParams} categoryId={null} />;
}
