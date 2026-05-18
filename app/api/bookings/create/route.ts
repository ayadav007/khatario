import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { notifyAdminsOfNewBooking } from '@/lib/demo-booking-notifications';

/**
 * POST /api/bookings/create
 * Create a new demo booking
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, phone, company_name, message, scheduled_date, scheduled_time, time_slot_id, lead_source } = body;

    // Validation
    if (!name || !email || !phone || !scheduled_date || !scheduled_time) {
      return NextResponse.json(
        { error: 'name, email, phone, scheduled_date, and scheduled_time are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Validate phone format (basic validation)
    const phoneRegex = /^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/;
    const cleanPhone = phone.replace(/\s+/g, '');
    if (!phoneRegex.test(cleanPhone)) {
      return NextResponse.json({ error: 'Invalid phone format' }, { status: 400 });
    }

    // Get IP address and user agent
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Generate booking number
    const bookingNumberResult = await queryOne(`
      SELECT generate_booking_number() as booking_number
    `);
    const bookingNumber = bookingNumberResult?.booking_number || `DEMO-${Date.now()}`;

    // Create booking
    const booking = await queryOne(
      `INSERT INTO demo_bookings (
        booking_number, name, email, phone, company_name, message,
        scheduled_date, scheduled_time, time_slot_id,
        lead_source, ip_address, user_agent, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
      RETURNING *`,
      [
        bookingNumber,
        name,
        email,
        cleanPhone,
        company_name || null,
        message || null,
        scheduled_date,
        scheduled_time,
        time_slot_id || null,
        lead_source || 'organic',
        ipAddress,
        userAgent
      ]
    );

    // Create initial activity for booking creation
    await query(
      `INSERT INTO booking_activities (booking_id, activity_type, title, description)
       VALUES ($1, 'status_change', 'Booking Created', 'New demo booking created by customer')`,
      [booking.id]
    );

    // Send WhatsApp notification to admins (async, don't wait)
    notifyAdminsOfNewBooking({
      booking_number: bookingNumber,
      name,
      email,
      phone: cleanPhone,
      company_name,
      scheduled_date,
      scheduled_time
    }).catch(err => {
      console.error('[Demo Booking] Notification error (non-blocking):', err);
    });

    return NextResponse.json({ 
      booking,
      message: 'Booking created successfully'
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating booking:', error);
    
    // Check for duplicate booking number (shouldn't happen but handle gracefully)
    if (error.message?.includes('booking_number') || error.code === '23505') {
      return NextResponse.json(
        { error: 'Booking number conflict. Please try again.' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to create booking' },
      { status: 500 }
    );
  }
}

