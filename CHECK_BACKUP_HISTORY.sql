-- Check if backup_history table exists and has data

-- Check table structure
\d backup_history

-- Check all backups
SELECT 
    id,
    business_id,
    created_by_user_id,
    backup_type,
    backup_version,
    file_size,
    storage_location,
    status,
    created_at,
    completed_at,
    error_message
FROM backup_history
ORDER BY created_at DESC
LIMIT 20;

-- Count backups per business
SELECT 
    business_id,
    COUNT(*) as backup_count,
    MAX(created_at) as last_backup
FROM backup_history
GROUP BY business_id;

-- Check recent backups with details
SELECT 
    bh.id,
    bh.backup_type,
    bh.status,
    bh.file_size / 1024 as file_size_kb,
    bh.record_counts,
    bh.created_at,
    bh.completed_at,
    u.name as created_by,
    u.email as created_by_email,
    b.name as business_name
FROM backup_history bh
LEFT JOIN users u ON bh.created_by_user_id = u.id
LEFT JOIN businesses b ON bh.business_id = b.id
ORDER BY bh.created_at DESC
LIMIT 10;
