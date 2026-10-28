export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getRepack } from '@/lib/repack-service';
import { repackContext, repackErrorResponse, UUID_RE } from '@/lib/repack-route';

/** GET /api/inventory-adjustments/repacks/[id] */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await repackContext(request, 'read');
  if (ctx instanceof NextResponse) return ctx;
  try {
    const repack = UUID_RE.test(params.id) ? await getRepack(ctx.businessId, params.id) : null;
    if (!repack) return NextResponse.json({ error: 'Repack not found' }, { status: 404 });
    return NextResponse.json({ repack });
  } catch (error) {
    return repackErrorResponse(error, 'Failed to load the repack');
  }
}
