import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../pages/page_catalog.dart';
import '../pages/record_page.dart';
import 'map_form_screen.dart';
import 'plan_billing_screen.dart';
import 'printers_screen.dart';
import 'settings_kit.dart';

/// Opens a phone settings screen for a website href. Returns false when this href has no screen.
bool openPhoneSetting(BuildContext context, AppSession session, String href) {
  final page = phoneSettingPage(session, href);
  if (page == null) return false;
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  return true;
}

String _clean(String href) => href.split('?').first.split('#').first;

Widget? phoneSettingPage(AppSession session, String href) {
  if (href.contains('bp-payments')) return _BanksScreen(session: session);
  final path = _clean(href);
  final query = href.contains('?') ? href.split('?').last : '';
  return switch (path) {
    '/settings/branches' => _BranchesScreen(session: session),
    '/settings/warehouses' => _WarehousesScreen(session: session),
    '/settings/financial-years' => _YearsScreen(session: session),
    '/settings/period-locks' => _LocksScreen(session: session),
    '/settings/account-mappings' => _MappingsScreen(session: session),
    '/settings/users' || '/employees' => _UsersScreen(session: session),
    '/settings/roles' => _RolesScreen(session: session),
    '/settings/whatsapp/team' => _UsersScreen(session: session, agents: true),
    '/settings/activity' => JsonListScreen(
        session: session,
        title: 'Activity log',
        blurb: 'Who changed what, and when.',
        path: '/api/settings/activity-logs',
        listKey: 'logs',
        titleOf: (r) => r['action']?.toString() ?? r['description']?.toString() ?? 'Activity',
        subtitleOf: (r) => [r['user_name'], r['created_at']].where((v) => v != null && '$v'.isNotEmpty).join(' · '),
      ),
    '/settings/whatsapp' => _WhatsAppLinkScreen(session: session),
    '/settings/whatsapp/templates' => JsonListScreen(
        session: session,
        title: 'Message templates',
        blurb: 'Approved wording for invoices and updates.',
        path: '/api/settings/whatsapp-templates',
        listKey: 'templates',
        titleOf: (r) => r['name']?.toString() ?? r['template_name']?.toString() ?? 'Template',
        subtitleOf: (r) => r['status']?.toString() ?? r['category']?.toString() ?? '',
      ),
    '/settings/whatsapp/inbox' => MapFormScreen(
        session: session,
        title: 'Inbox & team',
        blurb: 'Chats close themselves after a reply when this is on.',
        loadPath: '/api/whatsapp/inbox-settings',
        savePath: '/api/whatsapp/inbox-settings',
        verb: SaveVerb.put,
        fields: const [FormFieldSpec('auto_resolve_enabled', 'Close chats after a reply', kind: FormKind.toggle)],
      ),
    '/settings/whatsapp/ai-agent' => MapFormScreen(
        session: session,
        title: 'AI agent',
        blurb: 'How the agent greets people and what it is allowed to say.',
        loadPath: '/api/ai-agent',
        savePath: '/api/ai-agent',
        readKey: 'settings',
        verb: SaveVerb.put,
        wrapKey: 'settings',
        merge: true,
        fields: const [
          FormFieldSpec('agentName', 'Name'),
          FormFieldSpec('greetingMessage', 'Greeting'),
          FormFieldSpec('businessSummary', 'About the business'),
          FormFieldSpec('instructions', 'Instructions'),
          FormFieldSpec('fallbackMessage', 'When it does not know'),
        ],
      ),
    '/settings/whatsapp/notifications' => const _NotificationsNote(),
    '/settings/whatsapp/shop' => MapFormScreen(
        session: session,
        title: 'WhatsApp shop',
        blurb: 'What customers can browse and the welcome message.',
        loadPath: '/api/whatsapp/shop',
        savePath: '/api/whatsapp/shop',
        readKey: 'settings',
        verb: SaveVerb.put,
        fields: const [
          FormFieldSpec('enabled', 'Shop is on', kind: FormKind.toggle),
          FormFieldSpec('itemScope', 'Items', kind: FormKind.choice, options: [('all', 'All items'), ('store', 'Store items only')]),
          FormFieldSpec('hideOutOfStock', 'Hide items that are out of stock', kind: FormKind.toggle),
          FormFieldSpec('welcomeText', 'Welcome message'),
          FormFieldSpec('metaCatalogId', 'Catalog id'),
        ],
      ),
    '/settings/email' => MapFormScreen(
        session: session,
        title: 'Email',
        blurb: 'Send invoices from your own address. Leave the password blank to keep the saved one.',
        loadPath: '/api/settings/email',
        savePath: '/api/settings/email',
        readKey: 'config',
        verb: SaveVerb.put,
        fields: const [
          FormFieldSpec('enabled', 'Send email from my address', kind: FormKind.toggle),
          FormFieldSpec('from_name', 'From name'),
          FormFieldSpec('from_email', 'From address'),
          FormFieldSpec('reply_to_email', 'Reply-to'),
          FormFieldSpec('smtp_host', 'Mail server'),
          FormFieldSpec('smtp_port', 'Port', kind: FormKind.number),
          FormFieldSpec('smtp_user', 'Username'),
          FormFieldSpec('smtp_password', 'Password'),
          FormFieldSpec('smtp_secure', 'Secure connection', kind: FormKind.toggle),
        ],
      ),
    '/settings/integrations' when query.contains('sms') => const _SmsScreen(),
    '/settings/payments' => _GatewaysScreen(session: session),
    '/settings/shifts' => _ShiftsScreen(session: session),
    '/settings/weekly-off' => _WeeklyOffScreen(session: session),
    '/settings/holiday-lists' => _HolidaysScreen(session: session),
    '/settings/attendance-policy' => MapFormScreen(
        session: session,
        title: 'Late & absence',
        blurb: 'Grace time, free lates, and how a late day is deducted.',
        loadPath: '/api/settings/attendance-policy',
        savePath: '/api/settings/attendance-policy',
        readKey: 'policy',
        fields: const [
          FormFieldSpec('late_detection_mode', 'How lateness is spotted', kind: FormKind.choice, options: [('none', 'Do not mark late'), ('shift_checkin', 'From the shift'), ('manual_only', 'Only when someone marks it'), ('both', 'Shift and manual')]),
          FormFieldSpec('grace_minutes', 'Grace minutes', kind: FormKind.number),
          FormFieldSpec('free_lates_per_month', 'Free lates each month', kind: FormKind.number),
          FormFieldSpec('late_deduction_enabled', 'Deduct for being late', kind: FormKind.toggle),
          FormFieldSpec('late_deduction_mode', 'Deduction', kind: FormKind.choice, options: [('none', 'None'), ('fixed_amount', 'A fixed amount'), ('day_fraction', 'Part of a day')]),
          FormFieldSpec('late_fixed_amount', 'Fixed amount (₹)', kind: FormKind.number),
          FormFieldSpec('late_day_fraction', 'Day fraction', kind: FormKind.number),
          FormFieldSpec('half_day_lwp_enabled', 'Half day is unpaid', kind: FormKind.toggle),
          FormFieldSpec('absent_lwp_enabled', 'Absent day is unpaid', kind: FormKind.toggle),
        ],
      ),
    '/settings/ot-policy' => MapFormScreen(
        session: session,
        title: 'Overtime',
        blurb: 'Notice, back-dated overtime, and whether a reason is required.',
        loadPath: '/api/settings/ot-policy',
        savePath: '/api/settings/ot-policy',
        readKey: 'policy',
        fields: const [
          FormFieldSpec('name', 'Policy name'),
          FormFieldSpec('prior_notice_days', 'Days of notice', kind: FormKind.number),
          FormFieldSpec('allow_backdated', 'Allow back-dated overtime', kind: FormKind.toggle),
          FormFieldSpec('require_justification', 'Ask for a reason', kind: FormKind.toggle),
        ],
      ),
    '/settings/attendance-regularization' => MapFormScreen(
        session: session,
        title: 'Attendance corrections',
        blurb: 'Staff can ask to fix a missing or wrong punch.',
        loadPath: '/api/settings/attendance-regularization',
        savePath: '/api/settings/attendance-regularization',
        readKey: 'settings',
        fields: const [
          FormFieldSpec('enabled', 'Allow corrections', kind: FormKind.toggle),
          FormFieldSpec('allow_missing_punch', 'Missing punch', kind: FormKind.toggle),
          FormFieldSpec('allow_override_existing', 'Change an existing punch', kind: FormKind.toggle),
          FormFieldSpec('allow_delete_logs', 'Delete a punch', kind: FormKind.toggle),
          FormFieldSpec('max_requests_per_month', 'Requests allowed each month', kind: FormKind.number, help: 'Leave empty for no limit.'),
          FormFieldSpec('max_backdate_days', 'How many days back', kind: FormKind.number),
          FormFieldSpec('require_reason', 'Ask for a reason', kind: FormKind.toggle),
        ],
      ),
    '/settings/leave-plan' => MapFormScreen(
        session: session,
        title: 'Leave plan',
        blurb: 'The plan name and the month the leave year starts.',
        loadPath: '/api/settings/leave-plan',
        savePath: '/api/settings/leave-plan',
        readKey: 'plan',
        fields: const [
          FormFieldSpec('name', 'Plan name'),
          FormFieldSpec('calendar_year_start_month', 'Leave year starts in month', kind: FormKind.number, help: '1 is January, 4 is April.'),
        ],
      ),
    '/settings/hr-approval' => MapFormScreen(
        session: session,
        title: 'Approvals',
        blurb: 'Who can approve leave and expenses.',
        loadPath: '/api/settings/hr-approval',
        savePath: '/api/settings/hr-approval',
        readKey: 'settings',
        fields: const [
          FormFieldSpec('leave_mode', 'Leave', kind: FormKind.choice, options: [('permission_any', 'Anyone with permission'), ('manager_direct_reports', 'The manager, for their team'), ('manager_only', 'Only the manager')]),
          FormFieldSpec('expense_mode', 'Expenses', kind: FormKind.choice, options: [('permission_any', 'Anyone with permission'), ('manager_direct_reports', 'The manager, for their team'), ('manager_only', 'Only the manager')]),
          FormFieldSpec('allow_hr_override', 'HR can approve anyway', kind: FormKind.toggle),
        ],
      ),
    '/settings/payroll' => MapFormScreen(
        session: session,
        title: 'Payroll',
        blurb: 'Pay day, PF, ESI and professional tax.',
        loadPath: '/api/settings/hr-payroll',
        savePath: '/api/settings/hr-payroll',
        readKey: 'settings',
        fields: const [
          FormFieldSpec('monthly_pay_day', 'Pay day of the month', kind: FormKind.number),
          FormFieldSpec('pf_enabled', 'Provident fund', kind: FormKind.toggle),
          FormFieldSpec('pf_establishment_id', 'PF establishment id'),
          FormFieldSpec('pf_employee_rate', 'Employee PF %', kind: FormKind.number),
          FormFieldSpec('pf_employer_rate', 'Employer PF %', kind: FormKind.number),
          FormFieldSpec('pf_wage_ceiling', 'PF wage ceiling', kind: FormKind.number),
          FormFieldSpec('esi_enabled', 'ESI', kind: FormKind.toggle),
          FormFieldSpec('esi_code', 'ESI code'),
          FormFieldSpec('esi_employee_rate', 'Employee ESI %', kind: FormKind.number),
          FormFieldSpec('esi_employer_rate', 'Employer ESI %', kind: FormKind.number),
          FormFieldSpec('pt_enabled', 'Professional tax', kind: FormKind.toggle),
          FormFieldSpec('pt_state', 'Professional tax state'),
        ],
      ),
    '/settings/salary-components' => _SalaryScreen(session: session),
    '/settings/commission-rules' => _CommissionScreen(session: session),
    '/settings/offer-letter' => JsonListScreen(
        session: session,
        title: 'Offer letter',
        blurb: 'Templates used when you hire.',
        path: '/api/settings/offer-letter-template',
        listKey: 'templates',
        titleOf: (r) => r['name']?.toString() ?? 'Offer letter',
      ),
    '/settings/onboarding-templates' => JsonListScreen(
        session: session,
        title: 'Onboarding tasks',
        blurb: 'What a new joiner is asked to finish.',
        path: '/api/hr/onboarding-templates',
        listKey: 'templates',
        titleOf: (r) => r['name']?.toString() ?? 'Template',
        subtitleOf: (r) => r['description']?.toString() ?? '',
      ),
    '/settings/employee-portal' => MapFormScreen(
        session: session,
        title: 'Employee portal',
        blurb: 'The kiosk staff use to mark attendance.',
        loadPath: '/api/settings/hr-portal',
        savePath: '/api/settings/hr-portal',
        readKey: 'settings',
        fields: const [FormFieldSpec('kiosk_enabled', 'Attendance kiosk', kind: FormKind.toggle)],
      ),
    '/settings/hr-employee' => MapFormScreen(
        session: session,
        title: 'Employees',
        blurb: 'Probation and how employee numbers are issued.',
        loadPath: '/api/settings/hr-employee',
        savePath: '/api/settings/hr-employee',
        readKey: 'settings',
        fields: const [
          FormFieldSpec('probation_period_value', 'Probation length', kind: FormKind.number),
          FormFieldSpec('probation_period_unit', 'Unit', kind: FormKind.choice, options: [('months', 'Months'), ('weeks', 'Weeks')]),
          FormFieldSpec('probation_auto_confirm', 'Confirm automatically when probation ends', kind: FormKind.toggle),
          FormFieldSpec('employee_id_prefix', 'Employee number prefix'),
          FormFieldSpec('employee_id_padding', 'Digits', kind: FormKind.number),
          FormFieldSpec('show_new_joiners', 'Show new joiners', kind: FormKind.toggle),
          FormFieldSpec('show_work_anniversaries', 'Show work anniversaries', kind: FormKind.toggle),
        ],
      ),
    '/settings/products' => _ProductsScreen(session: session),
    '/settings/backup' => _BackupScreen(session: session),
    '/settings/help/how-to' || '/docs' => const _GuideScreen(),
    '/settings/help' || '/support' => const _SupportScreen(),
    '/privacy' => const _PrivacyScreen(),
    '/settings/offline-sync' => JsonListScreen(
        session: session,
        title: 'Offline sync',
        blurb: 'Changes this phone sent after it was back online.',
        path: '/api/offline-sync/history?limit=50&user_id=${session.user['id'] ?? ''}',
        listKey: 'history',
        titleOf: (r) => r['action']?.toString() ?? r['entity']?.toString() ?? 'Sync',
        subtitleOf: (r) => r['created_at']?.toString() ?? r['status']?.toString() ?? '',
      ),
    '/settings/bluetooth-printer' || '/settings/bluetooth-printer/diagnostics' => PrintersScreen(session: session),
    '/settings/automation' => const _AutomationScreen(),
    '/items/categories' => _CategoriesScreen(session: session),
    '/settings/label-templates' => _LabelsScreen(session: session),
    '/settings/online-store' || '/settings/online-store/studio' => _StoreExtrasScreen(session: session),
    '/pricing/party-item' => _PartyPriceScreen(session: session),
    '/tools' => _ToolsScreen(session: session),
    '/whatsapp/send-message' => _SendMessageScreen(session: session),
    '/hr/leaves/year-end' => _YearEndScreen(session: session),
    '/hr/leaves/import-balances' => _LeaveImportScreen(session: session),
    '/settings/subscription' => PlanBillingScreen(session: session),
    _ => null,
  };
}

