-- Fit note per product, shown under the size buttons on the store product page (e.g. "Oversized fit. Size down for a regular fit.").
ALTER TABLE items ADD COLUMN IF NOT EXISTS store_fit_note TEXT;
