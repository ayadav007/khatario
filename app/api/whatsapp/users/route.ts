export const dynamic = 'force-dynamic';

/**
 * API endpoint for fetching users/agents for WhatsApp conversation assignment
 */

import { NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

export const GET = withWhatsAppPremiumApi({}, async ({ businessId }) => {
  try {
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
});
