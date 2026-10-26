export const dynamic = 'force-dynamic';

/**
 * GET  /api/whatsapp/pipeline/stages - stages in board order (creates the defaults once)
 * POST /api/whatsapp/pipeline/stages - { name, color?, kind? }
 * PUT  /api/whatsapp/pipeline/stages - { order: [stageId, ...] } with every stage once
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { createStage, ensureStages, PipelineError, reorderStages } from '@/lib/whatsapp/pipeline';

function errorResponse(error: any, label: string) {
  if (error instanceof PipelineError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(`[pipeline stages] ${label} error:`, error);
  return NextResponse.json({ error: error.message }, { status: 500 });
}

export const GET = withWhatsAppPremiumApi({ inboxPermission: 'read' }, async ({ businessId }) => {
  try {
    return NextResponse.json({ stages: await ensureStages(businessId) });
  } catch (error: any) {
    return errorResponse(error, 'GET');
  }
});

export const POST = withWhatsAppPremiumApi({ parseJsonBody: true, managePermission: true }, async ({ businessId, body }) => {
  try {
    const { name, color, kind } = (body ?? {}) as Record<string, unknown>;
    return NextResponse.json({ stage: await createStage(businessId, { name, color, kind }) }, { status: 201 });
  } catch (error: any) {
    return errorResponse(error, 'POST');
  }
});

export const PUT = withWhatsAppPremiumApi({ parseJsonBody: true, managePermission: 'update' }, async ({ businessId, body }) => {
  try {
    const { order } = (body ?? {}) as Record<string, unknown>;
    return NextResponse.json({ stages: await reorderStages(businessId, order) });
  } catch (error: any) {
    return errorResponse(error, 'PUT');
  }
});
