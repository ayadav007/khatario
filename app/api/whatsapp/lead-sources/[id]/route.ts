export const dynamic = 'force-dynamic';

/**
 * PATCH  /api/whatsapp/lead-sources/:id { name?, enabled?, stage_id?, assign_to?, label_ids? }
 * DELETE /api/whatsapp/lead-sources/:id - disconnects IndiaMART or revokes a webhook URL
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { deleteLeadSource, LeadSourceError, updateLeadSource } from '@/lib/whatsapp/lead-sources';

function errorResponse(error: any, label: string) {
  if (error instanceof LeadSourceError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(`[lead source] ${label} error:`, error);
  return NextResponse.json({ error: error.message }, { status: 500 });
}

export const PATCH = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true, managePermission: true },
  async ({ params, businessId, body }) => {
    try {
      const b = (body ?? {}) as Record<string, unknown>;
      const source = await updateLeadSource(businessId, params.id, {
        name: b.name,
        enabled: b.enabled,
        stageId: 'stage_id' in b ? b.stage_id ?? null : undefined,
        assignTo: 'assign_to' in b ? b.assign_to ?? null : undefined,
        labelIds: b.label_ids,
      });
      return NextResponse.json({ source });
    } catch (error: any) {
      return errorResponse(error, 'PATCH');
    }
  },
);

export const DELETE = withWhatsAppPremiumApi<{ id: string }>({ managePermission: true }, async ({ params, businessId }) => {
  try {
    await deleteLeadSource(businessId, params.id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error, 'DELETE');
  }
});
