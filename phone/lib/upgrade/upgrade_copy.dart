import '../api.dart';

/// Port of `lib/upgrade/upgrade-request.ts` and `lib/upgrade/upgrade-copy.ts`: the phone sheet
/// says exactly what the website popup says (docs/plan/UNIFIED_UPGRADE_POPUP.md).
/// The two maps below are generated from the web files; keep them in step.

enum UpgradeVariant { feature, limit, addon, trial, web }

const addonFeatureKeys = {'integration_whatsapp_bot', 'integration_whatsapp_manual', 'whatsapp_bot', 'whatsapp_send_message'};

class UpgradeRequest {
  const UpgradeRequest(this.variant, {this.featureKey, this.featureName, this.limitType, this.current, this.limit, this.trialDaysLeft});

  final UpgradeVariant variant;
  final String? featureKey;
  final String? featureName;
  final String? limitType;
  final int? current;
  final int? limit;
  final int? trialDaysLeft;

  /// Same key = same sheet, for "Maybe later".
  String get key => '${variant.name}:${featureKey ?? limitType ?? ''}';

  /// The sheet to open for a refused request, or null. Only writes count.
  static UpgradeRequest? fromApi(String method, ApiException e) {
    if (!const {'POST', 'PUT', 'PATCH', 'DELETE'}.contains(method.toUpperCase()) || e.status != 403) return null;
    final body = e.body;
    if (e.code == 'FEATURE_NOT_IN_PLAN' || e.code == 'FEATURE_NOT_AVAILABLE') {
      final feature = body['feature'] is String ? body['feature'] as String : null;
      return UpgradeRequest(
        feature != null && addonFeatureKeys.contains(feature) ? UpgradeVariant.addon : UpgradeVariant.feature,
        featureKey: feature,
      );
    }
    if (e.code == 'SUBSCRIPTION_LIMIT_EXCEEDED') {
      int? n(Object? v) => v is num ? v.toInt() : null;
      return UpgradeRequest(
        UpgradeVariant.limit,
        limitType: body['limit_type'] is String ? body['limit_type'] as String : null,
        limit: n(body['limit']),
        current: n(body['current']),
      );
    }
    return null;
  }
}

class RecommendedPlan {
  const RecommendedPlan({required this.planId, required this.planLabel, required this.priceMonthly, this.planLimit});
  final String planId;
  final String planLabel;
  final num priceMonthly;
  final int? planLimit;
}

enum UpgradeArt { bill, users, chat, cal, laptop }

enum UpgradeBadge { lock, full, plus, clock }

class UpgradeChip {
  const UpgradeChip(this.icon, this.title, this.subtitle);
  final String icon;
  final String title;
  final String subtitle;
}

class UpgradeCopy {
  const UpgradeCopy({
    required this.tag,
    required this.title,
    required this.body,
    required this.art,
    required this.badge,
    required this.chips,
    required this.tiles,
    required this.benefits,
    required this.ctaLabel,
    required this.laterLabel,
  });
  final String tag;
  final String title;
  final String body;
  final UpgradeArt art;
  final UpgradeBadge badge;
  final List<UpgradeChip> chips;
  final List<String> tiles;
  final List<String> benefits;
  final String ctaLabel;
  final String laterLabel;
}

