export const dynamic = 'force-dynamic';

/**
 * GET  /api/whatsapp/leads/:id/convert - { match: { id, name } | null }, the customer whose phone matches the lead
 * POST /api/whatsapp/leads/:id/convert - { customer_id } links the lead (and its chat) to that customer
 * New customers are made with POST /api/customers first. A lead the caller cannot see is a 404 for both.
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { getInboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { LeadError } from '@/lib/leads/core';
import { findCustomerForLead, linkLeadToCustomer } from '@/lib/leads/convert';
import { canViewLead } from '@/lib/leads/visibility';

export const GET = withWhatsAppPremiumApi<{ id: string }>({ inboxPermission: 'read' }, async ({ params, businessId, userId }) => {
  try {
    const viewer = await getInboxViewer({ businessId, userId });
    if (!(await canViewLead(viewer, params.id))) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    return NextResponse.json({ match: await findCustomerForLead(businessId, params.id) });
  } catch (error: any) {
    console.error('[leads] convert GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const POST = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true, inboxPermission: 'update' },
  async ({ params, businessId, userId, body }) => {
    try {
      const customerId = typeof (body as { customer_id?: unknown } | null)?.customer_id === 'string' ? (body as { customer_id: string }).customer_id : '';
      const viewer = await getInboxViewer({ businessId, userId });
      const lead = await linkLeadToCustomer(viewer, params.id, customerId);
      return NextResponse.json({ lead });
    } catch (error: any) {
      if (error instanceof LeadError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      console.error('[leads] convert POST error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  },
);
