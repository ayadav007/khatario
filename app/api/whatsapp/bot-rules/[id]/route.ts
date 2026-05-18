/**
 * API endpoint for managing individual bot rules
 * GET - Get a single bot rule
 * PATCH - Update bot rule
 * DELETE - Delete bot rule
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ruleId = params.id;
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

    const rule = await queryOne(
      `SELECT id, name, category, trigger_type, trigger_value, trigger_conditions,
              is_active, priority, response_type, response_message, response_media_url,
              response_media_type, response_options, next_rule_id, end_flow,
              only_for_individuals, auto_actions, fallback_message, expected_input_type,
              context_variables, delay_seconds, created_at, updated_at
       FROM whatsapp_bot_rules
       WHERE id = $1 AND business_id = $2`,
      [ruleId, businessId]
    );

    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    // Get chains for this rule
    const chains = await queryRows(
      `SELECT option_id, next_rule_id
       FROM whatsapp_bot_rule_chains
       WHERE rule_id = $1`,
      [ruleId]
    );

    return NextResponse.json({ rule: { ...rule, chains } });
  } catch (error: any) {
    console.error('Error fetching bot rule:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ruleId = params.id;
    const body = await request.json();
    const { business_id, ...updates } = body;

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Check if business has WhatsApp Bot addon
    const hasAddon = await hasWhatsAppBotAddon(business_id);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required. Please upgrade to unlock this feature.' },
        { status: 403 }
      );
    }

    // Verify rule belongs to business
    const existingRule = await queryOne(
      `SELECT id FROM whatsapp_bot_rules WHERE id = $1 AND business_id = $2`,
      [ruleId, business_id]
    );

    if (!existingRule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Build dynamic update query
    const allowedFields = [
      'name', 'category', 'trigger_type', 'trigger_value', 'trigger_conditions',
      'is_active', 'priority', 'response_type', 'response_message', 'response_media_url',
      'response_media_type', 'response_options', 'next_rule_id', 'end_flow',
      'only_for_individuals', 'auto_actions', 'fallback_message', 'expected_input_type',
      'context_variables', 'delay_seconds'
    ];

    for (const field of allowedFields) {
      if (field in updates) {
      if (['trigger_conditions', 'response_options', 'auto_actions', 'context_variables'].includes(field) && updates[field] !== null) {
        updateFields.push(`${field} = $${paramIndex++}::jsonb`);
        values.push(JSON.stringify(updates[field]));
      } else {
        updateFields.push(`${field} = $${paramIndex++}`);
        values.push(updates[field]);
      }
      }
    }

    if (updateFields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Validate trigger_type if provided
    const validTriggerTypes = [
      'keyword', 'exact_match', 'starts_with', 'ends_with',
      'match_all_keywords', 'match_any_keyword', 'regex', 'all',
      'first_message', 'message_type'
    ];
    if (updates.trigger_type && !validTriggerTypes.includes(updates.trigger_type)) {
      return NextResponse.json(
        { error: `trigger_type must be one of: ${validTriggerTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate response_type if provided
    const validResponseTypes = [
      'text', 'image', 'video', 'document', 'audio', 'list', 'button', 'template'
    ];
    if (updates.response_type && !validResponseTypes.includes(updates.response_type)) {
      return NextResponse.json(
        { error: `response_type must be one of: ${validResponseTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate regex if trigger_type is regex
    if (updates.trigger_type === 'regex' && updates.trigger_value) {
      try {
        new RegExp(updates.trigger_value);
      } catch (e) {
        return NextResponse.json({ error: 'Invalid regex pattern' }, { status: 400 });
      }
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(ruleId, business_id);

    const rule = await queryOne(
      `UPDATE whatsapp_bot_rules 
       SET ${updateFields.join(', ')}
       WHERE id = $${paramIndex++} AND business_id = $${paramIndex++}
       RETURNING *`,
      values
    );

    return NextResponse.json({ rule });
  } catch (error: any) {
    console.error('Error updating bot rule:', error);
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

    // Verify rule belongs to business
    const rule = await queryOne(
      `SELECT id FROM whatsapp_bot_rules WHERE id = $1 AND business_id = $2`,
      [ruleId, businessId]
    );

    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    // Delete rule (CASCADE will remove chains)
    await query(
      `DELETE FROM whatsapp_bot_rules WHERE id = $1 AND business_id = $2`,
      [ruleId, businessId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting bot rule:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

