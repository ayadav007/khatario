# 🔐 Branch & Warehouse User Access Control

## Overview

The system implements **separate, independent access control** for branches and warehouses. Users can be assigned to specific branches and/or warehouses with granular permissions.

---

## 📊 Database Schema

### 1. **User-Branch Access** (`user_branches` table)

```sql
CREATE TABLE user_branches (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT true,              -- View transactions/reports
  can_edit BOOLEAN DEFAULT false,            -- Edit transactions
  can_delete BOOLEAN DEFAULT false,           -- Delete transactions
  can_create_transactions BOOLEAN DEFAULT false, -- Create invoices/purchases/payments
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, branch_id)
);
```

**Permissions:**
- `can_view`: User can view transactions and reports for this branch
- `can_edit`: User can edit transactions for this branch
- `can_delete`: User can delete transactions for this branch
- `can_create_transactions`: User can create invoices, purchases, payments, etc. for this branch

### 2. **User-Warehouse Access** (`user_warehouses` table)

```sql
CREATE TABLE user_warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT true,              -- View stock and reports
  can_edit BOOLEAN DEFAULT false,            -- Edit warehouse settings and stock levels
  can_create_transactions BOOLEAN DEFAULT false, -- Create invoices/purchases that affect this warehouse
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, warehouse_id)
);
```

**Permissions:**
- `can_view`: User can view warehouse stock and reports
- `can_edit`: User can edit warehouse settings and stock levels
- `can_create_transactions`: User can create invoices/purchases that affect this warehouse

**Note:** The table also has legacy columns (`can_transfer`, `can_adjust`) for backward compatibility, but `can_create_transactions` is the primary control.

---

## 🎯 Access Control Logic

### **Branch Access**

1. **Explicit Assignment**: User must have an entry in `user_branches` table
2. **No Entries = No Access**: If a user has no entries in `user_branches`, they cannot access any branches
3. **Filtering**: When fetching invoices/purchases, the system filters by `user_branches` to show only accessible branches

**Implementation:**
- `lib/branch-access.ts` - Contains all branch access functions
- `getUserAccessibleBranchIds(userId)` - Returns array of branch IDs user can access
- `checkUserBranchPermission(userId, branchId, permission)` - Checks specific permission

### **Warehouse Access**

1. **Explicit Assignment**: User must have an entry in `user_warehouses` table
2. **Branch-Warehouse Link**: If a user has branch access and the warehouse is linked to that branch, they get warehouse access
3. **No Entries = No Access**: If a user has no entries in `user_warehouses` and no branch-warehouse link, they cannot access any warehouses

**Implementation:**
- `lib/warehouse-access.ts` - Contains all warehouse access functions
- `getUserWarehouses(userId)` - Returns array of warehouses user can access
- `checkUserWarehousePermission(userId, warehouseId, permission)` - Checks specific permission

---

## 🔄 How It Works in Practice

### **Scenario 1: Multi-Branch, Multi-Warehouse Company**

**Company Setup:**
- **Branches**: Branch A (Mumbai), Branch B (Delhi), Branch C (Bangalore)
- **Warehouses**: WH-1 (Mumbai), WH-2 (Delhi), WH-3 (Bangalore), WH-4 (Central Storage)
- **Users**: 
  - Admin (Primary Admin - full access)
  - Sales Manager (Mumbai)
  - Sales Staff (Delhi)
  - Warehouse Manager (All warehouses)

**Access Assignment:**

```sql
-- Sales Manager (Mumbai) - Only Branch A
INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_create_transactions)
VALUES ('sales-mgr-id', 'branch-a-id', true, true, true);

-- Sales Staff (Delhi) - Only Branch B
INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_create_transactions)
VALUES ('sales-staff-id', 'branch-b-id', true, true, true);

-- Warehouse Manager - All Warehouses
INSERT INTO user_warehouses (user_id, warehouse_id, can_view, can_edit, can_create_transactions)
VALUES 
  ('wh-mgr-id', 'wh-1-id', true, true, true),
  ('wh-mgr-id', 'wh-2-id', true, true, true),
  ('wh-mgr-id', 'wh-3-id', true, true, true),
  ('wh-mgr-id', 'wh-4-id', true, true, true);
```

