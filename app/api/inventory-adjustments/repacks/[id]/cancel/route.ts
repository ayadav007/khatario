export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { cancelRepack, getRepack } from '@/lib/repack-service';
import { repackContext, repackErrorResponse, UUID_RE } from '@/lib/repack-route';

/** POST /api/inventory-adjustments/repacks/[id]/cancel: puts both items back. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await repackContext(request, 'create');
  if (ctx instanceof NextResponse) return ctx;
  try {
    if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Repack not found' }, { status: 404 });
    await cancelRepack(ctx.businessId, ctx.userId, params.id);
    return NextResponse.json({ success: true, repack: await getRepack(ctx.businessId, params.id) });
  } catch (error) {
    return repackErrorResponse(error, 'Failed to cancel the repack');
  }
}
