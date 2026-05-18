/**
 * GET  /api/whatsapp/saved-replies?business_id=&search=&category=
 * POST /api/whatsapp/saved-replies
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryRows, queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const search = searchParams.get('search') || '';
    const category = searchParams.get('category') || '';

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json({ error: 'WhatsApp Bot addon required.' }, { status: 403 });
    }

    const conditions: string[] = ['business_id = $1'];
    const params: any[] = [businessId];
    let idx = 2;

    if (search) {
      conditions.push(`(title ILIKE $${idx} OR shortcut ILIKE $${idx} OR message ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    if (category) {
      conditions.push(`category = $${idx++}`);
      params.push(category);
    }

    const replies = await queryRows(
      `SELECT id, title, shortcut, message, category, created_at, updated_at
       FROM whatsapp_saved_replies
       WHERE ${conditions.join(' AND ')}
       ORDER BY category ASC, title ASC`,
      params
    );

    return NextResponse.json({ replies });
  } catch (error: any) {
    console.error('[Saved Replies] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    const { title, shortcut, message, category, created_by } = body;

    if (!title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    if (!message?.trim()) return NextResponse.json({ error: 'message is required' }, { status: 400 });

    const reply = await queryOne(
      `INSERT INTO whatsapp_saved_replies (business_id, title, shortcut, message, category, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        businessId,
        title.trim(),
        shortcut?.trim() || null,
        message.trim(),
        category?.trim() || 'general',
        created_by || null,
      ]
    );

    return NextResponse.json({ reply }, { status: 201 });
  } catch (error: any) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A saved reply with that title already exists.' }, { status: 409 });
    }
    console.error('[Saved Replies] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
