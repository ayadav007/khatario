import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * POST /api/admin/bookings/[id]/activities
 * Add activity to booking (Admin only)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { admin_id: _ignored, activity_type, title, description, metadata, whatsapp_message, phone } = body;
    const bookingId = params.id;

    const admin = auth.admin;

    // Verify booking exists
    const booking = await queryOne('SELECT * FROM demo_bookings WHERE id = $1', [bookingId]);
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    if (!activity_type || !title) {
      return NextResponse.json({ error: 'activity_type and title are required' }, { status: 400 });
    }

    const validTypes = ['status_change', 'note_added', 'call_logged', 'email_sent', 'whatsapp_sent', 'follow_up_set'];
    if (!validTypes.includes(activity_type)) {
      return NextResponse.json({ error: `Invalid activity_type. Must be one of: ${validTypes.join(', ')}` }, { status: 400 });
    }

    let activityMetadata = metadata || {};

    // Handle WhatsApp message sending
    if (activity_type === 'whatsapp_sent' && whatsapp_message) {
      const targetPhone = phone || booking.phone;
      
      // TODO: Replace with platform business ID or configure appropriately
      // For now, we'll attempt to send and store the result in metadata
      try {
        // Option 1: Use platform business ID if configured
        // const platformBusinessId = process.env.PLATFORM_WHATSAPP_BUSINESS_ID;
        // if (platformBusinessId) {
        //   const result = await sendWhatsAppMessage(
        //     platformBusinessId,
        //     targetPhone,
        //     whatsapp_message
        //   );
        //   activityMetadata = {
        //     ...activityMetadata,
        //     phone: targetPhone,
        //     message: whatsapp_message,
        //     sent: true,
        //     messageId: result.messageId
        //   };
        // } else {
        //   throw new Error('Platform WhatsApp not configured');
        // }

        // For now, log the WhatsApp attempt
        console.log('[Booking Activity] WhatsApp message would be sent:', {
          bookingId,
          phone: targetPhone,
          message: whatsapp_message.substring(0, 50)
        });
        
        activityMetadata = {
          ...activityMetadata,
          phone: targetPhone,
          message: whatsapp_message,
          sent: false,
          note: 'WhatsApp sending needs platform business ID configuration'
        };
      } catch (error: any) {
        console.error('[Booking Activity] WhatsApp send error:', error);
        activityMetadata = {
          ...activityMetadata,
          error: error.message,
          sent: false
        };
      }
    }

    // Create activity
    const activity = await queryOne(
      `INSERT INTO booking_activities (booking_id, activity_type, title, description, performed_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING *`,
      [bookingId, activity_type, title, description || null, admin.id, JSON.stringify(activityMetadata)]
    );

    return NextResponse.json({ activity }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating activity:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

