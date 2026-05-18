# WhatsApp Integration Guide

Khatario supports sending invoices via WhatsApp using two methods:

1. **WhatsApp Cloud API** (Recommended for production)
2. **WhatsApp Web.js** (Good for development/testing)

## Method 1: WhatsApp Cloud API (Official)

This is the recommended method for production use. It uses Meta's official WhatsApp Business API.

### Setup Steps

1. **Create Meta Business Account**
   - Go to [business.facebook.com](https://business.facebook.com)
   - Create a Business Account
   - Add WhatsApp product to your business

2. **Get API Credentials**
   - Go to [developers.facebook.com](https://developers.facebook.com)
   - Create a new App
   - Add "WhatsApp" product
   - Get your:
     - **Access Token** (API Key)
     - **Phone Number ID**
     - **Business Account ID**

3. **Configure in Khatario**

   Go to Settings → WhatsApp & Sharing → Connections tab:

   - Select "WhatsApp Cloud API"
   - Enter your:
     - API Key (Access Token)
     - API Secret (if required)
     - Phone Number ID
   - Click "Connect"

### API Endpoints

**Send Invoice via WhatsApp:**
```
POST /api/invoices/{invoice_id}/whatsapp
Content-Type: application/json

{
  "pdf_url": "https://example.com/invoices/inv-001.pdf",
  "custom_message": "Hello! Please find your invoice attached."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Invoice sent successfully via WhatsApp"
}
```

### How It Works

1. **Invoice Creation**: When an invoice is created, a PDF is generated
2. **WhatsApp Send**: The PDF URL is sent to the customer's phone number
3. **Message Format**: 
   - Text message with custom greeting
   - PDF document attachment
4. **Logging**: All messages are logged in `whatsapp_messages` table

### Code Example

```typescript
// From your component
const sendInvoice = async (invoiceId: string) => {
  const response = await fetch(`/api/invoices/${invoiceId}/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdf_url: 'https://yourdomain.com/invoices/inv-001.pdf',
      custom_message: 'Hello! Please find your invoice attached.'
    })
  });
  
  const result = await response.json();
  if (result.success) {
    alert('Invoice sent successfully!');
  }
};
```

## Method 2: WhatsApp Web.js (Unofficial)

This method uses WhatsApp Web by scanning a QR code. Good for development but not recommended for production.

### Setup Steps

1. **Install Dependencies**
   ```bash
   npm install whatsapp-web.js qrcode
   ```

2. **Configuration**
   - Go to Settings → WhatsApp & Sharing
   - Select "WhatsApp Web Session"
   - Click "Show QR to Login"
   - Scan QR code with your WhatsApp

3. **How It Works**
   - Session is stored in database
   - QR code needs to be scanned once
   - Messages are sent through your personal WhatsApp number

### Limitations

- Requires keeping the session active
- Not suitable for high-volume sending
- Uses your personal WhatsApp account
- May be blocked by WhatsApp if abused

## Automatic Reminders

You can set up automatic payment reminders:

### Configuration

Go to Settings → WhatsApp & Sharing → Auto Reminders tab:

1. **Payment Due Reminder**
   - Enable/disable
   - Days before due date (e.g., 3 days)
   - Custom message template

2. **Overdue Reminder**
   - Enable/disable
   - Interval (e.g., every 7 days)
   - Custom message template

### Message Templates

Use placeholders in your templates:
- `{customer_name}` - Customer name
- `{invoice_no}` - Invoice number
- `{amount}` - Invoice amount
- `{due_date}` - Due date

Example:
```
Hi {customer_name}, 
This is a reminder that invoice {invoice_no} 
for ₹ {amount} is due on {due_date}.
Please make payment at your earliest convenience.
```

## Implementation Details

### Backend Service

The WhatsApp service is implemented in `lib/whatsapp.ts`:

```typescript
import { WhatsAppService } from '@/lib/whatsapp';

const service = new WhatsAppService(businessId);
await service.initialize();

// Send invoice
await service.sendInvoice(
  customerPhone,
  invoiceId,
  invoiceNumber,
  pdfUrl,
  customMessage
);

// Send reminder
await service.sendReminder(
  customerPhone,
  invoiceId,
  invoiceNumber,
  amount,
  dueDate,
  messageTemplate
);
```

### Database Tables

**whatsapp_config**
- Stores connection settings
- One record per business
- Supports both Cloud API and Web session

**whatsapp_messages**
- Logs all sent messages
- Tracks status (sent, delivered, failed)
- Stores error messages for debugging

**whatsapp_reminder_settings**
- Stores reminder configuration
- Template messages
- Reminder schedules

## Testing

### Test Cloud API Connection

```bash
curl -X POST http://localhost:3000/api/invoices/{invoice_id}/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "pdf_url": "https://example.com/test.pdf",
    "custom_message": "Test message"
  }'
```

### Check Message Logs

Query the database:
```sql
SELECT * FROM whatsapp_messages 
WHERE business_id = 'your-business-id' 
ORDER BY sent_at DESC 
LIMIT 10;
```

## Troubleshooting

### "WhatsApp not connected"
- Check WhatsApp configuration in Settings
- Verify API credentials are correct
- Ensure connection is active

### "Failed to send message"
- Check phone number format (should be digits only)
- Verify customer has WhatsApp account
- Check API rate limits
- Review error logs in `whatsapp_messages` table

### Cloud API Errors

**Invalid Access Token**
- Regenerate token in Meta Developer Console
- Ensure token hasn't expired

**Rate Limit Exceeded**
- WhatsApp Cloud API has rate limits
- Wait before sending more messages
- Consider upgrading your Meta plan

### Web Session Issues

**QR Code Not Showing**
- Check browser console for errors
- Ensure session storage path is writable
- Try regenerating QR code

**Session Expired**
- Scan QR code again
- Check session data in database
- Restart the application

## Best Practices

1. **Always get customer consent** before sending WhatsApp messages
2. **Test with your own number** first
3. **Keep message templates professional** and clear
4. **Monitor message logs** regularly
5. **Respect WhatsApp's terms of service**
6. **Don't send spam** - only send relevant invoices/reminders
7. **Handle opt-outs** if customers request to stop receiving messages

## Security Considerations

- Store API keys securely in environment variables
- Never expose credentials in client-side code
- Use HTTPS for PDF URLs
- Validate phone numbers before sending
- Implement rate limiting to prevent abuse

## Production Deployment

1. Use WhatsApp Cloud API (not Web.js)
2. Set up proper error monitoring
3. Implement retry logic for failed messages
4. Set up backup message delivery (SMS/Email)
5. Monitor API usage and costs
6. Set up webhooks for delivery receipts (optional)

## Support

For issues:
1. Check message logs in database
2. Review error messages in API responses
3. Verify WhatsApp configuration
4. Check Meta Developer Console for API status

