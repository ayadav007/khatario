export const dynamic = 'force-dynamic';

/**
 * API endpoint for conversation automation timeline
 */

import { NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolveVisibleConversation } from '@/lib/whatsapp-conversation-resolve';

export const GET = withWhatsAppPremiumApi<{ id: string }>({ inboxPermission: true }, async ({ params, request, businessId, userId }) => {
  try {

    const conversationId = (await resolveVisibleConversation({ businessId, userId }, params.id))?.id ?? null;
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

    const routing = await queryRows<{
      id: string;
      handler: string;
      reason: string | null;
      confidence: string | null;
      created_at: string;
    }>(
      `SELECT id, handler, reason, confidence, created_at
         FROM whatsapp_inbound_routing_events
        WHERE conversation_id = $1 AND business_id = $2
        ORDER BY created_at DESC
        LIMIT 50`,
      [conversationId, businessId],
    ).catch(() => []);

    const routingEvents = routing.map((r) => ({
      id: r.id,
      event_type: 'flow_entered' as const,
      description: `Routed to ${r.handler}${r.reason ? `: ${r.reason}` : ''}`,
      icon: r.handler.startsWith('flow') || r.handler === 'router' ? 'arrow-right' : r.handler === 'ai_agent' ? 'bot' : 'activity',
      event_data: { handler: r.handler, reason: r.reason, confidence: r.confidence },
      created_at: r.created_at,
    }));

    const merged = [...formattedEvents, ...routingEvents].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return NextResponse.json({ events: merged.slice(0, 100) });
  } catch (error: any) {
    console.error('Error fetching timeline:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});