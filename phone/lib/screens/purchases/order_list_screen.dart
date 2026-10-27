import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../hub/hub_common.dart';
import '../invoices/invoice_scan.dart';

/// Order list: walk the shop, pick what is running out, send each supplier their part.
/// The user only picks items; each item's usual supplier fills itself in. Items with no
/// supplier are given one together on the send screen, in one pick for many items.
class OrderListScreen extends StatefulWidget {
  const OrderListScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<OrderListScreen> createState() => _OrderListScreenState();
}

class _OrderListScreenState extends State<OrderListScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  bool _showLow = true;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async => _run(() => _api.getJson('/api/purchases/order-list'));

  /// Every list call returns the whole list again, so the screen just shows the answer.
  Future<void> _run(Future<Map<String, dynamic>> Function() call) async {
    try {
      final body = await call();
      if (mounted) setState(() { _data = body; _error = null; });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (_data == null) {
        setState(() => _error = e.message);
      } else {
        hubSnack(context, e.message);
      }
    }
  }

  List<Map<String, dynamic>> get _lines => hubList(_data?['lines']);

  Future<void> _add(String itemId, num qty) =>
      _run(() => _api.postJson('/api/purchases/order-list', {'item_id': itemId, 'qty': qty}));

  Future<void> _setQty(Map<String, dynamic> line, num qty) {
    if (qty <= 0) return _remove(line);
    return _run(() => _api.patchJson('/api/purchases/order-list/lines/${line['id']}', {'qty': qty}));
  }

  Future<void> _remove(Map<String, dynamic> line) =>
      _run(() => _api.deleteJson('/api/purchases/order-list/lines/${line['id']}'));

  Future<void> _search() async {
    final item = await pickOwnItem(context, widget.session, title: 'Add to order list');
    if (item == null) return;
    final existing = _lines.where((l) => l['item_id'] == item['id']).firstOrNull;
    await _add(item['id'].toString(), existing == null ? 1 : toNum(existing['qty']) + 1);
  }

  void _scan() {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => BarcodeScanScreen(
        api: _api,
        onItem: (scanned) {
          HapticFeedback.selectionClick();
          final id = scanned.item['id'].toString();
          final existing = _lines.where((l) => l['item_id'] == id).firstOrNull;
          _add(id, existing == null ? 1 : toNum(existing['qty']) + 1);
        },
      ),
    ));
  }

  Future<void> _changeSupplier(Map<String, dynamic> line) async {
    final supplier = await pickSupplier(context, _api);
    if (supplier == null) return;
    await _run(() => _api.patchJson('/api/purchases/order-list/lines/${line['id']}', {'supplier_id': supplier['id']}));
  }

  Future<void> _openSend() async {
    final sent = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => _SendOrdersScreen(session: widget.session, data: _data!)),
    );
    if (sent == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final lines = _lines;
    final low = hubList(_data?['running_low']);
    return Scaffold(
      backgroundColor: AppColors.bg,
      bottomNavigationBar: lines.isEmpty
          ? null
          : KBottomBar(children: [
              Expanded(child: KButton(label: 'Send orders · ${lines.length} item${lines.length == 1 ? '' : 's'}', onPressed: _openSend)),
            ]),
      body: SafeArea(
        child: RefreshIndicator(
          color: AppColors.brand,
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.only(top: 8, bottom: 48),
            children: [
              const HubTitleBar('Order list'),
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.md),
                child: Row(children: [
                  Expanded(child: KButton.secondary(label: 'Search item', icon: LucideIcons.search, onPressed: _search)),
                  const SizedBox(width: AppSpace.sm),
                  Expanded(child: KButton.secondary(label: 'Scan', icon: LucideIcons.scanBarcode, onPressed: _scan)),
                ]),
              ),
              if (_error != null)
                KEmptyState(icon: LucideIcons.cloudOff, title: 'Could not load', body: _error)
              else if (_data == null)
                const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
              else ...[
                if (low.isNotEmpty) ...[
                  KSectionHeader(
                    'Running low (${low.length})',
                    action: _showLow ? 'Hide' : 'Show',
                    onAction: () => setState(() => _showLow = !_showLow),
                  ),
                  if (_showLow)
                    KCard(
                      margin: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.md),
                      child: Column(children: [
                        for (final l in low)
                          KListRow(
                            title: l['name']?.toString() ?? '',
                            subtitle: [
                              if (hubText(l['rack']) != null) 'Rack ${l['rack']}',
                              'Left ${qtyText(toNum(l['stock']))}',
                              hubText(l['supplier_name']) ?? 'No supplier yet',
                            ].join(' · '),
                            trailing: KTextButton(
                              label: '+ ${qtyText(toNum(l['suggested_qty']))}',
                              onTap: () => _add(l['item_id'].toString(), toNum(l['suggested_qty'])),
                            ),
                          ),
                      ]),
                    ),
                ],
                KSectionHeader('Your list (${lines.length})'),
                if (lines.isEmpty)
                  const KEmptyState(
                    icon: LucideIcons.clipboardList,
                    title: 'Nothing on the list yet',
                    body: 'Walk the racks and add what is running out. Suppliers fill in by themselves.',
                  )
                else
                  KCard(
                    margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                    child: Column(children: [for (final l in lines) _lineRow(l)]),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _lineRow(Map<String, dynamic> l) {
    final qty = toNum(l['qty']);
    final supplier = hubText(l['supplier_name']);
    return Dismissible(
      key: ValueKey(l['id']),
      direction: DismissDirection.endToStart,
      background: Container(color: AppColors.negative, alignment: Alignment.centerRight, padding: const EdgeInsets.only(right: 20), child: const Icon(LucideIcons.trash2, color: Colors.white)),
      onDismissed: (_) => _remove(l),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(l['name']?.toString() ?? '', style: AppText.bodyStrong),
              const SizedBox(height: 2),
              InkWell(
                onTap: () => _changeSupplier(l),
                child: Text(
                  [if (hubText(l['rack']) != null) 'Rack ${l['rack']}', supplier ?? 'No supplier yet · tap to choose'].join(' · '),
                  style: AppText.caption.copyWith(color: supplier == null ? AppColors.due : null),
                ),
              ),
            ]),
          ),
          KIconButton(icon: LucideIcons.minus, tooltip: 'Less', onTap: () => _setQty(l, qty - 1)),
          SizedBox(
            width: 44,
            child: Text(qtyText(qty), textAlign: TextAlign.center, style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
          ),
          KIconButton(icon: LucideIcons.plus, tooltip: 'More', onTap: () => _setQty(l, qty + 1)),
        ]),
      ),
    );
  }
}

