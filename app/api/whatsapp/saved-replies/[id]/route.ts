/**
 * PATCH  /api/whatsapp/saved-replies/[id]
 * DELETE /api/whatsapp/saved-replies/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';

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

    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json({ error: 'WhatsApp Bot addon required.' }, { status: 403 });
    }

    const body = await request.json();
    const { title, shortcut, message, category } = body;

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (title !== undefined) { updates.push(`title = $${idx++}`); values.push(title.trim()); }
    if (shortcut !== undefined) { updates.push(`shortcut = $${idx++}`); values.push(shortcut?.trim() || null); }
    if (message !== undefined) { updates.push(`message = $${idx++}`); values.push(message.trim()); }
    if (category !== undefined) { updates.push(`category = $${idx++}`); values.push(category.trim()); }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(params.id, businessId);

    const reply = await queryOne(
      `UPDATE whatsapp_saved_replies
       SET ${updates.join(', ')}
       WHERE id = $${idx++} AND business_id = $${idx}
       RETURNING *`,
      values
    );

    if (!reply) {
      return NextResponse.json({ error: 'Saved reply not found' }, { status: 404 });
    }

    return NextResponse.json({ reply });
  } catch (error: any) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A saved reply with that title already exists.' }, { status: 409 });
    }
    console.error('[Saved Replies] PATCH error:', error);
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

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json({ error: 'WhatsApp Bot addon required.' }, { status: 403 });
    }

    await query(
      `DELETE FROM whatsapp_saved_replies WHERE id = $1 AND business_id = $2`,
      [params.id, businessId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Saved Replies] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
