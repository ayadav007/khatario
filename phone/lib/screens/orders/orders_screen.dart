import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'order_detail_screen.dart';
import 'orders_logic.dart';
import 'return_detail_screen.dart';

/// Orders & delivery: every sale that has to reach the buyer, what needs doing next, and returns.
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key, required this.session, this.embedded = false});

  final AppSession session;

  /// Shown as a bottom-bar tab (no own app bar).
  final bool embedded;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  String _view = 'orders';
  String? _needs;
  String _query = '';
  final _search = TextEditingController();
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _orders = const [];
  Map<String, int> _counts = const {};
  int _total = 0;
  int _page = 1;

  List<Map<String, dynamic>> _returns = const [];
  Map<String, int> _returnCounts = const {};
  String _returnFilter = 'open';

  @override
  void initState() {
    super.initState();
    _load();
    _loadReturns();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> _list(dynamic v) =>
      v is List ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];

  Future<void> _load({bool more = false}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final page = more ? _page + 1 : 1;
    final q = <String, String>{'page': '$page', 'limit': '25'};
    if (_needs != null) q['needs'] = _needs!;
    if (_query.isNotEmpty) q['q'] = _query;
    try {
      final body = await widget.session.api.getJson('/api/orders?${Uri(queryParameters: q).query}');
      final rows = _list(body['orders']);
      final needs = body['needs'] is Map ? Map<String, dynamic>.from(body['needs'] as Map) : const <String, dynamic>{};
      if (!mounted) return;
      setState(() {
        _orders = more ? [..._orders, ...rows] : rows;
        _page = page;
        _total = toNum(body['total']).toInt();
        if (needs.isNotEmpty) _counts = needs.map((k, v) => MapEntry(k, toNum(v).toInt()));
        _loading = false;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Could not load orders';
          _loading = false;
        });
      }
    }
  }

  Future<void> _loadReturns() async {
    try {
      final body = await widget.session.api.getJson('/api/returns${_returnFilter.isEmpty ? '' : '?status=$_returnFilter'}');
      final counts = body['counts'] is Map ? Map<String, dynamic>.from(body['counts'] as Map) : const <String, dynamic>{};
      if (!mounted) return;
      setState(() {
        _returns = _list(body['returns']);
        _returnCounts = counts.map((k, v) => MapEntry(k, toNum(v).toInt()));
      });
    } catch (_) {
      // Returns are optional on older servers; the tab simply stays empty.
    }
  }

  int get _openReturns => (_returnCounts['requested'] ?? 0) + (_returnCounts['approved'] ?? 0) + (_returnCounts['received'] ?? 0);

  Future<void> _open(Map<String, dynamic> row) async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => OrderDetailScreen(
        session: widget.session,
        source: row['source_type'].toString(),
        id: row['source_id'].toString(),
      ),
    ));
    if (mounted) {
      _load();
      _loadReturns();
    }
  }

  Future<void> _openReturn(String id) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ReturnDetailScreen(session: widget.session, id: id)));
    if (mounted) _loadReturns();
  }

  @override
  Widget build(BuildContext context) {
    final body = RefreshIndicator(
      onRefresh: () async {
        await Future.wait([_load(), _loadReturns()]);
      },
      child: ListView(
        padding: const EdgeInsets.only(bottom: 96),
        children: [
          KPageTitle(
            'Orders & delivery',
            eyebrow: _view == 'orders' ? '$_total orders' : '$_openReturns open returns',
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: KSegmented<String>(
              value: _view,
              options: [('orders', 'Orders'), ('returns', _openReturns > 0 ? 'Returns · $_openReturns' : 'Returns')],
              onChanged: (v) => setState(() => _view = v),
            ),
          ),
          const SizedBox(height: AppSpace.md),
          if (_view == 'orders') ..._ordersView() else ..._returnsView(),
        ],
      ),
    );
    if (widget.embedded) return body;
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(),
      body: body,
    );
  }

  List<Widget> _ordersView() {
    return [
      SizedBox(
        height: 84,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
          itemCount: needsBuckets.length,
          separatorBuilder: (_, _) => const SizedBox(width: 10),
          itemBuilder: (_, i) {
            final (key, label) = needsBuckets[i];
            final n = _counts[key] ?? 0;
            final on = _needs == key;
            final hot = key == 'delivery_failed' || key == 'stale' || key == 'in_transit_late';
            return InkWell(
              borderRadius: BorderRadius.circular(AppRadius.md),
              onTap: () {
                setState(() => _needs = on ? null : key);
                _load();
              },
              child: Container(
                width: 124,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: on ? AppColors.brandSoft : AppColors.surface,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(color: on ? AppColors.brand : AppColors.hairline),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption.copyWith(fontSize: 12)),
                    Text(
                      '$n',
                      style: AppText.title.copyWith(color: n > 0 && hot ? AppColors.negative : AppColors.ink),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, AppSpace.sm),
        child: KSearchField(
          controller: _search,
          hint: 'Order, bill, customer, phone, AWB',
          onChanged: (v) {
            _query = v.trim();
            _load();
          },
        ),
      ),
      if (_error != null)
        Padding(
          padding: const EdgeInsets.all(AppSpace.gutter),
          child: Text(_error!, style: AppText.body.copyWith(color: AppColors.negative)),
        ),
      if (_loading && _orders.isEmpty)
        const KSpinner()
      else if (_orders.isEmpty)
        const KEmptyState(icon: LucideIcons.package, title: 'No orders here', body: 'Store, WhatsApp and delivery bills show up here.')
      else
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
          child: KCard(
            child: KDivided(children: [for (final o in _orders) _OrderRow(row: o, onTap: () => _open(o))]),
          ),
        ),
      if (_orders.length < _total)
        Padding(
          padding: const EdgeInsets.all(AppSpace.gutter),
          child: KButton.secondary(label: 'Show more', loading: _loading, onPressed: () => _load(more: true)),
        ),
    ];
  }

  List<Widget> _returnsView() {
    return [
      KChipBar<String>(
        value: _returnFilter,
        options: const [('open', 'Open'), ('requested', 'Requested'), ('approved', 'Awaiting goods'), ('received', 'Refund due'), ('closed', 'Closed'), ('', 'All')],
        onChanged: (v) {
          setState(() => _returnFilter = v);
          _loadReturns();
        },
      ),
      const SizedBox(height: AppSpace.md),
      if (_returns.isEmpty)
        const KEmptyState(
          icon: LucideIcons.rotateCcw,
          title: 'No returns',
          body: 'Start one from an order, or buyers can ask from their store account.',
        )
      else
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
          child: KCard(
            child: KDivided(children: [
              for (final r in _returns)
                KListRow(
                  leading: KAvatar(name: r['customer_name']?.toString() ?? 'C', icon: LucideIcons.rotateCcw, muted: true),
                  title: '${r['return_number']} · ${r['customer_name'] ?? r['customer_phone'] ?? 'Customer'}',
                  subtitle: '${r['invoice_number']} · ${returnReasonLabels[r['reason']] ?? r['reason']}',
                  trailing: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (toNum(r['credit_amount']) > 0) Text(orderMoney(r['credit_amount']), style: AppText.bodyStrong),
                      const SizedBox(height: 4),
                      Builder(builder: (_) {
                        final (tone, label) = returnTone(r['status'].toString());
                        return KPill(label: label, tone: tone);
                      }),
                    ],
                  ),
                  onTap: () => _openReturn(r['id'].toString()),
                ),
            ]),
          ),
        ),
    ];
  }
}

class _OrderRow extends StatelessWidget {
  const _OrderRow({required this.row, required this.onTap});

  final Map<String, dynamic> row;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (tone, label) = deliveryTone(row['delivery_status']?.toString());
    final paid = row['payment_status']?.toString() == 'paid';
    final channel = channelLabels[row['channel']] ?? row['channel']?.toString() ?? '';
    return KListRow(
      leading: KAvatar(name: row['customer_name']?.toString() ?? row['order_number']?.toString() ?? 'O'),
      title: '${row['order_number']} · ${row['customer_name'] ?? row['customer_phone'] ?? 'Customer'}',
      subtitle: [channel, ageOf(row['created_at']), if (row['awb'] != null) 'AWB ${row['awb']}'].where((s) => s.isNotEmpty).join(' · '),
      trailing: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(orderMoney(row['amount']), style: AppText.bodyStrong),
          const SizedBox(height: 4),
          KPill(label: label, tone: tone),
          if (!paid) ...[
            const SizedBox(height: 2),
            Text(paymentTone(row['payment_status']?.toString()).$2, style: AppText.small.copyWith(color: AppColors.due)),
          ],
        ],
      ),
      onTap: onTap,
    );
  }
}
