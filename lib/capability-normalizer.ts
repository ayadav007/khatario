/**
 * CAPABILITY NORMALIZER
 * 
 * Single source of truth for permission modules, feature keys, and action names.
 * All capability checks must go through this normalizer to ensure consistency
 * between offline snapshots, API responses, and UI components.
 * 
 * ARCHITECTURE:
 * 1. Permission Modules → Database canonical names (permissions table)
 * 2. Feature Keys → Feature Registry IDs (snapshot.enabledFeatures)
 * 3. Actions → Database canonical names (read/create/update/delete/export)
 */

// ============================================================================
// PERMISSION MODULES (Database Canonical)
// ============================================================================

/**
 * Canonical permission modules from database schema.
 * These are the ONLY valid permission module names.
 * Source: database/migrations/permissions table
 */
export const PERMISSION_MODULES = [
  'dashboard',
  'invoices',
  'credit_notes',
  'debit_notes',
  'customers',
  'purchases',
  'purchase_returns',
  'suppliers',
  'items',
  'payments',
  'reports',
  'settings',
  'employees',
  'attendance',
  'commissions',
  'leaves',
  'expenses',
  'warehouses',
  'work_orders',
] as const;

export type PermissionModule = typeof PERMISSION_MODULES[number];

// ============================================================================
// FEATURE REGISTRY IDS (Subscription Feature Registry)
// ============================================================================

/**
 * Feature Registry IDs used in snapshot.enabledFeatures.
 * These are the ONLY valid feature IDs stored in the capability snapshot.
 * Source: lib/subscription/feature-access.ts
 */
export const FEATURE_REGISTRY_IDS = [
  // Sales domain (Registry IDs)
  'sales_invoices',
  'sales_estimates',
  'sales_credit_notes',
  'sales_debit_notes',
  'sales_recurring_invoices',
  'sales_sales_orders',
  
  // Purchase domain (Registry IDs)
  'purchase_management',
  'purchase_suppliers',
  'purchase_expenses',
  'purchase_orders',
  
  // Inventory domain (Registry IDs)
  'item_management',
  'stock_tracking',
  'purchase_inventory_adjustments',
  'barcode_label_printing',
  'barcode_label_from_purchase',
  'barcode_label_templates',
  'barcode_thermal_printer',
  'barcode_weight_embedded',
  
  // Reports domain (Registry IDs)
  'reports_basic',
  'reports_gst',
  'reports_advanced',
  'reports_analytics',
  
  // Invoicing & Templates (Registry IDs)
  'template_basic',
  'template_all',
  'template_thermal',
  'template_customization',
  'pdf_generation',
  
  // Accounting (Registry IDs)
  'payment_tracking',
  'ledger_accounting',
  'payment_gateway',
  
  // Alerts & Automation (Registry IDs)
  'alert_low_stock',
  'alert_credit_limit',
  'recurring_invoices',
  
  // Integrations (Registry IDs)
  'whatsapp_manual',
  'whatsapp_auto_reminders',
  'whatsapp_credit_alerts',
  'integration_whatsapp_bot',
  'whatsapp_send_message',
  'email_reminders',
  'email_invoicing',
  'api_access',
  
  // Settings (Registry IDs)
  'settings_multi_user',
  'settings_multi_branch',
  'settings_multi_warehouse',
  'settings_backup',
  'settings_pos_mode',
  
  // Advanced (Registry IDs)
  'online_store',
  'barcode_scanning',
  'multi_currency',
  'custom_branding',
  
  // Core (Registry IDs)
  'dashboard_analytics',
  'customer_management',

  // Dashboard widgets (Registry IDs)
  'dead_stock_widget',

  // Tools (Registry IDs)
  'tools_todo',

  // HR (Registry IDs) — must match platform_features hr_* keys
  'hr_employees',
  'hr_attendance',
  'hr_payroll',
  'hr_leaves',
] as const;

export type FeatureRegistryId = typeof FEATURE_REGISTRY_IDS[number];

// ============================================================================
// CANONICAL FEATURE KEYS (featureKeys.ts)
// ============================================================================

/**
 * Canonical feature keys from featureKeys.ts.
 * These are used in code but must be mapped to Feature Registry IDs.
 */
