-- Deleting a user must not erase GST audit history and must not block
-- an otherwise valid account deletion. The actor id may become null.
-- The name and phone recorded at the time of the action stay on the row.
-- History is not cascade-deleted with the user or the purchase.

ALTER TABLE purchase_duplicate_overrides
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS created_by_phone TEXT;

ALTER TABLE gst_return_acknowledgements
  ADD COLUMN IF NOT EXISTS user_name TEXT,
  ADD COLUMN IF NOT EXISTS user_phone TEXT;

UPDATE purchase_duplicate_overrides o
   SET created_by_name = u.name,
       created_by_phone = u.phone
  FROM users u
 WHERE o.created_by = u.id
   AND o.created_by_name IS NULL;

UPDATE gst_return_acknowledgements a
   SET user_name = u.name,
       user_phone = u.phone
  FROM users u
 WHERE a.user_id = u.id
   AND a.user_name IS NULL;

ALTER TABLE purchase_duplicate_overrides ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE gst_return_acknowledgements ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE purchase_duplicate_overrides
  DROP CONSTRAINT IF EXISTS purchase_duplicate_overrides_created_by_fkey;
ALTER TABLE purchase_duplicate_overrides
  ADD CONSTRAINT purchase_duplicate_overrides_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE gst_return_acknowledgements
  DROP CONSTRAINT IF EXISTS gst_return_acknowledgements_user_id_fkey;
ALTER TABLE gst_return_acknowledgements
  ADD CONSTRAINT gst_return_acknowledgements_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN purchase_duplicate_overrides.created_by_name IS
  'Actor name at the time of the override. Kept when the user row is deleted.';
COMMENT ON COLUMN gst_return_acknowledgements.user_name IS
  'Actor name at the time of the acknowledgement. Kept when the user row is deleted.';
