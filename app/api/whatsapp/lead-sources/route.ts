export const dynamic = 'force-dynamic';

/**
 * GET  /api/whatsapp/lead-sources - IndiaMART connection and inbound webhooks, with lead counts
 * POST /api/whatsapp/lead-sources
 *      { kind: 'indiamart', key?, stage_id?, assign_to?, label_ids?, enabled? } - save or replace the CRM key
 *      { kind: 'webhook', name?, stage_id?, assign_to?, label_ids? }          - new webhook; its URL is returned once
 *      { kind: 'direct', enabled }                                            - put new numbers' chats on the pipeline
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolvePublicRequestOrigin } from '@/lib/http/public-request-origin';
import {
  createWebhookSource,
  getDirectChatSetting,
  LeadSourceError,
  listLeadSources,
  saveIndiaMartSource,
  setDirectChatSetting,
} from '@/lib/whatsapp/lead-sources';

export const GET = withWhatsAppPremiumApi({ managePermission: 'read' }, async ({ businessId }) => {
  try {
    const [sources, direct] = await Promise.all([listLeadSources(businessId), getDirectChatSetting(businessId)]);
    return NextResponse.json({ sources, direct });
  } catch (error: any) {
    console.error('[lead sources] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const POST = withWhatsAppPremiumApi(
  { parseJsonBody: true, managePermission: true },
  async ({ request, businessId, userId, body }) => {
    try {
      const b = (body ?? {}) as Record<string, unknown>;
      const routing = { stageId: b.stage_id, assignTo: b.assign_to, labelIds: b.label_ids };
      if (b.kind === 'indiamart') {
        const source = await saveIndiaMartSource(businessId, userId, { key: b.key, enabled: b.enabled, ...routing });
        return NextResponse.json({ source });
      }
      if (b.kind === 'direct') {
        return NextResponse.json({ direct: await setDirectChatSetting(businessId, b.enabled) });
      }
      if (b.kind === 'webhook') {
        const { source, token } = await createWebhookSource(businessId, userId, { name: b.name, ...routing });
        const url = `${resolvePublicRequestOrigin(request)}/api/webhooks/leads/${token}`;
        return NextResponse.json({ source, url }, { status: 201 });
      }
      return NextResponse.json({ error: 'kind must be indiamart, webhook or direct' }, { status: 400 });
    } catch (error: any) {
      if (error instanceof LeadSourceError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      console.error('[lead sources] POST error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  },
);
