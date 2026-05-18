/**
 * CANONICAL FEATURE KEY REGISTRY
 * 
 * This is the SINGLE SOURCE OF TRUTH for all feature keys in the system.
 * All feature checks should use keys from this registry.
 * 
 * IMPORTANT:
 * - DO NOT add new feature keys anywhere else
 * - DO NOT use feature keys directly as strings
 * - Always import and use FeatureKeys constants
 * - Legacy aliases are provided for backward compatibility
 */

/**
 * Core Sales Features
 */
export const SalesFeatures = {
  /** Basic invoice creation and management */
  INVOICE_CREATION: 'invoice_creation',
  /** Customer management (CRUD operations) */
  CUSTOMER_MANAGEMENT: 'customer_management',
  /** Estimates and quotations */
  ESTIMATES_QUOTATIONS: 'estimates_quotations',
  /** Credit notes and sales returns */
  CREDIT_NOTES: 'credit_notes',
  /** Debit notes (additional charges / adjustments) — registry id sales_debit_notes */
  DEBIT_NOTES: 'debit_notes',
  /** Recurring invoices */
  RECURRING_INVOICES: 'recurring_invoices',
  /** Sales orders */
  SALES_ORDERS: 'sales_orders',
  /** Invoice promo: percentage off line or bill */
  OFFERS_PERCENT_DISCOUNT: 'offers_percent_discount',
  /** Invoice promo: flat amount off bill */
  OFFERS_FLAT_DISCOUNT: 'offers_flat_discount',
  /** Invoice promo: buy X get Y */
  OFFERS_BOGO: 'offers_buy_x_get_y',
  /** Invoice promo: threshold on bill value */
  OFFERS_BILL_VALUE: 'offers_bill_value_discount',
} as const;

/**
 * Purchase & Procurement Features
 */
export const PurchaseFeatures = {
  /** Purchase management (bills, purchase orders) */
  PURCHASE_MANAGEMENT: 'purchase_management',
  /** Supplier management */
  SUPPLIER_MANAGEMENT: 'supplier_management',
  /** Expense tracking */
  EXPENSE_TRACKING: 'expense_tracking',
  /** Purchase orders */
  PURCHASE_ORDERS: 'purchase_orders',
} as const;

/**
 * Inventory & Stock Features
 */
export const InventoryFeatures = {
  /** Item/product management */
  ITEM_MANAGEMENT: 'item_management',
  /** Stock tracking */
  STOCK_TRACKING: 'stock_tracking',
  /** Low stock alerts */
  ALERT_LOW_STOCK: 'alert_low_stock',
  /** Inventory adjustments */
  INVENTORY_ADJUSTMENTS: 'inventory_adjustments',
  /** Enterprise barcode label printing (EAN-13 / Code-128 / GS1-128) */
  BARCODE_LABEL_PRINTING: 'barcode_label_printing',
  /** Print barcode labels from finalized purchase (GRN) */
  BARCODE_LABEL_FROM_PURCHASE: 'barcode_label_from_purchase',
  /** Custom label template designer (A4 sheet / roll / thermal) */
  BARCODE_LABEL_TEMPLATES: 'barcode_label_templates',
  /** Thermal printer (ZPL) output for Zebra-compatible printers */
  BARCODE_THERMAL_PRINTER: 'barcode_thermal_printer',
  /** Weight-embedded PLU barcodes for loose / produce items */
  BARCODE_WEIGHT_EMBEDDED: 'barcode_weight_embedded',
} as const;

/**
 * Reports Features
 */
export const ReportsFeatures = {
  /** Basic reports (sales, purchase, stock summaries) */
  REPORTS_BASIC: 'reports_basic',
  /** GST reports (GSTR-1, GSTR-2B, GSTR-3B, GSTR-9) */
  REPORTS_GST: 'reports_gst',
  /** Advanced reports (P&L, Balance Sheet, Cash Flow, Trial Balance, Aging) */
  REPORTS_ADVANCED: 'reports_advanced',
  /** Advanced analytics (profitability, trends, forecasting) */
  REPORTS_ANALYTICS: 'reports_analytics',
} as const;

/**
 * Invoicing & Templates Features
 */
export const InvoicingFeatures = {
  /** Basic templates (GST Standard, Classic) */
  TEMPLATE_BASIC: 'template_basic',
  /** All invoice templates (7 templates) */
  TEMPLATE_ALL: 'template_all',
  /** Thermal printing templates (58mm, 80mm) */
  TEMPLATE_THERMAL: 'template_thermal',
  /** Template customization (colors, fonts, margins, field visibility) */
  TEMPLATE_CUSTOMIZATION: 'template_customization',
  /** PDF generation */
  PDF_GENERATION: 'pdf_generation',
} as const;

