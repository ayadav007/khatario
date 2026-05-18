import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { sendReminderMessage } from '@/lib/reminder-message-processor';
import { checkLimit } from '@/lib/subscription';

/**
 * POST /api/whatsapp/send-bulk-reminders
 * Send reminders to manually selected invoices
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, invoice_ids, message_template, include_pdf } = body;

    if (!business_id || !invoice_ids || !Array.isArray(invoice_ids) || invoice_ids.length === 0) {
      return NextResponse.json(
        { error: 'business_id and invoice_ids (array) are required' },
        { status: 400 }
      );
    }

    if (!message_template || message_template.trim() === '') {
      return NextResponse.json(
        { error: 'message_template is required' },
        { status: 400 }
      );
    }

    const uniqueInvoiceIds = [...new Set(invoice_ids as string[])];

    // Validate invoices belong to business
    const invoicePlaceholders = uniqueInvoiceIds.map((_, i) => `$${i + 2}`).join(', ');
    const invoices = await db.queryRows(
      `SELECT id, invoice_number, customer_id FROM invoices 
       WHERE id IN (${invoicePlaceholders}) AND business_id = $1`,
      [business_id, ...uniqueInvoiceIds]
    );

    if (invoices.length !== uniqueInvoiceIds.length) {
      return NextResponse.json(
        { error: 'Some invoices not found or do not belong to your business' },
        { status: 400 }
      );
    }

    // Check subscription limits
    const limitCheck = await checkLimit(business_id, 'whatsapp');
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
    const messagesToSend = uniqueInvoiceIds.length;
    if (limitCheck.limit !== -1 && (limitCheck.current + messagesToSend) > limitCheck.limit) {
      return NextResponse.json(
        {
          error: `Cannot send ${messagesToSend} reminders. Daily limit would be exceeded (${limitCheck.current + messagesToSend}/${limitCheck.limit})`,
          code: 'LIMIT_EXCEEDED',
          current: limitCheck.current,
          limit: limitCheck.limit
        },
        { status: 403 }
      );
    }

    // Send reminders
    const results: Array<{ invoice_id: string; success: boolean; error?: string }> = [];
    let successCount = 0;
    let failedCount = 0;

    for (const invoiceId of uniqueInvoiceIds) {
      try {
        const result = await sendReminderMessage(
          invoiceId,
          business_id,
          message_template,
          include_pdf !== false,
          'manual'
        );

        if (result.success) {
          successCount++;
          results.push({ invoice_id: invoiceId, success: true });
        } else {
          failedCount++;
          results.push({ invoice_id: invoiceId, success: false, error: result.error });
        }
      } catch (error: any) {
        failedCount++;
        results.push({ invoice_id: invoiceId, success: false, error: error.message || 'Unknown error' });
      }
    }

    return NextResponse.json({
      success: true,
      success_count: successCount,
      failed_count: failedCount,
      results
    });
  } catch (error: any) {
    console.error('Error sending bulk reminders:', error);
    return NextResponse.json(
      { error: 'Failed to send reminders', details: error.message },
      { status: 500 }
    );
  }
}

