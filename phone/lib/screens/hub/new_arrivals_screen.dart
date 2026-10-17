import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import 'hub_common.dart';
import 'supply_orders_screen.dart';

/// New collections from connected suppliers. Fill quantities and send one order per supplier.
class NewArrivalsScreen extends StatefulWidget {
  const NewArrivalsScreen({super.key, required this.session, this.supplierId});

  final AppSession session;

  /// The buyer's own supplier record, to show only that supplier (and its other catalog items).
  final String? supplierId;

  @override
  State<NewArrivalsScreen> createState() => _NewArrivalsScreenState();
}

class _NewArrivalsScreenState extends State<NewArrivalsScreen> {
  late String? _supplierId = widget.supplierId;
  List<Map<String, dynamic>> _suppliers = const [];
  List<Map<String, dynamic>> _collections = const [];
  List<Map<String, dynamic>> _catalog = const [];
  // cart[supplierId][vendorItemId] = controller
  final _cart = <String, Map<String, TextEditingController>>{};
  bool _loading = true;
  String? _sending;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final items in _cart.values) {
      for (final c in items.values) {
        c.dispose();
      }
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final q = _supplierId == null ? '' : '?supplier_id=$_supplierId';
      final body = await widget.session.api.getJson('/api/suppliers/hub/new-arrivals$q');
      if (!mounted) return;
      setState(() {
        _suppliers = hubList(body['suppliers']);
        _collections = hubList(body['collections']);
        _catalog = hubList(body['catalog']);
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  TextEditingController _qty(String supplierId, String itemId) =>
      _cart.putIfAbsent(supplierId, () => {}).putIfAbsent(itemId, TextEditingController.new);

  List<(String, String, int)> get _carts => [
        for (final entry in _cart.entries)
          if (entry.value.values.any((c) => (double.tryParse(c.text) ?? 0) > 0))
            (
              entry.key,
              _suppliers.where((s) => s['supplier_id'] == entry.key).firstOrNull?['name']?.toString() ?? 'Supplier',
              entry.value.values.where((c) => (double.tryParse(c.text) ?? 0) > 0).length,
            ),
      ];

  Future<void> _send(String supplierId) async {
    final lines = [
      for (final e in (_cart[supplierId] ?? const <String, TextEditingController>{}).entries)
        if ((double.tryParse(e.value.text) ?? 0) > 0) {'vendor_item_id': e.key, 'qty': double.parse(e.value.text)},
    ];
    setState(() => _sending = supplierId);
    try {
      final body = await widget.session.api.postJson('/api/supply-orders', {
        'supplier_id': supplierId,
        'from_catalog': true,
        'lines': lines,
      });
      if (!mounted) return;
      for (final c in _cart[supplierId]!.values) {
        c.clear();
      }
      final id = hubMap(body['order'])['id'].toString();
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => SupplyOrderScreen(session: widget.session, orderId: id)));
      if (mounted) setState(() {});
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _sending = null);
    }
  }

  Future<void> _toggleMute(Map<String, dynamic> supplier) async {
    try {
      await widget.session.api.postJson('/api/suppliers/hub/mute', {
        'supplier_id': supplier['supplier_id'],
        'muted': supplier['mute_launches'] != true,
      });
      if (mounted) hubSnack(context, supplier['mute_launches'] == true ? 'Launch alerts on' : 'Launch alerts off');
      await _load();
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    }
  }

  void _pickSupplier() {
    showKSheet<void>(
      context,
      title: 'Supplier',
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, children: [
        KSheetAction(
          icon: LucideIcons.store,
          label: 'All suppliers',
          selected: _supplierId == null,
          onTap: () { Navigator.pop(ctx); setState(() => _supplierId = null); _load(); },
        ),
        for (final s in _suppliers)
          KSheetAction(
            icon: LucideIcons.truck,
            label: s['name']?.toString() ?? '',
            subtitle: s['mute_launches'] == true ? 'Launch alerts muted' : null,
            selected: _supplierId == s['supplier_id'],
            onTap: () { Navigator.pop(ctx); setState(() => _supplierId = s['supplier_id']?.toString()); _load(); },
          ),
      ]),
    );
  }

  Widget _item(String supplierId, Map<String, dynamic> l) {
    final moq = toNum(l['moq']);
    final step = toNum(l['order_multiple']);
    final image = hubText(l['image_url']);
    return KCard(
      margin: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
      padding: const EdgeInsets.all(12),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: SizedBox(
            width: 72,
            height: 72,
            child: image == null || !image.startsWith('https://')
                ? Container(color: AppColors.sunken, child: const Icon(LucideIcons.package, color: AppColors.ink3))
                : Image.network(image, fit: BoxFit.cover, errorBuilder: (_, _, _) => Container(color: AppColors.sunken)),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(l['name']?.toString() ?? '', style: AppText.bodyStrong),
            Text(
              [
                l['price'] == null ? 'Price on request' : '${inr(toNum(l['price']), maxFraction: 2)} per ${l['unit'] ?? 'unit'}',
                ?hubText(l['pack_label']),
              ].join(' · '),
              style: AppText.caption,
            ),
            Text(
              [
                if (moq > 0) 'Min ${qtyText(moq)}',
                if (step > 0) 'In ${qtyText(step)}s',
                ?hubText(l['lead_time_text']),
                if (hubText(l['my_item_name']) != null) 'Your item: ${l['my_item_name']}',
              ].join(' · '),
              style: AppText.caption,
            ),
          ]),
        ),
        const SizedBox(width: 8),
        HubQtyField(controller: _qty(supplierId, l['vendor_item_id'].toString()), width: 72, onChanged: (_) => setState(() {})),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final selected = _suppliers.where((s) => s['supplier_id'] == _supplierId).firstOrNull;
    final carts = _carts;
    return Scaffold(
      backgroundColor: AppColors.bg,
      bottomNavigationBar: carts.isEmpty
          ? null
          : KBottomBar(children: [
              for (final (sid, name, count) in carts.take(2))
                Expanded(
                  child: KButton(
                    label: carts.length == 1 ? 'Order $count item(s) from $name' : name,
                    loading: _sending == sid,
                    onPressed: () => _send(sid),
                  ),
                ),
            ]),
      body: SafeArea(
        child: RefreshIndicator(
          color: AppColors.brand,
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.only(top: 8, bottom: 48),
            children: [
              HubTitleBar(
                'New arrivals',
                trailing: selected == null
                    ? null
                    : KIconButton(
                        icon: selected['mute_launches'] == true ? LucideIcons.bellOff : LucideIcons.bell,
                        tooltip: selected['mute_launches'] == true ? 'Turn launch alerts on' : 'Mute launch alerts',
                        onTap: () => _toggleMute(selected),
                      ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
                child: KChip(
                  label: selected?['name']?.toString() ?? 'All suppliers',
                  icon: LucideIcons.chevronDown,
                  selected: selected != null,
                  onTap: _pickSupplier,
                ),
              ),
              if (_loading)
                const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
              else if (_error != null)
                KEmptyState(icon: LucideIcons.circleAlert, title: 'Could not load', body: _error)
              else if (_collections.isEmpty && _catalog.isEmpty)
                KEmptyState(
                  icon: LucideIcons.sparkles,
                  title: 'No new collections yet',
                  body: _suppliers.isEmpty
                      ? 'Connect with suppliers in the Suppliers Hub to see their launches here.'
                      : 'When your connected suppliers launch something new, it shows up here.',
                )
              else ...[
                for (final c in _collections) ...[
                  KSectionHeader([c['name'], c['supplier_name']].whereType<Object>().join(' · ')),
                  if (hubText(c['season']) != null || hubText(c['description']) != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
                      child: Text([?hubText(c['season']), ?hubText(c['description'])].join(' · '), style: AppText.caption),
                    ),
                  for (final l in hubList(c['items'])) _item(c['supplier_id'].toString(), l),
                ],
                if (_catalog.isNotEmpty && selected != null) ...[
                  KSectionHeader('More from ${selected['name']}'),
                  for (final l in _catalog) _item(selected['supplier_id'].toString(), l),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}