class _NotificationsNote extends StatelessWidget {
  const _NotificationsNote();

  @override
  Widget build(BuildContext context) {
    return const SettingsPage(
      title: 'Updates for you',
      blurb: 'The evening summary and payment reminders.',
      icon: LucideIcons.bell,
      loading: false,
      children: [
        SettingsSection(title: 'Where to change them', why: 'Payment reminders and the daily summary use the same WhatsApp number.', children: [
          SettingRow(label: 'Payment reminders', help: 'Turn them on under Settings, then Payments.'),
        ]),
      ],
    );
  }
}

class _GuideScreen extends StatelessWidget {
  const _GuideScreen();

  @override
  Widget build(BuildContext context) {
    const steps = [
      ('Make a bill', 'More is not required. Use the invoice button, pick the customer, add items, and save.'),
      ('Record a payment', 'Open the bill or Payments in, and enter the amount received.'),
      ('Add an item', 'Items, then add. Set the rate and GST. Stock is optional.'),
      ('Number series', 'Settings, Invoices & documents. Each document has its own prefix.'),
      ('Templates', 'Settings, Invoices & documents, Invoice templates. Pick a layout per document.'),
    ];
    return SettingsPage(
      title: 'How-to guides',
      blurb: 'The jobs people do most often.',
      icon: LucideIcons.bookOpen,
      loading: false,
      children: [
        for (final (title, body) in steps)
          SettingsSection(title: title, children: [SettingRow(label: body)]),
      ],
    );
  }
}