export const CANONICAL_FEATURE_KEYS = [
  'invoice_creation',
  'customer_management',
  'estimates_quotations',
  'credit_notes',
  'debit_notes',
  'recurring_invoices',
  'sales_orders',
  'purchase_management',
  'supplier_management',
  'expense_tracking',
  'purchase_orders',
  'item_management',
  'stock_tracking',
  'inventory_adjustments',
  'alert_low_stock',
  'barcode_label_printing',
  'barcode_label_from_purchase',
  'barcode_label_templates',
  'barcode_thermal_printer',
  'barcode_weight_embedded',
  'reports_basic',
  'reports_gst',
  'reports_advanced',
  'reports_analytics',
  'template_basic',
  'template_all',
  'template_thermal',
  'template_customization',
  'pdf_generation',
  'payment_tracking',
  'ledger_accounting',
  'payment_gateway',
  'alert_credit_limit',
  'whatsapp_manual',
  'whatsapp_auto_reminders',
  'whatsapp_bot',
  'whatsapp_send_message',
  'email_invoicing',
  'api_access',
  'multi_user',
  'multi_branch',
  'multi_warehouse',
  'backup_restore',
  'pos_mode',
  'online_store',
  'barcode_scanning',
  'multi_currency',
  'custom_branding',
  'dashboard_analytics',
  'dead_stock_widget',
  'todo',
] as const;

export type CanonicalFeatureKey = typeof CANONICAL_FEATURE_KEYS[number];

// ============================================================================
// PERMISSION ACTIONS (Database Canonical)
// ============================================================================

/**
 * Canonical permission actions from database schema.
 * Source: database/migrations/permissions table
 */
export const PERMISSION_ACTIONS = ['read', 'create', 'update', 'delete', 'export'] as const;

export type PermissionAction = typeof PERMISSION_ACTIONS[number];

// ============================================================================
// MODULE ALIAS MAPPING
// ============================================================================

/**
 * Maps alias module names to canonical permission modules.
 * All aliases used in pages/components must be defined here.
 */
export const MODULE_ALIAS_MAP: Record<string, PermissionModule> = {
  // HR aliases
  'leave_requests': 'leaves',
  'payroll': 'employees',
  'hr': 'employees',
  
  // Report aliases
  'report': 'reports',
  'report.financial': 'reports',
  'report.gst': 'reports',
  'report.inventory': 'reports',
  
  // Non-existent modules mapped to existing
  'purchase_orders': 'purchases',
  'journal': 'settings',
  'inventory_adjustments': 'items',
  'warehouse_transfer': 'warehouses',
  'sales_sales_orders': 'invoices', // Feature key mistakenly used as module
};

// ============================================================================
// FEATURE ALIAS MAPPING
// ============================================================================

/**
 * Maps canonical feature keys and legacy aliases to Feature Registry IDs.
 * This is the authoritative mapping for feature checks.
 */
export const FEATURE_ALIAS_MAP: Record<string, FeatureRegistryId> = {
  // Canonical → Registry ID mappings
  'invoice_creation': 'sales_invoices',
  'invoices': 'sales_invoices',
  'purchase_management': 'purchase_management',
  'purchases': 'purchase_management',
  'estimates_quotations': 'sales_estimates',
  'credit_notes': 'sales_credit_notes',
  'debit_notes': 'sales_debit_notes',
  'recurring_invoices': 'sales_recurring_invoices',
  'sales_orders': 'sales_sales_orders',
  'supplier_management': 'purchase_suppliers',
  'expense_tracking': 'purchase_expenses',
  'inventory_adjustments': 'purchase_inventory_adjustments',
  'multi_user': 'settings_multi_user',
  'multi_branch': 'settings_multi_branch',
  'multi_warehouse': 'settings_multi_warehouse',
  'backup_restore': 'settings_backup',
  'pos_mode': 'settings_pos_mode',
  'template_customization': 'template_customization',
  'whatsapp_bot': 'integration_whatsapp_bot',
  'whatsapp_manual': 'whatsapp_manual',
  'todo': 'tools_todo',
  
  // Legacy aliases
  'quotations': 'sales_estimates',
  'estimates': 'sales_estimates',
  'sales_credit_notes': 'sales_credit_notes',
  'sales_debit_notes': 'sales_debit_notes',
  'sales_recurring_invoices': 'sales_recurring_invoices',
  'sales_sales_orders': 'sales_sales_orders',
  'purchase_suppliers': 'purchase_suppliers',
  'purchase_expenses': 'purchase_expenses',
  'settings_multi_user': 'settings_multi_user',
  'settings_multi_branch': 'settings_multi_branch',
  'settings_multi_warehouse': 'settings_multi_warehouse',
  'settings_backup': 'settings_backup',
  'settings_template_customization': 'template_customization',
  'integration_whatsapp_bot': 'integration_whatsapp_bot',
  'integration_whatsapp_manual': 'whatsapp_manual',
  'tools_todo': 'tools_todo',
  'whatsapp_send_message': 'whatsapp_send_message',

  'hr_employees': 'hr_employees',
  'hr_attendance': 'hr_attendance',
  'hr_payroll': 'hr_payroll',
  'hr_leaves': 'hr_leaves',
};

// ============================================================================
// ACTION ALIAS MAPPING
// ============================================================================

/**
 * Maps UI action names to database canonical actions.
 */