**Result:**
- Sales Manager can only see invoices/purchases from Branch A
- Sales Staff can only see invoices/purchases from Branch B
- Warehouse Manager can manage stock in all warehouses
- Admin (Primary Admin) has full access to all branches and warehouses

### **Scenario 2: Independent Branch & Warehouse Access**

**User Setup:**
- User has access to Branch A but NOT Warehouse 1 (even though Warehouse 1 is linked to Branch A)
- User has access to Warehouse 2 but NOT Branch B (even though Warehouse 2 is linked to Branch B)

**This is allowed!** Branch and warehouse access are **completely independent**.

---

## 🔍 API Enforcement

### **Invoice API** (`/api/invoices`)

```typescript
// GET /api/invoices?business_id=xxx&user_id=xxx
const accessibleBranchIds = await getUserAccessibleBranchIds(userId);

// Filter invoices by accessible branches
if (accessibleBranchIds.length === 0) {
  return { invoices: [] }; // No access
}

sql += ` AND i.branch_id = ANY($${params.length + 1})`;
params.push(accessibleBranchIds);
```

### **Purchase API** (`/api/purchases`)

Similar filtering is applied based on `user_branches`.

### **Stock/Inventory APIs**

Filtered by `user_warehouses` to show only accessible warehouses.

---

## 🛡️ Authorization System Integration

The PBAC (Permission-Based Access Control) system integrates branch/warehouse access:

```typescript
// lib/authorization.ts
const userBranches = await getUserBranches(userId);
const userWarehouses = await getUserWarehouses(userId);

const policyUser: PolicyUser = {
  id: userId,
  business_id: user.business_id,
  role_id: user.role_id,
  branch_ids: userBranches.map(b => b.branch_id),
  warehouse_ids: userWarehouses.map(w => w.warehouse_id),
};
```

This `policyUser` object is used in all authorization checks to ensure users can only access resources from their assigned branches/warehouses.

---

## 📝 Key Functions

### **Branch Access Functions** (`lib/branch-access.ts`)

- `getUserBranches(userId)` - Get all branches user can access with permissions
- `getUserAccessibleBranchIds(userId)` - Get array of branch IDs (for filtering)
- `checkUserBranchPermission(userId, branchId, permission)` - Check specific permission
- `ensureUserHasDefaultBranchAccess(userId)` - Auto-assign primary branch if no access

### **Warehouse Access Functions** (`lib/warehouse-access.ts`)

- `getUserWarehouses(userId)` - Get all warehouses user can access with permissions
- `getUserAccessibleWarehouseIds(userId)` - Get array of warehouse IDs (for filtering)
- `checkUserWarehousePermission(userId, warehouseId, permission)` - Check specific permission
- `checkUserWarehouseAccess(userId, warehouseId)` - Check if user has any access

---

## ⚠️ Important Notes

1. **Primary Admin**: Even Primary Admin must have explicit branch/warehouse assignments. There's no automatic "all access" bypass.

2. **No Entries = No Access**: If a user has no entries in `user_branches` or `user_warehouses`, they cannot access any branches/warehouses.

3. **Independent Control**: Branch access and warehouse access are **completely independent**. A user can have:
   - Branch access without warehouse access
   - Warehouse access without branch access
   - Both or neither

4. **Backward Compatibility**: Legacy users are auto-assigned to the primary branch during migration.

5. **Transaction Filtering**: All invoice/purchase queries are automatically filtered by `user_branches` to ensure users only see data from their assigned branches.

---

## 🎯 Summary

**For a company with multiple branches, multiple warehouses, and multiple users:**

1. **Assign branches to users** via `user_branches` table
2. **Assign warehouses to users** via `user_warehouses` table
3. **Set granular permissions** (view, edit, delete, create_transactions)
4. **System automatically filters** all queries by user's accessible branches/warehouses
5. **PBAC system enforces** access at the API level

**Result**: Users can only see and manage data from their assigned branches and warehouses, ensuring proper data isolation and security.
