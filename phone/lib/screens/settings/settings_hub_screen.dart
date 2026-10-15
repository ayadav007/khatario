import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'business_settings.dart';
import 'invoice_settings.dart';
import 'items_orders_settings.dart';
import 'more_settings.dart';
import 'payments_settings.dart';
import 'settings_kit.dart';

/// One settings group on the hub.
class SettingsGroup {
  const SettingsGroup(this.id, this.title, this.icon, this.summary, this.keywords);

  final String id;
  final String title;
  final IconData icon;
  final String summary;
  final List<String> keywords;
}

const settingsGroups = <(String, List<SettingsGroup>)>[
  ('Set up', [
    SettingsGroup('business', 'Business', LucideIcons.building2, 'Name, address, GST, logo, branches',
        ['profile', 'gst', 'gstin', 'pan', 'address', 'logo', 'signature', 'branch', 'warehouse', 'export', 'iec']),
    SettingsGroup('invoice', 'Invoices & documents', LucideIcons.fileText, 'Due date, notes, numbering, templates',
        ['invoice', 'bill', 'due', 'round', 'terms', 'notes', 'number', 'series', 'prefix', 'template', 'print', 'language', 'variant', 'custom field']),
    SettingsGroup('payments', 'Payments', LucideIcons.wallet, 'Bank, UPI, gateways, reminders',
        ['upi', 'bank', 'qr', 'razorpay', 'easebuzz', 'gateway', 'reminder', 'payment link']),
    SettingsGroup('items', 'Items & stock', LucideIcons.package, 'Stock rules, low stock, labels, printers',
        ['stock', 'out of stock', 'low stock', 'warehouse', 'label', 'barcode', 'printer', 'category']),
    SettingsGroup('orders', 'Orders & delivery', LucideIcons.truck, 'Store checkout, delivery, returns, updates',
        ['store', 'delivery', 'shiprocket', 'courier', 'return', 'cod', 'cash on delivery', 'dispatch', 'whatsapp updates', 'minimum order']),
    SettingsGroup('accounting', 'Accounting', LucideIcons.bookOpen, 'Financial years, period locks',
        ['financial year', 'fy', 'period lock', 'account mapping', 'ledger']),
  ]),
  ('People & access', [
    SettingsGroup('team', 'Team & access', LucideIcons.users, 'Users, roles, agents',
        ['user', 'role', 'permission', 'staff', 'agent', 'activity']),
    SettingsGroup('messaging', 'Messaging & AI', LucideIcons.messageCircle, 'WhatsApp, AI agent, email, SMS',
        ['whatsapp', 'template', 'inbox', 'ai', 'email', 'smtp', 'sms']),
    SettingsGroup('people', 'People', LucideIcons.idCard, 'Attendance, leave, payroll, hiring',
        ['shift', 'attendance', 'leave', 'holiday', 'payroll', 'salary', 'pf', 'esi', 'overtime', 'hiring', 'offer letter']),
  ]),
  ('Account', [
    SettingsGroup('data', 'Plan & data', LucideIcons.database, 'Plan, backup, appearance', ['plan', 'subscription', 'backup', 'restore', 'theme', 'colour', 'appearance']),
    SettingsGroup('help', 'Help', LucideIcons.lifeBuoy, 'Guides and diagnostics', ['help', 'guide', 'support', 'offline', 'diagnostics']),
  ]),
];

/// The screen for a settings group.
Widget settingsGroupScreen(String id, AppSession session) => switch (id) {
      'business' => BusinessSettingsScreen(session: session),
      'invoice' => InvoiceSettingsScreen(session: session),
      'payments' => PaymentsSettingsScreen(session: session),
      'items' => ItemsSettingsScreen(session: session),
      'orders' => OrdersSettingsScreen(session: session),
      'accounting' => AccountingSettingsScreen(session: session),
      'team' => TeamSettingsScreen(session: session),
      'messaging' => MessagingSettingsScreen(session: session),
      'people' => PeopleSettingsScreen(session: session),
      'data' => PlanDataSettingsScreen(session: session),
      _ => HelpSettingsScreen(session: session),
    };

/// Website settings links (from the More menu and quick-settings sheets) mapped to the phone
/// screen that now holds them. Null = no phone screen; the caller falls back.
String? settingsGroupForHref(String href) {
  final h = href.split('?').first;
  if (h == '/settings') return '';
  if (h.startsWith('/settings/business#bp-features')) return 'items';
  if (h.startsWith('/settings/business#bp-payments')) return 'payments';
  if (h.startsWith('/settings/business') || h == '/settings/tax' || h == '/settings/gst-config' || h == '/settings/signature') return 'business';
  if (h.startsWith('/settings/templates') || h == '/settings/number-series' || h.startsWith('/settings/custom-fields') || h == '/settings/invoice') {
    return 'invoice';
  }
  if (h == '/settings/payments' || h == '/settings/whatsapp/notifications') return 'payments';
  if (h.startsWith('/settings/online-store') || h == '/orders/settings') return 'orders';
  if (h == '/settings/financial-years' || h == '/settings/period-locks' || h == '/settings/account-mappings') return 'accounting';
  if (h == '/settings/users' || h == '/settings/roles' || h == '/settings/user-management' || h == '/settings/user-branches' || h == '/settings/user-warehouses' || h == '/settings/activity') {
    return 'team';
  }
  if (h.startsWith('/settings/whatsapp') || h == '/settings/email') return 'messaging';
  if (h == '/settings/subscription' || h == '/settings/products' || h == '/settings/backup' || h == '/settings/export' || h == '/settings/features') return 'data';
  if (h.startsWith('/settings/help')) return 'help';
  const hr = [
    '/settings/shifts', '/settings/weekly-off', '/settings/holiday-lists', '/settings/holidays', '/settings/attendance-policy',
    '/settings/attendance-regularization', '/settings/ot-policy', '/settings/leave-plan', '/settings/leave-types', '/settings/hr-approval',
    '/settings/payroll', '/settings/salary-components', '/settings/commission-rules', '/settings/hiring', '/settings/onboarding-templates',
    '/settings/offer-letter', '/settings/employee-portal', '/settings/hr-employee', '/settings/hr-exit', '/settings/departments',
  ];
  if (hr.contains(h)) return 'people';
  return null;
}

