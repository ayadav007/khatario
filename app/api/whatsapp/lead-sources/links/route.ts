export const dynamic = 'force-dynamic';

/**
 * GET  /api/whatsapp/lead-sources/links?archived=1 - tracked links with clicks, chats and wins,
 *      plus the public base URL and a suggested WhatsApp number for new links
 * POST /api/whatsapp/lead-sources/links - { name, phone, prefill_text?, stage_id?, assign_to?, label_ids? }
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolvePublicRequestOrigin } from '@/lib/http/public-request-origin';
import { createEntryLink, LeadSourceError, listEntryLinks, suggestedBusinessPhone } from '@/lib/whatsapp/lead-sources';

export const GET = withWhatsAppPremiumApi({ managePermission: 'read' }, async ({ request, businessId }) => {
  try {
    const archived = new URL(request.url).searchParams.get('archived') === '1';
    const [links, suggestedPhone] = await Promise.all([listEntryLinks(businessId, archived), suggestedBusinessPhone(businessId)]);
    return NextResponse.json({ links, suggested_phone: suggestedPhone, base_url: resolvePublicRequestOrigin(request) });
  } catch (error: any) {
    console.error('[entry links] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const POST = withWhatsAppPremiumApi({ parseJsonBody: true, managePermission: true }, async ({ businessId, userId, body }) => {
  try {
    const b = (body ?? {}) as Record<string, unknown>;
    const link = await createEntryLink(businessId, userId, {
      name: b.name,
      phone: b.phone,
      prefillText: b.prefill_text,
      stageId: b.stage_id,
      assignTo: b.assign_to,
      labelIds: b.label_ids,
    });
    return NextResponse.json({ link }, { status: 201 });
  } catch (error: any) {
    if (error instanceof LeadSourceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[entry links] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
