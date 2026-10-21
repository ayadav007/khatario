import 'record_format.dart';

/// Every More-menu and settings route that is not already a dedicated phone screen.
enum PageQuery { none, range, month, financialYear }

class AppPage {
  const AppPage(this.href, this.title, this.path, {this.listKey, this.query = PageQuery.none, this.estimate = false, this.tool});

  final String href;
  final String title;
  final String path;
  final String? listKey;
  final PageQuery query;
  final bool estimate;

  /// `gst`, `hsn`, or `leads`.
  final String? tool;

  /// Same page under the menu's own wording ("GSTR-9", not "Gstr9").
  AppPage withTitle(String label) => label.trim().isEmpty || label.startsWith('/')
      ? this
      : AppPage(href, label, path, listKey: listKey, query: query, estimate: estimate, tool: tool);
}

/// Same groups as the website settings hub (`lib/settings-module-registry.ts`).
const settingsSections = <(String, List<(String, String)>)>[
  ('Account', [
    ('/settings/business', 'Business profile'),
    ('/settings/branches', 'Branches'),
    ('/settings/financial-years', 'Financial years'),
    ('/settings/warehouses', 'Warehouses'),
  ]),
  ('Team & permissions', [
    ('/settings/user-management', 'User management'),
    ('/settings/users', 'Manage users'),
    ('/settings/roles', 'Manage roles'),
    ('/settings/user-branches', 'User branches'),
    ('/settings/user-warehouses', 'User warehouses'),
    ('/settings/activity', 'Activity logs'),
  ]),
  ('Plan', [
    ('/settings/products', 'Your products'),
    ('/settings/subscription', 'Plan & billing'),
    ('/upgrade', 'Upgrade'),
  ]),
  ('Billing setup', [
    ('/settings/suppliers-directory', 'Suppliers directory'),
    ('/settings/business#pos-mode', 'POS mode'),
  ]),
  ('Accounting', [
    ('/settings/account-mappings', 'Account mappings'),
    ('/settings/period-locks', 'Period locks'),
  ]),
  ('Sales & billing', [
    ('/settings/templates', 'Templates & printing'),
    ('/settings/bluetooth-printer', 'Print & devices'),
    ('/settings/custom-fields', 'Custom fields'),
    ('/settings/number-series', 'Transaction number series'),
  ]),
  ('Online store', [
    ('/settings/online-store', 'Storefront'),
    ('/settings/online-store/orders', 'Store orders'),
    ('/settings/online-store/enquiries', 'Store enquiries'),
  ]),
  ('Inventory', [
    ('/settings/business#bp-features', 'Item defaults'),
    ('/settings/label-templates', 'Label templates'),
    ('/items/categories', 'Item categories'),
  ]),
  ('Billing tools', [
    ('/settings/offline-sync', 'Offline sync'),
    ('/settings/automation', 'Workflow automation'),
  ]),
  ('People', [
    ('/settings/departments', 'Departments & designations'),
    ('/settings/hr-employee', 'Employee management'),
    ('/settings/hr-exit', 'Exit process'),
    ('/settings/shifts', 'Shifts'),
    ('/hr/shifts/roster', 'Shift roster'),
    ('/settings/weekly-off', 'Weekly off'),
    ('/settings/holiday-lists', 'Holiday lists'),
    ('/settings/ot-policy', 'Overtime policy'),
    ('/settings/attendance-policy', 'Attendance policy'),
    ('/settings/attendance-regularization', 'Regularization'),
    ('/settings/leave-plan', 'Leave plan'),
    ('/settings/leave-types', 'Leave types'),
    ('/settings/hr-approval', 'HR approvals'),
    ('/settings/payroll', 'Payroll settings'),
    ('/settings/salary-components', 'Salary components'),
    ('/settings/commission-rules', 'Commission rules'),
    ('/settings/hiring', 'Hiring defaults'),
    ('/settings/onboarding-templates', 'Onboarding templates'),
    ('/settings/offer-letter', 'Offer letter template'),
    ('/settings/employee-portal', 'Portal & kiosk'),
  ]),
  ('WhatsApp', [
    ('/settings/whatsapp', 'Connection'),
    ('/settings/whatsapp/templates', 'Templates'),
    ('/settings/whatsapp/notifications', 'Notifications'),
    ('/settings/whatsapp/inbox', 'Inbox & team'),
    ('/settings/whatsapp/team', 'Agents'),
    ('/settings/whatsapp/ai-agent', 'AI agent'),
    ('/settings/whatsapp/shop', 'Shop'),
  ]),
  ('Integrations', [
    ('/settings/integrations', 'All integrations'),
    ('/settings/email', 'Email (SMTP)'),
    ('/settings/payments', 'Payment providers'),
    ('/settings/integrations?category=sms', 'SMS'),
  ]),
  ('System', [
    ('/settings/features', 'Appearance'),
    ('/settings/backup', 'Backup & restore'),
    ('/settings/export', 'Export'),
  ]),
  ('Help', [
    ('/settings/help', 'Help & support'),
    ('/settings/help/how-to', 'How-to guides'),
  ]),
];

