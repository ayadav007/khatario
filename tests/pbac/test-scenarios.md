# PBAC Test Scenarios

**Date:** 2024  
**Purpose:** Manual and automated test scenarios for PBAC implementation

---

## 🧪 Test Scenarios

### Test 1: Permission Exists But Policy Fails

**Scenario:**
- User has `invoices.update` permission (RBAC passes)
- Invoice status is 'final'
- User attempts to update invoice

**Expected Result:**
- ✅ RBAC check passes
- ❌ Policy check fails (status is 'final')
- Returns `403 Forbidden` with error:
  ```json
  {
    "error": "Cannot update finalized or cancelled invoices",
    "code": "INVALID_RESOURCE_STATUS",
    "details": {
      "policyId": "invoice:update",
      "conditionId": "resource_status_is_not_final_cancelled"
    }
  }
  ```

**Test Steps:**
1. Create an invoice and finalize it
2. Attempt to update the finalized invoice via API
3. Verify 403 response with proper error message

---

### Test 2: Permission Missing

**Scenario:**
- User does NOT have `invoices.update` permission
- User attempts to update invoice

**Expected Result:**
- ❌ RBAC check fails immediately
- Returns `403 Forbidden` with error:
  ```json
  {
    "error": "User does not have update permission for invoice",
    "code": "PERMISSION_DENIED"
  }
  ```

**Test Steps:**
1. Create a user without `invoices.update` permission
2. Attempt to update an invoice via API
3. Verify 403 response with PERMISSION_DENIED error

---

### Test 3: Permission + Policy Pass

**Scenario:**
- User has `invoices.update` permission
- Invoice status is 'draft'
- Period is open
- User has branch access

**Expected Result:**
- ✅ RBAC check passes
- ✅ Policy check passes
- ✅ Access allowed, invoice can be updated

**Test Steps:**
1. Create a draft invoice
2. Ensure period is open
3. Update invoice via API
4. Verify 200 response and invoice updated

---

### Test 4: Cross-Branch Access Denied

**Scenario:**
- User has `invoices.read` permission
- Invoice belongs to Branch A
- User only has access to Branch B

**Expected Result:**
- ✅ RBAC check passes (module permission)
- ❌ Policy check fails (branch access)
- Returns `403 Forbidden` with error:
  ```json
  {
    "error": "You do not have access to this branch",
    "code": "BRANCH_ACCESS_DENIED",
    "details": {
      "policyId": "invoice:read",
      "conditionId": "user_has_branch_access"
    }
  }
  ```

**Test Steps:**
1. Create invoice in Branch A
2. Assign user only to Branch B
3. Attempt to read invoice from Branch A
4. Verify 403 response with BRANCH_ACCESS_DENIED error

---

### Test 5: Closed Period Modification Denied

**Scenario:**
- User has `invoices.update` permission
- Invoice date is in a locked accounting period
- User attempts to update invoice

**Expected Result:**
- ✅ RBAC check passes
- ❌ Policy check fails (period locked)
- Returns `403 Forbidden` with error:
  ```json
  {
    "error": "Cannot modify entries in a locked accounting period",
    "code": "PERIOD_LOCKED",
    "details": {
      "policyId": "invoice:update",
      "conditionId": "accounting_period_is_open"
    }
  }
  ```

**Test Steps:**
1. Lock an accounting period
2. Create/update invoice with date in locked period
3. Attempt to update invoice
4. Verify 403 response with PERIOD_LOCKED error

---

### Test 6: Finalize Draft Invoice

**Scenario:**
- User has `invoices.update` permission
- Invoice status is 'draft'
- Period is open
- User attempts to finalize invoice

**Expected Result:**
- ✅ RBAC check passes
- ✅ Policy check passes (status='draft', period open)
- ✅ Invoice finalized successfully

**Test Steps:**
1. Create draft invoice
2. Ensure period is open
3. Finalize invoice via API
4. Verify 200 response and invoice status='final'

---

