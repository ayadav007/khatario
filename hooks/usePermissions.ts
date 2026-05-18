import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export type PermissionAction = 'view' | 'add' | 'modify' | 'delete' | 'share';

interface ModulePermissions {
  can_view: boolean;
  can_add: boolean;
  can_modify: boolean;
  can_delete: boolean;
  can_share: boolean;
}

interface UserPermissions {
  [moduleKey: string]: ModulePermissions;
}

/**
 * Canonical Module Map
 * Maps alias module keys to their canonical (database) module keys.
 * 
 * This ensures UI permission checks work correctly when using aliases
 * introduced in migration 127 (e.g., payroll, leave_requests, hr, report.*).
 * 
 * RBAC permissions are stored using canonical keys in permission_modules table.
 * 
 * NOTE: This hook is for RBAC permission API normalization. For capability checks
 * (permissions + features), use useCapability which uses lib/capability-normalizer.ts
 */
const CANONICAL_MODULE_MAP: Record<string, string> = {
  'hr': 'employees',
  'leave_requests': 'leaves',
  'report': 'reports',
  'report.financial': 'reports',
  'report.gst': 'reports',
  'report.inventory': 'reports',
  // Note: payroll intentionally maps to 'employees' because PBAC policies
  // use employees.read/update for payroll operations
  'payroll': 'employees',
};

/**
 * Resolves a module key to its canonical form.
 * If the key is an alias, returns the canonical key.
 * Otherwise, returns the key as-is.
 * Does NOT log warnings (warnings are logged during object normalization).
 */
function resolveCanonicalModule(moduleKey: string): string {
  return CANONICAL_MODULE_MAP[moduleKey] || moduleKey;
}

/**
 * Normalizes the permissions object by resolving all aliases to canonical module keys.
 * 
 * This ensures that:
 * - Alias modules (leave_requests, payroll, hr) are merged into canonical modules (leaves, employees)
 * - Canonical modules exist in the permissions object even if API only returned aliases
 * - Permissions from multiple aliases are merged using OR logic
 * 
 * Example:
 * Input: { leave_requests: { can_view: true }, payroll: { can_view: true } }
 * Output: { leaves: { can_view: true }, employees: { can_view: true } }
 */
function normalizePermissionObject(rawPermissions: UserPermissions): {
  normalized: UserPermissions;
  hasAliases: boolean;
} {
  const normalized: UserPermissions = {};
  let hasAliases = false;
  
  for (const [moduleKey, modulePerms] of Object.entries(rawPermissions)) {
    const canonicalKey = resolveCanonicalModule(moduleKey);
    
    // Track if we encountered any aliases
    if (canonicalKey !== moduleKey) {
      hasAliases = true;
    }
    
    // If canonical key already exists, merge permissions (OR logic)
    if (normalized[canonicalKey]) {
      normalized[canonicalKey] = {
        can_view: normalized[canonicalKey].can_view || modulePerms.can_view || false,
        can_add: normalized[canonicalKey].can_add || modulePerms.can_add || false,
        can_modify: normalized[canonicalKey].can_modify || modulePerms.can_modify || false,
        can_delete: normalized[canonicalKey].can_delete || modulePerms.can_delete || false,
        can_share: normalized[canonicalKey].can_share || modulePerms.can_share || false,
      };
    } else {
      // First occurrence of this canonical key, use permissions as-is
      normalized[canonicalKey] = { ...modulePerms };
    }
  }
  
  return { normalized, hasAliases };
}

/**
 * Normalizes permissions so that create/update/delete/export implicitly grant read permission.
 * This is a semantic normalization - read is derived, not stored.
 * 
 * Rules:
 * - read → read
 * - create → create, read (implicit)
 * - update → update, read (implicit)
 * - delete → delete, read (implicit)
 * - export → export, read (implicit)
 * 
 * No reverse implication: read does NOT grant create/update/delete/export
 */
function normalizePermissions(rawPermissions: UserPermissions): UserPermissions {
  const normalized: UserPermissions = {};
  
  for (const [moduleKey, modulePerms] of Object.entries(rawPermissions)) {
    // If user has any write-level permission, they implicitly have read
    const hasImplicitRead = 
      modulePerms.can_add || 
      modulePerms.can_modify || 
      modulePerms.can_delete || 
      modulePerms.can_share;
    
    normalized[moduleKey] = {
      ...modulePerms,
      // Read is either explicitly granted OR implicitly granted by write permissions
      can_view: modulePerms.can_view || hasImplicitRead,
    };
  }
  
  return normalized;
}

// Track if we've already warned about aliases in this session
let aliasWarningLogged = false;

export function usePermissions() {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<UserPermissions>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.id) {
      fetchPermissions();
    } else {
      setLoading(false);
    }
  }, [user?.id]);

  const fetchPermissions = async () => {
    if (!user?.id) return;

    try {
      const res = await fetch(`/api/settings/permissions?user_id=${user.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        const rawPermissions = data.permissions || {};
        const apiIsPrimaryAdmin = data.isPrimaryAdmin === true;
        
        // STEP 1: Normalize permission object (alias → canonical, merge)
        const { normalized: normalizedObject, hasAliases } = normalizePermissionObject(rawPermissions);
        
        // STEP 2: Normalize permissions (create/update/delete/export → read implicit)
        const normalized = normalizePermissions(normalizedObject);

        // STEP 3: Log warning once per session if aliases were encountered
        if (hasAliases && !aliasWarningLogged) {
          console.warn(
            `[usePermissions] Alias modules detected in API response. ` +
            `These have been normalized to canonical modules. ` +
            `Consider updating API to return canonical modules directly.`
          );
          aliasWarningLogged = true;
        }

        setPermissions(normalized);
      } else {
        setPermissions({});
      }
    } catch (error) {
      console.error('Failed to fetch permissions:', error);
      setPermissions({});
    } finally {
      setLoading(false);
    }
  };

  const hasPermission = (module: string, action: PermissionAction): boolean => {
    // Resolve alias to canonical module key (simple resolution, no logging)
    const canonicalModule = resolveCanonicalModule(module);
    
    // Check permissions using canonical module key
    // Since we normalize the permissions object, canonical keys always exist if any alias exists
    const modulePermissions = permissions[canonicalModule];
    if (!modulePermissions) {
      return false;
    }

    return modulePermissions[`can_${action}`] || false;
  };

  const canView = (module: string) => hasPermission(module, 'view');
  const canAdd = (module: string) => hasPermission(module, 'add');
  const canModify = (module: string) => hasPermission(module, 'modify');
  const canDelete = (module: string) => hasPermission(module, 'delete');
  const canShare = (module: string) => hasPermission(module, 'share');

  const isPrimaryAdmin = Boolean(user?.is_primary_admin) || false;

  return {
    permissions,
    loading,
    hasPermission,
    canView,
    canAdd,
    canModify,
    canDelete,
    canShare,
    isPrimaryAdmin,
  };
}

