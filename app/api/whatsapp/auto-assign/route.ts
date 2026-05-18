/**
 * GET  /api/whatsapp/auto-assign?business_id= — read current settings
 * PATCH /api/whatsapp/auto-assign?business_id= — update settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    if (!businessId) return NextResponse.json({ error: 'business_id is required' }, { status: 400 });

    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) return NextResponse.json({ error: 'WhatsApp Bot addon required.' }, { status: 403 });

    const row = await queryOne<{
      whatsapp_auto_assign_enabled: boolean;
      whatsapp_auto_assign_agent_ids: string[];
    }>(
      `SELECT whatsapp_auto_assign_enabled, whatsapp_auto_assign_agent_ids
       FROM business_settings WHERE business_id = $1`,
      [businessId]
    );

    return NextResponse.json({
      enabled: row?.whatsapp_auto_assign_enabled ?? false,
      agent_ids: row?.whatsapp_auto_assign_agent_ids ?? [],
    });
  } catch (error: any) {
    console.error('[Auto-Assign] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    if (!businessId) return NextResponse.json({ error: 'business_id is required' }, { status: 400 });

    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) return NextResponse.json({ error: 'WhatsApp Bot addon required.' }, { status: 403 });

    const { enabled, agent_ids } = await request.json();

    // Upsert business_settings row (some businesses may not have one yet)
    await query(
      `INSERT INTO business_settings (business_id, whatsapp_auto_assign_enabled, whatsapp_auto_assign_agent_ids, whatsapp_auto_assign_last_index)
       VALUES ($1, $2, $3::jsonb, 0)
       ON CONFLICT (business_id) DO UPDATE
       SET whatsapp_auto_assign_enabled   = $2,
           whatsapp_auto_assign_agent_ids = $3::jsonb,
           whatsapp_auto_assign_last_index = 0`,
      [businessId, !!enabled, JSON.stringify(Array.isArray(agent_ids) ? agent_ids : [])]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Auto-Assign] PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
