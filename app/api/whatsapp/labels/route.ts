export const dynamic = 'force-dynamic';

/**
 * API endpoint for managing conversation labels
 */

import { NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

export const GET = withWhatsAppPremiumApi({}, async ({ businessId }) => {
  try {
    const labels = await queryRows(
      `SELECT id, name, color, created_at, updated_at
       FROM whatsapp_conversation_labels
       WHERE business_id = $1
       ORDER BY name ASC`,
      [businessId],
    );

    return NextResponse.json({ labels });
  } catch (error: any) {
    console.error('Error fetching labels:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const POST = withWhatsAppPremiumApi({ parseJsonBody: true }, async ({ body, businessId }) => {
  try {
    const { name, color = '#25D366' } = (body ?? {}) as { name?: string; color?: string };

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

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
      [businessId, name.trim(), color],
    );

    return NextResponse.json({ label });
  } catch (error: any) {
    console.error('Error creating label:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
