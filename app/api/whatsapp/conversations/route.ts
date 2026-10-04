export const dynamic = 'force-dynamic';

/**
 * API endpoints for WhatsApp conversations
 */

import { NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { getInboxViewer, UNOWNED_SQL, visibilityClause } from '@/lib/whatsapp/inbox-ownership';

export const GET = withWhatsAppPremiumApi({ inboxPermission: true }, async ({ request, businessId, userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
    const status = searchParams.get('status'); // 'active', 'archived', or null for all
    const labelId = searchParams.get('label_id');
    const assignedTo = searchParams.get('assigned_to');
    const leadStatus = searchParams.get('lead_status');
    const conversationStatus = searchParams.get('conversation_status');
    const unreadOnly = searchParams.get('unread_only');
    const newOnly = searchParams.get('new_only');
    const search = (searchParams.get('search') || '').trim().slice(0, 100);

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    const whereConditions: string[] = ['c.business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (status) {
      whereConditions.push(`c.status = $${paramIndex++}`);
      params.push(status);
    } else {
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

    // AI lead status lives on whatsapp_lead_profiles; older manual values on the conversation.
    if (leadStatus) {
      const normalizedLeadStatus = leadStatus.trim().toLowerCase();
      if (['hot', 'warm', 'cold', 'not_interested'].includes(normalizedLeadStatus)) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM whatsapp_lead_profiles lp
          WHERE lp.conversation_id = c.id
            AND lp.business_id = c.business_id
            AND lp.lead_status = $${paramIndex++}
        )`);
        params.push(normalizedLeadStatus);
      } else {
        whereConditions.push(`c.lead_status = $${paramIndex++}`);
        params.push(leadStatus);
      }
    }

    if (conversationStatus) {
      whereConditions.push(`c.conversation_status = $${paramIndex++}`);
      params.push(conversationStatus);
    }

    if (unreadOnly === 'true') {
      whereConditions.push(`c.unread_count > 0`);
    }

    if (newOnly === 'true') {
      whereConditions.push(`c.last_message_direction = 'incoming'`);
    }

    if (search) {
      const like = `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      const digits = search.replace(/\D/g, '');
      const p = `$${paramIndex++}`;
      params.push(like);
      let phoneMatch = '';
      if (digits.length >= 4) {
        phoneMatch = ` OR REGEXP_REPLACE(c.from_number, '[^0-9]', '', 'g') LIKE $${paramIndex++}`;
        params.push(`%${digits}%`);
      }
      whereConditions.push(`(
        c.whatsapp_display_name ILIKE ${p}
        OR c.group_name ILIKE ${p}
        OR c.last_message_text ILIKE ${p}
        OR cust.name ILIKE ${p}
        ${phoneMatch}
        OR EXISTS (
          SELECT 1 FROM whatsapp_conversation_messages sm
           WHERE sm.conversation_id = c.id AND sm.business_id = c.business_id AND sm.message_text ILIKE ${p}
        )
      )`);
    }

    const onlyId = searchParams.get('id');
    if (onlyId && /^[0-9a-f-]{36}$/i.test(onlyId)) {
      whereConditions.push(`c.id = $${paramIndex++}::uuid`);
      params.push(onlyId);
    }

    const inboxState = searchParams.get('inbox_state');
    if (inboxState === 'active' || inboxState === 'requesting') {
      whereConditions.push(`c.inbox_state = $${paramIndex++} AND ${UNOWNED_SQL('c')}`);
      params.push(inboxState);
    } else if (inboxState === 'intervened') {
      whereConditions.push(`NOT ${UNOWNED_SQL('c')}`);
      const intervenedBy = searchParams.get('intervened_by');
      if (intervenedBy === 'me') {
        whereConditions.push(`c.assigned_to = $${paramIndex++}::uuid`);
        params.push(userId);
      } else if (intervenedBy === 'others') {
        whereConditions.push(`c.assigned_to <> $${paramIndex++}::uuid`);
        params.push(userId);
      } else if (intervenedBy && /^[0-9a-f-]{36}$/i.test(intervenedBy)) {
        whereConditions.push(`c.assigned_to = $${paramIndex++}::uuid`);
        params.push(intervenedBy);
      }
    }

    const viewer = await getInboxViewer({ businessId, userId });
    const visibility = visibilityClause(viewer, 'c', paramIndex);
    whereConditions.push(visibility.sql);
    params.push(...visibility.params);
    paramIndex += visibility.params.length;

    // One customer per chat: the linked one, else the first whose last 10 digits match the number.
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
        c.bot_paused_until,
        c.bot_paused_reason,
        c.handoff_requested_at,
        c.inbox_state,
        c.requested_at,
        c.intervened_at,
        (NOT ${UNOWNED_SQL('c')}) AS is_owned,
        COALESCE(cust.name, c.whatsapp_display_name, NULL) as customer_name,
        COALESCE(cust.phone, c.from_number) as customer_phone,
        c.whatsapp_display_name,
        c.profile_picture_url,
        u.name as assigned_agent_name
       FROM whatsapp_conversations c
       LEFT JOIN LATERAL (
         SELECT cu.name, cu.phone FROM customers cu
          WHERE cu.business_id = c.business_id
            AND (
              cu.id = c.customer_id
              OR (
                c.customer_id IS NULL AND NOT COALESCE(c.is_group, false)
                AND length(REGEXP_REPLACE(c.from_number, '[^0-9]', '', 'g')) >= 10
                AND RIGHT(REGEXP_REPLACE(cu.phone, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(c.from_number, '[^0-9]', '', 'g'), 10)
              )
            )
          ORDER BY (cu.id = c.customer_id) DESC NULLS LAST
          LIMIT 1
       ) cust ON true
       LEFT JOIN users u ON c.assigned_to = u.id
       WHERE ${whereConditions.join(' AND ')}
       ORDER BY c.is_pinned DESC, COALESCE(c.last_message_at, c.created_at) DESC NULLS LAST
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;

    const conversations = await queryRows(querySQL, [...params, limit, offset]);

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

    // Profile pictures are cached on the row and refreshed in the background when messages arrive.
    const conversationsWithLabels = conversations.map((conv: any) => ({
      ...conv,
      labels: labelsMap[conv.id] || [],
      profile_picture_url: conv.profile_picture_url || null,
    }));

    return NextResponse.json({
      conversations: conversationsWithLabels,
      viewer: { user_id: viewer.userId, is_supervisor: viewer.isSupervisor },
    });
  } catch (error: any) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
