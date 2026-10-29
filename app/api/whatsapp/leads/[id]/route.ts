export const dynamic = 'force-dynamic';

/**
 * GET   /api/whatsapp/leads/:id - one lead with its deal, reminders and the number's other enquiries
 * PATCH /api/whatsapp/leads/:id - { stage_id?, deal_value?, expected_close_on?, lost_reason?, owner_id?, contact_name?, note? }
 * A lead the caller cannot see is a 404 for both.
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { getInboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { PipelineError } from '@/lib/whatsapp/pipeline';
import { LeadError, patchLead } from '@/lib/leads/core';
import { loadLeadDetail, parseLeadPatchBody } from '@/lib/leads/list';
import { canViewLead } from '@/lib/leads/visibility';

export const GET = withWhatsAppPremiumApi<{ id: string }>({ inboxPermission: 'read' }, async ({ params, businessId, userId }) => {
  try {
    const viewer = await getInboxViewer({ businessId, userId });
    const lead = await loadLeadDetail(viewer, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    return NextResponse.json({ lead });
  } catch (error: any) {
    console.error('[leads] GET one error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const PATCH = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true, inboxPermission: 'update' },
  async ({ params, businessId, userId, body }) => {
    try {
      const viewer = await getInboxViewer({ businessId, userId });
      if (!(await canViewLead(viewer, params.id))) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
      const patch = parseLeadPatchBody(body);
      const lead = await patchLead(businessId, params.id, patch, { source: 'agent', userId });
      return NextResponse.json({ lead });
    } catch (error: any) {
      if (error instanceof LeadError || error instanceof PipelineError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      console.error('[leads] PATCH error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  },
);