/// Website pages that only redirect. Follow them so the phone does not call a missing API.
const _settingsRedirect = {
  '/settings/invoice': '/settings/templates',
  '/settings/gst-config': '/settings/business',
  '/settings/tax': '/settings/business',
  '/settings/signature': '/settings/business',
  '/settings/export': '/settings/backup',
};

/// Website pages with no GET the phone can list (forms, wizards, device setup).
/// Their path is the website href, so the phone offers to open them there.
const _webOnly = {
  '/employees/new',
  '/pricing/party-item',
  '/hr/leaves/year-end',
  '/hr/leaves/import-balances',
  '/whatsapp/send-message',
  '/settings/automation',
  '/settings/bluetooth-printer',
  '/settings/help',
  '/settings/help/how-to',
};

/// A page with no phone screen and no data to list: it opens on the website inside the app.
bool isWebsiteOnlyHref(String href) => _webOnly.contains(normalizeHref(href));

const toolLinks = <(String, String)>[
  ('/tools/todo', 'To Do List'),
  ('/tools/hsn-finder', 'HSN/SAC Finder'),
  ('/tools/gst-calculator', 'GST Calculator'),
  ('/tools/gstin-validator', 'GSTIN validator'),
  ('/tools/pan-validator', 'PAN validator'),
  ('/tools/discount-calculator', 'Discount calculator'),
  ('/tools/emi-calculator', 'EMI calculator'),
  ('/tools/interest-calculator', 'Interest calculator'),
  ('/tools/price-margin-calculator', 'Price margin'),
  ('/tools/tds-calculator', 'TDS calculator'),
  ('/tools/currency-converter', 'Currency converter'),
  ('/tools/invoice-number-generator', 'Invoice number'),
  ('/tools/google-lead-extractor', 'Lead Extractor'),
];

