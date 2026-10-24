-- Expense bills can be entered as lines from an expense item list.
-- The list is not the stock catalogue. Historical expenses have no lines and keep their header amounts.
-- No posted voucher is rewritten.

CREATE TABLE IF NOT EXISTS expense_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  item_type VARCHAR(20) NOT NULL DEFAULT 'goods' CHECK (item_type IN ('goods', 'service')),
  unit VARCHAR(50) NOT NULL DEFAULT 'PCS',
  hsn_sac VARCHAR(10),
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS expense_items_business_active_name
  ON expense_items (business_id, lower(name))
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS expense_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  expense_item_id UUID NOT NULL REFERENCES expense_items(id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('goods', 'service')),
  unit VARCHAR(50),
  hsn_sac VARCHAR(10),
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0),
  tax_rate NUMERIC(5,2) NOT NULL,
  taxable_value NUMERIC(15,2) NOT NULL,
  cgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(15,2) NOT NULL,
  UNIQUE (expense_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_expense_lines_expense ON expense_lines (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_lines_business ON expense_lines (business_id, expense_id);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS prices_include_gst BOOLEAN NOT NULL DEFAULT false;

COMMENT ON TABLE expense_items IS
  'Items bought for the business (stationery, professional services). Not stock and not for sale.';
COMMENT ON COLUMN expenses.prices_include_gst IS
  'How the line rate was entered. Header amount stays GST-inclusive for a normal bill and GST-exclusive for reverse charge.';
