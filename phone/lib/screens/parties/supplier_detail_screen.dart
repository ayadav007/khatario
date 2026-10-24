import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/detail_panel_shell.dart';
import '../../ui/kit.dart';
import '../hub/hub_link_cards.dart';
import 'party_logic.dart';

/// `SupplierDetailPanel`: Overview, Transactions and History. Purchases stay on the server.
class SupplierDetailScreen extends StatefulWidget {
  const SupplierDetailScreen({super.key, required this.session, required this.supplierId, required this.onOpen});

  final AppSession session;
  final String supplierId;
  final void Function(String what) onOpen;

  @override
  State<SupplierDetailScreen> createState() => _SupplierDetailScreenState();
}

class _SupplierDetailScreenState extends State<SupplierDetailScreen> {
  Map<String, dynamic>? _supplier;
  List<Map<String, dynamic>> _purchases = const [];
  List<Map<String, dynamic>> _payments = const [];
  num _totalPayable = 0;
  bool _loading = true;
  bool _missing = false;
  String _tab = 'overview';
  List<Map<String, dynamic>>? _history;
  bool _historyLoading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  List<Map<String, dynamic>> _rows(dynamic value) =>
      value is List ? value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/suppliers/${widget.supplierId}');
      if (!mounted) return;
      final supplier = body['supplier'];
      setState(() {
        _supplier = supplier is Map ? Map<String, dynamic>.from(supplier) : null;
        _missing = supplier is! Map;
        _purchases = _rows(body['purchases']);
        _payments = _rows(body['payments']);
        _totalPayable = toNum(body['totalPayable']);
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _missing = true;
          _loading = false;
        });
      }
    }
  }

  Future<void> _loadHistory() async {
    setState(() => _historyLoading = true);
    try {
      final body = await widget.session.api.getJson('/api/suppliers/${widget.supplierId}/history');
      if (!mounted) return;
      setState(() => _history = _rows(body['history']));
    } catch (_) {
      if (mounted) setState(() => _history = const []);
    } finally {
      if (mounted) setState(() => _historyLoading = false);
    }
  }

  void _selectTab(String id) {
    setState(() => _tab = id);
    if (id == 'history' && _history == null) _loadHistory();
  }

  String? _s(dynamic v) {
    final t = v?.toString().trim() ?? '';
    return t.isEmpty ? null : t;
  }

  @override
  Widget build(BuildContext context) {
    final supplier = _supplier;
    if (_loading || _missing || supplier == null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: DetailPanelPlaceholder(loading: _loading, notFoundText: 'Supplier not found', onClose: () => Navigator.pop(context)),
        ),
      );
    }
    final balance = partyBalance(supplier['current_balance'], supplier['opening_balance']);
    final name = supplier['name']?.toString() ?? 'Supplier';
    final phone = _s(supplier['phone']) ?? '';
    final settled = balance.abs() < 0.005;
    final tone = settled ? KTone.positive : KTone.negative;
    final address = [
      _s(supplier['address']),
      [supplier['city'], supplier['state'], supplier['pincode']].map(_s).whereType<String>().join(', '),
    ].whereType<String>().where((p) => p.isNotEmpty).join('\n');

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: DetailPanelShell<String>(
          title: name,
          subtitle: [if (phone.isNotEmpty) Text(phone), const Text('Supplier')],
          avatar: KAvatar(name: name, size: 36),
          tabs: const [
            ('overview', 'Overview', LucideIcons.user),
            ('transactions', 'Transactions', LucideIcons.receipt),
            ('history', 'History', LucideIcons.history),
          ],
          activeTab: _tab,
          onTabChange: _selectTab,
          onClose: () => Navigator.of(context).pop(),
          actions: [
            Tooltip(message: 'Edit', child: KIconButton(icon: LucideIcons.pencil, tooltip: 'Edit', onTap: () => widget.onOpen('Edit supplier'))),
          ],
          header: KCard(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(balance > 0.005 ? 'Amount payable' : balance < -0.005 ? 'Advance paid' : 'Account balance', style: AppText.label),
                      const SizedBox(height: 4),
                      settled
                          ? Text('Clear', style: AppText.amount.copyWith(color: AppColors.positive))
                          : KAmount(balance.abs(), style: AppText.amount, maxFraction: 2, color: tone.fg),
                      const SizedBox(height: 4),
                      Text(supplierBalanceHint(balance), style: AppText.caption.copyWith(fontSize: 12)),
                      if (_totalPayable != 0)
                        Text('Total payable $rupeeSign${enIn(_totalPayable, maxFraction: 2)}', style: AppText.caption.copyWith(fontSize: 12)),
                    ],
                  ),
                ),
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(16)),
                  child: Icon(settled ? LucideIcons.circleCheck : LucideIcons.arrowUpRight, color: tone.fg),
                ),
              ],
            ),
          ),
          body: switch (_tab) {
            'transactions' => _SupplierTransactions(purchases: _purchases, payments: _payments, onOpen: widget.onOpen),
            'history' => _historyLoading && _history == null
                ? const KSpinner()
                : (_history == null || _history!.isEmpty)
                    ? const DetailEmptyState(icon: LucideIcons.history, text: 'No activity recorded yet.')
                    : DetailHistoryTimeline(
                        entries: [
                          for (final h in _history!)
                            (
                              description: h['description']?.toString() ?? '',
                              meta: '${h['user_name'] ?? h['user_email'] ?? 'System'} • ${partyDayTime(h['created_at'])}',
                              action: h['action_type']?.toString() ?? '',
                            ),
                        ],
                      ),
            _ => Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xl, AppSpace.gutter, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_s(supplier['linked_business_id']) != null)
                      HubSupplierLinkCard(session: widget.session, supplierId: widget.supplierId, supplierName: name),
                    KInfoCard(title: 'Primary Details', rows: [
                      ('Name', name),
                      if (phone.isNotEmpty) ('Phone', phone),
                      if (_s(supplier['email']) != null) ('Email', _s(supplier['email'])!),
                      if (_s(supplier['gstin']) != null) ('GSTIN', _s(supplier['gstin'])!),
                      (
                        'Opening balance',
                        '$rupeeSign${enIn(toNum(supplier['opening_balance']), maxFraction: 2)} (${supplier['opening_balance_type'] ?? ''})',
                      ),
                    ]),
                    if (address.isNotEmpty) ...[
                      const SizedBox(height: AppSpace.xl),
                      KInfoCard(title: 'Address', rows: [('Address', address)]),
                    ],
                    if (_s(supplier['notes']) != null) ...[
                      const SizedBox(height: AppSpace.xl),
                      KInfoCard(title: 'Notes', rows: [('Notes', _s(supplier['notes'])!)]),
                    ],
                  ],
                ),
              ),
          },
          bottomBar: KBottomBar(children: [
            if (phone.isNotEmpty) KIconTile(icon: LucideIcons.phone, label: 'Call', onTap: () => launchUrl(Uri(scheme: 'tel', path: phone))),
            Expanded(child: KButton.secondary(label: 'Pay', icon: LucideIcons.arrowUpRight, onPressed: () => widget.onOpen('New payment out'))),
            Expanded(child: KButton(label: 'New purchase', icon: LucideIcons.plus, onPressed: () => widget.onOpen('New purchase'))),
          ]),
        ),
      ),
    );
  }
}