const appPages = <AppPage>[
  AppPage('/estimates', 'Quotations', '/api/estimates', listKey: 'estimates', estimate: true),
  AppPage('/orders', 'Orders & Delivery', '/api/orders', listKey: 'orders'),
  AppPage('/sales-orders', 'Sales Orders', '/api/sales-orders', listKey: 'salesOrders'),
  AppPage('/delivery-challans', 'Delivery Challans', '/api/delivery-challans', listKey: 'deliveryChallans'),
  AppPage('/work-orders', 'Work Orders', '/api/work-orders', listKey: 'workOrders'),
  AppPage('/credit-notes', 'Credit Notes', '/api/credit-notes', listKey: 'creditNotes'),
  AppPage('/debit-notes', 'Debit Notes', '/api/debit-notes', listKey: 'debitNotes'),
  AppPage('/credit-approvals', 'Credit approvals', '/api/credit-approvals/pending', listKey: 'approvals'),
  AppPage('/invoices/recurring', 'Recurring invoices', '/api/recurring-invoices', listKey: 'recurringInvoices'),
  AppPage('/recurring-invoices', 'Recurring invoices', '/api/recurring-invoices', listKey: 'recurringInvoices'),
  AppPage('/payments/out', 'Payments Out', '/api/payments?type=payable', listKey: 'payments'),
  AppPage('/payments/reconciliation', 'Payment reconciliation', '/api/payments?reconciliation=1', listKey: 'payment_transactions'),
  AppPage('/suppliers/hub', 'Suppliers Hub', '/api/suppliers/hub/directory', listKey: 'suppliers'),
  AppPage('/suppliers/requests', 'Requests to Fulfill', '/api/suppliers/hub/connection-requests', listKey: 'requests'),
  AppPage('/suppliers/dashboard', 'Supplier Dashboard', '/api/suppliers/dashboard'),
  AppPage('/purchases', 'All Purchases', '/api/purchases', listKey: 'purchases'),
  AppPage('/purchases/requests', 'Purchase requests', '/api/stock-requests', listKey: 'requests'),
  AppPage('/purchase-orders', 'Purchase Orders', '/api/purchase-orders', listKey: 'purchaseOrders'),
  AppPage('/purchase-returns', 'Purchase Returns', '/api/purchase-returns', listKey: 'purchaseReturns'),
  AppPage('/expenses', 'Expenses', '/api/expenses', listKey: 'expenses'),
  AppPage('/expenses/categories', 'Expense categories', '/api/expense-categories', listKey: 'categories'),
  AppPage('/pricing/party-item', 'Party Pricing', '/pricing/party-item'),
  AppPage('/items/categories', 'Item categories', '/api/categories', listKey: 'categories'),
  AppPage('/items/barcodes', 'Print Labels', '/api/label-templates', listKey: 'templates'),
  AppPage('/inventory-adjustments', 'Adjustments', '/api/inventory-adjustments', listKey: 'adjustments'),
  AppPage('/stock-transfers', 'Stock Transfers', '/api/stock-transfers', listKey: 'transfers'),
  AppPage('/accounts', 'Chart of Accounts', '/api/accounts', listKey: 'accounts'),
  AppPage('/journal-entries', 'Journal Entries', '/api/journal-entries', listKey: 'entries'),
  AppPage('/ledger', 'Ledger', '/api/ledger', listKey: 'entries', query: PageQuery.range),
  AppPage('/provisions', 'Provisions', '/api/provisions', listKey: 'provisions'),
  AppPage('/tds', 'TDS/TCS', '/api/tds/transactions', listKey: 'transactions'),
  AppPage('/tds/categories', 'TDS categories', '/api/tds/categories', listKey: 'categories'),
  AppPage('/contra', 'Contra', '/api/contra', listKey: 'entries'),
  AppPage('/advances', 'Advances', '/api/advances', listKey: 'advances'),
  AppPage('/fixed-assets', 'Fixed assets', '/api/fixed-assets', listKey: 'assets'),
  AppPage('/activity-logs', 'Activity Logs', '/api/activity-logs', listKey: 'logs'),
  AppPage('/reports', 'Reports', '/api/reports/sales/summary', query: PageQuery.range),
  AppPage('/reports/profit-loss', 'Profit & Loss', '/api/reports/profit-loss', query: PageQuery.range),
  AppPage('/reports/balance-sheet', 'Balance Sheet', '/api/reports/balance-sheet', query: PageQuery.range),
  AppPage('/reports/cash-flow', 'Cash Flow', '/api/reports/cash-flow', query: PageQuery.range),
  AppPage('/reports/trial-balance', 'Trial Balance', '/api/reports/trial-balance', query: PageQuery.range),
  AppPage('/reports/aging/receivables', 'Receivables Aging', '/api/reports/party/receivables', query: PageQuery.range),
  AppPage('/reports/aging/payables', 'Payables Aging', '/api/reports/party/payables', query: PageQuery.range),
  AppPage('/reports/gst/gstr1', 'GST Returns (GSTR-1)', '/api/reports/gst/gstr1', query: PageQuery.month),
  AppPage('/reports/gst/gstr3b', 'GSTR-3B', '/api/reports/gst/gstr3b', query: PageQuery.month),
  AppPage('/reports/gst/cash-ledger', 'GST Cash Ledger', '/api/gst/cash-ledger'),
  AppPage('/reports/gst/compliance', 'GST compliance', '/api/gst/compliance-alerts', listKey: 'alerts'),
  AppPage('/reports/sales/summary', 'Sales — Summary', '/api/reports/sales/summary', query: PageQuery.range),
  AppPage('/reports/purchase/summary', 'Purchase — Summary', '/api/reports/purchase/summary', query: PageQuery.range),
  AppPage('/reports/stock/summary', 'Stock Summary', '/api/reports/stock/summary', listKey: 'stock'),
  AppPage('/reports/stock/closing-stock', 'Closing Stock', '/api/reports/stock/closing-stock', query: PageQuery.financialYear),
  AppPage('/reports/stock/valuation', 'Stock valuation', '/api/reports/stock/valuation'),
  AppPage('/reports/builder', 'Custom Report Builder', '/api/reports/sales/summary', query: PageQuery.range),
  AppPage('/reports/credit-risk', 'Credit risk', '/api/reports/credit-risk'),
  AppPage('/employees', 'All Employees', '/api/employees', listKey: 'employees'),
  AppPage('/employees/attendance', 'Attendance', '/api/employees/attendance', listKey: 'attendance'),
  AppPage('/employees/leaves', 'Leaves', '/api/employees/leave-requests', listKey: 'requests'),
  AppPage('/employees/salary/payments', 'Salary Payments', '/api/employees/salary/payments', listKey: 'payments'),
  AppPage('/employees/salary/advances', 'Salary Advances', '/api/employees/salary/advances', listKey: 'advances'),
  AppPage('/employees/expenses', 'Employee Expenses', '/api/employees/expenses', listKey: 'expenses'),
  AppPage('/employees/commissions', 'Commissions', '/api/employees/commissions', listKey: 'commissions'),
  AppPage('/employees/tasks', 'Tasks', '/api/tasks', listKey: 'tasks'),
  AppPage('/employees/recruitment', 'Recruitment', '/api/hr/recruitment/jobs', listKey: 'jobs'),
  AppPage('/hr/dashboard', 'HR Dashboard', '/api/hr/dashboard/overview'),
  AppPage('/hr/shifts/roster', 'Shift roster', '/api/hr/shifts/roster', listKey: 'roster'),
  AppPage('/hr/shifts/bulk-assign', 'Bulk assign shifts', '/api/employees', listKey: 'employees'),
  AppPage('/hr/engagement', 'Engagement', '/api/hr/announcements'),
  AppPage('/employees/org-chart', 'Org chart', '/api/employees/org-chart'),
  AppPage('/employees/manager', 'Manager', '/api/employees/manager/dashboard'),
  AppPage('/employees/leaves/calendar', 'Leave calendar', '/api/employees/leave-calendar', listKey: 'leaves'),
  AppPage('/employees/performance', 'Performance', '/api/employees/performance'),
  AppPage('/bank/import', 'Bank import', '/api/bank-accounts', listKey: 'accounts'),
  AppPage('/bank/reconciliation', 'Bank reconciliation', '/api/bank/reconciliation'),
  AppPage('/hr/exits', 'Exits', '/api/hr/exits', listKey: 'exits'),
  AppPage('/hr/documents', 'HR Documents', '/api/hr/document-templates', listKey: 'templates'),
  AppPage('/hr/reports', 'HR Reports', '/api/hr/reports/statutory-ecr'),
  AppPage('/whatsapp/dashboard', 'WhatsApp Dashboard', '/api/whatsapp/dashboard/overview'),
  AppPage('/whatsapp/conversations', 'Conversations', '/api/whatsapp/conversations', listKey: 'conversations'),
  AppPage('/whatsapp/flows', 'Flows', '/api/whatsapp/flows', listKey: 'flows'),
  AppPage('/whatsapp/campaigns', 'Campaigns', '/api/whatsapp/campaigns', listKey: 'campaigns'),
  AppPage('/whatsapp/contacts', 'Contacts', '/api/whatsapp/contacts', listKey: 'contacts'),
  AppPage('/whatsapp/contacts/groups', 'Contact Groups', '/api/whatsapp/contact-groups', listKey: 'groups'),
  AppPage('/whatsapp/orders', 'Order Verification', '/api/whatsapp/orders', listKey: 'orders'),
  AppPage('/whatsapp/unsubscribes', 'Unsubscribes', '/api/whatsapp/unsubscribes', listKey: 'unsubscribes'),
  AppPage('/whatsapp/reminders', 'Payment Reminders', '/api/whatsapp/reminders', listKey: 'settings'),
  AppPage('/whatsapp/group-extractor', 'Group Extractor', '/api/tools/whatsapp-groups'),
  AppPage('/settings/whatsapp', 'WhatsApp Settings', '/api/whatsapp/status'),
  AppPage('/settings/branches', 'Branches', '/api/branches', listKey: 'branches'),
  AppPage('/settings/users', 'Users', '/api/settings/users', listKey: 'users'),
  AppPage('/settings/roles', 'Roles', '/api/settings/roles', listKey: 'roles'),
  AppPage('/settings/warehouses', 'Warehouses', '/api/warehouses', listKey: 'warehouses'),
  AppPage('/settings/financial-years', 'Financial years', '/api/financial-years', listKey: 'financialYears'),
  AppPage('/settings/period-locks', 'Period locks', '/api/period-locks', listKey: 'locks'),
  AppPage('/settings/subscription', 'Plan & billing', '/api/subscriptions/current'),
  AppPage('/settings/business', 'Business', '/api/businesses/current'),
  AppPage('/settings/templates', 'Templates', '/api/template-assignments', listKey: 'assignments'),
  AppPage('/settings/online-store', 'Online store', '/api/settings/online-store'),
  AppPage('/settings/online-store/enquiries', 'Store enquiries', '/api/settings/online-store/enquiries', listKey: 'enquiries'),
  AppPage('/settings/online-store/orders', 'Store orders', '/api/settings/online-store/orders', listKey: 'orders'),
  AppPage('/tools', 'All Tools', '/tools'),
  AppPage('/tools/todo', 'To Do List', '/api/todos', listKey: 'todos'),
  AppPage('/tools/hsn-finder', 'HSN/SAC Finder', '/api/hsn/lookup', tool: 'hsn'),
  AppPage('/tools/gst-calculator', 'GST Calculator', '/tools/gst-calculator', tool: 'gst'),
  AppPage('/tools/google-lead-extractor', 'Lead Extractor', '/api/tools/google-leads/search', tool: 'leads'),
  AppPage('/settings', 'Settings', '/settings'),
];

