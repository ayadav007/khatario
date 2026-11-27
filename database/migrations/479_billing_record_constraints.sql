-- 479: payment record safety (SUB-15, SUB-41).
--  1. One gateway payment activates one checkout: partial unique index on completed Razorpay/Easebuzz rows.
--  2. business_module_subscriptions.billing_cycle accepts only monthly / yearly / three_year.
--  3. billing_transactions_archive: where payment rows go when a business is deleted (no FKs, no CHECKs).
-- Idempotent. Never fails on existing data: when data would violate a rule, the rule is skipped with a NOTICE.
-- Never modifies or deletes an existing payment row.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  dup_refs integer;
BEGIN
  -- Blocks concurrent writers while we count and build, so no duplicate can slip in between.
  LOCK TABLE billing_transactions IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_billing_tx_completed_payment_ref') THEN
    RAISE NOTICE '479: uq_billing_tx_completed_payment_ref already exists';
  ELSE
    SELECT COUNT(*) INTO dup_refs FROM (
      SELECT payment_method, payment_reference
      FROM billing_transactions
      WHERE status = 'completed'
        AND payment_reference IS NOT NULL
        AND payment_method IN ('razorpay', 'easebuzz')
      GROUP BY payment_method, payment_reference
      HAVING COUNT(*) > 1
    ) d;
    IF dup_refs > 0 THEN
      RAISE NOTICE '479: skipped uq_billing_tx_completed_payment_ref: % duplicate completed payment reference(s) exist', dup_refs;
    ELSE
      CREATE UNIQUE INDEX uq_billing_tx_completed_payment_ref
        ON billing_transactions (payment_method, payment_reference)
        WHERE status = 'completed'
          AND payment_reference IS NOT NULL
          AND payment_method IN ('razorpay', 'easebuzz');
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  bad_rows integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bms_billing_cycle_check'
      AND conrelid = 'business_module_subscriptions'::regclass
  ) THEN
    RAISE NOTICE '479: bms_billing_cycle_check already exists';
  ELSE
    SELECT COUNT(*) INTO bad_rows FROM business_module_subscriptions
    WHERE billing_cycle IS NOT NULL AND billing_cycle NOT IN ('monthly', 'yearly', 'three_year');
    IF bad_rows > 0 THEN
      RAISE NOTICE '479: skipped bms_billing_cycle_check: % row(s) have an unknown billing_cycle', bad_rows;
    ELSE
      ALTER TABLE business_module_subscriptions
        ADD CONSTRAINT bms_billing_cycle_check
        CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly', 'yearly', 'three_year')) NOT VALID;
      ALTER TABLE business_module_subscriptions VALIDATE CONSTRAINT bms_billing_cycle_check;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS billing_transactions_archive (
  id                uuid PRIMARY KEY,
  business_id       uuid NOT NULL,
  subscription_id   uuid,
  type              varchar(20) NOT NULL,
  status            varchar(20) NOT NULL,
  amount            numeric(12,2) NOT NULL,
  currency          varchar(3),
  plan_id           varchar(50),
  billing_cycle     varchar(10),
  payment_method    varchar(50),
  payment_reference varchar(255),
  gateway_order_id  varchar(255),
  gateway_response  jsonb,
  coupon_id         uuid,
  discount_amount   numeric(12,2),
  tax_amount        numeric(12,2),
  total_amount      numeric(12,2) NOT NULL,
  description       text,
  invoice_number    varchar(50),
  invoice_url       text,
  period_start      date,
  period_end        date,
  metadata          jsonb,
  created_at        timestamptz,
  updated_at        timestamptz,
  module_key        varchar(32),
  archived_at       timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  business_name     text,
  business_gstin    text,
  archive_reason    text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_tx_archive_business ON billing_transactions_archive (business_id);
