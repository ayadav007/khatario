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
import { LeadError, patchLead, type LeadPatch } from '@/lib/leads/core';
import { loadLeadDetail } from '@/lib/leads/list';
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
      const b = (body ?? {}) as Record<string, any>;
      const patch: LeadPatch = {};
      if ('stage_id' in b) patch.stageId = typeof b.stage_id === 'string' && b.stage_id ? b.stage_id : null;
      if ('deal_value' in b) patch.dealValue = b.deal_value === '' || b.deal_value === null ? null : Number(b.deal_value);
      if ('expected_close_on' in b) patch.expectedCloseOn = typeof b.expected_close_on === 'string' ? b.expected_close_on : null;
      if ('lost_reason' in b) patch.lostReason = typeof b.lost_reason === 'string' ? b.lost_reason : null;
      if ('owner_id' in b) patch.ownerId = typeof b.owner_id === 'string' && b.owner_id ? b.owner_id : null;
      if ('contact_name' in b) patch.contactName = typeof b.contact_name === 'string' ? b.contact_name : null;
      if ('note' in b) patch.note = typeof b.note === 'string' ? b.note : null;
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
