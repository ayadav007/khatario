import * as db from '@/lib/db';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { generateInvoicePdf } from '@/lib/pdf-generator';
import { format } from 'date-fns';

/**
 * Process message template by replacing placeholders
 */
export function processTemplate(
  template: string,
  invoice: any,
  customer: any,
  business: any
): string {
  let message = template;

  // Replace placeholders
  const placeholders: Record<string, string> = {
    '{customer_name}': customer?.name || 'Cash Sale',
    '{invoice_no}': invoice.invoice_number || '',
    '{amount}': formatCurrency(invoice.grand_total || 0),
    '{balance_amount}': formatCurrency(invoice.balance_amount || invoice.grand_total || 0),
    '{due_date}': invoice.due_date ? format(new Date(invoice.due_date), 'dd/MM/yyyy') : '',
    '{business_name}': business?.name || ''
  };

  for (const [placeholder, value] of Object.entries(placeholders)) {
    message = message.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
  }

  return message;
}

/**
 * Format currency to Indian Rupee format
 */
function formatCurrency(amount: number): string {
  return `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** How the reminder was triggered (stored on whatsapp_messages.reminder_source for logs / filters). */
export type ReminderSource = 'manual' | 'auto_payment_due' | 'auto_overdue';

/**
 * Send reminder message for a single invoice
 */
export async function sendReminderMessage(
  invoiceId: string,
  businessId: string,
  messageTemplate: string,
  includePdf: boolean,
  reminderSource: ReminderSource = 'manual'
): Promise<{ success: boolean; error?: string }> {
  // Used in catch — must be outer scope or failure logs show raw {placeholders} from template
  let processedMessage: string | undefined;
  let logToNumber: string = 'unknown';

  try {
    // Fetch invoice with customer and business details
    const invoice = await db.queryOne(
      `SELECT 
        i.*,
        c.id as customer_id,
        c.name as customer_name,
        c.phone as customer_phone,
        c.email as customer_email,
        b.name as business_name,
        b.phone as business_phone,
        b.email as business_email
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       JOIN businesses b ON i.business_id = b.id
       WHERE i.id = $1 AND i.business_id = $2`,
      [invoiceId, businessId]
    );

    if (!invoice) {
      return { success: false, error: 'Invoice not found' };
    }

    // Check if customer has phone number
    if (!invoice.customer_phone || invoice.customer_phone.trim() === '') {
      return { success: false, error: 'Customer phone number not available' };
    }

    // Process template
    const customer = {
      name: invoice.customer_name || 'Cash Sale',
      phone: invoice.customer_phone,
      email: invoice.customer_email
    };

    const business = {
      name: invoice.business_name,
      phone: invoice.business_phone,
      email: invoice.business_email
    };

    const message = processTemplate(messageTemplate, invoice, customer, business);
    processedMessage = message;
    logToNumber = invoice.customer_phone;

    // Generate PDF when the channel should attach the invoice
    let pdfBuffer: Buffer | undefined;
    if (includePdf) {
      try {
        pdfBuffer = await generateInvoicePdf(invoiceId);
      } catch (error: any) {
        console.error('Failed to generate PDF for reminder:', error);
        return {
          success: false,
          error: error?.message
            ? `Could not generate invoice PDF: ${error.message}`
            : 'Could not generate invoice PDF for this reminder',
        };
      }
      if (!pdfBuffer || pdfBuffer.length === 0) {
        return { success: false, error: 'Invoice PDF is empty' };
      }
    }

    // Send WhatsApp message (string return = Baileys message id for delivery/read updates)
    const sendResult = await sendWhatsAppMessage(
      businessId,
      invoice.customer_phone,
      message,
      pdfBuffer
    );
    const baileysMessageId = typeof sendResult === 'string' ? sendResult : null;

    // Log to whatsapp_messages table
    await db.query(
      `INSERT INTO whatsapp_messages (
        business_id, 
        to_number, 
        message_type, 
        reference_type, 
        reference_id, 
        message_text, 
        media_url, 
        status,
        baileys_message_id,
        reminder_source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        businessId,
        invoice.customer_phone,
        'reminder',
        'invoice',
        invoiceId,
        message,
        includePdf ? 'blob:pdf' : null,
        'sent',
        baileysMessageId,
        reminderSource
      ]
    );

    return { success: true };
  } catch (error: any) {
    console.error('Error sending reminder message:', error);
    
    // Log failure
    try {
      await db.query(
        `INSERT INTO whatsapp_messages (
          business_id, 
          to_number, 
          message_type, 
          reference_type, 
          reference_id, 
          message_text, 
          status, 
          error_message,
          reminder_source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          businessId,
          logToNumber,
          'reminder',
          'invoice',
          invoiceId,
          processedMessage ?? messageTemplate,
          'failed',
          error.message || 'Unknown error',
          reminderSource
        ]
      );
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return { success: false, error: error.message || 'Failed to send reminder' };
  }
}