const _dedicated = {
  '/dashboard',
  '/invoices',
  '/invoices/new',
  '/invoices/[id]',
  '/invoices/[id]/view',
  '/invoices/[id]/edit',
  '/customers',
  '/customers/new',
  '/customers/[id]',
  '/customers/[id]/edit',
  '/customers/[id]/statement',
  '/items',
  '/items/new',
  '/items/[id]',
  '/payments/in',
  '/more',
  '/search',
  '/notifications',
  '/suppliers',
};

const _roots = {
  'accounts', 'activity-logs', 'advances', 'bank', 'connect', 'contra', 'credit-approvals', 'credit-notes',
  'debit-notes', 'delivery-challans', 'employees', 'estimates', 'expenses', 'fixed-assets', 'hr',
  'inventory-adjustments', 'invoices', 'items', 'journal-entries', 'ledger', 'opening-balances', 'orders',
  'payments', 'pricing', 'provisions', 'purchase-orders', 'purchase-returns', 'purchases', 'recurring-invoices',
  'reports', 'sales-orders', 'settings', 'stock-transfers', 'suppliers', 'tds', 'tools', 'upgrade', 'whatsapp',
  'work-orders',
};

const _rangeReports = {
  '/reports',
  '/reports/profit-loss',
  '/reports/balance-sheet',
  '/reports/cash-flow',
  '/reports/trial-balance',
  '/reports/aging/receivables',
  '/reports/aging/payables',
  '/reports/gst/cash-ledger',
  '/reports/sales/summary',
  '/reports/purchase/summary',
  '/reports/builder',
  '/reports/profit-by-invoice',
  '/reports/deleted',
  '/reports/inter-branch-reconciliation',
  '/ledger',
};

