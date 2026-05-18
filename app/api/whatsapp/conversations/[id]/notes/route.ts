/**
 * API endpoints for conversation notes
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
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

    // Fetch notes with user information
    const notes = await queryRows(
      `SELECT 
        n.id,
        n.note_text,
        n.created_at,
        n.user_id,
        u.name as user_name,
        u.email as user_email
       FROM whatsapp_conversation_notes n
       LEFT JOIN users u ON n.user_id = u.id
       WHERE n.conversation_id = $1 AND n.business_id = $2
       ORDER BY n.created_at DESC`,
      [conversationId, businessId]
    );

    return NextResponse.json({ notes });
  } catch (error: any) {
    console.error('Error fetching notes:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
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
    const { note_text, user_id } = body;

    if (!note_text || !user_id) {
      return NextResponse.json(
        { error: 'note_text and user_id are required' },
        { status: 400 }
      );
    }

    // Verify user belongs to business (optional check)
    const user = await queryOne(
      `SELECT id FROM users WHERE id = $1`,
      [user_id]
    );

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Create note
    const note = await queryOne<{ id: string; note_text: string; created_at: string; user_id: string }>(
      `INSERT INTO whatsapp_conversation_notes 
       (conversation_id, business_id, user_id, note_text)
       VALUES ($1, $2, $3, $4)
       RETURNING id, note_text, created_at, user_id`,
      [conversationId, businessId, user_id, note_text]
    );

    // Fetch note with user information
    const noteWithUser = await queryOne(
      `SELECT 
        n.id,
        n.note_text,
        n.created_at,
        n.user_id,
        u.name as user_name,
        u.email as user_email
       FROM whatsapp_conversation_notes n
       LEFT JOIN users u ON n.user_id = u.id
       WHERE n.id = $1`,
      [note!.id]
    );

    return NextResponse.json({ note: noteWithUser }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating note:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const noteId = searchParams.get('note_id');

    if (!businessId || !noteId) {
      return NextResponse.json(
        { error: 'business_id and note_id are required' },
        { status: 400 }
      );
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

    // Verify note belongs to conversation and business
    const note = await queryOne(
      `SELECT id FROM whatsapp_conversation_notes 
       WHERE id = $1 AND conversation_id = $2 AND business_id = $3`,
      [noteId, conversationId, businessId]
    );

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    // Delete note
    await query(
      `DELETE FROM whatsapp_conversation_notes WHERE id = $1`,
      [noteId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting note:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

