-- Khatario Database Schema
-- PostgreSQL Database Schema for Invoice & Billing Application

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Platform Administration
CREATE TABLE IF NOT EXISTS platform_admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    -- Roles: 'super_admin', 'admin', 'support', 'viewer'
    permissions JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMP,
    auth_session_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Platform Admin Activity Logs
CREATE TABLE IF NOT EXISTS platform_admin_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL, -- 'login', 'create_business', 'update_subscription', etc.
    entity_type VARCHAR(50), -- 'business', 'subscription', 'plan', 'admin'
    entity_id UUID,
    details JSONB,
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Business/User Management
CREATE TABLE IF NOT EXISTS businesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    address_line1 TEXT,
    address_line2 TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    state_code VARCHAR(2), -- GST state code (e.g., '29' for Karnataka)
    pincode VARCHAR(10),
    gstin VARCHAR(15),
    pan VARCHAR(10),
    logo_url TEXT,
    currency VARCHAR(3) DEFAULT 'INR',
    invoice_prefix VARCHAR(10) DEFAULT 'INV',
    next_invoice_number INTEGER DEFAULT 1,
    default_tax_rate DECIMAL(5,2) DEFAULT 18.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users/Staff
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash TEXT,
    role VARCHAR(50) DEFAULT 'user',
    permissions JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    product_tour_completed_at TIMESTAMPTZ,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User ↔ business membership (multi-company); app-level role per business
