# Quick Start Guide

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Navigate the App

- **Login Page:** `/login` - Simple login interface
- **Dashboard:** `/dashboard` - Overview with KPIs and quick actions
- **Customers:** `/customers` - Customer management
- **Items:** `/items` - Inventory management
- **Invoices:** `/invoices` - Invoice list and builder
- **Templates:** `/invoices/templates` - Template selector and customizer
- **Settings:** `/settings` - Business settings

## 📱 Key Features Implemented

### ✅ Complete UI Screens

1. **Login/Onboarding** - Clean, centered login card
2. **Dashboard** - KPI cards, recent invoices, low stock alerts
3. **Customers List** - Searchable table with filters
4. **Customer Detail** - Tabs for summary, transactions, ledger
5. **Items List** - Inventory with stock status indicators
6. **Invoice List** - Filterable invoice table
7. **Invoice Builder** - Two-column responsive layout with:
   - Customer selection
   - Dynamic item rows
   - Real-time calculations
   - Payment recording
   - Notes and terms
8. **Template Selector** - Grid of available templates
9. **Template Customizer** - Live preview with:
   - Color customization
   - Field visibility toggles
   - Paper size selection
10. **Settings** - Business profile, tax, invoice defaults
11. **WhatsApp Center** - Connection and reminder setup

### 🎨 Design System

- **Colors:** Primary (Indigo), Accent (Teal), Surface, Background
- **Components:** Button, Card, Input, Chip
- **Layout:** Sidebar (desktop), Bottom Nav (mobile), TopBar
- **Responsive:** Works on desktop, tablet, and mobile

### 📄 Template System

Two example templates included:

1. **Indigo Stripe** (`templates/indigo-stripe.json`)
   - Customizable colors
   - Modern design with gradient header

2. **Monochrome Audit** (`templates/monochrome-audit.json`)
   - Print-friendly
   - Grayscale design

## 🔧 Project Structure

```
khatario/
├── app/                      # Next.js pages
│   ├── login/               # Login screen
│   ├── dashboard/           # Dashboard
│   ├── customers/           # Customer management
│   ├── items/               # Inventory
│   ├── invoices/            # Invoice system
│   │   ├── new/            # Invoice builder
│   │   └── templates/      # Template system
│   ├── settings/            # Settings
│   └── layout.tsx          # Root layout
├── components/
│   ├── ui/                 # Reusable components
│   └── layout/             # Layout components
├── templates/              # Invoice template JSONs
├── types/                  # TypeScript definitions
└── config/                 # Theme configuration
```

## 📝 Template JSON Structure

Templates are defined in JSON with:

- **Sections:** header, party_info, items_table, summary, footer
- **Settings:** Show/hide fields, colors, terms
- **Bindings:** `{{variable}}` syntax for dynamic data

Example binding:
```json
{
  "value": "{{invoice.number}}",
  "visible": "{{settings.show_invoice_number}}"
}
```

## 🎯 Next Steps

1. **Backend Integration**
   - Connect to database
   - API routes for CRUD operations
   - Authentication system

2. **Features to Add**
   - PDF generation
   - WhatsApp API integration
   - Reports module
   - Multi-business support
   - User roles

3. **Enhancements**
   - Real-time data
   - Offline support
   - Advanced filters
   - Export functionality

## 🐛 Troubleshooting

### Module not found errors
```bash
npm install
```

### TypeScript errors
Check `tsconfig.json` paths configuration.

### Styling issues
Ensure Tailwind CSS is properly configured in `tailwind.config.js`.

## 📚 Documentation

- See `README.md` for detailed documentation
- Check component files for inline comments
- Template schema defined in `types/template.ts`

---

**Ready to build!** Start by exploring the dashboard and invoice builder. 🎉

