# PBAC Default-Deny Mode

## Overview

PBAC (Policy-Based Access Control) now operates in **secure-by-default** mode. This means:

**If no PBAC policy exists for a resource/action combination, access is DENIED by default.**

This ensures that all protected resources must have explicit policies defined, preventing accidental exposure of resources that haven't been properly secured.

---

## What is Default-Deny?

### Before (Default-Allow)
- If RBAC permission exists but no PBAC policy → **ACCESS GRANTED**
- This allowed routes to work without policies (backward compatibility)

### After (Default-Deny) ✅
- If RBAC permission exists but no PBAC policy → **ACCESS DENIED**
- All routes must have explicit policies to function
- Prevents accidental exposure of unprotected resources

---

## Configuration

### Environment Variable

```bash
# .env or .env.local
PBAC_DEFAULT_DENY=true  # Default: true (secure-by-default)
```

**Settings:**
- `PBAC_DEFAULT_DENY=true` → **Default DENY** (secure, recommended)
- `PBAC_DEFAULT_DENY=false` → **Default ALLOW** (legacy mode, for migration only)

**⚠️ WARNING**: Setting to `false` disables security. Only use during emergency rollback.

---

## Protected Modules

The following modules are **fully protected** with PBAC policies:

### ✅ Protected (Have Policies)
- **Invoices** (`invoice`, `invoices`)
- **Inventory Adjustments** (`inventory_adjustment`, `inventory_adjustments`)
- **Warehouses** (`warehouse`, `warehouses`)
- **Stock Transfers** (`warehouse_transfer`, `stock_transfers`)
- **Accounting Journals** (`journal`, `journals`)
- **Accounting Periods** (`accounting_period`, `accounting_periods`)
- **Reports** (`report`, `report.financial`, `report.gst`, `report.inventory`)

### ⚠️ Not Yet Protected (Will Be Denied)
- **HR** (`hr`, `employees`, `attendance`, `leave_requests`, `payroll`)
- **WhatsApp** (`whatsapp`, `whatsapp_messages`, `whatsapp_bot`)
- **Tools** (`tools`, `settings`)

**These modules will return 403 until policies are added.**

---

## Adding a New Module

### Step 1: Define Policies

Create policy file in `lib/policies/resources/`:

```typescript
// lib/policies/resources/my-module.ts
import { Policy } from '../types';
import { resourceBelongsToBusiness } from '../conditions';

export function getMyModulePolicies(): Policy[] {
  return [
    {
      resource: 'my_module',
      action: 'read',
      requiresPermission: 'my_module.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        // Add other conditions as needed
      ],
    },
    {
      resource: 'my_module',
      action: 'create',
      requiresPermission: 'my_module.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    // Add update, delete, etc.
  ];
}
```

### Step 2: Register Policies

Add to `lib/policies/registry.ts`:

```typescript
// Register my-module policies
const { getMyModulePolicies } = require('./resources/my-module');
const myModulePolicies = getMyModulePolicies();
myModulePolicies.forEach(policy => {
  this.registerPolicy(policy);
});
```

### Step 3: Use in Routes

In your API route:

```typescript
import { authorize, AuthorizationError } from '@/lib/authorization';

export async function GET(request: NextRequest) {
  const userId = searchParams.get('user_id');
  const businessId = searchParams.get('business_id');
  
  if (!userId) {
    return NextResponse.json(
      { error: 'user_id is required for authorization' },
      { status: 400 }
    );
  }
  
  // PBAC authorization (will fail if no policy exists)
  try {
    await authorize(userId, 'my_module', 'read', {
      businessId,
      resource: { business_id: businessId },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(error.toResponse(), { status: error.statusCode });
    }
    throw error;
  }
  
  // Your route logic here...
}
```

### Step 4: Test

Run the validator:

```bash
npm run validate:pbac
```

This ensures your policies are properly registered.

---

## Error Handling

### Error Response

When access is denied due to missing policy:

```json
{
  "error": "Access denied: No policy defined for resource 'my_module' action 'read'",
  "code": "NO_POLICY_DEFINED",
  "details": {
    "resource": "my_module",
    "action": "read",
    "message": "This resource/action combination requires a PBAC policy to be defined. Contact system administrator."
  }
}
```

**HTTP Status**: `403 Forbidden`

---

## Build-Time Validation

A validator script ensures policies exist before deployment:

```bash
npm run validate:pbac
```

### What It Checks

1. ✅ All `authorize()` calls have corresponding policies
2. ✅ All write routes (POST, PATCH, PUT, DELETE) call `authorize()`
3. ✅ No routes call `authorize()` without policies (unless explicitly unprotected)

### CI/CD Integration

Add to your CI pipeline:

```yaml
# .github/workflows/ci.yml
- name: Validate PBAC Policies
  run: npm run validate:pbac
```

---

## Migration Guide

### For Existing Modules

If you have an existing module that needs protection:

1. **Create policies** following the pattern above
2. **Register policies** in the registry
3. **Test thoroughly** with the validator
4. **Deploy** - default-deny will enforce policies

### For New Modules

Always:
1. ✅ Create policies **before** adding `authorize()` calls
2. ✅ Register policies in the registry
3. ✅ Run validator before committing
4. ✅ Test with default-deny enabled

---

## Troubleshooting

### Issue: Route returns 403 with "NO_POLICY_DEFINED"

**Solution**: Add a PBAC policy for the resource/action.

```typescript
// Check what resource/action you're using
await authorize(userId, 'my_module', 'read', ...);

// Ensure this policy exists:
{
  resource: 'my_module',
  action: 'read',
  // ...
}
```

### Issue: Need temporary rollback

**Emergency only**: Set `PBAC_DEFAULT_DENY=false` in `.env`

⚠️ **This disables security** - only use during emergency migration.

---

## Testing

### Manual Test

```typescript
// This should work (has policy)
await authorize(userId, 'invoice', 'read', { businessId });

// This should fail (no policy for 'hr')
await authorize(userId, 'hr', 'read', { businessId });
// Throws: AuthorizationError with code 'NO_POLICY_DEFINED'
```

### Automated Test

See `tests/pbac/default-deny.test.ts`

---

## Security Implications

### ✅ Benefits

- **Secure-by-default**: No accidental exposure of unprotected resources
- **Explicit policy requirement**: Forces developers to think about security
- **Audit trail**: All protected resources have documented policies
- **Prevents regressions**: CI validation catches missing policies

### ⚠️ Considerations

- **Breaking change**: Existing routes without policies will fail
- **Migration required**: All new modules must have policies
- **Development overhead**: Must define policies for all resources

---

## Best Practices

1. **Always define policies** before using `authorize()`
2. **Run validator** before committing
3. **Test with default-deny enabled** in development
4. **Never set `PBAC_DEFAULT_DENY=false`** in production
5. **Document policies** in code comments

---

## Support

For questions or issues:
1. Check this documentation
2. Review existing policy examples in `lib/policies/resources/`
3. Run validator to identify missing policies
4. Contact system administrator

---

**Last Updated**: 2024
**Status**: ✅ Active (Default-Deny Enabled)
