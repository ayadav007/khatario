/**
 * API endpoint for managing individual conversations
 * DELETE - Delete conversation
 * PATCH - Update conversation (archive, pin, mute, block, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';

export async function DELETE(
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

    // Delete conversation (CASCADE will delete messages, label assignments, and states)
    await query(
      `DELETE FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
      [conversationId, businessId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting conversation:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
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

    const body = await request.json();
    const {
      status, // 'active', 'archived', 'blocked'
      is_pinned,
      is_muted,
      muted_until,
      is_blocked,
      unread_count, // For mark as unread
      assigned_to, // User ID for agent assignment
      lead_status, // 'new', 'interested', 'follow_up', 'converted', 'lost'
      conversation_status, // 'open', 'pending', 'closed'
    } = body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    if (is_pinned !== undefined) {
      updates.push(`is_pinned = $${paramIndex++}`);
      values.push(is_pinned);
      if (is_pinned) {
        updates.push(`pinned_at = CURRENT_TIMESTAMP`);
      } else {
        updates.push(`pinned_at = NULL`);
      }
    }

    if (is_muted !== undefined) {
      updates.push(`is_muted = $${paramIndex++}`);
      values.push(is_muted);
      if (muted_until !== undefined) {
        updates.push(`muted_until = $${paramIndex++}`);
        values.push(muted_until);
      } else if (!is_muted) {
        updates.push(`muted_until = NULL`);
      }
    }

    if (is_blocked !== undefined) {
      updates.push(`is_blocked = $${paramIndex++}`);
      values.push(is_blocked);
      if (is_blocked) {
        updates.push(`blocked_at = CURRENT_TIMESTAMP`);
      } else {
        updates.push(`blocked_at = NULL`);
      }
    }

    if (unread_count !== undefined) {
      updates.push(`unread_count = $${paramIndex++}`);
      values.push(unread_count);
    }

    if (assigned_to !== undefined) {
      // Allow null to unassign
      if (assigned_to === null || assigned_to === '') {
        updates.push(`assigned_to = NULL`);
      } else {
        updates.push(`assigned_to = $${paramIndex++}`);
        values.push(assigned_to);
      }
    }

    if (lead_status !== undefined) {
      // Check if it's an AI-based lead status (hot, warm, cold, not_interested)
      // If so, update whatsapp_lead_profiles instead of (or in addition to) conversations table
      if (['hot', 'warm', 'cold', 'not_interested'].includes(lead_status)) {
        // Update AI lead status in whatsapp_lead_profiles (manual override)
        // This allows users to manually override AI-calculated status
        try {
          // Get conversation phone for lead profile
          const conv = await queryOne<{ from_number: string }>(
            `SELECT from_number FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
            [conversationId, businessId]
          );
          
          if (conv) {
            // Upsert: update if exists, insert if doesn't (for manual setting before AI analysis)
            await query(`
              INSERT INTO whatsapp_lead_profiles (
                business_id, conversation_id, phone, lead_status, updated_at
              )
              VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
              ON CONFLICT (business_id, conversation_id)
              DO UPDATE SET 
                lead_status = $4,
                updated_at = CURRENT_TIMESTAMP
            `, [businessId, conversationId, conv.from_number, lead_status]);
            
            console.log(`[API] Manual override: Set AI lead_status to ${lead_status} for conversation ${conversationId}`);
          }
        } catch (error) {
          console.error('[API] Error updating AI lead status:', error);
          // Continue with regular update as fallback
        }
      } else {
        // Backward compatibility: update old manual lead_status in conversations table
        updates.push(`lead_status = $${paramIndex++}`);
        values.push(lead_status);
      }
    }

    if (conversation_status !== undefined) {
      updates.push(`conversation_status = $${paramIndex++}`);
      values.push(conversation_status);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(conversationId, businessId);

    const result = await queryOne(
      `UPDATE whatsapp_conversations 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND business_id = $${paramIndex++}
       RETURNING 
         id,
         conversation_id,
         from_number,
         last_message_text,
         last_message_at,
         last_message_direction,
         unread_count,
         assigned_to,
         conversation_status,
         lead_status,
         is_group,
         group_name,
         status`,
      values
    );

    // TODO: Emit WebSocket conversation:update event
    if (result) {
      try {
        // Get full conversation data with assigned agent name
        const conversationData = await queryRows(`
          SELECT 
            c.id,
            c.conversation_id,
            c.from_number,
            c.last_message_text,
            c.last_message_at,
            c.last_message_direction,
            c.unread_count,
            c.assigned_to,
            c.conversation_status,
            c.lead_status,
            c.is_group,
            c.group_name,
            u.name as assigned_agent_name
          FROM whatsapp_conversations c
          LEFT JOIN users u ON c.assigned_to = u.id
          WHERE c.id = $1 AND c.business_id = $2
        `, [conversationId, businessId]);

        if (conversationData.length > 0) {
          const { emitConversationUpdate, emitAgentUpdate } = await import('@/lib/whatsapp-websocket');
          emitConversationUpdate(businessId, conversationData[0]);
          
          // If assigned_to changed, emit agent update
          if (assigned_to !== undefined) {
            emitAgentUpdate(businessId, conversationId, assigned_to === null || assigned_to === '' ? null : assigned_to);
          }
        }
      } catch (err) {
        console.error('[API] Error emitting WebSocket events:', err);
      }
    }

    return NextResponse.json({ conversation: result });
  } catch (error: any) {
    console.error('Error updating conversation:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

