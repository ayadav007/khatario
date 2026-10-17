import '../../capability.dart';

/// Port of `lib/more-navigation.ts` (with `SALES_NAV_ITEMS`, `HR_ADMIN_NAV_ITEMS` and
/// `NAV_SECTION_MODULE`).
class MoreNavItem {
  const MoreNavItem(this.href, this.label, {this.module, this.featureKey, this.isLocked = false});

  final String href;
  final String label;
  final String? module;
  final String? featureKey;
  final bool isLocked;
}

typedef MoreNavSection = ({String title, List<MoreNavItem> items});

/// `NAV_SECTION_MODULE`; missing titles always show.
const _navSectionModule = {
  'Sales': 'billing',
  'Purchases': 'billing',
  'Inventory': 'billing',
  'Accounting': 'billing',
  'Reports': 'billing',
  'Supplier': 'billing',
  'HR & Employees': 'hr',
  'Staff': 'hr',
  'Connect': 'connect',
};

bool _isNavSectionVisible(String title, List<String> enabledModules) {
  final required = _navSectionModule[title];
  return required == null || enabledModules.contains(required);
}

const _salesNavItems = [
  ('/customers', 'Customers', 'customers', null),
  ('/invoices', 'All Invoices', 'invoices', null),
  ('/orders', 'Orders & Delivery', 'invoices', null),
  ('/estimates', 'Quotations', 'invoices', null),
  ('/sales-orders', 'Sales Orders', 'invoices', null),
  ('/delivery-challans', 'Delivery Challans', 'invoices', 'sales_delivery_challans'),
  ('/work-orders', 'Work Orders', 'work_orders', 'sales_work_orders'),
  ('/credit-notes', 'Credit Notes', 'credit_notes', null),
  ('/debit-notes', 'Debit Notes', 'debit_notes', null),
];

/// `HR_ADMIN_NAV_ITEMS`: href, label, module, featureKey, requiresFullHr.
const _hrAdminNavItems = [
  ('/hr/dashboard', 'HR Dashboard', 'employees', 'hr_employees', true),
  ('/employees', 'All Employees', 'employees', 'hr_employees', false),
  ('/employees/org-chart', 'Org chart', 'employees', 'hr_employees', true),
  ('/employees/manager', 'Manager', 'leave_requests', 'hr_leaves', true),
  ('/employees/new', 'Add Employee', 'employees', 'hr_employees', false),
  ('/employees/recruitment', 'Recruitment', 'recruitment', 'hr_employees', true),
  ('/employees/attendance', 'Attendance', 'attendance', 'hr_attendance', false),
  ('/hr/shifts/roster', 'Shift roster', 'attendance', 'hr_attendance', true),
  ('/hr/shifts/bulk-assign', 'Bulk assign shifts', 'attendance', 'hr_attendance', true),
  ('/employees/leaves', 'Leaves', 'leave_requests', 'hr_leaves', true),
  ('/employees/leaves/calendar', 'Leave calendar', 'leave_requests', 'hr_leaves', true),
  ('/hr/leaves/year-end', 'Leave year-end', 'leave_requests', 'hr_leaves', true),
  ('/hr/leaves/import-balances', 'Import leave balances', 'leave_requests', 'hr_leaves', true),
  ('/employees/salary/payments', 'Salary Payments', 'payroll', 'hr_payroll', false),
  ('/employees/salary/advances', 'Salary Advances', 'payroll', 'hr_payroll', false),
  ('/employees/expenses', 'Employee Expenses', 'employees', 'hr_employees', false),
  ('/employees/commissions', 'Commissions', 'commissions', 'hr_employees', false),
  ('/hr/engagement', 'Engagement', 'employees', 'hr_employees', true),
  ('/hr/documents', 'HR Documents', 'employees', 'hr_employees', true),
  ('/hr/exits', 'Exits', 'employees', 'hr_employees', true),
  ('/hr/reports', 'HR Reports', 'employees', 'hr_employees', true),
  ('/employees/performance', 'Performance', 'employees', 'hr_employees', true),
  ('/employees/tasks', 'Tasks', 'employees', 'hr_employees', true),
  ('/activity-logs', 'Activity Logs', 'settings', null, true),
];