/**
 * Payments & Accounting Features
 */
export const AccountingFeatures = {
  /** Payment tracking */
  PAYMENT_TRACKING: 'payment_tracking',
  /** Ledger and accounting (double-entry bookkeeping) */
  LEDGER_ACCOUNTING: 'ledger_accounting',
  /** Payment gateway integration */
  PAYMENT_GATEWAY: 'payment_gateway',
} as const;

/**
 * Alerts & Automation Features
 */
export const AutomationFeatures = {
  /** Credit limit monitoring alerts */
  ALERT_CREDIT_LIMIT: 'alert_credit_limit',
  /** Recurring invoices automation */
  RECURRING_INVOICES: 'recurring_invoices', // Duplicate - also in SalesFeatures
} as const;

/**
 * Integrations Features
 */
export const IntegrationFeatures = {
  /** WhatsApp manual sending */
  WHATSAPP_MANUAL: 'whatsapp_manual',
  /** WhatsApp auto reminders */
  WHATSAPP_AUTO_REMINDERS: 'whatsapp_auto_reminders',
  /** WhatsApp internal alerts when parties approach / exceed credit limits */
  WHATSAPP_CREDIT_ALERTS: 'whatsapp_credit_alerts',
  /** Automated payment reminders sent by email (payment due / overdue cron path) */
  EMAIL_REMINDERS: 'email_reminders',
  /** WhatsApp bot */
  WHATSAPP_BOT: 'whatsapp_bot',
  /** WhatsApp send message */
  WHATSAPP_SEND_MESSAGE: 'whatsapp_send_message',
  /** Email invoicing */
  EMAIL_INVOICING: 'email_invoicing',
  /** API access */
  API_ACCESS: 'api_access',
} as const;

/**
 * Settings & Configuration Features
 */
export const SettingsFeatures = {
  /** Multi-user access */
  MULTI_USER: 'multi_user',
  /** Multi-branch support */
  MULTI_BRANCH: 'multi_branch',
  /** Multi-warehouse support */
  MULTI_WAREHOUSE: 'multi_warehouse',
  /** Backup and restore */
  BACKUP_RESTORE: 'backup_restore',
  /** POS Mode - Retail billing interface */
  POS_MODE: 'settings_pos_mode',
} as const;

/**
 * Advanced Features
 */
export const AdvancedFeatures = {
  /** Online store */
  ONLINE_STORE: 'online_store',
  /** Barcode scanning */
  BARCODE_SCANNING: 'barcode_scanning',
  /** Multi-currency support */
  MULTI_CURRENCY: 'multi_currency',
  /** Custom branding (remove "Powered by Khatario") */
  CUSTOM_BRANDING: 'custom_branding',
} as const;

/**
 * Dashboard & Analytics Features
 */
export const DashboardFeatures = {
  /** Dashboard analytics (KPIs, insights) */
  DASHBOARD_ANALYTICS: 'dashboard_analytics',
  /** Dead stock dashboard widget (stagnant inventory) */
  DEAD_STOCK_WIDGET: 'dead_stock_widget',
} as const;

/**
 * Tools Features
 */
export const ToolsFeatures = {
  /** To-do list */
  TODO: 'todo',
} as const;

/**
 * Silver / Gold tier entitlement flags (mirrors Feature Registry IDs)
 */
export const TierEntitlementFeatures = {
  /** Per-customer item price overrides (party pricing matrix) */
  PARTY_PRICING: 'party_pricing',
  /** Gross profit / margin on invoice detail view */
  PROFIT_INVOICE: 'profit_invoice',
  /** Profit-by-invoice report and equivalent basic profitability */
  PROFIT_REPORTS_BASIC: 'profit_reports_basic',
  /** Advanced profitability reporting (beyond basic) */
  PROFIT_REPORTS_ADVANCED: 'profit_reports_advanced',
  /** Soft-delete and restore archived transactions */
  SOFT_DELETE: 'soft_delete',
} as const;

/**
 * All Feature Keys (flattened for easy access)
 */
export const FeatureKeys = {
  ...SalesFeatures,
  ...PurchaseFeatures,
  ...InventoryFeatures,
  ...ReportsFeatures,
  ...InvoicingFeatures,
  ...AccountingFeatures,
  ...AutomationFeatures,
  ...IntegrationFeatures,
  ...SettingsFeatures,
  ...AdvancedFeatures,
  ...DashboardFeatures,
  ...ToolsFeatures,
  ...TierEntitlementFeatures,
} as const;

