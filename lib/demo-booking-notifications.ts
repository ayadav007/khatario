/**
 * Helper functions for demo booking notifications
 */

import * as db from './db';
import { sendWhatsAppMessage } from './whatsapp';

/**
 * Send WhatsApp notification to all active admins about a new demo booking
 * Note: This requires a platform WhatsApp setup. For now, we'll log the notification.
 * TODO: Configure platform-level WhatsApp business ID or use a specific business for platform notifications
 */
export async function notifyAdminsOfNewBooking(booking: {
  booking_number: string;
  name: string;
  email: string;
  phone: string;
  company_name?: string;
  scheduled_date: string;
  scheduled_time: string;
}) {
  try {
    // Get all active admins with phone numbers
    const admins = await db.queryRows(`
      SELECT id, name, email, phone 
      FROM platform_admins 
      WHERE is_active = true AND phone IS NOT NULL AND phone != ''
    `);

    if (admins.length === 0) {
      console.log('[Demo Booking] No admins with phone numbers found for WhatsApp notification');
      return;
    }

    const date = new Date(`${booking.scheduled_date}T${booking.scheduled_time}`);
    const formattedDate = date.toLocaleDateString('en-IN', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const message = `🎯 *New Demo Booking*\n\n` +
      `Booking #: ${booking.booking_number}\n` +
      `Name: ${booking.name}\n` +
      `Email: ${booking.email}\n` +
      `Phone: ${booking.phone}\n` +
      `${booking.company_name ? `Company: ${booking.company_name}\n` : ''}` +
      `Scheduled: ${formattedDate}\n\n` +
      `View: /admin/bookings`;

    // TODO: Replace with actual platform business ID when configured
    // For now, we'll attempt to send to a default business or log the notification
    // This needs to be configured based on your platform WhatsApp setup
    
    // Option 1: Use a platform-level business ID (if exists)
    // const platformBusinessId = process.env.PLATFORM_WHATSAPP_BUSINESS_ID;
    // if (platformBusinessId) {
    //   for (const admin of admins) {
    //     try {
    //       await sendWhatsAppMessage(
    //         platformBusinessId,
    //         admin.phone,
    //         message
    //       );
    //     } catch (err) {
    //       console.error(`[Demo Booking] Failed to send WhatsApp to admin ${admin.email}:`, err);
    //     }
    //   }
    // }

    // For now, log the notification (can be enhanced with email fallback or actual WhatsApp setup)
    console.log('[Demo Booking Notification]', {
      booking_number: booking.booking_number,
      admins_notified: admins.length,
      message_preview: message.substring(0, 100)
    });

    // Store notification in a log table or send email as fallback
    // This can be enhanced later when platform WhatsApp is configured

  } catch (error) {
    console.error('[Demo Booking] Error sending admin notifications:', error);
    // Don't throw - notification failure shouldn't break booking creation
  }
}

