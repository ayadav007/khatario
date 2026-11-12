import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../format.dart' hide inr;
import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../hr/hr_manage_widgets.dart';
import '../pages/native_routes.dart';
import '../sales/doc_action_sheets.dart';
import 'supplier_dashboard_logic.dart';

Widget _stateBody({
  required bool notInPlan,
  required String title,
  required String? error,
  required Future<void> Function() onRetry,
}) {
  return ListView(
    children: [
      KEmptyState(
        icon: notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
        title: notInPlan ? 'Not included in your current plan' : title,
        body: error,
        action: notInPlan
            ? null
            : KButton.secondary(
                label: 'Try again',
                expand: false,
                onPressed: onRetry,
              ),
      ),
    ],
  );
}

/// Website `/suppliers/dashboard`: your customers' low stock alerts for the items you supply, with
/// Dismiss, and links to Area performance and Thresholds.
class SupplierDashboardScreen extends StatefulWidget {
  const SupplierDashboardScreen({
    super.key,
    required this.session,
    this.launcher,
  });

  final AppSession session;

  /// Opens a link outside the app (WhatsApp). Tests pass their own.
  final Future<bool> Function(Uri uri)? launcher;

  @override
  State<SupplierDashboardScreen> createState() =>
      _SupplierDashboardScreenState();
}

