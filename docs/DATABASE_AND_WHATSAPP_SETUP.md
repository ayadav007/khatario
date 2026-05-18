# Database & WhatsApp Integration Setup

## Quick Start Guide

This document explains how PostgreSQL database integration and WhatsApp invoice sending work in Khatario.

## 1. PostgreSQL Database Setup

### Step 1: Install PostgreSQL

**Windows:**
- Download from [postgresql.org/download/windows](https://www.postgresql.org/download/windows/)
- Install and set a password during setup

**macOS:**
```bash
brew install postgresql
brew services start postgresql
```

**Linux:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### Step 2: Create Database

Open PostgreSQL (pgAdmin or command line) and run:

```sql
CREATE DATABASE khatario;
```

Or via command line:
```bash
createdb khatario
```

### Step 3: Configure Environment

Create `.env.local` file in project root:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=khatario
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_SSL=false

NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

**Important:** Replace `your_password_here` with your PostgreSQL password.

### Step 4: Run Migrations

```bash
# Install dependencies
npm install

# Create all database tables
npm run db:migrate
```

This creates all necessary tables including:
- businesses, users, customers, items
- invoices, invoice_items, payments
- whatsapp_config, whatsapp_messages
- And more...

### Step 5: Verify Setup

Check if tables were created:

```sql
\dt
```

You should see ~20 tables created.

## 2. Using Real Data Instead of Dummy Data

### Before (Dummy Data)

```typescript
// Old way - hardcoded dummy data
const customers = [
  { id: 1, name: 'ABC Traders', phone: '+91 9876543210' },
  // ...
];
```

### After (Real Database)

```typescript
// New way - fetch from API
const response = await fetch(`/api/customers?business_id=${businessId}`);
const { customers } = await response.json();
```

### Update Components

All components need to:

1. **Get business_id** from user session/auth
2. **Fetch data from API** instead of using dummy arrays
3. **Handle loading states**
4. **Handle errors**

Example:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useCustomers } from '@/hooks/useCustomers';