/// Pick one of the business's suppliers (search by name).
Future<Map<String, dynamic>?> pickSupplier(BuildContext context, KhatarioApi api) {
  return showKSheet<Map<String, dynamic>>(
    context,
    title: 'Choose supplier',
    builder: (ctx) => _SupplierPicker(api: api),
  );
}

class _SupplierPicker extends StatefulWidget {
  const _SupplierPicker({required this.api});

  final KhatarioApi api;

  @override
  State<_SupplierPicker> createState() => _SupplierPickerState();
}

class _SupplierPickerState extends State<_SupplierPicker> {
  List<Map<String, dynamic>> _all = const [];
  String _q = '';

  @override
  void initState() {
    super.initState();
    widget.api.getJson('/api/suppliers?limit=500').then((body) {
      if (mounted) setState(() => _all = hubList(body['suppliers']));
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final q = _q.toLowerCase();
    final shown = _all.where((s) => q.isEmpty || (s['name']?.toString().toLowerCase().contains(q) ?? false)).take(60).toList();
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.7,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
          child: TextField(
            autofocus: true,
            decoration: const InputDecoration(hintText: 'Supplier name', prefixIcon: Icon(LucideIcons.search)),
            onChanged: (v) => setState(() => _q = v.trim()),
          ),
        ),
        Expanded(
          child: ListView(children: [
            for (final s in shown)
              KListRow(
                title: s['name']?.toString() ?? '',
                subtitle: [hubText(s['city']), hubText(s['phone'])].whereType<String>().join(' · '),
                onTap: () => Navigator.pop(context, s),
              ),
          ]),
        ),
      ]),
    );
  }
}

/// Send screen: one group per supplier. Items without a supplier get one in a single pick.
class _SendOrdersScreen extends StatefulWidget {
  const _SendOrdersScreen({required this.session, required this.data});

  final AppSession session;
  final Map<String, dynamic> data;

  @override
  State<_SendOrdersScreen> createState() => _SendOrdersScreenState();
}

class _SendOrdersScreenState extends State<_SendOrdersScreen> {
  late Map<String, dynamic> _data = widget.data;
  final Set<String> _unticked = {};
  bool _remember = true;
  bool _busy = false;
  List<Map<String, dynamic>>? _results;

