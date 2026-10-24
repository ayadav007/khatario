-- Easebuzz store payments: let a store refund be confirmed by an Easebuzz provider event.
-- Widens the actor CHECK only. Existing rows (user / razorpay_webhook) are unchanged.

ALTER TABLE store_payment_refunds DROP CONSTRAINT IF EXISTS store_payment_refunds_actor_type_check;
ALTER TABLE store_payment_refunds
  ADD CONSTRAINT store_payment_refunds_actor_type_check
  CHECK (actor_type IN ('user', 'razorpay_webhook', 'easebuzz_webhook'));

COMMENT ON COLUMN store_orders.receipt_actor_type IS
  'Who posted the store receipt. razorpay_webhook / easebuzz_webhook are provider events, not a users.id.';
COMMENT ON COLUMN store_payment_refunds.actor_user_id IS
  'Session user for an admin refund. Null when a provider event (Razorpay / Easebuzz) confirms the refund.';
