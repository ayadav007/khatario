import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { resolveVisibleConversation } from '@/lib/whatsapp-conversation-resolve';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { canViewConversation, getInboxViewer } from '@/lib/whatsapp/inbox-ownership';

export const dynamic = 'force-dynamic';

export const GET = withWhatsAppPremiumApi({ inboxPermission: true }, async ({ request, businessId, userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');
    const conversationId = searchParams.get('conversation_id');

    let profile;
    if (conversationId) {
      const convUuid = (await resolveVisibleConversation({ businessId, userId }, conversationId))?.id ?? null;
      if (convUuid) {
        profile = await queryOne(
          `SELECT * FROM whatsapp_lead_profiles 
           WHERE business_id = $1 AND conversation_id = $2::uuid`,
          [businessId, convUuid]
        );
      }
    } else if (phone) {
      const normalizedPhone = phone.replace(/\D/g, '');

      const conversation = await queryOne(
        `SELECT id FROM whatsapp_conversations 
         WHERE business_id = $1 
         AND (
           conversation_id = $2 
           OR from_number = $2
           OR REGEXP_REPLACE(conversation_id, '[^0-9]', '', 'g') = $3
           OR REGEXP_REPLACE(from_number, '[^0-9]', '', 'g') = $3
         )
         ORDER BY last_message_at DESC 
         LIMIT 1`,
        [businessId, phone, normalizedPhone]
      );

      const viewer = await getInboxViewer({ businessId, userId });
      if (conversation && (await canViewConversation(viewer, conversation.id))) {
        profile = await queryOne(
          `SELECT * FROM whatsapp_lead_profiles 
           WHERE business_id = $1 AND conversation_id = $2`,
          [businessId, conversation.id]
        );
      }
    }

    return NextResponse.json({ profile });
  } catch (error: any) {
    console.error('Error fetching lead profile:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch lead profile' },
      { status: 500 }
    );
  }
});
