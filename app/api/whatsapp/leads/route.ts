export const dynamic = 'force-dynamic';

/**
 * GET  /api/whatsapp/leads?type=&stage_id=&source=&owner=&from=&to=&search=&status=&offset=
 *      The Leads page: newest first, 50 per page, agents only see leads they could open.
 * POST /api/whatsapp/leads - { name, phone, source: call | walk_in | manual, note?, stage_id?, owner_id? }
 *      201 { lead } for a new lead; 200 { lead, existing: true } when the number already has an open one.
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { getInboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { PipelineError } from '@/lib/whatsapp/pipeline';
import { LeadError } from '@/lib/leads/core';
import { createManualLead, listLeads, parseLeadFilters } from '@/lib/leads/list';

export const GET = withWhatsAppPremiumApi({ inboxPermission: 'read' }, async ({ request, businessId, userId }) => {
  try {
    const viewer = await getInboxViewer({ businessId, userId });
    const { rows, total } = await listLeads(viewer, parseLeadFilters(new URL(request.url).searchParams));
    return NextResponse.json({ rows, total, is_supervisor: viewer.isSupervisor });
  } catch (error: any) {
    console.error('[leads] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const POST = withWhatsAppPremiumApi({ parseJsonBody: true, inboxPermission: 'update' }, async ({ businessId, userId, body }) => {
  try {
    const b = (body ?? {}) as Record<string, any>;
    const viewer = await getInboxViewer({ businessId, userId });
    const { lead, existing } = await createManualLead(viewer, {
      name: b.name,
      phone: b.phone,
      source: b.source,
      note: b.note,
      stageId: b.stage_id,
      ownerId: b.owner_id,
    });
    return existing ? NextResponse.json({ lead, existing: true }) : NextResponse.json({ lead }, { status: 201 });
  } catch (error: any) {
    if (error instanceof LeadError || error instanceof PipelineError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[leads] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