class _SupplierDashboardScreenState extends State<SupplierDashboardScreen>
    with HrScreenState {
  SupplierDashboard _data = const SupplierDashboard();
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() {
    final seq = ++_seq;
    return guardedLoad(() async {
      final json = await widget.session.api.getJson(supplierDashboardPath);
      if (seq != _seq) return;
      _data = SupplierDashboard.fromJson(json);
    });
  }

  Future<void> _dismiss(SupplierAlert a) => act(
    'dismiss-${a.id}',
    confirm: () async => true,
    send: () async {
      await widget.session.api.postJson(supplierDismissPath(a.id), const {});
    },
    done: 'Alert dismissed',
    reload: _load,
  );

  void _push(Widget screen) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Supplier dashboard'),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (loading && _data.alerts.isEmpty) {
      return const KSpinner(
        padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2),
      );
    }
    if (error != null) {
      return _stateBody(
        notInPlan: notInPlan,
        title: 'Could not load the supplier dashboard',
        error: error,
        onRetry: _load,
      );
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter,
          AppSpace.xs,
          AppSpace.gutter,
          AppSpace.xxl * 3,
        ),
        children: [
          Text(
            "Monitor your customers' inventory and track low stock alerts.",
            style: AppText.caption,
          ),
          const SizedBox(height: AppSpace.md),
          HrTileGrid(
            tiles: [
              HrCountTile(
                title: 'Active customers',
                value: _data.activeCustomers,
              ),
              HrCountTile(
                title: 'Low stock alerts',
                value: _data.lowStockAlerts,
                warn: true,
              ),
              HrCountTile(
                title: 'Monitored items',
                value: _data.monitoredItems,
              ),
            ],
          ),
          const SizedBox(height: AppSpace.sm),
          Text('Customers with Low Stock', style: AppText.heading),
          const SizedBox(height: AppSpace.sm),
          Wrap(
            spacing: AppSpace.sm,
            runSpacing: AppSpace.sm,
            children: [
              KButton.secondary(
                label: 'Suggested orders',
                expand: false,
                height: 40,
                onPressed: () => _open('/supply-orders', 'Suggested orders'),
              ),
              KButton.secondary(
                label: 'My catalog',
                expand: false,
                height: 40,
                onPressed: () => _open('/suppliers/catalog', 'My catalog'),
              ),
              KButton.secondary(
                label: 'View Requests',
                expand: false,
                height: 40,
                onPressed: () =>
                    _open('/supply-orders?role=vendor', 'View Requests'),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.md),
          if (_data.groups.isEmpty)
            const KEmptyState(
              icon: LucideIcons.package,
              title: 'No customers with low stock',
            )
          else
            for (final g in _data.groups) ...[
              _groupCard(g),
              const SizedBox(height: AppSpace.sm),
            ],
          const SizedBox(height: AppSpace.md),
          Text('Low Stock Alerts', style: AppText.heading),
          const SizedBox(height: AppSpace.sm),
          if (_data.alerts.isEmpty)
            KEmptyState(
              icon: LucideIcons.packageCheck,
              title: 'No low stock alerts',
              body: _data.activeCustomers == 0
                  ? 'No customers have granted you access to view their low stock alerts yet.'
                  : 'All monitored items are above their thresholds',
            )
          else
            for (final a in _data.alerts) ...[
              _alertCard(a),
              const SizedBox(height: AppSpace.sm),
            ],
          const SizedBox(height: AppSpace.md),
          _link(
            'Area performance',
            'See which areas are buying and selling, and where your goods sell onward.',
            LucideIcons.chartColumn,
            () => _push(SupplierAnalyticsScreen(session: widget.session)),
          ),
          const SizedBox(height: AppSpace.sm),
          _link(
            'Thresholds',
            'The low stock levels set for your customers.',
            LucideIcons.slidersHorizontal,
            () => _push(SupplierThresholdsScreen(session: widget.session)),
          ),
        ],
      ),
    );
  }

  void _open(String href, String label) =>
      openAppHref(context, widget.session, href, label);

  Future<void> _contact(String phone) async {
    final uri = whatsAppUri(phone);
    if (uri == null) return;
    await (widget.launcher ??
        (u) => launchUrl(u, mode: LaunchMode.externalApplication))(uri);
  }

  Future<void> _propose(SupplierGroup g) async {
    final sent = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) =>
            SupplierProposeOrderScreen(session: widget.session, group: g),
      ),
    );
    if (sent == true && mounted) _load();
  }

  Widget _groupCard(SupplierGroup g) {
    return KCard(
      padding: const EdgeInsets.all(AppSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(g.name, style: AppText.bodyStrong),
                    const SizedBox(height: AppSpace.xs),
                    Text(
                      'Items in low stock: ${g.itemsCount} • Total shortage: ${enIn(g.totalShortage)}',
                      style: AppText.caption,
                    ),
                    if (g.phone.isNotEmpty)
                      Text(g.phone, style: AppText.caption),
                    if (g.email.isNotEmpty)
                      Text(g.email, style: AppText.caption),
                    if (g.location.isNotEmpty)
                      Text(g.location, style: AppText.caption),
                  ],
                ),
              ),
              if (g.customerBusinessId.isNotEmpty && g.items.any((i) => i.itemId.isNotEmpty))
                KButton(
                  label: 'Propose order',
                  expand: false,
                  height: 40,
                  onPressed: () => _propose(g),
                ),
            ],
          ),
          const SizedBox(height: AppSpace.sm),
          for (final i in g.items)
            Padding(
              padding: const EdgeInsets.only(top: AppSpace.xs),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      i.code.isEmpty ? i.name : '${i.name} (${i.code})',
                      style: AppText.body,
                    ),
                  ),
                  Text(
                    enIn(i.stock),
                    style: AppText.bodyStrong.copyWith(
                      color: AppColors.negative,
                    ),
                  ),
                  Text(' / ${enIn(i.threshold)}', style: AppText.bodyStrong),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _link(String title, String body, IconData icon, VoidCallback onTap) {
    return KCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpace.md),
      child: Row(
        children: [
          Icon(icon, size: 20, color: AppColors.brand),
          const SizedBox(width: AppSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppText.bodyStrong),
                const SizedBox(height: AppSpace.xs),
                Text(body, style: AppText.caption),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _alertCard(SupplierAlert a) {
    final working = busy.contains('dismiss-${a.id}');
    return KCard(
      padding: const EdgeInsets.all(AppSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(a.itemName, style: AppText.bodyStrong),
          if (a.itemCode.isNotEmpty) Text(a.itemCode, style: AppText.caption),
          const SizedBox(height: AppSpace.xs),
          Row(
            children: [
              Text('Stock: ', style: AppText.body),
              Text(
                enIn(a.stock),
                style: AppText.bodyStrong.copyWith(color: AppColors.negative),
              ),
              const SizedBox(width: AppSpace.md),
              Text('Threshold: ', style: AppText.body),
              Text(enIn(a.threshold), style: AppText.bodyStrong),
            ],
          ),
          const SizedBox(height: AppSpace.sm),
          Text(a.customerName, style: AppText.bodyStrong),
          if (a.phone.isNotEmpty) Text(a.phone, style: AppText.caption),
          if (a.email.isNotEmpty) Text(a.email, style: AppText.caption),
          if (a.address.isNotEmpty) Text(a.address, style: AppText.caption),
          if (a.location.isNotEmpty) Text(a.location, style: AppText.caption),
          const SizedBox(height: AppSpace.sm),
          Align(
            alignment: Alignment.centerRight,
            child: Wrap(
              spacing: AppSpace.sm,
              children: [
                KButton(
                  label: 'Contact',
                  expand: false,
                  height: 40,
                  onPressed: a.phone.isEmpty ? null : () => _contact(a.phone),
                ),
                if (alertCanBeDismissed(a.id))
                  KButton.secondary(
                    label: 'Dismiss',
                    expand: false,
                    height: 40,
                    loading: working,
                    onPressed: working ? null : () => _dismiss(a),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Website `/suppliers/dashboard/analytics` (Area performance): where shops buy from you and where
/// your goods sell onward, as area totals only. The pivot and the ranking are here; the website's
/// map (a drawing of India) is not.
class SupplierAnalyticsScreen extends StatefulWidget {
  const SupplierAnalyticsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<SupplierAnalyticsScreen> createState() =>
      _SupplierAnalyticsScreenState();
}

class _SupplierAnalyticsScreenState extends State<SupplierAnalyticsScreen>
    with HrScreenState {
  AreaAnalytics _data = const AreaAnalytics();
  String _period = '90d';
  String _view = 'pivot';
  String _grain = 'state';
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() {
    final seq = ++_seq;
    final period = _period;
    return guardedLoad(() async {
      final json = await widget.session.api.getJson(
        supplierAnalyticsPath(period),
      );
      if (seq != _seq) return;
      _data = AreaAnalytics.fromJson(json);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Area performance'),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (error != null) {
      return _stateBody(
        notInPlan: notInPlan,
        title: 'Could not load area performance',
        error: error,
        onRetry: _load,
      );
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter,
          AppSpace.xs,
          AppSpace.gutter,
          AppSpace.xxl * 3,
        ),
        children: [
          Text(
            'Where shops buy from you, and where your goods sell onward. Only shops that chose to share their stock and sales with you are included, and only as area totals.',
            style: AppText.caption,
          ),
          const SizedBox(height: AppSpace.md),
          KChipBar<String>(
            value: _period,
            padding: EdgeInsets.zero,
            options: analyticsPeriods,
            onChanged: (v) {
              if (v == _period) return;
              setState(() => _period = v);
              _load();
            },
          ),
          const SizedBox(height: AppSpace.sm),
          KChipBar<String>(
            value: _view,
            padding: EdgeInsets.zero,
            options: analyticsViews,
            onChanged: (v) => setState(() => _view = v),
          ),
          const SizedBox(height: AppSpace.md),
          if (loading)
            const KSpinner(
              padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2),
            )
          else ...[
            if (_data.from.isNotEmpty)
              Text(
                '${_data.from} to ${_data.to}. Bought from you is their posted purchase bills. Sold onward is their posted invoices of items they buy from you, list you as the default supplier for, or that you set a threshold on.',
                style: AppText.small,
              ),
            const SizedBox(height: AppSpace.md),
            if (_data.emptyNote != null)
              KCard(
                padding: const EdgeInsets.all(AppSpace.lg),
                child: Text(
                  _data.emptyNote!,
                  style: AppText.body.copyWith(color: AppColors.ink2),
                  textAlign: TextAlign.center,
                ),
              )
            else
              ..._content(),
          ],
        ],
      ),
    );
  }

  List<Widget> _content() {
    final hidden = _data.hiddenFor(_grain);
    return [
      if (_view == 'rank') ...[
        KChipBar<String>(
          value: _grain,
          padding: EdgeInsets.zero,
          options: analyticsGrains,
          onChanged: (v) => setState(() => _grain = v),
        ),
        const SizedBox(height: AppSpace.md),
        if (hidden > 0) ...[
          Text(
            '$hidden shop${hidden == 1 ? ' is' : 's are'} not shown at this level: an area needs at least ${_data.minShops} shops before its totals appear.',
            style: AppText.small,
          ),
          const SizedBox(height: AppSpace.md),
        ],
        ..._areaCards(_data.rowsFor(_grain)),
      ] else ...[
        const KSectionHeader('Location pivot'),
        ..._areaCards(_data.states),
        const SizedBox(height: AppSpace.md),
        const KSectionHeader('State by item'),
        Text(
          'Onward sales of the top items, by state.',
          style: AppText.caption,
        ),
        const SizedBox(height: AppSpace.sm),
        if (_data.pivotItems.isEmpty)
          Text(
            'No onward sales in this period.',
            style: AppText.body.copyWith(color: AppColors.ink2),
          )
        else
          for (final row in _data.pivot) ...[
            KCard(
              padding: const EdgeInsets.all(AppSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(row.state, style: AppText.bodyStrong),
                      ),
                      Text(inr(row.total.round()), style: AppText.bodyStrong),
                    ],
                  ),
                  const SizedBox(height: AppSpace.xs),
                  for (final item in _data.pivotItems)
                    Padding(
                      padding: const EdgeInsets.only(top: AppSpace.xs),
                      child: Row(
                        children: [
                          Expanded(child: Text(item, style: AppText.caption)),
                          Text(
                            inr((row.cells[item] ?? 0).round()),
                            style: AppText.caption,
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpace.sm),
          ],
      ],
    ];
  }

  List<Widget> _areaCards(List<AreaRow> rows) {
    if (rows.isEmpty) {
      return [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpace.lg),
          child: Text(
            'Nothing in this selection.',
            style: AppText.body.copyWith(color: AppColors.ink2),
          ),
        ),
      ];
    }
    final top = rows.fold<num>(0, (m, r) => r.sellIn > m ? r.sellIn : m);
    return [
      for (final r in rows) ...[
        KCard(
          padding: const EdgeInsets.all(AppSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(r.label, style: AppText.bodyStrong)),
                  KPill(label: areaBandLabel(r.band), tone: _bandTone(r.band)),
                ],
              ),
              const SizedBox(height: AppSpace.sm),
              _bar(top == 0 ? 0 : (r.sellIn / top).toDouble()),
              const SizedBox(height: AppSpace.sm),
              _line('Customers', '${r.customers}'),
              _line('Bought from you', inr(r.sellIn.round())),
              _line('Sold onward', inr(r.sellThrough.round())),
              _line('Low stock', '${r.lowStock}'),
            ],
          ),
        ),
        const SizedBox(height: AppSpace.sm),
      ],
    ];
  }

  Widget _line(String label, String value) => Padding(
    padding: const EdgeInsets.only(top: AppSpace.xs),
    child: Row(
      children: [
        Expanded(child: Text(label, style: AppText.caption)),
        Text(value, style: AppText.caption.copyWith(color: AppColors.ink)),
      ],
    ),
  );

  /// A plain bar for the share of the biggest area's purchases (no chart package).
  Widget _bar(double share) => ClipRRect(
    borderRadius: BorderRadius.circular(AppRadius.sm),
    child: Container(
      height: 8,
      color: AppColors.sunken,
      alignment: Alignment.centerLeft,
      child: FractionallySizedBox(
        widthFactor: share.clamp(0.0, 1.0),
        child: Container(color: AppColors.brand),
      ),
    ),
  );

  KTone _bandTone(String band) => switch (band) {
    'strong' => KTone.positive,
    'watch' => KTone.due,
    'weak' => KTone.negative,
    _ => KTone.neutral,
  };
}

/// Website `/suppliers/dashboard/thresholds`: the low stock levels set for your customers. Setting a
/// new one is retired on the server (alerts follow each customer's own reorder levels), so the phone
/// lists them and deletes the old ones.
class SupplierThresholdsScreen extends StatefulWidget {
  const SupplierThresholdsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<SupplierThresholdsScreen> createState() =>
      _SupplierThresholdsScreenState();
}

class _SupplierThresholdsScreenState extends State<SupplierThresholdsScreen>
    with HrScreenState {
  List<SupplierThreshold> _rows = const [];
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() {
    final seq = ++_seq;
    return guardedLoad(() async {
      final json = await widget.session.api.getJson(supplierThresholdsPath);
      if (seq != _seq) return;
      _rows = supplierThresholds(json);
    });
  }

  /// The busy flag is set before the ask sheet opens, so a second tap while it is open (or while the
  /// request runs) does nothing. It is cleared when the sheet is declined or the request ends.
  Future<void> _delete(SupplierThreshold t) async {
    final key = 'del-${t.id}';
    if (busy.contains(key)) return;
    setState(() => busy.add(key));
    var changed = false;
    try {
      final ok = await askSheet(
        context,
        title: 'Delete threshold?',
        text:
            'Delete the threshold for ${t.itemName} at ${t.customerName}? This cannot be undone.',
        confirmLabel: 'Delete threshold',
        cancelLabel: 'Keep it',
      );
      if (!ok || !mounted) return;
      changed = true;
      try {
        await widget.session.api.deleteJson(supplierThresholdDeletePath(t.id));
        toast('Threshold deleted successfully', tone: KTone.positive);
      } on ApiException catch (e) {
        toast(e.message);
      } catch (_) {
        toast('Could not save. Try again.');
      }
    } finally {
      if (mounted) setState(() => busy.remove(key));
    }
    // The threshold may already be gone, so the list reloads after a refusal too.
    if (changed && mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Low stock thresholds'),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (loading && _rows.isEmpty) {
      return const KSpinner(
        padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2),
      );
    }
    if (error != null) {
      return _stateBody(
        notInPlan: notInPlan,
        title: 'Could not load thresholds',
        error: error,
        onRetry: _load,
      );
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter,
          AppSpace.xs,
          AppSpace.gutter,
          AppSpace.xxl * 3,
        ),
        children: [
          Text(
            "Supplier-set thresholds are retired. Alerts now follow each customer's own reorder levels. You can still remove old ones here.",
            style: AppText.caption,
          ),
          const SizedBox(height: AppSpace.md),
          if (_rows.isEmpty)
            const KEmptyState(
              icon: LucideIcons.triangleAlert,
              title: 'No thresholds set yet',
              body: "Alerts follow each customer's own reorder levels.",
            )
          else
            for (final t in _rows) ...[
              _card(t),
              const SizedBox(height: AppSpace.sm),
            ],
        ],
      ),
    );
  }

  Widget _card(SupplierThreshold t) {
    final working = busy.contains('del-${t.id}');
    return KCard(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.md,
        AppSpace.md,
        AppSpace.xs,
        AppSpace.md,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t.itemName, style: AppText.bodyStrong),
                if (t.itemCode.isNotEmpty)
                  Text(t.itemCode, style: AppText.caption),
                const SizedBox(height: AppSpace.xs),
                Text(t.customerName, style: AppText.body),
                if (t.phone.isNotEmpty) Text(t.phone, style: AppText.caption),
                if (t.location.isNotEmpty)
                  Text(t.location, style: AppText.caption),
                const SizedBox(height: AppSpace.xs),
                Text('Threshold / current stock', style: AppText.caption),
                Text(
                  '${enIn(t.level)} / ${enIn(t.stock)}',
                  style: AppText.bodyStrong,
                ),
                if (t.isLow)
                  Text(
                    'Low Stock Alert',
                    style: AppText.caption.copyWith(
                      color: AppColors.negative,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
              ],
            ),
          ),
          KIconButton(
            icon: LucideIcons.trash2,
            tooltip: 'Delete threshold',
            onTap: working ? () {} : () => _delete(t),
          ),
        ],
      ),
    );
  }
}

