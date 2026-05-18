# Permission Denial UX Guide

## Overview
This document describes the user experience when a user doesn't have permission to access a feature or module.

## User Experience Flow

### Scenario 1: User tries to VIEW a module they don't have access to

**Example:** User doesn't have permission to view "Sales/Invoices"

**What they see:**
- The page loads but immediately shows an **Access Denied** screen instead of the content
- A clear message: **"Access to Invoices is Restricted"**
- Explanation: **"You don't have permission to view or manage invoices. Please contact your administrator to request access."**
- Two action buttons:
  - **"Back to Dashboard"** - Returns to dashboard
  - **"Manage Permissions"** - Takes to settings/roles (if they have settings access)

**Visual Design:**
- Red lock icon in a circular background
- Clean, centered layout with white card
- Professional, non-threatening design
- No technical error codes visible to end users (only in console)

### Scenario 2: User tries to CREATE (but can view)

**Example:** User has view permission but tries to create a new invoice

**What happens:**
- User is redirected to the list page (`/invoices`)
- If API call fails, they see **Access Denied** with:
  - Message: **"Access to Invoices is Restricted"**
  - Details: **"You don't have permission to create invoices. Please contact your administrator to request access."**

### Scenario 3: API returns 403 error

**When:** Any API call returns 403 Forbidden

**What happens:**
- `useAuthorizationError` hook automatically detects the error
- Shows **Access Denied** component with:
  - Error message from backend
  - Module name (if detectable from error)
  - Action buttons to navigate away

## Implementation

### 1. Using AccessDenied Component

```tsx
import { AccessDenied } from '@/components/common/AccessDenied';
import { useAuthorizationError } from '@/hooks/useAuthorizationError';

export default function InvoicesPage() {
  const { accessDenied, handleApiCall } = useAuthorizationError();

  // ... fetch data with handleApiCall

  if (accessDenied) {
    return (
      <AppLayout>
        <AccessDenied
          module="invoices"
          action="view"
          message={accessDenied.message}
          details={accessDenied.details}
          code={accessDenied.code}
          onRetry={() => fetchInvoices()}
        />
      </AppLayout>
    );
  }

  // ... rest of page
}
```

### 2. Frontend Permission Check (Before Page Load)

```tsx
import { usePermissions } from '@/hooks/usePermissions';

export default function NewInvoicePage() {
  const { canAdd, loading: permissionsLoading } = usePermissions();
  const router = useRouter();

  useEffect(() => {
    if (!permissionsLoading && user && !canAdd('invoices')) {
      router.push('/invoices?error=permission_denied');
    }
  }, [permissionsLoading, user, canAdd, router]);

  // ... rest of page
}
```

### 3. Backend Authorization

Backend automatically returns 403 with:
```json
{
  "error": "User does not have read permission for invoices",
  "code": "PERMISSION_DENIED",
  "details": {
    "resource": "invoices",
    "action": "read"
  }
}
```

## Message Examples by Module

| Module | View Permission Denied | Create Permission Denied |
|--------|----------------------|------------------------|
| **Invoices** | "You don't have permission to view or manage invoices. Please contact your administrator to request access." | "You don't have permission to create invoices. Please contact your administrator to request access." |
| **Customers** | "You don't have permission to view or manage customers. Please contact your administrator to request access." | "You don't have permission to create customers. Please contact your administrator to request access." |
| **Items** | "You don't have permission to view or manage items. Please contact your administrator to request access." | "You don't have permission to create items. Please contact your administrator to request access." |
| **Employees** | "You don't have permission to view or manage employees. Please contact your administrator to request access." | "You don't have permission to create employees. Please contact your administrator to request access." |
| **Reports** | "You don't have permission to view or export reports. Please contact your administrator to request access." | N/A (Reports are read-only) |
| **Settings** | "You don't have permission to access settings. Please contact your administrator to request access." | "You don't have permission to modify settings. Please contact your administrator to request access." |

## Error Codes

| Code | Meaning | User Message |
|------|---------|--------------|
| `PERMISSION_DENIED` | User lacks RBAC permission | Module-specific message |
| `BRANCH_ACCESS_DENIED` | User lacks branch access | "You don't have access to this branch. Please contact your administrator." |
| `WAREHOUSE_ACCESS_DENIED` | User lacks warehouse access | "You don't have access to this warehouse. Please contact your administrator." |
| `NO_POLICY_DEFINED` | PBAC policy missing | "This feature requires additional configuration. Please contact your administrator." |
| `ACCOUNTING_PERIOD_LOCKED` | Period is locked | "This accounting period is locked and cannot be modified. Please contact your administrator." |

## Best Practices

1. **Always show AccessDenied component** - Never show empty pages or generic errors
2. **Provide clear next steps** - Always include buttons to navigate away or contact admin
3. **Use module-specific messages** - Users should know exactly what they can't access
4. **Don't expose technical details** - Hide error codes, stack traces, or internal details
5. **Be consistent** - Use the same AccessDenied component everywhere
6. **Check permissions early** - Check on page load, not just on action

## Navigation Options

The AccessDenied component provides these navigation options:

1. **Back to Dashboard** - Always available, takes user to `/dashboard`
2. **Manage Permissions** - Only shown if `module` prop is provided, takes to `/settings/roles`
3. **Try Again** - Only shown if `onRetry` callback is provided

## Example: Full Implementation

```tsx
'use client';

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useAuthorizationError } from '@/hooks/useAuthorizationError';
import { usePermissions } from '@/hooks/usePermissions';

export default function InvoicesPage() {
  const { canView, loading: permissionsLoading } = usePermissions();
  const { accessDenied, handleApiCall } = useAuthorizationError();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  // Check permission before loading data
  useEffect(() => {
    if (!permissionsLoading && !canView('invoices')) {
      // Permission denied - will show AccessDenied when accessDenied is set
      return;
    }
    
    if (canView('invoices')) {
      fetchInvoices();
    }
  }, [permissionsLoading, canView]);

  const fetchInvoices = async () => {
    setLoading(true);
    const result = await handleApiCall(
      () => fetch(`/api/invoices?business_id=${business.id}&user_id=${user.id}`),
      { showToast: false }
    );

    if (result.success && result.data) {
      setInvoices(result.data.invoices || []);
    }
    setLoading(false);
  };

  // Show AccessDenied if permission check failed
  if (!permissionsLoading && !canView('invoices')) {
    return (
      <AppLayout>
        <AccessDenied
          module="invoices"
          action="view"
          message="Access to Invoices is Restricted"
          details="You don't have permission to view or manage invoices. Please contact your administrator to request access."
        />
      </AppLayout>
    );
  }

  // Show AccessDenied if API returned 403
  if (accessDenied) {
    return (
      <AppLayout>
        <AccessDenied
          module="invoices"
          action="view"
          message={accessDenied.message}
          details={accessDenied.details}
          code={accessDenied.code}
          onRetry={fetchInvoices}
        />
      </AppLayout>
    );
  }

  // ... render invoices list
}
```

---

**Remember:** The goal is to clearly communicate what the user cannot access and provide them with actionable next steps, not to confuse or frustrate them with technical error messages.
