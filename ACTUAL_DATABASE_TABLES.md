# Actual Database Tables in Khatario

## Tables that EXIST (verified from schema.sql and migrations):

### Core Business
- businesses
- users
- business_locations
- branches (migration 119)
- warehouses (migration 119)
- branch_warehouses (migration 119)
- user_branches (migration 122)
- user_warehouses (migration 117)

### Master Data
- customers
- suppliers
- categories (NOT "item_categories")
- items
- item_batches (migration 077)
- item_serials (migration 077)

### Transactions
- invoices, invoice_items
- purchases, purchase_items  
- estimates, estimate_items
- credit_notes, credit_note_items
- debit_notes, debit_note_items
- payments
- expenses, expense_categories
- advance_payments
- recurring_invoices, recurring_invoice_history

### Inventory
- stock_movements
- location_stock
- stock_transfers, stock_transfer_items

### Accounting
- ledger_entries
- accounts (migration 063)
- account_groups (migration 063)
- bank_accounts (migration 066)
- journal_entries (migration 072)
- journal_entry_lines (migration 072)

### Tax & Compliance
- itc_reversals

### Settings & Templates
- invoice_template_settings

### WhatsApp
- whatsapp_config
- whatsapp_messages
- whatsapp_reminder_settings
- whatsapp_keywords

### Others
- todos (migration 049)

## Tables that DO NOT EXIST (need to remove from backup):

- ❌ item_categories (should be "categories")
- ❌ stock_adjustments
- ❌ stock_reservations
- ❌ tds_tcs_entries
- ❌ provisions
- ❌ gstr2b_imports
- ❌ gstr2b_invoices
- ❌ gstr2b_reconciliation
- ❌ reconciliation_decisions
- ❌ tasks
- ❌ activity_logs
- ❌ notifications
- ❌ custom_fields
- ❌ tags
- ❌ notes
- ❌ sales_orders
- ❌ purchase_orders
- ❌ delivery_challans