export default function CustomersPage() {
  const businessId = 'your-business-id'; // Get from auth
  const [search, setSearch] = useState('');
  
  const { customers, loading, error } = useCustomers({
    businessId,
    search,
  });

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {/* Use real customers data */}
      {customers.map(customer => (
        <div key={customer.id}>{customer.name}</div>
      ))}
    </div>
  );
}
```

## 3. WhatsApp Invoice Sending

### How It Works

```
Invoice Created → PDF Generated → WhatsApp Send → Message Logged
```

### Architecture

1. **Invoice Creation**
   - User creates invoice in the app
   - Invoice saved to database
   - PDF is generated (you need to implement PDF generation)

2. **WhatsApp Send**
   - User clicks "Send via WhatsApp" button
   - App calls: `POST /api/invoices/{id}/whatsapp`
   - Service sends PDF + message to customer's phone

3. **Message Logging**
   - All messages saved to `whatsapp_messages` table
   - Status tracked (sent, delivered, failed)
   - Errors logged for debugging

### Setup WhatsApp Integration

#### Option 1: WhatsApp Cloud API (Recommended)

1. **Create Meta Business Account**
   - Go to [business.facebook.com](https://business.facebook.com)
   - Create Business Account
   - Add WhatsApp product

2. **Get API Credentials**
   - Go to [developers.facebook.com](https://developers.facebook.com)
   - Create App → Add WhatsApp
   - Get:
     - Access Token (API Key)
     - Phone Number ID

3. **Configure in App**
   - Go to: Settings → WhatsApp & Sharing
   - Select "WhatsApp Cloud API"
   - Enter credentials
   - Click "Connect"

#### Option 2: WhatsApp Web.js (Development Only)

1. Install dependency:
```bash
npm install whatsapp-web.js qrcode
```

2. Go to Settings → WhatsApp & Sharing
3. Click "Show QR to Login"
4. Scan QR with your WhatsApp

### Sending Invoice via WhatsApp

**From Component:**

```typescript
const sendInvoice = async (invoiceId: string, pdfUrl: string) => {
  try {
    const response = await fetch(`/api/invoices/${invoiceId}/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_url: pdfUrl,
        custom_message: 'Hello! Please find your invoice attached.'
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
  }
};
```

**From Invoice Detail Page:**

Add a button:
```typescript
<Button onClick={() => sendInvoice(invoice.id, invoice.pdf_url)}>
  <MessageCircle className="w-4 h-4 mr-2" />
  Send via WhatsApp
</Button>
```

### Automatic Reminders

Set up automatic payment reminders:

1. Go to: Settings → WhatsApp & Sharing → Auto Reminders
2. Enable "Payment reminder 3 days before due date"
3. Configure message template:
```
Hi {customer_name}, 
Invoice {invoice_no} for ₹ {amount} 
is due on {due_date}. 
Please make payment soon.
```

4. Enable "Overdue reminder every 7 days"

### Database Tables for WhatsApp

**whatsapp_config**
- Stores connection settings per business
- Supports Cloud API or Web session

**whatsapp_messages**
- Logs every message sent
- Tracks status and errors
- Useful for debugging

**whatsapp_reminder_settings**
- Stores reminder configuration
- Message templates
- Reminder schedules

## 4. Implementation Checklist

### Database Setup
- [ ] Install PostgreSQL
- [ ] Create database
- [ ] Configure `.env.local`
- [ ] Run `npm run db:migrate`
- [ ] Verify tables created

### Replace Dummy Data
- [ ] Update Dashboard component
- [ ] Update Customers component
- [ ] Update Items component
- [ ] Update Invoices component
- [ ] Add loading states
- [ ] Add error handling

### WhatsApp Integration
- [ ] Choose method (Cloud API or Web.js)
- [ ] Set up credentials
- [ ] Configure in Settings
- [ ] Test connection
- [ ] Implement PDF generation
- [ ] Add "Send via WhatsApp" button
- [ ] Test sending invoice
- [ ] Set up automatic reminders

### PDF Generation

You'll need to implement PDF generation. Options:

1. **Server-side rendering** (Recommended)
   - Use `react-pdf` or `puppeteer`
   - Generate PDF on server
   - Store in cloud storage (S3, Cloudinary)
   - Return URL to client

2. **Client-side rendering**
   - Generate PDF in browser
   - Upload to server
   - Store URL in database

Example structure:
```
/api/invoices/{id}/pdf → Generate PDF → Upload to storage → Return URL
```

## 5. Testing

### Test Database Connection

```typescript
// Test in API route
import { testConnection } from '@/lib/db';

const isConnected = await testConnection();
console.log('Database connected:', isConnected);
```

### Test API Endpoints

```bash
# Test dashboard
curl http://localhost:3000/api/dashboard?business_id=xxx

# Test customers
curl http://localhost:3000/api/customers?business_id=xxx

# Test invoice creation
curl -X POST http://localhost:3000/api/invoices \
  -H "Content-Type: application/json" \
  -d '{"business_id": "xxx", ...}'
```

### Test WhatsApp

1. Create a test invoice
2. Generate PDF
3. Click "Send via WhatsApp"
4. Check `whatsapp_messages` table for logs

## 6. Troubleshooting

### Database Issues

**Connection Error:**
- Check PostgreSQL is running
- Verify credentials in `.env.local`
- Check firewall settings

**Table Not Found:**
- Run migrations: `npm run db:migrate`
- Check database name matches

### WhatsApp Issues

**"WhatsApp not connected":**
- Check Settings → WhatsApp configuration
- Verify API credentials
- Test connection

**"Failed to send":**
- Check phone number format (digits only)
- Verify customer has WhatsApp
- Check API rate limits
- Review error logs in database

## 7. Next Steps

1. **Implement Authentication**
   - User login/signup
   - Session management
   - JWT tokens

2. **Implement PDF Generation**
   - Choose library (react-pdf/puppeteer)
   - Create PDF template
   - Upload to cloud storage

3. **Add More Features**
   - Reports module
   - Advanced filters
   - Bulk operations
   - Export functionality

4. **Production Setup**
   - Use environment-specific configs
   - Enable SSL for database
   - Set up backups
   - Monitor performance

## Resources

- Database Schema: `database/schema.sql`
- API Documentation: `docs/API_USAGE.md`
- WhatsApp Guide: `docs/WHATSAPP_INTEGRATION.md`
- Database Setup: `docs/DATABASE_SETUP.md`

## Support

For issues:
1. Check error logs in console
2. Review database tables
3. Check API responses
4. Verify configuration files

---

**Ready to start?** Follow the steps above and you'll have a fully functional invoice app with database and WhatsApp integration!