const _monthReports = {
  '/reports/gst/gstr1',
  '/reports/gst/gstr2b',
  '/reports/gst/gstr3b',
  '/reports/gst/gstr9',
  '/reports/gst/compliance',
  '/reports/gst/reconciliation',
  '/reports/gst/gstr2b-reconciliation',
};

/// `/api/businesses/current` is not a route. `[id]` would treat "current" as a
/// foreign business and reject it. The id must be the signed-in business.
String sessionBusinessPath(String path, String? businessId) {
  if (path != '/api/businesses/current') return path;
  final id = businessId?.trim() ?? '';
  if (id.isEmpty) return path;
  return '/api/businesses/$id';
}

String normalizeHref(String href) {
  final noQuery = href.split('?').first.split('#').first;
  return _settingsRedirect[noQuery] ?? noQuery;
}

AppPage? pageForHref(String href) {
  final clean = normalizeHref(href);
  if (clean.isEmpty || _dedicated.contains(clean)) return null;
  for (final page in appPages) {
    if (page.href == clean) return page;
  }
  final parts = clean.split('/').where((s) => s.isNotEmpty).toList();
  if (parts.isEmpty || !_roots.contains(parts.first)) return null;
  return AppPage(clean, _settingsTitle(clean) ?? _titleFromPath(clean), _apiFor(clean), query: _queryFor(clean), tool: _toolFor(clean), estimate: clean == '/estimates');
}

