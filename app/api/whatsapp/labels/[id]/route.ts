export const dynamic = 'force-dynamic';

/**
 * API endpoint for managing individual labels
 */

import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

export const PATCH = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true },
  async ({ params, body, businessId }) => {
    try {
      const labelId = params.id;
      const { name, color } = (body ?? {}) as { name?: string; color?: string };

      const label = await queryOne(
        `SELECT id FROM whatsapp_conversation_labels WHERE id = $1 AND business_id = $2`,
        [labelId, businessId],
      );

      if (!label) {
        return NextResponse.json({ error: 'Label not found' }, { status: 404 });
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(name.trim());
      }

      if (color !== undefined) {
        const colorRegex = /^#[0-9A-F]{6}$/i;
        if (!colorRegex.test(color)) {
          return NextResponse.json({ error: 'Invalid color format. Use hex format like #25D366' }, { status: 400 });
        }
        updates.push(`color = $${paramIndex++}`);
        values.push(color);
      }

      if (updates.length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(labelId, businessId);

      const result = await queryOne(
        `UPDATE whatsapp_conversation_labels 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND business_id = $${paramIndex++}
       RETURNING *`,
        values,
      );

      return NextResponse.json({ label: result });
    } catch (error: any) {
      console.error('Error updating label:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  },
);

export const DELETE = withWhatsAppPremiumApi<{ id: string }>({}, async ({ params, businessId }) => {
  try {
    const labelId = params.id;

    const label = await queryOne(
      `SELECT id FROM whatsapp_conversation_labels WHERE id = $1 AND business_id = $2`,
      [labelId, businessId],
    );

    if (!label) {
      return NextResponse.json({ error: 'Label not found' }, { status: 404 });
    }

    await query(
      `DELETE FROM whatsapp_conversation_labels WHERE id = $1 AND business_id = $2`,
      [labelId, businessId],
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting label:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