class _SupportScreen extends StatelessWidget {
  const _SupportScreen();

  @override
  Widget build(BuildContext context) {
    return const SettingsPage(
      title: 'Help & support',
      blurb: 'When something does not work.',
      icon: LucideIcons.lifeBuoy,
      loading: false,
      children: [
        SettingsSection(title: 'Try this first', children: [
          SettingRow(label: 'Pull down to refresh the screen.'),
          SettingRow(label: 'Check the phone is online, then open Offline sync if a save did not go through.'),
          SettingRow(label: 'Printer trouble is under Help, Printer diagnostics.'),
        ]),
        SettingsSection(title: 'Write to us', children: [
          SettingRow(label: 'support@khatario.com', help: 'Include the business name and what you were doing.'),
        ]),
      ],
    );
  }
}

class _PrivacyScreen extends StatelessWidget {
  const _PrivacyScreen();

  @override
  Widget build(BuildContext context) {
    return const SettingsPage(
      title: 'Privacy',
      blurb: 'What this phone keeps.',
      icon: LucideIcons.shield,
      loading: false,
      children: [
        SettingsSection(title: 'Your business data', children: [
          SettingRow(label: 'Bills, parties and items are stored for your business on Khatario.'),
          SettingRow(label: 'The phone keeps the sign-in cookie on this device so you stay signed in.'),
          SettingRow(label: 'Sign out from More to remove that cookie from this phone.'),
        ]),
      ],
    );
  }
}

class _AutomationScreen extends StatelessWidget {
  const _AutomationScreen();

  @override
  Widget build(BuildContext context) {
    return const SettingsPage(
      title: 'Automation',
      blurb: 'Reminders and follow-ups that send themselves.',
      icon: LucideIcons.bell,
      loading: false,
      children: [
        SettingsSection(title: 'Payment reminders', children: [
          SettingRow(label: 'Turn reminders on from Settings, Payments & collections, when WhatsApp is linked.'),
        ]),
      ],
    );
  }
}

class _SmsScreen extends StatelessWidget {
  const _SmsScreen();

  @override
  Widget build(BuildContext context) {
    return const SettingsPage(
      title: 'SMS',
      blurb: 'Text messages for buyers without WhatsApp.',
      icon: LucideIcons.messageSquare,
      loading: false,
      children: [
        SettingsSection(title: 'Provider', why: 'SMS is sent when a buyer has a phone number and no WhatsApp.', children: [
          SettingRow(label: 'Uses the provider saved for this business', help: 'WhatsApp is used first. SMS is the fallback.'),
        ]),
      ],
    );
  }
}

class _BranchesScreen extends StatefulWidget {
  const _BranchesScreen({required this.session});
  final AppSession session;
  @override
  State<_BranchesScreen> createState() => _BranchesScreenState();
}

