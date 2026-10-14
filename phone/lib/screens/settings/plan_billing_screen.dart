import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import 'settings_kit.dart';

/// Website `SubscriptionTab`: plan name, usage, included features, and billing history.
/// Plan changes stay on the website because they go through checkout.
class PlanBillingScreen extends StatefulWidget {
  const PlanBillingScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<PlanBillingScreen> createState() => _PlanBillingScreenState();
}

class _PlanBillingScreenState extends State<PlanBillingScreen> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic> _subscription = const {};
  List<Map<String, dynamic>> _modules = const [];
  Map<String, dynamic>? _seats;
  List<Map<String, dynamic>> _history = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final current = await widget.session.api.getJson('/api/subscriptions/current');
      Map<String, dynamic> modulesBody = const {};
      List<Map<String, dynamic>> history = const [];
      try {
        modulesBody = await widget.session.api.getJson('/api/subscriptions/modules/current');
      } on ApiException {
        modulesBody = const {};
      }
      try {
        final billing = await widget.session.api.getJson('/api/subscriptions/billing-history');
        history = jsonList(billing['history']);
      } on ApiException {
        history = const [];
      }
      if (!mounted) return;
      setState(() {
        _subscription = jsonMap(current['subscription']);
        _modules = jsonList(modulesBody['modules']);
        _seats = modulesBody['console_seats'] is Map ? jsonMap(modulesBody['console_seats']) : null;
        _history = history;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Plan & billing',
      blurb: 'Your plan, what you have used, and past payments.',
      icon: LucideIcons.creditCard,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        if (!_loading && _error == null) ...[
          _planCard(),
          if (_seats != null) _seatsCard(),
          for (final module in _modules) _moduleCard(module),
          if (_modules.isEmpty) _usageCard(),
          _featuresCard(),
          _historyCard(),
          const SizedBox(height: AppSpace.md),
          KButton(
            label: 'Change plan on the website',
            onPressed: () => launchUrl(Uri.parse('https://staging.khatario.com/settings/subscription'), mode: LaunchMode.externalApplication),
          ),
        ],
      ],
    );
  }

  Widget _planCard() {
    final name = _subscription['plan_display_name']?.toString();
    final description = _subscription['plan_description']?.toString() ?? '';
    final status = _subscription['status']?.toString() ?? '';
    final from = _subscription['downgraded_from']?.toString();
    return KCard(
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(name == null || name.isEmpty ? 'No plan' : name, style: AppText.heading.copyWith(fontSize: 20))),
                KPill(label: _statusLabel(status), tone: _statusTone(status)),
              ],
            ),
            if (description.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(description, style: AppText.caption),
            ],
            if (from != null && from.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Previously on ${_pretty(from)}.', style: AppText.body),
            ],
            const SizedBox(height: 12),
            _line('Started', _day(_subscription['start_date'])),
            _line('Renews or ends', _day(_subscription['end_date'])),
            if (_subscription['trial_end_date'] != null) _line('Trial ends', _day(_subscription['trial_end_date'])),
            if (_subscription['cancel_at_period_end'] == true) _line('Cancellation', 'At the end of this period'),
            if (_subscription['is_grace_period_active'] == true)
              _line('Payment', 'Grace period, ${_subscription['grace_days_remaining'] ?? ''} days left'),
          ],
        ),
      ),
    );
  }

  Widget _seatsCard() {
    final current = toNum(_seats!['current']).toInt();
    final max = toNum(_seats!['max']).toInt();
    return Padding(
      padding: const EdgeInsets.only(top: AppSpace.md),
      child: KCard(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('CONSOLE SEATS', style: AppText.label),
              const SizedBox(height: 4),
              Text(max < 0 ? '$current — Unlimited' : '$current / $max', style: AppText.heading.copyWith(fontSize: 18)),
              const SizedBox(height: 4),
              Text('Shared logins across Billing, HR and Connect. Attendance-only employees do not use a seat.', style: AppText.caption),
            ],
          ),
        ),
      ),
    );
  }

  Widget _moduleCard(Map<String, dynamic> module) {
    final sub = jsonMap(module['subscription']);
    if (sub.isEmpty) return const SizedBox.shrink();
    final price = toNum(sub['price_monthly']);
    return Padding(
      padding: const EdgeInsets.only(top: AppSpace.md),
      child: KCard(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text((module['label'] ?? module['module_key'] ?? 'Product').toString(), style: AppText.label),
              const SizedBox(height: 4),
              Text(sub['plan_display_name']?.toString() ?? 'Plan', style: AppText.bodyStrong),
              if ((sub['plan_description']?.toString() ?? '').isNotEmpty)
                Text(sub['plan_description'].toString(), style: AppText.caption),
              const SizedBox(height: 4),
              Text(price <= 0 ? 'Free' : '${inr(price)} / month', style: AppText.body),
              for (final usage in jsonList(module['usage'])) _usageRow(usage),
            ],
          ),
        ),
      ),
    );
  }

  Widget _usageCard() {
    const types = ['invoices', 'customers', 'items', 'users', 'employees'];
    return Padding(
      padding: const EdgeInsets.only(top: AppSpace.md),
      child: KCard(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Current usage', style: AppText.bodyStrong),
              const SizedBox(height: 8),
              for (final type in types)
                FutureBuilder<Map<String, dynamic>>(
                  future: _limit(type),
                  builder: (context, snap) {
                    final data = snap.data;
                    if (data == null) return const SizedBox.shrink();
                    return _usageRow({
                      'limit_type': type,
                      'current_count': data['current'],
                      'max_limit': data['limit'],
                    });
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  final _limits = <String, Future<Map<String, dynamic>>>{};

  Future<Map<String, dynamic>> _limit(String type) => _limits.putIfAbsent(type, () async {
        try {
          return await widget.session.api.getJson('/api/subscriptions/check-limit?limit_type=$type');
        } on ApiException {
          return const {};
        }
      });

  Widget _usageRow(Map<String, dynamic> usage) {
    final label = _usageLabels[usage['limit_type']?.toString()] ?? _pretty(usage['limit_type']?.toString() ?? 'Usage');
    final current = toNum(usage['current_count']).toInt();
    final max = toNum(usage['max_limit']).toInt();
    final unlimited = max < 0;
    final fraction = unlimited || max == 0 ? 0.0 : (current / max).clamp(0.0, 1.0);
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(child: Text(label, style: AppText.body)),
              Text(unlimited ? '$current — Unlimited' : '$current / $max', style: AppText.caption),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: unlimited ? 0.04 : fraction,
              minHeight: 8,
              backgroundColor: AppColors.sunken,
              color: fraction >= 0.9 ? AppColors.negative : AppColors.brand,
            ),
          ),
        ],
      ),
    );
  }

  Widget _featuresCard() {
    final features = jsonList(_subscription['enabled_features']);
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final feature in features) {
      groups.putIfAbsent(feature['category']?.toString() ?? 'other', () => []).add(feature);
    }
    return Padding(
      padding: const EdgeInsets.only(top: AppSpace.md),
      child: KCard(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Included', style: AppText.bodyStrong),
              if (features.isEmpty)
                Padding(padding: const EdgeInsets.only(top: 8), child: Text('No feature list for this plan.', style: AppText.caption))
              else
                for (final category in groups.keys) ...[
                  Padding(
                    padding: const EdgeInsets.only(top: 12, bottom: 4),
                    child: Text(_category(category), style: AppText.label),
                  ),
                  for (final feature in groups[category]!)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(
                        children: [
                          Icon(LucideIcons.check, size: 14, color: AppColors.positive),
                          const SizedBox(width: 8),
                          Expanded(child: Text(feature['label']?.toString() ?? '', style: AppText.body)),
                        ],
                      ),
                    ),
                ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _historyCard() {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpace.md),
      child: KCard(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Billing history', style: AppText.bodyStrong),
              if (_history.isEmpty)
                Padding(padding: const EdgeInsets.only(top: 8), child: Text('No payments yet.', style: AppText.caption))
              else
                for (final row in _history.take(20))
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(row['description']?.toString() ?? row['plan_display_name']?.toString() ?? 'Payment', style: AppText.body),
                              Text('${_day(row['date'])} · ${_pretty(row['status']?.toString() ?? '')}', style: AppText.caption),
                            ],
                          ),
                        ),
                        Text(inr(toNum(row['amount'])), style: AppText.bodyStrong),
                      ],
                    ),
                  ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _line(String label, String value) {
    if (value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        children: [
          Expanded(child: Text(label, style: AppText.caption)),
          Text(value, style: AppText.body),
        ],
      ),
    );
  }

  String _day(dynamic raw) {
    final text = raw?.toString() ?? '';
    if (text.isEmpty) return '';
    final parsed = DateTime.tryParse(text);
    return parsed == null ? text : ddMMMyyyy(parsed.toLocal());
  }

  String _pretty(String value) => value.replaceAll('_', ' ').trim();

  String _statusLabel(String status) => status.isEmpty ? 'Unknown' : '${status[0].toUpperCase()}${status.substring(1)}';

  KTone _statusTone(String status) => switch (status) {
        'active' || 'trial' => KTone.positive,
        'cancelled' => KTone.negative,
        _ => KTone.due,
      };

  String _category(String category) => const {
        'sales': 'Sales',
        'purchase': 'Purchases',
        'inventory': 'Inventory',
        'hr': 'HR & Payroll',
        'reports': 'Reports',
        'settings': 'Settings',
        'integrations': 'Integrations',
        'advanced': 'Advanced',
        'tools': 'Tools',
        'billing': 'Billing',
        'connect': 'Connect',
        'other': 'Other',
      }[category] ??
      _pretty(category);

  static const _usageLabels = {
    'invoices': 'Invoices this month',
    'customers': 'Customers',
    'items': 'Items',
    'users': 'Console seats',
    'employees': 'Employees',
    'whatsapp': 'WhatsApp today',
    'connect_agents': 'WhatsApp agents',
  };
}
