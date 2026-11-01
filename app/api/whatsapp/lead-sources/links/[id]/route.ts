export const dynamic = 'force-dynamic';

/**
 * PATCH /api/whatsapp/lead-sources/links/:id
 *       { name?, phone?, prefill_text?, stage_id?, assign_to?, label_ids?, archived? }
 *       Archiving stops the link and QR from opening WhatsApp; chats already credited keep their source.
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { LeadSourceError, updateEntryLink } from '@/lib/whatsapp/lead-sources';

export const PATCH = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true, managePermission: true },
  async ({ params, businessId, body }) => {
    try {
      const b = (body ?? {}) as Record<string, unknown>;
      const link = await updateEntryLink(businessId, params.id, {
        name: b.name,
        phone: b.phone,
        prefillText: b.prefill_text,
        stageId: 'stage_id' in b ? b.stage_id ?? null : undefined,
        assignTo: 'assign_to' in b ? b.assign_to ?? null : undefined,
        labelIds: b.label_ids,
        archived: b.archived,
      });
      return NextResponse.json({ link });
    } catch (error: any) {
      if (error instanceof LeadSourceError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      console.error('[entry link] PATCH error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  },
);