class _BranchesScreenState extends State<_BranchesScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/branches');
      if (!mounted) return;
      setState(() { _rows = jsonList(body['branches']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _add() async {
    final name = TextEditingController();
    final city = TextEditingController();
    final phone = TextEditingController();
    final gstin = TextEditingController();
    final ok = await askTextSheet(context, title: 'Add a branch', fields: [
      ('Name', name, null),
      ('City', city, null),
      ('Phone', phone, null),
      ('GSTIN', gstin, null),
    ]);
    if (!ok || name.text.trim().isEmpty) return;
    try {
      await widget.session.api.postJson('/api/branches', {
        'business_id': widget.session.businessId,
        'name': name.text.trim(),
        'city': city.text.trim(),
        'phone': phone.text.trim(),
        'gstin': gstin.text.trim(),
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Branches',
      blurb: 'Each branch can have its own GSTIN and invoice series.',
      icon: LucideIcons.building2,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Locations', children: [
          for (final b in _rows) ItemSetting(title: b['name']?.toString() ?? 'Branch', subtitle: [b['city'], b['gstin']].where((v) => v != null && '$v'.isNotEmpty).join(' · ')),
          AddSetting(label: 'Add a branch', onTap: _add),
        ]),
      ],
    );
  }
}

class _WarehousesScreen extends StatefulWidget {
  const _WarehousesScreen({required this.session});
  final AppSession session;
  @override
  State<_WarehousesScreen> createState() => _WarehousesScreenState();
}

class _WarehousesScreenState extends State<_WarehousesScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/warehouses');
      if (!mounted) return;
      setState(() { _rows = jsonList(body['warehouses']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _add() async {
    final name = TextEditingController();
    final city = TextEditingController();
    final ok = await askTextSheet(context, title: 'Add a warehouse', fields: [('Name', name, null), ('City', city, null)]);
    if (!ok || name.text.trim().isEmpty) return;
    try {
      await widget.session.api.postJson('/api/warehouses', {
        'business_id': widget.session.businessId,
        'name': name.text.trim(),
        'city': city.text.trim(),
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Warehouses',
      blurb: 'Godowns and shop floors that hold stock.',
      icon: LucideIcons.warehouse,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Warehouses', children: [
          for (final w in _rows) ItemSetting(title: w['name']?.toString() ?? 'Warehouse', subtitle: w['city']?.toString()),
          AddSetting(label: 'Add a warehouse', onTap: _add),
        ]),
      ],
    );
  }
}

class _YearsScreen extends StatefulWidget {
  const _YearsScreen({required this.session});
  final AppSession session;
  @override
  State<_YearsScreen> createState() => _YearsScreenState();
}

class _YearsScreenState extends State<_YearsScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/financial-years');
      if (!mounted) return;
      setState(() { _rows = jsonList(body['years']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _add() async {
    final now = DateTime.now();
    final startYear = now.month < 4 ? now.year : now.year;
    final code = TextEditingController(text: '$startYear-${(startYear + 1).toString().substring(2)}');
    final start = TextEditingController(text: '$startYear-04-01');
    final end = TextEditingController(text: '${startYear + 1}-03-31');
    final ok = await askTextSheet(context, title: 'Add a financial year', fields: [
      ('Year code', code, '2026-27'),
      ('Starts', start, '2026-04-01'),
      ('Ends', end, '2027-03-31'),
    ]);
    if (!ok) return;
    try {
      await widget.session.api.postJson('/api/financial-years', {
        'year_code': code.text.trim(),
        'start_date': start.text.trim(),
        'end_date': end.text.trim(),
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _close(Map<String, dynamic> year) async {
    final id = year['id']?.toString();
    if (id == null) return;
    final ok = await showKSheet<bool>(context, title: 'Close ${year['year_code']}?', builder: (ctx) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Closing stops new entries in this year. This follows the same close the website uses.', style: AppText.body),
        const SizedBox(height: 16),
        KButton(label: 'Close year', onPressed: () => Navigator.pop(ctx, true)),
      ]),
    ));
    if (ok != true) return;
    try {
      await widget.session.api.postJson('/api/financial-years/$id/close', {});
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Financial years',
      blurb: 'Reports and GST use these April–March periods.',
      icon: LucideIcons.calendar,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Years', children: [
          for (final y in _rows)
            ItemSetting(
              title: y['year_code']?.toString() ?? 'Year',
              subtitle: y['is_closed'] == true ? 'Closed' : 'Open',
              onTap: y['is_closed'] == true ? null : () => _close(y),
            ),
          AddSetting(label: 'Add a year', onTap: _add),
        ]),
      ],
    );
  }
}

class _LocksScreen extends StatefulWidget {
  const _LocksScreen({required this.session});
  final AppSession session;
  @override
  State<_LocksScreen> createState() => _LocksScreenState();
}

class _LocksScreenState extends State<_LocksScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/period-locks');
      if (!mounted) return;
      setState(() { _rows = jsonList(body['locks'] ?? body['period_locks']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _add() async {
    final year = TextEditingController();
    final start = TextEditingController();
    final end = TextEditingController();
    final ok = await askTextSheet(context, title: 'Lock a period', fields: [
      ('Financial year', year, '2026-27'),
      ('From', start, '2026-04-01'),
      ('To', end, '2026-04-30'),
    ]);
    if (!ok) return;
    try {
      await widget.session.api.postJson('/api/period-locks', {
        'financial_year': year.text.trim(),
        'period_start': start.text.trim(),
        'period_end': end.text.trim(),
        'is_locked': true,
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Period locks',
      blurb: 'Stops back-dated changes after you file.',
      icon: LucideIcons.lock,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Locked periods', children: [
          for (final l in _rows)
            ItemSetting(
              title: l['financial_year']?.toString() ?? 'Lock',
              subtitle: '${l['period_start'] ?? ''} – ${l['period_end'] ?? ''}',
            ),
          if (_rows.isEmpty) const SettingRow(label: 'Nothing locked'),
          AddSetting(label: 'Lock a period', onTap: _add),
        ]),
      ],
    );
  }
}

class _MappingsScreen extends StatefulWidget {
  const _MappingsScreen({required this.session});
  final AppSession session;
  @override
  State<_MappingsScreen> createState() => _MappingsScreenState();
}

class _MappingsScreenState extends State<_MappingsScreen> {
  static const _keys = [
    ('sales_account_id', 'Sales'),
    ('accounts_receivable_account_id', 'Receivables'),
    ('cash_account_id', 'Cash'),
    ('bank_account_id', 'Bank'),
    ('purchases_account_id', 'Purchases'),
    ('accounts_payable_account_id', 'Payables'),
    ('inventory_account_id', 'Stock'),
    ('cogs_account_id', 'Cost of goods'),
    ('expense_account_id', 'Expenses'),
  ];

  Map<String, dynamic> _map = {};
  List<Map<String, dynamic>> _accounts = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        widget.session.api.getJson('/api/settings/account-mappings'),
        widget.session.api.getJson('/api/accounts'),
      ]);
      if (!mounted) return;
      setState(() {
        _map = jsonMap(results[0]['mappings']);
        _accounts = jsonList(results[1]['accounts']);
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _save() async {
    try {
      await widget.session.api.patchJson('/api/settings/account-mappings', {'mappings': _map});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Account mappings saved')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final options = [('', 'Not set'), for (final a in _accounts) (a['id'].toString(), a['account_name']?.toString() ?? a['name']?.toString() ?? 'Account')];
    return SettingsPage(
      title: 'Account mappings',
      blurb: 'Where new entries post. Old entries stay where they are.',
      icon: LucideIcons.bookOpen,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Accounts', children: [
          for (final (key, label) in _keys)
            ChoiceSetting<String>(
              label: label,
              value: _map[key]?.toString() ?? '',
              options: options,
              onChanged: (v) => setState(() => _map = {..._map, key: v.isEmpty ? null : v}),
            ),
        ]),
        KButton(label: 'Save mappings', onPressed: _save),
      ],
    );
  }
}

class _UsersScreen extends StatefulWidget {
  const _UsersScreen({required this.session, this.agents = false});
  final AppSession session;
  final bool agents;
  @override
  State<_UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<_UsersScreen> {
  List<Map<String, dynamic>> _users = const [];
  List<Map<String, dynamic>> _roles = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        widget.session.api.getJson('/api/settings/users'),
        widget.session.api.getJson('/api/settings/roles'),
      ]);
      if (!mounted) return;
      setState(() {
        _users = jsonList(results[0]['users']);
        _roles = jsonList(results[1]['roles']);
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  List<Map<String, dynamic>> get _shown => widget.agents
      ? _users.where((u) => u['seat_type'] == 'connect' || u['seat_type'] == 'connect_agent' || u['seat_type'] == 'agent').toList()
      : _users;

  Future<void> _invite() async {
    final name = TextEditingController();
    final phone = TextEditingController();
    final password = TextEditingController();
    var roleId = _roles.isEmpty ? '' : _roles.first['id'].toString();
    final ok = await showKSheet<bool>(context, title: widget.agents ? 'Add an agent' : 'Invite a user', builder: (ctx) {
      return StatefulBuilder(builder: (ctx, set) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          TextField(controller: name, decoration: const InputDecoration(labelText: 'Name')),
          const SizedBox(height: 12),
          TextField(controller: phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone')),
          const SizedBox(height: 12),
          TextField(controller: password, obscureText: true, decoration: const InputDecoration(labelText: 'Password')),
          if (!widget.agents && _roles.isNotEmpty) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: roleId,
              decoration: const InputDecoration(labelText: 'Role'),
              items: [for (final r in _roles) DropdownMenuItem(value: r['id'].toString(), child: Text(r['role_name']?.toString() ?? r['name']?.toString() ?? 'Role'))],
              onChanged: (v) => set(() => roleId = v ?? roleId),
            ),
          ],
          const SizedBox(height: 16),
          KButton(label: 'Save', onPressed: () => Navigator.pop(ctx, true)),
        ]),
      ));
    });
    if (ok != true || name.text.trim().isEmpty || phone.text.trim().isEmpty || password.text.isEmpty) return;
    try {
      await widget.session.api.postJson('/api/settings/users', {
        'name': name.text.trim(),
        'phone': phone.text.trim(),
        'password': password.text,
        if (!widget.agents) 'role_id': roleId,
        'seat_type': widget.agents ? 'connect' : 'billing',
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: widget.agents ? 'Agents' : 'Users',
      blurb: widget.agents ? 'Logins that only answer WhatsApp chats.' : 'Who can sign in, and as which role.',
      icon: LucideIcons.users,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: widget.agents ? 'Agents' : 'Users', children: [
          for (final u in _shown)
            ItemSetting(
              title: u['name']?.toString() ?? 'User',
              subtitle: [u['role_name'] ?? u['role'], u['phone']].where((v) => v != null && '$v'.isNotEmpty).join(' · '),
            ),
          if (_shown.isEmpty) SettingRow(label: widget.agents ? 'No agents yet' : 'Only you so far'),
          AddSetting(label: widget.agents ? 'Add an agent' : 'Invite a user', onTap: _invite),
        ]),
      ],
    );
  }
}

