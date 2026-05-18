/**
 * DELETE endpoint for specific custom field
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; key: string } }
) {
  try {
    const fieldKey = decodeURIComponent(params.key);
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Check if business has WhatsApp Bot addon
    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required. Please upgrade to unlock this feature.' },
        { status: 403 }
      );
    }

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
}

