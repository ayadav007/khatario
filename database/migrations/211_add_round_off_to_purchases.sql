-- Add round_off to purchases for invoice-style adjustments
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS round_off DECIMAL(12,2) DEFAULT 0;

COMMENT ON COLUMN purchases.round_off IS 'Rounding / adjustment amount applied at document level';

