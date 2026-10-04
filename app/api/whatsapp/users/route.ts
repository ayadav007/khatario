export const dynamic = 'force-dynamic';

/**
 * Team members for the inbox: Transfer list (with online/offline) and agent rules.
 */

import { NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { ONLINE_WINDOW_SECONDS } from '@/lib/whatsapp/inbox-ownership';

export const GET = withWhatsAppPremiumApi({ inboxPermission: 'read' }, async ({ businessId }) => {
  try {
    const users = await queryRows(
      `SELECT 
        u.id,
        u.name,
        u.email,
        u.phone,
        COALESCE(u.inbox_last_seen_at > NOW() - make_interval(secs => $2), false) AS online,
        (
          COALESCE(u.is_primary_admin, false)
          OR EXISTS (
            SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = u.role_id AND rp.module_key = 'whatsapp_inbox' AND rp.can_view = true
          )
        ) AS can_receive
       FROM users u
       WHERE u.is_active = true
         AND (u.business_id = $1
              OR EXISTS (SELECT 1 FROM user_businesses ub WHERE ub.user_id = u.id AND ub.business_id = $1))
       ORDER BY u.name ASC`,
      [businessId, ONLINE_WINDOW_SECONDS]
    );

    return NextResponse.json({ users });
  } catch (error: any) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
