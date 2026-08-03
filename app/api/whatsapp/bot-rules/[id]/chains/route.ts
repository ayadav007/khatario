export const dynamic = 'force-dynamic';

/**
 * API endpoint for managing bot rule chains
 * POST - Create/update a chain mapping
 * DELETE - Remove a chain mapping
 */

import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

export const POST = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true },
  async ({ params, body, businessId }) => {
    try {
      const ruleId = params.id;
      const { option_id, next_rule_id } = (body ?? {}) as {
        option_id?: string;
        next_rule_id?: string;
      };

      if (!option_id || !next_rule_id) {
        return NextResponse.json(
          { error: 'option_id and next_rule_id are required' },
          { status: 400 },
        );
      }

      const rule = await queryOne(
        `SELECT id FROM whatsapp_bot_rules WHERE id = $1 AND business_id = $2`,
        [ruleId, businessId],
      );

      if (!rule) {
        return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
      }

      const nextRule = await queryOne(
        `SELECT id FROM whatsapp_bot_rules WHERE id = $1 AND business_id = $2`,
        [next_rule_id, businessId],
      );

      if (!nextRule) {
        return NextResponse.json({ error: 'Next rule not found' }, { status: 404 });
      }

      await query(
        `INSERT INTO whatsapp_bot_rule_chains (rule_id, option_id, next_rule_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (rule_id, option_id) DO UPDATE
       SET next_rule_id = EXCLUDED.next_rule_id`,
        [ruleId, option_id, next_rule_id],
      );

      return NextResponse.json({ success: true });
    } catch (error: any) {
      console.error('Error creating bot rule chain:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  },
);

export const DELETE = withWhatsAppPremiumApi<{ id: string }>({}, async ({ params, request, businessId }) => {
  try {
    const ruleId = params.id;
    const { searchParams } = new URL(request.url);
    const optionId = searchParams.get('option_id');

    if (!optionId) {
      return NextResponse.json({ error: 'option_id is required' }, { status: 400 });
    }

    const rule = await queryOne(
      `SELECT id FROM whatsapp_bot_rules WHERE id = $1 AND business_id = $2`,
      [ruleId, businessId],
    );

    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    await query(
      `DELETE FROM whatsapp_bot_rule_chains 
       WHERE rule_id = $1 AND option_id = $2`,
      [ruleId, optionId],
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting bot rule chain:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
