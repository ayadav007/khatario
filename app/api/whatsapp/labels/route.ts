/**
 * API endpoint for managing conversation labels
 * GET - Get all labels for a business
 * POST - Create a new label
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const labels = await queryRows(
      `SELECT id, name, color, created_at, updated_at
       FROM whatsapp_conversation_labels
       WHERE business_id = $1
       ORDER BY name ASC`,
      [businessId]
    );

    return NextResponse.json({ labels });
  } catch (error: any) {
    console.error('Error fetching labels:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, name, color = '#25D366' } = body;

    if (!business_id || !name) {
      return NextResponse.json({ error: 'business_id and name are required' }, { status: 400 });
    }

    // Validate color format (hex)
    const colorRegex = /^#[0-9A-F]{6}$/i;
    if (!colorRegex.test(color)) {
      return NextResponse.json({ error: 'Invalid color format. Use hex format like #25D366' }, { status: 400 });
    }

    const label = await queryOne(
      `INSERT INTO whatsapp_conversation_labels (business_id, name, color)
       VALUES ($1, $2, $3)
       ON CONFLICT (business_id, name) DO UPDATE
       SET color = EXCLUDED.color, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [business_id, name.trim(), color]
    );

    return NextResponse.json({ label });
  } catch (error: any) {
    console.error('Error creating label:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

