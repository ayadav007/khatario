# Authorization Guard - Remaining Tasks

## Status Update

The authorization guard pattern has been applied to most pages. The remaining pages need authorization checks added before their `return` statements.

## Pattern to Apply

For each remaining page, add this before the main `return` statement:

```tsx
// Show loading state while checking authorization
if (authLoading) {
  return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" />
          <p className="text-gray-600">Checking permissions...</p>
        </div>
      </AppLayout>
    );
  );
}

// Show authorization denied if user cannot create
if (!canCreate) {
  return (
    <AppLayout>
      <AccessDenied
        module="module_name"
        action="create"
        details={reason}
        code="RESOURCE_CREATE_DENIED"
      />
    </AppLayout>
  );
}
```

## Pages Needing Return Statement Updates

### HR Pages (guards added, need return checks):
- ✅ `/employees/salary/payments/new` - Needs return check
- ✅ `/employees/salary/advances/new` - Needs return check
- ✅ `/employees/expenses/new` - Needs return check
- ✅ `/employees/leaves/new` - Needs return check
- ✅ `/employees/tasks/new` - Needs return check

### Sales & Purchases (guards added, need return checks):
- ✅ `/delivery-challans/new` - DONE
- ✅ `/sales-orders/new` - DONE
- ✅ `/purchase-orders/new` - DONE
- ✅ `/purchase-returns/new` - DONE

### Settings Pages (need guards):
- ⏳ `/settings/users` - User creation modal (check on modal open)
- ⏳ `/settings/roles` - Role creation/editing (check in form component)
- ⏳ `/settings/leave-types` - Inline form (check on form show)
- ⏳ `/settings/shifts` - Inline form (check on form show)
- ⏳ `/settings/holidays` - Inline form (check on form show)

### Other:
- ⏳ `/work-orders/new` - Work order creation