/// All settings: what still needs filling in, then every group with what it holds, plus search.
class SettingsHubScreen extends StatefulWidget {
  const SettingsHubScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<SettingsHubScreen> createState() => _SettingsHubScreenState();
}

class _SettingsHubScreenState extends State<SettingsHubScreen> {
  final _search = TextEditingController();
  String _q = '';
  List<(String, String, String)> _todos = const []; // (label, why, group)
  int _total = 5;

  @override
  void initState() {
    super.initState();
    _loadTodos();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  /// The few things an invoice needs that are still missing.
  Future<void> _loadTodos() async {
    final api = widget.session.api;
    try {
      final r = await Future.wait([
        api.getJson('/api/businesses/${widget.session.businessId}').catchError((_) => <String, dynamic>{}),
        api.getJson('/api/payment-methods').catchError((_) => <String, dynamic>{}),
      ]);
      final b = jsonMap(r[0]['business']);
      bool blank(String k) => (b[k]?.toString() ?? '').trim().isEmpty;
      final registered = (b['gst_registration_type']?.toString() ?? 'unregistered') != 'unregistered';
      final todos = <(String, String, String)>[
        if (blank('address_line1')) ('Address', 'Printed in the invoice header', 'business'),
        if (registered && blank('gstin')) ('GSTIN', 'Needed on tax invoices', 'business'),
        if (blank('logo_url')) ('Logo', 'Top of every invoice', 'business'),
        if (blank('signature_url')) ('Signature', 'Above “Authorised signatory”', 'business'),
        if (jsonList(r[1]['methods']).isEmpty) ('UPI ID', 'QR on invoices and payment links', 'payments'),
      ];
      if (mounted) {
        setState(() {
          _todos = todos;
          _total = registered ? 5 : 4;
        });
      }
    } on ApiException catch (_) {}
  }

  Future<void> _open(String id) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => settingsGroupScreen(id, widget.session)));
    _loadTodos();
  }

  @override
  Widget build(BuildContext context) {
    final q = _q.toLowerCase();
    final done = (_total - _todos.length).clamp(0, _total);
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 40),
        children: [
          if (q.isEmpty && _todos.isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(gradient: AppGradients.brand, borderRadius: BorderRadius.circular(AppRadius.lg)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.session.businessName, style: AppText.heading.copyWith(color: AppGradients.on)),
                  const SizedBox(height: 4),
                  Text('Setup ${(done * 100 / _total).round()}% done · ${_todos.length} to fill', style: AppText.caption.copyWith(color: AppGradients.on.withValues(alpha: 0.85))),
                  const SizedBox(height: 10),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: LinearProgressIndicator(
                      value: done / _total,
                      minHeight: 7,
                      backgroundColor: AppGradients.on.withValues(alpha: 0.2),
                      valueColor: AlwaysStoppedAnimation(KhatarioColors.accent500),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final (label, _, group) in _todos)
                        Material(
                          color: AppGradients.on.withValues(alpha: 0.16),
                          borderRadius: BorderRadius.circular(20),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(20),
                            onTap: () => _open(group),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              child: Text('$label →', style: AppText.small.copyWith(color: AppGradients.on)),
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpace.lg),
          ],
          KSearchField(controller: _search, hint: 'Search settings', onChanged: (v) => setState(() => _q = v.trim())),
          const SizedBox(height: AppSpace.lg),
          for (final (section, groups) in settingsGroups) ...[
            Builder(builder: (_) {
              final shown = groups.where((g) => q.isEmpty || g.title.toLowerCase().contains(q) || g.summary.toLowerCase().contains(q) || g.keywords.any((k) => k.contains(q) || q.contains(k))).toList();
              if (shown.isEmpty) return const SizedBox.shrink();
              return Padding(
                padding: const EdgeInsets.only(bottom: AppSpace.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(padding: const EdgeInsets.only(left: 4, bottom: 6), child: Text(section.toUpperCase(), style: AppText.overline)),
                    KCard(
                      child: KDivided(children: [
                        for (final g in shown)
                          KListRow(
                            leading: Container(
                              width: 36,
                              height: 36,
                              decoration: BoxDecoration(color: AppColors.brandSoft, borderRadius: BorderRadius.circular(10)),
                              child: Icon(g.icon, size: 18, color: AppColors.brand),
                            ),
                            title: g.title,
                            subtitle: g.summary,
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (_todos.where((t) => t.$3 == g.id).isNotEmpty) KBadge(count: _todos.where((t) => t.$3 == g.id).length),
                                Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                              ],
                            ),
                            onTap: () => _open(g.id),
                          ),
                      ]),
                    ),
                  ],
                ),
              );
            }),
          ],
          if (q.isNotEmpty && settingsGroups.every((s) => s.$2.every((g) => !(g.title.toLowerCase().contains(q) || g.summary.toLowerCase().contains(q) || g.keywords.any((k) => k.contains(q) || q.contains(k))))))
            const KEmptyState(icon: LucideIcons.search, title: 'Nothing matches', body: 'Try “UPI”, “returns” or “GST”.'),
        ],
      ),
    );
  }
}