CREATE TABLE IF NOT EXISTS user_businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_businesses_user_business_unique UNIQUE (user_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_user_businesses_business_id ON user_businesses(business_id);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    phone VARCHAR(20),
    email VARCHAR(255),
    address TEXT,
    billing_address TEXT,
    shipping_address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    state_code VARCHAR(2),  -- GST state code (e.g., '29' for Karnataka)
    pincode VARCHAR(10),
    shipping_city VARCHAR(100),
    shipping_state VARCHAR(100),
    shipping_pincode VARCHAR(20),
    country VARCHAR(100) DEFAULT 'India',
    gstin VARCHAR(15),
    opening_balance DECIMAL(12,2) DEFAULT 0,
    opening_balance_type VARCHAR(10) DEFAULT 'debit' CHECK (opening_balance_type IN ('debit', 'credit')),
    credit_limit DECIMAL(12,2) DEFAULT 0,
    tags TEXT[],
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    state_code VARCHAR(2),  -- GST state code (e.g., '29' for Karnataka)
    pincode VARCHAR(10),
    gstin VARCHAR(15),
    opening_balance DECIMAL(12,2) DEFAULT 0,
    opening_balance_type VARCHAR(10) DEFAULT 'credit' CHECK (opening_balance_type IN ('debit', 'credit')),
    credit_limit DECIMAL(12,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Item Categories
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Items/Products
CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100),
    barcode VARCHAR(100),
    description TEXT,
    unit VARCHAR(50) DEFAULT 'PCS',
    hsn_sac VARCHAR(10),
    item_type VARCHAR(20) DEFAULT 'goods' CHECK (item_type IN ('goods', 'service')),
    purchase_price DECIMAL(12,2) DEFAULT 0,
    selling_price DECIMAL(12,2),
    mrp DECIMAL(12,2),
    tax_rate DECIMAL(5,2) DEFAULT 18.00,
    opening_stock DECIMAL(10,2) DEFAULT 0,
    current_stock DECIMAL(10,2) DEFAULT 0,
    min_stock DECIMAL(10,2) DEFAULT 0,
    image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Branch-level stock (when business_settings.warehouses_enabled is false)
CREATE TABLE IF NOT EXISTS branch_item_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity DECIMAL(15, 3) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_branch_item_stock_biz_branch_item UNIQUE (business_id, branch_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_item_stock_business_branch ON branch_item_stock (business_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_item_stock_item ON branch_item_stock (business_id, item_id);

-- Stock Movements
CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL, -- 'in', 'out', 'adjustment'
    quantity DECIMAL(10,2) NOT NULL,
    reference_type VARCHAR(50), -- 'purchase', 'sale', 'return', 'adjustment'
    reference_id UUID,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    billing_address TEXT,
    shipping_address TEXT,
    invoice_number VARCHAR(100) NOT NULL,
    invoice_date DATE NOT NULL,
    due_date DATE,
    status VARCHAR(20) DEFAULT 'draft', -- 'draft', 'final', 'cancelled'
    payment_status VARCHAR(20) DEFAULT 'unpaid', -- 'unpaid', 'partially_paid', 'paid'
    place_of_supply_state_code VARCHAR(2), -- For GST: determines IGST vs CGST+SGST
    is_reverse_charge BOOLEAN DEFAULT false,
    is_editable BOOLEAN DEFAULT true,
    cancellation_details JSONB DEFAULT NULL,
    document_type VARCHAR(50) DEFAULT 'regular', -- 'regular', 'bill_of_supply', 'export_invoice', etc.
    supply_type VARCHAR(50), -- 'b2b', 'b2c_large', 'b2c_small', 'export', 'sez', 'deemed_export'
    export_type VARCHAR(50), -- 'wop' (without payment), 'wp' (with payment)
    shipping_bill_number VARCHAR(100),
    shipping_bill_date DATE,
    port_code VARCHAR(10),
    ecommerce_operator_gstin VARCHAR(15),
    is_ecommerce_supply BOOLEAN DEFAULT false,
    subtotal DECIMAL(12,2) DEFAULT 0,
    discount_total DECIMAL(12,2) DEFAULT 0,
    additional_charges DECIMAL(12,2) DEFAULT 0,
    tax_total DECIMAL(12,2) DEFAULT 0,
    cgst_total DECIMAL(12,2) DEFAULT 0,
    sgst_total DECIMAL(12,2) DEFAULT 0,
    igst_total DECIMAL(12,2) DEFAULT 0,
    round_off DECIMAL(12,2) DEFAULT 0,
    grand_total DECIMAL(12,2) DEFAULT 0,
    paid_amount DECIMAL(12,2) DEFAULT 0,
    balance_amount DECIMAL(12,2) DEFAULT 0,
    notes TEXT,
    terms TEXT,
    template_id VARCHAR(100),
    template_settings JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    CONSTRAINT chk_invoice_status CHECK (status IN ('draft','final','cancelled')),
    CONSTRAINT chk_invoice_payment_status CHECK (payment_status IN ('unpaid','partially_paid','paid'))
);

-- Invoice Items
CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    item_name VARCHAR(255) NOT NULL,
    description TEXT,
    hsn_sac VARCHAR(10),
    quantity DECIMAL(10,2) NOT NULL,
    unit VARCHAR(50),
    unit_price DECIMAL(12,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 0,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    taxable_value DECIMAL(12,2) DEFAULT 0,  -- After discount, before tax
    cgst_amount DECIMAL(12,2) DEFAULT 0,
    sgst_amount DECIMAL(12,2) DEFAULT 0,
    igst_amount DECIMAL(12,2) DEFAULT 0,
    line_total DECIMAL(12,2) NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- Purchases
CREATE TABLE IF NOT EXISTS purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    bill_number VARCHAR(100),
    bill_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',
    place_of_supply_state_code VARCHAR(2),
    is_reverse_charge BOOLEAN DEFAULT false,
    supplier_gstin VARCHAR(15),  -- Denormalized from suppliers table
    document_type VARCHAR(50) DEFAULT 'tax_invoice',  -- 'tax_invoice', 'bill_of_supply', 'bill_of_entry', etc.
    itc_eligible BOOLEAN DEFAULT true,
    itc_availed BOOLEAN DEFAULT false,
    itc_availed_date DATE,
    subtotal DECIMAL(12,2) DEFAULT 0,
    tax_total DECIMAL(12,2) DEFAULT 0,
    cgst_total DECIMAL(12,2) DEFAULT 0,
    sgst_total DECIMAL(12,2) DEFAULT 0,
    igst_total DECIMAL(12,2) DEFAULT 0,
    grand_total DECIMAL(12,2) DEFAULT 0,
    paid_amount DECIMAL(12,2) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Purchase Items
CREATE TABLE IF NOT EXISTS purchase_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_id UUID REFERENCES purchases(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    item_name VARCHAR(255) NOT NULL,
    hsn_sac VARCHAR(10),
    quantity DECIMAL(10,2) NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    taxable_value DECIMAL(12,2) DEFAULT 0,  -- After discount, before tax
    tax_rate DECIMAL(5,2) DEFAULT 0,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    cgst_amount DECIMAL(12,2) DEFAULT 0,
    sgst_amount DECIMAL(12,2) DEFAULT 0,
    igst_amount DECIMAL(12,2) DEFAULT 0,
    line_total DECIMAL(12,2) NOT NULL
);

-- Payments (Receivables/Payables)
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    type VARCHAR(20) NOT NULL, -- 'receivable' (in), 'payable' (out)
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    reference_type VARCHAR(50), -- 'invoice', 'purchase'
    reference_id UUID,
    amount DECIMAL(12,2) NOT NULL,
    payment_mode VARCHAR(50), -- 'cash', 'upi', 'bank', 'cheque', 'credit'
    payment_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    -- Ensure payment is linked to party type (allows both NULL for cash sales)
    CONSTRAINT check_payment_party CHECK (
        (customer_id IS NOT NULL AND supplier_id IS NULL) OR 
        (customer_id IS NULL AND supplier_id IS NOT NULL) OR
        (customer_id IS NULL AND supplier_id IS NULL)
    )
);

-- Expense Categories
CREATE TABLE IF NOT EXISTS expense_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, name)
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
    category VARCHAR(100), -- Keep for backward compatibility, use category_id going forward
    amount DECIMAL(12,2) NOT NULL,
    description TEXT,
    expense_date DATE NOT NULL,
    payment_mode VARCHAR(50),
    reference_number VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    cgst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    sgst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    igst_amount DECIMAL(12,2) NOT NULL DEFAULT 0
);

