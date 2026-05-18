-- Migration 128: Default Branch System
-- Ensures every business has exactly one default branch
-- This fixes the issue where APIs fail when branch_id is missing

-- Step 1: Add is_default column to branches table
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- Step 2: Create unique partial index to ensure only one default branch per business
-- This enforces the constraint: exactly one default branch per business
CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_one_default_per_business
  ON branches(business_id)
  WHERE is_default = true AND is_active = true;

-- Step 3: Migrate existing is_primary to is_default (for backward compatibility)
-- If a branch has is_primary = true, set is_default = true
UPDATE branches
SET is_default = true
WHERE is_primary = true AND is_default = false;

-- Step 4: Ensure every business has at least one default branch
-- For businesses without any default branch, mark their first branch (by creation date) as default
DO $$
DECLARE
  business_rec RECORD;
  default_branch_id UUID;
BEGIN
  -- Find businesses without a default branch
  FOR business_rec IN
    SELECT DISTINCT b.business_id
    FROM branches b
    WHERE NOT EXISTS (
      SELECT 1 FROM branches b2
      WHERE b2.business_id = b.business_id
      AND b2.is_default = true
      AND b2.is_active = true
    )
    GROUP BY b.business_id
  LOOP
    -- Get the first branch for this business (by creation date, then by ID)
    SELECT id INTO default_branch_id
    FROM branches
    WHERE business_id = business_rec.business_id
      AND is_active = true
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    -- If a branch exists, mark it as default
    IF default_branch_id IS NOT NULL THEN
      UPDATE branches
      SET is_default = true
      WHERE id = default_branch_id;
      
      RAISE NOTICE 'Set default branch % for business %', default_branch_id, business_rec.business_id;
    ELSE
      -- If no branch exists, create one
      INSERT INTO branches (
        business_id,
        name,
        branch_code,
        branch_type,
        is_default,
        is_active,
        created_at,
        updated_at
      )
      VALUES (
        business_rec.business_id,
        'Main Branch',
        'MAIN',
        'retail',
        true,
        true,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING id INTO default_branch_id;
      
      RAISE NOTICE 'Created default branch % for business %', default_branch_id, business_rec.business_id;
    END IF;
  END LOOP;
END $$;

-- Step 5: If multiple default branches exist for a business (shouldn't happen after index, but fix legacy data)
-- Keep the oldest one as default, unset others
DO $$
DECLARE
  business_rec RECORD;
  default_branch_id UUID;
BEGIN
  FOR business_rec IN
    SELECT business_id
    FROM branches
    WHERE is_default = true AND is_active = true
    GROUP BY business_id
    HAVING COUNT(*) > 1
  LOOP
    -- Get the oldest default branch
    SELECT id INTO default_branch_id
    FROM branches
    WHERE business_id = business_rec.business_id
      AND is_default = true
      AND is_active = true
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    -- Unset is_default for all other branches
    UPDATE branches
    SET is_default = false
    WHERE business_id = business_rec.business_id
      AND id != default_branch_id
      AND is_default = true;
      
    RAISE NOTICE 'Fixed multiple defaults for business %, keeping branch %', business_rec.business_id, default_branch_id;
  END LOOP;
END $$;

-- Step 6: Create helper function to get default branch for a business
CREATE OR REPLACE FUNCTION get_default_branch_id(p_business_id UUID)
RETURNS UUID AS $$
DECLARE
  v_branch_id UUID;
BEGIN
  SELECT id INTO v_branch_id
  FROM branches
  WHERE business_id = p_business_id
    AND is_default = true
    AND is_active = true
  LIMIT 1;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'No default branch found for business %', p_business_id;
  END IF;

  RETURN v_branch_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON COLUMN branches.is_default IS 'Marks the default branch for a business. Every business must have exactly one default branch. This branch is used when branch_id is not explicitly provided.';
COMMENT ON FUNCTION get_default_branch_id IS 'Returns the default branch ID for a business. Throws an error if no default branch exists (should never happen in normal operation).';
