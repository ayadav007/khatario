/**
 * API endpoint for WhatsApp CRM Dashboard Overview
 * GET /api/whatsapp/dashboard/overview
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Conversation status overview
    const statusOverview = await queryOne<{
      total: number;
      open: number;
      pending: number;
      closed: number;
      unread: number;
    }>(`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE conversation_status = 'open' AND status = 'active')::int as open,
        COUNT(*) FILTER (WHERE conversation_status = 'pending' AND status = 'active')::int as pending,
        COUNT(*) FILTER (WHERE conversation_status = 'closed' AND status = 'active')::int as closed,
        COUNT(*) FILTER (WHERE unread_count > 0 AND status = 'active')::int as unread
      FROM whatsapp_conversations
      WHERE business_id = $1 AND status = 'active'
    `, [businessId]);

    // Bot vs Human split
    // Count conversations with bot messages vs human messages
    // A conversation is considered "bot-handled" if it has automation events (bot_message, button_clicked, etc.)
    // Otherwise, it's human-handled
    const botVsHuman = await queryOne<{
      bot_handled: number;
      human_handled: number;
      handoff_count: number;
      total_events: number; // Debug: total bot_message events
    }>(`
      WITH bot_conversations AS (
        SELECT DISTINCT conversation_id
        FROM whatsapp_automation_events
        WHERE business_id = $1
          AND event_type IN ('bot_message', 'button_clicked', 'flow_entered', 'cta_clicked')
      ),
      human_conversations AS (
        SELECT DISTINCT c.id
        FROM whatsapp_conversations c
        WHERE c.business_id = $1
          AND c.status = 'active'
          AND EXISTS (
            SELECT 1 FROM whatsapp_conversation_messages m
            WHERE m.conversation_id = c.id
              AND m.direction = 'outgoing'
              AND NOT EXISTS (
                SELECT 1 FROM whatsapp_automation_events e
                WHERE e.conversation_id = c.id
                  AND e.event_type = 'bot_message'
              )
          )
      ),
      handoffs AS (
        SELECT COUNT(DISTINCT conversation_id)::int as count
        FROM whatsapp_automation_events
        WHERE business_id = $1
          AND event_type = 'flow_exited'
      ),
      debug_events AS (
        SELECT COUNT(*)::int as total
        FROM whatsapp_automation_events
        WHERE business_id = $1
          AND event_type = 'bot_message'
      )
      SELECT 
        (SELECT COUNT(*)::int FROM bot_conversations) as bot_handled,
        (SELECT COUNT(*)::int FROM human_conversations) as human_handled,
        (SELECT count FROM handoffs) as handoff_count,
        (SELECT total FROM debug_events) as total_events
    `, [businessId]);
    
    // Log debug info to help diagnose
    console.log('[Dashboard] Bot vs Human metrics:', {
      bot_handled: botVsHuman?.bot_handled || 0,
      human_handled: botVsHuman?.human_handled || 0,
      handoff_count: botVsHuman?.handoff_count || 0,
      total_bot_message_events: botVsHuman?.total_events || 0,
      businessId: businessId.substring(0, 8) + '...'
    });

    return NextResponse.json({
      status: statusOverview || {
        total: 0,
        open: 0,
        pending: 0,
        closed: 0,
        unread: 0
      },
      botVsHuman: botVsHuman || {
        bot_handled: 0,
        human_handled: 0,
        handoff_count: 0
      }
    });
  } catch (error: any) {
    console.error('Error fetching dashboard overview:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

