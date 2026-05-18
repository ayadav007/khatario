# RBAC Integration Guide

**Purpose:** Guide for integrating RBAC authorization error handling into existing pages

---

## 🎯 Overview

This guide shows how to integrate the new authorization error handling components into your existing pages.

---

## 📦 Components & Hooks Available

### 1. `AccessDenied` Component
User-friendly component that displays when authorization fails (403).

**Location:** `components/common/AccessDenied.tsx`

### 2. `useAuthorizationError` Hook
Hook for handling authorization errors in API calls.

**Location:** `hooks/useAuthorizationError.ts`

### 3. `buildApiUrl` Helper
Utility to build API URLs with automatic `user_id` injection.

**Location:** `lib/api-helpers.ts`

---

## 🔧 Integration Steps

### Step 1: Import Required Components

```tsx
import { AccessDenied } from '@/components/common/AccessDenied';
import { useAuthorizationError } from '@/hooks/useAuthorizationError';
import { buildApiUrl, buildRequestBody } from '@/lib/api-helpers';
import { useAuth } from '@/contexts/AuthContext';
```

### Step 2: Initialize Hook

```tsx
export default function MyPage() {
  const { business, user } = useAuth();
  const { accessDenied, handleApiCall, clearAccessDenied } = useAuthorizationError();
  
  // ... rest of component
}
```

### Step 3: Update API Calls

**Before:**
```tsx
const fetchData = async () => {
  const res = await fetch(`/api/items?business_id=${business.id}`);
  if (res.ok) {
    const data = await res.json();
    setItems(data.items);
  } else {
    console.error('Failed to fetch');
  }
};
```

**After:**
```tsx
const fetchData = async () => {
  if (!business?.id || !user?.id) return;
  
  const result = await handleApiCall(
    () => fetch(buildApiUrl('/api/items', { business_id: business.id })),
    { showToast: false }
  );

  if (result.success && result.data) {
    setItems(result.data.items);
  } else if (result.isAuthorizationError) {
    // Access denied - AccessDenied component will be shown
    return;
  } else {
    console.error('Failed to fetch:', result.error);
  }
};
```

### Step 4: Add AccessDenied Component

```tsx
// Show access denied if authorization failed
if (accessDenied) {
  return (
    <AppLayout>
      <div className="p-6">
        <AccessDenied
          message={accessDenied.message}
          details={accessDenied.details}
          code={accessDenied.code}
          onRetry={() => {
            clearAccessDenied();
            fetchData(); // Retry the API call
          }}
        />
      </div>
    </AppLayout>
  );
}
```

### Step 5: Update POST/PATCH/PUT/DELETE Calls

**Before:**
```tsx
const createItem = async (itemData: any) => {
  const res = await fetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      business_id: business.id,
      ...itemData,
    }),
  });
  
  if (res.ok) {
    // Success
  } else {
    const error = await res.json();
    alert(error.error);
  }
};
```

**After:**
```tsx
const createItem = async (itemData: any) => {
  if (!business?.id || !user?.id) return;
  
  const result = await handleApiCall(
    () => fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequestBody({
        business_id: business.id,
        ...itemData,
      })),
    }),
    { showToast: true }
  );

  if (result.success) {
    // Success - show toast or redirect
    toast.success('Item created successfully');
  } else if (result.isAuthorizationError) {
    // Access denied - toast already shown by handleApiCall
    // Optionally show AccessDenied component
  } else {
    toast.error(result.error || 'Failed to create item');
  }
};
```

---

## 📋 Complete Example

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useAuthorizationError } from '@/hooks/useAuthorizationError';
import { buildApiUrl, buildRequestBody } from '@/lib/api-helpers';
import { AppLayout } from '@/components/layout/AppLayout';
import { Loader2 } from 'lucide-react';

export default function ItemsPage() {
  const { business, user } = useAuth();
  const { accessDenied, handleApiCall, clearAccessDenied } = useAuthorizationError();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    if (!business?.id || !user?.id) return;
    
    setLoading(true);
    try {
      const result = await handleApiCall(
        () => fetch(buildApiUrl('/api/items', { business_id: business.id })),
        { showToast: false }
      );

      if (result.success && result.data) {
        setItems(result.data.items || []);
      } else if (result.isAuthorizationError) {
        return; // AccessDenied will be shown
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (business?.id && user?.id) {
      fetchItems();
    }
  }, [business?.id, user?.id]);

  // Show access denied
  if (accessDenied) {
    return (
      <AppLayout>
        <div className="p-6">
          <AccessDenied
            message={accessDenied.message}
            details={accessDenied.details}
            code={accessDenied.code}
            onRetry={() => {
              clearAccessDenied();
              fetchItems();
            }}
          />
        </div>
      </AppLayout>
    );
  }

  // Show loading
  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[600px]">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      </AppLayout>
    );
  }

  // Normal render
  return (
    <AppLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Items</h1>
        {/* Your items list here */}
      </div>
    </AppLayout>
  );
}
```

---

## 🎨 Customization

### Custom Error Messages

```tsx
if (accessDenied) {
  const customMessage = accessDenied.code === 'BRANCH_ACCESS_DENIED' 
    ? 'You don\'t have access to this branch'
    : accessDenied.message;

  return (
    <AccessDenied
      message={customMessage}
      details={accessDenied.details}
      code={accessDenied.code}
    />
  );
}
```

### Silent Error Handling

```tsx
// Don't show toast, just handle silently
const result = await handleApiCall(
  () => fetch('/api/items'),
  { showToast: false }
);
```

### Custom Error Callback

```tsx
const result = await handleApiCall(
  () => fetch('/api/items'),
  {
    showToast: true,
    onError: (error) => {
      // Custom error handling
      console.log('Authorization error:', error);
    }
  }
);
```

---

## ✅ Checklist

When integrating into a page:

- [ ] Import `AccessDenied` component
- [ ] Import `useAuthorizationError` hook
- [ ] Import `buildApiUrl` and `buildRequestBody` helpers
- [ ] Initialize `useAuthorizationError` hook
- [ ] Update all API calls to use `handleApiCall`
- [ ] Add `user_id` to all API calls (via `buildApiUrl` or `buildRequestBody`)
- [ ] Add `AccessDenied` component render condition
- [ ] Test with user without permissions
- [ ] Test with user with permissions
- [ ] Verify error messages are user-friendly

---

## 🚀 Quick Migration Script

For bulk migration, you can use this pattern:

1. Find all `fetch('/api/...')` calls
2. Replace with `handleApiCall(() => fetch(buildApiUrl(...)))`
3. Add `user_id` to query params or body
4. Add `AccessDenied` component check

---

## 📚 Related Documentation

- `docs/RBAC_HARDENING_COMPLETE.md` - Complete implementation summary
- `docs/RBAC_TESTING_GUIDE.md` - Testing scenarios
- `components/common/AccessDenied.tsx` - Component source
- `hooks/useAuthorizationError.ts` - Hook source

---

**End of Integration Guide**