export const ACTION_ALIAS_MAP: Record<string, PermissionAction> = {
  'view': 'read',
  'add': 'create',
  'modify': 'update',
  'share': 'export',
  'finalize': 'update',
  'cancel': 'update',
};

// ============================================================================
// NORMALIZATION FUNCTIONS
// ============================================================================

/**
 * Normalize a module name to canonical permission module.
 * 
 * @param resource - Module name (may be alias or canonical)
 * @returns Canonical permission module name
 * 
 * @example
 * normalizeModule('leave_requests') // Returns 'leaves'
 * normalizeModule('payroll') // Returns 'employees'
 * normalizeModule('invoices') // Returns 'invoices'
 */
export function normalizeModule(resource: string): PermissionModule {
  // Check if it's already canonical
  if (PERMISSION_MODULES.includes(resource as PermissionModule)) {
    return resource as PermissionModule;
  }
  
  // Check alias map
  const canonical = MODULE_ALIAS_MAP[resource];
  if (canonical) {
    return canonical;
  }
  
  // Unknown module - warn and return as-is (with type assertion)
  if (typeof console !== 'undefined') {
    console.warn(
      `[CapabilityNormalizer] Unknown permission module: "${resource}". ` +
      `Valid modules: ${PERMISSION_MODULES.join(', ')}`
    );
  }
  
  // Return as-is but cast to type (will fail permission check gracefully)
  return resource as PermissionModule;
}

/**
 * Normalize a feature key to Feature Registry ID.
 * 
 * @param featureKey - Feature key (may be canonical, registry ID, or alias)
 * @returns Feature Registry ID
 * 
 * @example
 * normalizeFeature('invoice_creation') // Returns 'sales_invoices'
 * normalizeFeature('estimates_quotations') // Returns 'sales_estimates'
 * normalizeFeature('sales_invoices') // Returns 'sales_invoices'
 */
export function normalizeFeature(featureKey: string): FeatureRegistryId {
  // Check if it's already a registry ID
  if (FEATURE_REGISTRY_IDS.includes(featureKey as FeatureRegistryId)) {
    return featureKey as FeatureRegistryId;
  }
  
  // Check alias map
  const registryId = FEATURE_ALIAS_MAP[featureKey];
  if (registryId) {
    return registryId;
  }
  
  // Unknown feature - warn and return as-is
  if (typeof console !== 'undefined') {
    console.warn(
      `[CapabilityNormalizer] Unknown feature key: "${featureKey}". ` +
      `This feature may not be recognized in capability checks.`
    );
  }
  
  // Return as-is but cast to type (will fail feature check gracefully)
  return featureKey as FeatureRegistryId;
}

/**
 * Normalize an action name to canonical permission action.
 * 
 * @param action - Action name (may be UI alias or canonical)
 * @returns Canonical permission action
 * 
 * @example
 * normalizeAction('view') // Returns 'read'
 * normalizeAction('add') // Returns 'create'
 * normalizeAction('read') // Returns 'read'
 */
export function normalizeAction(action: string): PermissionAction {
  // Check if it's already canonical
  if (PERMISSION_ACTIONS.includes(action as PermissionAction)) {
    return action as PermissionAction;
  }
  
  // Check alias map
  const canonical = ACTION_ALIAS_MAP[action];
  if (canonical) {
    return canonical;
  }
  
  // Unknown action - warn and default to 'read'
  if (typeof console !== 'undefined') {
    console.warn(
      `[CapabilityNormalizer] Unknown action: "${action}". ` +
      `Valid actions: ${PERMISSION_ACTIONS.join(', ')}. Defaulting to 'read'.`
    );
  }
  
  return 'read';
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Check if a module is a valid canonical permission module.
 */
export function isValidModule(module: string): module is PermissionModule {
  return PERMISSION_MODULES.includes(module as PermissionModule);
}

/**
 * Check if a feature is a valid Feature Registry ID.
 */
export function isValidFeature(feature: string): feature is FeatureRegistryId {
  return FEATURE_REGISTRY_IDS.includes(feature as FeatureRegistryId);
}

/**
 * Check if an action is a valid canonical permission action.
 */
export function isValidAction(action: string): action is PermissionAction {
  return PERMISSION_ACTIONS.includes(action as PermissionAction);
}

/**
 * Get all aliases for a canonical module.
 */
export function getModuleAliases(canonicalModule: PermissionModule): string[] {
  return Object.entries(MODULE_ALIAS_MAP)
    .filter(([, canonical]) => canonical === canonicalModule)
    .map(([alias]) => alias);
}

/**
 * Get all aliases for a Feature Registry ID.
 */
export function getFeatureAliases(registryId: FeatureRegistryId): string[] {
  return Object.entries(FEATURE_ALIAS_MAP)
    .filter(([, id]) => id === registryId)
    .map(([alias]) => alias);
}
