export const dynamic = 'force-dynamic';

/**
 * API endpoint for WhatsApp CRM Dashboard Campaign Performance
 * GET /api/whatsapp/dashboard/campaigns
 */

import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

export const GET = withWhatsAppPremiumApi({}, async ({ businessId }) => {
  try {
    const campaignStats = await queryOne<{
      messages_sent: number;
      delivered: number;
      read: number;
      failed: number;
      responses_received: number;
    }>(`
      SELECT 
        COUNT(*)::int as messages_sent,
        COUNT(*) FILTER (WHERE cr.status IN ('delivered', 'read'))::int as delivered,
        COUNT(*) FILTER (WHERE cr.status = 'read')::int as read,
        COUNT(*) FILTER (WHERE cr.status = 'failed')::int as failed,
        (
          SELECT COUNT(DISTINCT cr.id)::int
          FROM whatsapp_campaign_recipients cr
          INNER JOIN whatsapp_campaigns c ON c.id = cr.campaign_id
          WHERE c.business_id = $1
            AND cr.button_clicked_at IS NOT NULL
        ) as responses_received
      FROM whatsapp_campaign_recipients cr
      INNER JOIN whatsapp_campaigns c ON c.id = cr.campaign_id
      WHERE c.business_id = $1
        AND cr.status != 'pending'
    `, [businessId]);

    return NextResponse.json({
      campaigns: campaignStats || {
        messages_sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        responses_received: 0
      }
    });
  } catch (error: any) {
    console.error('Error fetching campaign performance:', error);
    return NextResponse.json({
      campaigns: { messages_sent: 0, delivered: 0, read: 0, failed: 0, responses_received: 0 }
    });
  }
});
