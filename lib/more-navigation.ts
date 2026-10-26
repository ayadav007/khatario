/**
 * Mobile "More" menu — same section titles and labels as desktop Sidebar,
 * filtered by module permissions and plan features (RBAC). The phone app gets this
 * same menu from GET /api/navigation/more, so this is the only list to edit.
 */

import {
  isNavSectionVisible,
  type PlatformModule,
} from '@/lib/platform-modules';
import { buildHrNavSection } from '@/lib/hr/hr-admin-nav';
import { SALES_NAV_ITEMS } from '@/lib/navigation/sales-nav-items';

export type MoreNavItem = {
  href: string;
  label: string;
  /** PBAC module key (see capability-normalizer) */
  module?: string;
  featureKey?: string;
  isLocked?: boolean;
};

export type MoreNavSection = {
  title: string;
  items: MoreNavItem[];
};

export type MoreCapabilityResult = {
  allowed: boolean;
  denialReason?: string | null;
  indeterminate?: boolean;
};

export type MoreNavContext = {
  isSupplier: boolean;
  warehousesEnabled: boolean;
  hasCapability: (resource: string, action?: string) => boolean;
  /**
   * Prefer this when available — matches Sidebar: allow nav when role grants
   * the module even if the plan feature is missing (upgrade-locked UI).
   */
  checkCapability?: (resource: string, action?: string) => MoreCapabilityResult;
  /** Enabled platform modules (billing, hr, connect, crm). Tools always shown. */
  enabledModules: PlatformModule[];
  /** False removes Supplier Hub links. Omitted keeps them (plan lock still applies). */
  supplierHubVisible?: boolean;
};

/** Match Sidebar: hasFeature === hasCapability(featureKey, 'view') */
function hasFeature(
  hasCapability: MoreNavContext['hasCapability'],
  featureKey: string
): boolean {
  return hasCapability(featureKey, 'view');
}

/** Match Sidebar `roleAllowsModule` */
function roleAllowsModule(
  ctx: MoreNavContext,
  moduleKey: string,
  action: string
): boolean {
  if (ctx.checkCapability) {
    const result = ctx.checkCapability(moduleKey, action);
    return result.allowed || result.denialReason === 'FEATURE_NOT_IN_PLAN';
  }
  return ctx.hasCapability(moduleKey, action);
}

/** Same rules as Sidebar `isItemVisible` + `roleAllowsModule` */
export function isMoreNavItemVisible(
  item: MoreNavItem,
  ctx: MoreNavContext
): boolean {
  if (!item.module) return true;
  return roleAllowsModule(ctx, item.module, 'view');
}

function filterItems(items: MoreNavItem[], ctx: MoreNavContext): MoreNavItem[] {
  return items.filter((i) => isMoreNavItemVisible(i, ctx));
}

function section(
  title: string,
  items: MoreNavItem[],
  ctx: MoreNavContext,
  options?: { skipModuleGate?: boolean }
): MoreNavSection | null {
  if (!options?.skipModuleGate && !isNavSectionVisible(title, ctx.enabledModules)) {
    return null;
  }
  const vis = filterItems(items, ctx);
  if (vis.length === 0) return null;
  return { title, items: vis };
}

/** Sections start open (no entry); one tap closes an open section. */
export function toggleMoreSection(
  prev: Record<string, boolean>,
  title: string
): Record<string, boolean> {
  return { ...prev, [title]: prev[title] === false };
}

/**
 * Build grouped links for /more — titles align with desktop Sidebar.
 */
function withSupplierHubLock(item: MoreNavItem, hubLocked: boolean): MoreNavItem {
  return { ...item, featureKey: 'purchase_supplier_hub', isLocked: hubLocked };
}

