/**
 * API endpoint for managing bot rule chains
 * POST - Create/update a chain mapping
 * DELETE - Remove a chain mapping
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ruleId = params.id;
    const body = await request.json();
    const { business_id, option_id, next_rule_id } = body;

    if (!business_id || !option_id || !next_rule_id) {
      return NextResponse.json(
        { error: 'business_id, option_id, and next_rule_id are required' },
        { status: 400 }
      );
    }

    // Verify rule belongs to business
    const rule = await queryOne(
      `SELECT id FROM whatsapp_bot_rules WHERE id = $1 AND business_id = $2`,
      [ruleId, business_id]
    );

    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    // Verify next_rule belongs to business
    const nextRule = await queryOne(
      `SELECT id FROM whatsapp_bot_rules WHERE id = $1 AND business_id = $2`,
      [next_rule_id, business_id]
    );

    if (!nextRule) {
      return NextResponse.json({ error: 'Next rule not found' }, { status: 404 });
    }

    // Insert or update chain
    await query(
      `INSERT INTO whatsapp_bot_rule_chains (rule_id, option_id, next_rule_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (rule_id, option_id) DO UPDATE
       SET next_rule_id = EXCLUDED.next_rule_id`,
      [ruleId, option_id, next_rule_id]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error creating bot rule chain:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ruleId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const optionId = searchParams.get('option_id');

    if (!businessId || !optionId) {
      return NextResponse.json(
        { error: 'business_id and option_id are required' },
        { status: 400 }
      );
    }

    // Verify rule belongs to business
    const rule = await queryOne(
      `SELECT id FROM whatsapp_bot_rules WHERE id = $1 AND business_id = $2`,
      [ruleId, businessId]
    );

    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    // Delete chain
    await query(
      `DELETE FROM whatsapp_bot_rule_chains 
       WHERE rule_id = $1 AND option_id = $2`,
      [ruleId, optionId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting bot rule chain:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