String? _settingsTitle(String href) {
  for (final section in settingsSections) {
    for (final link in section.$2) {
      if (link.$1 == href) return link.$2;
    }
  }
  return null;
}

String _titleFromPath(String href) {
  final parts = href.split('/').where((s) => s.isNotEmpty && !s.startsWith('[')).toList();
  if (parts.isEmpty) return 'Page';
  final raw = parts.last.replaceAll('-', ' ');
  return raw[0].toUpperCase() + raw.substring(1);
}

String _apiFor(String href) {
  if (_webOnly.contains(href)) return href;
  var path = href;
  if (path.endsWith('/new')) path = path.substring(0, path.length - 4);
  path = path.replaceAll('/edit', '');
  path = path.replaceAll('[reportType]', 'summary');
  path = path.replaceAll(RegExp(r'/\[[^/]+\]'), '');
  if (path.isEmpty) path = href;
  if (path == '/settings' || path == '/tools' || path == '/upgrade' || _webOnly.contains(path)) return path;
  final settingsApi = _settingsApi(path);
  if (settingsApi != null) return settingsApi;
  if (path.startsWith('/settings/whatsapp')) return '/api/whatsapp/inbox-settings';
  if (path.startsWith('/settings/online-store')) return '/api/settings/online-store';
  if (path == '/payments/out') return '/api/payments?type=payable';
  if (path == '/reports/deleted') return '/api/reports/deleted-items';
  if (path == '/reports/gst/gstr2b-reconciliation') return '/api/gst/gstr2b/reconcile';
  if (path == '/whatsapp/who-to-message') return '/api/whatsapp/who-to-message';
  return '/api$path';
}

