-- =====================================================
-- REPORT DEFINITIONS SYSTEM MIGRATION
-- Migration: 133_report_definitions_table.sql
-- Date: 2025-01-XX
-- Description: Create report_definitions table for admin-managed report categorization
-- =====================================================

-- Create report_definitions table
CREATE TABLE IF NOT EXISTS report_definitions (
    id VARCHAR(100) PRIMARY KEY, -- e.g., 'sales_summary', 'profit_loss', 'gstr1'
    name VARCHAR(255) NOT NULL, -- Display name: 'Sales Summary', 'Profit & Loss'
    description TEXT,
    route_path VARCHAR(255) NOT NULL, -- e.g., '/reports/sales/summary'
    category VARCHAR(50) NOT NULL CHECK (category IN ('basic', 'gst', 'advanced')),
    report_type VARCHAR(50), -- 'sales', 'purchase', 'financial', 'gst', 'stock', 'party', 'expense'
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_report_definitions_route ON report_definitions(route_path);
CREATE INDEX IF NOT EXISTS idx_report_definitions_category ON report_definitions(category);
CREATE INDEX IF NOT EXISTS idx_report_definitions_active ON report_definitions(is_active, category);

-- Insert all existing reports from the current mapping
INSERT INTO report_definitions (id, name, description, route_path, category, report_type, sort_order) VALUES
-- Basic Reports - Sales
('sales_summary', 'Sales Summary', 'Aggregated sales report by day/week/month', '/reports/sales/summary', 'basic', 'sales', 1),
('sales_invoice_wise', 'Sales Invoice-wise', 'Detailed invoice-wise sales report', '/reports/sales/invoice-wise', 'basic', 'sales', 2),
('sales_item_wise', 'Sales Item-wise', 'Item-wise sales analysis', '/reports/sales/item-wise', 'basic', 'sales', 3),
('sales_party_wise', 'Sales Party-wise', 'Customer-wise sales breakdown', '/reports/sales/party-wise', 'basic', 'sales', 4),
('sales_tax_wise', 'Sales Tax-wise', 'Tax-wise sales analysis', '/reports/sales/tax-wise', 'basic', 'sales', 5),
('sales_payment_mode', 'Sales Payment Mode', 'Payment method-wise sales report', '/reports/sales/payment-mode', 'basic', 'sales', 6),
('sales_discount', 'Sales Discount', 'Discount analysis report', '/reports/sales/discount', 'basic', 'sales', 7),
('sales_credit', 'Sales Credit', 'Credit sales report', '/reports/sales/credit', 'basic', 'sales', 8),
('sales_cancelled', 'Sales Cancelled', 'Cancelled invoices report', '/reports/sales/cancelled', 'basic', 'sales', 9),
('sales_returns', 'Sales Returns', 'Sales returns and credit notes', '/reports/sales/returns', 'basic', 'sales', 10),
('sales_summary_legacy', 'Sales Summary (Legacy)', 'Legacy sales summary endpoint', '/reports/sales-summary', 'basic', 'sales', 11),

-- Basic Reports - Purchase
('purchase_summary', 'Purchase Summary', 'Aggregated purchase report by day/week/month', '/reports/purchase/summary', 'basic', 'purchase', 20),
('purchase_invoice_wise', 'Purchase Invoice-wise', 'Detailed bill-wise purchase report', '/reports/purchase/invoice-wise', 'basic', 'purchase', 21),
('purchase_supplier_wise', 'Purchase Supplier-wise', 'Supplier-wise purchase breakdown', '/reports/purchase/supplier-wise', 'basic', 'purchase', 22),
('purchase_returns', 'Purchase Returns', 'Purchase returns report', '/reports/purchase/returns', 'basic', 'purchase', 23),
('purchase_credit', 'Purchase Credit', 'Credit purchase report', '/reports/purchase/credit', 'basic', 'purchase', 24),
('purchase_tax_wise', 'Purchase Tax-wise', 'Tax-wise purchase analysis', '/reports/purchase/tax-wise', 'basic', 'purchase', 25),
('purchase_summary_legacy', 'Purchase Summary (Legacy)', 'Legacy purchase summary endpoint', '/reports/purchase-summary', 'basic', 'purchase', 26),

-- Basic Reports - Stock
('stock_summary', 'Stock Summary', 'Current stock levels summary', '/reports/stock/summary', 'basic', 'stock', 30),
('stock_movement', 'Stock Movement', 'Stock movement history', '/reports/stock/movement', 'basic', 'stock', 31),
('stock_low_stock', 'Low Stock', 'Items below minimum stock level', '/reports/stock/low-stock', 'basic', 'stock', 32),
('stock_low_stock_warehouse', 'Low Stock by Warehouse', 'Low stock items by warehouse', '/reports/stock/low-stock-warehouse', 'basic', 'stock', 33),
('stock_damaged', 'Damaged Stock', 'Damaged stock items report', '/reports/stock/damaged', 'basic', 'stock', 34),
('stock_expired', 'Expired Stock', 'Expired stock items report', '/reports/stock/expired', 'basic', 'stock', 35),
('stock_summary_legacy', 'Stock Summary (Legacy)', 'Legacy stock summary endpoint', '/reports/stock-summary', 'basic', 'stock', 36),

-- Basic Reports - Party
('party_statement', 'Party Statement', 'Party account statement', '/reports/party/statement', 'basic', 'party', 40),
('party_ledger', 'Party Ledger', 'Party ledger entries', '/reports/party/ledger', 'basic', 'party', 41),
('party_receivables', 'Party Receivables', 'Customer receivables report', '/reports/party/receivables', 'basic', 'party', 42),
('party_payables', 'Party Payables', 'Supplier payables report', '/reports/party/payables', 'basic', 'party', 43),
('party_advances', 'Party Advances', 'Advance payments and receipts', '/reports/party/advances', 'basic', 'party', 44),

-- Basic Reports - Expense
('expense_summary', 'Expense Summary', 'Expense summary report', '/reports/expense/summary', 'basic', 'expense', 50),
('expense_category_wise', 'Expense Category-wise', 'Category-wise expense breakdown', '/reports/expense/category-wise', 'basic', 'expense', 51),

-- Basic Reports - Other
('credit_risk', 'Credit Risk', 'Credit risk analysis report', '/reports/credit-risk', 'basic', 'other', 60),

-- GST Reports
('gstr1', 'GSTR-1', 'GSTR-1 return for outward supplies', '/reports/gst/gstr1', 'gst', 'gst', 100),
('gstr1_excel', 'GSTR-1 Excel Export', 'GSTR-1 in official Excel format', '/reports/gst/gstr1/export/excel', 'gst', 'gst', 101),
('gstr1_filings', 'GSTR-1 Filings', 'GSTR-1 filing history', '/reports/gst/gstr1/filings', 'gst', 'gst', 102),
('gstr2b', 'GSTR-2B', 'GSTR-2B auto-drafted return', '/reports/gst/gstr2b', 'gst', 'gst', 103),
('gstr2b_reconciliation', 'GSTR-2B Reconciliation', 'GSTR-2B reconciliation report', '/reports/gst/gstr2b-reconciliation', 'gst', 'gst', 104),
('gstr3b', 'GSTR-3B', 'GSTR-3B monthly return', '/reports/gst/gstr3b', 'gst', 'gst', 105),
('gstr9', 'GSTR-9', 'GSTR-9 annual return', '/reports/gst/gstr9', 'gst', 'gst', 106),
('sales_b2b_b2c', 'B2B vs B2C Sales', 'B2B and B2C sales breakdown', '/reports/sales/b2b-b2c', 'gst', 'gst', 107),

-- Advanced Reports - Financial
('profit_loss', 'Profit & Loss', 'Profit and Loss statement', '/reports/profit-loss', 'advanced', 'financial', 200),
('profit_loss_pdf', 'Profit & Loss PDF', 'Profit and Loss PDF export', '/reports/profit-loss/pdf', 'advanced', 'financial', 201),
('balance_sheet', 'Balance Sheet', 'Balance sheet statement', '/reports/balance-sheet', 'advanced', 'financial', 202),
('balance_sheet_pdf', 'Balance Sheet PDF', 'Balance sheet PDF export', '/reports/balance-sheet/pdf', 'advanced', 'financial', 203),
('cash_flow', 'Cash Flow', 'Cash flow statement', '/reports/cash-flow', 'advanced', 'financial', 204),
('cash_flow_pdf', 'Cash Flow PDF', 'Cash flow PDF export', '/reports/cash-flow/pdf', 'advanced', 'financial', 205),
('trial_balance', 'Trial Balance', 'Trial balance report', '/reports/trial-balance', 'advanced', 'financial', 206),
('trial_balance_pdf', 'Trial Balance PDF', 'Trial balance PDF export', '/reports/trial-balance/pdf', 'advanced', 'financial', 207),
('aging_receivables', 'Aging Receivables', 'Receivables aging analysis', '/reports/aging/receivables', 'advanced', 'financial', 208),
('aging_payables', 'Aging Payables', 'Payables aging analysis', '/reports/aging/payables', 'advanced', 'financial', 209),
('inter_branch_reconciliation', 'Inter-Branch Reconciliation', 'Inter-branch transaction reconciliation', '/reports/inter-branch-reconciliation', 'advanced', 'financial', 210),

-- Advanced Reports - Stock
('stock_closing_stock', 'Closing Stock', 'Closing stock valuation', '/reports/stock/closing-stock', 'advanced', 'stock', 220),
('stock_closing_stock_finalize', 'Finalize Closing Stock', 'Finalize closing stock', '/reports/stock/closing-stock/finalize', 'advanced', 'stock', 221),
('stock_valuation', 'Stock Valuation', 'Stock valuation report', '/reports/stock/valuation', 'advanced', 'stock', 222),
('stock_profit_margin', 'Stock Profit Margin', 'Profit margin analysis', '/reports/stock/profit-margin', 'advanced', 'stock', 223),
('stock_purchase_vs_sales', 'Purchase vs Sales', 'Purchase vs sales comparison', '/reports/stock/purchase-vs-sales', 'advanced', 'stock', 224),

-- Advanced Reports - Party
('party_ageing', 'Party Ageing', 'Party ageing analysis', '/reports/party/ageing', 'advanced', 'party', 230),

-- Advanced Reports - Expense
('expense_profit_loss', 'Expense Profit & Loss', 'Expense-based P&L', '/reports/expense/profit-loss', 'advanced', 'expense', 240),
('expense_monthly_profit', 'Expense Monthly Profit', 'Monthly profit analysis', '/reports/expense/monthly-profit', 'advanced', 'expense', 241),
('expense_vs_sales', 'Expense vs Sales', 'Expense to sales ratio', '/reports/expense/expense-vs-sales', 'advanced', 'expense', 242),
('expense_cost_center', 'Expense Cost Center', 'Cost center-wise expenses', '/reports/expense/cost-center', 'advanced', 'expense', 243)
ON CONFLICT (id) DO NOTHING;
