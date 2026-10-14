/// Port of `lib/capability-eval.ts` with the tables it reads from `lib/capability-normalizer.ts`
/// and `lib/hr-plan-features.ts`. UX only: the server still authorizes every request.
library;

const _featureRegistryIds = {
  'sales_invoices', 'sales_estimates', 'sales_credit_notes', 'sales_debit_notes', 'sales_recurring_invoices',
  'sales_sales_orders',
  'purchase_management', 'purchase_suppliers', 'purchase_expenses', 'purchase_orders',
  'item_management', 'stock_tracking', 'purchase_inventory_adjustments', 'barcode_label_printing',
  'barcode_label_from_purchase', 'barcode_label_templates', 'barcode_thermal_printer', 'barcode_weight_embedded',
  'reports_basic', 'reports_gst', 'reports_advanced', 'reports_analytics',
  'template_basic', 'template_all', 'template_thermal', 'template_customization', 'pdf_generation',
  'payment_tracking', 'ledger_accounting', 'payment_gateway',
  'alert_low_stock', 'alert_credit_limit', 'recurring_invoices',
  'whatsapp_manual', 'whatsapp_auto_reminders', 'whatsapp_credit_alerts', 'integration_whatsapp_bot',
  'whatsapp_send_message', 'email_reminders', 'email_invoicing', 'api_access',
  'settings_multi_user', 'settings_multi_branch', 'settings_multi_warehouse', 'settings_multi_business',
  'settings_backup', 'settings_pos_mode', 'settings_document_language',
  'online_store', 'barcode_scanning', 'multi_currency', 'custom_branding',
  'dashboard_analytics', 'customer_management',
  'dead_stock_widget',
  'tools_todo',
  'hr_employees', 'hr_attendance', 'hr_payroll', 'hr_leaves',
  'sales_delivery_challans', 'sales_work_orders', 'sales_new_invoice', 'eway_bill', 'e_invoice',
  'advanced_online_store', 'advanced_multi_currency', 'advanced_barcode', 'advanced_custom_branding',
  'advanced_ledger', 'workflow_automation', 'settings_multidevice_login', 'report_builder', 'party_pricing',
  'accounting_bank', 'accounting_tds', 'accounting_provisions', 'accounting_credit_approvals',
  'accounting_budgets', 'accounting_chart',
};

const _permissionModules = {
  'dashboard', 'invoices', 'credit_notes', 'debit_notes', 'customers', 'purchases', 'purchase_returns',
  'suppliers', 'items', 'payments', 'reports', 'settings', 'employees', 'attendance', 'commissions', 'leaves',
  'expenses', 'warehouses', 'work_orders',
};

const _moduleAliasMap = {
  'leave_requests': 'leaves',
  'payroll': 'employees',
  'hr': 'employees',
  'report': 'reports',
  'report.financial': 'reports',
  'report.gst': 'reports',
  'report.inventory': 'reports',
  'purchase_orders': 'purchases',
  'journal': 'settings',
  'inventory_adjustments': 'items',
  'warehouse_transfer': 'warehouses',
  'sales_sales_orders': 'invoices',
};

const _featureAliasMap = {
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
  'multi_business': 'settings_multi_business',
  'backup_restore': 'settings_backup',
  'pos_mode': 'settings_pos_mode',
  'template_customization': 'template_customization',
  'whatsapp_bot': 'integration_whatsapp_bot',
  'whatsapp_manual': 'whatsapp_manual',
  'todo': 'tools_todo',
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
  'settings_multi_business': 'settings_multi_business',
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
  'online_store': 'advanced_online_store',
  'advanced_online_store': 'advanced_online_store',
  'multi_currency': 'advanced_multi_currency',
  'advanced_multi_currency': 'advanced_multi_currency',
  'barcode_scanning': 'advanced_barcode',
  'advanced_barcode': 'advanced_barcode',
  'custom_branding': 'advanced_custom_branding',
  'ledger_accounting': 'advanced_ledger',
  'advanced_ledger': 'advanced_ledger',
  'workflow_automation': 'workflow_automation',
  'sales_delivery_challans': 'sales_delivery_challans',
  'sales_work_orders': 'sales_work_orders',
  'eway_bill': 'eway_bill',
  'e_invoice': 'e_invoice',
  'accounting_bank': 'accounting_bank',
  'accounting_tds': 'accounting_tds',
  'accounting_provisions': 'accounting_provisions',
  'accounting_credit_approvals': 'accounting_credit_approvals',
  'accounting_budgets': 'accounting_budgets',
  'accounting_chart': 'accounting_chart',
};

const _actionAliasMap = {
  'view': 'read',
  'add': 'create',
  'modify': 'update',
  'share': 'export',
  'finalize': 'update',
  'cancel': 'update',
};

const _actionFlags = {
  'read': ['can_view', 'can_read'],
  'create': ['can_add', 'can_create'],
  'update': ['can_modify', 'can_update'],
  'delete': ['can_delete'],
  'export': ['can_share', 'can_export'],
};

const _serverPermissionModuleMap = {
  'inventory_adjustment': 'items',
  'inventory_adjustments': 'items',
  'warehouse': 'warehouses',
  'warehouse_transfers': 'warehouse_transfer',
  'stock_transfer': 'warehouse_transfer',
  'stock_transfers': 'warehouse_transfer',
  'report': 'reports',
  'report.financial': 'reports',
  'report.inventory': 'reports',
  'report.gst': 'reports',
  'hr': 'employees',
};