class _RolesScreen extends StatelessWidget {
  const _RolesScreen({required this.session});
  final AppSession session;

  @override
  Widget build(BuildContext context) {
    return JsonListScreen(
      session: session,
      title: 'Roles',
      blurb: 'What each role can see and do.',
      path: '/api/settings/roles',
      listKey: 'roles',
      titleOf: (r) => r['role_name']?.toString() ?? r['name']?.toString() ?? 'Role',
      subtitleOf: (r) {
        final perms = r['permissions'];
        if (perms is! List) return '';
        final view = perms.whereType<Map>().where((p) => p['can_view'] == true).length;
        return '$view areas they can open';
      },
    );
  }
}

class _WhatsAppLinkScreen extends StatefulWidget {
  const _WhatsAppLinkScreen({required this.session});
  final AppSession session;
  @override
  State<_WhatsAppLinkScreen> createState() => _WhatsAppLinkScreenState();
}

class _WhatsAppLinkScreenState extends State<_WhatsAppLinkScreen> {
  Map<String, dynamic> _status = const {};
  String? _qr;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/whatsapp/status');
      if (!mounted) return;
      setState(() { _status = body; _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _link() async {
    setState(() => _loading = true);
    try {
      final body = await widget.session.api.postJson('/api/whatsapp/qr', {});
      if (!mounted) return;
      setState(() { _qr = body['qr']?.toString(); _status = {..._status, ...body}; _loading = false; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final phone = _status['phoneNumber']?.toString();
    final status = _status['status']?.toString() ?? '';
    return SettingsPage(
      title: 'WhatsApp',
      blurb: 'The number invoices and reminders are sent from.',
      icon: LucideIcons.messageCircle,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'This number', children: [
          SettingRow(label: phone == null || phone.isEmpty ? 'Not linked' : '+$phone', help: status.isEmpty ? null : status),
          AddSetting(label: 'Show linking code', onTap: _link),
          if (_qr != null && _qr!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.all(12),
              child: SelectableText(_qr!, style: AppText.caption),
            ),
        ]),
      ],
    );
  }
}

class _ShiftsScreen extends StatefulWidget {
  const _ShiftsScreen({required this.session});
  final AppSession session;
  @override
  State<_ShiftsScreen> createState() => _ShiftsScreenState();
}

class _ShiftsScreenState extends State<_ShiftsScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/shifts');
      if (!mounted) return;
      setState(() { _rows = jsonList(body['shifts']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _add() async {
    final name = TextEditingController();
    final start = TextEditingController(text: '09:00');
    final end = TextEditingController(text: '18:00');
    final ok = await askTextSheet(context, title: 'Add a shift', fields: [('Name', name, 'General'), ('Starts', start, '09:00'), ('Ends', end, '18:00')]);
    if (!ok || name.text.trim().isEmpty) return;
    try {
      await widget.session.api.postJson('/api/shifts', {
        'business_id': widget.session.businessId,
        'shift_name': name.text.trim(),
        'start_time': start.text.trim(),
        'end_time': end.text.trim(),
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Shifts',
      blurb: 'Start and end times used for attendance.',
      icon: LucideIcons.clock,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Shifts', children: [
          for (final s in _rows) ItemSetting(title: s['shift_name']?.toString() ?? s['name']?.toString() ?? 'Shift', subtitle: '${s['start_time'] ?? ''} – ${s['end_time'] ?? ''}'),
          AddSetting(label: 'Add a shift', onTap: _add),
        ]),
      ],
    );
  }
}

class _WeeklyOffScreen extends StatefulWidget {
  const _WeeklyOffScreen({required this.session});
  final AppSession session;
  @override
  State<_WeeklyOffScreen> createState() => _WeeklyOffScreenState();
}

class _WeeklyOffScreenState extends State<_WeeklyOffScreen> {
  static const _days = [(0, 'Sunday'), (1, 'Monday'), (2, 'Tuesday'), (3, 'Wednesday'), (4, 'Thursday'), (5, 'Friday'), (6, 'Saturday')];
  Set<int> _off = {0};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/settings/weekly-off');
      final days = jsonMap(body['policy'])['fixed_days'];
      if (!mounted) return;
      setState(() {
        _off = days is List ? days.map((e) => int.tryParse(e.toString()) ?? -1).where((n) => n >= 0).toSet() : {0};
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _save() async {
    try {
      await widget.session.api.patchJson('/api/settings/weekly-off', {'policy': {'fixed_days': _off.toList()..sort(), 'nth_rules': []}});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Weekly off saved')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Weekly off',
      blurb: 'Days the shop is closed every week.',
      icon: LucideIcons.calendarOff,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Closed on', children: [
          for (final (n, label) in _days)
            ToggleSetting(label: label, value: _off.contains(n), onChanged: (v) => setState(() => v ? _off.add(n) : _off.remove(n))),
        ]),
        KButton(label: 'Save weekly off', onPressed: _save),
      ],
    );
  }
}

class _HolidaysScreen extends StatefulWidget {
  const _HolidaysScreen({required this.session});
  final AppSession session;
  @override
  State<_HolidaysScreen> createState() => _HolidaysScreenState();
}

class _HolidaysScreenState extends State<_HolidaysScreen> {
  List<Map<String, dynamic>> _lists = const [];
  List<Map<String, dynamic>> _holidays = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/settings/holiday-lists');
      if (!mounted) return;
      setState(() {
        _lists = jsonList(body['lists']);
        _holidays = jsonList(body['holidays']);
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _add() async {
    if (_lists.isEmpty) return;
    final name = TextEditingController();
    final date = TextEditingController();
    final ok = await askTextSheet(context, title: 'Add a holiday', fields: [('Name', name, 'Diwali'), ('Date', date, '2026-11-08')]);
    if (!ok || name.text.trim().isEmpty) return;
    try {
      await widget.session.api.postJson('/api/settings/holiday-lists', {
        'action': 'create',
        'list_id': _lists.first['id'],
        'holiday_name': name.text.trim(),
        'holiday_date': date.text.trim(),
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Holidays',
      blurb: 'Days that are off besides the weekly off.',
      icon: LucideIcons.calendarDays,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Holidays', children: [
          for (final h in _holidays) ItemSetting(title: h['holiday_name']?.toString() ?? h['name']?.toString() ?? 'Holiday', subtitle: h['holiday_date']?.toString()),
          if (_holidays.isEmpty) const SettingRow(label: 'No holidays yet'),
          if (_lists.isNotEmpty) AddSetting(label: 'Add a holiday', onTap: _add),
        ]),
      ],
    );
  }
}

class _SalaryScreen extends StatefulWidget {
  const _SalaryScreen({required this.session});
  final AppSession session;
  @override
  State<_SalaryScreen> createState() => _SalaryScreenState();
}

class _SalaryScreenState extends State<_SalaryScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/settings/salary-components');
      if (!mounted) return;
      setState(() { _rows = jsonList(body['components']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _add() async {
    final name = TextEditingController();
    final code = TextEditingController();
    final ok = await askTextSheet(context, title: 'Add a component', fields: [('Name', name, 'Basic'), ('Code', code, 'BASIC')]);
    if (!ok || name.text.trim().isEmpty) return;
    try {
      await widget.session.api.postJson('/api/settings/salary-components', {
        'name': name.text.trim(),
        'code': code.text.trim().isEmpty ? name.text.trim().toUpperCase() : code.text.trim(),
        'component_type': 'earning',
        'calculation_type': 'fixed',
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Salary components',
      blurb: 'Earnings and deductions on a payslip.',
      icon: LucideIcons.wallet,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Components', children: [
          for (final c in _rows) ItemSetting(title: c['name']?.toString() ?? 'Component', subtitle: c['component_type']?.toString()),
          AddSetting(label: 'Add a component', onTap: _add),
        ]),
      ],
    );
  }
}

class _CommissionScreen extends StatefulWidget {
  const _CommissionScreen({required this.session});
  final AppSession session;
  @override
  State<_CommissionScreen> createState() => _CommissionScreenState();
}

class _CommissionScreenState extends State<_CommissionScreen> {
  List<Map<String, dynamic>> _rules = const [];
  List<Map<String, dynamic>> _roles = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        widget.session.api.getJson('/api/commission-rules'),
        widget.session.api.getJson('/api/settings/roles'),
      ]);
      if (!mounted) return;
      setState(() { _rules = jsonList(results[0]['rules']); _roles = jsonList(results[1]['roles']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _add() async {
    if (_roles.isEmpty) return;
    final value = TextEditingController(text: '1');
    var roleId = _roles.first['id'].toString();
    final ok = await showKSheet<bool>(context, title: 'Add a commission', builder: (ctx) => StatefulBuilder(builder: (ctx, set) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        DropdownButtonFormField<String>(
          initialValue: roleId,
          decoration: const InputDecoration(labelText: 'Role'),
          items: [for (final r in _roles) DropdownMenuItem(value: r['id'].toString(), child: Text(r['role_name']?.toString() ?? 'Role'))],
          onChanged: (v) => set(() => roleId = v ?? roleId),
        ),
        const SizedBox(height: 12),
        TextField(controller: value, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Percent of the sale')),
        const SizedBox(height: 16),
        KButton(label: 'Save', onPressed: () => Navigator.pop(ctx, true)),
      ]),
    )));
    if (ok != true) return;
    try {
      await widget.session.api.postJson('/api/commission-rules', {
        'business_id': widget.session.businessId,
        'role_id': roleId,
        'commission_type': 'percentage',
        'commission_value': num.tryParse(value.text.trim()) ?? 0,
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Sales commission',
      blurb: 'A percent of sales for a role.',
      icon: LucideIcons.percent,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Rules', children: [
          for (final r in _rules) ItemSetting(title: '${r['commission_value'] ?? ''} ${r['commission_type'] ?? ''}', subtitle: r['role_name']?.toString()),
          AddSetting(label: 'Add a rule', onTap: _add),
        ]),
      ],
    );
  }
}

class _ProductsScreen extends StatefulWidget {
  const _ProductsScreen({required this.session});
  final AppSession session;
  @override
  State<_ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<_ProductsScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/modules');
      if (!mounted) return;
      setState(() { _rows = jsonList(body['modules']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Your products',
      blurb: 'Billing, HR and Connect on this business.',
      icon: LucideIcons.boxes,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Products', children: [
          for (final m in _rows)
            ItemSetting(
              title: m['name']?.toString() ?? m['module_key']?.toString() ?? 'Product',
              subtitle: m['enabled'] == true || m['status'] == 'active' ? 'On' : m['status']?.toString(),
            ),
        ]),
      ],
    );
  }
}

class _BackupScreen extends StatelessWidget {
  const _BackupScreen({required this.session});
  final AppSession session;