  KhatarioApi get _api => widget.session.api;
  List<Map<String, dynamic>> get _lines => hubList(_data['lines']);

  Future<void> _assign() async {
    final ids = _lines.where((l) => l['supplier_id'] == null && !_unticked.contains(l['id'])).map((l) => l['id']).toList();
    if (ids.isEmpty) return;
    final supplier = await pickSupplier(context, _api);
    if (supplier == null) return;
    setState(() => _busy = true);
    try {
      final body = await _api.postJson('/api/purchases/order-list/assign', {'line_ids': ids, 'supplier_id': supplier['id'], 'remember': _remember});
      if (mounted) setState(() { _data = body; _unticked.clear(); });
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendAll() async {
    setState(() => _busy = true);
    try {
      final body = await _api.postJson('/api/purchases/order-list/send', {});
      if (mounted) setState(() => _results = hubList(body['results']));
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _whatsApp(Map<String, dynamic> r) async {
    final digits = (r['phone']?.toString() ?? '').replaceAll(RegExp(r'\D'), '');
    final to = digits.length == 10 ? '91$digits' : digits;
    final uri = Uri.parse('https://wa.me/$to?text=${Uri.encodeComponent(r['message']?.toString() ?? '')}');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && mounted) {
      await Clipboard.setData(ClipboardData(text: r['message']?.toString() ?? ''));
      if (mounted) hubSnack(context, 'WhatsApp did not open. The message is copied.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final results = _results;
    return PopScope(
      canPop: results == null,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && results != null) Navigator.of(context).pop(true);
      },
      child: Scaffold(
        backgroundColor: AppColors.bg,
        bottomNavigationBar: KBottomBar(children: [
          Expanded(
            child: results != null
                ? KButton(label: 'Done', onPressed: () => Navigator.of(context).pop(true))
                : KButton(
                    label: 'Send all',
                    loading: _busy,
                    onPressed: _lines.any((l) => l['supplier_id'] == null) ? null : _sendAll,
                  ),
          ),
        ]),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.only(top: 8, bottom: 48),
            children: [
              HubTitleBar(results == null ? 'Send orders' : 'Orders sent'),
              if (results != null) ..._resultCards(results) else ..._groupCards(),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _groupCards() {
    final missing = _lines.where((l) => l['supplier_id'] == null).toList();
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final l in _lines.where((l) => l['supplier_id'] != null)) {
      groups.putIfAbsent(l['supplier_id'].toString(), () => []).add(l);
    }
    final pad = const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0);
    return [
      if (missing.isNotEmpty)
        KCard(
          margin: pad,
          padding: const EdgeInsets.all(AppSpace.md),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Needs a supplier (${missing.length})', style: AppText.bodyStrong),
            Text('Tick the items that come from the same supplier, then choose it once.', style: AppText.caption),
            for (final l in missing)
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                value: !_unticked.contains(l['id']),
                onChanged: (v) => setState(() => v == true ? _unticked.remove(l['id']) : _unticked.add(l['id'].toString())),
                title: Text('${l['name']} · ${qtyText(toNum(l['qty']))}', style: AppText.body),
              ),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              value: _remember,
              onChanged: (v) => setState(() => _remember = v),
              title: Text('Remember for next time', style: AppText.body),
            ),
            KButton(label: 'Choose supplier', loading: _busy, onPressed: _assign),
          ]),
        ),
      for (final g in groups.values)
        KCard(
          margin: pad,
          child: KListRow(
            title: g.first['supplier_name']?.toString() ?? '',
            subtitle: '${g.length} item${g.length == 1 ? '' : 's'} · ${g.first['way'] == 'hub' ? 'Supplier Hub order' : 'On WhatsApp'}',
          ),
        ),
    ];
  }

  List<Widget> _resultCards(List<Map<String, dynamic>> results) {
    final pad = const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0);
    return [
      for (final r in results)
        KCard(
          margin: pad,
          padding: const EdgeInsets.all(AppSpace.md),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(r['supplier_name']?.toString() ?? '', style: AppText.bodyStrong),
            Text('${r['items']} item${r['items'] == 1 ? '' : 's'}', style: AppText.caption),
            const SizedBox(height: AppSpace.sm),
            if (r['way'] == 'hub')
              Text('Sent through Supplier Hub. They confirm it there.', style: AppText.caption.copyWith(color: AppColors.positive))
            else
              KButton(label: 'Send on WhatsApp', icon: LucideIcons.messageCircle, onPressed: () => _whatsApp(r)),
          ]),
        ),
    ];
  }
}