/// Real GET for a settings screen. Null means the path is not a settings page.
String? _settingsApi(String href) => switch (href) {
      '/settings/business' => '/api/businesses/current',
      '/settings/templates' => '/api/template-assignments',
      '/settings/number-series' => '/api/settings/number-series',
      '/settings/payments' => '/api/settings/payment-providers',
      '/settings/users' => '/api/settings/users',
      '/settings/user-management' => '/api/settings/user-management',
      '/settings/roles' => '/api/settings/roles',
      '/settings/user-branches' => '/api/user-branches',
      '/settings/user-warehouses' => '/api/user-warehouses',
      '/settings/warehouses' => '/api/warehouses',
      '/settings/branches' => '/api/branches',
      '/settings/subscription' => '/api/subscriptions/current',
      '/settings/products' => '/api/modules',
      '/settings/features' => '/api/settings/portal-theme',
      '/settings/period-locks' => '/api/period-locks',
      '/settings/financial-years' => '/api/financial-years',
      '/settings/account-mappings' => '/api/settings/account-mappings',
      '/settings/custom-fields' => '/api/custom-fields',
      '/settings/email' || '/settings/integrations' => '/api/settings/email',
      '/settings/activity' => '/api/settings/activity-logs',
      '/settings/whatsapp' => '/api/whatsapp/status',
      '/settings/whatsapp/inbox' => '/api/whatsapp/inbox-settings',
      '/settings/whatsapp/team' => '/api/settings/users',
      '/settings/whatsapp/ai-agent' => '/api/ai-agent',
      '/settings/whatsapp/templates' => '/api/settings/whatsapp-templates',
      '/settings/whatsapp/notifications' => '/api/whatsapp/reminders',
      '/settings/whatsapp/shop' => '/api/whatsapp/shop',
      '/settings/online-store' => '/api/settings/online-store',
      '/settings/online-store/enquiries' => '/api/settings/online-store/enquiries',
      '/settings/label-templates' => '/api/label-templates',
      '/settings/suppliers-directory' => '/api/suppliers/hub/discovery',
      '/settings/departments' => '/api/settings/hr-org-catalog',
      '/settings/shifts' => '/api/shifts',
      '/settings/weekly-off' => '/api/settings/weekly-off',
      '/settings/holiday-lists' => '/api/settings/holiday-lists',
      '/settings/ot-policy' => '/api/settings/ot-policy',
      '/settings/attendance-policy' => '/api/settings/attendance-policy',
      '/settings/attendance-regularization' => '/api/settings/attendance-regularization',
      '/settings/leave-plan' => '/api/settings/leave-plan',
      '/settings/leave-types' => '/api/leave-types',
      '/settings/hr-approval' => '/api/settings/hr-approval',
      '/settings/hr-employee' => '/api/settings/hr-employee',
      '/settings/hr-exit' => '/api/settings/hr-exit',
      '/settings/hiring' => '/api/settings/hr-hiring',
      '/settings/employee-portal' => '/api/settings/hr-portal',
      '/settings/payroll' => '/api/settings/hr-payroll',
      '/settings/salary-components' => '/api/settings/salary-components',
      '/settings/commission-rules' => '/api/commission-rules',
      '/settings/onboarding-templates' => '/api/hr/onboarding-templates',
      '/settings/offer-letter' => '/api/settings/offer-letter-template',
      '/settings/offline-sync' => '/api/offline-sync/history?limit=50',
      '/settings/backup' => '/api/backup/history?limit=10',
      '/settings/holidays' => '/api/holidays',
      _ => null,
    };

PageQuery _queryFor(String href) {
  final base = href.replaceAll(RegExp(r'/\[[^/]+\]'), '');
  if (_monthReports.contains(base)) return PageQuery.month;
  if (base == '/reports/stock/closing-stock') return PageQuery.financialYear;
  if (_rangeReports.contains(base) || base.startsWith('/reports/sales/') || base.startsWith('/reports/purchase/')) return PageQuery.range;
  return PageQuery.none;
}

