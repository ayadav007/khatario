# Authorization Guard - Developer Guide

This guide explains how to add authorization guards to new pages in the application.

## Quick Checklist for New Pages

When creating a new create/edit page, follow these steps:

- [ ] Import `useAuthorizationGuard` hook
- [ ] Import `AccessDenied` component  
- [ ] Import `Loader2` from lucide-react (if not already imported)
- [ ] Get `user` and `business` from `useAuth()`
- [ ] Initialize the authorization guard hook
- [ ] Add loading state check before main return
- [ ] Add authorization denied check before main return
- [ ] Determine the correct `resource` and `action` values

## Pattern 1: Full Page (New/Edit Pages)

Use this pattern for standalone create/edit pages like `/invoices/new`, `/customers/new`, etc.

### Step-by-Step Example

```tsx
'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { AppLayout } from '@/components/layout/AppLayout';
import { Loader2 } from 'lucide-react';

export default function NewResourcePage() {
  const { business, user } = useAuth();
  const [loading, setLoading] = useState(false);
  
  // ✅ STEP 1: Add authorization guard hook
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'resource_name', // e.g., 'invoices', 'customers', 'items'
    action: 'create', // or 'update' for edit pages
    skipCheck: !user?.id || !business?.id
  });

  // ✅ STEP 2: Add loading state check
  if (authLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" />
            <p className="text-gray-600">Checking permissions...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  // ✅ STEP 3: Add authorization denied check
  if (!canCreate) {
    return (
      <AppLayout>
        <AccessDenied
          module="resource_name"
          action="create"
          details={reason}
          code="RESOURCE_CREATE_DENIED"
        />
      </AppLayout>
    );
  }

  // ✅ STEP 4: Continue with your normal page content
  return (
    <AppLayout>
      {/* Your form/page content */}
    </AppLayout>
  );
}
```

### For Edit Pages

For edit pages (e.g., `/invoices/[id]/edit`), use `action: 'update'` and optionally include `resourceId`:

```tsx
const { allowed: canEdit, loading: authLoading, reason } = useAuthorizationGuard({
  resource: 'invoices',
  action: 'update',
  resourceId: params.id, // Optional: for resource-specific checks
  skipCheck: !user?.id || !business?.id || !params.id
});
```

## Pattern 2: Modal/Inline Forms (Settings Pages)

Use this pattern for pages with modals or inline forms that appear conditionally.

### Step-by-Step Example

```tsx
'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';

export default function SettingsPage() {
  const { business, user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  
  // ✅ STEP 1: Add authorization guard hook
  const { allowed: canCreate, loading: authLoading } = useAuthorizationGuard({
    resource: 'settings',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });

  // ✅ STEP 2: Check authorization when opening form
  const handleAddClick = () => {
    if (!canCreate) {
      alert('You do not have permission to create this. Please contact your administrator.');
      return;
    }
    setShowForm(true);
  };

  // ✅ STEP 3: Also check in edit handler if applicable
  const handleEdit = (item: any) => {
    if (!canCreate) { // 'create' permission often covers 'update' in settings
      alert('You do not have permission to edit this. Please contact your administrator.');
      return;
    }
    setEditingItem(item);
    setShowForm(true);
  };

  return (
    <AppLayout>
      <Button onClick={handleAddClick}>
        Add New Item
      </Button>
      
      {showForm && (
        <form>
          {/* Your form content */}
        </form>
      )}
    </AppLayout>
  );
}
```

## Resource-Action Mapping

Use this reference to determine the correct `resource` and `action` values:

### Resources