const featureLabels = <String, String>{
  'template_customization': 'Template customization',
  'recurring_invoices': 'Recurring invoices',
  'email_invoicing': 'Email invoicing',
  'estimates_quotations': 'Estimates and quotations',
  'credit_notes': 'Credit notes',
  'debit_notes': 'Debit notes',
  'multi_branch': 'Multi-branch',
  'multi_warehouse': 'Multi-warehouse',
  'purchase_management': 'Purchase management',
  'expense_tracking': 'Expense tracking',
  'supplier_management': 'Supplier management',
  'purchase_supplier_hub': 'Supplier Hub',
  'reports_basic': 'Basic reports',
  'reports_gst': 'GST reports',
  'reports_advanced': 'Advanced reports',
  'backup_restore': 'Backup and restore',
  'customizable_dashboard': 'Customizable dashboard',
  'dead_stock_widget': 'Dead stock insights',
  'party_pricing': 'Party-wise pricing',
  'whatsapp_auto_reminders': 'WhatsApp auto reminders',
  'barcode_label_printing': 'Barcode label printing',
  'items_scan_onboarding': 'Scan and add items',
  'barcode_label_from_purchase': 'Labels from purchase',
  'barcode_thermal_printer': 'Thermal printing',
  'report_builder': 'Custom report builder',
  'settings_backup': 'Backup and restore',
  'settings_document_language': 'Print language',
  'soft_delete': 'Recycle bin restore',
  'eway_bill': 'E-way bills',
  'integration_email': 'Email invoices',
  'profit_reports_basic': 'Profit by invoice',
  'profit_invoice': 'Profit on every bill',
  'settings_multi_business': 'More than one business',
  'multi_business': 'More than one business',
  'advanced_multi_currency': 'Foreign currency bills',
  'multi_currency': 'Foreign currency bills',
  'settings_multi_warehouse': 'Warehouses',
  'settings_multi_branch': 'Branches',
  'settings_multi_user': 'More users',
  'settings_template_customization': 'Template customisation',
  'settings_pos_mode': 'POS mode',
  'sales_invoices': 'Invoices',
  'sales_estimates': 'Estimates',
  'sales_credit_notes': 'Credit notes',
  'sales_debit_notes': 'Debit notes',
  'sales_delivery_challans': 'Delivery challans',
  'sales_recurring_invoices': 'Recurring invoices',
  'sales_sales_orders': 'Sales orders',
  'sales_work_orders': 'Work orders',
  'purchase_orders': 'Purchase orders',
  'purchase_expenses': 'Expenses',
  'purchase_suppliers': 'Suppliers',
  'purchase_inventory_adjustments': 'Stock adjustments',
  'advanced_ledger': 'Ledger',
  'accounting_chart': 'Chart of accounts',
  'accounting_bank': 'Bank accounts',
  'accounting_tds': 'TDS',
  'accounting_budgets': 'Budgets',
  'accounting_provisions': 'Provisions',
  'accounting_credit_approvals': 'Credit approvals',
  'advanced_online_store': 'Online store',
  'advanced_custom_branding': 'Your own branding on bills',
  'advanced_barcode': 'Barcode scanning',
  'barcode_label_templates': 'Label templates',
  'integration_whatsapp_bot': 'WhatsApp inbox',
  'integration_whatsapp_manual': 'WhatsApp messages',
  'settings_whatsapp': 'WhatsApp settings',
  'workflow_automation': 'Automation',
  'period_lock': 'Period lock',
  'web_access': 'Khatario on a computer',
  'tools_todo': 'To-dos',
  'hr_attendance': 'Staff attendance',
  'hr_payroll': 'Payroll',
  'hr_leaves': 'Leave',
  'hr_shifts': 'Shifts',
  'hr_recruitment': 'Hiring',
  'hr_employee_portal': 'Employee portal',
  'hr_staff_app': 'Staff app',
};

typedef LimitNoun = ({String noun, String one, String? period});

const limitNouns = <String, LimitNoun>{
  'invoices': (noun: 'invoices', one: 'invoice', period: 'month'),
  'customers': (noun: 'customers', one: 'customer', period: null),
  'items': (noun: 'items', one: 'item', period: null),
  'users': (noun: 'users', one: 'user', period: null),
  'connect_agents': (noun: 'inbox seats', one: 'inbox seat', period: null),
  'whatsapp': (noun: 'WhatsApp messages', one: 'WhatsApp message', period: 'day'),
  'employees': (noun: 'employees', one: 'employee', period: null),
  'attendance': (noun: 'attendance records', one: 'attendance record', period: 'month'),
  'leave_requests': (noun: 'leave requests', one: 'leave request', period: 'month'),
  'payroll': (noun: 'payroll records', one: 'payroll record', period: 'month'),
  'suppliers': (noun: 'suppliers', one: 'supplier', period: null),
  'purchases': (noun: 'purchases', one: 'purchase', period: 'month'),
  'expenses': (noun: 'expenses', one: 'expense', period: 'month'),
  'estimates': (noun: 'estimates', one: 'estimate', period: 'month'),
  'credit_notes': (noun: 'credit notes', one: 'credit note', period: 'month'),
  'sales_orders': (noun: 'sales orders', one: 'sales order', period: 'month'),
  'purchase_orders': (noun: 'purchase orders', one: 'purchase order', period: 'month'),
  'branches': (noun: 'branches', one: 'branch', period: null),
  'departments': (noun: 'departments', one: 'department', period: null),
  'email': (noun: 'emails', one: 'email', period: 'day'),
  'salary_advances': (noun: 'salary advances', one: 'salary advance', period: null),
  'employee_expenses': (noun: 'staff expenses', one: 'staff expense', period: null),
  'commissions': (noun: 'commissions', one: 'commission', period: null),
  'employee_tasks': (noun: 'staff tasks', one: 'staff task', period: null),
  'holidays': (noun: 'holidays', one: 'holiday', period: null),
  'shifts': (noun: 'shifts', one: 'shift', period: null),
  'designations': (noun: 'designations', one: 'designation', period: null),
  'performance_reviews': (noun: 'performance reviews', one: 'performance review', period: null),
};

String featureDisplayName(String? key) {
  final k = key?.trim() ?? '';
  if (k.isEmpty) return 'This feature';
  final label = featureLabels[k];
  if (label != null) return label;
  final words = k.replaceAll('_', ' ').toLowerCase();
  return words[0].toUpperCase() + words.substring(1);
}

const _safe = "Everything you've made stays as it is.";

String _plural(int n, String one, String many) => '$n ${n == 1 ? one : many}';

String _cta(RecommendedPlan? plan) => plan == null ? 'See plans' : 'Upgrade to ${plan.planLabel}';

