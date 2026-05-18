# RBAC Testing Guide

**Purpose:** Comprehensive testing guide for RBAC hardening implementation

---

## 🧪 Test Scenarios

### Test 1: Remove Permission from Primary Admin

**Objective:** Verify that removing a permission from Primary Admin role blocks access.

**Steps:**
1. Login as Primary Admin user
2. Navigate to Settings → Roles & Permissions
3. Select "Primary Admin" role
4. Remove `can_view` permission for `invoices` module
5. Save changes
6. Navigate to Invoices page
7. Call API: `GET /api/invoices?user_id=<primary_admin_id>&business_id=<business_id>`

**Expected Result:**
- ✅ API returns `403 Forbidden`
- ✅ Response body: `{ "error": "User does not have 'invoices.read' permission.", "code": "MODULE_PERMISSION_DENIED" }`
- ✅ UI shows "Access Denied" message (if implemented)

**Pass Criteria:**
- No hardcoded bypass exists
- Permission check is enforced

---

### Test 2: Admin Role Without Permission

**Objective:** Verify that a user with Primary Admin role but without specific permission is denied access.

**Steps:**
1. Create a new role "Test Admin" with all permissions EXCEPT `invoices.create`
2. Assign this role to a user
3. Login as that user
4. Attempt to create an invoice: `POST /api/invoices`

**Expected Result:**
- ✅ API returns `403 Forbidden`
- ✅ Response: `{ "error": "User does not have 'invoices.create' permission.", "code": "MODULE_PERMISSION_DENIED" }`
- ✅ UI prevents form submission or shows error

**Pass Criteria:**
- Role-based permission check works
- No implicit admin privileges

---

### Test 3: Valid Role with Permission

**Objective:** Verify that users with valid permissions can access resources.

**Steps:**
1. Create a role "Sales Manager" with `invoices.view` and `invoices.create` permissions
2. Assign this role to a user
3. Login as that user
4. Call API: `GET /api/invoices?user_id=<user_id>&business_id=<business_id>`
5. Create an invoice: `POST /api/invoices`

**Expected Result:**
- ✅ GET request returns `200 OK` with invoice list
- ✅ POST request returns `201 Created` with new invoice
- ✅ No authorization errors

**Pass Criteria:**
- Valid permissions allow access
- No false positives

---

### Test 4: Branch Access Control

**Objective:** Verify that users can only access branches they're assigned to.

**Steps:**
1. Create two branches: "Branch A" and "Branch B"
2. Create a user with `invoices.view` permission
3. Assign user to "Branch A" only (via `user_branches` table)
4. Login as that user
5. Attempt to create invoice for "Branch B": `POST /api/invoices` with `branch_id=<branch_b_id>`

**Expected Result:**
- ✅ API returns `403 Forbidden`
- ✅ Response: `{ "error": "User does not have access to branch '<branch_b_id>'.", "code": "BRANCH_ACCESS_DENIED" }`

**Pass Criteria:**
- Branch access is enforced
- Cross-branch access is blocked

---

### Test 5: Warehouse Access Control

**Objective:** Verify that users can only access warehouses they're assigned to.

**Steps:**
1. Create two warehouses: "Warehouse X" and "Warehouse Y"
2. Create a user with `items.view` permission
3. Assign user to "Warehouse X" only (via `user_warehouses` table)
4. Login as that user
5. Attempt to create inventory adjustment for "Warehouse Y": `POST /api/inventory-adjustments` with `warehouse_id=<warehouse_y_id>`

**Expected Result:**
- ✅ API returns `403 Forbidden`
- ✅ Response: `{ "error": "User does not have access to warehouse '<warehouse_y_id>'.", "code": "WAREHOUSE_ACCESS_DENIED" }`

**Pass Criteria:**
- Warehouse access is enforced
- Cross-warehouse access is blocked

---

### Test 6: UI Permission Checks (UX Only)

**Objective:** Verify that UI permission checks are for UX only and don't bypass backend.