  @override
  Widget build(BuildContext context) {
    return MapFormScreen(
      session: session,
      title: 'Backup',
      blurb: 'A full copy of your data on a schedule. Restoring replaces today’s data and is confirmed on the next step only after you pick a file from history.',
      loadPath: '/api/backup/schedule',
      savePath: '/api/backup/schedule',
      readKey: 'schedule',
      verb: SaveVerb.post,
      fields: const [
        FormFieldSpec('is_enabled', 'Automatic backup', kind: FormKind.toggle),
        FormFieldSpec('frequency', 'How often', kind: FormKind.choice, options: [('daily', 'Every day'), ('weekly', 'Every week'), ('monthly', 'Every month')]),
        FormFieldSpec('time_of_day', 'Time', hint: '02:00'),
        FormFieldSpec('day_of_week', 'Weekday for a weekly backup', kind: FormKind.number, help: '0 is Sunday.'),
        FormFieldSpec('day_of_month', 'Day for a monthly backup', kind: FormKind.number),
        FormFieldSpec('storage_destination', 'Where it is kept', kind: FormKind.choice, options: [('local', 'Download'), ('google_drive', 'Google Drive')]),
        FormFieldSpec('retention_days', 'Keep for (days)', kind: FormKind.number),
        FormFieldSpec('notification_email', 'Email when it finishes'),
      ],
    );
  }
}

class _CategoriesScreen extends StatefulWidget {
  const _CategoriesScreen({required this.session});
  final AppSession session;
  @override
  State<_CategoriesScreen> createState() => _CategoriesScreenState();
}

class _CategoriesScreenState extends State<_CategoriesScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/categories');
      if (!mounted) return;
      setState(() { _rows = jsonList(body['categories']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _add() async {
    final name = TextEditingController();
    final ok = await askTextSheet(context, title: 'Add a category', fields: [('Name', name, null)]);
    if (!ok || name.text.trim().isEmpty) return;
    try {
      await widget.session.api.postJson('/api/categories', {'business_id': widget.session.businessId, 'name': name.text.trim()});
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Categories',
      blurb: 'Groups for items, reports and the store.',
      icon: LucideIcons.tags,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Categories', children: [
          for (final c in _rows) ItemSetting(title: c['name']?.toString() ?? 'Category'),
          AddSetting(label: 'Add a category', onTap: _add),
        ]),
      ],
    );
  }
}

