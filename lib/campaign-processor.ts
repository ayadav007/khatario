/**
 * WhatsApp Campaign Processor
 * Processes running campaigns and sends messages to recipients
 */

import { query, queryOne } from './db';
import { sendWhatsAppMessage } from './whatsapp';
import { getBusinessSubscription, isSubscriptionOperationalStatus } from './subscription';

interface Campaign {
  id: string;
  business_id: string;
  name: string;
  message_type: 'text' | 'image' | 'button';
  message_text: string;
  media_url?: string;
  media_type?: string;
  buttons?: any;
  footer?: string;
  status: string;
  delay_between_messages: number;
  random_delay_jitter: number;
  batch_size: number;
  pause_between_batches: number;
  daily_send_limit?: number;
  last_sent_at?: Date;
}

interface Recipient {
  id: string;
  phone: string;
  name?: string;
  status: string;
}

/**
 * Process a single campaign - sends messages to pending recipients
 */
export async function processCampaign(campaignId: string): Promise<{
  processed: number;
  sent: number;
  failed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let processed = 0;
  let sent = 0;
  let failed = 0;

  try {
    // Start transaction to prevent race conditions
    await query('BEGIN');
    
    try {
      // Get campaign details (lock the campaign row)
      const campaign = await queryOne(`
        SELECT 
          id, business_id, name, message_type, message_text, media_url, media_type, buttons, footer,
          status, delay_between_messages, random_delay_jitter, batch_size, 
          pause_between_batches, daily_send_limit, last_sent_at
        FROM whatsapp_campaigns
        WHERE id = $1 AND status = 'running'
        FOR UPDATE
      `, [campaignId]) as Campaign | null;

      if (!campaign) {
        await query('ROLLBACK');
        return { processed: 0, sent: 0, failed: 0, errors: ['Campaign not found or not running'] };
      }

      // CRITICAL: Check if business has active subscription
      // Skip processing if subscription is inactive or expired
      const subscription = await getBusinessSubscription(campaign.business_id);
      if (!subscription || !isSubscriptionOperationalStatus(subscription.status)) {
        await query('ROLLBACK');
        console.log(`Skipping campaign ${campaignId}: business ${campaign.business_id} subscription inactive or expired`);
        return { processed: 0, sent: 0, failed: 0, errors: ['Business subscription inactive or expired'] };
      }

      // Check if subscription has expired (if end_date is set)
      if (subscription.end_date) {
        const endDate = new Date(subscription.end_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (endDate < today) {
          await query('ROLLBACK');
          console.log(`Skipping campaign ${campaignId}: business ${campaign.business_id} subscription expired on ${subscription.end_date}`);
          return { processed: 0, sent: 0, failed: 0, errors: [`Business subscription expired on ${subscription.end_date}`] };
        }
      }

      // Check if we need to pause between batches
      if (campaign.last_sent_at) {
        const timeSinceLastSent = Date.now() - new Date(campaign.last_sent_at).getTime();
        const pauseMs = campaign.pause_between_batches * 1000;
        
        if (timeSinceLastSent < pauseMs) {
          // Still in pause period, skip processing
          await query('COMMIT');
          return { processed: 0, sent: 0, failed: 0, errors: [] };
        }
      }

      // Check daily send limit
      if (campaign.daily_send_limit) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        
        const sentToday = await queryOne(`
          SELECT COUNT(*) as count
          FROM whatsapp_campaign_recipients
          WHERE campaign_id = $1 
            AND status IN ('sent', 'delivered', 'read')
            AND sent_at >= $2
        `, [campaignId, todayStart]) as { count: number } | null;

        if (sentToday && parseInt(sentToday.count as any) >= campaign.daily_send_limit) {
          // Daily limit reached, pause campaign
          await query(`
            UPDATE whatsapp_campaigns
            SET status = 'paused', paused_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [campaignId]);
          await query('COMMIT');
          return { processed: 0, sent: 0, failed: 0, errors: ['Daily send limit reached'] };
        }
      }

      // Get pending recipients for this batch (use FOR UPDATE SKIP LOCKED to prevent duplicate processing)
      const recipients = await query(`
        SELECT id, phone, name, status
        FROM whatsapp_campaign_recipients
        WHERE campaign_id = $1 AND status = 'pending'
        ORDER BY created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      `, [campaignId, campaign.batch_size]) as { rows: Recipient[] };

      if (recipients.rows.length === 0) {
        await query('COMMIT');
        
        // Check if there are any pending recipients left (outside transaction)
        const remainingPending = await queryOne(`
          SELECT COUNT(*) as count
          FROM whatsapp_campaign_recipients
          WHERE campaign_id = $1 AND status = 'pending'
        `, [campaignId]) as { count: number } | null;

        // Only mark as completed if there are truly no pending recipients
        if (!remainingPending || parseInt(remainingPending.count as any) === 0) {
          await query(`
            UPDATE whatsapp_campaigns
            SET status = 'completed', completed_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'running'
          `, [campaignId]);
        }
        return { processed: 0, sent: 0, failed: 0, errors: [] };
      }

      // Process each recipient
      for (const recipient of recipients.rows) {
      processed++;
      
      try {
        // Prepare message content
        // Handle images for both 'image' type and 'button' type (buttons can have image headers)
        let media: string | Buffer | undefined = undefined;
        if ((campaign.message_type === 'image' || campaign.message_type === 'button') && campaign.media_url) {
          // Handle base64 data URLs
          if (campaign.media_url.startsWith('data:')) {
            // Extract base64 data
            const base64Data = campaign.media_url.split(',')[1];
            media = Buffer.from(base64Data, 'base64');
          } else {
            media = campaign.media_url;
          }
        }

        // Prepare buttons for button messages (preserve type, phone, url information)
        let buttons: Array<{ id: string; title: string; type?: 'quick_reply' | 'call' | 'url'; phone?: string; url?: string }> | undefined = undefined;
        if (campaign.message_type === 'button' && campaign.buttons) {
          console.log('[Campaign Processor] Processing button message. Raw buttons data:', campaign.buttons);
          const buttonsData = typeof campaign.buttons === 'string' 
            ? JSON.parse(campaign.buttons) 
            : campaign.buttons;
          
          console.log('[Campaign Processor] Parsed buttons data:', buttonsData);
          
          if (Array.isArray(buttonsData)) {
            buttons = buttonsData
              .filter((b: any) => {
                if (!b.id || !b.title) {
                  console.log('[Campaign Processor] Filtered out button (missing id/title):', b);
                  return false;
                }
                // For call and url buttons, validate phone/url fields
                if (b.type === 'call' && !b.phone) {
                  console.log('[Campaign Processor] Filtered out call button (missing phone):', b);
                  return false;
                }
                if (b.type === 'url' && !b.url) {
                  console.log('[Campaign Processor] Filtered out url button (missing url):', b);
                  return false;
                }
                return true;
              })
              .map((b: any) => ({
                id: b.id,
                title: b.title,
                type: b.type || 'quick_reply', // Default to quick_reply if type not specified
                phone: b.phone,
                url: b.url
              }));
            console.log('[Campaign Processor] Final buttons array:', buttons);
          } else {
            console.warn('[Campaign Processor] Buttons data is not an array:', typeof buttonsData);
          }
        } else {
          console.log('[Campaign Processor] Not processing buttons. message_type:', campaign.message_type, 'has buttons:', !!campaign.buttons);
        }

        // Send message
        // For button messages, footer is handled separately in the button format
        // For other message types, append footer to text
        let messageText = campaign.message_text;
        if (campaign.message_type !== 'button' && campaign.footer) {
          messageText = campaign.message_text + '\n\n' + campaign.footer;
        }
        
        console.log('[Campaign Processor] Sending message. Type:', campaign.message_type, 'Buttons:', buttons?.length || 0, 'Media:', !!media);
        
        const messageResult = await sendWhatsAppMessage(
          campaign.business_id,
          recipient.phone,
          messageText,
          media, // Pass media here
          campaign.message_type,
          buttons?.length ? buttons : undefined,
          campaign.footer // Pass footer for button messages
        );

        // Extract message ID - handle both string and object formats
        let messageId: string | null = null;
        if (messageResult) {
          if (typeof messageResult === 'string') {
            messageId = messageResult;
          } else if (typeof messageResult === 'object' && messageResult !== null) {
            // Type guard: check if it's an object with key property
            const msgResult = messageResult as any;
            if (msgResult.key && typeof msgResult.key === 'object' && 'id' in msgResult.key) {
              messageId = msgResult.key.id;
            } else if ('id' in msgResult) {
              messageId = msgResult.id;
            }
          }
        }

        // Log if message ID is missing, but don't fail - message might still be sent
        if (!messageId) {
          console.warn(`[Campaign Processor] ⚠️ Message sent to ${recipient.phone} but no message ID returned. Result:`, typeof messageResult, messageResult ? Object.keys(messageResult) : 'null');
        } else {
          console.log(`[Campaign Processor] Message sent to ${recipient.phone}, message ID: ${messageId}`);
        }

        // Update recipient status with message ID (only if still pending - prevents duplicate sends)
        const updateResult = await query(`
          UPDATE whatsapp_campaign_recipients
          SET status = 'sent', sent_at = CURRENT_TIMESTAMP, message_id = $1
          WHERE id = $2 AND status = 'pending'
        `, [messageId, recipient.id]) as { rowCount?: number };

        // If recipient was already processed (not pending anymore), skip updating counters
        if (updateResult.rowCount !== undefined && updateResult.rowCount === 0) {
          console.log(`[Campaign Processor] Recipient ${recipient.id} already processed, skipping duplicate send`);
          processed--; // Don't count as processed
          continue; // Skip to next recipient
        }

        // Update campaign counters
        await query(`
          UPDATE whatsapp_campaigns
          SET sent_count = sent_count + 1,
              pending_count = pending_count - 1,
              last_sent_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [campaignId]);

        sent++;

        // Apply delay between messages (with random jitter)
        if (processed < recipients.rows.length) {
          const baseDelay = campaign.delay_between_messages * 1000;
          const jitter = Math.random() * 2 * campaign.random_delay_jitter * 1000 - campaign.random_delay_jitter * 1000;
          const delay = Math.max(1000, baseDelay + jitter); // Minimum 1 second
          await new Promise(resolve => setTimeout(resolve, delay));
        }

      } catch (error: any) {
        console.error(`[Campaign Processor] Error sending to ${recipient.phone}:`, error);
        failed++;
        errors.push(`${recipient.phone}: ${error.message}`);

        // Update recipient status to failed (only if still pending)
        const failResult = await query(`
          UPDATE whatsapp_campaign_recipients
          SET status = 'failed', error_message = $1, sent_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND status = 'pending'
        `, [error.message || 'Send failed', recipient.id]) as { rowCount?: number };

        // Only update counters if the recipient was actually updated
        if (failResult && (failResult.rowCount === undefined || failResult.rowCount > 0)) {
          await query(`
            UPDATE whatsapp_campaigns
            SET failed_count = failed_count + 1,
                pending_count = GREATEST(0, pending_count - 1),
                last_sent_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [campaignId]);
        }
      }
    }

      // Commit transaction after processing batch
      await query('COMMIT');
    } catch (txError: any) {
      await query('ROLLBACK');
      throw txError;
    }

    // Check if campaign is complete (after transaction commits)
    const remaining = await queryOne(`
      SELECT COUNT(*) as count
      FROM whatsapp_campaign_recipients
      WHERE campaign_id = $1 AND status = 'pending'
    `, [campaignId]) as { count: number } | null;

    if (remaining && parseInt(remaining.count as any) === 0) {
      await query(`
        UPDATE whatsapp_campaigns
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'running'
      `, [campaignId]);
    }

    return { processed, sent, failed, errors };

  } catch (error: any) {
    console.error(`[Campaign Processor] Error processing campaign ${campaignId}:`, error);
    errors.push(`Campaign processing error: ${error.message}`);
    return { processed, sent, failed, errors };
  }
}

/**
 * Process all running campaigns
 */
export async function processAllCampaigns(): Promise<{
  campaignsProcessed: number;
  totalSent: number;
  totalFailed: number;
  results: Array<{ campaignId: string; processed: number; sent: number; failed: number; errors: string[] }>;
}> {
  try {
    // Get all running campaigns
    const campaigns = await query(`
      SELECT id
      FROM whatsapp_campaigns
      WHERE status = 'running'
      ORDER BY started_at ASC
    `) as { rows: Array<{ id: string }> };

    const results: Array<{ campaignId: string; processed: number; sent: number; failed: number; errors: string[] }> = [];
    let totalSent = 0;
    let totalFailed = 0;

    for (const campaign of campaigns.rows) {
      const result = await processCampaign(campaign.id);
      results.push({
        campaignId: campaign.id,
        ...result
      });
      totalSent += result.sent;
      totalFailed += result.failed;
    }

    return {
      campaignsProcessed: campaigns.rows.length,
      totalSent,
      totalFailed,
      results
    };

  } catch (error: any) {
    console.error('[Campaign Processor] Error processing all campaigns:', error);
    throw error;
  }
}

