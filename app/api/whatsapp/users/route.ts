/**
 * API endpoint for fetching users/agents for WhatsApp conversation assignment
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
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

    // Fetch active users for the business
    const users = await queryRows(
      `SELECT 
        id,
        name,
        email,
        phone
       FROM users
       WHERE business_id = $1 AND is_active = true
       ORDER BY name ASC`,
      [businessId]
    );

    return NextResponse.json({ users });
  } catch (error: any) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

