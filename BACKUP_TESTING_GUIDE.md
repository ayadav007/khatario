# Backup & Restore System Testing Guide

## Overview
This guide provides comprehensive testing procedures for the backup and restore system.

## Prerequisites
- PostgreSQL database with sample data
- Google Drive OAuth credentials configured (optional)
- CRON_SECRET environment variable set for scheduled backups

## Test Scenarios

### 1. Manual Backup Creation

**Test Case 1.1: Create Basic Backup**
- Navigate to Settings > Backup & Restore
- Click "Create Backup Now"
- Verify backup file downloads
- Open JSON file and verify structure:
  - Version is '2.0'
  - Contains all expected tables
  - Statistics show correct record counts

**Test Case 1.2: Large Dataset Backup**
- Create test data: 1000+ customers, 5000+ invoices, 10000+ items
- Create backup
- Verify backup completes in < 5 minutes
- Verify file size is reasonable (compressed JSON)

**Test Case 1.3: Backup with No Data**
- Create backup from empty business
- Verify backup succeeds with 0 records
- Verify all table keys exist but arrays are empty

### 2. Backup History

**Test Case 2.1: History Tracking**
- Create multiple backups
- Navigate to Backup History section
- Verify all backups are listed with:
  - Correct timestamp
  - File size
  - Status (completed/failed)
  - Backup type (manual/scheduled)

**Test Case 2.2: Delete Backup**
- Click delete on a backup record
- Confirm deletion
- Verify backup removed from history

**Test Case 2.3: Pagination**
- Create 15+ backups
- Verify pagination shows 10 per page
- Click "Show All" to expand

### 3. Restore Functionality

**Test Case 3.1: Restore Preview**
- Upload a backup file
- Click "Preview"
- Verify preview shows:
  - Backup metadata (version, date)
  - Current vs backup record counts
  - Warnings about data overwrite
  - Restore mode options

**Test Case 3.2: Replace All Restore**
- Create backup of business A
- Add new customers to business A
- Restore the original backup
- Verify:
  - New customers are deleted
  - Original data restored
  - No orphaned records
  - Foreign key constraints intact

**Test Case 3.3: Merge Smart Restore**
- Create backup
- Modify some records (update customer names)
- Add new records
- Restore with "Merge Smart" mode
- Verify:
  - Modified records updated to backup values
  - New records preserved
  - No duplicates

**Test Case 3.4: Restore Rollback on Error**
- Create corrupted backup (invalid JSON or missing required fields)
- Attempt restore
- Verify:
  - Error message displayed
  - No partial data written
  - Database unchanged (transaction rolled back)

**Test Case 3.5: Cross-Version Restore**
- Create v1.0 backup (old format)
- Attempt restore
- Verify warning about version mismatch
- Test compatibility handling

### 4. Cloud Storage Integration

**Test Case 4.1: Google Drive Connection**
- Click "Connect" on Google Drive
- Complete OAuth flow
- Verify:
  - Redirected back with success message
  - Connection status shows "Connected"
  - Tokens stored encrypted in database

**Test Case 4.2: Upload to Google Drive**
- Connect Google Drive
- Create backup with cloud upload
- Verify:
  - File appears in Google Drive app folder
  - Backup history shows "google_drive" location
  - cloud_file_id stored correctly

**Test Case 4.3: Download from Google Drive**
- Upload backup to Google Drive
- Click download on backup history item
- Verify file downloads correctly

**Test Case 4.4: Delete from Google Drive**
- Upload backup to Google Drive
- Delete backup from history
- Verify file removed from Google Drive

**Test Case 4.5: Disconnect Google Drive**
- Click "Disconnect"
- Verify connection status updated
- Verify existing backups still accessible (read-only)

### 5. Scheduled Backups

**Test Case 5.1: Create Daily Schedule**
- Click "Setup Schedule"
- Select:
  - Frequency: Daily
  - Time: 02:00
  - Destination: Local
  - Retention: 30 days
- Save schedule
- Verify:
  - Schedule saved
  - next_run_at calculated correctly
  - Active schedule indicator shown

**Test Case 5.2: Create Weekly Schedule**
- Setup weekly schedule for Sunday 3:00 AM
- Verify next_run_at is next Sunday at 3 AM

**Test Case 5.3: Create Monthly Schedule**
- Setup monthly schedule for 1st of month
- Verify next_run_at is 1st of next month

