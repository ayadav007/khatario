import * as db from '@/lib/db';
import { sendBusinessEmail } from './business-email';

/**
 * Send daily invoice summary email to business owner
 */
export async function sendDailyInvoiceSummaryEmail(businessId: string): Promise<boolean> {
  try {
    // Get business details
    const business = await db.queryOne<{ name: string; email: string }>(`
      SELECT name, email FROM businesses WHERE id = $1
    `, [businessId]);

    if (!business?.email) {
      console.log(`No email found for business ${businessId}`);
      return false;
    }

    // Get overdue invoices
    const overdueInvoices = await db.queryRows<{
      invoice_number: string;
      customer_name: string | null;
      due_date: Date;
      balance_amount: number;
      days_overdue: number;
    }>(`
      SELECT 
        i.invoice_number,
        c.name as customer_name,
        i.due_date,
        i.balance_amount,
        CURRENT_DATE - DATE(i.due_date) as days_overdue
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE i.business_id = $1
        AND i.status = 'final'
        AND i.payment_status IN ('unpaid', 'partially_paid')
        AND DATE(i.due_date) < CURRENT_DATE
      ORDER BY i.due_date ASC
      LIMIT 50
    `, [businessId]);

    // Get invoices due in next 3 days
    const upcomingInvoices = await db.queryRows<{
      invoice_number: string;
      customer_name: string | null;
      due_date: Date;
      grand_total: number;
      days_until_due: number;
    }>(`
      SELECT 
        i.invoice_number,
        c.name as customer_name,
        i.due_date,
        i.grand_total,
        DATE(i.due_date) - CURRENT_DATE as days_until_due
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE i.business_id = $1
        AND i.status = 'final'
        AND i.payment_status IN ('unpaid', 'partially_paid')
        AND DATE(i.due_date) >= CURRENT_DATE
        AND DATE(i.due_date) <= CURRENT_DATE + INTERVAL '3 days'
      ORDER BY i.due_date ASC
    `, [businessId]);

    const totalOverdue = overdueInvoices.reduce((sum, inv) => sum + parseFloat(String(inv.balance_amount || 0)), 0);
    const totalUpcoming = upcomingInvoices.reduce((sum, inv) => sum + parseFloat(String(inv.grand_total || 0)), 0);

    // Format date for display
    const today = new Date();
    const formattedDate = today.toLocaleDateString('en-IN', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    // Generate HTML email
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .header h1 { margin: 0; color: #333; font-size: 24px; }
          .header p { margin: 5px 0 0 0; color: #666; }
          .section { margin: 20px 0; }
          .section h2 { margin: 0 0 15px 0; font-size: 18px; }
          .invoice-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          .invoice-table th, .invoice-table td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          .invoice-table th { background: #f8f9fa; font-weight: bold; }
          .amount { font-weight: bold; color: #d32f2f; }
          .summary-box { background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107; }
          .summary-box.overdue { background: #f8d7da; border-left-color: #dc3545; }
          .summary-box strong { font-size: 16px; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
          .footer a { color: #007bff; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Daily Invoice Summary - ${business.name}</h1>
            <p>${formattedDate}</p>
          </div>

          ${overdueInvoices.length > 0 ? `
          <div class="section">
            <h2 style="color: #d32f2f;">⚠️ Overdue Invoices (${overdueInvoices.length})</h2>
            <div class="summary-box overdue">
              <strong>Total Overdue Amount: ₹${totalOverdue.toFixed(2)}</strong>
            </div>
            <table class="invoice-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Due Date</th>
                  <th>Days Overdue</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                ${overdueInvoices.map(inv => `
                  <tr>
                    <td>${inv.invoice_number}</td>
                    <td>${inv.customer_name || 'Cash Sale'}</td>
                    <td>${new Date(inv.due_date).toLocaleDateString('en-IN')}</td>
                    <td>${inv.days_overdue} day${inv.days_overdue > 1 ? 's' : ''}</td>
                    <td class="amount">₹${parseFloat(String(inv.balance_amount || 0)).toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${upcomingInvoices.length > 0 ? `
          <div class="section">
            <h2 style="color: #f57c00;">📅 Upcoming Invoices (${upcomingInvoices.length})</h2>
            <div class="summary-box">
              <strong>Total Upcoming Amount: ₹${totalUpcoming.toFixed(2)}</strong>
            </div>
            <table class="invoice-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Due Date</th>
                  <th>Due In</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                ${upcomingInvoices.map(inv => `
                  <tr>
                    <td>${inv.invoice_number}</td>
                    <td>${inv.customer_name || 'Cash Sale'}</td>
                    <td>${new Date(inv.due_date).toLocaleDateString('en-IN')}</td>
                    <td>${inv.days_until_due} day${inv.days_until_due > 1 ? 's' : ''}</td>
                    <td class="amount">₹${parseFloat(String(inv.grand_total || 0)).toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${overdueInvoices.length === 0 && upcomingInvoices.length === 0 ? `
          <div class="section">
            <p>✅ Great news! You have no overdue invoices and no invoices due in the next 3 days.</p>
          </div>
          ` : ''}

          <div class="footer">
            <p>This is an automated email from Khatario. You're receiving this because you have invoices requiring attention.</p>
            <p><a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/invoices">View All Invoices</a></p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Generate plain text version
    const text = `Daily Invoice Summary - ${business.name}\n\n${formattedDate}\n\n` +
      (overdueInvoices.length > 0 
        ? `Overdue Invoices (${overdueInvoices.length})\nTotal: ₹${totalOverdue.toFixed(2)}\n\n` +
          overdueInvoices.map(inv => 
            `${inv.invoice_number} - ${inv.customer_name || 'Cash Sale'} - Due: ${new Date(inv.due_date).toLocaleDateString('en-IN')} - ₹${parseFloat(String(inv.balance_amount || 0)).toFixed(2)}`
          ).join('\n') + '\n\n'
        : '') +
      (upcomingInvoices.length > 0
        ? `Upcoming Invoices (${upcomingInvoices.length})\nTotal: ₹${totalUpcoming.toFixed(2)}\n\n` +
          upcomingInvoices.map(inv =>
            `${inv.invoice_number} - ${inv.customer_name || 'Cash Sale'} - Due: ${new Date(inv.due_date).toLocaleDateString('en-IN')} - ₹${parseFloat(String(inv.grand_total || 0)).toFixed(2)}`
          ).join('\n')
        : 'No upcoming invoices');

    // Send email
    const result = await sendBusinessEmail(businessId, {
      to: business.email,
      subject: `Daily Invoice Summary - ${overdueInvoices.length > 0 ? `${overdueInvoices.length} Overdue` : 'All Clear'}`,
      html,
      text,
    });

    return result.success;
  } catch (error: any) {
    console.error(`Error sending daily summary for business ${businessId}:`, error);
    return false;
  }
}

