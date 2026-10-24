export const dynamic = 'force-dynamic';

/**
 * API endpoint for managing individual conversations
 * DELETE - Delete conversation
 * PATCH - Update conversation (archive, pin, mute, block, etc.)
 */

import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolveVisibleConversation } from '@/lib/whatsapp-conversation-resolve';
import { broadcastOwnership } from '@/lib/whatsapp/inbox-ownership';

/** Contact-panel status for one chat: blocked, and whether the number opted out of broadcasts. */
export const GET = withWhatsAppPremiumApi<{ id: string }>({ inboxPermission: true }, async ({ params, businessId, userId }) => {
  const found = await resolveVisibleConversation({ businessId, userId }, params.id);
  if (!found) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }
  const row = await queryOne<{ is_blocked: boolean | null; is_group: boolean | null; opted_out: boolean }>(
    `SELECT c.is_blocked, c.is_group,
            EXISTS (
              SELECT 1 FROM whatsapp_unsubscribes u
               WHERE u.business_id = c.business_id
                 AND length(REGEXP_REPLACE(c.from_number, '[^0-9]', '', 'g')) >= 10
                 AND RIGHT(REGEXP_REPLACE(u.phone, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(c.from_number, '[^0-9]', '', 'g'), 10)
            ) AS opted_out
       FROM whatsapp_conversations c
      WHERE c.id = $1 AND c.business_id = $2`,
    [found.id, businessId]
  );
  if (!row) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }
  return NextResponse.json({
    is_blocked: !!row.is_blocked,
    is_group: !!row.is_group,
    opted_out: !row.is_group && !!row.opted_out,
  });
});

export const DELETE = withWhatsAppPremiumApi<{ id: string }>({ inboxPermission: true }, async ({ params, request, businessId, userId }) => {
  try {

    const conversationId = (await resolveVisibleConversation({ businessId, userId }, params.id))?.id ?? null;
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
});

export const PATCH = withWhatsAppPremiumApi<{ id: string }>({ parseJsonBody: true, inboxPermission: true }, async ({ params, request, businessId, body, userId }) => {
  try {

    const found = await resolveVisibleConversation({ businessId, userId }, params.id);
    if (!found) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const conversationId = found.id;

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
    } = (body ?? {}) as Record<string, any>;

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
      return NextResponse.json(
        {
          error: 'Use Intervene, Transfer or Resolve to change who handles a chat',
          code: 'USE_OWNERSHIP_ENDPOINT',
        },
        { status: 400 },
      );
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
      if (!found.viewer.isSupervisor) {
        return NextResponse.json(
          { error: 'Only supervisors can change the conversation status directly', code: 'NOT_SUPERVISOR' },
          { status: 403 },
        );
      }
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

    if (result) {
      await broadcastOwnership(businessId, conversationId);
    }

    return NextResponse.json({ conversation: result });
  } catch (error: any) {
    console.error('Error updating conversation:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});