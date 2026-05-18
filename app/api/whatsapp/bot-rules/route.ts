/**
 * API endpoint for managing WhatsApp bot rules
 * GET - Get all bot rules for a business
 * POST - Create a new bot rule
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';

export async function GET(request: NextRequest) {
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

    const rules = await queryRows(
      `SELECT id, name, category, trigger_type, trigger_value, trigger_conditions,
              is_active, priority, response_type, response_message, response_media_url,
              response_media_type, response_options, next_rule_id, end_flow,
              only_for_individuals, auto_actions, fallback_message, expected_input_type,
              context_variables, delay_seconds, created_at, updated_at
       FROM whatsapp_bot_rules
       WHERE business_id = $1
       ORDER BY priority DESC, name ASC`,
      [businessId]
    );

    return NextResponse.json({ rules });
  } catch (error: any) {
    console.error('Error fetching bot rules:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id } = body;

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

    const {
      name,
      category,
      trigger_type = 'keyword',
      trigger_value,
      trigger_conditions,
      is_active = true,
      priority = 0,
      response_type = 'text',
      response_message,
      response_media_url,
      response_media_type,
      response_options,
      next_rule_id,
      end_flow = false,
      only_for_individuals = true,
      auto_actions,
      fallback_message,
      expected_input_type,
      context_variables,
      delay_seconds = 0
    } = body;

    if (!name || !trigger_value || !response_message) {
      return NextResponse.json(
        { error: 'name, trigger_value, and response_message are required' },
        { status: 400 }
      );
    }

    // Validate trigger_type (expanded list)
    const validTriggerTypes = [
      'keyword', 'exact_match', 'starts_with', 'ends_with', 
      'match_all_keywords', 'match_any_keyword', 'regex', 'all',
      'first_message', 'message_type'
    ];
    if (!validTriggerTypes.includes(trigger_type)) {
      return NextResponse.json(
        { error: `trigger_type must be one of: ${validTriggerTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate response_type (expanded list)
    const validResponseTypes = [
      'text', 'image', 'video', 'document', 'audio', 'list', 'button', 'template'
    ];
    if (!validResponseTypes.includes(response_type)) {
      return NextResponse.json(
        { error: `response_type must be one of: ${validResponseTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // If response_type is list or button, validate response_options
    if ((response_type === 'list' || response_type === 'button') && !response_options) {
      return NextResponse.json(
        { error: 'response_options is required for list and button response types' },
        { status: 400 }
      );
    }

    // Validate regex if trigger_type is regex
    if (trigger_type === 'regex') {
      try {
        new RegExp(trigger_value);
      } catch (e) {
        return NextResponse.json({ error: 'Invalid regex pattern' }, { status: 400 });
      }
    }

    const rule = await queryOne(
      `INSERT INTO whatsapp_bot_rules 
       (business_id, name, category, trigger_type, trigger_value, trigger_conditions, 
        is_active, priority, response_type, response_message, response_media_url, 
        response_media_type, response_options, next_rule_id, end_flow, only_for_individuals,
        auto_actions, fallback_message, expected_input_type, context_variables, delay_seconds)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17::jsonb, $18, $19, $20::jsonb, $21)
       ON CONFLICT (business_id, name) DO UPDATE
       SET category = EXCLUDED.category,
           trigger_type = EXCLUDED.trigger_type,
           trigger_value = EXCLUDED.trigger_value,
           trigger_conditions = EXCLUDED.trigger_conditions,
           is_active = EXCLUDED.is_active,
           priority = EXCLUDED.priority,
           response_type = EXCLUDED.response_type,
           response_message = EXCLUDED.response_message,
           response_media_url = EXCLUDED.response_media_url,
           response_media_type = EXCLUDED.response_media_type,
           response_options = EXCLUDED.response_options,
           next_rule_id = EXCLUDED.next_rule_id,
           end_flow = EXCLUDED.end_flow,
           only_for_individuals = EXCLUDED.only_for_individuals,
           auto_actions = EXCLUDED.auto_actions,
           fallback_message = EXCLUDED.fallback_message,
           expected_input_type = EXCLUDED.expected_input_type,
           context_variables = EXCLUDED.context_variables,
           delay_seconds = EXCLUDED.delay_seconds,
           updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        business_id,
        name.trim(),
        category?.trim() || null,
        trigger_type,
        trigger_value?.trim() || '',
        trigger_conditions ? JSON.stringify(trigger_conditions) : null,
        is_active,
        priority,
        response_type,
        response_message.trim(),
        response_media_url?.trim() || null,
        response_media_type || null,
        response_options ? JSON.stringify(response_options) : null,
        next_rule_id || null,
        end_flow,
        only_for_individuals,
        auto_actions ? JSON.stringify(auto_actions) : null,
        fallback_message?.trim() || null,
        expected_input_type || null,
        context_variables ? JSON.stringify(context_variables) : null,
        delay_seconds || 0
      ]
    );

    return NextResponse.json({ rule });
  } catch (error: any) {
    console.error('Error creating bot rule:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

