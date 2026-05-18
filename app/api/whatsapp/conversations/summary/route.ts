/**
 * API endpoint for conversation summary counters
 * GET /api/whatsapp/conversations/summary
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';

export async function GET(request: NextRequest) {
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

    // Get summary counts
    // Unread: unread_count > 0 AND status = 'active'
    // New: last_message_direction = 'incoming' AND no outgoing messages exist AND status = 'active'
    // Open: conversation_status = 'open' AND status = 'active'
    // Pending: conversation_status = 'pending' AND status = 'active'
    // Closed: conversation_status = 'closed' AND status = 'active'
    // Hot/Warm/Cold/Not Interested: Based on AI lead_status from whatsapp_lead_profiles
    const summary = await queryOne<{
      unread: number;
      new: number;
      open: number;
      pending: number;
      closed: number;
      bot_resolved: number;
      hot: number;
      warm: number;
      cold: number;
      not_interested: number;
    }>(`
      SELECT 
        COUNT(*) FILTER (WHERE unread_count > 0 AND status = 'active')::int as unread,
        COUNT(*) FILTER (WHERE last_message_direction = 'incoming' 
          AND status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM whatsapp_conversation_messages m 
            WHERE m.conversation_id = c.id AND m.direction = 'outgoing'
          ))::int as new,
        COUNT(*) FILTER (WHERE conversation_status = 'open' AND status = 'active')::int as open,
        COUNT(*) FILTER (WHERE conversation_status = 'pending' AND status = 'active')::int as pending,
        COUNT(*) FILTER (WHERE conversation_status = 'closed' AND status = 'active')::int as closed,
        COUNT(*) FILTER (WHERE conversation_status = 'bot_resolved' AND status = 'active')::int as bot_resolved,
        COUNT(*) FILTER (WHERE lp.lead_status = 'hot' AND c.status = 'active')::int as hot,
        COUNT(*) FILTER (WHERE lp.lead_status = 'warm' AND c.status = 'active')::int as warm,
        COUNT(*) FILTER (WHERE lp.lead_status = 'cold' AND c.status = 'active')::int as cold,
        COUNT(*) FILTER (WHERE lp.lead_status = 'not_interested' AND c.status = 'active')::int as not_interested
      FROM whatsapp_conversations c
      LEFT JOIN whatsapp_lead_profiles lp ON lp.conversation_id = c.id AND lp.business_id = c.business_id
      WHERE c.business_id = $1
    `, [businessId]);

    return NextResponse.json({ summary });
  } catch (error: any) {
    console.error('Error fetching conversation summary:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