UpgradeCopy buildUpgradeCopy(UpgradeRequest req, RecommendedPlan? plan) {
  String? name() {
    final n = req.featureName?.trim();
    if (n != null && n.isNotEmpty) return n;
    final k = req.featureKey?.trim();
    return k == null || k.isEmpty ? null : featureDisplayName(k);
  }

  switch (req.variant) {
    case UpgradeVariant.limit:
      final nouns = req.limitType == null ? null : limitNouns[req.limitType];
      final limit = req.limit;
      var title = "Sorry, you've reached your plan's limit";
      if (nouns != null && limit != null && limit >= 0) {
        if (req.limitType == 'users' || req.limitType == 'connect_agents') {
          title = 'Sorry, your plan has room for ${_plural(limit, nouns.one, nouns.noun)}';
        } else {
          final when = nouns.period == 'month' ? ' this month' : nouns.period == 'day' ? ' today' : '';
          title = "Sorry, you've used all $limit ${limit == 1 ? nouns.one : nouns.noun}$when";
        }
      }
      final people = const {'users', 'employees', 'connect_agents'}.contains(req.limitType);
      final reopens = nouns?.period == 'month' ? ' It opens again next month, or upgrade to keep going today.' : '';
      final onPlan = plan == null
          ? 'More on a higher plan'
          : (plan.planLimit == null || plan.planLimit == -1)
              ? 'Unlimited on ${plan.planLabel}'
              : '${plan.planLimit} ${nouns?.noun ?? ''} on ${plan.planLabel}';
      return UpgradeCopy(
        tag: 'Limit reached',
        title: title,
        body: '$_safe$reopens',
        art: people ? UpgradeArt.users : UpgradeArt.bill,
        badge: UpgradeBadge.full,
        chips: [
          UpgradeChip(people ? 'users' : 'chart', nouns == null ? 'More room' : nouns.noun[0].toUpperCase() + nouns.noun.substring(1), onPlan),
          UpgradeChip('lock', req.current != null && limit != null ? '${req.current} of $limit used' : 'Limit reached', 'On your plan'),
        ],
        tiles: const ['chart', 'rupee'],
        benefits: const [],
        ctaLabel: _cta(plan),
        laterLabel: 'Maybe later',
      );
    case UpgradeVariant.addon:
      final named = name();
      final who = named != null && !named.toLowerCase().contains('connect') ? named : 'this';
      return UpgradeCopy(
        tag: 'Add-on',
        title: 'Sorry, $who needs Khatario Connect',
        body: 'Connect is an add-on that works with any plan. Your billing stays exactly as it is.',
        art: UpgradeArt.chat,
        badge: UpgradeBadge.plus,
        chips: const [UpgradeChip('chat', 'Shared inbox', 'For your team'), UpgradeChip('bolt', 'Auto replies', 'WhatsApp bot')],
        tiles: const ['users', 'check'],
        benefits: const ['One shared inbox for your team', 'Auto replies and a WhatsApp bot', 'Campaigns on your own number'],
        ctaLabel: 'Add Khatario Connect',
        laterLabel: 'Maybe later',
      );
    case UpgradeVariant.trial:
      final days = req.trialDaysLeft ?? 0;
      return UpgradeCopy(
        tag: 'Trial',
        title: days < 0
            ? 'Your free trial has ended'
            : days == 0
                ? 'Your free trial ends today'
                : 'Your free trial ends in ${_plural(days, 'day', 'days')}',
        body: days < 0
            ? 'Pick a plan to get every feature back. Your data stays safe.'
            : "Pick a plan now so nothing stops. If you don't, the business moves to Free and your data stays safe.",
        art: UpgradeArt.cal,
        badge: UpgradeBadge.clock,
        chips: [
          UpgradeChip('clock', days < 0 ? 'Trial ended' : '${_plural(days, 'day', 'days')} left', 'Free trial'),
          const UpgradeChip('check', 'Data stays safe', 'Always'),
        ],
        tiles: const ['rupee', 'box'],
        benefits: const [],
        ctaLabel: 'Choose a plan',
        laterLabel: 'Remind me tomorrow',
      );
    case UpgradeVariant.web:
    case UpgradeVariant.feature:
      final n = name();
      return UpgradeCopy(
        tag: 'Not in your plan',
        title: "Sorry, ${n ?? 'this feature'} isn't in your plan",
        body: plan == null ? _safe : 'It comes with ${plan.planLabel}. $_safe',
        art: UpgradeArt.bill,
        badge: UpgradeBadge.lock,
        chips: [
          UpgradeChip('chart', n ?? 'More features', 'Unlock it today'),
          UpgradeChip('rupee', plan == null ? 'On a higher plan' : 'With ${plan.planLabel}', plan == null ? 'See plans' : '₹${plan.priceMonthly}/month'),
        ],
        tiles: const ['box', 'users'],
        benefits: const [],
        ctaLabel: _cta(plan),
        laterLabel: 'Maybe later',
      );
  }
}

/// "Maybe later" in the app: the same sheet stays away until the end of the day.
class UpgradeSnooze {
  final _until = <String, String>{};

  static String _day(DateTime now) => '${now.year}-${now.month}-${now.day}';

  void snooze(UpgradeRequest req, DateTime now) => _until[req.key] = _day(now);

  bool isSnoozed(UpgradeRequest req, DateTime now) => _until[req.key] == _day(now);
}
