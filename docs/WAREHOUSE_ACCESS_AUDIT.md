# Warehouse Access Control - Complete Audit & Implementation

## PHASE 1: AUDIT EXISTING SYSTEM

### A. Database & Relations

#### 1. Warehouse ↔ Branch Relationship

**FINDINGS:**

**A.1. `warehouses.branch_id` (Direct Link)**
- **Status**: ✅ IMPLEMENTED
- **Purpose**: Optional primary branch that uses this warehouse
- **Schema**: `warehouses.branch_id UUID REFERENCES branches(id) ON DELETE SET NULL`
- **Usage**: Used in `app/api/warehouses/route.ts` line 50 (LEFT JOIN)
- **Note**: This is a **suggestive** link, not authoritative

**A.2. `branch_warehouses` (Junction Table)**
- **Status**: ✅ IMPLEMENTED
- **Purpose**: Many-to-many mapping between branches and warehouses
- **Schema**: 
  ```sql
  CREATE TABLE branch_warehouses (
    branch_id UUID REFERENCES branches(id),
    warehouse_id UUID REFERENCES warehouses(id),
    is_primary BOOLEAN DEFAULT false,
    PRIMARY KEY (branch_id, warehouse_id)
  )
  ```
- **Usage**: 
  - Created automatically when warehouse is created with `branch_id` (line 179-184 in `app/api/warehouses/route.ts`)
  - Used in `lib/warehouse-access.ts` lines 88-95 for implicit access
- **Note**: This is the **authoritative** source for branch-warehouse relationships

**A.3. Source of Truth**
- **Current State**: `branch_warehouses` is authoritative
- **Conflict Resolution**: Both can exist, but `branch_warehouses` takes precedence
- **Issue**: No UI to manage `branch_warehouses` independently

#### 2. User ↔ Warehouse Access

**FINDINGS:**

**A.2.1. `user_warehouses` Table**
- **Status**: ✅ IMPLEMENTED (but partially used)
- **Schema**:
  ```sql
  CREATE TABLE user_warehouses (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    warehouse_id UUID REFERENCES warehouses(id), -- NOTE: References business_locations (legacy!)
    can_view BOOLEAN DEFAULT true,
    can_edit BOOLEAN DEFAULT false,
    can_transfer BOOLEAN DEFAULT false,  -- Legacy
    can_adjust BOOLEAN DEFAULT false,    -- Legacy
    can_create_transactions BOOLEAN DEFAULT false,  -- New (handled via fallback)
    UNIQUE(user_id, warehouse_id)
  )
  ```
- **Issues**:
  1. ❌ `warehouse_id` references `business_locations` (legacy table) instead of `warehouses`
  2. ❌ No UI to assign warehouses to users
  3. ❌ No API endpoint to manage `user_warehouses`

**A.2.2. Where It's Read**
- **Location**: `lib/warehouse-access.ts`
- **Functions**:
  - `checkUserWarehouseAccess()` (lines 43-85): Checks explicit access first
  - `getUserWarehouses()` (lines 229-328): Merges explicit + branch-based access
- **Precedence**: Explicit access (`user_warehouses`) takes precedence over branch-based access

#### 3. User ↔ Branch Access

**FINDINGS:**

**A.3.1. `user_branches` Table**
- **Status**: ✅ IMPLEMENTED
- **Schema**: 
  ```sql
  CREATE TABLE user_branches (
    user_id UUID,
    branch_id UUID,
    can_view BOOLEAN,
    can_edit BOOLEAN,
    can_delete BOOLEAN,
    can_create_transactions BOOLEAN,
    PRIMARY KEY (user_id, branch_id)
  )
  ```
- **Enforcement**: Via `lib/branch-access.ts`
- **Implicit Warehouse Access**: 
  - If user has branch access AND warehouse is linked via `branch_warehouses`
  - Then user gets warehouse access (view + create_transactions, but NOT edit)
  - See `lib/warehouse-access.ts` lines 87-105

---

### B. Access Control Logic

#### 4. Warehouse Access Resolution

**FINDINGS:**

**B.4.1. Step-by-Step Logic** (from `lib/warehouse-access.ts`)

1. **Primary Admin Bypass** (lines 26-41)
   - ✅ If `is_primary_admin = true` → Full access to all warehouses in business
   - ✅ Status: IMPLEMENTED

2. **Explicit Access** (lines 43-85)
   - ✅ Check `user_warehouses` table
   - ✅ Returns: `{ can_view, can_edit, can_create_transactions }`
   - ✅ Status: IMPLEMENTED (but no UI to set it)

3. **Implicit Access via Branch** (lines 87-105)
   - ✅ Check `branch_warehouses` + `user_branches`
   - ✅ If user has branch access AND warehouse is linked → grant access
   - ✅ Returns: `{ can_view: true, can_edit: false, can_create_transactions: true }`
   - ✅ Status: IMPLEMENTED (but always enabled, no setting to disable)