| Resource Name | Used For |
|--------------|----------|
| `invoices` | Invoices, delivery challans |
| `customers` | Customer management |
| `suppliers` | Supplier management (also uses `purchases` for some operations) |
| `items` | Products/items management |
| `purchases` | Purchase orders, purchase returns |
| `purchase_orders` | Purchase orders (specific) |
| `sales_orders` | Sales orders |
| `journal` | Journal entries |
| `credit_notes` | Credit notes |
| `debit_notes` | Debit notes |
| `employees` | Employee management |
| `payroll` | Salary payments, advances |
| `expenses` | Employee expenses |
| `leave_requests` | Leave requests |
| `hr` | General HR tasks |
| `warehouses` | Warehouse management |
| `inventory_adjustments` | Inventory adjustments |
| `work_orders` | Work orders |
| `settings` | Settings, roles, users, branches, accounts, leave types, shifts, holidays |
| `reports` | Reports |

### Actions

| Action | Used For |
|--------|----------|
| `create` | Creating new resources |
| `read` | Viewing resources (usually handled by backend) |
| `update` | Editing/updating resources |
| `delete` | Deleting resources (usually checked at action time) |

### Common Patterns

```tsx
// Creating invoices
resource: 'invoices', action: 'create'

// Editing customers
resource: 'customers', action: 'update'

// Creating employees
resource: 'employees', action: 'create'

// Settings operations (branches, users, roles, etc.)
resource: 'settings', action: 'create' // or 'update'

// HR operations
resource: 'hr', action: 'create'
resource: 'payroll', action: 'create'
resource: 'leave_requests', action: 'create'
```

## Authorization Preview API

The `useAuthorizationGuard` hook uses the `/api/authorization/preview` endpoint to check permissions without performing any mutations. This is safe and fast.

### API Endpoint

```
GET /api/authorization/preview?resource=invoices&action=create&user_id=xxx&business_id=xxx
```

Response:
```json
{
  "allowed": true,
  "reason": null,
  "code": null
}
```

Or if denied:
```json
{
  "allowed": false,
  "reason": "User does not have create permission for invoices",
  "code": "INVOICE_CREATE_DENIED"
}
```

## Testing Authorization

1. **Test as user without permission**: Remove permission from role, try to access page
2. **Test loading state**: Check that loading spinner appears briefly
3. **Test denied state**: Verify `AccessDenied` component shows with correct message
4. **Test allowed state**: Verify page loads normally when permission exists

## Common Mistakes to Avoid

1. ❌ **Forgetting to import hooks/components**
   ```tsx
   // Missing imports
   import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
   import { AccessDenied } from '@/components/common/AccessDenied';
   ```

2. ❌ **Wrong resource name**
   ```tsx
   // Wrong
   resource: 'invoice' // singular
   
   // Correct
   resource: 'invoices' // plural (match backend resource name)
   ```

3. ❌ **Not checking skipCheck condition**
   ```tsx
   // Missing business/user check
   skipCheck: false // Wrong - will fail on page load
   
   // Correct
   skipCheck: !user?.id || !business?.id
   ```

4. ❌ **Forgetting loading state**
   ```tsx
   // Missing authLoading check - will show error briefly
   if (!canCreate) { ... }
   
   // Correct - check loading first
   if (authLoading) { return <Loading />; }
   if (!canCreate) { return <AccessDenied />; }
   ```

5. ❌ **Not checking in modal handlers**
   ```tsx
   // Wrong - no check
   const handleClick = () => setShowModal(true);
   
   // Correct
   const handleClick = () => {
     if (!canCreate) {
       alert('No permission');
       return;
     }
     setShowModal(true);
   };
   ```

## Need Help?

If you're unsure about:
- **Which resource name to use**: Check `lib/authorization.ts` or existing similar pages
- **Which action to use**: Usually `create` for new pages, `update` for edit pages
- **Whether to use Pattern 1 or 2**: Pattern 1 for standalone pages, Pattern 2 for modals/inline forms

## Examples in Codebase

- **Full Page Example**: `app/invoices/new/page.tsx`
- **Edit Page Example**: `app/customers/[id]/edit/page.tsx` (if exists)
- **Modal Example**: `app/settings/users/page.tsx`
- **Inline Form Example**: `app/settings/leave-types/page.tsx`
