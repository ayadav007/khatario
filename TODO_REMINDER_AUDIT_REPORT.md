# Todo Reminder System - Complete Audit Report

## PHASE 1: Reminder Flow Trace

### ✅ Data Model
**Table**: `todos`
**Reminder Fields**:
- `reminder_type`: ENUM('none', 'once', 'recurring') - DEFAULT 'once'
- `reminder_time`: TIMESTAMPTZ - When to trigger reminder (can be before due_date)
- `reminder_channels`: ARRAY['in_app', 'email', 'whatsapp'] - DEFAULT ['in_app']
- `reminder_sent`: BOOLEAN - DEFAULT false (tracks if reminder was already sent)
- `last_reminder_sent_at`: TIMESTAMPTZ - Timestamp of last reminder

**Default Behavior**: When creating a todo with `reminder_type != 'none'` but no `reminder_time`, it defaults to 1 hour before `due_date`.

### ✅ Creation Flow
**Location**: `app/api/todos/route.ts` (POST handler, lines 129-210)

**Verification**:
- ✅ `reminder_time` is calculated and saved correctly
- ✅ Default logic: If `reminder_type !== 'none'` and no `reminder_time`, sets to 1 hour before due_date
- ✅ Data is persisted to database
- ✅ Timezone: Uses ISO strings (TIMESTAMPTZ in PostgreSQL handles timezone)

**Code Path**:
```typescript
// app/api/todos/route.ts:153-160
let finalReminderTime = reminder_time;
if (reminder_type && reminder_type !== 'none' && !reminder_time) {
  const dueDate = new Date(due_date);
  dueDate.setHours(dueDate.getHours() - 1);
  finalReminderTime = dueDate.toISOString();
}
```

### ❌ Trigger Mechanism
**Two endpoints exist but are NOT being called**:

1. **`/api/cron/send-todo-reminders`** (app/api/cron/send-todo-reminders/route.ts)
   - **Purpose**: Background cron job to process all businesses
   - **Status**: ❌ **NOT CONFIGURED** - No cron scheduler is calling this endpoint
   - **Query**: Finds todos where `reminder_time <= NOW()` and `reminder_sent = false`

2. **`/api/todos/check-reminders`** (app/api/todos/check-reminders/route.ts)
   - **Purpose**: Manual/polling endpoint for a specific business
   - **Status**: ❌ **NEVER CALLED** - No frontend code calls this endpoint
   - **Query**: Same logic but scoped to a `business_id`

**Execution Path**:
- Both endpoints:
  1. Query todos with due reminders
  2. Create notification in `notifications` table with `type = 'todo_reminder'`
  3. Mark todo as `reminder_sent = true`
  4. Create history entry

### ❌ Display Mechanism
**Location**: `components/notifications/NotificationPanel.tsx` and `components/notifications/NotificationCenter.tsx`

**Problems Identified**:
1. **`/api/notifications` returns MOCK DATA** (app/api/notifications/route.ts:20-33)
   - ❌ Does NOT query the `notifications` table
   - ❌ Returns hardcoded mock notification
   - ❌ Real reminders created by cron/check-reminders are never visible

2. **Notification Polling**:
   - ✅ NotificationPanel polls every 60s when open
   - ✅ NotificationCenter polls every 2 minutes
   - ❌ But they fetch from `/api/notifications` which returns mock data

3. **UI Rendering**:
   - ✅ NotificationPanel handles `todo_reminder` type (line 59-61)
   - ✅ Routes to `/tools/todo` when clicked
   - ✅ Icon rendering exists (line 80-81)

---

## PHASE 2: Failure Point Identification

### Root Cause Analysis

**PRIMARY ISSUE**: Reminders are never being processed or displayed due to **THREE CRITICAL GAPS**:

1. **Gap 1: No Reminder Processing**
   - ❌ Cron endpoint exists but no scheduler calls it
   - ❌ Check-reminders endpoint exists but frontend never calls it
   - ❌ Todo page does not poll for reminders
   - **Result**: Reminders are saved but never checked/triggered

2. **Gap 2: Notifications API Returns Mock Data**
   - ❌ `/api/notifications` does not query the database
   - ❌ Even if reminders were processed, they wouldn't be visible
   - **Result**: No real notifications are ever displayed

3. **Gap 3: No Frontend Polling for Reminders**
   - ❌ Todo page only fetches todos, never checks for due reminders
   - ❌ No automatic reminder checking when page is open
   - **Result**: User must manually trigger reminder check (but no UI exists for this)