class _SupplierTransactions extends StatelessWidget {
  const _SupplierTransactions({required this.purchases, required this.payments, required this.onOpen});

  final List<Map<String, dynamic>> purchases;
  final List<Map<String, dynamic>> payments;
  final void Function(String what) onOpen;

  @override
  Widget build(BuildContext context) {
    if (purchases.isEmpty && payments.isEmpty) {
      return KEmptyState(
        icon: LucideIcons.shoppingCart,
        title: 'No purchases or payments yet.',
        action: KButton(label: 'New purchase', icon: LucideIcons.plus, expand: false, onPressed: () => onOpen('New purchase')),
      );
    }
    Widget icon(IconData i, (Color, Color) tint) => Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(color: tint.$1, borderRadius: BorderRadius.circular(12)),
          child: Icon(i, size: 18, color: tint.$2),
        );
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: AppSpace.xl),
          KSectionHeader('Purchases (${purchases.length})', action: '+ New', onAction: () => onOpen('New purchase')),
          KCard(
            child: purchases.isEmpty
                ? Padding(padding: const EdgeInsets.all(16), child: Text('No purchase bills for this supplier.', style: AppText.caption))
                : KDivided(
                    indent: 66,
                    children: [
                      for (final p in purchases)
                        KListRow(
                          onTap: () => onOpen('Purchase ${p['bill_number'] ?? p['id']}'),
                          leading: icon(LucideIcons.shoppingCart, AppTints.sky),
                          title: p['bill_number']?.toString().isNotEmpty == true ? p['bill_number'].toString() : '—',
                          subtitle: partyDay(p['bill_date']),
                          trailing: KStatusDot.status(p['status']?.toString() ?? ''),
                        ),
                    ],
                  ),
          ),
          const SizedBox(height: AppSpace.xl),
          KSectionHeader('Payments (${payments.length})', action: '+ New', onAction: () => onOpen('New payment out')),
          KCard(
            child: payments.isEmpty
                ? Padding(padding: const EdgeInsets.all(16), child: Text('No payments recorded.', style: AppText.caption))
                : KDivided(
                    indent: 66,
                    children: [
                      for (final p in payments)
                        KListRow(
                          leading: icon(LucideIcons.arrowUpRight, AppTints.rose),
                          title: 'PAY-${p['id'].toString().substring(0, p['id'].toString().length < 8 ? p['id'].toString().length : 8)}',
                          subtitle: '${partyDay(p['payment_date'])} · ${p['payment_mode'] ?? '—'}',
                          trailing: Text('$rupeeSign${enIn(toNum(p['amount']), maxFraction: 2)}', style: AppText.bodyStrong),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

String partyDayTime(dynamic value) {
  final d = parsePartyDate(value);
  return d == null ? '—' : ddMMMyyyyHm(d);
}
