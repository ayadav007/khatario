/**
 * Email service.
 * - Tenant document email: {@link sendBusinessEmail} in lib/business-email.ts (per-business SMTP in settings).
 * - Platform / system email: {@link sendEmail} below (optional global SMTP in .env).
 */

import nodemailer from 'nodemailer';
import { sendBusinessEmail } from '@/lib/business-email';

interface EmailConfig {
  provider: 'smtp' | 'sendgrid' | 'ses';
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_password?: string;
  sendgrid_api_key?: string;
  ses_region?: string;
  ses_access_key?: string;
  ses_secret_key?: string;
  from_email: string;
  from_name: string;
}

interface EmailOptions {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

/**
 * Get email configuration from environment or database
 */
function getEmailConfig(): EmailConfig {
  return {
    provider: (process.env.EMAIL_PROVIDER as any) || 'smtp',
    smtp_host: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtp_port: parseInt(process.env.SMTP_PORT || '587'),
    smtp_user: process.env.SMTP_USER,
    smtp_password: process.env.SMTP_PASSWORD,
    from_email: process.env.EMAIL_FROM || 'noreply@khatario.com',
    from_name: process.env.EMAIL_FROM_NAME || 'Khatario',
  };
}

/**
 * Create email transporter based on configuration
 */
function createTransporter(config: EmailConfig) {
  if (config.provider === 'smtp') {
    return nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port,
      secure: config.smtp_port === 465,
      auth: {
        user: config.smtp_user,
        pass: config.smtp_password,
      },
    });
  }

  // TODO: Add SendGrid and AWS SES support
  throw new Error('Only SMTP is supported currently');
}

/**
 * Send email
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    const config = getEmailConfig();

    if (!config.smtp_user || !config.smtp_password) {
      console.error('Email configuration missing. Please set SMTP credentials in .env');
      return false;
    }

    const transporter = createTransporter(config);

    const info = await transporter.sendMail({
      from: `"${config.from_name}" <${config.from_email}>`,
      to: options.to,
      ...(options.cc ? { cc: options.cc } : {}),
      ...(options.bcc ? { bcc: options.bcc } : {}),
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    });

    console.log('Email sent successfully:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

/**
 * Send invoice via email
 */
export async function sendInvoiceEmail(
  businessId: string,
  recipientEmail: string,
  recipientName: string,
  invoiceNumber: string,
  pdfBuffer: Buffer,
  businessName: string,
  onlineViewUrl?: string | null
): Promise<boolean> {
  const subject = `Invoice ${invoiceNumber} from ${businessName}`;

  const viewBlock = onlineViewUrl
    ? `<p style="margin: 20px 0;"><a href="${onlineViewUrl}" style="display:inline-block;padding:12px 20px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">View bill online</a></p>
       <p style="font-size:13px;color:#555;">Or open: ${onlineViewUrl}</p>`
    : '';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: white; padding: 30px; border: 1px solid #e0e0e0; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin-top: 20px; }
        .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0;">Invoice from ${businessName}</h1>
        </div>
        <div class="content">
          <p>Dear ${recipientName},</p>
          
          <p>Thank you for your business! Please find attached your invoice <strong>${invoiceNumber}</strong>.</p>
          ${viewBlock}
          <p>The invoice is also attached as a PDF.</p>
          
          <p>If you have any questions about this invoice, please don't hesitate to contact us.</p>
          
          <p>Best regards,<br>
          <strong>${businessName}</strong></p>
        </div>
        <div class="footer">
          <p>This is an automated email from Khatario billing system.</p>
          <p>© 2025 ${businessName}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Dear ${recipientName},

Thank you for your business! Please find attached your invoice ${invoiceNumber}.
${onlineViewUrl ? `\nView online: ${onlineViewUrl}\n` : ''}
If you have any questions, please contact us.

Best regards,
${businessName}

---
This is an automated email from Khatario billing system.
  `;

  const result = await sendBusinessEmail(businessId, {
    to: recipientEmail,
    subject,
    html,
    text,
    attachments: [
      {
        filename: `Invoice-${invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
  return result.success;
}

/**
 * Test email configuration
 */
export async function testEmailConfig(): Promise<{ success: boolean; message: string }> {
  try {
    const config = getEmailConfig();

    if (!config.smtp_user || !config.smtp_password) {
      return {
        success: false,
        message: 'Email configuration missing. Please set SMTP credentials in .env',
      };
    }

    const transporter = createTransporter(config);
    await transporter.verify();

    return {
      success: true,
      message: 'Email configuration is valid and ready to use',
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Email configuration error: ${error.message}`,
    };
  }
}

