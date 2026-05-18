# PBAC Policy Viewer

## Overview

The Policy Viewer provides a read-only interface for viewing all Policy-Based Access Control (PBAC) policies in the system. This helps administrators understand what authorization rules are in place without allowing modifications.

## Features

### ✅ Read-Only Access
- Policies are **code-managed only** - cannot be edited via UI
- All changes must be made in policy files: `lib/policies/resources/*.ts`

### ✅ Comprehensive View
- View all registered policies
- See resource, action, required permissions, and conditions
- Understand module organization

### ✅ Search & Filter
- Search by resource, action, permission, or module
- Filter by module (Sales, HR, Inventory, etc.)
- Filter by resource type

### ✅ Detailed Information
- Expandable rows show full policy details
- View all conditions with descriptions
- See error codes and messages for each condition

## Access

**Location**: `/admin/policies`

**Required**: Platform admin authentication

**Authorization**: Only authenticated platform admins can access this page

## API Endpoint

### GET /api/policies

Returns all registered policies with human-readable information.

**Authentication**: Required (admin ID via `x-admin-id` header or `admin_id` query param)

**Response**:
```json
{
  "policies": [
    {
      "resource": "invoice",
      "action": "read",
      "requiresPermission": "invoices.read",
      "conditions": [
        {
          "id": "user_has_branch_access",
          "description": "User must have access to the resource branch",
          "errorMessage": "You do not have access to this branch",
          "errorCode": "BRANCH_ACCESS_DENIED"
        }
      ],
      "conditionCount": 2,
      "priority": 10,
      "module": "Sales"
    }
  ],
  "total": 120,
  "modules": ["Sales", "HR", "Inventory", "Accounting", ...]
}
```

## UI Components

### Policy Table
- **Module Badge**: Color-coded by module type
- **Resource**: The resource name (e.g., "invoice", "employee")
- **Action**: The action (e.g., "read", "create", "update")
- **Required Permission**: RBAC permission required
- **Conditions**: Count of conditions
- **Priority**: Evaluation priority (lower = evaluated first)

### Expandable Rows
Click any policy row to expand and see:
- Full policy details
- All conditions with:
  - Description
  - Error code
  - Error message
  - Condition ID

### Filters
- **Search**: Search across resource, action, permission, module
- **Module Filter**: Filter by module type
- **Resource Filter**: Filter by specific resource

## Policy Structure

Each policy contains:
1. **Resource**: The resource type (e.g., "invoice", "employee")
2. **Action**: The action (e.g., "read", "create", "update", "delete")
3. **Required Permission**: RBAC permission that must exist first
4. **Conditions**: List of conditions that must all pass
5. **Priority**: Evaluation order (lower = checked first)

## Module Organization

Policies are organized into modules:
- **Sales**: Invoices, customers, credit notes
- **Purchases**: Purchase orders, suppliers, expenses
- **Inventory**: Warehouses, stock transfers, items
- **Accounting**: Journals, accounting periods
- **Reports**: All report types
- **HR**: Employees, attendance, payroll, leaves
- **WhatsApp**: Messages, campaigns, bot rules
- **Settings**: Tools, settings

## Adding Policies

Policies are **NOT** editable via the UI. To add or modify policies:

1. **Create/Edit Policy File**: `lib/policies/resources/[module].ts`
2. **Define Policies**: Use the `Policy` interface
3. **Register Policies**: Add to `lib/policies/registry.ts`
4. **Restart Server**: Policies are loaded at startup

Example:
```typescript
// lib/policies/resources/my-module.ts
import { Policy } from '../types';
import { resourceBelongsToBusiness } from '../conditions';

export function getMyModulePolicies(): Policy[] {
  return [
    {
      resource: 'my_resource',
      action: 'read',
      requiresPermission: 'my_module.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
  ];
}
```

## Security

- **Read-Only**: No POST, PUT, DELETE endpoints
- **Admin-Only**: Requires platform admin authentication
- **No Policy Modification**: Policies can only be changed in code
- **Audit Trail**: All policy changes require code commits

## Troubleshooting

### Policies Not Showing
- Ensure policies are registered in `lib/policies/registry.ts`
- Check that policy files are properly exported
- Restart the server after adding new policies

### Module Not Recognized
- The `getModuleName()` function in `/api/policies/route.ts` maps resources to modules
- Add new mappings if needed

### Missing Conditions
- Policies without conditions pass if RBAC permission exists
- This is intentional for simple authorization checks

## Related Documentation

- `docs/PBAC_DEFAULT_DENY.md` - Default-deny mode documentation
- `lib/policies/README.md` - Policy development guide (if exists)
- `PBAC_BLOCKED_MODULES_UNBLOCKED.md` - Recent policy additions

---

**Last Updated**: 2024  
**Status**: ✅ Active