-- Ledger Entries (Double Entry)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    entry_date DATE NOT NULL,
    account_type VARCHAR(50) NOT NULL, -- 'customer', 'supplier', 'expense', 'income'
    account_id UUID,
    transaction_type VARCHAR(50) NOT NULL, -- 'invoice', 'payment', 'purchase', 'expense'
    transaction_id UUID,
    debit DECIMAL(12,2) DEFAULT 0,
    credit DECIMAL(12,2) DEFAULT 0,
    balance DECIMAL(12,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subscription Plans
CREATE TABLE IF NOT EXISTS subscription_plans (
    id VARCHAR(50) PRIMARY KEY, -- 'free', 'professional', 'business', 'enterprise'
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    price_monthly DECIMAL(10,2) DEFAULT 0,
    price_yearly DECIMAL(10,2) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'INR',
    features JSONB NOT NULL, -- {"max_invoices": 20, "max_customers": 10, ...}
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Feature Flags (Master list of all toggleable features)
CREATE TABLE IF NOT EXISTS feature_flags (
    id VARCHAR(100) PRIMARY KEY, -- 'whatsapp_integration', 'thermal_printing', etc.
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50), -- 'invoicing', 'reports', 'integrations', 'limits'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Business Subscriptions (Which plan each business is on)
CREATE TABLE IF NOT EXISTS business_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) REFERENCES subscription_plans(id),
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'expired', 'cancelled', 'trial'
    start_date DATE NOT NULL,
    end_date DATE, -- NULL for lifetime/perpetual
    trial_end_date DATE,
    auto_renew BOOLEAN DEFAULT true,
    payment_method VARCHAR(50), -- 'razorpay', 'stripe', 'manual'
    payment_reference VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id) -- One active subscription per business
);

-- Subscription Usage Tracking (for limits enforcement)
CREATE TABLE IF NOT EXISTS subscription_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    metric VARCHAR(100) NOT NULL, -- 'invoices_count', 'whatsapp_messages', 'users_count'
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    current_count INTEGER DEFAULT 0,
    limit_count INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, metric, period_start)
);

