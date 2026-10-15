import { NextResponse } from 'next/server';
import { loadPricingCatalog } from '@/lib/subscription/pricing-catalog';

export const dynamic = 'force-dynamic';

/** GET /api/public/pricing — plans, features and limits for the marketing pricing section. */
export async function GET() {
  try {
    const catalog = await loadPricingCatalog();
    return NextResponse.json(catalog, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } });
  } catch (error) {
    console.error('Error loading pricing catalog:', error);
    return NextResponse.json({ error: 'Failed to load pricing' }, { status: 500 });
  }
}
