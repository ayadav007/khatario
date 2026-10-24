-- Inventory adjustment numbers are generated per business (ADJ-000001, ADJ-000002, ...) but the
-- column was UNIQUE across all businesses, so the second business to post ADJ-000001 failed.
-- Uniqueness is now (business_id, adjustment_number), and the generator takes a per-business
-- transaction lock so two concurrent adjustments cannot read the same MAX.

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'inventory_adjustments'::regclass
       AND con.contype = 'u'
       AND array_length(con.conkey, 1) = 1
       AND att.attname = 'adjustment_number'
  LOOP
    EXECUTE format('ALTER TABLE inventory_adjustments DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_adjustments_business_number
  ON inventory_adjustments (business_id, adjustment_number);

CREATE OR REPLACE FUNCTION generate_adjustment_number(business_id_param UUID)
RETURNS VARCHAR(100) AS $$
DECLARE
    prefix VARCHAR(10) := 'ADJ';
    last_number INTEGER := 0;
BEGIN
    -- Held until the caller's transaction ends; callers insert the row in the same transaction.
    PERFORM pg_advisory_xact_lock(hashtext('inventory_adjustment_number:' || business_id_param::text));

    SELECT COALESCE(MAX(CAST(SUBSTRING(adjustment_number FROM '[0-9]+$') AS INTEGER)), 0)
      INTO last_number
      FROM inventory_adjustments
     WHERE business_id = business_id_param
       AND adjustment_number ~ ('^' || prefix || '-[0-9]+$');

    RETURN prefix || '-' || LPAD((last_number + 1)::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;
