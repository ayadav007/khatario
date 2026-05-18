# Khatario - Modern Invoice & Billing Application

A modern, feature-rich invoice and billing application built with Next.js, TypeScript, and Tailwind CSS. Designed with a clean, minimal UI and a flexible template system for customizing invoices.

## Features

### Core Modules

- ✅ **Dashboard** - Real-time KPIs, recent invoices, low stock alerts
- ✅ **Customers** - Customer management with receivables tracking
- ✅ **Items/Inventory** - Product management with stock tracking
- ✅ **Invoices** - Full-featured invoice builder with template system
- ✅ **Purchases** - Purchase bill management
- ✅ **Expenses** - Expense tracking and categorization
- ✅ **Reports** - Comprehensive reporting system
- ✅ **Settings** - Business profile and configuration

### Invoice System

- **Invoice Builder** - Two-column layout with real-time calculations
- **Template System** - JSON-based template engine
  - Indigo Stripe (customizable colors)
  - Monochrome Audit (print-friendly)
- **Template Customizer** - Live preview with color customization
- **Payment Integration** - Record payments directly from invoice

### Design System

- Modern, minimal design with rounded corners
- Responsive layout (desktop, tablet, mobile)
- Customizable color scheme
- Consistent component library

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **UI Components:** Custom components + Radix UI primitives
- **Icons:** Lucide React

## Project Structure

```
khatario/
├── app/                    # Next.js app directory
│   ├── login/             # Login/onboarding
│   ├── dashboard/         # Dashboard page
│   ├── customers/         # Customer management
│   ├── items/             # Inventory management
│   ├── invoices/          # Invoice management
│   │   ├── new/          # Invoice builder
│   │   └── templates/    # Template selector & customizer
│   └── layout.tsx        # Root layout
├── components/
│   ├── ui/               # Reusable UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   └── Chip.tsx
│   └── layout/           # Layout components
│       ├── Sidebar.tsx
│       ├── TopBar.tsx
│       ├── BottomNav.tsx
│       └── AppLayout.tsx
├── templates/            # Invoice template JSONs
│   ├── indigo-stripe.json
│   └── monochrome-audit.json
├── types/               # TypeScript type definitions
│   └── template.ts
├── config/              # Configuration files
│   └── theme.json       # Design system theme
└── public/              # Static assets
```

## Getting Started

### Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### Environment Setup

Create a `.env.local` file in the root directory:

```env
# Add your environment variables here
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Design System

The app uses a custom design system with:

- **Primary Color:** Indigo (#3949AB)
- **Accent Color:** Teal (#00897B)
- **Surface:** White
- **Background:** Light Gray (#F7F9FC)

See `config/theme.json` for the complete theme configuration.

## Invoice Template System

Templates are defined in JSON format and stored in the `templates/` directory. Each template includes:

- Section definitions (header, party info, items table, summary, footer)
- Default colors
- Customizable settings (show/hide fields, colors, etc.)

### Example Template Structure

```json
{
  "id": "template_id",
  "name": "Template Name",
  "paper_size": "A4",
  "orientation": "portrait",
  "supports_custom_colors": true,
  "default_colors": {
    "header": "#3949AB",
    "accent": "#00897B",
    "table_header": "#EEF1F8",
    "text": "#1A1A1A"
  },
  "sections": {
    "header": { ... },
    "party_info": { ... },
    "items_table": { ... },
    "summary": { ... },
    "footer": { ... }
  }
}
```

## Key Screens

### 1. Dashboard
- KPI cards (Sales, Purchases, Receivables, Payables)
- Recent invoices table
- Low stock alerts
- Quick action buttons

### 2. Invoice Builder
- Two-column responsive layout
- Real-time calculations
- Item management with tax and discounts
- Payment recording
- Notes and terms

### 3. Template Customizer
- Live preview panel
- Color customization
- Field visibility toggles
- Paper size selection

## Development

### Adding a New Screen

1. Create a new page in `app/[screen-name]/page.tsx`
2. Use the `AppLayout` component for consistent layout
3. Follow the existing component patterns
4. Add navigation item in `components/layout/Sidebar.tsx`

### Creating a New Template

1. Create a JSON file in `templates/` directory
2. Follow the template schema defined in `types/template.ts`
3. Import and add to the templates array in the template selector

## Database & Backend

### PostgreSQL Integration ✅

- Complete database schema with 20+ tables
- Database connection utility with connection pooling
- API routes for all entities (customers, items, invoices, etc.)
- Migration script for easy setup

**Setup:**
```bash
# Create database
createdb khatario

# Configure .env.local
DB_HOST=localhost
DB_PORT=5432
DB_NAME=khatario
DB_USER=postgres
DB_PASSWORD=your_password

# Run migrations
npm run db:migrate
```

See `docs/DATABASE_SETUP.md` for detailed instructions.

### API Endpoints ✅

- `GET /api/dashboard` - Dashboard KPIs and summary
- `GET /api/customers` - List customers
- `POST /api/customers` - Create customer
- `GET /api/items` - List items
- `POST /api/items` - Create item
- `GET /api/invoices` - List invoices
- `POST /api/invoices` - Create invoice
- `POST /api/invoices/{id}/whatsapp` - Send invoice via WhatsApp

See `docs/API_USAGE.md` for complete API documentation.

## WhatsApp Integration ✅

### Features

- **WhatsApp Cloud API** support (official Meta API)
- **WhatsApp Web.js** support (for development)
- Automatic payment reminders
- Message logging and tracking
- Custom message templates

### How It Works

1. Invoice created → PDF generated
2. User clicks "Send via WhatsApp"
3. PDF + message sent to customer's phone
4. Message logged in database

**Setup:**
1. Configure WhatsApp in Settings → WhatsApp & Sharing
2. Connect using Cloud API or Web session
3. Start sending invoices!

See `docs/WHATSAPP_INTEGRATION.md` for detailed setup guide.

## Roadmap

- [x] Backend API integration ✅
- [x] Database setup (PostgreSQL) ✅
- [x] WhatsApp integration ✅
- [ ] Authentication system
- [ ] PDF generation (templates ready, need implementation)
- [ ] Multi-business support
- [ ] User roles and permissions
- [ ] Cloud backup/sync
- [ ] Mobile app (React Native)

## License

MIT

