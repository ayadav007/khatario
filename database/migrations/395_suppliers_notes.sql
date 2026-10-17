-- The supplier update API and the supplier screens (web and phone) read and write
-- suppliers.notes, but no migration ever created the column, so every supplier update failed
-- with 'column "notes" does not exist' (including the Supplier Hub low-stock sharing switch).

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;
