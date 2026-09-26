import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { queryOne } from '@/lib/db';
import { extractStoreSubdomain } from '@/lib/store/subdomain';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { resolveItemSeo } from '@/lib/store/item-seo';

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const host = headers().get('host');
  const subdomain = extractStoreSubdomain(host);
  if (!subdomain) return { title: 'Product' };

  const store = await resolveStoreBySubdomain(subdomain);
  if (!store) return { title: 'Product' };

  const proto = headers().get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');
  const pageUrl = `${proto}://${host}/products/${params.id}`;

  if (store.is_demo) {
    const { themeDemoProducts, themeDemoPack } = await import('@/lib/store/theme-demo');
    const product = themeDemoProducts(themeDemoPack(subdomain)).find((p) => p.id === params.id);
    if (!product) return { title: 'Product' };
    const seo = resolveItemSeo(product);
    return {
      title: seo.title,
      description: seo.description,
      openGraph: {
        title: seo.title,
        description: seo.description,
        url: pageUrl,
        images: seo.image ? [{ url: seo.image }] : undefined,
      },
    };
  }

  const item = await queryOne<{
    name: string;
    description: string | null;
    image_url: string | null;
    seo_title: string | null;
    seo_description: string | null;
    seo_image_url: string | null;
  }>(
    `SELECT name, description, image_url, seo_title, seo_description, seo_image_url
     FROM items
     WHERE id = $1 AND business_id = $2 AND show_in_store = true
       AND (is_active IS NULL OR is_active = true) AND deleted_at IS NULL`,
    [params.id, store.business_id],
  );
  if (!item) return { title: store.name };

  const seo = resolveItemSeo(item);
  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: pageUrl },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: pageUrl,
      type: 'website',
      images: seo.image ? [{ url: seo.image }] : undefined,
    },
    twitter: {
      card: seo.image ? 'summary_large_image' : 'summary',
      title: seo.title,
      description: seo.description,
      images: seo.image ? [seo.image] : undefined,
    },
  };
}

export default function StoreProductLayout({ children }: { children: ReactNode }) {
  return children;
}
