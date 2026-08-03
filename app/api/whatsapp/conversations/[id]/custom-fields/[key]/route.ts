export const dynamic = 'force-dynamic';

/**
 * DELETE endpoint for specific custom field
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';

export const DELETE = withWhatsAppPremiumApi<{ id: string; key: string }>({}, async ({ params, request, businessId, userId }) => {
  try {
    const fieldKey = decodeURIComponent(params.key);

    const conversationId = await resolveWhatsAppConversationDbId(businessId, params.id);
    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Delete field
    await query(
      `DELETE FROM whatsapp_conversation_custom_fields 
       WHERE conversation_id = $1 AND business_id = $2 AND field_key = $3`,
      [conversationId, businessId, fieldKey]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting custom field:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});