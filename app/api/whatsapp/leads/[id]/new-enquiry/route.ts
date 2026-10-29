export const dynamic = 'force-dynamic';

/**
 * POST /api/whatsapp/leads/:id/new-enquiry - { confirm_close_open? }
 * A repeat enquiry from the lead's number. 409 LEAD_OPEN while the number has an open lead and
 * confirm_close_open is not true; confirmed, that lead is closed as lost ('New enquiry') first.
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { getInboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { PipelineError } from '@/lib/whatsapp/pipeline';
import { LeadError } from '@/lib/leads/core';
import { startNewEnquiry } from '@/lib/leads/list';

export const POST = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true, inboxPermission: 'update' },
  async ({ params, businessId, userId, body }) => {
    try {
      const viewer = await getInboxViewer({ businessId, userId });
      const confirm = (body as Record<string, unknown> | null)?.confirm_close_open === true;
      const lead = await startNewEnquiry(viewer, params.id, confirm);
      return NextResponse.json({ lead }, { status: 201 });
    } catch (error: any) {
      if (error instanceof LeadError || error instanceof PipelineError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      console.error('[leads] new enquiry error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  },
);
