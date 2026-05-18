-- Migration 122: User-Branch Access Control
-- Enables assigning users to specific branches with granular permissions

-- Create user_branches table for branch access control
CREATE TABLE IF NOT EXISTS user_branches (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT true,
  can_edit BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  can_create_transactions BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, branch_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_branches_user_id ON user_branches(user_id);
CREATE INDEX IF NOT EXISTS idx_user_branches_branch_id ON user_branches(branch_id);

-- Migrate existing users to primary branch (if they don't have branch access)
-- This ensures backward compatibility
INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_create_transactions)
SELECT 
  u.id,
  b.id,
  true,  -- can_view
  true,  -- can_edit (assume existing users have edit access)
  true   -- can_create_transactions
FROM users u
CROSS JOIN branches b
WHERE b.business_id = u.business_id 
  AND b.is_primary = true
  AND NOT EXISTS (
    SELECT 1 FROM user_branches ub 
    WHERE ub.user_id = u.id AND ub.branch_id = b.id
  )
ON CONFLICT (user_id, branch_id) DO NOTHING;

-- Add comments
COMMENT ON TABLE user_branches IS 'User-branch access control. Defines which branches a user can access and their permissions.';
COMMENT ON COLUMN user_branches.can_view IS 'User can view transactions and reports for this branch';
COMMENT ON COLUMN user_branches.can_edit IS 'User can edit transactions for this branch';
COMMENT ON COLUMN user_branches.can_delete IS 'User can delete transactions for this branch';
COMMENT ON COLUMN user_branches.can_create_transactions IS 'User can create invoices, purchases, payments, etc. for this branch';