List<MoreNavSection> buildMoreMenuSections({
  required Capabilities caps,
  required bool isSupplier,
  required bool warehousesEnabled,
  required List<String> enabledModules,
}) {
  bool hasFeature(String key) => caps.has(key, 'view');

  bool roleAllowsModule(String module) {
    final r = caps.check(module, 'view');
    return r.allowed || r.denialReason == 'FEATURE_NOT_IN_PLAN';
  }

  List<MoreNavItem> filterItems(List<MoreNavItem> items) =>
      items.where((i) => i.module == null || roleAllowsModule(i.module!)).toList();

  MoreNavSection? section(String title, List<MoreNavItem> items) {
    if (!_isNavSectionVisible(title, enabledModules)) return null;
    final vis = filterItems(items);
    return vis.isEmpty ? null : (title: title, items: vis);
  }

  final out = <MoreNavSection>[];

  if (isSupplier && _isNavSectionVisible('Supplier', enabledModules)) {
    final s = section('Supplier', const [
      MoreNavItem('/suppliers/dashboard', 'Supplier Dashboard'),
      MoreNavItem('/supply-orders?role=vendor', 'Orders from Buyers'),
      MoreNavItem('/suppliers/requests', 'Requests to Fulfill'),
    ]);
    if (s != null) out.add(s);
  }

  final salesItems = [
    for (final (href, label, module, featureKey) in _salesNavItems)
      MoreNavItem(href, label,
          module: module, featureKey: featureKey, isLocked: featureKey != null && !hasFeature(featureKey)),
  ];
  var sales = section('Sales', salesItems);
  if (sales == null) {
    final lookup = filterItems(salesItems);
    if (lookup.isNotEmpty) sales = (title: 'Sales', items: lookup);
  }
  if (sales != null) out.add(sales);

  final purchases = section('Purchases', const [
    MoreNavItem('/suppliers', 'Suppliers', module: 'purchases'),
    MoreNavItem('/suppliers/hub', 'Suppliers Hub', module: 'purchases'),
    MoreNavItem('/purchases/incoming', 'Incoming Bills', module: 'purchases'),
    MoreNavItem('/supply-orders', 'Supplier Orders', module: 'purchases'),
    MoreNavItem('/purchases/new-arrivals', 'New Arrivals', module: 'purchases'),
    MoreNavItem('/purchases', 'All Purchases', module: 'purchases'),
    MoreNavItem('/purchases/requests', 'Requests', module: 'purchases'),
    MoreNavItem('/purchase-orders', 'Purchase Orders', module: 'purchases'),
    MoreNavItem('/purchase-returns', 'Purchase Returns', module: 'purchases'),
    MoreNavItem('/expenses', 'Expenses', module: 'expenses'),
  ]);
  if (purchases != null) out.add(purchases);

  final multiWarehouseLocked = !hasFeature('multi_warehouse');
  final invItems = [
    const MoreNavItem('/items', 'Items', module: 'items'),
    const MoreNavItem('/pricing/party-item', 'Party Pricing', module: 'items'),
    if (hasFeature('barcode_label_printing'))
      const MoreNavItem('/items/barcodes', 'Print Labels', module: 'items', featureKey: 'barcode_label_printing'),
    if (warehousesEnabled) ...[
      MoreNavItem('/settings/warehouses', 'Warehouses',
          module: 'warehouses', isLocked: multiWarehouseLocked, featureKey: 'settings_multi_warehouse'),
      MoreNavItem('/stock-transfers', 'Stock Transfers',
          module: 'warehouse_transfer', isLocked: multiWarehouseLocked, featureKey: 'settings_multi_warehouse'),
    ],
    const MoreNavItem('/inventory-adjustments', 'Adjustments', module: 'items'),
    const MoreNavItem('/reports/stock/summary', 'Stock Summary', module: 'reports'),
    const MoreNavItem('/reports/stock/closing-stock', 'Closing Stock', module: 'reports'),
  ];
  var inventory = section('Inventory', invItems);
  if (inventory == null) {
    final lookup = filterItems(const [
      MoreNavItem('/items', 'Items', module: 'items'),
      MoreNavItem('/pricing/party-item', 'Party Pricing', module: 'items'),
    ]);
    if (lookup.isNotEmpty) inventory = (title: 'Inventory', items: lookup);
  }
  if (inventory != null) out.add(inventory);

  MoreNavItem gated(String href, String label, String module, String featureKey) =>
      MoreNavItem(href, label, module: module, featureKey: featureKey, isLocked: !hasFeature(featureKey));

  final accounting = section('Accounting', [
    gated('/accounts', 'Chart of Accounts', 'settings', 'accounting_chart'),
    const MoreNavItem('/journal-entries', 'Journal Entries', module: 'journal'),
    const MoreNavItem('/contra', 'Contra', module: 'journal'),
    const MoreNavItem('/advances', 'Advances', module: 'journal'),
    const MoreNavItem('/recurring-invoices', 'Recurring invoices', module: 'invoices'),
    const MoreNavItem('/fixed-assets', 'Fixed assets', module: 'journal'),
    const MoreNavItem('/bank/import', 'Bank import', module: 'settings'),
    const MoreNavItem('/bank/reconciliation', 'Bank reconciliation', module: 'settings'),
    const MoreNavItem('/ledger', 'Ledger', module: 'invoices'),
    const MoreNavItem('/payments/in', 'Payments In', module: 'payments'),
    const MoreNavItem('/payments/out', 'Payments Out', module: 'payments'),
    const MoreNavItem('/payments/reconciliation', 'Reconciliation', module: 'payments'),
    gated('/provisions', 'Provisions', 'settings', 'accounting_provisions'),
    gated('/tds', 'TDS/TCS', 'settings', 'accounting_tds'),
  ]);
  if (accounting != null) out.add(accounting);

  final reports = section('Reports', const [
    MoreNavItem('/reports', 'Overview', module: 'reports'),
    MoreNavItem('/reports/builder', 'Custom Report Builder', module: 'reports', featureKey: 'report_builder'),
    MoreNavItem('/reports/profit-loss', 'Profit & Loss', module: 'reports'),
    MoreNavItem('/reports/balance-sheet', 'Balance Sheet', module: 'reports'),
    MoreNavItem('/reports/cash-flow', 'Cash Flow', module: 'reports'),
    MoreNavItem('/reports/trial-balance', 'Trial Balance', module: 'reports'),
    MoreNavItem('/reports/aging/receivables', 'Receivables Aging', module: 'reports'),
    MoreNavItem('/reports/aging/payables', 'Payables Aging', module: 'reports'),
    MoreNavItem('/reports/gst/gstr1', 'GST Returns (GSTR-1)', module: 'reports'),
    MoreNavItem('/reports/gst/cash-ledger', 'GST Cash Ledger', module: 'reports'),
    MoreNavItem('/reports/sales/summary', 'Sales — Summary', module: 'reports'),
    MoreNavItem('/reports/sales/invoice-wise', 'Sales — Invoice-wise', module: 'reports'),
    MoreNavItem('/reports/sales/item-wise', 'Sales — Item-wise', module: 'reports'),
    MoreNavItem('/reports/sales/party-wise', 'Sales — Party-wise', module: 'reports'),
    MoreNavItem('/reports/sales/tax-wise', 'Sales — Tax-wise', module: 'reports'),
    MoreNavItem('/reports/sales/payment-mode', 'Sales — Payment mode', module: 'reports'),
    MoreNavItem('/reports/sales/discount', 'Sales — Discount', module: 'reports'),
    MoreNavItem('/reports/sales/credit', 'Sales — Credit', module: 'reports'),
    MoreNavItem('/reports/sales/cancelled', 'Sales — Cancelled', module: 'reports'),
    MoreNavItem('/reports/sales/returns', 'Sales — Returns', module: 'reports'),
    MoreNavItem('/reports/sales/b2b-b2c', 'Sales — B2B vs B2C', module: 'reports'),
    MoreNavItem('/reports/purchase/summary', 'Purchase — Summary', module: 'reports'),
    MoreNavItem('/reports/purchase/invoice-wise', 'Purchase — Invoice-wise', module: 'reports'),
    MoreNavItem('/reports/purchase/supplier-wise', 'Purchase — Supplier-wise', module: 'reports'),
    MoreNavItem('/reports/purchase/item-wise', 'Purchase — Item-wise', module: 'reports'),
    MoreNavItem('/reports/purchase/returns', 'Purchase — Returns', module: 'reports'),
    MoreNavItem('/reports/purchase/credit', 'Purchase — Credit', module: 'reports'),
    MoreNavItem('/reports/purchase/tax-wise', 'Purchase — Tax-wise', module: 'reports'),
    MoreNavItem('/reports/gst/compliance', 'GST alerts', module: 'reports'),
    MoreNavItem('/reports/gst/gstr2b', 'GSTR-2B', module: 'reports'),
    MoreNavItem('/reports/gst/gstr2b-reconciliation', 'GSTR-2B reconciliation', module: 'reports'),
    MoreNavItem('/reports/gst/reconciliation', 'GSTR-1 vs 3B', module: 'reports'),
    MoreNavItem('/reports/gst/gstr3b', 'GSTR-3B', module: 'reports'),
    MoreNavItem('/reports/gst/gstr9', 'GSTR-9', module: 'reports'),
    MoreNavItem('/reports/deleted', 'Deleted items', module: 'reports'),
    MoreNavItem('/reports/stock/valuation', 'Stock valuation', module: 'reports'),
    MoreNavItem('/reports/credit-risk', 'Credit risk', module: 'reports'),
  ]);
  if (reports != null) out.add(reports);

  // `hasFullHrFeatures`
  final fullHr = hasFeature('hr_leaves') || hasFeature('hr_employee_portal');
  final hr = section(fullHr ? 'HR & Employees' : 'Staff', [
    for (final (href, label, module, featureKey, requiresFullHr) in _hrAdminNavItems)
      if (fullHr || !requiresFullHr)
        MoreNavItem(href, label,
            module: module, featureKey: featureKey, isLocked: featureKey != null && !hasFeature(featureKey)),
  ]);
  if (hr != null) out.add(hr);

  final hasConnect = enabledModules.contains('connect');
  final hasBilling = enabledModules.contains('billing');
  final whatsappLocked = !hasFeature('whatsapp_bot');
  MoreNavItem wa(String href, String label, String module) =>
      MoreNavItem(href, label, module: module, isLocked: whatsappLocked, featureKey: 'whatsapp_bot');

  if (hasConnect) {
    final connect = section('Connect', [
      wa('/whatsapp/dashboard', 'Dashboard', 'whatsapp'),
      wa('/whatsapp/conversations', 'Conversations', 'whatsapp_inbox'),
      wa('/whatsapp/reminders', 'Payment Reminders', 'whatsapp'),
      wa('/whatsapp/orders', 'Order Verification', 'whatsapp_inbox'),
      wa('/whatsapp/flows', 'Flows', 'whatsapp'),
      wa('/whatsapp/send-message', 'Send Message', 'whatsapp'),
      wa('/whatsapp/who-to-message', 'Who to message', 'whatsapp'),
      wa('/whatsapp/campaigns', 'Campaigns', 'whatsapp'),
      wa('/whatsapp/contacts', 'Contacts', 'whatsapp_inbox'),
      wa('/whatsapp/contacts/groups', 'Contact Groups', 'whatsapp'),
      wa('/whatsapp/group-extractor', 'Group Extractor', 'whatsapp'),
      wa('/whatsapp/unsubscribes', 'Unsubscribes', 'whatsapp'),
      const MoreNavItem('/settings/whatsapp', 'WhatsApp Settings', module: 'whatsapp'),
    ]);
    if (connect != null) out.add(connect);
  } else if (hasBilling) {
    final items = filterItems(const [MoreNavItem('/settings/whatsapp', 'WhatsApp', module: 'whatsapp')]);
    if (items.isNotEmpty) out.add((title: 'WhatsApp', items: items));
  }

  final tools = section('Tools', [
    const MoreNavItem('/search', 'Search'),
    const MoreNavItem('/tools', 'All Tools'),
    MoreNavItem('/tools/todo', 'To Do List', featureKey: 'todo', isLocked: !hasFeature('todo')),
    const MoreNavItem('/tools/hsn-finder', 'HSN/SAC Finder'),
    const MoreNavItem('/tools/gst-calculator', 'GST Calculator'),
    const MoreNavItem('/tools/google-lead-extractor', 'Lead Extractor'),
    const MoreNavItem('/tools/tds-calculator', 'TDS Calculator'),
    const MoreNavItem('/tools/discount-calculator', 'Discount Calculator'),
    const MoreNavItem('/tools/price-margin-calculator', 'Price Calculator'),
    const MoreNavItem('/tools/pan-validator', 'PAN Validator'),
    const MoreNavItem('/tools/gstin-validator', 'GSTIN Validator'),
    const MoreNavItem('/tools/interest-calculator', 'Interest Calculator'),
    const MoreNavItem('/tools/emi-calculator', 'EMI Calculator'),
    const MoreNavItem('/tools/currency-converter', 'Currency Converter'),
    const MoreNavItem('/tools/invoice-number-generator', 'Invoice Generator'),
  ]);
  if (tools != null) out.add(tools);

  final settingsData = section('Settings & data', const [MoreNavItem('/settings', 'Settings', module: 'settings')]);
  if (settingsData != null) out.add(settingsData);

  final support = section('Support', const [
    MoreNavItem('/docs', 'Documentation'),
    MoreNavItem('/support', 'Contact Support'),
    MoreNavItem('/privacy', 'Privacy Policy'),
  ]);
  if (support != null) out.add(support);

  return out;
}

/// `toggleMoreSection`: sections start open; one tap closes an open section.
Map<String, bool> toggleMoreSection(Map<String, bool> prev, String title) =>
    {...prev, title: prev[title] == false};
