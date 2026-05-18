# Subscription Invariant Enforcement

## Invariant
**"Every business must always have exactly one active subscription."**

## Changes Made

### 1. Signup Route (`app/api/signup/route.ts`)

#### File: `app/api/signup/route.ts`
#### Lines Changed: 234-298 → 234-300

**Before:**
- Subscription creation was **conditional** - only created if 'free' plan existed
- If plan didn't exist, registration continued without subscription (silent failure)
- Transaction committed even if subscription creation failed

**After:**
- Subscription creation is **MANDATORY** - registration fails if subscription cannot be created
- Explicit error thrown if default plan doesn't exist
- Transaction rollback guaranteed on failure (error thrown before COMMIT)

**Key Changes:**

1. **Line 241-252:** Plan verification now **throws error** if 'free' plan not found
   ```typescript
   if (freePlan.rows.length === 0) {
     throw new Error('System configuration error: Default subscription plan not found. Please contact support.');
   }
   ```

2. **Line 254:** Uses verified `defaultPlanId` instead of hardcoded 'free'

3. **Line 284-300:** Subscription creation wrapped in try-catch with explicit error handling
   - Verifies INSERT returned rows
   - Throws descriptive error on failure
   - Transaction automatically rolls back on error

4. **Line 260-281:** Handles edge case where subscription already exists (updates to default plan)

**How Invariant is Guaranteed:**
- ✅ Registration **cannot complete** without subscription
- ✅ Error thrown → Transaction rollback → Business/user not created
- ✅ All subscription creation failures are logged and throw errors
- ✅ No silent failures possible

---

### 2. Lazy Assignment in `checkLimit()` (`lib/subscription.ts`)

#### File: `lib/subscription.ts`
#### Lines Changed: 230-281 → 230-290

**Before:**
- Lazy assignment was primary mechanism for businesses without subscriptions
- No distinction between new registrations and legacy data

**After:**
- Lazy assignment is **safety fallback only** for legacy data
- Clear warnings that this should not happen for new registrations
- Enhanced logging and error handling

**Key Changes:**

1. **Line 232-234:** Added warning comment and console.warn
   ```typescript
   console.warn(`WARNING: Business ${businessId} has no active subscription. This should not happen for new registrations. Attempting fallback assignment.`);
   ```

2. **Line 243:** Added cache clearing after fallback assignment
   ```typescript
   clearSubscriptionCache(businessId);
   ```

3. **Line 267:** Uses `skipCache: true` when fetching after fallback

4. **Line 277-279:** Enhanced error logging if fallback fails

**How Invariant is Maintained:**
- ✅ Fallback still works for legacy data (backward compatibility)
- ✅ Clear distinction: fallback is for legacy, not new registrations
- ✅ Enhanced logging helps identify if fallback is triggered (indicates system issue)

---

## Invariant Guarantee Explanation

### Registration Flow Guarantee

**Transaction Atomicity:**
1. All operations (business, user, roles, subscription) are in **single transaction**
2. If subscription creation fails → **error thrown** → **transaction rollback**
3. Business/user are **not created** if subscription cannot be created
4. **No partial state possible**

**Plan Verification:**
- Default plan ('free') is verified **before** attempting subscription creation
- If plan doesn't exist → **immediate error** → transaction rollback
- No silent failures

**Subscription Creation:**
- INSERT is wrapped in try-catch
- Verifies INSERT returned rows (catches constraint violations, etc.)
- Throws descriptive error on any failure
- All failures logged with businessId and planId

### Edge Cases Handled

1. **Subscription already exists:**
   - Updates existing subscription to default plan
   - Ensures status is 'active'
   - Logs warning (should not happen in normal flow)

2. **Plan exists but inactive:**
   - Query checks `is_active = true`
   - Inactive plans are treated as "not found"
   - Error thrown

3. **INSERT constraint violation:**
   - Caught by try-catch
   - Descriptive error thrown
   - Transaction rollback

### Backward Compatibility

- **Lazy assignment in `checkLimit()`** remains as safety fallback
- Legacy businesses without subscriptions can still get assigned via fallback
- Clear warnings indicate this is not expected for new registrations
- No breaking changes to existing functionality

---

## Testing Recommendations

### 1. Normal Registration Flow
- ✅ Verify subscription is created with 'free' plan
- ✅ Verify subscription has `status = 'active'`
- ✅ Verify transaction commits successfully

### 2. Missing Default Plan
- ✅ Verify registration fails with clear error message
- ✅ Verify transaction rolls back (no business/user created)
- ✅ Verify error is logged

### 3. Inactive Default Plan
- ✅ Verify registration fails (plan exists but `is_active = false`)
- ✅ Verify transaction rolls back

### 4. Database Constraint Violation
- ✅ Simulate duplicate subscription (if unique constraint exists)
- ✅ Verify error is thrown and transaction rolls back

### 5. Legacy Data Fallback
- ✅ Create business without subscription (via direct DB insert)
- ✅ Call `checkLimit()` - verify fallback assignment works
- ✅ Verify warning is logged

---

## Error Messages

### Registration Errors

1. **Plan Not Found:**
   ```
   System configuration error: Default subscription plan not found. Please contact support.
   ```

2. **Subscription Creation Failed:**
   ```
   Failed to create subscription: [specific error message]
   ```

3. **INSERT Returned No Rows:**
   ```
   Failed to create subscription: INSERT returned no rows
   ```

### Fallback Warnings

1. **No Subscription Found:**
   ```
   WARNING: Business [id] has no active subscription. This should not happen for new registrations. Attempting fallback assignment.
   ```

2. **Fallback Failed:**
   ```
   CRITICAL: Business [id] has no subscription and fallback assignment failed. Blocking all operations.
   ```

---

## Logging

All critical operations are logged with:
- Location (file:line)
- Business ID
- Plan ID
- Timestamp
- Error details (if applicable)

Logs are written to `.cursor/debug.log` in NDJSON format.

---

## Summary

### Before
- ❌ Subscription creation was optional
- ❌ Silent failures possible
- ❌ Businesses could exist without subscriptions
- ❌ Lazy assignment was primary mechanism

### After
- ✅ Subscription creation is mandatory
- ✅ Registration fails if subscription cannot be created
- ✅ Transaction rollback on failure
- ✅ Explicit error handling and logging
- ✅ Lazy assignment is safety fallback only

**The invariant "Every business must always have exactly one active subscription" is now guaranteed at registration time through transaction atomicity and mandatory subscription creation.**
