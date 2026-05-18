-- Widen ocr_status for new workflow labels; document canonical meanings.

ALTER TABLE sales_orders
  ALTER COLUMN ocr_status TYPE VARCHAR(32);

COMMENT ON COLUMN sales_orders.ocr_status IS
  'Payment proof workflow: pending | awaiting_psp | verified | rejected | requires_review. '
  'pending = screenshot received, OCR queued or in grace period. '
  'awaiting_psp = integrated gateway has a pending payment — wait for webhook; OCR skipped. '
  'verified = proof accepted (PSP webhook, text match, or OCR+rules). '
  'rejected = OCR/rules say image is not usable proof. '
  'requires_review = ambiguous or rule mismatch — staff review.';