const _serverRbacAliases = {
  'leave_requests': ['leaves'],
  'leaves': ['leave_requests'],
  'hr': ['employees'],
  'employees': ['hr'],
  'payroll': ['employees'],
};

const _extraRbacModuleKeys = {
  'tools', 'payment_reversals', 'warehouse_transfer', 'inventory_adjustment', 'journal', 'accounting_period',
  'leave_requests', 'payroll', 'recruitment', 'hr', 'whatsapp', 'whatsapp_inbox', 'whatsapp_inbox_supervise',
};

const _hrAuthModuleToFeature = {
  'employees': 'hr_employees',
  'payroll': 'hr_payroll',
  'attendance': 'hr_attendance',
  'leaves': 'hr_leaves',
  'leave_requests': 'hr_leaves',
  'commissions': 'hr_employees',
  'recruitment': 'hr_employees',
};

const _hrRegistryIds = {'hr_employees', 'hr_attendance', 'hr_payroll', 'hr_leaves', 'hr_employee_portal'};

String? _hrPlanFeatureForCapabilityCheck(String resource) =>
    _hrRegistryIds.contains(resource) ? resource : _hrAuthModuleToFeature[resource];

String? _planFeatureForModule(String resource) =>
    _featureAliasMap[resource] ?? (_featureRegistryIds.contains(resource) ? resource : null);

String _normalizeFeature(String key) =>
    _featureRegistryIds.contains(key) ? key : (_featureAliasMap[key] ?? key);

String _normalizeAction(String action) =>
    _actionFlags.containsKey(action) ? action : (_actionAliasMap[action] ?? 'read');

bool _isPermissionModule(String resource) =>
    _permissionModules.contains(resource) ||
    _extraRbacModuleKeys.contains(resource) ||
    _moduleAliasMap.containsKey(resource) ||
    _serverPermissionModuleMap.containsKey(resource);

/// `resolvePermissionModuleKeys`: role_permissions keys that may grant the resource, in order.
List<String> resolvePermissionModuleKeys(String resource) {
  if (!_isPermissionModule(resource)) return const [];
  final serverKey = _serverPermissionModuleMap[resource] ?? resource;
  final keys = <String>{
    resource,
    serverKey,
    ...?_serverRbacAliases[serverKey],
    ?_moduleAliasMap[resource],
  };
  return keys.where((k) => k.isNotEmpty).toList();
}

typedef CapabilityResult = ({bool allowed, String? denialReason});

/// The localStorage capability snapshot: `/api/settings/permissions` + `/api/features/enabled`.
class CapabilitySnapshot {
  const CapabilitySnapshot({required this.permissions, required this.isPrimaryAdmin, required this.enabledFeatures});

  final Map<String, Map<String, dynamic>> permissions;
  final bool isPrimaryAdmin;
  final List<String> enabledFeatures;
}

/// `useCapabilityCheck` for the signed-in user.
class Capabilities {
  const Capabilities({
    required this.sessionIsPrimaryAdmin,
    required this.sessionPermissions,
    required this.snapshot,
  });

  final bool sessionIsPrimaryAdmin;
  final Map<String, dynamic> sessionPermissions;
  final CapabilitySnapshot? snapshot;

  bool has(String resource, [String action = 'view']) => check(resource, action).allowed;

  /// `evaluateCapabilityAccess`. Indeterminate results count as not allowed with no reason.
  CapabilityResult check(String res, [String? action]) {
    final snap = snapshot;

    final hrPlanFeature = _hrPlanFeatureForCapabilityCheck(res);
    if (hrPlanFeature != null && !(snap?.enabledFeatures.contains(hrPlanFeature) ?? false)) {
      return (allowed: false, denialReason: 'FEATURE_NOT_IN_PLAN');
    }

    if (sessionIsPrimaryAdmin || (snap?.isPrimaryAdmin ?? false)) {
      final planFeature = _planFeatureForModule(res);
      if (planFeature != null && snap != null && !snap.enabledFeatures.contains(planFeature)) {
        return (allowed: false, denialReason: 'FEATURE_NOT_IN_PLAN');
      }
      return (allowed: true, denialReason: null);
    }

    final merged = <String, dynamic>{...sessionPermissions, ...?snap?.permissions};
    if (snap == null && merged.isEmpty) return (allowed: false, denialReason: null);

    final moduleKeys = resolvePermissionModuleKeys(res);
    if (moduleKeys.isNotEmpty) {
      final flags = _actionFlags[_normalizeAction(action ?? 'view')]!;
      final granted = moduleKeys.any((key) {
        final perms = merged[key];
        return perms is Map && flags.any((f) => perms[f] == true);
      });
      if (!granted) return (allowed: false, denialReason: 'PERMISSION_DENIED');
      final planFeature = _planFeatureForModule(res);
      if (planFeature != null && snap != null && !snap.enabledFeatures.contains(planFeature)) {
        return (allowed: false, denialReason: 'FEATURE_NOT_IN_PLAN');
      }
      return (allowed: true, denialReason: null);
    }

    final normalized = _normalizeFeature(res);
    final featureRegistryId = normalized == 'whatsapp_send_message' || normalized == 'whatsapp_manual'
        ? 'integration_whatsapp_manual'
        : normalized;
    if (snap?.enabledFeatures.contains(featureRegistryId) ?? false) return (allowed: true, denialReason: null);
    if (hrPlanFeature != null) return (allowed: false, denialReason: 'PERMISSION_DENIED');
    return (allowed: false, denialReason: 'FEATURE_NOT_IN_PLAN');
  }
}
