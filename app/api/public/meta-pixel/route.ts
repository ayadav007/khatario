import { NextResponse } from 'next/server';
import { loadMarketingPixelId } from '@/lib/marketing/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pixelId = await loadMarketingPixelId();
  return NextResponse.json({ pixel_id: pixelId || null });
}
