-- When a GST return is in `revised` status, allow ledger movement for that month
-- even if period_locks still shows locked (matches app-layer period-lock-utils).

CREATE OR REPLACE FUNCTION is_period_locked(
  p_business_id UUID,
  p_branch_id UUID,
  p_entry_date DATE
)
RETURNS BOOLEAN AS $$
DECLARE
  v_locked BOOLEAN := false;
  v_gst_period VARCHAR(7);
BEGIN
  v_gst_period := to_char(p_entry_date, 'YYYY-MM');

  IF EXISTS (
    SELECT 1 FROM gst_filings
    WHERE business_id = p_business_id
      AND gst_period = v_gst_period
      AND status = 'revised'
      AND (branch_id IS NULL OR branch_id IS NOT DISTINCT FROM p_branch_id)
  ) THEN
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM period_locks
    WHERE business_id = p_business_id
      AND branch_id = p_branch_id
      AND p_entry_date BETWEEN period_start AND period_end
      AND is_locked = true
  ) INTO v_locked;

  IF NOT v_locked THEN
    SELECT EXISTS(
      SELECT 1 FROM period_locks
      WHERE business_id = p_business_id
        AND branch_id IS NULL
        AND p_entry_date BETWEEN period_start AND period_end
        AND is_locked = true
    ) INTO v_locked;
  END IF;

  RETURN v_locked;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION is_period_locked(UUID, UUID, DATE) IS
  'True when period_locks closes the date; false when gst_filings has status revised for that YYYY-MM (amendment window).';
