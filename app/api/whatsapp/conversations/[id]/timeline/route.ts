/**
 * API endpoint for conversation automation timeline
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
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

    // Fetch timeline events
    const events = await queryRows(
      `SELECT 
        id,
        event_type,
        event_data,
        created_at
       FROM whatsapp_automation_events
       WHERE conversation_id = $1 AND business_id = $2
       ORDER BY created_at DESC
       LIMIT 100`,
      [conversationId, businessId]
    );

    // Format events for frontend
    const formattedEvents = events.map((event: any) => {
      const eventData = event.event_data || {};
      
      // Build description based on event type
      let description = '';
      let icon = 'activity';
      
      switch (event.event_type) {
        case 'bot_message':
          description = `Bot message sent${eventData.rule_name ? `: ${eventData.rule_name}` : ''}`;
          icon = 'bot';
          break;
        case 'button_clicked':
          description = `Button clicked: ${eventData.button_title || eventData.button_id || 'Unknown'}`;
          icon = 'mouse-pointer-click';
          break;
        case 'flow_entered':
          description = `Entered flow: ${eventData.flow_name || 'Unknown'}`;
          icon = 'arrow-right';
          break;
        case 'flow_exited':
          description = `Exited flow: ${eventData.flow_name || 'Unknown'}`;
          icon = 'arrow-left';
          break;
        case 'cta_clicked':
          description = `CTA clicked: ${eventData.cta_type || 'Unknown'}`;
          if (eventData.cta_type === 'call') {
            icon = 'phone';
          } else if (eventData.cta_type === 'url') {
            icon = 'link';
          }
          break;
        case 'campaign_triggered':
          description = `Campaign triggered: ${eventData.campaign_name || eventData.campaign_id || 'Unknown'}`;
          icon = 'megaphone';
          break;
        default:
          description = 'Automation event';
      }

      return {
        id: event.id,
        event_type: event.event_type,
        description,
        icon,
        event_data: eventData,
        created_at: event.created_at
      };
    });

    return NextResponse.json({ events: formattedEvents });
  } catch (error: any) {
    console.error('Error fetching timeline:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