String? _toolFor(String href) => switch (href) {
      '/tools/hsn-finder' => 'hsn',
      '/tools/gst-calculator' => 'gst',
      '/tools/google-lead-extractor' => 'leads',
      '/tools/gstin-validator' => 'gstin',
      '/tools/pan-validator' => 'pan',
      '/tools/discount-calculator' => 'discount',
      '/tools/emi-calculator' => 'emi',
      '/tools/interest-calculator' => 'interest',
      '/tools/price-margin-calculator' => 'margin',
      '/tools/tds-calculator' => 'tds',
      '/tools/currency-converter' => 'currency',
      '/tools/invoice-number-generator' => 'invoice-number',
      _ => null,
    };

const _titleKeys = [
  'credit_note_number',
  'debit_note_number',
  'invoice_number',
  'bill_number',
  'order_number',
  'voucher_number',
  'account_name',
  'item_name',
  'product_name',
  'employee_name',
  'party_name',
  'name',
  'title',
  'customer_name',
  'supplier_name',
  'description',
  'user_name',
  'phone',
  'code',
  'reference_number',
  'order_payment_reference',
  'utr',
  'provider',
  'payment_mode',
  'payment_method',
  'sale_type',
  'status_category',
  'hsn_code',
  'tax_rate',
  'gst_rate',
  'label',
  'period',
  'month',
  'date',
];

const _amountKeys = ['grand_total', 'amount', 'balance', 'total', 'stock_value', 'net_profit'];

String recordTitle(Map<String, dynamic> row) {
  for (final key in _titleKeys) {
    final value = row[key]?.toString();
    if (value == null || value.isEmpty) continue;
    if (key.endsWith('_rate')) return '${formatField(key, row[key]) ?? value}% GST';
    return formatField(key, row[key]) ?? value;
  }
  return fallbackTitle(row) ?? 'Record';
}

String? recordAmount(Map<String, dynamic> row) {
  for (final key in _amountKeys) {
    final value = row[key];
    if (value == null || value == '' || value is Map || value is List) continue;
    return value.toString();
  }
  return null;
}

List<Map<String, dynamic>> recordsFromBody(dynamic body, String? listKey) {
  if (body is List) {
    return body.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }
  if (body is! Map) return const [];
  final map = Map<String, dynamic>.from(body);
  if (listKey != null && map[listKey] is List) {
    return (map[listKey] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }
  for (final value in map.values) {
    if (value is List && value.whereType<Map>().isNotEmpty) {
      return value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    }
  }
  if (map['error'] == null && map.isNotEmpty && !_isEmptyListEnvelope(map)) return [map];
  return const [];
}

/// `{items: [], pagination: {...}}`: an empty list with paging metadata, not a record to show.
const _envelopeKeys = {'pagination', 'meta', 'success', 'total', 'count', 'page', 'limit', 'message', 'scope', 'filters', 'summary', 'totals'};

bool _isEmptyListEnvelope(Map<String, dynamic> map) {
  final hasEmptyList = map.values.any((v) => v is List && v.isEmpty);
  if (!hasEmptyList) return false;
  return map.entries.every((e) => (e.value is List && (e.value as List).isEmpty) || _envelopeKeys.contains(e.key));
}

/// A dashboard or report object (headline numbers, not just a wrapped list), shown whole.
bool isReportObject(dynamic body) {
  if (body is! Map || body.isEmpty || body['error'] != null) return false;
  return body.entries.any((e) {
    final key = e.key.toString();
    if (_envelopeKeys.contains(key) && key != 'summary' && key != 'totals') return false;
    final value = e.value;
    if (value is List || value == null || isTechnicalKey(key, value)) return false;
    if (value is Map) return plainFields(Map<String, dynamic>.from(value)).isNotEmpty;
    return formatField(key, value) != null;
  });
}