-- Invoice Templates
CREATE TABLE IF NOT EXISTS invoice_templates (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    template_json JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Template Settings (User customizations)
CREATE TABLE IF NOT EXISTS invoice_template_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    template_id VARCHAR(100) REFERENCES invoice_templates(id),
    settings JSONB NOT NULL,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- WhatsApp Configuration
CREATE TABLE IF NOT EXISTS whatsapp_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    connection_type VARCHAR(50) NOT NULL, -- 'cloud_api', 'web_session'
    UNIQUE(business_id), -- One WhatsApp config per business
    api_key TEXT,
    api_secret TEXT,
    phone_number_id VARCHAR(100),
    session_data JSONB, -- For web session storage
    is_connected BOOLEAN DEFAULT false,
    last_connected_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- WhatsApp Message Logs
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    to_number VARCHAR(20) NOT NULL,
    message_type VARCHAR(50) NOT NULL, -- 'invoice', 'reminder', 'payment', 'manual'
    reference_type VARCHAR(50), -- 'invoice', 'payment'
    reference_id UUID,
    message_text TEXT,
    media_url TEXT,
    status VARCHAR(50) NOT NULL, -- 'sent', 'delivered', 'read', 'failed'
    error_message TEXT,
    baileys_message_id VARCHAR(128) NULL,
    reminder_source VARCHAR(32) NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- WhatsApp Reminder Settings
CREATE TABLE IF NOT EXISTS whatsapp_reminder_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    reminder_type VARCHAR(50) NOT NULL, -- 'payment_due', 'overdue'
    enabled BOOLEAN DEFAULT false,
    days_before INTEGER, -- For payment_due
    interval_days INTEGER, -- For overdue reminders
    message_template TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- WhatsApp Sessions (Baileys auth state) - one per business
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'disconnected', -- disconnected, pending_qr, connected, error
    phone_number VARCHAR(30),
    auth_state JSONB, -- Baileys auth credentials
    last_qr TEXT,
    last_error TEXT,
    last_connected_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- WhatsApp Keyword Auto-Replies (per business)
CREATE TABLE IF NOT EXISTS whatsapp_keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    keyword VARCHAR(100) NOT NULL,
    reply_text TEXT NOT NULL,
    is_exact BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Recurring Invoices
CREATE TABLE IF NOT EXISTS recurring_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    template_invoice_id UUID, -- Reference invoice to copy from
    invoice_prefix VARCHAR(50),
    frequency VARCHAR(20) NOT NULL, -- 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'
    interval_value INTEGER DEFAULT 1, -- Every X days/weeks/months
    start_date DATE NOT NULL,
    end_date DATE, -- NULL = no end date
    next_run_date DATE NOT NULL,
    last_run_date DATE,
    is_active BOOLEAN DEFAULT true,
    items JSONB NOT NULL, -- Store invoice items template
    notes TEXT,
    terms TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Recurring Invoice History
CREATE TABLE IF NOT EXISTS recurring_invoice_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recurring_invoice_id UUID REFERENCES recurring_invoices(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    run_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'success', 'failed', 'skipped'
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Estimates (Quotations)
CREATE TABLE IF NOT EXISTS estimates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    estimate_number VARCHAR(100) NOT NULL,
    estimate_date DATE NOT NULL,
    expiry_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- 'draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'
    subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount_total DECIMAL(15, 2) DEFAULT 0,
    tax_total DECIMAL(15, 2) DEFAULT 0,
    round_off DECIMAL(10, 2) DEFAULT 0,
    grand_total DECIMAL(15, 2) NOT NULL DEFAULT 0,
    additional_charges DECIMAL(10, 2) DEFAULT 0,
    additional_charges_label VARCHAR(100),
    notes TEXT,
    terms TEXT,
    converted_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Estimate Items
CREATE TABLE IF NOT EXISTS estimate_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    estimate_id UUID REFERENCES estimates(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    qty DECIMAL(10, 2) NOT NULL,
    unit VARCHAR(50),
    unit_price DECIMAL(15, 2) NOT NULL,
    discount DECIMAL(10, 2) DEFAULT 0,
    tax_rate DECIMAL(5, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    line_total DECIMAL(15, 2) NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- Credit Notes (for invoice returns/refunds)
CREATE TABLE IF NOT EXISTS credit_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    credit_note_number VARCHAR(100) NOT NULL,
    credit_note_date DATE NOT NULL,
    original_invoice_date DATE,  -- Reference to original invoice date
    reason VARCHAR(200),
    place_of_supply_state_code VARCHAR(2),
    subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount_total DECIMAL(15, 2) DEFAULT 0,
    tax_total DECIMAL(15, 2) DEFAULT 0,
    cgst_total DECIMAL(12,2) DEFAULT 0,
    sgst_total DECIMAL(12,2) DEFAULT 0,
    igst_total DECIMAL(12,2) DEFAULT 0,
    round_off DECIMAL(10, 2) DEFAULT 0,
    grand_total DECIMAL(15, 2) NOT NULL DEFAULT 0,
    refund_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'refunded', 'adjusted'
    refund_amount DECIMAL(15, 2) DEFAULT 0,
    refund_mode VARCHAR(50), -- 'cash', 'bank', 'adjusted_to_invoice'
    refund_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Credit Note Items
CREATE TABLE IF NOT EXISTS credit_note_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    credit_note_id UUID REFERENCES credit_notes(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    qty DECIMAL(10, 2) NOT NULL,
    unit VARCHAR(50),
    unit_price DECIMAL(15, 2) NOT NULL,
    discount DECIMAL(10, 2) DEFAULT 0,
    tax_rate DECIMAL(5, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    line_total DECIMAL(15, 2) NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- Business Locations (Branches)
CREATE TABLE IF NOT EXISTS business_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    location_code VARCHAR(50),
    is_primary BOOLEAN DEFAULT false,
    address_line1 VARCHAR(200),
    address_line2 VARCHAR(200),
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(20),
    country VARCHAR(100) DEFAULT 'India',
    phone VARCHAR(50),
    email VARCHAR(100),
    gstin VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Location-wise Stock (for multi-location inventory)
CREATE TABLE IF NOT EXISTS location_stock (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id UUID REFERENCES business_locations(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE CASCADE,
    current_stock_qty DECIMAL(15, 3) DEFAULT 0,
    min_stock_qty DECIMAL(15, 3) DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(location_id, item_id)
);

-- Stock Transfers (between locations)
CREATE TABLE IF NOT EXISTS stock_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    transfer_number VARCHAR(100) NOT NULL,
    transfer_date DATE NOT NULL,
    from_location_id UUID REFERENCES business_locations(id) ON DELETE RESTRICT,
    to_location_id UUID REFERENCES business_locations(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'in_transit', 'completed', 'cancelled'
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Stock Transfer Items
CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID REFERENCES stock_transfers(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE RESTRICT,
    qty DECIMAL(10, 2) NOT NULL,
    unit VARCHAR(50),
    notes TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_customers_business_id ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_items_business_id ON items(business_id);
CREATE INDEX IF NOT EXISTS idx_items_code ON items(code);
CREATE INDEX IF NOT EXISTS idx_invoices_business_id ON invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
-- Unique invoice number per business (not globally)
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_business_invoice_number 
ON invoices(business_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_payments_business_id ON payments(business_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_supplier_id ON payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_id ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_business_id ON ledger_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_type, account_id);

-- WhatsApp message indexes
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_business_id ON whatsapp_messages(business_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_to_number ON whatsapp_messages(to_number);

-- Unique constraint: Only one default template per business
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_template_settings_default
ON invoice_template_settings(business_id)
WHERE is_default = true;

-- Subscription indexes
CREATE INDEX IF NOT EXISTS idx_business_subscriptions_business_id ON business_subscriptions(business_id);
CREATE INDEX IF NOT EXISTS idx_business_subscriptions_plan_id ON business_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_business_subscriptions_status ON business_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscription_usage_business_metric ON subscription_usage(business_id, metric, period_start);

-- Platform admin indexes
CREATE INDEX IF NOT EXISTS idx_platform_admins_email ON platform_admins(email);
CREATE INDEX IF NOT EXISTS idx_platform_admins_role ON platform_admins(role);
CREATE INDEX IF NOT EXISTS idx_platform_admin_logs_admin_id ON platform_admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_platform_admin_logs_created_at ON platform_admin_logs(created_at);

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update triggers (drop existing first to avoid errors)
DROP TRIGGER IF EXISTS update_businesses_updated_at ON businesses;
CREATE TRIGGER update_businesses_updated_at BEFORE UPDATE ON businesses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_items_updated_at ON items;
CREATE TRIGGER update_items_updated_at BEFORE UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_invoices_updated_at ON invoices;
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_suppliers_updated_at ON suppliers;
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_whatsapp_config_updated_at ON whatsapp_config;
CREATE TRIGGER update_whatsapp_config_updated_at BEFORE UPDATE ON whatsapp_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_invoice_template_settings_updated_at ON invoice_template_settings;
CREATE TRIGGER update_invoice_template_settings_updated_at BEFORE UPDATE ON invoice_template_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_whatsapp_reminder_settings_updated_at ON whatsapp_reminder_settings;
CREATE TRIGGER update_whatsapp_reminder_settings_updated_at BEFORE UPDATE ON whatsapp_reminder_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_expense_categories_updated_at ON expense_categories;
CREATE TRIGGER update_expense_categories_updated_at BEFORE UPDATE ON expense_categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscription_plans_updated_at ON subscription_plans;
CREATE TRIGGER update_subscription_plans_updated_at BEFORE UPDATE ON subscription_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_business_subscriptions_updated_at ON business_subscriptions;
CREATE TRIGGER update_business_subscriptions_updated_at BEFORE UPDATE ON business_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscription_usage_updated_at ON subscription_usage;
CREATE TRIGGER update_subscription_usage_updated_at BEFORE UPDATE ON subscription_usage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_platform_admins_updated_at ON platform_admins;
CREATE TRIGGER update_platform_admins_updated_at BEFORE UPDATE ON platform_admins
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_recurring_invoices_updated_at ON recurring_invoices;
CREATE TRIGGER update_recurring_invoices_updated_at BEFORE UPDATE ON recurring_invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_estimates_updated_at ON estimates;
CREATE TRIGGER update_estimates_updated_at BEFORE UPDATE ON estimates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_credit_notes_updated_at ON credit_notes;
CREATE TRIGGER update_credit_notes_updated_at BEFORE UPDATE ON credit_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_business_locations_updated_at ON business_locations;
CREATE TRIGGER update_business_locations_updated_at BEFORE UPDATE ON business_locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_stock_transfers_updated_at ON stock_transfers;
CREATE TRIGGER update_stock_transfers_updated_at BEFORE UPDATE ON stock_transfers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Debit Notes (for sales-side adjustments)
CREATE TABLE IF NOT EXISTS debit_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    debit_note_number VARCHAR(100) NOT NULL,
    debit_note_date DATE NOT NULL,
    reason VARCHAR(200),
    subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount_total DECIMAL(15, 2) DEFAULT 0,
    tax_total DECIMAL(15, 2) DEFAULT 0,
    cgst_total DECIMAL(12,2) DEFAULT 0,
    sgst_total DECIMAL(12,2) DEFAULT 0,
    igst_total DECIMAL(12,2) DEFAULT 0,
    round_off DECIMAL(10, 2) DEFAULT 0,
    grand_total DECIMAL(15, 2) NOT NULL DEFAULT 0,
    place_of_supply_state_code VARCHAR(2),
    original_invoice_date DATE,
    adjustment_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'adjusted', 'refunded'
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    CONSTRAINT unique_business_debit_note UNIQUE(business_id, debit_note_number)
);

-- Debit Note Items
CREATE TABLE IF NOT EXISTS debit_note_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    debit_note_id UUID REFERENCES debit_notes(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    hsn_sac VARCHAR(10),
    qty DECIMAL(10, 2) NOT NULL,
    unit VARCHAR(50),
    unit_price DECIMAL(15, 2) NOT NULL,
    discount DECIMAL(10, 2) DEFAULT 0,
    tax_rate DECIMAL(5, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    cgst_amount DECIMAL(12,2) DEFAULT 0,
    sgst_amount DECIMAL(12,2) DEFAULT 0,
    igst_amount DECIMAL(12,2) DEFAULT 0,
    taxable_value DECIMAL(12,2) DEFAULT 0,
    line_total DECIMAL(15, 2) NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- Advance Payments (for advances received/paid)
CREATE TABLE IF NOT EXISTS advance_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('received', 'paid')),
    amount DECIMAL(12,2) NOT NULL,
    cgst DECIMAL(12,2) DEFAULT 0,
    sgst DECIMAL(12,2) DEFAULT 0,
    igst DECIMAL(12,2) DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 18.00,
    payment_date DATE NOT NULL,
    adjusted_invoice_id UUID,
    adjusted_purchase_id UUID,
    is_adjusted BOOLEAN DEFAULT false,
    adjustment_date DATE,
    place_of_supply_state_code VARCHAR(2),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    CONSTRAINT check_advance_payment_party CHECK (
        (customer_id IS NOT NULL AND supplier_id IS NULL) OR 
        (customer_id IS NULL AND supplier_id IS NOT NULL)
    ),
    CONSTRAINT check_advance_adjustment CHECK (
        (type = 'received' AND adjusted_invoice_id IS NOT NULL AND adjusted_purchase_id IS NULL) OR
        (type = 'paid' AND adjusted_purchase_id IS NOT NULL AND adjusted_invoice_id IS NULL) OR
        (is_adjusted = false)
    )
);

-- ITC Reversals (for ITC reversal tracking)
CREATE TABLE IF NOT EXISTS itc_reversals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    reversal_reason VARCHAR(100) NOT NULL,
    cgst_reversed DECIMAL(12,2) DEFAULT 0,
    sgst_reversed DECIMAL(12,2) DEFAULT 0,
    igst_reversed DECIMAL(12,2) DEFAULT 0,
    reversal_date DATE NOT NULL,
    financial_year VARCHAR(10),
    tax_period VARCHAR(10),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- Indexes for new tables
CREATE INDEX IF NOT EXISTS idx_debit_notes_business_id ON debit_notes(business_id);
CREATE INDEX IF NOT EXISTS idx_debit_notes_customer_id ON debit_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_debit_notes_invoice_id ON debit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_debit_notes_date ON debit_notes(debit_note_date);
CREATE INDEX IF NOT EXISTS idx_debit_note_items_debit_note_id ON debit_note_items(debit_note_id);
CREATE INDEX IF NOT EXISTS idx_advance_payments_business_id ON advance_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_advance_payments_customer_id ON advance_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_advance_payments_supplier_id ON advance_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_advance_payments_type ON advance_payments(type);
CREATE INDEX IF NOT EXISTS idx_advance_payments_is_adjusted ON advance_payments(is_adjusted);
CREATE INDEX IF NOT EXISTS idx_advance_payments_date ON advance_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_itc_reversals_business_id ON itc_reversals(business_id);
CREATE INDEX IF NOT EXISTS idx_itc_reversals_purchase_id ON itc_reversals(purchase_id);
CREATE INDEX IF NOT EXISTS idx_itc_reversals_invoice_id ON itc_reversals(invoice_id);
CREATE INDEX IF NOT EXISTS idx_itc_reversals_date ON itc_reversals(reversal_date);
CREATE INDEX IF NOT EXISTS idx_itc_reversals_period ON itc_reversals(tax_period);

-- Triggers for new tables
DROP TRIGGER IF EXISTS update_debit_notes_updated_at ON debit_notes;
CREATE TRIGGER update_debit_notes_updated_at BEFORE UPDATE ON debit_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_advance_payments_updated_at ON advance_payments;
CREATE TRIGGER update_advance_payments_updated_at BEFORE UPDATE ON advance_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

