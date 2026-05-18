/**
 * API endpoint for WhatsApp CRM Dashboard Agent Performance
 * GET /api/whatsapp/dashboard/agents
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Agent performance metrics
    // Calculate: total assigned, open vs closed, avg response time
    const agentPerformance = await queryRows<{
      agent_id: string;
      agent_name: string;
      total_assigned: number;
      open: number;
      closed: number;
      avg_response_seconds: number | null;
    }>(`
      WITH agent_stats AS (
        SELECT 
          u.id as agent_id,
          u.name as agent_name,
          COUNT(DISTINCT c.id) as total_assigned,
          COUNT(DISTINCT c.id) FILTER (WHERE c.conversation_status = 'open') as open,
          COUNT(DISTINCT c.id) FILTER (WHERE c.conversation_status = 'closed') as closed
        FROM users u
        LEFT JOIN whatsapp_conversations c ON c.assigned_to = u.id AND c.business_id = $1 AND c.status = 'active'
        WHERE u.business_id = $1
        GROUP BY u.id, u.name
        HAVING COUNT(DISTINCT c.id) > 0
      ),
      response_times AS (
        SELECT 
          c.assigned_to as agent_id,
          AVG(
            EXTRACT(EPOCH FROM (
              first_reply.created_at - first_incoming.created_at
            ))
          ) as avg_response_seconds
        FROM whatsapp_conversations c
        INNER JOIN LATERAL (
          SELECT MIN(created_at) as created_at
          FROM whatsapp_conversation_messages
          WHERE conversation_id = c.id
            AND direction = 'incoming'
        ) first_incoming ON true
        INNER JOIN LATERAL (
          SELECT MIN(created_at) as created_at
          FROM whatsapp_conversation_messages
          WHERE conversation_id = c.id
            AND direction = 'outgoing'
            AND created_at > first_incoming.created_at
        ) first_reply ON true
        WHERE c.business_id = $1
          AND c.assigned_to IS NOT NULL
          AND c.status = 'active'
        GROUP BY c.assigned_to
      )
      SELECT 
        a.agent_id,
        a.agent_name,
        a.total_assigned::int,
        a.open::int,
        a.closed::int,
        COALESCE(r.avg_response_seconds, NULL)::float as avg_response_seconds
      FROM agent_stats a
      LEFT JOIN response_times r ON a.agent_id = r.agent_id
      ORDER BY a.total_assigned DESC, a.agent_name ASC
    `, [businessId]);

    return NextResponse.json({
      agents: agentPerformance || []
    });
  } catch (error: any) {
    console.error('Error fetching agent performance:', error);
    return NextResponse.json({ agents: [] });
  }
}

