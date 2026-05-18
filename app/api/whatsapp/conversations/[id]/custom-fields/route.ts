/**
 * API endpoints for conversation custom fields
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows, query } from '@/lib/db';
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

    // Fetch custom fields
    const fields = await queryRows(
      `SELECT field_key, field_value
       FROM whatsapp_conversation_custom_fields
       WHERE conversation_id = $1 AND business_id = $2`,
      [conversationId, businessId]
    );

    // Convert to key-value object
    const fieldsObject: Record<string, string> = {};
    fields.forEach((field: any) => {
      fieldsObject[field.field_key] = field.field_value || '';
    });

    return NextResponse.json({ fields: fieldsObject });
  } catch (error: any) {
    console.error('Error fetching custom fields:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(
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
    const { fields } = body;

    if (!fields || typeof fields !== 'object') {
      return NextResponse.json(
        { error: 'fields object is required' },
        { status: 400 }
      );
    }

    // Upsert each field
    for (const [key, value] of Object.entries(fields)) {
      if (typeof key !== 'string' || key.length === 0 || key.length > 100) {
        continue; // Skip invalid keys
      }

      const fieldValue = typeof value === 'string' ? value : String(value);

      await query(
        `INSERT INTO whatsapp_conversation_custom_fields 
         (conversation_id, business_id, field_key, field_value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (conversation_id, field_key) 
         DO UPDATE SET field_value = $4, updated_at = CURRENT_TIMESTAMP`,
        [conversationId, businessId, key, fieldValue]
      );
    }

    // Fetch updated fields
    const updatedFields = await queryRows(
      `SELECT field_key, field_value
       FROM whatsapp_conversation_custom_fields
       WHERE conversation_id = $1 AND business_id = $2`,
      [conversationId, businessId]
    );

    const fieldsObject: Record<string, string> = {};
    updatedFields.forEach((field: any) => {
      fieldsObject[field.field_key] = field.field_value || '';
    });

    return NextResponse.json({ fields: fieldsObject });
  } catch (error: any) {
    console.error('Error updating custom fields:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}


