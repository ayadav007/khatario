export const dynamic = 'force-dynamic';

/**
 * API endpoint for managing conversation labels
 * GET - Get all labels for a conversation
 * POST - Add label to conversation
 * DELETE - Remove label from conversation
 */

import { NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';

export const GET = withWhatsAppPremiumApi<{ id: string }>({}, async ({ params, request, businessId, userId }) => {
  try {

    const conversationId = await resolveWhatsAppConversationDbId(businessId, params.id);
    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const labels = await queryRows(
      `SELECT l.id, l.name, l.color
       FROM whatsapp_conversation_labels l
       INNER JOIN whatsapp_conversation_label_assignments a ON l.id = a.label_id
       WHERE a.conversation_id = $1 AND l.business_id = $2
       ORDER BY l.name ASC`,
      [conversationId, businessId]
    );

    return NextResponse.json({ labels });
  } catch (error: any) {
    console.error('Error fetching conversation labels:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const POST = withWhatsAppPremiumApi<{ id: string }>({ parseJsonBody: true }, async ({ params, request, businessId, body, userId }) => {
  try {
    const { searchParams } = new URL(request.url);

    const { label_id } = (body ?? {}) as Record<string, any>;

    if (!businessId || !label_id) {
      return NextResponse.json({ error: 'businessId and label_id are required' }, { status: 400 });
    }

    const conversationId = await resolveWhatsAppConversationDbId(businessId, params.id);
    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Verify label belongs to business
    const label = await queryOne(
      `SELECT id FROM whatsapp_conversation_labels WHERE id = $1 AND business_id = $2`,
      [label_id, businessId]
    );

    if (!label) {
      return NextResponse.json({ error: 'Label not found' }, { status: 404 });
    }

    // Add label assignment (ignore if already exists)
    await query(
      `INSERT INTO whatsapp_conversation_label_assignments (conversation_id, label_id)
       VALUES ($1, $2)
       ON CONFLICT (conversation_id, label_id) DO NOTHING`,
      [conversationId, label_id]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error adding label to conversation:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const DELETE = withWhatsAppPremiumApi<{ id: string }>({}, async ({ params, request, businessId, userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const labelId = searchParams.get('label_id');

    if (!businessId || !labelId) {
      return NextResponse.json({ error: 'businessId and label_id are required' }, { status: 400 });
    }

    const conversationId = await resolveWhatsAppConversationDbId(businessId, params.id);
    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Remove label assignment
    await query(
      `DELETE FROM whatsapp_conversation_label_assignments 
       WHERE conversation_id = $1 AND label_id = $2`,
      [conversationId, labelId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error removing label from conversation:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});