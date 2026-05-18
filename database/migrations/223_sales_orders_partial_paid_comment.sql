-- Document canonical partial settlement value written by recomputeSalesOrderPaymentAggregate.
-- (Column is VARCHAR; no constraint change required.)

COMMENT ON COLUMN sales_orders.payment_status IS
  'Aggregated: unpaid | pending | partial | partial_paid | paid | failed. '
  'partial_paid: successful PSP captures sum to less than grand_total. '
  'Legacy partial may still exist until next sync.';