**B.4.2. Precedence Rules**
- ✅ Explicit access (`user_warehouses`) takes precedence
- ✅ Branch-based access is fallback
- ❌ **MISSING**: No setting to disable auto-assignment from branches

#### 5. RBAC vs PBAC Separation

**FINDINGS:**

**B.5.1. RBAC Permissions**
- **Module**: `warehouses` (from `database/migrations/019_user_management_system.sql`)
- **Permissions**: 
  - ✅ `can_view` (read)
  - ✅ `can_add` (create)
  - ✅ `can_modify` (update)
  - ✅ `can_delete` (delete)
- **Status**: ✅ IMPLEMENTED

**B.5.2. PBAC Policies**
- **Location**: `lib/policies/resources/warehouses.ts`
- **Policies**:
  - ✅ `read`: Requires `warehouses.read` + `userHasWarehouseAccess()`
  - ✅ `create`: Requires `warehouses.create` + branch access
  - ✅ `update`: Requires `warehouses.update` + `userHasWarehouseAccess()`
  - ✅ `delete`: Requires `warehouses.delete` + `userHasWarehouseAccess()`
- **Status**: ✅ IMPLEMENTED

**B.5.3. Separation**
- ✅ RBAC controls **WHAT** actions are allowed
- ✅ PBAC controls **WHICH** warehouses those actions apply to
- ✅ Status: CORRECTLY SEPARATED

---

### C. UI & API Coverage

#### 6. Admin UI

**FINDINGS:**

**C.6.1. Warehouse Assignment to Users**
- **Status**: ❌ NOT IMPLEMENTED
- **Missing**:
  - No UI in `/settings/users` to assign warehouses
  - No API endpoint to manage `user_warehouses`
  - No "Warehouse Access" tab in user edit page

**C.6.2. Branch-Warehouse Linking**
- **Status**: ⚠️ PARTIALLY IMPLEMENTED
- **Current**:
  - ✅ Warehouse creation allows selecting `branch_id`
  - ✅ Automatically creates `branch_warehouses` entry
- **Missing**:
  - ❌ No UI to link existing warehouses to branches
  - ❌ No UI to unlink warehouses from branches
  - ❌ No UI to see which warehouses are linked to which branches
  - ❌ No UI to manage multiple warehouses per branch

**C.6.3. Settings**
- **Status**: ⚠️ PARTIALLY IMPLEMENTED
- **Current**:
  - ✅ `warehouses_enabled` setting exists
- **Missing**:
  - ❌ No `auto_assign_branch_warehouses` setting

#### 7. Behavior Today

**FINDINGS:**

**C.7.1. Primary Admin Creates Warehouse**
- **Flow**:
  1. Admin creates warehouse via `/settings/warehouses/new`
  2. Can optionally select `branch_id`
  3. If `branch_id` provided → creates `branch_warehouses` entry
  4. Warehouse is created, but **no users are automatically assigned**
- **Issue**: ❌ No way to assign warehouse to users after creation

**C.7.2. Branch Has Multiple Warehouses**
- **Current**: ✅ Supported via `branch_warehouses` table
- **Issue**: ❌ No UI to manage this relationship

**C.7.3. User Assigned to Branch but Not Warehouse**
- **Current Behavior**:
  - ✅ User gets **implicit** warehouse access if:
    - User has branch access (`user_branches`)
    - Warehouse is linked to that branch (`branch_warehouses`)
  - ✅ Access granted: `{ can_view: true, can_edit: false, can_create_transactions: true }`
- **Issue**: ❌ This is **always enabled**, no way to disable

---

## SUMMARY OF FINDINGS

### ✅ IMPLEMENTED
1. Database schema for `warehouses`, `branch_warehouses`, `user_warehouses`
2. Access control logic in `lib/warehouse-access.ts`
3. RBAC permissions for warehouses module
4. PBAC policies for warehouse operations
5. Automatic branch-warehouse linking on warehouse creation
6. Implicit warehouse access via branch access

### ⚠️ PARTIALLY IMPLEMENTED
1. Branch-warehouse linking (automatic on create, but no UI to manage)
2. Settings (only `warehouses_enabled`, missing `auto_assign_branch_warehouses`)

### ❌ NOT IMPLEMENTED
1. UI to assign warehouses to users
2. UI to link/unlink warehouses to branches
3. API endpoints to manage `user_warehouses`
4. Setting to control auto-assignment from branches
5. UI to view which warehouses are linked to which branches

---

## PHASE 2: IMPLEMENTATION PLAN

### Priority 1: Core Functionality
1. Add API endpoints for `user_warehouses` management
2. Add UI in user management to assign warehouses
3. Add setting `auto_assign_branch_warehouses`

### Priority 2: Branch-Warehouse Management
4. Add UI to link/unlink warehouses to branches
5. Add UI to view branch-warehouse relationships

### Priority 3: Polish
6. Fix `user_warehouses.warehouse_id` foreign key (if needed)
7. Add bulk assignment features
8. Add audit logging