class _LabelsScreen extends StatefulWidget {
  const _LabelsScreen({required this.session});
  final AppSession session;
  @override
  State<_LabelsScreen> createState() => _LabelsScreenState();
}

class _LabelsScreenState extends State<_LabelsScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/label-templates');
      if (!mounted) return;
      setState(() { _rows = jsonList(body['templates']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _add() async {
    final name = TextEditingController(text: 'Shelf label');
    final ok = await askTextSheet(context, title: 'Add a label', fields: [('Name', name, null)]);
    if (!ok || name.text.trim().isEmpty) return;
    try {
      await widget.session.api.postJson('/api/label-templates', {
        'business_id': widget.session.businessId,
        'name': name.text.trim(),
        'format': 'ROLL',
        'width_mm': 50,
        'height_mm': 25,
        'symbology': 'AUTO',
        'fields': [
          {'key': 'product_name', 'x_mm': 2, 'y_mm': 2, 'w_mm': 46, 'h_mm': 6, 'font_size': 8},
          {'key': 'barcode', 'x_mm': 2, 'y_mm': 9, 'w_mm': 46, 'h_mm': 12},
        ],
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Label templates',
      blurb: 'Size and fields on a barcode label.',
      icon: LucideIcons.tag,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Templates', children: [
          for (final t in _rows) ItemSetting(title: t['name']?.toString() ?? 'Label', subtitle: '${t['width_mm'] ?? ''} × ${t['height_mm'] ?? ''} mm'),
          AddSetting(label: 'Add a 50×25 mm label', onTap: _add),
        ]),
      ],
    );
  }
}

class _StoreExtrasScreen extends StatefulWidget {
  const _StoreExtrasScreen({required this.session});
  final AppSession session;
  @override
  State<_StoreExtrasScreen> createState() => _StoreExtrasScreenState();
}

class _StoreExtrasScreenState extends State<_StoreExtrasScreen> {
  final _tagline = TextEditingController();
  final _email = TextEditingController();
  final _token = TextEditingController();
  Map<String, dynamic> _store = const {};
  bool _loading = true;
  String? _error;

  @override
  void dispose() {
    _tagline.dispose();
    _email.dispose();
    _token.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/settings/online-store');
      if (!mounted) return;
      _tagline.text = body['store_tagline']?.toString() ?? '';
      _email.text = body['store_shiprocket_email']?.toString() ?? '';
      setState(() { _store = body; _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _save(Map<String, dynamic> extra) async {
    try {
      await widget.session.api.patchJson('/api/settings/online-store', extra);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Store updated')));
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Online store',
      blurb: 'The line under your name, delivery, and Shiprocket.',
      icon: LucideIcons.store,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Look', why: 'Shown at the top of your store.', children: [
          TextSetting(label: 'Tagline', controller: _tagline),
          AddSetting(label: 'Save tagline', onTap: () => _save({'store_tagline': _tagline.text.trim()})),
        ]),
        SettingsSection(title: 'Delivery', why: 'Self-pickup stays available. Zones use the pincodes you deliver to.', children: [
          SettingRow(label: 'Minimum order and cash on delivery', help: 'Those are on Orders & delivery.'),
          SettingRow(label: _store['store_delivery_provider'] == 'shiprocket' ? 'Shiprocket is the courier' : 'Your own staff deliver'),
        ]),
        SettingsSection(title: 'Shiprocket', why: 'The login Shiprocket gave you. The password is saved on the server.', children: [
          TextSetting(label: 'Shiprocket email', controller: _email),
          TextSetting(label: 'Password', controller: _token, hint: 'Leave blank to keep the saved password'),
          AddSetting(label: 'Save Shiprocket login', onTap: () => _save({
            'store_shiprocket_email': _email.text.trim(),
            if (_token.text.trim().isNotEmpty) 'store_shiprocket_password': _token.text,
          })),
        ]),
      ],
    );
  }
}

class _BanksScreen extends StatefulWidget {
  const _BanksScreen({required this.session});
  final AppSession session;
  @override
  State<_BanksScreen> createState() => _BanksScreenState();
}

class _BanksScreenState extends State<_BanksScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/bank-accounts');
      if (!mounted) return;
      setState(() { _rows = jsonList(body['accounts']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _add() async {
    final bank = TextEditingController();
    final name = TextEditingController();
    final number = TextEditingController();
    final ifsc = TextEditingController();
    final ok = await askTextSheet(context, title: 'Add a bank account', fields: [
      ('Bank', bank, null),
      ('Account name', name, null),
      ('Account number', number, null),
      ('IFSC', ifsc, null),
    ]);
    if (!ok || bank.text.trim().isEmpty || number.text.trim().isEmpty) return;
    try {
      await widget.session.api.postJson('/api/bank-accounts', {
        'business_id': widget.session.businessId,
        'bank_name': bank.text.trim(),
        'account_name': name.text.trim().isEmpty ? bank.text.trim() : name.text.trim(),
        'account_number': number.text.trim(),
        'ifsc_code': ifsc.text.trim(),
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Bank accounts',
      blurb: 'The pay-to block on invoices.',
      icon: LucideIcons.landmark,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Accounts', children: [
          for (final b in _rows)
            ItemSetting(
              title: b['bank_name']?.toString() ?? 'Bank',
              subtitle: b['account_number']?.toString(),
            ),
          if (_rows.isEmpty) const SettingRow(label: 'No bank account yet'),
          AddSetting(label: 'Add a bank account', onTap: _add),
        ]),
      ],
    );
  }
}

class _GatewaysScreen extends StatefulWidget {
  const _GatewaysScreen({required this.session});
  final AppSession session;
  @override
  State<_GatewaysScreen> createState() => _GatewaysScreenState();
}

class _GatewaysScreenState extends State<_GatewaysScreen> {
  List<Map<String, dynamic>> _providers = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/settings/payment-providers');
      if (!mounted) return;
      setState(() { _providers = jsonList(body['providers']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _connect(Map<String, dynamic> provider) async {
    final id = TextEditingController();
    final secret = TextEditingController();
    final ok = await askTextSheet(context, title: provider['displayName']?.toString() ?? 'Gateway', fields: [
      ('Key id', id, null),
      ('Secret', secret, null),
    ]);
    if (!ok) return;
    try {
      await widget.session.api.postJson('/api/settings/payment-providers', {
        'provider': provider['id'],
        'client_id': id.text.trim(),
        'client_secret': secret.text,
        'environment': 'production',
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Payment gateways',
      blurb: 'Card, UPI and netbanking that confirm themselves.',
      icon: LucideIcons.landmark,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Gateways', children: [
          for (final p in _providers)
            ItemSetting(
              title: p['displayName']?.toString() ?? p['id'].toString(),
              subtitle: p['configured'] == true ? 'Connected' : 'Not connected',
              onTap: () => _connect(p),
            ),
        ]),
      ],
    );
  }
}

class _PartyPriceScreen extends StatefulWidget {
  const _PartyPriceScreen({required this.session});
  final AppSession session;
  @override
  State<_PartyPriceScreen> createState() => _PartyPriceScreenState();
}

class _PartyPriceScreenState extends State<_PartyPriceScreen> {
  List<Map<String, dynamic>> _customers = const [];
  List<Map<String, dynamic>> _overrides = const [];
  String? _partyId;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadCustomers();
  }

  Future<void> _loadCustomers() async {
    try {
      final body = await widget.session.api.getJson('/api/customers');
      if (!mounted) return;
      setState(() { _customers = jsonList(body['customers']); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _open(String id) async {
    setState(() { _partyId = id; _loading = true; });
    try {
      final body = await widget.session.api.getJson('/api/pricing/party-item?party_id=$id');
      if (!mounted) return;
      setState(() { _overrides = jsonList(body['overrides']); _loading = false; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _set() async {
    final item = TextEditingController();
    final price = TextEditingController();
    final ok = await askTextSheet(context, title: 'Special price', fields: [('Item id', item, null), ('Price', price, null)]);
    if (!ok || _partyId == null) return;
    try {
      await widget.session.api.postJson('/api/pricing/party-item', {
        'party_id': _partyId,
        'item_id': item.text.trim(),
        'price': num.tryParse(price.text.trim()),
      });
      await _open(_partyId!);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Party pricing',
      blurb: 'A different rate for one customer.',
      icon: LucideIcons.badgeIndianRupee,
      loading: _loading,
      error: _error,
      onRefresh: _loadCustomers,
      children: [
        SettingsSection(title: 'Customer', children: [
          for (final c in _customers.take(30))
            ItemSetting(title: c['name']?.toString() ?? 'Customer', subtitle: c['phone']?.toString(), onTap: () => _open(c['id'].toString())),
        ]),
        if (_partyId != null)
          SettingsSection(title: 'Special prices', children: [
            for (final o in _overrides) ItemSetting(title: o['item_id']?.toString() ?? 'Item', subtitle: o['price']?.toString()),
            if (_overrides.isEmpty) const SettingRow(label: 'No special prices'),
            AddSetting(label: 'Set a price', onTap: _set),
          ]),
      ],
    );
  }
}

class _ToolsScreen extends StatelessWidget {
  const _ToolsScreen({required this.session});
  final AppSession session;

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Tools',
      blurb: 'Calculators and checkers. They stay on this phone.',
      icon: LucideIcons.wrench,
      loading: false,
      children: [
        SettingsSection(title: 'All tools', children: [
          for (final (href, label) in toolLinks)
            NavSetting(
              label: label,
              onTap: () {
                final page = pageForHref(href);
                if (page == null) return;
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => RecordPage(session: session, page: page)));
              },
            ),
        ]),
      ],
    );
  }
}

class _SendMessageScreen extends StatefulWidget {
  const _SendMessageScreen({required this.session});
  final AppSession session;
  @override
  State<_SendMessageScreen> createState() => _SendMessageScreenState();
}

class _SendMessageScreenState extends State<_SendMessageScreen> {
  final _to = TextEditingController();
  final _message = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _to.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() => _sending = true);
    try {
      await widget.session.api.postJson('/api/whatsapp/send', {'to': _to.text.trim(), 'message': _message.text.trim()});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Message sent')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Send a message',
      blurb: 'A WhatsApp message from your business number.',
      icon: LucideIcons.messageCircle,
      loading: false,
      children: [
        SettingsSection(title: 'Message', children: [
          TextSetting(label: 'Phone', controller: _to, hint: '9198…'),
          TextSetting(label: 'Message', controller: _message, multiline: true),
        ]),
        KButton(label: _sending ? 'Sending…' : 'Send', onPressed: _sending ? null : _send),
      ],
    );
  }
}

class _YearEndScreen extends StatefulWidget {
  const _YearEndScreen({required this.session});
  final AppSession session;
  @override
  State<_YearEndScreen> createState() => _YearEndScreenState();
}

class _YearEndScreenState extends State<_YearEndScreen> {
  List<Map<String, dynamic>> _rows = const [];
  String? _year;
  bool _loading = false;
  String? _error;

  Future<void> _preview() async {
    setState(() => _loading = true);
    try {
      final body = await widget.session.api.postJson('/api/hr/leave/year-end', {'preview': true});
      if (!mounted) return;
      setState(() { _rows = jsonList(body['preview']); _year = body['leave_year']?.toString(); _loading = false; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _run() async {
    final ok = await showKSheet<bool>(context, title: 'Close the leave year?', builder: (ctx) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Balances carry forward or expire using each leave type’s year-end rule.', style: AppText.body),
        const SizedBox(height: 16),
        KButton(label: 'Run year-end', onPressed: () => Navigator.pop(ctx, true)),
      ]),
    ));
    if (ok != true) return;
    setState(() => _loading = true);
    try {
      await widget.session.api.postJson('/api/hr/leave/year-end', {'preview': false});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Leave year closed')));
      await _preview();
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Leave year-end',
      blurb: 'Preview what each person keeps, then close the year.',
      icon: LucideIcons.calendarCheck,
      loading: _loading,
      error: _error,
      children: [
        SettingsSection(title: _year == null ? 'Preview' : 'Year $_year', children: [
          for (final r in _rows.take(40)) ItemSetting(title: r['employee_name']?.toString() ?? r['employee_id']?.toString() ?? 'Employee', subtitle: r.toString()),
          AddSetting(label: 'Preview', onTap: _preview),
          AddSetting(label: 'Close the year', onTap: _run),
        ]),
      ],
    );
  }
}

class _LeaveImportScreen extends StatefulWidget {
  const _LeaveImportScreen({required this.session});
  final AppSession session;
  @override
  State<_LeaveImportScreen> createState() => _LeaveImportScreenState();
}

class _LeaveImportScreenState extends State<_LeaveImportScreen> {
  final _employee = TextEditingController();
  final _type = TextEditingController();
  final _year = TextEditingController(text: '${DateTime.now().year}');
  final _days = TextEditingController(text: '0');

  @override
  void dispose() {
    _employee.dispose();
    _type.dispose();
    _year.dispose();
    _days.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    try {
      await widget.session.api.postJson('/api/employees/leave-balances', {
        'business_id': widget.session.businessId,
        'employee_id': _employee.text.trim(),
        'leave_type_id': _type.text.trim(),
        'year': int.tryParse(_year.text.trim()) ?? DateTime.now().year,
        'opening_balance': num.tryParse(_days.text.trim()) ?? 0,
      });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Balance saved')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Leave balances',
      blurb: 'Set the opening balance for one employee and leave type.',
      icon: LucideIcons.calendarPlus,
      loading: false,
      children: [
        SettingsSection(title: 'Opening balance', children: [
          TextSetting(label: 'Employee id', controller: _employee),
          TextSetting(label: 'Leave type id', controller: _type),
          TextSetting(label: 'Year', controller: _year, keyboardType: TextInputType.number),
          TextSetting(label: 'Opening days', controller: _days, keyboardType: TextInputType.number),
        ]),
        KButton(label: 'Save balance', onPressed: _save),
      ],
    );
  }
}
