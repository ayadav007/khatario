import { NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { sendReminderMessage } from '@/lib/reminder-message-processor';
import { checkLimit } from '@/lib/subscription';
import { withWhatsAppBaseApi } from '@/lib/security/premium-module-api';
import { whatsAppOutboundReady } from '@/lib/whatsapp/outbound-ready';
import {
  BAILEYS_BULK_GAP_MS,
  BAILEYS_BULK_MAX_BATCH as BAILEYS_MAX_BATCH,
  randomGapMs,
  sleep,
} from '@/lib/whatsapp/baileys-pacing';

export const dynamic = 'force-dynamic';

function baileysGapMs(): number {
  return randomGapMs(BAILEYS_BULK_GAP_MS);
}

export const POST = withWhatsAppBaseApi({ parseJsonBody: true }, async ({ body, businessId }) => {
  try {
    const { invoice_ids, message_template, include_pdf } = (body ?? {}) as {
      invoice_ids?: string[];
      message_template?: string;
      include_pdf?: boolean;
    };

    if (!invoice_ids || !Array.isArray(invoice_ids) || invoice_ids.length === 0) {
      return NextResponse.json(
        { error: 'invoice_ids (array) is required' },
        { status: 400 },
      );
    }

    if (!message_template || message_template.trim() === '') {
      return NextResponse.json({ error: 'message_template is required' }, { status: 400 });
    }

    const outbound = await whatsAppOutboundReady(businessId);
    if (!outbound.ready) {
      return NextResponse.json(
        {
          error:
            'WhatsApp is not connected. Scan a QR code or connect the WhatsApp Business API before sending reminders.',
          code: 'WHATSAPP_NOT_CONNECTED',
        },
        { status: 409 },
      );
    }

    const uniqueInvoiceIds = [...new Set(invoice_ids)];

    const transport = outbound.transport;
    if (transport === 'baileys' && uniqueInvoiceIds.length > BAILEYS_MAX_BATCH) {
      return NextResponse.json(
        {
          error: `Select up to ${BAILEYS_MAX_BATCH} invoices at a time when WhatsApp is linked by QR code. Sending many messages at once can get the number restricted by WhatsApp.`,
          code: 'BATCH_TOO_LARGE',
          max_batch: BAILEYS_MAX_BATCH,
        },
        { status: 400 },
      );
    }

    const invoicePlaceholders = uniqueInvoiceIds.map((_, i) => `$${i + 2}`).join(', ');
    const invoices = await db.queryRows(
      `SELECT id, invoice_number, customer_id FROM invoices 
       WHERE id IN (${invoicePlaceholders}) AND business_id = $1`,
      [businessId, ...uniqueInvoiceIds],
    );

    if (invoices.length !== uniqueInvoiceIds.length) {
      return NextResponse.json(
        { error: 'Some invoices not found or do not belong to your business' },
        { status: 400 },
      );
    }

    const limitCheck = await checkLimit(businessId, 'whatsapp');
    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: limitCheck.message || 'WhatsApp message limit exceeded',
          code: 'LIMIT_EXCEEDED',
          current: limitCheck.current,
          limit: limitCheck.limit,
        },
        { status: 403 },
      );
    }

    const messagesToSend = uniqueInvoiceIds.length;
    if (limitCheck.limit !== -1 && limitCheck.current + messagesToSend > limitCheck.limit) {
      return NextResponse.json(
        {
          error: `Cannot send ${messagesToSend} reminders. Daily limit would be exceeded (${limitCheck.current + messagesToSend}/${limitCheck.limit})`,
          code: 'LIMIT_EXCEEDED',
          current: limitCheck.current,
          limit: limitCheck.limit,
        },
        { status: 403 },
      );
    }

    const results: Array<{ invoice_id: string; success: boolean; error?: string }> = [];
    let successCount = 0;
    let failedCount = 0;

    for (const [index, invoiceId] of uniqueInvoiceIds.entries()) {
      if (transport === 'baileys' && index > 0) await sleep(baileysGapMs());
      try {
        const result = await sendReminderMessage(
          invoiceId,
          businessId,
          message_template,
          include_pdf !== false,
          'manual',
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
      results,
    });
  } catch (error: any) {
    console.error('Error sending bulk reminders:', error);
    return NextResponse.json(
      { error: 'Failed to send reminders', details: error.message },
      { status: 500 },
    );
  }
});