export function buildMoreMenuSections(ctx: MoreNavContext): MoreNavSection[] {
  const { isSupplier, warehousesEnabled, hasCapability } = ctx;
  const out: MoreNavSection[] = [];
  const showHub = ctx.supplierHubVisible !== false;
  const hubLocked = !hasFeature(hasCapability, 'purchase_supplier_hub');

  if (showHub && isSupplier && isNavSectionVisible('Supplier', ctx.enabledModules)) {
    const s = section(
      'Supplier',
      [
        { href: '/suppliers/hub', label: 'Supplier Hub' },
        { href: '/suppliers/dashboard', label: 'Supplier Dashboard' },
        { href: '/suppliers/catalog', label: 'My Catalog' },
        { href: '/supply-orders?role=vendor', label: 'Orders from Buyers' },
        { href: '/suppliers/requests', label: 'Requests to Fulfill' },
      ].map((item) => withSupplierHubLock(item, hubLocked)),
      ctx
    );
    if (s) out.push(s);
  }

  const salesItems: MoreNavItem[] = SALES_NAV_ITEMS.map((item) => ({
    href: item.href,
    label: item.label,
    module: item.module,
    featureKey: item.featureKey,
    isLocked: item.featureKey ? !hasFeature(hasCapability, item.featureKey) : false,
  }));
  let sales = section('Sales', salesItems, ctx);
  // Connect agents on connect-only accounts still need sales lookups when RBAC allows.
  if (!sales) {
    const lookup = filterItems(salesItems, ctx);
    if (lookup.length > 0) {
      sales = { title: 'Sales', items: lookup };
    }
  }
  if (sales) out.push(sales);

  const purchases = section(
    'Purchases',
    [
      { href: '/suppliers', label: 'Suppliers', module: 'purchases' },
      ...(showHub
        ? [
            withSupplierHubLock({ href: '/suppliers/hub', label: 'Supplier Hub', module: 'purchases' }, hubLocked),
            withSupplierHubLock({ href: '/purchases/incoming', label: 'Incoming Bills', module: 'purchases' }, hubLocked),
            withSupplierHubLock({ href: '/supply-orders', label: 'Supplier Orders', module: 'purchases' }, hubLocked),
            withSupplierHubLock({ href: '/purchases/new-arrivals', label: 'New Arrivals', module: 'purchases' }, hubLocked),
          ]
        : []),
      { href: '/purchases', label: 'All Purchases', module: 'purchases' },
      ...(showHub
        ? [withSupplierHubLock({ href: '/purchases/requests', label: 'Requests', module: 'purchases' }, hubLocked)]
        : []),
      { href: '/purchase-orders', label: 'Purchase Orders', module: 'purchases' },
      { href: '/purchase-returns', label: 'Purchase Returns', module: 'purchases' },
      { href: '/expenses', label: 'Expenses', module: 'expenses' },
    ],
    ctx
  );
  if (purchases) out.push(purchases);

  const invItems: MoreNavItem[] = [
    { href: '/items', label: 'Items', module: 'items' },
    { href: '/pricing/party-item', label: 'Party Pricing', module: 'items' },
  ];
  if (hasFeature(hasCapability, 'barcode_label_printing')) {
    invItems.push({
      href: '/items/barcodes',
      label: 'Print Labels',
      module: 'items',
      featureKey: 'barcode_label_printing',
    });
  }
  if (warehousesEnabled) {
    invItems.push({
      href: '/settings/warehouses',
      label: 'Warehouses',
      module: 'warehouses',
      isLocked: !hasFeature(hasCapability, 'multi_warehouse'),
      featureKey: 'settings_multi_warehouse',
    });
    invItems.push({
      href: '/stock-transfers',
      label: 'Stock Transfers',
      module: 'warehouse_transfer',
      isLocked: !hasFeature(hasCapability, 'multi_warehouse'),
      featureKey: 'settings_multi_warehouse',
    });
  }
  invItems.push(
    { href: '/inventory-adjustments', label: 'Adjustments', module: 'items' },
    { href: '/stock-counts', label: 'Stock Counts', module: 'items' },
    { href: '/stock-holds', label: "Held & Others' Goods", module: 'items' },
    { href: '/manufacturing', label: 'Manufacturing', module: 'items' },
    { href: '/insurance-claims', label: 'Insurance Claims', module: 'items' },
    { href: '/items/cleanup', label: 'Units & Duplicates', module: 'items' },
    { href: '/reports/stock/third-party', label: 'Stock with Parties', module: 'reports' },
    { href: '/reports/stock/summary', label: 'Stock Summary', module: 'reports' },
    { href: '/reports/stock/closing-stock', label: 'Closing Stock', module: 'reports' }
  );
  let inventory = section('Inventory', invItems, ctx);
  if (!inventory) {
    const lookup = filterItems(
      [
        { href: '/items', label: 'Items', module: 'items' },
        { href: '/pricing/party-item', label: 'Party Pricing', module: 'items' },
      ],
      ctx
    );
    if (lookup.length > 0) {
      inventory = { title: 'Inventory', items: lookup };
    }
  }
  if (inventory) out.push(inventory);

  const accounting = section(
    'Accounting',
    [
      { href: '/accounts', label: 'Chart of Accounts', module: 'settings', featureKey: 'accounting_chart', isLocked: !hasFeature(hasCapability, 'accounting_chart') },
      { href: '/journal-entries', label: 'Journal Entries', module: 'journal' },
      { href: '/contra', label: 'Contra', module: 'journal' },
      { href: '/advances', label: 'Advances', module: 'journal' },
      { href: '/recurring-invoices', label: 'Recurring invoices', module: 'invoices' },
      { href: '/fixed-assets', label: 'Fixed assets', module: 'journal' },
      { href: '/bank/import', label: 'Bank import', module: 'settings' },
      { href: '/bank/reconciliation', label: 'Bank reconciliation', module: 'settings' },
      { href: '/ledger', label: 'Ledger', module: 'invoices' },
      { href: '/payments/in', label: 'Payments In', module: 'payments' },
      { href: '/payments/out', label: 'Payments Out', module: 'payments' },
      { href: '/payments/reconciliation', label: 'Reconciliation', module: 'payments' },
      { href: '/provisions', label: 'Provisions', module: 'settings', featureKey: 'accounting_provisions', isLocked: !hasFeature(hasCapability, 'accounting_provisions') },
      { href: '/tds', label: 'TDS/TCS', module: 'settings', featureKey: 'accounting_tds', isLocked: !hasFeature(hasCapability, 'accounting_tds') },
    ],
    ctx
  );
  if (accounting) out.push(accounting);

  const reports = section(
    'Reports',
    [
      { href: '/reports', label: 'Overview', module: 'reports' },
      { href: '/reports/builder', label: 'Custom Report Builder', module: 'reports', featureKey: 'report_builder' },
      { href: '/reports/profit-loss', label: 'Profit & Loss', module: 'reports' },
      { href: '/reports/balance-sheet', label: 'Balance Sheet', module: 'reports' },
      { href: '/reports/cash-flow', label: 'Cash Flow', module: 'reports' },
      { href: '/reports/trial-balance', label: 'Trial Balance', module: 'reports' },
      { href: '/reports/aging/receivables', label: 'Receivables Aging', module: 'reports' },
      { href: '/reports/aging/payables', label: 'Payables Aging', module: 'reports' },
      { href: '/reports/gst/gstr1', label: 'GST Returns (GSTR-1)', module: 'reports' },
      { href: '/reports/gst/cash-ledger', label: 'GST Cash Ledger', module: 'reports' },
      { href: '/reports/sales/summary', label: 'Sales — Summary', module: 'reports' },
      { href: '/reports/sales/invoice-wise', label: 'Sales — Invoice-wise', module: 'reports' },
      { href: '/reports/sales/item-wise', label: 'Sales — Item-wise', module: 'reports' },
      { href: '/reports/sales/party-wise', label: 'Sales — Party-wise', module: 'reports' },
      { href: '/reports/sales/tax-wise', label: 'Sales — Tax-wise', module: 'reports' },
      { href: '/reports/sales/payment-mode', label: 'Sales — Payment mode', module: 'reports' },
      { href: '/reports/sales/discount', label: 'Sales — Discount', module: 'reports' },
      { href: '/reports/sales/credit', label: 'Sales — Credit', module: 'reports' },
      { href: '/reports/sales/cancelled', label: 'Sales — Cancelled', module: 'reports' },
      { href: '/reports/sales/returns', label: 'Sales — Returns', module: 'reports' },
      { href: '/reports/sales/b2b-b2c', label: 'Sales — B2B vs B2C', module: 'reports' },
      { href: '/reports/purchase/summary', label: 'Purchase — Summary', module: 'reports' },
      { href: '/reports/purchase/invoice-wise', label: 'Purchase — Invoice-wise', module: 'reports' },
      { href: '/reports/purchase/supplier-wise', label: 'Purchase — Supplier-wise', module: 'reports' },
      { href: '/reports/purchase/item-wise', label: 'Purchase — Item-wise', module: 'reports' },
      { href: '/reports/purchase/returns', label: 'Purchase — Returns', module: 'reports' },
      { href: '/reports/purchase/credit', label: 'Purchase — Credit', module: 'reports' },
      { href: '/reports/purchase/tax-wise', label: 'Purchase — Tax-wise', module: 'reports' },
      { href: '/reports/gst/compliance', label: 'GST alerts', module: 'reports' },
      { href: '/reports/gst/gstr2b', label: 'GSTR-2B', module: 'reports' },
      { href: '/reports/gst/gstr2b-reconciliation', label: 'GSTR-2B reconciliation', module: 'reports' },
      { href: '/reports/gst/reconciliation', label: 'GSTR-1 vs 3B', module: 'reports' },
      { href: '/reports/gst/gstr3b', label: 'GSTR-3B', module: 'reports' },
      { href: '/reports/gst/gstr9', label: 'GSTR-9', module: 'reports' },
      { href: '/eway-bills', label: 'E-way bills', module: 'reports' },
      { href: '/reports/deleted', label: 'Deleted items', module: 'reports' },
      { href: '/reports/stock/valuation', label: 'Stock valuation', module: 'reports' },
      { href: '/reports/stock/quantitative', label: 'Quantity details (3CD)', module: 'reports' },
      { href: '/reports/stock/bank-statement', label: 'Bank stock statement', module: 'reports' },
      { href: '/reports/stock/job-work', label: 'Job work (ITC-04)', module: 'reports' },
      { href: '/reports/credit-risk', label: 'Credit risk', module: 'reports' },
    ],
    ctx
  );
  if (reports) out.push(reports);

  const hr = buildHrNavSection({
    hasFeature: (key) => hasFeature(hasCapability, key),
    roleAllowsModule: (moduleKey) => roleAllowsModule(ctx, moduleKey, 'view'),
    enabledModules: ctx.enabledModules,
  });
  if (hr) {
    out.push({
      title: hr.title,
      items: hr.items.map((item) => ({
        href: item.href,
        label: item.label,
        module: item.module,
        featureKey: item.featureKey,
      })),
    });
  }

  // Mirror desktop Sidebar: Connect tree, or billing-only WhatsApp settings link.
  const hasConnect = ctx.enabledModules.includes('connect');
  const hasBilling = ctx.enabledModules.includes('billing');
  const whatsappUnlocked = hasFeature(hasCapability, 'whatsapp_bot');

  if (hasConnect) {
    const connect = section(
      'Connect',
      [
        {
          href: '/whatsapp/dashboard',
          label: 'Dashboard',
          module: 'whatsapp',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/whatsapp/conversations',
          label: 'Conversations',
          module: 'whatsapp_inbox',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/whatsapp/pipeline',
          label: 'Pipeline',
          module: 'whatsapp_inbox',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/whatsapp/reminders',
          label: 'Payment Reminders',
          module: 'whatsapp',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/whatsapp/orders',
          label: 'Order Verification',
          module: 'whatsapp_inbox',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/whatsapp/flows',
          label: 'Flows',
          module: 'whatsapp',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/whatsapp/send-message',
          label: 'Send Message',
          module: 'whatsapp',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/whatsapp/who-to-message',
          label: 'Who to message',
          module: 'whatsapp',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/whatsapp/campaigns',
          label: 'Campaigns',
          module: 'whatsapp',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/whatsapp/contacts',
          label: 'Contacts',
          module: 'whatsapp_inbox',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/whatsapp/contacts/groups',
          label: 'Contact Groups',
          module: 'whatsapp',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/whatsapp/group-extractor',
          label: 'Group Extractor',
          module: 'whatsapp',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/whatsapp/unsubscribes',
          label: 'Unsubscribes',
          module: 'whatsapp',
          isLocked: !whatsappUnlocked,
          featureKey: 'whatsapp_bot',
        },
        {
          href: '/settings/whatsapp',
          label: 'WhatsApp Settings',
          module: 'whatsapp',
        },
      ],
      ctx
    );
    if (connect) out.push(connect);
  } else if (hasBilling) {
    // Sidebar: billing-only businesses get a WhatsApp settings link under More (not Connect).
    const items = filterItems(
      [{ href: '/settings/whatsapp', label: 'WhatsApp', module: 'whatsapp' }],
      ctx
    );
    if (items.length) out.push({ title: 'WhatsApp', items });
  }

  const toolsItems: MoreNavItem[] = [
    { href: '/search', label: 'Search' },
    { href: '/tools', label: 'All Tools' },
    {
      href: '/tools/todo',
      label: 'To Do List',
      featureKey: 'todo',
      isLocked: !hasFeature(hasCapability, 'todo'),
    },
    { href: '/tools/hsn-finder', label: 'HSN/SAC Finder' },
    { href: '/tools/gst-calculator', label: 'GST Calculator' },
    { href: '/tools/google-lead-extractor', label: 'Lead Extractor' },
    { href: '/tools/tds-calculator', label: 'TDS Calculator' },
    { href: '/tools/discount-calculator', label: 'Discount Calculator' },
    { href: '/tools/price-margin-calculator', label: 'Price Calculator' },
    { href: '/tools/pan-validator', label: 'PAN Validator' },
    { href: '/tools/gstin-validator', label: 'GSTIN Validator' },
    { href: '/tools/interest-calculator', label: 'Interest Calculator' },
    { href: '/tools/emi-calculator', label: 'EMI Calculator' },
    { href: '/tools/currency-converter', label: 'Currency Converter' },
    { href: '/tools/invoice-number-generator', label: 'Invoice Generator' },
  ];
  const tools = section('Tools', toolsItems, ctx);
  if (tools) out.push(tools);

  const settingsData = section(
    'Settings & data',
    [
      { href: '/settings', label: 'Settings', module: 'settings' },
    ],
    ctx
  );
  if (settingsData) out.push(settingsData);

  const support = section(
    'Support',
    [
      { href: '/docs', label: 'Documentation' },
      { href: '/support', label: 'Contact Support' },
      { href: '/privacy', label: 'Privacy Policy' },
    ],
    ctx
  );
  if (support) out.push(support);

  return out;
}
