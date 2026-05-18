# WhatsApp Invoice Sending - Complete Explanation

## How WhatsApp Invoice Sending Works

### Overview

When you want to send an invoice via WhatsApp, here's what happens:

1. **Invoice is created** and saved to PostgreSQL database
2. **PDF is generated** (you'll implement this)
3. **PDF is uploaded** to cloud storage (S3/Cloudinary) - you'll implement this
4. **User clicks "Send via WhatsApp"** button
5. **System sends** the PDF + message to customer's phone
6. **Message is logged** in database for tracking

## Architecture

### Two Integration Methods

#### Method 1: WhatsApp Cloud API (Recommended for Production)

**How it works:**
- Uses Meta's official WhatsApp Business API
- Requires Meta Business Account
- Get API credentials from Meta Developer Console
- Send messages programmatically via REST API

**Flow:**
```
Your App → Meta WhatsApp API → Customer's WhatsApp
```

**Setup:**
1. Create Meta Business Account
2. Get Access Token & Phone Number ID
3. Configure in Khatario Settings
4. Start sending!

#### Method 2: WhatsApp Web.js (Development/Testing)

**How it works:**
- Uses WhatsApp Web (like web.whatsapp.com)
- Requires scanning QR code once
- Session stored in database
- Uses your personal WhatsApp number

**Flow:**
```
Your App → WhatsApp Web.js → WhatsApp Web → Customer's WhatsApp
```

**Setup:**
1. Click "Show QR" in Settings
2. Scan with your phone
3. Session saved
4. Start sending!

## Implementation Details

### Database Tables

**1. whatsapp_config**
Stores connection settings for each business:
```sql
- business_id (which business)
- connection_type ('cloud_api' or 'web_session')
- api_key (for Cloud API)
- phone_number_id (for Cloud API)
- session_data (for Web session)
- is_connected (status)
```

**2. whatsapp_messages**
Logs every message sent:
```sql
- business_id
- to_number (customer phone)
- message_type ('invoice', 'reminder')
- reference_id (invoice ID)
- message_text
- media_url (PDF URL)
- status ('sent', 'delivered', 'failed')
- error_message
- sent_at (timestamp)
```

**3. whatsapp_reminder_settings**
Stores automatic reminder configuration:
```sql
- business_id
- reminder_type ('payment_due', 'overdue')
- enabled (true/false)
- days_before (for payment due)
- interval_days (for overdue)
- message_template (custom message)
```

### Code Structure

**Main Service** (`lib/whatsapp.ts`):

```typescript
class WhatsAppService {
  // Initialize connection
  async initialize()
  
  // Send invoice PDF
  async sendInvoice(phone, invoiceId, invoiceNumber, pdfUrl, message)
  
  // Send reminder
  async sendReminder(phone, invoiceId, invoiceNumber, amount, dueDate, template)
  
  // Log message
  private async logMessage(...)
}
```

**API Endpoint** (`app/api/invoices/[id]/whatsapp/route.ts`):

```typescript
POST /api/invoices/{invoice_id}/whatsapp
Body: {
  pdf_url: "https://example.com/invoices/inv-001.pdf",
  custom_message: "Hello! Please find your invoice attached."
}
```

### Complete Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    USER ACTIONS                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  1. User creates invoice in the app                         │
│     - Invoice saved to PostgreSQL                           │
│     - Invoice number auto-generated                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  2. PDF Generation (YOU NEED TO IMPLEMENT)                  │
│     - Use react-pdf or puppeteer                            │
│     - Render invoice using template                         │
│     - Generate PDF file                                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Upload PDF to Cloud Storage (YOU NEED TO IMPLEMENT)     │
│     - Upload to S3/Cloudinary/etc                           │
│     - Get public URL                                        │
│     - Store URL in database                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  4. User clicks "Send via WhatsApp" button                  │
│     - Button in invoice detail page                         │
│     - Calls API endpoint                                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Frontend calls API                                      │
│     POST /api/invoices/{id}/whatsapp                        │
│     {                                                        │
│       pdf_url: "https://...",                               │
│       custom_message: "Hello! ..."                          │
│     }                                                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  6. Backend processes request                               │
│     - Loads invoice from database                           │
│     - Gets customer phone number                            │
│     - Initializes WhatsApp service                          │
│     - Calls sendInvoice()                                   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  7. WhatsApp Service sends message                          │
│     IF Cloud API:                                           │
│       - Sends text message via Meta API                     │
│       - Sends PDF as document via Meta API                  │
│     IF Web.js:                                              │
│       - Uses WhatsApp Web.js client                         │
│       - Sends through WhatsApp Web                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  8. Message delivered to customer                           │
│     - Customer receives text + PDF                          │
│     - Can download and view invoice                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  9. Logging                                                 │
│     - Message saved to whatsapp_messages table              │
│     - Status tracked (sent/delivered/failed)                │
│     - Errors logged if any                                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  10. Response to frontend                                   │
│      - Success or error message                             │
│      - User sees confirmation                               │
└─────────────────────────────────────────────────────────────┘
```

## Step-by-Step: Sending an Invoice

### 1. Prepare Invoice Data

```typescript
const invoice = {
  id: 'uuid-here',
  invoice_number: 'INV-001',
  customer: {
    phone: '+91 9876543210', // Must be in WhatsApp format
  },
  pdf_url: 'https://storage.example.com/invoices/inv-001.pdf',
};
```

### 2. User Clicks Button

```typescript
<Button onClick={() => sendInvoiceViaWhatsApp(invoice)}>
  <MessageCircle className="w-4 h-4" />
  Send via WhatsApp
</Button>
```

### 3. Frontend Function

```typescript
async function sendInvoiceViaWhatsApp(invoice) {
  try {
    const response = await fetch(`/api/invoices/${invoice.id}/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_url: invoice.pdf_url,
        custom_message: `Hello! Please find invoice ${invoice.invoice_number} attached.`,
      }),
    });

    const result = await response.json();
    
    if (result.success) {
      alert('Invoice sent successfully!');
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to send invoice');
  }
}
```

### 4. Backend Processes

The API endpoint (`app/api/invoices/[id]/whatsapp/route.ts`):
- Validates invoice exists
- Gets customer phone number
- Initializes WhatsApp service
- Sends message + PDF
- Logs to database
- Returns result

### 5. WhatsApp Service

The service (`lib/whatsapp.ts`):
- Loads WhatsApp config from database
- Connects using Cloud API or Web.js
- Sends text message first
- Sends PDF as document attachment
- Handles errors
- Logs everything

## Automatic Reminders

### Payment Due Reminder

**When:** 3 days before due date

**How it works:**
1. Background job checks invoices daily
2. Finds invoices due in 3 days
3. Sends reminder message
4. Uses template with placeholders

**Message Template:**
```
Hi {customer_name},
This is a reminder that invoice {invoice_no}
for ₹ {amount} is due on {due_date}.
Please make payment soon.
```

### Overdue Reminder

**When:** Every 7 days for overdue invoices

**How it works:**
1. Background job checks daily
2. Finds overdue invoices
3. Checks last reminder date
4. Sends if 7+ days since last reminder

**Message Template:**
```
Hi {customer_name},
Invoice {invoice_no} for ₹ {amount}
is now overdue. Please arrange payment immediately.
```

## What You Need to Implement

### 1. PDF Generation ⏳

**Options:**

**Option A: Server-side with Puppeteer**
```typescript
// Generate PDF on server
import puppeteer from 'puppeteer';

async function generateInvoicePDF(invoice) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  // Render invoice HTML using template
  await page.setContent(invoiceHTML);
  
  // Generate PDF
  const pdf = await page.pdf({ format: 'A4' });
  
  await browser.close();
  return pdf;
}
```

**Option B: Client-side with react-pdf**
```typescript
import { Document, Page, Text, View } from '@react-pdf/renderer';

const InvoicePDF = ({ invoice }) => (
  <Document>
    <Page>
      <View>
        <Text>Invoice {invoice.number}</Text>
        {/* ... invoice content ... */}
      </View>
    </Page>
  </Document>
);
```

### 2. Cloud Storage Upload ⏳

**Upload PDF to S3/Cloudinary:**

```typescript
// Example with Cloudinary
import { v2 as cloudinary } from 'cloudinary';

async function uploadPDF(pdfBuffer) {
  const result = await cloudinary.uploader.upload(
    `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
    {
      resource_type: 'raw',
      folder: 'invoices',
    }
  );
  
  return result.secure_url; // Public URL
}
```

### 3. Update Components ⏳

**Add WhatsApp button to invoice detail page:**

```typescript
// In app/invoices/[id]/page.tsx
<Button onClick={() => handleSendWhatsApp(invoice.id)}>
  <MessageCircle className="w-4 h-4 mr-2" />
  Send via WhatsApp
</Button>
```

## Testing

### Test Connection

1. Go to Settings → WhatsApp & Sharing
2. Configure credentials
3. Click "Connect"
4. Check connection status

### Test Sending

1. Create a test invoice
2. Generate PDF (or use dummy URL for testing)
3. Click "Send via WhatsApp"
4. Check your phone or customer's phone
5. Check `whatsapp_messages` table for logs

### Check Logs

```sql
SELECT * FROM whatsapp_messages 
WHERE business_id = 'your-business-id'
ORDER BY sent_at DESC
LIMIT 10;
```

## Troubleshooting

### "WhatsApp not connected"
- Check Settings → WhatsApp configuration
- Verify API credentials
- Test connection button

### "Failed to send"
- Check phone number format (should be digits only, no + or spaces)
- Verify customer has WhatsApp
- Check API rate limits
- Review error in `whatsapp_messages.error_message`

### PDF not sending
- Verify PDF URL is accessible
- Check URL format (should be HTTPS)
- Ensure PDF is publicly accessible

## Security Notes

1. **Store API keys securely** - Use environment variables
2. **Validate phone numbers** - Before sending
3. **Rate limiting** - Don't spam messages
4. **HTTPS only** - For PDF URLs
5. **Customer consent** - Always ask before sending

## Summary

**WhatsApp invoice sending is fully implemented** in the backend! You just need to:

1. ✅ Database tables - Done
2. ✅ API endpoint - Done
3. ✅ WhatsApp service - Done
4. ⏳ PDF generation - You implement
5. ⏳ Cloud storage - You implement
6. ⏳ Add button to UI - You implement

**Everything else is ready to use!** 🚀

