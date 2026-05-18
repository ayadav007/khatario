import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { sendReminderMessage } from '@/lib/reminder-message-processor';
import { checkLimit } from '@/lib/subscription';

/**
 * POST /api/customers/[id]/send-reminder
 * Send WhatsApp reminders for all outstanding invoices of a customer
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { business_id } = await request.json();
    const customerId = params.id;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Get customer details
    const customer = await db.queryOne(
      'SELECT id, name, phone FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [customerId, business_id]
    );

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    if (!customer.phone || customer.phone.trim() === '') {
      return NextResponse.json(
        { error: 'Customer phone number not available' },
        { status: 400 }
      );
    }

    // Get reminder settings (optional - use default if not configured)
    let settings;
    try {
      settings = await db.queryOne(
        `SELECT enabled, message_template, include_pdf
         FROM whatsapp_reminder_settings
         WHERE business_id = $1 AND reminder_type = 'payment_due'`,
        [business_id]
      );
    } catch (settingsError) {
      // Settings query failed - use default template
      console.warn('Failed to fetch reminder settings, using default:', settingsError);
      settings = null;
    }

    // Get all outstanding invoices for this customer
    const invoices = await db.queryRows(
      `SELECT 
        id,
        invoice_number,
        due_date,
        payment_status,
        grand_total,
        balance_amount
       FROM invoices
       WHERE customer_id = $1
         AND business_id = $2
         AND deleted_at IS NULL
         AND status = 'final'
         AND payment_status IN ('unpaid', 'partially_paid')
         AND balance_amount > 0
       ORDER BY invoice_date ASC`,
      [customerId, business_id]
    );

    if (invoices.length === 0) {
      return NextResponse.json(
        {
          success: true,
          sent: 0,
          failed: 0,
          total: 0,
          reason: 'no_outstanding_invoices',
          message:
            'No invoices qualify for a payment reminder. Reminders are only sent for final tax invoices that are unpaid or partly paid (proforma and drafts are excluded).',
        },
        { status: 200 }
      );
    }

    // Check subscription limits (this handles free plan restrictions)
    let limitCheck;
    try {
      limitCheck = await checkLimit(business_id, 'whatsapp');
    } catch (limitError: any) {
      console.error('Error checking WhatsApp limit:', limitError);
      return NextResponse.json(
        { 
          error: 'Failed to check subscription limits',
          details: limitError?.message || 'Unknown error'
        },
        { status: 500 }
      );
    }

    if (!limitCheck.allowed) {
      return NextResponse.json(
        { 
          error: limitCheck.message || 'WhatsApp message limit exceeded',
          code: 'LIMIT_EXCEEDED',
          current: limitCheck.current,
          limit: limitCheck.limit
        },
        { status: 403 }
      );
    }

    // Check if sending all reminders would exceed limit
    if (limitCheck.limit !== -1 && (limitCheck.current + invoices.length) > limitCheck.limit) {
      return NextResponse.json(
        {
          error: `Cannot send ${invoices.length} reminders. Daily limit would be exceeded (${limitCheck.current + invoices.length}/${limitCheck.limit})`,
          code: 'LIMIT_EXCEEDED',
          current: limitCheck.current,
          limit: limitCheck.limit
        },
        { status: 403 }
      );
    }

    // Use default template if settings don't exist or are disabled
    const messageTemplate = (settings?.enabled && settings?.message_template) 
      ? settings.message_template 
      : getDefaultTemplate();
    const includePdf = settings?.include_pdf !== false;

    // Send reminder for each invoice
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const invoice of invoices) {
      try {
        const result = await sendReminderMessage(
          invoice.id,
          business_id,
          messageTemplate,
          includePdf,
          'manual'
        );

        if (result.success) {
          sent++;
        } else {
          failed++;
          errors.push(`${invoice.invoice_number}: ${result.error || 'Failed to send'}`);
        }
      } catch (error: any) {
        failed++;
        errors.push(`${invoice.invoice_number}: ${error.message || 'Unknown error'}`);
      }
    }

    return NextResponse.json({
      success: true,
      sent,
      failed,
      total: invoices.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    console.error('Error sending customer reminders:', error);
    console.error('Error stack:', error?.stack);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to send reminders',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

/**
 * Default reminder message template
 */
function getDefaultTemplate(): string {
  return `Hi {customer_name},

This is a reminder that invoice {invoice_no} for ₹ {balance_amount} is pending payment.

Please arrange payment at your earliest convenience.

Thank you!`;
}