**Steps:**
1. Create a user with `invoices.view` but NOT `invoices.create`
2. Login as that user
3. Navigate to Invoices page
4. Check if "Create Invoice" button is hidden (UI check)
5. Manually call API: `POST /api/invoices` (bypassing UI)

**Expected Result:**
- ✅ UI hides "Create Invoice" button (good UX)
- ✅ Direct API call returns `403 Forbidden` (backend enforcement)
- ✅ Backend is source of truth

**Pass Criteria:**
- UI checks don't bypass backend
- Backend always enforces permissions

---

### Test 7: Permission Removal Blocks Access

**Objective:** Verify that removing a permission immediately blocks access.

**Steps:**
1. Create a user with `invoices.view` permission
2. User is currently viewing invoices (API returns 200)
3. Remove `invoices.view` permission from user's role
4. User refreshes page or makes another API call

**Expected Result:**
- ✅ API returns `403 Forbidden` immediately
- ✅ No cached permissions
- ✅ Permission removal is effective

**Pass Criteria:**
- Permission changes take effect immediately
- No permission caching issues

---

### Test 8: Multiple Permission Checks

**Objective:** Verify that operations requiring multiple permissions check all of them.

**Steps:**
1. Create a user with `invoices.view` but NOT `invoices.modify`
2. Login as that user
3. Attempt to finalize an invoice: `PATCH /api/invoices/<id>/finalize`

**Expected Result:**
- ✅ API returns `403 Forbidden`
- ✅ Response indicates missing `modify` permission
- ✅ View permission alone is insufficient

**Pass Criteria:**
- Multiple permissions are checked
- All required permissions must be present

---

### Test 9: Direct API Call Without User ID

**Objective:** Verify that API calls without user_id are rejected.

**Steps:**
1. Call API without `user_id`: `GET /api/invoices?business_id=<business_id>`

**Expected Result:**
- ✅ API returns `400 Bad Request`
- ✅ Response: `{ "error": "user_id is required for authorization" }`

**Pass Criteria:**
- User ID is mandatory
- Missing user ID is caught early

---

### Test 10: Invalid User ID

**Objective:** Verify that invalid user IDs are handled gracefully.

**Steps:**
1. Call API with non-existent user: `GET /api/invoices?user_id=invalid-id&business_id=<business_id>`

**Expected Result:**
- ✅ API returns `403 Forbidden` or `401 Unauthorized`
- ✅ Response indicates authentication/authorization failure

**Pass Criteria:**
- Invalid users are rejected
- No information leakage

---

## 📋 Test Checklist

- [ ] Test 1: Remove Permission from Primary Admin
- [ ] Test 2: Admin Role Without Permission
- [ ] Test 3: Valid Role with Permission
- [ ] Test 4: Branch Access Control
- [ ] Test 5: Warehouse Access Control
- [ ] Test 6: UI Permission Checks (UX Only)
- [ ] Test 7: Permission Removal Blocks Access
- [ ] Test 8: Multiple Permission Checks
- [ ] Test 9: Direct API Call Without User ID
- [ ] Test 10: Invalid User ID

---

## 🚀 Running Tests

### Manual Testing

1. Use Postman or curl to test API endpoints
2. Use browser DevTools to test UI behavior
3. Follow test scenarios above

### Automated Testing (Future)

```bash
# Run authorization coverage validator
npx ts-node scripts/validate-authorization-coverage.ts

# Run regression tests (when implemented)
npm run test:rbac
```

---

## 📝 Test Results Template

```
Test #: [Test Number]
Date: [Date]
Tester: [Name]
Status: ✅ PASS / ❌ FAIL

Steps:
1. [Step 1]
2. [Step 2]
...

Expected: [Expected Result]
Actual: [Actual Result]

Notes: [Any additional notes]
```

---

## ✅ Success Criteria

All tests must pass:
- ✅ No hardcoded admin bypasses
- ✅ Backend is source of truth
- ✅ Permission removal blocks access
- ✅ Branch/warehouse access is enforced
- ✅ UI checks don't bypass backend
- ✅ All mutating routes require authorization

---

**End of Testing Guide**
