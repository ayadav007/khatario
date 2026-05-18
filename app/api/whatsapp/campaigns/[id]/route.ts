import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { getWhatsAppStatus } from '@/lib/whatsapp';

/**
 * GET /api/whatsapp/campaigns/[id]
 * Get campaign details with recipients
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const campaignId = params.id;

    const campaign = await queryOne(`
      SELECT 
        id, business_id, name, message_type, message_text, media_url, media_type, buttons, footer,
        status, total_recipients, sent_count, failed_count, pending_count,
        delay_between_messages, random_delay_jitter, batch_size, pause_between_batches, daily_send_limit,
        started_at, completed_at, paused_at, last_sent_at,
        created_at, updated_at
      FROM whatsapp_campaigns
      WHERE id = $1
    `, [campaignId]);

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Get recipients
    const recipients = await query(`
      SELECT 
        id, phone, name, status, error_message,
        message_id, sent_at, delivered_at, read_at,
        button_clicked_id, button_clicked_at,
        created_at, updated_at
      FROM whatsapp_campaign_recipients
      WHERE campaign_id = $1
      ORDER BY created_at ASC
    `, [campaignId]);

    return NextResponse.json({
      campaign: {
        ...campaign,
        buttons: campaign.buttons ? JSON.parse(campaign.buttons as any) : null,
      },
      recipients: recipients.rows,
    });
  } catch (error: any) {
    console.error('Error getting campaign:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/whatsapp/campaigns/[id]
 * Update campaign (start, pause, resume)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const campaignId = params.id;
    const body = await request.json();
    const { action } = body; // 'start', 'pause', 'resume'

    const campaign = await queryOne(`
      SELECT business_id, status FROM whatsapp_campaigns WHERE id = $1
    `, [campaignId]);

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Check subscription
    const hasAddon = await hasWhatsAppBotAddon((campaign as any).business_id);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required' },
        { status: 403 }
      );
    }

    const currentStatus = (campaign as any).status;

    if (action === 'start') {
      if (currentStatus !== 'draft' && currentStatus !== 'paused') {
        return NextResponse.json(
          { error: `Cannot start campaign with status: ${currentStatus}` },
          { status: 400 }
        );
      }

      // Check if WhatsApp is connected before starting
      const whatsappStatus = await getWhatsAppStatus((campaign as any).business_id);
      if (whatsappStatus.status !== 'connected') {
        return NextResponse.json(
          { 
            error: 'WhatsApp is not connected. Please connect your WhatsApp account via Settings before starting a campaign.',
            whatsappStatus: whatsappStatus.status 
          },
          { status: 400 }
        );
      }

      await query(`
        UPDATE whatsapp_campaigns
        SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), paused_at = NULL
        WHERE id = $1
      `, [campaignId]);
      
      // Trigger campaign processor immediately (fire and forget)
      try {
        // Import and process this campaign immediately
        const { processCampaign } = await import('@/lib/campaign-processor');
        // Don't await - let it run in background
        processCampaign(campaignId).catch(err => {
          console.error(`[Campaign API] Error processing campaign ${campaignId} after start:`, err);
        });
      } catch (err) {
        console.error('[Campaign API] Error importing campaign processor:', err);
      }
    } else if (action === 'pause') {
      if (currentStatus !== 'running') {
        return NextResponse.json(
          { error: `Cannot pause campaign with status: ${currentStatus}` },
          { status: 400 }
        );
      }
      await query(`
        UPDATE whatsapp_campaigns
        SET status = 'paused', paused_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [campaignId]);
    } else if (action === 'resume') {
      if (currentStatus !== 'paused') {
        return NextResponse.json(
          { error: `Cannot resume campaign with status: ${currentStatus}` },
          { status: 400 }
        );
      }

      // Check if WhatsApp is connected before resuming
      const whatsappStatus = await getWhatsAppStatus((campaign as any).business_id);
      if (whatsappStatus.status !== 'connected') {
        return NextResponse.json(
          { 
            error: 'WhatsApp is not connected. Please connect your WhatsApp account via Settings before resuming a campaign.',
            whatsappStatus: whatsappStatus.status 
          },
          { status: 400 }
        );
      }

      await query(`
        UPDATE whatsapp_campaigns
        SET status = 'running', paused_at = NULL
        WHERE id = $1
      `, [campaignId]);
      
      // Trigger campaign processor immediately (fire and forget)
      try {
        const { processCampaign } = await import('@/lib/campaign-processor');
        processCampaign(campaignId).catch(err => {
          console.error(`[Campaign API] Error processing campaign ${campaignId} after resume:`, err);
        });
      } catch (err) {
        console.error('[Campaign API] Error importing campaign processor:', err);
      }
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Must be: start, pause, or resume' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating campaign:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/whatsapp/campaigns/[id]
 * Delete campaign and all related data
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const campaignId = params.id;
    const businessId = request.nextUrl.searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Check subscription
    const hasAccess = await hasWhatsAppBotAddon(businessId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'WhatsApp Bot add-on required' }, { status: 403 });
    }

    // Verify campaign belongs to business
    const campaign = await queryOne(`
      SELECT business_id, status FROM whatsapp_campaigns WHERE id = $1
    `, [campaignId]);

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    if (campaign.business_id !== businessId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Prevent deletion of running campaigns
    if (campaign.status === 'running') {
      return NextResponse.json({ error: 'Cannot delete a running campaign. Please pause it first.' }, { status: 400 });
    }

    // Delete in transaction: recipients first (foreign key), then campaign
    await query('BEGIN');
    try {
      // Delete all recipients
      await query(`
        DELETE FROM whatsapp_campaign_recipients
        WHERE campaign_id = $1
      `, [campaignId]);

      // Delete campaign
      await query(`
        DELETE FROM whatsapp_campaigns
        WHERE id = $1
      `, [campaignId]);

      await query('COMMIT');
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }

    return NextResponse.json({ success: true, message: 'Campaign deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting campaign:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

