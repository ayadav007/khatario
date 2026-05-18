/**
 * API endpoints for WhatsApp conversations
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Check if business has WhatsApp Bot addon (use cached version)
    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required. Please upgrade to unlock this feature.' },
        { status: 403 }
      );
    }
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status'); // 'active', 'archived', or null for all
    const labelId = searchParams.get('label_id'); // Filter by label
    const assignedTo = searchParams.get('assigned_to'); // Filter by assigned agent
    const leadStatus = searchParams.get('lead_status'); // Filter by lead status
    const conversationStatus = searchParams.get('conversation_status'); // Filter by conversation status
    const unreadOnly = searchParams.get('unread_only'); // Filter by unread only (true/false)

    // Debug: Log all query parameters to see what's being sent
    const allParams = Object.fromEntries(searchParams.entries());
    console.log('[Conversations API] 📥 Request received:', {
      businessId,
      status,
      labelId,
      leadStatus: leadStatus || '⚠️ NULL - Filter not sent from frontend!',
      conversationStatus,
      unreadOnly,
      allParams,
      url: request.url
    });
    
    if (leadStatus) {
      console.log('[Conversations API] ✅ Lead status filter received:', leadStatus);
    } else if (allParams.lead_status) {
      console.log('[Conversations API] ⚠️ lead_status found in allParams but not extracted:', allParams.lead_status);
    } else {
      console.log('[Conversations API] ❌ No lead_status parameter in request');
    }

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Build WHERE clause
    const whereConditions: string[] = ['c.business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (status) {
      whereConditions.push(`c.status = $${paramIndex++}`);
      params.push(status);
    } else {
      // By default, exclude archived conversations (show only active)
      whereConditions.push(`c.status = 'active'`);
    }

    if (labelId) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM whatsapp_conversation_label_assignments a
        WHERE a.conversation_id = c.id AND a.label_id = $${paramIndex++}
      )`);
      params.push(labelId);
    }

    if (assignedTo) {
      whereConditions.push(`c.assigned_to = $${paramIndex++}`);
      params.push(assignedTo);
    }

    // Lead status filter: Use AI lead_status from whatsapp_lead_profiles
    // Support both old manual values (new, interested, follow_up, converted, lost) 
    // and new AI values (hot, warm, cold, not_interested)
    if (leadStatus) {
      const normalizedLeadStatus = leadStatus.trim().toLowerCase();
      console.log('[Conversations API] Filtering by lead_status:', { original: leadStatus, normalized: normalizedLeadStatus });
      
      // Check if it's an AI-based status (hot, warm, cold, not_interested)
      if (['hot', 'warm', 'cold', 'not_interested'].includes(normalizedLeadStatus)) {
        // Filter by AI lead_status from whatsapp_lead_profiles
        // Use EXISTS subquery to check lead_profiles table
        whereConditions.push(`EXISTS (
          SELECT 1 FROM whatsapp_lead_profiles lp
          WHERE lp.conversation_id = c.id 
            AND lp.business_id = c.business_id
            AND lp.lead_status = $${paramIndex++}
        )`);
        params.push(normalizedLeadStatus);
        console.log('[Conversations API] ✅ Added AI lead_status filter (EXISTS query):', normalizedLeadStatus);
      } else {
        // Backward compatibility: filter by old manual lead_status in conversations table
        whereConditions.push(`c.lead_status = $${paramIndex++}`);
        params.push(leadStatus);
        console.log('[Conversations API] ⚠️ Added manual lead_status filter (old column):', leadStatus);
      }
    }

    if (conversationStatus) {
      whereConditions.push(`c.conversation_status = $${paramIndex++}`);
      params.push(conversationStatus);
    }

    if (unreadOnly === 'true') {
      whereConditions.push(`c.unread_count > 0`);
    }

    const querySQL = `SELECT 
        c.id,
        c.conversation_id,
        c.from_number,
        c.last_message_text,
        c.last_message_at,
        c.last_message_direction,
        c.unread_count,
        c.status,
        c.customer_id,
        c.is_pinned,
        c.is_muted,
        c.is_blocked,
        c.is_group,
        c.group_name,
        c.group_jid,
        c.assigned_to,
        c.lead_status,
        c.conversation_status,
        COALESCE(cust.name, cust_by_phone.name, c.whatsapp_display_name, NULL) as customer_name,
        COALESCE(cust.phone, cust_by_phone.phone, c.from_number) as customer_phone,
        c.whatsapp_display_name,
        c.profile_picture_url,
        u.name as assigned_agent_name
       FROM whatsapp_conversations c
       LEFT JOIN customers cust ON c.customer_id = cust.id
       LEFT JOIN customers cust_by_phone ON cust_by_phone.business_id = $1 
         AND (
           cust_by_phone.phone = c.from_number 
           OR cust_by_phone.phone = REGEXP_REPLACE(c.from_number, '[^0-9]', '', 'g')
           OR REGEXP_REPLACE(cust_by_phone.phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(c.from_number, '[^0-9]', '', 'g')
           OR c.from_number LIKE '%' || cust_by_phone.phone || '%'
           OR cust_by_phone.phone LIKE '%' || REGEXP_REPLACE(c.from_number, '[^0-9]', '', 'g') || '%'
         )
         AND c.customer_id IS NULL
       LEFT JOIN users u ON c.assigned_to = u.id
       WHERE ${whereConditions.join(' AND ')}
       ORDER BY c.is_pinned DESC, COALESCE(c.last_message_at, c.created_at) DESC NULLS LAST
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    
    console.log('[Conversations API] Query:', {
      leadStatus,
      whereConditions: whereConditions.join(' AND '),
      params: params.map((p, i) => `$${i + 1}=${typeof p === 'string' ? p.substring(0, 50) : p}`),
      paramCount: params.length
    });

    const conversations = await queryRows(querySQL, [...params, limit, offset]);
    
    console.log('[Conversations API] Results:', {
      count: conversations.length,
      leadStatus,
      sampleIds: conversations.slice(0, 3).map((c: any) => c.id)
    });

    // Fetch labels for each conversation
    const conversationIds = conversations.map((c: any) => c.id);
    let labelsMap: Record<string, any[]> = {};
    
    if (conversationIds.length > 0) {
      const labels = await queryRows(
        `SELECT 
          a.conversation_id,
          l.id,
          l.name,
          l.color
         FROM whatsapp_conversation_label_assignments a
         INNER JOIN whatsapp_conversation_labels l ON a.label_id = l.id
         WHERE a.conversation_id = ANY($1::uuid[])
         ORDER BY l.name ASC`,
        [conversationIds]
      );

      labelsMap = labels.reduce((acc: Record<string, any[]>, label: any) => {
        if (!acc[label.conversation_id]) {
          acc[label.conversation_id] = [];
        }
        acc[label.conversation_id].push({
          id: label.id,
          name: label.name,
          color: label.color
        });
        return acc;
      }, {});
    }

    // Attach labels and cached profile pictures to conversations
    // Profile pictures are now cached in the DB column (profile_picture_url) and refreshed
    // automatically in the background when new messages arrive — no live WA API call needed.
    const conversationsWithLabels = conversations.map((conv: any) => {
      return {
        ...conv,
        labels: labelsMap[conv.id] || [],
        profile_picture_url: (conv as any).profile_picture_url || null,
      };
    });

    return NextResponse.json({ conversations: conversationsWithLabels });
  } catch (error: any) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

