import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { getWhatsAppStatus } from '@/lib/whatsapp';

/**
 * GET /api/whatsapp/campaigns
 * List campaigns for a business with optional search, status filter, and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const businessId = searchParams.get('business_id');
    const search = (searchParams.get('search') || '').trim();
    const status = searchParams.get('status') || 'all';
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);
    
    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Check subscription
    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required' },
        { status: 403 }
      );
    }

    const baseWhere = 'WHERE business_id = $1';
    const listParams: any[] = [businessId];
    let p = 2;
    let filterSql = '';

    if (search) {
      filterSql += ` AND (name ILIKE $${p} OR message_text ILIKE $${p})`;
      listParams.push(`%${search}%`);
      p++;
    }
    if (status && status !== 'all') {
      filterSql += ` AND status = $${p}`;
      listParams.push(status);
      p++;
    }

    const countResult = await query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM whatsapp_campaigns ${baseWhere}${filterSql}`,
      listParams
    );
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    const limitIdx = p;
    const offsetIdx = p + 1;
    const campaigns = await query(
      `
      SELECT 
        id, name, message_type, message_text, media_url, media_type, buttons, footer,
        status, total_recipients, sent_count, failed_count, pending_count,
        delay_between_messages, random_delay_jitter, batch_size, pause_between_batches, daily_send_limit,
        started_at, completed_at, paused_at, last_sent_at,
        created_at, updated_at
      FROM whatsapp_campaigns
      ${baseWhere}${filterSql}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
      [...listParams, limit, offset]
    );

    // NOTE: Campaign processing is handled separately via:
    // 1. Explicit start action (PATCH /api/whatsapp/campaigns/[id] with action=start)
    // 2. Cron job (/api/cron/process-campaigns)
    // Do NOT trigger processing here to avoid duplicate sends

    return NextResponse.json({ campaigns: campaigns.rows, total });
  } catch (error: any) {
    console.error('Error listing campaigns:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/whatsapp/campaigns
 * Create a new campaign
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let body: any;

    // Handle FormData (for image uploads)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      body = {
        business_id: formData.get('business_id') as string,
        name: formData.get('name') as string,
        message_type: formData.get('message_type') as string,
        message_text: formData.get('message_text') as string,
        image: formData.get('image') as File | null,
        footer: formData.get('footer') as string,
        buttons: formData.get('buttons') ? JSON.parse(formData.get('buttons') as string) : null,
        recipients: formData.get('recipients') ? JSON.parse(formData.get('recipients') as string) : [],
        delay_between_messages: parseInt(formData.get('delay_between_messages') as string) || 2,
        random_delay_jitter: parseInt(formData.get('random_delay_jitter') as string) || 2,
        batch_size: parseInt(formData.get('batch_size') as string) || 20,
        pause_between_batches: parseInt(formData.get('pause_between_batches') as string) || 120,
        daily_send_limit: formData.get('daily_send_limit') ? parseInt(formData.get('daily_send_limit') as string) : null,
      };
    } else {
      // Handle JSON
      body = await request.json();
    }
    const {
      business_id,
      name,
      message_type,
      message_text,
      media_url,
      media_type,
      buttons,
      footer,
      recipients,
      delay_between_messages = 2,
      random_delay_jitter = 2,
      batch_size = 20,
      pause_between_batches = 120,
      daily_send_limit,
    } = body;

    if (!business_id || !name || !message_text || !recipients || !Array.isArray(recipients)) {
      return NextResponse.json(
        { error: 'Missing required fields: business_id, name, message_text, recipients' },
        { status: 400 }
      );
    }

    // Check subscription
    const hasAddon = await hasWhatsAppBotAddon(business_id);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required' },
        { status: 403 }
      );
    }

    // Validate recipients
    const validRecipients = recipients.filter((r: any) => r.phone && r.phone.length >= 9 && r.phone.length <= 15);
    if (validRecipients.length === 0) {
      return NextResponse.json(
        { error: 'No valid recipients provided' },
        { status: 400 }
      );
    }

    // Check unsubscribe list and filter out unsubscribed numbers
    let filteredRecipients = validRecipients;
    let unsubscribedCount = 0;
    
    try {
      const phones = validRecipients.map((r: any) => r.phone);
      const unsubscribesResult = await query(`
        SELECT phone FROM whatsapp_unsubscribes 
        WHERE business_id = $1 AND phone = ANY($2)
      `, [business_id, phones]);
      
      const unsubscribedPhones = new Set(unsubscribesResult.rows.map((r: any) => r.phone));
      unsubscribedCount = unsubscribedPhones.size;
      
      if (unsubscribedCount > 0) {
        filteredRecipients = validRecipients.filter((r: any) => !unsubscribedPhones.has(r.phone));
        console.log(`[Campaign API] Filtered out ${unsubscribedCount} unsubscribed numbers`);
      }
    } catch (error) {
      console.error('[Campaign API] Error checking unsubscribe list:', error);
      // Continue with original recipients if check fails
    }

    if (filteredRecipients.length === 0) {
      return NextResponse.json(
        { error: 'All recipients have unsubscribed' },
        { status: 400 }
      );
    }

    // Extract scheduled_at if provided
    const scheduled_at = body.scheduled_at ? new Date(body.scheduled_at) : null;
    
    // Handle media URL and type
    let finalMediaUrl = media_url || null;
    let finalMediaType = media_type || null;
    
    // Handle media: either from file upload or media library URL
    if ((message_type === 'image' || message_type === 'button') && finalMediaUrl) {
      // Media URL provided (from media library)
      finalMediaType = 'image';
    } else if ((message_type === 'image' || message_type === 'button') && body.image && body.image instanceof File) {
      // File upload (legacy support - but should use media library)
      try {
        // Convert file to base64 data URL (similar to /api/upload/image)
        const bytes = await body.image.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const base64 = buffer.toString('base64');
        finalMediaUrl = `data:${body.image.type};base64,${base64}`;
        finalMediaType = body.image.type.startsWith('image/') ? 'image' : 'document';
      } catch (error: any) {
        console.error('[Campaign API] Error processing image file:', error);
        return NextResponse.json(
          { error: `Failed to process image file: ${error.message}` },
          { status: 400 }
        );
      }
    } else if (message_type === 'image' && !finalMediaUrl) {
      // If it's an image type but no URL provided, set type anyway
      finalMediaType = 'image';
    }

    // Determine initial status and whether to auto-start
    // If scheduled_at is provided, set status to 'draft' (will start later)
    // If scheduled_at is null, auto-start (set to 'running' and check WhatsApp connection)
    let initialStatus = 'draft';
    let shouldAutoStart = false;
    
    if (!scheduled_at) {
      // Check WhatsApp connection before auto-starting
      const whatsappStatus = await getWhatsAppStatus(business_id);
      if (whatsappStatus.status === 'connected') {
        initialStatus = 'running';
        shouldAutoStart = true;
      } else {
        // WhatsApp not connected - keep as draft, user will need to start manually after connecting
        initialStatus = 'draft';
      }
    }

    // Start transaction
    await query('BEGIN');

    try {
      // Create campaign
      const campaignResult = await queryOne(`
        INSERT INTO whatsapp_campaigns (
          business_id, name, message_type, message_text, media_url, media_type, buttons, footer,
          status, total_recipients, scheduled_at,
          delay_between_messages, random_delay_jitter, batch_size, pause_between_batches, daily_send_limit,
          started_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id
      `, [
        business_id,
        name,
        message_type || 'text',
        message_text,
        finalMediaUrl,
        finalMediaType,
        buttons ? JSON.stringify(buttons) : null,
        footer || null,
        initialStatus,
        filteredRecipients.length,
        scheduled_at,
        delay_between_messages,
        random_delay_jitter,
        batch_size,
        pause_between_batches,
        daily_send_limit || null,
        shouldAutoStart ? new Date() : null, // Set started_at if auto-starting
      ]);

      const campaignId = (campaignResult as any).id;

      // Insert recipients (excluding unsubscribed)
      for (const recipient of filteredRecipients) {
        await query(`
          INSERT INTO whatsapp_campaign_recipients (campaign_id, phone, name, status)
          VALUES ($1, $2, $3, 'pending')
        `, [campaignId, recipient.phone, recipient.name || null]);
      }

      // Update pending count
      await query(`
        UPDATE whatsapp_campaigns
        SET pending_count = $1
        WHERE id = $2
      `, [filteredRecipients.length, campaignId]);

      await query('COMMIT');

      // If auto-starting, trigger campaign processor (fire and forget)
      if (shouldAutoStart) {
        try {
          const { processCampaign } = await import('@/lib/campaign-processor');
          // Don't await - let it run in background
          processCampaign(campaignId).catch(err => {
            console.error(`[Campaign API] Error processing campaign ${campaignId} after auto-start:`, err);
          });
        } catch (err) {
          console.error('[Campaign API] Error importing campaign processor:', err);
        }
      }

      return NextResponse.json({
        success: true,
        campaign_id: campaignId,
        total_recipients: filteredRecipients.length,
        unsubscribed_count: unsubscribedCount,
        status: initialStatus,
        auto_started: shouldAutoStart,
        message: unsubscribedCount > 0
          ? `Campaign created. ${unsubscribedCount} unsubscribed contact(s) excluded. ${shouldAutoStart ? 'Campaign started automatically.' : ''}`
          : shouldAutoStart 
            ? 'Campaign created and started automatically' 
            : scheduled_at 
              ? 'Campaign created and scheduled'
              : 'Campaign created. Please connect WhatsApp and start manually.',
      });
    } catch (err) {
      await query('ROLLBACK');
      throw err;
    }
  } catch (error: any) {
    console.error('Error creating campaign:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

