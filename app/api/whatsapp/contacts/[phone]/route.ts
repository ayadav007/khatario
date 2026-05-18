/**
 * API endpoint for fetching contact information by phone number
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';

export async function GET(
  request: NextRequest,
  { params }: { params: { phone: string } }
) {
  try {
    const phone = decodeURIComponent(params.phone);
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

    // Normalize phone number (remove non-digits for comparison)
    const normalizedPhone = phone.replace(/\D/g, '');

    // Get conversation information by phone or conversation_id
    // Try multiple formats: exact match, with +, normalized digits only
    const conversation = await queryOne<any>(
      `SELECT 
        id,
        conversation_id,
        from_number,
        customer_id,
        created_at as first_seen,
        last_message_at as last_seen,
        status
       FROM whatsapp_conversations
       WHERE business_id = $1 
         AND (
           conversation_id = $2 
           OR conversation_id = $3
           OR conversation_id = $4
           OR REGEXP_REPLACE(conversation_id, '[^0-9]', '', 'g') = $5
           OR from_number = $2
           OR from_number = $3
           OR from_number = $4
           OR REGEXP_REPLACE(from_number, '[^0-9]', '', 'g') = $5
         )
       LIMIT 1`,
      [businessId, phone, phone.startsWith('+') ? phone : `+${phone}`, phone.replace(/^\+/, ''), normalizedPhone]
    );

    if (!conversation) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // Get customer information if linked
    let customer = null;
    if (conversation.customer_id) {
      customer = await queryOne<any>(
        `SELECT 
          id,
          name,
          phone,
          email,
          address,
          city,
          state,
          pincode,
          gstin,
          created_at
         FROM customers
         WHERE id = $1 AND business_id = $2`,
        [conversation.customer_id, businessId]
      );
    } else {
      // Try to find customer by phone number
      customer = await queryOne<any>(
        `SELECT 
          id,
          name,
          phone,
          email,
          address,
          city,
          state,
          pincode,
          gstin,
          created_at
         FROM customers
         WHERE business_id = $1 
           AND (
             phone = $2
             OR phone = $3
             OR REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = $4
           )
         LIMIT 1`,
        [businessId, phone, `+${phone}`, normalizedPhone]
      );
    }

    // Get message count
    const messageStats = await queryOne<{ total: number; first_message: string }>(
      `SELECT 
        COUNT(*)::int as total,
        MIN(created_at)::text as first_message
       FROM whatsapp_conversation_messages
       WHERE conversation_id = $1 AND business_id = $2`,
      [conversation.id, businessId]
    );

    // Determine source (campaign, qr, website, manual)
    // For now, we'll check if the first message was incoming or outgoing
    const firstMessage = await queryOne<{ direction: string }>(
      `SELECT direction
       FROM whatsapp_conversation_messages
       WHERE conversation_id = $1 AND business_id = $2
       ORDER BY created_at ASC, message_id ASC
       LIMIT 1`,
      [conversation.id, businessId]
    );

    const source = firstMessage?.direction === 'incoming' ? 'qr' : 'campaign'; // Simplified logic

    // Try to fetch profile picture from WhatsApp
    let profilePictureUrl: string | null = null;
    try {
      const { getWhatsAppSocket, getWhatsAppStatus } = await import('@/lib/whatsapp');
      const status = await getWhatsAppStatus(businessId);
      
      if (status.status === 'connected') {
        const session = await getWhatsAppSocket(businessId);
        if (session.socket && session.status === 'connected') {
          // Build JID from conversation_id (could be phone number or group JID)
          const jid = conversation.conversation_id?.includes('@') 
            ? conversation.conversation_id 
            : `${conversation.conversation_id || conversation.from_number}@s.whatsapp.net`;
          
          try {
            profilePictureUrl = await session.socket.profilePictureUrl(jid, 'image');
            // Cache in DB so the conversation list can use it without a live fetch
            if (profilePictureUrl) {
              const { query: dbQuery } = await import('@/lib/db');
              await dbQuery(
                `UPDATE whatsapp_conversations
                 SET profile_picture_url = $1, profile_picture_updated_at = NOW()
                 WHERE id = $2 AND business_id = $3`,
                [profilePictureUrl, conversation.id, businessId]
              ).catch(() => {}); // non-critical
            }
          } catch (err: any) {
            // Profile picture not available (404) or other error - this is normal
            console.log(`[Contact API] Profile picture not available for ${jid}:`, err.message);
            profilePictureUrl = null;
          }
        }
      }
    } catch (err) {
      console.error('[Contact API] Error fetching profile picture:', err);
      // Continue without profile picture
    }

    // Build contact info response
    const contactInfo = {
      conversation_id: conversation.id,
      phone: conversation.from_number || phone,
      whatsapp_id: conversation.conversation_id,
      first_seen: conversation.first_seen,
      last_seen: conversation.last_seen || conversation.first_seen,
      source: source,
      total_messages: messageStats?.total || 0,
      first_message_at: messageStats?.first_message || conversation.first_seen,
      profile_picture_url: profilePictureUrl,
      customer: customer ? {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        city: customer.city,
        state: customer.state,
        pincode: customer.pincode,
        gstin: customer.gstin,
        created_at: customer.created_at
      } : null
    };

    return NextResponse.json({ contact: contactInfo });
  } catch (error: any) {
    console.error('Error fetching contact info:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