/**
 * Feature Key Type
 */
export type FeatureKey = typeof FeatureKeys[keyof typeof FeatureKeys];

/**
 * LEGACY KEY MAPPINGS
 * 
 * Maps legacy/alias keys to canonical keys.
 * Used for backward compatibility with existing subscriptions and code.
 * 
 * IMPORTANT: These mappings allow old code to continue working while
 * we migrate to canonical keys. Eventually, all code should use canonical keys.
 */
export const LegacyFeatureKeyMap: Record<string, FeatureKey> = {
  // Sales domain legacy keys
  'sales_invoices': SalesFeatures.INVOICE_CREATION,
  'sales_estimates': SalesFeatures.ESTIMATES_QUOTATIONS,
  'sales_credit_notes': SalesFeatures.CREDIT_NOTES,
  'sales_debit_notes': SalesFeatures.DEBIT_NOTES,
  'sales_recurring_invoices': SalesFeatures.RECURRING_INVOICES,
  'sales_sales_orders': SalesFeatures.SALES_ORDERS,
  
  // Purchase domain legacy keys
  'purchase_suppliers': PurchaseFeatures.SUPPLIER_MANAGEMENT,
  'purchase_expenses': PurchaseFeatures.EXPENSE_TRACKING,
  'purchase_management': PurchaseFeatures.PURCHASE_MANAGEMENT,
  
  // Settings domain legacy keys
  'settings_template_customization': InvoicingFeatures.TEMPLATE_CUSTOMIZATION,
  'settings_multi_user': SettingsFeatures.MULTI_USER,
  'settings_multi_branch': SettingsFeatures.MULTI_BRANCH,
  'settings_multi_warehouse': SettingsFeatures.MULTI_WAREHOUSE,
  'settings_backup': SettingsFeatures.BACKUP_RESTORE,
  'settings_pos_mode': SettingsFeatures.POS_MODE,
  
  // Integration domain legacy keys
  'integration_whatsapp_bot': IntegrationFeatures.WHATSAPP_BOT,
  'integration_whatsapp_manual': IntegrationFeatures.WHATSAPP_MANUAL,
  
  // Tools domain legacy keys
  'tools_todo': ToolsFeatures.TODO,

  // Advanced — registry id differs from canonical key
  'advanced_custom_branding': AdvancedFeatures.CUSTOM_BRANDING,
} as const;

/**
 * Reverse mapping: Canonical key -> All legacy aliases
 * Useful for finding all references to a feature
 */
