import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { parseRatingAvg, parseRatingCount, storeProductImages } from '@/lib/store/map-store-product';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { subdomain: string; id: string } },
) {
  const td = request.nextUrl.searchParams.get('td');
  const store = await resolveStoreBySubdomain(params.subdomain, { allowOffline: Boolean(td) });
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  if (store.is_demo) {
    const { themeDemoProducts, themeDemoPack } = await import('@/lib/store/theme-demo');
    const product = themeDemoProducts(themeDemoPack(params.subdomain)).find((p) => p.id === params.id);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json(product);
  }

  const item = await queryOne<Record<string, unknown>>(
    `SELECT i.id, i.name, i.code, i.description,
            i.selling_price::text, i.mrp::text, i.unit, i.image_url, i.gallery_urls,
            i.seo_title, i.seo_description, i.seo_image_url,
            i.category_id, c.name AS category_name,
            COALESCE(i.current_stock, 0)::text AS current_stock,
            COALESCE(i.has_variants, false) AS has_variants,
            i.tax_rate::text,
            COALESCE(i.gst_included, false) AS gst_included,
            COALESCE((
              SELECT AVG(r.rating)::text FROM store_item_ratings r
              WHERE r.item_id = i.id AND r.business_id = i.business_id
            ), '0') AS rating_avg,
            COALESCE((
              SELECT COUNT(*)::text FROM store_item_ratings r
              WHERE r.item_id = i.id AND r.business_id = i.business_id
            ), '0') AS rating_count
     FROM items i
     LEFT JOIN categories c ON c.id = i.category_id
     WHERE i.id = $1 AND i.business_id = $2 AND i.show_in_store = true
       AND (i.is_active IS NULL OR i.is_active = true) AND i.deleted_at IS NULL`,
    [params.id, store.business_id],
  );
  if (!item) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const variants = await queryRows<{
    id: string;
    variant_name: string;
    selling_price: string;
    current_stock: string;
    attributes: unknown;
  }>(
    `SELECT id, variant_name, selling_price::text, COALESCE(current_stock, 0)::text AS current_stock, attributes
     FROM item_variants WHERE item_id = $1`,
    [params.id],
  );

  return NextResponse.json({
    ...item,
    selling_price: parseFloat(item.selling_price as string) || 0,
    mrp: item.mrp ? parseFloat(item.mrp as string) : null,
    current_stock: parseFloat(item.current_stock as string) || 0,
    tax_rate: parseFloat(item.tax_rate as string) || 0,
    images: storeProductImages(item.image_url, item.gallery_urls),
    seo_title: (item.seo_title as string) || null,
    seo_description: (item.seo_description as string) || null,
    seo_image_url: (item.seo_image_url as string) || null,
    rating_avg: parseRatingAvg(item.rating_avg),
    rating_count: parseRatingCount(item.rating_count),
    variants: variants.map((v) => ({
      ...v,
      selling_price: parseFloat(v.selling_price) || 0,
      current_stock: parseFloat(v.current_stock) || 0,
    })),
  });
}