### Exact Failure Points

| Issue | File | Line | Problem |
|-------|------|------|---------|
| Mock notifications | `app/api/notifications/route.ts` | 20-33 | Returns hardcoded array instead of querying DB |
| No reminder polling | `app/tools/todo/page.tsx` | 130-133 | `useEffect` only fetches todos, never checks reminders |
| Cron not configured | `app/api/cron/send-todo-reminders/route.ts` | N/A | Endpoint exists but no external cron calls it |

---

## PHASE 3: Minimal Fix Proposal

### Fix 1: Make Notifications API Query Real Data
**File**: `app/api/notifications/route.ts`
**Why**: Currently returns mock data, so real reminders are never visible
**Change**: Replace mock data with actual database query

**Before**:
```typescript
// For now, return mock notifications
const notifications = [
  {
    id: '1',
    type: 'info',
    title: 'New invoice created',
    // ... mock data
  },
];
```

**After**:
```typescript
// Query actual notifications from database
const notifications = await queryRows(
  `SELECT id, type, title, message, is_read, created_at, reference_type, reference_id
   FROM notifications
   WHERE business_id = $1
   ORDER BY created_at DESC
   LIMIT $2`,
  [businessId, limit || 20]
);
```

### Fix 2: Add Reminder Polling in Todo Page
**File**: `app/tools/todo/page.tsx`
**Why**: Reminders need to be checked periodically when user is on the page
**Change**: Add `useEffect` to poll `/api/todos/check-reminders` every 2 minutes

**Add after line 133**:
```typescript
// Poll for due reminders every 2 minutes
useEffect(() => {
  if (!business?.id) return;
  
  const checkReminders = async () => {
    try {
      await fetch(`/api/todos/check-reminders?business_id=${business.id}`);
      // Refresh notifications after checking
      // Note: This assumes useLayoutData is available or we refresh notifications
    } catch (error) {
      console.error('Error checking reminders:', error);
    }
  };
  
  // Check immediately on mount
  checkReminders();
  
  // Then check every 2 minutes
  const interval = setInterval(checkReminders, 120000);
  return () => clearInterval(interval);
}, [business?.id]);
```

**Note**: This requires access to `refreshNotifications` from `useLayoutData()` to update the notification panel after processing reminders.

### Fix 3: Document Cron Setup (Optional)
**File**: Create `docs/TODO_REMINDER_CRON_SETUP.md` or add to existing docs
**Why**: Inform about external cron requirement for production
**Content**: Instructions for setting up external cron service (e.g., cron-job.org) to call `/api/cron/send-todo-reminders` every 5 minutes

---

## PHASE 4: Verification Checklist

After implementing fixes, verify:

- [ ] **Reminder fires at correct time**
  - Create todo with reminder_time = now + 1 minute
  - Wait 1 minute
  - Verify notification appears in notification panel

- [ ] **Timezone is correct**
  - Create todo with reminder in different timezone
  - Verify reminder fires at correct local time

- [ ] **Page refresh does not break it**
  - Create reminder
  - Refresh page
  - Verify reminder still processes

- [ ] **Multiple reminders work**
  - Create 3 todos with different reminder times
  - Verify all reminders process correctly

- [ ] **No console errors**
  - Check browser console for errors
  - Check server logs for errors

- [ ] **Notifications appear in panel**
  - Verify notifications show in NotificationPanel
  - Verify clicking notification routes to todo page

---

## Summary

**Status**: ❌ **Reminders are NOT working**

**Root Causes**:
1. Notifications API returns mock data (not querying database)
2. No frontend polling to check for due reminders
3. Cron endpoint not configured (external dependency)

**Minimal Fixes Required**:
1. ✅ Fix `/api/notifications` to query database (CRITICAL)
2. ✅ Add polling in todo page to call `check-reminders` (CRITICAL)
3. ⚠️ Document cron setup (OPTIONAL - for production)

**Estimated Impact**: 
- Fix 1: Enables notification display (blocks all notifications)
- Fix 2: Enables reminder processing when user is on todo page
- Fix 3: Enables background processing (production requirement)

**Architectural Note**: 
The system relies on either:
- Frontend polling (Fix 2) - works when user is on page
- External cron (Fix 3) - works 24/7 but requires setup

Both are needed for complete coverage.