### Test 7: Finalize Non-Draft Invoice

**Scenario:**
- User has `invoices.update` permission
- Invoice status is 'final'
- User attempts to finalize invoice again

**Expected Result:**
- ✅ RBAC check passes
- ❌ Policy check fails (status is not 'draft')
- Returns `403 Forbidden` with error:
  ```json
  {
    "error": "Can only finalize draft invoices",
    "code": "INVALID_RESOURCE_STATUS"
  }
  ```

**Test Steps:**
1. Create and finalize an invoice
2. Attempt to finalize it again
3. Verify 403 response

---

### Test 8: Cancel Invoice

**Scenario:**
- User has `invoices.delete` permission
- Invoice status is 'final'
- Period is open
- User attempts to cancel invoice

**Expected Result:**
- ✅ RBAC check passes
- ✅ Policy check passes
- ✅ Invoice cancelled successfully

**Test Steps:**
1. Create and finalize an invoice
2. Ensure period is open
3. Cancel invoice via API
4. Verify 200 response and invoice status='cancelled'

---

### Test 9: Cancel Already Cancelled Invoice

**Scenario:**
- User has `invoices.delete` permission
- Invoice status is 'cancelled'
- User attempts to cancel invoice again

**Expected Result:**
- ✅ RBAC check passes
- ❌ Policy check fails (status is 'cancelled')
- Returns `403 Forbidden` with error:
  ```json
  {
    "error": "Invoice is already cancelled",
    "code": "INVALID_RESOURCE_STATUS"
  }
  ```

**Test Steps:**
1. Create and cancel an invoice
2. Attempt to cancel it again
3. Verify 403 response

---

### Test 10: Create Invoice in Locked Period

**Scenario:**
- User has `invoices.create` permission
- Invoice date is in a locked period
- User attempts to create invoice

**Expected Result:**
- ✅ RBAC check passes
- ❌ Policy check fails (period locked)
- Returns `403 Forbidden` with PERIOD_LOCKED error

**Test Steps:**
1. Lock an accounting period
2. Attempt to create invoice with date in locked period
3. Verify 403 response

---

## 📋 Test Execution Checklist

### Automated Tests
- [ ] Run `npm test` to execute unit tests
- [ ] Verify all policy engine tests pass
- [ ] Verify all authorization integration tests pass
- [ ] Verify all invoice policy tests pass

### Manual API Tests
- [ ] Test 1: Permission exists but policy fails
- [ ] Test 2: Permission missing
- [ ] Test 3: Permission + policy pass
- [ ] Test 4: Cross-branch access denied
- [ ] Test 5: Closed period modification denied
- [ ] Test 6: Finalize draft invoice
- [ ] Test 7: Finalize non-draft invoice
- [ ] Test 8: Cancel invoice
- [ ] Test 9: Cancel already cancelled invoice
- [ ] Test 10: Create invoice in locked period

---

## 🔧 Test Setup

### Prerequisites
1. Database migrations run
2. Test user created with appropriate permissions
3. Test branches created
4. Test invoices created in various states

### Test Data
- User 1: Has all invoice permissions, access to Branch 1
- User 2: Has read-only permissions, access to Branch 1
- User 3: Has all permissions, access to Branch 2 only
- Branch 1: Active branch
- Branch 2: Active branch
- Invoice 1: Draft, Branch 1, open period
- Invoice 2: Final, Branch 1, open period
- Invoice 3: Cancelled, Branch 1, open period
- Invoice 4: Draft, Branch 2, open period
- Period Lock: Lock period for Branch 1, date range 2024-01-01 to 2024-01-31

---

## ✅ Success Criteria

All tests must pass:
- ✅ Permission exists but policy fails → denied
- ✅ Permission missing → denied
- ✅ Permission + policy pass → allowed
- ✅ Cross-branch access denied
- ✅ Closed-period modification denied
- ✅ All error messages are meaningful
- ✅ All error codes are correct
- ✅ Policy details included in error responses

---

**End of Test Scenarios**
