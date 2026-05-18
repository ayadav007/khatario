import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';

// Helper function to check WhatsApp Bot addon
async function hasWhatsAppBotAddon(businessId: string): Promise<boolean> {
  try {
    const addon = await queryOne(
      `SELECT id FROM whatsapp_addons 
       WHERE business_id = $1 
       AND addon_type IN ('whatsapp_bot', 'whatsapp', 'whatsapp_send_message')
       AND status = 'active' 
       AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
      [businessId]
    );
    return !!addon;
  } catch (error) {
    console.error('Error checking WhatsApp Bot addon:', error);
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const phone = searchParams.get('phone');
    const conversationId = searchParams.get('conversation_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Check addon
    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required' },
        { status: 403 }
      );
    }

    let profile;
    if (conversationId) {
      const convUuid = await resolveWhatsAppConversationDbId(businessId, conversationId);
      if (convUuid) {
        profile = await queryOne(
          `SELECT * FROM whatsapp_lead_profiles 
           WHERE business_id = $1 AND conversation_id = $2::uuid`,
          [businessId, convUuid]
        );
      }
    } else if (phone) {
      // Find by phone number - normalize it first
      const normalizedPhone = phone.replace(/\D/g, '');
      
      // First find the conversation
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
      
      if (conversation) {
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
}
