import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../invoices/invoice_form_screen.dart';
import 'hub_common.dart';
import 'hub_directory_screen.dart';
import 'incoming_bills_screen.dart';
import 'my_catalog_screen.dart';
import 'new_arrivals_screen.dart';
import 'supply_orders_screen.dart';

/// Supplier Hub home on the phone, like the web: one "Needs you" list across buying and selling,
/// each card with its main action, then shortcuts to orders, bills, new arrivals and suppliers.
class HubHomeScreen extends StatefulWidget {
  const HubHomeScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<HubHomeScreen> createState() => _HubHomeScreenState();
}

class _HubHomeScreenState extends State<HubHomeScreen> {
  Map<String, dynamic>? _home;
  String? _error;
  String? _busyKey;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/suppliers/hub/home');
      if (mounted) setState(() { _home = body; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _push(Widget screen) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen)).then((_) => _load());

  /// Open the page an inbox item points at, natively where the phone has the screen.
  void _open(String href) {
    final uri = Uri.parse(href);
    final s = widget.session;
    final parts = uri.pathSegments;
    if (parts.length == 3 && parts[0] == 'purchases' && parts[1] == 'incoming') {
      _push(ReceiveBillScreen(session: s, invoiceId: parts[2]));
    } else if (parts.length == 2 && parts[0] == 'supply-orders') {
      _push(SupplyOrderScreen(session: s, orderId: parts[1]));
    } else if (uri.path == '/invoices/new' && uri.queryParameters['supply_order_id'] != null) {
      _push(InvoiceFormScreen(session: s, supplyOrderId: uri.queryParameters['supply_order_id']));
    } else if (uri.path == '/settings/suppliers-directory' || uri.path == '/suppliers/hub') {
      _push(ConnectionRequestsScreen(session: s));
    } else {
      hubSnack(context, 'Open this on the Khatario website.');
    }
  }

  Future<void> _act(Map<String, dynamic> item, [String? choice]) async {
    final a = hubMap(item['action']);
    final key = item['key'].toString();
    final api = widget.session.api;
    setState(() => _busyKey = key);
    try {
      switch (a['kind']) {
        case 'link':
          _open(a['href'].toString());
          return;
        case 'order':
          await api.patchJson('/api/supply-orders/${a['orderId']}', {'action': a['orderAction'], 'lines': []});
        case 'request':
          // Accepting may need a choice of customer record; the requests screen asks for it.
          if (choice == 'accept') {
            _push(ConnectionRequestsScreen(session: widget.session));
            return;
          }
          await api.patchJson('/api/suppliers/hub/connection-requests/${a['requestId']}', {'action': choice});
        case 'standing':
          await api.patchJson('/api/supply-orders/standing/${a['standingId']}', {'action': choice});
        case 'money':
          await api.postJson('/api/suppliers/hub/money-notices', {'notice_id': a['noticeId'], 'action': 'record'});
      }
      if (mounted) hubSnack(context, 'Done');
      await _load();
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }

  Widget _card(Map<String, dynamic> item) {
    final a = hubMap(item['action']);
    final busy = _busyKey == item['key'].toString();
    final amount = item['amount'];
    final twoWay = a['kind'] == 'request' || a['kind'] == 'standing';
    final label = switch (a['kind']) {
      'link' || 'order' || 'money' => (a['label'] ?? 'Open').toString(),
      _ => 'Accept',
    };
    return KCard(
      margin: const EdgeInsets.only(bottom: AppSpace.sm),
      padding: const EdgeInsets.all(AppSpace.md),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(item['title']?.toString() ?? '', style: AppText.bodyStrong),
        const SizedBox(height: 4),
        Text(item['detail']?.toString() ?? '', style: AppText.caption),
        if (amount is num && amount > 0) ...[
          const SizedBox(height: 4),
          Text('${item['approx'] == true ? '~' : ''}${inr(amount, maxFraction: 0)}', style: AppText.bodyStrong),
        ],
        const SizedBox(height: AppSpace.sm),
        Row(children: [
          Expanded(child: KButton(label: label, loading: busy, onPressed: () => _act(item, 'accept'))),
          if (twoWay) ...[
            const SizedBox(width: AppSpace.sm),
            Expanded(child: KButton.secondary(label: 'Decline', onPressed: busy ? null : () => _act(item, 'decline'))),
          ],
        ]),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final home = _home;
    final inbox = hubList(home?['inbox']);
    final buying = hubMap(home?['buying']);
    final selling = hubMap(home?['selling']);
    final s = widget.session;
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.only(top: 8, bottom: 48),
            children: [
              HubTitleBar('Supplier Hub',
                  trailing: KIconButton(icon: LucideIcons.search, tooltip: 'Find suppliers', onTap: () => _push(HubDirectoryScreen(session: s)))),
              if (_error != null)
                KEmptyState(icon: LucideIcons.cloudOff, title: 'Could not load', body: _error)
              else if (home == null)
                const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
              else
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    const SizedBox(height: AppSpace.sm),
                    KSectionHeader('Needs you'),
                    if (inbox.isEmpty)
                      Text('All caught up.', style: AppText.caption)
                    else
                      ...inbox.map(_card),
                    const SizedBox(height: AppSpace.md),
                    KSectionHeader('Buying'),
                    KCard(
                      child: Column(children: [
                        KListRow(
                          title: 'Supplier orders',
                          subtitle: '${buying['openOrders'] ?? 0} open',
                          onTap: () => _push(SupplyOrdersScreen(session: s)),
                        ),
                        KListRow(
                          title: 'Incoming bills',
                          subtitle: '${buying['billsToReceive'] ?? 0} to receive',
                          onTap: () => _push(IncomingBillsScreen(session: s)),
                        ),
                        KListRow(
                          title: 'New arrivals',
                          subtitle: '${buying['newCollections'] ?? 0} new collections',
                          onTap: () => _push(NewArrivalsScreen(session: s)),
                        ),
                        KListRow(title: 'Find suppliers', onTap: () => _push(HubDirectoryScreen(session: s))),
                      ]),
                    ),
                    const SizedBox(height: AppSpace.md),
                    KSectionHeader('Selling'),
                    KCard(
                      child: Column(children: [
                        KListRow(
                          title: 'Orders from buyers',
                          subtitle: '${selling['openOrders'] ?? 0} open',
                          onTap: () => _push(SupplyOrdersScreen(session: s, selling: true)),
                        ),
                        KListRow(title: 'My catalogue', onTap: () => _push(MyCatalogScreen(session: s))),
                        KListRow(
                          title: 'Connection requests',
                          onTap: () => _push(ConnectionRequestsScreen(session: s)),
                        ),
                      ]),
                    ),
                  ]),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
