/** Human-readable names for backend `feature` keys (403 FEATURE_NOT_IN_PLAN). */

const LABELS: Record<string, string> = {
  template_customization: 'Template customization',
  recurring_invoices: 'Recurring invoices',
  email_invoicing: 'Email invoicing',
  estimates_quotations: 'Estimates and quotations',
  credit_notes: 'Credit notes',
  debit_notes: 'Debit notes',
  multi_branch: 'Multi-branch',
  multi_warehouse: 'Multi-warehouse',
  purchase_management: 'Purchase management',
  expense_tracking: 'Expense tracking',
  supplier_management: 'Supplier management',
  purchase_supplier_hub: 'Supplier Hub',
  reports_basic: 'Basic reports',
  reports_gst: 'GST reports',
  reports_advanced: 'Advanced reports',
  backup_restore: 'Backup and restore',
  customizable_dashboard: 'Customizable dashboard',
  dead_stock_widget: 'Dead stock insights',
  party_pricing: 'Party-wise pricing',
  whatsapp_auto_reminders: 'WhatsApp auto reminders',
  barcode_label_printing: 'Barcode label printing',
  items_scan_onboarding: 'Scan and add items',
  barcode_label_from_purchase: 'Labels from purchase',
  barcode_thermal_printer: 'Thermal printing',
  report_builder: 'Custom report builder',
  settings_backup: 'Backup and restore',
  settings_document_language: 'Print language',
  soft_delete: 'Recycle bin restore',
  // Registry ids the server sends in `feature` on 403s.
  eway_bill: 'E-way bills',
  integration_email: 'Email invoices',
  profit_reports_basic: 'Profit by invoice',
  profit_invoice: 'Profit on every bill',
  settings_multi_business: 'More than one business',
  multi_business: 'More than one business',
  advanced_multi_currency: 'Foreign currency bills',
  multi_currency: 'Foreign currency bills',
  settings_multi_warehouse: 'Warehouses',
  settings_multi_branch: 'Branches',
  settings_multi_user: 'More users',
  settings_template_customization: 'Template customisation',
  settings_pos_mode: 'POS mode',
  sales_invoices: 'Invoices',
  sales_estimates: 'Estimates',
  sales_credit_notes: 'Credit notes',
  sales_debit_notes: 'Debit notes',
  sales_delivery_challans: 'Delivery challans',
  sales_recurring_invoices: 'Recurring invoices',
  sales_sales_orders: 'Sales orders',
  sales_work_orders: 'Work orders',
  purchase_orders: 'Purchase orders',
  purchase_expenses: 'Expenses',
  purchase_suppliers: 'Suppliers',
  purchase_inventory_adjustments: 'Stock adjustments',
  advanced_ledger: 'Ledger',
  accounting_chart: 'Chart of accounts',
  accounting_bank: 'Bank accounts',
  accounting_tds: 'TDS',
  accounting_budgets: 'Budgets',
  accounting_provisions: 'Provisions',
  accounting_credit_approvals: 'Credit approvals',
  advanced_online_store: 'Online store',
  advanced_custom_branding: 'Your own branding on bills',
  advanced_barcode: 'Barcode scanning',
  barcode_label_templates: 'Label templates',
  integration_whatsapp_bot: 'WhatsApp inbox',
  integration_whatsapp_manual: 'WhatsApp messages',
  settings_whatsapp: 'WhatsApp settings',
  workflow_automation: 'Automation',
  period_lock: 'Period lock',
  web_access: 'Khatario on a computer',
  tools_todo: 'To-dos',
  hr_attendance: 'Staff attendance',
  hr_payroll: 'Payroll',
  hr_leaves: 'Leave',
  hr_shifts: 'Shifts',
  hr_recruitment: 'Hiring',
  hr_employee_portal: 'Employee portal',
  hr_staff_app: 'Staff app',
};

/**
 * Benefit-first copy keyed by canonical `feature` from API denial responses.
 * Shown in the upgrade modal (see UpgradePrompt feature flow).
 */
export const FEATURE_UPGRADE_PITCH_MAP: Record<string, string> = {
  party_pricing: 'Set custom prices for each customer',
  soft_delete: 'Restore accidentally deleted transactions',
  profit_invoice: 'See profit on every invoice',
};

/**
 * Where the user was in the product when the upgrade prompt is shown.
 * Extend as new surfaces need tailored copy; unknown values are ignored for pitch selection.
 */
export type FeatureUpgradePitchContext =
  | 'invoice_delete'
  | 'invoice_item_selection'
  | (string & {});

/**
 * Composite key: `${featureKey}:${context}` → conversion line when context is set.
 * If no entry exists, {@link getFeatureUpgradePitch} falls back to feature-only / default behavior.
 */
export const FEATURE_CONTEXTUAL_UPGRADE_PITCH_MAP: Record<string, string> = {
  'soft_delete:invoice_delete':
    'You just deleted a transaction. Restore it instantly when you upgrade.',
  'party_pricing:invoice_item_selection':
    'Automatically apply customer-specific pricing when creating invoices.',
};

/** Fallback when the key has no bespoke line (still scannable vs empty). */
const UNKNOWN_FEATURE_FALLBACK_DESCRIPTION =
  'Move to a plan that includes this capability and keep your workflow moving.';

/** True when the key has a hand-written name (worth listing as a plan benefit). */
export function hasFeatureLabel(featureKey: string): boolean {
  return Boolean(LABELS[featureKey.trim()]);
}

/**
 * Readable title for an API `feature` key; used by the global upgrade modal.
 */
export function getFeatureDisplayName(featureKey?: string): string {
  if (!featureKey?.trim()) return 'This feature';
  const normalized = featureKey.trim();
  if (LABELS[normalized]) return LABELS[normalized];
  const words = normalized.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function compositePitchKey(
  featureKey: string,
  context: string
): `${string}:${string}` {
  return `${featureKey}:${context}`;
}

/**
 * Short conversion-focused sentence for modal body copy (global + embedded prompts).
 *
 * When `context` is omitted or has no matching composite entry, behavior matches the
 * original single-argument implementation (feature map → `Unlock {name}` → global fallback).
 */
export function getFeatureUpgradePitch(
  featureKey?: string,
  context?: FeatureUpgradePitchContext
): string {
  const k = featureKey?.trim();
  const ctx = typeof context === 'string' ? context.trim() : '';

  if (k && ctx) {
    const composite = compositePitchKey(k, ctx);
    const contextual = FEATURE_CONTEXTUAL_UPGRADE_PITCH_MAP[composite];
    if (contextual) return contextual;
  }

  if (k && FEATURE_UPGRADE_PITCH_MAP[k]) return FEATURE_UPGRADE_PITCH_MAP[k];
  if (k) return `Unlock ${getFeatureDisplayName(k)}`;
  return UNKNOWN_FEATURE_FALLBACK_DESCRIPTION;
}