**Test Case 5.4: Manual Cron Execution**
- Create schedule set to run immediately (set next_run_at to past time)
- Call GET `/api/cron/process-scheduled-backups` with Bearer token
- Verify:
  - Backup created
  - Uploaded to configured destination
  - History record created
  - next_run_at updated
  - consecutive_failures reset to 0

**Test Case 5.5: Failed Scheduled Backup**
- Disconnect cloud storage
- Setup schedule for cloud destination
- Trigger cron
- Verify:
  - consecutive_failures incremented
  - Error message logged
  - Email notification sent (if configured)

**Test Case 5.6: Auto-Disable After Failures**
- Cause 5 consecutive failures
- Verify schedule automatically disabled

**Test Case 5.7: Retention Policy**
- Create backups older than retention period
- Run cleanup (triggered by cron)
- Verify old backups deleted

### 6. Security & Permissions

**Test Case 6.1: Unauthorized Access**
- Attempt API calls without authentication
- Verify 401 Unauthorized response

**Test Case 6.2: Feature Access Control**
- Test with business on plan without backup_restore feature
- Verify 403 Forbidden with feature upgrade message

**Test Case 6.3: Token Encryption**
- Connect Google Drive
- Check database cloud_storage_connections table
- Verify access_token_encrypted and refresh_token_encrypted are encrypted (not plain text)
- Verify decrypt() function can recover original token

**Test Case 6.4: Cross-Business Access**
- User from Business A attempts to:
  - Create backup for Business B
  - Access backup history of Business B
  - Download Business B backups
- Verify all requests denied

### 7. Data Integrity

**Test Case 7.1: Complete Data Coverage**
- Create business with data in ALL tables:
  - Customers, suppliers, items, categories
  - Invoices, purchases, estimates
  - Credit notes, debit notes
  - Payments, expenses
  - Branches, warehouses, stock
  - Ledger entries, journal entries
  - Bank accounts, accounts (COA)
  - Tax entries, reconciliation
  - Todos, tasks, notes, tags
  - Settings, templates
- Create backup
- Verify all tables included with correct counts

**Test Case 7.2: Foreign Key Preservation**
- Create complex data with many relationships:
  - Invoice with 10 items
  - Items with batches
  - Stock in multiple warehouses
  - Ledger entries for transactions
- Backup and restore
- Verify all foreign keys intact
- Run database constraint checks

**Test Case 7.3: Stock Consistency**
- Record opening stock
- Create purchases, sales, transfers, adjustments
- Create backup
- Restore to new business
- Verify:
  - location_stock matches
  - stock_movements complete
  - item_batches preserved
  - Total stock calculations accurate

**Test Case 7.4: Accounting Consistency**
- Create transactions with ledger entries
- Backup and restore
- Verify:
  - Debits = Credits
  - Account balances match
  - Trial balance accurate

### 8. Performance & Scale

**Test Case 8.1: Large Dataset Performance**
- Business with:
  - 10,000 customers
  - 50,000 invoices
  - 100,000 invoice items
  - 20,000 stock movements
- Create backup
- Measure time: Should complete < 5 minutes
- Measure memory: Should not exceed 1GB

**Test Case 8.2: Concurrent Operations**
- Start backup creation
- While backup running, attempt:
  - Create new invoice
  - Update customer
  - Stock movement
- Verify no locks or conflicts

**Test Case 8.3: Restore Performance**
- Restore large backup (100k records)
- Measure time: Should complete < 10 minutes
- Verify transaction commits atomically

### 9. Edge Cases

**Test Case 9.1: Special Characters**
- Create data with special characters:
  - Customer name: "Test & Co. <Special>"
  - Item name with emoji: "Product 🎉"
  - Notes with quotes and newlines
- Backup and restore
- Verify all characters preserved correctly

**Test Case 9.2: Null Values**
- Create records with optional null fields
- Backup and restore
- Verify nulls handled correctly

**Test Case 9.3: Large Text Fields**
- Create notes with 10,000+ characters
- Backup and restore
- Verify complete text preserved

**Test Case 9.4: Date/Time Handling**
- Create records across different timezones
- Backup and restore
- Verify timestamps preserved correctly

**Test Case 9.5: Empty Business Restore**
- Restore backup to completely empty business
- Verify no errors on missing data

**Test Case 9.6: Binary/JSON Fields**
- Test records with JSONB columns
- Backup and restore
- Verify JSON structure preserved

