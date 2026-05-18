/**
 * API endpoint for WhatsApp CRM Dashboard Campaign Performance
 * GET /api/whatsapp/dashboard/campaigns
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Check if business has WhatsApp Bot addon — return empty data if not available
    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json({
        campaigns: { messages_sent: 0, delivered: 0, read: 0, failed: 0, responses_received: 0 }
      });
    }

    // Campaign performance metrics
    // Messages sent, delivered, read, failed, responses received
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
    // Return empty data instead of 500 so the dashboard still loads
    return NextResponse.json({
      campaigns: { messages_sent: 0, delivered: 0, read: 0, failed: 0, responses_received: 0 }
    });
  }
}

