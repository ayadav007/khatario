/** Human-readable names for backend `feature` keys (403 FEATURE_NOT_IN_PLAN). */

const LABELS: Record<string, string> = {
  template_customization: 'Template customization',
  recurring_invoices: 'Recurring invoices',
  email_invoicing: 'Email invoicing',
  estimates_quotations: 'Estimates & quotations',
  credit_notes: 'Credit notes',
  debit_notes: 'Debit notes',
  multi_branch: 'Multi-branch',
  multi_warehouse: 'Multi-warehouse',
  purchase_management: 'Purchase management',
  expense_tracking: 'Expense tracking',
  supplier_management: 'Supplier management',
  reports_basic: 'Basic reports',
  reports_gst: 'GST reports',
  reports_advanced: 'Advanced reports',
  backup_restore: 'Backup & restore',
  customizable_dashboard: 'Customizable dashboard',
  dead_stock_widget: 'Dead stock insights',
  party_pricing: 'Party-wise pricing',
  whatsapp_auto_reminders: 'WhatsApp auto reminders',
  barcode_label_printing: 'Barcode label printing',
  barcode_label_from_purchase: 'Labels from purchase',
  barcode_thermal_printer: 'Thermal printing',
  report_builder: 'Custom report builder',
  settings_backup: 'Backup & restore',
  soft_delete: 'Recycle bin restore',
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

/**
 * Readable title for an API `feature` key; used by the global upgrade modal.
 */
export function getFeatureDisplayName(featureKey?: string): string {
  if (!featureKey?.trim()) return 'This feature';
  const normalized = featureKey.trim();
  if (LABELS[normalized]) return LABELS[normalized];
  return normalized.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