### 10. User Interface

**Test Case 10.1: Progress Indicators**
- Create large backup
- Verify loading spinner shows
- Button disabled during operation

**Test Case 10.2: Error Messages**
- Cause various errors
- Verify user-friendly error messages
- No technical stack traces exposed

**Test Case 10.3: Responsive Design**
- Test on mobile, tablet, desktop
- Verify all features accessible
- UI adapts correctly

**Test Case 10.4: Browser Compatibility**
- Test on Chrome, Firefox, Safari, Edge
- Verify file upload/download works
- OAuth redirects function correctly

## Automated Testing

### Unit Tests
```bash
# Test backup creation
npm test -- backup.create.test.ts

# Test restore logic
npm test -- backup.restore.test.ts

# Test cloud storage
npm test -- cloud-storage.test.ts

# Test scheduling
npm test -- backup.schedule.test.ts
```

### Integration Tests
```bash
# Full backup-restore cycle
npm test -- integration/backup-cycle.test.ts

# Cloud upload-download cycle
npm test -- integration/cloud-storage.test.ts

# Scheduled backup execution
npm test -- integration/scheduled-backup.test.ts
```

### Load Tests
```bash
# Backup with 100k records
npm run test:load -- backup-large-dataset

# Concurrent backups
npm run test:load -- concurrent-operations

# Restore performance
npm run test:load -- restore-large-backup
```

## SQL Verification Queries

### Verify Complete Backup
```sql
-- Check all tables have data
SELECT 
  'customers' as table_name, COUNT(*) as count FROM customers WHERE business_id = 'xxx'
UNION ALL
SELECT 'invoices', COUNT(*) FROM invoices WHERE business_id = 'xxx'
UNION ALL
SELECT 'items', COUNT(*) FROM items WHERE business_id = 'xxx'
-- ... add all tables
ORDER BY table_name;

-- Verify no orphaned records after restore
SELECT COUNT(*) FROM invoice_items ii
LEFT JOIN invoices i ON ii.invoice_id = i.id
WHERE i.id IS NULL;

-- Verify stock consistency
SELECT 
  i.id,
  i.name,
  COALESCE(SUM(ls.quantity), 0) as total_stock
FROM items i
LEFT JOIN location_stock ls ON i.id = ls.item_id
WHERE i.business_id = 'xxx'
GROUP BY i.id, i.name;
```

### Verify Backup History
```sql
SELECT 
  id,
  backup_type,
  status,
  file_size,
  record_counts,
  created_at,
  completed_at
FROM backup_history
WHERE business_id = 'xxx'
ORDER BY created_at DESC;
```

### Verify Scheduled Backups
```sql
SELECT 
  is_enabled,
  frequency,
  time_of_day,
  next_run_at,
  last_run_at,
  consecutive_failures
FROM backup_schedules
WHERE business_id = 'xxx';
```

## Common Issues & Solutions

### Issue: Backup fails with "Out of memory"
**Solution:** Implement streaming for large datasets, fetch data in batches

### Issue: Restore fails with foreign key constraint
**Solution:** Verify restore order follows dependency graph, check migration 142

### Issue: Google Drive token expired
**Solution:** Token refresh logic in GoogleDriveService.getValidAccessToken()

### Issue: Scheduled backup not running
**Solution:** 
1. Verify CRON_SECRET set
2. Check next_run_at is in past
3. Verify is_enabled = true
4. Check cron job configured correctly

### Issue: Backup file too large
**Solution:** Implement compression (gzip) before download/upload

## Test Completion Checklist

- [ ] All manual backup tests passed
- [ ] All restore tests passed (replace_all and merge_smart)
- [ ] Cloud storage upload/download working
- [ ] Scheduled backups executing correctly
- [ ] Retention policy deleting old backups
- [ ] History tracking accurate
- [ ] Security permissions enforced
- [ ] Data integrity verified (all tables, foreign keys)
- [ ] Large dataset performance acceptable
- [ ] UI/UX tested on multiple browsers
- [ ] Error handling graceful
- [ ] Documentation complete

## Sign-off

**Tester:** ___________________  
**Date:** ___________________  
**Notes:** ___________________

---

**Next Steps After Testing:**
1. Fix any bugs identified
2. Performance optimizations if needed
3. Deploy to staging environment
4. User acceptance testing
5. Production deployment
6. Monitor backup success rates
7. Set up alerts for failed backups
