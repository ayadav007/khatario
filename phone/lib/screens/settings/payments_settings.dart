import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../pages/record_page.dart' show openWebsitePage;
import 'settings_kit.dart';

/// Settings › Payments: bank accounts, UPI & payment methods, online gateways and payment
/// reminders. Every money-in setting in one place.
class PaymentsSettingsScreen extends StatefulWidget {
  const PaymentsSettingsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<PaymentsSettingsScreen> createState() => _PaymentsSettingsScreenState();
}

class _PaymentsSettingsScreenState extends State<PaymentsSettingsScreen> {
  List<Map<String, dynamic>> _banks = const [];
  List<Map<String, dynamic>> _methods = const [];
  List<Map<String, dynamic>> _providers = const [];
  String? _preferred;
  Map<String, dynamic>? _rem; // null = reminders not available (WhatsApp off)
  bool _loading = true;
  String? _error;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    Future<Map<String, dynamic>> safe(String path) => _api.getJson(path).catchError((_) => <String, dynamic>{});
    try {
      final r = await Future.wait([
        safe('/api/bank-accounts'),
        _api.getJson('/api/payment-methods'),
        safe('/api/settings/payment-providers'),
        safe('/api/settings/payments'),
        _api.getJson('/api/whatsapp/reminders').then<Map<String, dynamic>?>((v) => v).catchError((_) => null),
      ]);
      if (!mounted) return;
      setState(() {
        _banks = jsonList(r[0]!['accounts']);
        _methods = jsonList(r[1]!['methods']);
        _providers = jsonList(r[2]!['providers']);
        _preferred = r[3]!['default_payment_provider']?.toString();
        _rem = r[4];
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    }
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  // ---------- UPI & methods ----------

  Future<void> _addUpi() async {
    final name = TextEditingController(text: 'UPI');
    final upi = TextEditingController();
    var makeDefault = _methods.isEmpty;
    final ok = await showKSheet<bool>(
      context,
      title: 'Add UPI ID',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(controller: upi, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'UPI ID', hintText: 'yourshop@okhdfcbank')),
              const SizedBox(height: 12),
              TextField(controller: name, decoration: const InputDecoration(labelText: 'Name shown to customers')),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Use for QR and payment links'),
                value: makeDefault,
                activeTrackColor: AppColors.brand,
                onChanged: (v) => set(() => makeDefault = v),
              ),
              const SizedBox(height: 8),
              KButton(label: 'Add UPI ID', onPressed: () => Navigator.pop(ctx, true)),
            ],
          ),
        ),
      ),
    );
    if (ok != true) return;
    try {
      await _api.postJson('/api/payment-methods', {
        'method_type': 'upi',
        'method_name': name.text.trim().isEmpty ? 'UPI' : name.text.trim(),
        'upi_id': upi.text.trim(),
        'is_default': makeDefault,
        'is_active': true,
      });
      await _load();
      _snack('UPI ID added');
    } on ApiException catch (e) {
      _snack(e.message);
    }
  }

  Future<void> _methodActions(Map<String, dynamic> m) async {
    await showKSheet<void>(
      context,
      title: m['method_name']?.toString() ?? 'Payment method',
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (m['is_default'] != true)
            KSheetAction(
              icon: LucideIcons.star,
              label: 'Use for QR and payment links',
              onTap: () async {
                Navigator.pop(ctx);
                await _updateMethod(m, {'is_default': true, 'is_active': true}, 'Default payment method set');
              },
            ),
          KSheetAction(
            icon: m['is_active'] == false ? LucideIcons.eye : LucideIcons.eyeOff,
            label: m['is_active'] == false ? 'Show on invoices again' : 'Hide from invoices',
            onTap: () async {
              Navigator.pop(ctx);
              await _updateMethod(m, {'is_active': m['is_active'] == false}, 'Updated');
            },
          ),
        ],
      ),
    );
  }

  Future<void> _updateMethod(Map<String, dynamic> m, Map<String, dynamic> change, String done) async {
    try {
      await _api.putJson('/api/payment-methods', {
        for (final k in ['id', 'method_type', 'method_name', 'upi_id', 'bank_account_id', 'wallet_provider', 'account_details', 'is_active', 'is_default', 'priority', 'notes']) k: m[k],
        ...change,
      });
      await _load();
      _snack(done);
    } on ApiException catch (e) {
      _snack(e.message);
    }
  }

  // ---------- reminders ----------

  Map<String, dynamic> get _due => jsonMap(jsonMap(_rem?['settings'])['payment_due']);
  Map<String, dynamic> get _overdue => jsonMap(jsonMap(_rem?['settings'])['overdue']);
  Map<String, dynamic> get _schedule => jsonMap(_rem?['schedule']);

  Future<void> _saveReminders({Map<String, dynamic>? due, Map<String, dynamic>? overdue, Map<String, dynamic>? schedule, required String message}) async {
    final before = _rem;
    final next = {
      'settings': {
        'payment_due': {..._due, ...?due},
        'overdue': {..._overdue, ...?overdue},
      },
      'schedule': {..._schedule, ...?schedule},
    };
    setState(() => _rem = next);
    Future<void> send(Map<String, dynamic> v) => _api.postJson('/api/whatsapp/reminders', {
          'payment_due': {
            'enabled': jsonMap(jsonMap(v['settings'])['payment_due'])['enabled'] == true,
            'days_before': toNum(jsonMap(jsonMap(v['settings'])['payment_due'])['days_before'] ?? 3).toInt(),
            'message_template': jsonMap(jsonMap(v['settings'])['payment_due'])['message_template'],
            'include_pdf': jsonMap(jsonMap(v['settings'])['payment_due'])['include_pdf'] == true,
          },
          'overdue': {
            'enabled': jsonMap(jsonMap(v['settings'])['overdue'])['enabled'] == true,
            'interval_days': toNum(jsonMap(jsonMap(v['settings'])['overdue'])['interval_days'] ?? 7).toInt(),
            'message_template': jsonMap(jsonMap(v['settings'])['overdue'])['message_template'],
            'include_pdf': jsonMap(jsonMap(v['settings'])['overdue'])['include_pdf'] == true,
          },
          'schedule': jsonMap(v['schedule']),
        });
    await saveInstantly(
      context,
      message: message,
      save: () => send(next),
      revert: () => setState(() => _rem = before),
      undo: before == null ? null : () => send(before),
    );
  }

  @override
  Widget build(BuildContext context) {
    final connected = _providers.where((p) => p['configured'] == true).toList();
    final time = _schedule['reminder_send_time']?.toString() ?? '09:00';
    return SettingsPage(
      title: 'Payments',
      blurb: 'Where customers pay you, online collections and reminders. All money-in settings in one place.',
      icon: LucideIcons.wallet,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(
          title: 'Bank accounts',
          why: 'The “pay to” block on invoices.',
          children: [
            for (final b in _banks)
              ItemSetting(
                leading: KAvatar(name: b['bank_name']?.toString() ?? 'B', icon: LucideIcons.landmark),
                title: '${b['bank_name'] ?? 'Bank'} · ${_mask(b['account_number'])}',
                subtitle: [b['account_type'], b['ifsc_code']].where((v) => v != null && '$v'.isNotEmpty).join(' · '),
                trailing: KPill(label: b['is_active'] == false ? 'Hidden' : 'On invoices', tone: b['is_active'] == false ? KTone.neutral : KTone.positive),
                onTap: () => openWebsitePage('/settings/business#bp-payments'),
              ),
            if (_banks.isEmpty) const SettingRow(label: 'No bank account yet', help: 'Add one so customers know where to pay from the invoice.'),
            AddSetting(label: 'Add or edit on the website', onTap: () => openWebsitePage('/settings/business#bp-payments')),
          ],
        ),
        SettingsSection(
          title: 'UPI & payment methods',
          why: 'Prints a UPI QR on invoices and goes in WhatsApp payment links.',
          children: [
            for (final m in _methods)
              ItemSetting(
                leading: KAvatar(name: m['method_name']?.toString() ?? 'U', icon: LucideIcons.qrCode),
                title: m['upi_id']?.toString().isNotEmpty == true ? m['upi_id'].toString() : m['method_name']?.toString() ?? 'Method',
                subtitle: m['method_name']?.toString(),
                trailing: KPill(
                  label: m['is_default'] == true ? 'Default' : (m['is_active'] == false ? 'Hidden' : 'Active'),
                  tone: m['is_default'] == true ? KTone.positive : KTone.neutral,
                ),
                onTap: () => _methodActions(m),
              ),
            if (_methods.isEmpty) const SettingRow(label: 'No UPI ID yet', help: 'Add one to print a QR on invoices and send payment links.', todo: true),
            AddSetting(label: 'Add UPI ID', onTap: _addUpi),
          ],
        ),
        SettingsSection(
          title: 'Online payment gateways',
          why: 'Card, UPI and netbanking payments that confirm themselves.',
          children: [
            for (final p in _providers)
              StatusSetting(
                label: p['displayName']?.toString() ?? p['id'].toString(),
                status: p['configured'] == true ? 'Connected · ${p['environment'] == 'production' ? 'live' : 'test'}' : 'Not connected',
                tone: p['configured'] == true ? KTone.positive : KTone.neutral,
                action: p['configured'] == true ? 'Manage' : 'Connect',
                onAction: () => openWebsitePage('/settings/payments'),
              ),
            if (connected.length > 1)
              ChoiceSetting<String>(
                label: 'Use for payment links',
                value: _preferred ?? '',
                options: [('', 'Automatic'), for (final p in connected) (p['id'].toString(), p['displayName']?.toString() ?? p['id'].toString())],
                onChanged: (v) {
                  final before = _preferred;
                  setState(() => _preferred = v);
                  saveInstantly(
                    context,
                    message: 'Payment links updated',
                    save: () => _api.patchJson('/api/settings/payments', {'default_payment_provider': v.isEmpty ? null : v}),
                    revert: () => setState(() => _preferred = before),
                  );
                },
              ),
          ],
        ),
        if (_rem == null)
          const SettingsSection(
            title: 'Payment reminders',
            why: 'WhatsApp nudges for unpaid bills. Link WhatsApp first.',
            children: [WebSetting(label: 'Set up WhatsApp', href: '/settings/whatsapp')],
          )
        else
          SettingsSection(
            title: 'Payment reminders',
            why: 'WhatsApp nudges for unpaid bills, sent once a day.',
            children: [
              ToggleSetting(
                label: 'Remind before the due date',
                value: _due['enabled'] == true,
                onChanged: (v) => _saveReminders(due: {'enabled': v}, message: v ? 'Before-due reminders on' : 'Before-due reminders off'),
              ),
              if (_due['enabled'] == true)
                ChoiceSetting<int>(
                  label: 'Days before',
                  value: toNum(_due['days_before'] ?? 3).toInt(),
                  options: const [(1, '1 day'), (2, '2 days'), (3, '3 days'), (5, '5 days'), (7, '7 days')],
                  onChanged: (v) => _saveReminders(due: {'days_before': v}, message: '$v days before'),
                ),
              ToggleSetting(
                label: 'Remind after the due date',
                help: 'Repeats until paid.',
                value: _overdue['enabled'] == true,
                onChanged: (v) => _saveReminders(overdue: {'enabled': v}, message: v ? 'Overdue reminders on' : 'Overdue reminders off'),
              ),
              if (_overdue['enabled'] == true)
                ChoiceSetting<int>(
                  label: 'Repeat every',
                  value: toNum(_overdue['interval_days'] ?? 7).toInt(),
                  options: const [(3, '3 days'), (7, '7 days'), (15, '15 days'), (30, '30 days')],
                  onChanged: (v) => _saveReminders(overdue: {'interval_days': v}, message: 'Every $v days'),
                ),
              ChoiceSetting<String>(
                label: 'Send at',
                value: time,
                options: const [('09:00', '9:00 AM'), ('10:00', '10:00 AM'), ('11:00', '11:00 AM'), ('13:00', '1:00 PM'), ('18:00', '6:00 PM')],
                onChanged: (v) => _saveReminders(schedule: {'reminder_send_time': v, 'reminder_send_timezone': _schedule['reminder_send_timezone'] ?? 'Asia/Kolkata'}, message: 'Reminders go out at $v'),
              ),
              ToggleSetting(
                label: 'Attach the invoice PDF',
                value: _due['include_pdf'] == true || _overdue['include_pdf'] == true,
                onChanged: (v) => _saveReminders(due: {'include_pdf': v}, overdue: {'include_pdf': v}, message: v ? 'PDF attached' : 'PDF not attached'),
              ),
            ],
          ),
      ],
    );
  }

  static String _mask(dynamic acct) {
    final s = acct?.toString() ?? '';
    return s.length <= 4 ? s : '••${s.substring(s.length - 4)}';
  }
}
