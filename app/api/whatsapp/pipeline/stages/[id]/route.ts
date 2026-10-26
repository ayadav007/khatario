export const dynamic = 'force-dynamic';

/**
 * PATCH  /api/whatsapp/pipeline/stages/:id              - { name?, color?, kind? }
 * DELETE /api/whatsapp/pipeline/stages/:id?move_to=<id> - moves its chats first (off the board without move_to)
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { deleteStage, PipelineError, updateStage } from '@/lib/whatsapp/pipeline';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(error: any, label: string) {
  if (error instanceof PipelineError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(`[pipeline stage] ${label} error:`, error);
  return NextResponse.json({ error: error.message }, { status: 500 });
}

export const PATCH = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true, managePermission: true },
  async ({ params, businessId, body }) => {
    try {
      if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
      const { name, color, kind } = (body ?? {}) as Record<string, unknown>;
      return NextResponse.json({ stage: await updateStage(businessId, params.id, { name, color, kind }) });
    } catch (error: any) {
      return errorResponse(error, 'PATCH');
    }
  },
);

export const DELETE = withWhatsAppPremiumApi<{ id: string }>({ managePermission: true }, async ({ params, request, businessId }) => {
  try {
    if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    const moveTo = new URL(request.url).searchParams.get('move_to');
    if (moveTo && !UUID_RE.test(moveTo)) return NextResponse.json({ error: 'Pick another stage' }, { status: 400 });
    await deleteStage(businessId, params.id, moveTo || null);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error, 'DELETE');
  }
});
