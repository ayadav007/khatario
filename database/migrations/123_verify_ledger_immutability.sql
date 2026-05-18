-- Verification script for Migration 123: Ledger Immutability and Period Locks
-- Run this to verify all triggers and functions were created correctly

-- Check if columns were added
SELECT 
    column_name, 
    data_type, 
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'ledger_entry_lines'
  AND column_name IN ('is_editable', 'updated_at')
ORDER BY column_name;

-- Check if period_locks table exists
SELECT 
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'period_locks') as column_count
FROM information_schema.tables
WHERE table_name = 'period_locks';

-- Check if functions exist
SELECT 
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'prevent_ledger_entry_update',
    'is_period_locked',
    'validate_period_lock',
    'validate_voucher_balance'
  )
ORDER BY routine_name;

-- Check if triggers exist on ledger_entry_lines
SELECT 
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'ledger_entry_lines'
ORDER BY trigger_name;

-- Check if trigger exists on period_locks
SELECT 
    trigger_name,
    event_manipulation,
    action_timing
FROM information_schema.triggers
WHERE event_object_table = 'period_locks'
ORDER BY trigger_name;

-- Test: Try to update an immutable ledger entry (should fail)
-- Uncomment the following to test (replace with actual entry ID):
/*
UPDATE ledger_entry_lines
SET debit = debit + 1
WHERE id = 'YOUR_ENTRY_ID_HERE' AND is_editable = false;
-- Expected: ERROR: Ledger entry is immutable...
*/

-- Summary
SELECT 
    'Migration 123 Verification' as check_type,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ledger_entry_lines' AND column_name = 'is_editable') 
        THEN '✓ is_editable column exists'
        ELSE '✗ is_editable column missing'
    END as is_editable_check,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'period_locks') 
        THEN '✓ period_locks table exists'
        ELSE '✗ period_locks table missing'
    END as period_locks_check,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = 'prevent_ledger_entry_update') 
        THEN '✓ prevent_ledger_entry_update function exists'
        ELSE '✗ prevent_ledger_entry_update function missing'
    END as immutability_function_check,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'ledger_entry_lines' AND trigger_name = 'prevent_ledger_entry_update_trigger') 
        THEN '✓ Immutability trigger exists'
        ELSE '✗ Immutability trigger missing'
    END as immutability_trigger_check,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'ledger_entry_lines' AND trigger_name = 'validate_period_lock_trigger') 
        THEN '✓ Period lock trigger exists'
        ELSE '✗ Period lock trigger missing'
    END as period_lock_trigger_check,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'ledger_entry_lines' AND trigger_name = 'validate_voucher_balance_trigger') 
        THEN '✓ Voucher balance trigger exists'
        ELSE '✗ Voucher balance trigger missing'
    END as voucher_balance_trigger_check;
