export const dynamic = 'force-dynamic';

/**
 * GET /api/whatsapp/leads/export?type=&stage_id=&source=&owner=&from=&to=&search=&status=
 * CSV of the leads matching the Leads page filters (up to 5000), limited to what the caller can see.
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { getInboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { exportLeads, parseLeadFilters } from '@/lib/leads/list';

export const GET = withWhatsAppPremiumApi({ inboxPermission: 'export' }, async ({ request, businessId, userId }) => {
  try {
    const viewer = await getInboxViewer({ businessId, userId });
    const csv = await exportLeads(viewer, parseLeadFilters(new URL(request.url).searchParams));
    // The byte-order mark lets Excel read names in any script as UTF-8.
    return new NextResponse(`﻿${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="leads-${Date.now()}.csv"`,
      },
    });
  } catch (error: any) {
    console.error('[leads] export error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
