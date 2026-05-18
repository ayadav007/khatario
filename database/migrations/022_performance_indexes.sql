-- Performance optimization indexes
-- Run this migration to add missing indexes for better query performance

-- Indexes for current_balance queries (used in receivables/payables calculations)
CREATE INDEX IF NOT EXISTS idx_customers_current_balance ON customers(business_id, current_balance) WHERE current_balance > 0;
CREATE INDEX IF NOT EXISTS idx_suppliers_current_balance ON suppliers(business_id, current_balance) WHERE current_balance > 0;

-- Index for items is_active queries
CREATE INDEX IF NOT EXISTS idx_items_is_active ON items(business_id, is_active) WHERE is_active = true;

-- Index for purchases bill_date (used in date range queries)
CREATE INDEX IF NOT EXISTS idx_purchases_bill_date ON purchases(business_id, bill_date);

-- Composite index for invoice date range queries with status
CREATE INDEX IF NOT EXISTS idx_invoices_date_status ON invoices(business_id, invoice_date, status) WHERE status != 'cancelled';

-- Composite index for purchase date range queries with status
CREATE INDEX IF NOT EXISTS idx_purchases_date_status ON purchases(business_id, bill_date, status) WHERE status != 'cancelled';

-- Index for items current_stock queries (used in low stock alerts)
CREATE INDEX IF NOT EXISTS idx_items_stock ON items(business_id, current_stock, min_stock, is_active) WHERE is_active = true;

-- Index for customers/suppliers search (name, phone)
CREATE INDEX IF NOT EXISTS idx_customers_search ON customers(business_id, name, phone) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_suppliers_search ON suppliers(business_id, name, phone) WHERE is_active = true;

