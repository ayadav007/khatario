# PBAC Testing Guide

**Date:** 2024  
**Status:** ✅ **Test Suite Created**

---

## 📋 Overview

This guide provides instructions for testing the PBAC (Policy-Based Access Control) implementation. The test suite includes both automated unit tests and manual integration tests.

---

## 🧪 Test Structure

### Automated Tests

Located in `tests/pbac/`:

1. **`policy-engine.test.ts`** - Unit tests for policy evaluation engine
2. **`authorization.test.ts`** - Integration tests for authorize() function
3. **`invoice-policies.test.ts`** - Tests for invoice-specific policies

### Manual Test Scenarios

Located in `tests/pbac/test-scenarios.md` - Comprehensive test scenarios for manual execution

---

## 🚀 Running Tests

### Prerequisites

1. Install dependencies:
```bash
npm install
```

2. Ensure test database is configured (optional, tests use mocks by default)

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

### Run Specific Test File

```bash
npm test -- policy-engine.test.ts
```

---

## ✅ Test Scenarios

### 1. Permission Exists But Policy Fails

**Test:** User has permission but policy condition fails

**Expected:** 403 Forbidden with policy error details

### 2. Permission Missing

**Test:** User does not have required permission

**Expected:** 403 Forbidden with PERMISSION_DENIED error

### 3. Permission + Policy Pass

**Test:** User has permission and all policy conditions pass

**Expected:** 200 OK, access allowed

### 4. Cross-Branch Access Denied

**Test:** User tries to access invoice from inaccessible branch

**Expected:** 403 Forbidden with BRANCH_ACCESS_DENIED error

### 5. Closed Period Modification Denied

**Test:** User tries to modify invoice in locked period

**Expected:** 403 Forbidden with PERIOD_LOCKED error

---

## 📊 Test Coverage

### Policy Engine Tests

- ✅ Policy evaluation with passing conditions
- ✅ Policy evaluation with failing conditions
- ✅ Policy evaluation with no conditions
- ✅ Error handling in condition evaluation
- ✅ Status-based condition evaluation
- ✅ Period lock condition evaluation

### Authorization Integration Tests

- ✅ RBAC check before PBAC
- ✅ PBAC evaluation after RBAC passes
- ✅ Policy failure handling
- ✅ Backward compatibility (no policies)

### Invoice Policy Tests

- ✅ Read policy (branch access, business ownership)
- ✅ Update policy (status check, period lock)
- ✅ Finalize policy (status='draft' check)
- ✅ Cancel policy (status check)

---

## 🔧 Manual Testing

### Setup Test Data

1. Create test users with different permissions
2. Create test branches
3. Create test invoices in various states
4. Lock an accounting period for testing

### Test API Endpoints

Use the following endpoints for manual testing:

- `GET /api/invoices` - Test read policy
- `GET /api/invoices/[id]` - Test read policy with resource
- `POST /api/invoices` - Test create policy
- `PATCH /api/invoices/[id]/finalize` - Test finalize policy
- `PATCH /api/invoices/[id]/cancel` - Test cancel policy
- `PATCH /api/invoices/[id]/payments` - Test update policy

### Expected Responses

#### Success (200 OK)
```json
{
  "invoice": { ... }
}
```

#### Permission Denied (403)
```json
{
  "error": "User does not have update permission for invoice",
  "code": "PERMISSION_DENIED"
}
```

#### Policy Denied (403)
```json
{
  "error": "Cannot update finalized or cancelled invoices",
  "code": "INVALID_RESOURCE_STATUS",
  "details": {
    "policyId": "invoice:update",
    "conditionId": "resource_status_is_not_final_cancelled",
    "conditionDescription": "Resource status must not be one of: final, cancelled"
  }
}
```

---

## 📝 Test Checklist

### Automated Tests
- [ ] All policy engine tests pass
- [ ] All authorization integration tests pass
- [ ] All invoice policy tests pass
- [ ] Test coverage > 80%

### Manual Tests
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

## 🐛 Troubleshooting

### Tests Failing

1. **Check mocks are properly set up**
   - Verify all dependencies are mocked
   - Check mock return values

2. **Check test data**
   - Ensure test data matches expected structure
   - Verify dates and IDs are correct

3. **Check async/await**
   - Ensure all async operations are awaited
   - Check for unhandled promise rejections

### Manual Tests Failing

1. **Check user permissions**
   - Verify user has correct role
   - Check role_permissions table

2. **Check branch access**
   - Verify user_branches table has correct entries
   - Check branch IDs match

3. **Check period locks**
   - Verify period_locks table entries
   - Check date ranges

---

## 📚 Additional Resources

- `docs/PBAC_IMPLEMENTATION.md` - PBAC implementation details
- `tests/pbac/test-scenarios.md` - Detailed test scenarios
- `lib/policies/` - Policy implementation code

---

**End of Testing Guide**