export const CanonicalToLegacyMap: Record<FeatureKey, string[]> = {
  [SalesFeatures.INVOICE_CREATION]: ['sales_invoices'],
  [SalesFeatures.ESTIMATES_QUOTATIONS]: ['sales_estimates'],
  [SalesFeatures.CREDIT_NOTES]: ['sales_credit_notes'],
  [SalesFeatures.DEBIT_NOTES]: ['sales_debit_notes'],
  [SalesFeatures.RECURRING_INVOICES]: ['sales_recurring_invoices'],
  [SalesFeatures.SALES_ORDERS]: ['sales_sales_orders'],

  [SalesFeatures.OFFERS_PERCENT_DISCOUNT]: [],
  [SalesFeatures.OFFERS_FLAT_DISCOUNT]: [],
  [SalesFeatures.OFFERS_BOGO]: [],
  [SalesFeatures.OFFERS_BILL_VALUE]: [],
  
  [PurchaseFeatures.SUPPLIER_MANAGEMENT]: ['purchase_suppliers'],
  [PurchaseFeatures.EXPENSE_TRACKING]: ['purchase_expenses'],
  [PurchaseFeatures.PURCHASE_MANAGEMENT]: ['purchase_management'],
  
  [InvoicingFeatures.TEMPLATE_CUSTOMIZATION]: ['settings_template_customization'],
  [SettingsFeatures.MULTI_USER]: ['settings_multi_user'],
  [SettingsFeatures.MULTI_BRANCH]: ['settings_multi_branch'],
  [SettingsFeatures.MULTI_WAREHOUSE]: ['settings_multi_warehouse'],
  [SettingsFeatures.BACKUP_RESTORE]: ['settings_backup'],
  [SettingsFeatures.POS_MODE]: ['settings_pos_mode'],
  
  [IntegrationFeatures.WHATSAPP_BOT]: ['integration_whatsapp_bot', 'whatsapp_bot'],
  [IntegrationFeatures.WHATSAPP_MANUAL]: ['integration_whatsapp_manual'],
  
  [ToolsFeatures.TODO]: ['tools_todo', 'todo'],
  
  // Features without legacy aliases
  [SalesFeatures.CUSTOMER_MANAGEMENT]: [],
  [PurchaseFeatures.PURCHASE_ORDERS]: [],
  [InventoryFeatures.ITEM_MANAGEMENT]: [],
  [InventoryFeatures.STOCK_TRACKING]: [],
  [InventoryFeatures.ALERT_LOW_STOCK]: [],
  [InventoryFeatures.INVENTORY_ADJUSTMENTS]: [],
  [InventoryFeatures.BARCODE_LABEL_PRINTING]: [],
  [InventoryFeatures.BARCODE_LABEL_FROM_PURCHASE]: [],
  [InventoryFeatures.BARCODE_LABEL_TEMPLATES]: [],
  [InventoryFeatures.BARCODE_THERMAL_PRINTER]: [],
  [InventoryFeatures.BARCODE_WEIGHT_EMBEDDED]: [],
  [ReportsFeatures.REPORTS_BASIC]: [],
  [ReportsFeatures.REPORTS_GST]: [],
  [ReportsFeatures.REPORTS_ADVANCED]: [],
  [ReportsFeatures.REPORTS_ANALYTICS]: [],
  [InvoicingFeatures.TEMPLATE_BASIC]: [],
  [InvoicingFeatures.TEMPLATE_ALL]: [],
  [InvoicingFeatures.TEMPLATE_THERMAL]: [],
  [InvoicingFeatures.PDF_GENERATION]: [],
  [AccountingFeatures.PAYMENT_TRACKING]: [],
  [AccountingFeatures.LEDGER_ACCOUNTING]: [],
  [AccountingFeatures.PAYMENT_GATEWAY]: [],
  [AutomationFeatures.ALERT_CREDIT_LIMIT]: [],
  [IntegrationFeatures.WHATSAPP_AUTO_REMINDERS]: [],
  [IntegrationFeatures.WHATSAPP_CREDIT_ALERTS]: [],
  [IntegrationFeatures.EMAIL_REMINDERS]: [],
  [IntegrationFeatures.WHATSAPP_SEND_MESSAGE]: [],
  [IntegrationFeatures.EMAIL_INVOICING]: [],
  [IntegrationFeatures.API_ACCESS]: [],
  [AdvancedFeatures.ONLINE_STORE]: [],
  [AdvancedFeatures.BARCODE_SCANNING]: [],
  [AdvancedFeatures.MULTI_CURRENCY]: [],
  [AdvancedFeatures.CUSTOM_BRANDING]: ['advanced_custom_branding'],
  [DashboardFeatures.DASHBOARD_ANALYTICS]: [],
  [DashboardFeatures.DEAD_STOCK_WIDGET]: [],

  [TierEntitlementFeatures.PARTY_PRICING]: [],
  [TierEntitlementFeatures.PROFIT_INVOICE]: [],
  [TierEntitlementFeatures.PROFIT_REPORTS_BASIC]: [],
  [TierEntitlementFeatures.PROFIT_REPORTS_ADVANCED]: [],
  [TierEntitlementFeatures.SOFT_DELETE]: [],
} as const;

/**
 * Normalize a feature key to its canonical form
 * 
 * @param key - Feature key (canonical or legacy)
 * @returns Canonical feature key
 * 
 * @example
 * normalizeFeatureKey('sales_invoices') // Returns 'invoice_creation'
 * normalizeFeatureKey('invoice_creation') // Returns 'invoice_creation'
 */
export function normalizeFeatureKey(key: string): FeatureKey {
  // If it's already a canonical key, return it
  if (Object.values(FeatureKeys).includes(key as FeatureKey)) {
    return key as FeatureKey;
  }
  
  // Check legacy mapping
  const canonicalKey = LegacyFeatureKeyMap[key];
  if (canonicalKey) {
    return canonicalKey;
  }
  
  // If not found, return as-is (may be a new feature or invalid key)
  // This allows for graceful degradation
  return key as FeatureKey;
}

/**
 * Check if a key is a canonical feature key
 */
export function isCanonicalFeatureKey(key: string): boolean {
  return Object.values(FeatureKeys).includes(key as FeatureKey);
}

/**
 * Check if a key is a legacy alias
 */
export function isLegacyFeatureKey(key: string): boolean {
  return key in LegacyFeatureKeyMap;
}

/**
 * Get all legacy aliases for a canonical key
 */
export function getLegacyAliases(canonicalKey: FeatureKey): string[] {
  return CanonicalToLegacyMap[canonicalKey] || [];
}