/// The website's "Propose an order" window: quantities for the items a customer is low on, filled with
/// the shortage. Sending asks first, then looks up your customer record for this buyer
/// (`POST /api/suppliers/hub/linked-customer { buyer_business_id }`, which the server checks against an
/// approved link) and posts the order (`POST /api/supply-orders { customer_id, lines, send: true }`).
/// Pops `true` once sent.
class SupplierProposeOrderScreen extends StatefulWidget {
  const SupplierProposeOrderScreen({
    super.key,
    required this.session,
    required this.group,
  });

  final AppSession session;
  final SupplierGroup group;

  @override
  State<SupplierProposeOrderScreen> createState() =>
      _SupplierProposeOrderScreenState();
}

class _SupplierProposeOrderScreenState
    extends State<SupplierProposeOrderScreen> {
  late final List<GroupItem> _items = [
    for (final i in widget.group.items)
      if (i.itemId.isNotEmpty) i,
  ];
  late final List<TextEditingController> _qty = [
    for (final i in _items)
      TextEditingController(text: quantityText(i.shortage)),
  ];
  bool _dirty = false;

  @override
  void dispose() {
    for (final c in _qty) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _send() async {
    final lines = proposalLines(_items, [for (final c in _qty) c.text]);
    if (lines.isEmpty) {
      showKToast(
        context,
        'Please enter quantities for at least one item',
        tone: KTone.negative,
      );
      return;
    }
    final name = widget.group.name;
    final ok = await askSheet(
      context,
      title: 'Send order?',
      text:
          'Propose an order to $name for ${lines.length} item(s)? They confirm it in Supplier Hub.',
      confirmLabel: 'Send order',
      cancelLabel: 'Cancel',
      danger: false,
    );
    if (!ok || !mounted) return;
    final api = widget.session.api;
    final link = await api.postJson(
      linkedCustomerPath,
      linkedCustomerBody(widget.group.customerBusinessId),
    );
    final customerId = link['customer_id']?.toString() ?? '';
    if (customerId.isEmpty) {
      throw ApiException('This buyer is not connected with you');
    }
    await api.postJson(supplyOrdersPath, proposeOrderBody(customerId, lines));
    if (!mounted) return;
    showKToast(
      context,
      'Order proposed to $name for ${lines.length} item(s). They confirm it in Supplier Hub.',
      tone: KTone.positive,
    );
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Propose an order',
      saveLabel: 'Send order',
      onSave: _send,
      dirty: _dirty,
      children: [
        Text(
          'Request quantities from ${widget.group.name}',
          style: AppText.body,
        ),
        for (var i = 0; i < _items.length; i++)
          KTextField(
            label: _items[i].name,
            controller: _qty[i],
            hint: 'Shortage ${quantityText(_items[i].shortage)}',
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) {
              if (!_dirty) setState(() => _dirty = true);
            },
          ),
      ],
    );
  }
}
