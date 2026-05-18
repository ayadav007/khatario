# Database Setup Guide

This guide will help you set up PostgreSQL database for Khatario.

## Prerequisites

- PostgreSQL 12+ installed on your system
- Node.js and npm installed

## Step 1: Install PostgreSQL

### Windows
Download and install from [postgresql.org](https://www.postgresql.org/download/windows/)

### macOS
```bash
brew install postgresql
brew services start postgresql
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

## Step 2: Create Database

1. Open PostgreSQL command line or pgAdmin
2. Create a new database:

```sql
CREATE DATABASE khatario;
```

Or via command line:
```bash
createdb khatario
```

## Step 3: Configure Environment Variables

Create a `.env.local` file in the project root:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=khatario
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_SSL=false

# Application
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

**Important:** Replace `your_password_here` with your actual PostgreSQL password.

## Step 4: Run Database Migrations

Install dependencies first:
```bash
npm install
```

Then run the migration script:
```bash
npm run db:migrate
```

This will create all necessary tables, indexes, and triggers.

## Step 5: Verify Database Setup

You can verify the setup by checking if tables were created:

```sql
\dt
```

You should see tables like:
- businesses
- users
- customers
- items
- invoices
- invoice_items
- payments
- etc.

## Step 6: Create Test Business (Optional)

You can create a test business directly in the database:

```sql
INSERT INTO businesses (name, email, phone, currency)
VALUES ('Test Business', 'test@example.com', '+91 9876543210', 'INR')
RETURNING id;
```

Save the returned `id` - you'll need it for API requests.

## Troubleshooting

### Connection Error
- Check if PostgreSQL is running: `pg_isready`
- Verify database credentials in `.env.local`
- Check firewall settings

### Permission Denied
- Ensure the database user has proper permissions
- You may need to grant privileges:
```sql
GRANT ALL PRIVILEGES ON DATABASE khatario TO postgres;
```

### Port Already in Use
- Check if PostgreSQL is using the default port (5432)
- Change `DB_PORT` in `.env.local` if needed

## Database Schema Overview

The database includes these main tables:

- **businesses** - Business profiles
- **users** - Staff/user accounts
- **customers** - Customer records
- **suppliers** - Supplier records
- **items** - Product/inventory items
- **invoices** - Sales invoices
- **invoice_items** - Line items in invoices
- **purchases** - Purchase bills
- **payments** - Payment transactions
- **expenses** - Expense records
- **ledger_entries** - Double-entry accounting
- **whatsapp_config** - WhatsApp integration settings
- **whatsapp_messages** - Message logs

For full schema details, see `database/schema.sql`.

## Next Steps

1. Start the development server: `npm run dev`
2. Test API endpoints with your business_id
3. Create customers, items, and invoices via the API

## Production Considerations

For production:
- Use environment-specific database credentials
- Enable SSL connections (`DB_SSL=true`)
- Set up database backups
- Use connection pooling (already configured)
- Monitor database performance

