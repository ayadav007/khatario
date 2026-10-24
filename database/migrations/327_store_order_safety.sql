-- Phase 3.2: store order safety.
-- 1. Store order numbers are per business (SO-0001 per store, looked up by business_id + order_number),
--    so they get a per-business counter and a (business_id, order_number) unique index.
--    Existing duplicates are reported and the migration aborts; rows are never renumbered here.
-- 2. Shiprocket tracking webhooks authenticate with the merchant's x-api-key token. Only a SHA-256
--    hash is stored; the hash identifies the business the webhook may update.
-- 3. store_payment_events records processing outcome so a failed fulfilment can be retried and a
--    rejected payment (wrong amount, cancelled order) is kept for review without marking the order paid.

DO $$
DECLARE
  dup RECORD;
  dup_groups INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_groups
  FROM (
    SELECT 1 FROM store_orders GROUP BY business_id, order_number HAVING COUNT(*) > 1
  ) d;

  IF dup_groups > 0 THEN
    FOR dup IN
      SELECT business_id, order_number, COUNT(*) AS n,
             string_agg(id::text, ', ' ORDER BY created_at) AS order_ids
      FROM store_orders
      GROUP BY business_id, order_number
      HAVING COUNT(*) > 1
      ORDER BY business_id, order_number
    LOOP
      RAISE NOTICE 'Duplicate store order number: business % order % (% rows): %',
        dup.business_id, dup.order_number, dup.n, dup.order_ids;
    END LOOP;
    RAISE EXCEPTION 'store_orders has % duplicate (business_id, order_number) group(s). Resolve them before applying 327.', dup_groups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_orders_business_order_number
  ON store_orders (business_id, order_number);

CREATE TABLE IF NOT EXISTS store_order_counters (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO store_order_counters (business_id, last_number)
SELECT business_id,
       GREATEST(
         COUNT(*),
         COALESCE(MAX(SUBSTRING(order_number FROM '^SO-(\d+)$')::bigint), 0)
       )::integer
FROM store_orders
GROUP BY business_id
ON CONFLICT (business_id) DO UPDATE
  SET last_number = GREATEST(store_order_counters.last_number, EXCLUDED.last_number);

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS store_shiprocket_webhook_token_hash VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_settings_shiprocket_webhook_token
  ON business_settings (store_shiprocket_webhook_token_hash)
  WHERE store_shiprocket_webhook_token_hash IS NOT NULL;

ALTER TABLE store_payment_events
  ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'processed',
  ADD COLUMN IF NOT EXISTS amount DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;

ALTER TABLE store_payment_events DROP CONSTRAINT IF EXISTS store_payment_events_status_check;
ALTER TABLE store_payment_events
  ADD CONSTRAINT store_payment_events_status_check
  CHECK (status IN ('processed', 'failed', 'rejected'));
