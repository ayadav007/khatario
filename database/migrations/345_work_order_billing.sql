-- Work orders become billable: each material line and the labour carry a GST rate (and labour a
-- SAC code) so a completed work order converts into a tax invoice. Branch and place of supply
-- follow the invoice that will be raised; completion and cancellation are timestamped.

ALTER TABLE work_order_items
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(6, 2) NOT NULL DEFAULT 0;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS place_of_supply_state_code VARCHAR(2),
  ADD COLUMN IF NOT EXISTS labor_sac VARCHAR(10) DEFAULT '9987',
  ADD COLUMN IF NOT EXISTS labor_tax_rate NUMERIC(6, 2) NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_work_orders_branch_id ON work_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_converted_invoice_id
  ON work_orders(converted_invoice_id) WHERE converted_invoice_id IS NOT NULL;
