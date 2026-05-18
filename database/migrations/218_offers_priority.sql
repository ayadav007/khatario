-- Offer ordering + stacking (evaluated with lib/offer-engine ApplyOffersOptions.stackingPolicy)
ALTER TABLE offers ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN offers.priority IS 'Higher value = evaluated first when stackingPolicy is single_best_priority; lower first when sequential (after sort).';

CREATE INDEX IF NOT EXISTS idx_offers_business_priority ON offers (business_id, priority DESC);
