import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../invoices/invoice_form_screen.dart';
import 'hub_common.dart';
import 'incoming_bills_screen.dart';

/// Orders with connected suppliers (buying) and connected buyers (selling).
class SupplyOrdersScreen extends StatefulWidget {
  const SupplyOrdersScreen({super.key, required this.session, this.selling = false});

  final AppSession session;
  final bool selling;

  @override
  State<SupplyOrdersScreen> createState() => _SupplyOrdersScreenState();
}

class _SupplyOrdersScreenState extends State<SupplyOrdersScreen> {
  late String _role = widget.selling ? 'vendor' : 'buyer';
  String _group = 'action';
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  bool _checking = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final body = await widget.session.api.getJson('/api/supply-orders?role=$_role&group=$_group');
      if (mounted) setState(() => _rows = hubList(body['orders']));
    } on ApiException catch (e) {
      if (mounted) setState(() { _rows = const []; _error = e.message; });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _checkLowStock() async {
    setState(() => _checking = true);
    try {
      final body = await widget.session.api.postJson('/api/supply-orders/suggest', const {});
      final lines = toNum(body['lines']).toInt();
      if (mounted) hubSnack(context, lines > 0 ? '$lines low item(s) added to suggested orders' : 'No new low items');
      await _load();
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  Future<void> _open(Map<String, dynamic> row) async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => SupplyOrderScreen(session: widget.session, orderId: row['id'].toString()),
    ));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: RefreshIndicator(
          color: AppColors.brand,
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.only(top: 8, bottom: 48),
            children: [
              HubTitleBar(
                'Supplier orders',
                trailing: _role == 'vendor'
                    ? KIconButton(icon: _checking ? LucideIcons.loader : LucideIcons.radar, tooltip: 'Check buyers’ low stock', onTap: _checking ? () {} : _checkLowStock)
                    : null,
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
                child: KSegmented<String>(
                  value: _role,
                  options: const [('buyer', 'Buying'), ('vendor', 'Selling')],
                  onChanged: (v) { setState(() => _role = v); _load(); },
                ),
              ),
              const SizedBox(height: AppSpace.md),
              KChipBar<String>(
                value: _group,
                options: const [('action', 'Needs you'), ('open', 'Open'), ('done', 'Done'), ('all', 'All')],
                onChanged: (v) { setState(() => _group = v); _load(); },
              ),
              if (_loading)
                const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
              else if (_error != null)
                KEmptyState(icon: LucideIcons.circleAlert, title: 'Could not load', body: _error)
              else if (_rows.isEmpty)
                KEmptyState(
                  icon: LucideIcons.packageSearch,
                  title: 'No orders here',
                  body: _role == 'buyer'
                      ? 'Order from a connected supplier from their page, or from New arrivals.'
                      : 'Suggested orders appear when your connected buyers run low.',
                )
              else
                KCard(
                  margin: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
                  child: KDivided(
                    indent: 66,
                    children: [
                      for (final row in _rows)
                        KListRow(
                          onTap: () => _open(row),
                          leading: KAvatar(name: row['other_business_name']?.toString() ?? ''),
                          title: row['other_business_name']?.toString() ?? '',
                          subtitle: [
                            '${row['line_count'] ?? 0} items',
                            if (row['origin'] == 'suggested') 'from low stock',
                            if (row['origin'] == 'catalog') 'from catalog',
                            if (hubText(row['invoice_number']) != null) 'bill ${row['invoice_number']}',
                            hubDate(row['updated_at']),
                          ].join(' · '),
                          trailing: Builder(builder: (_) {
                            final (tone, label) = supplyOrderTone(row['status']?.toString() ?? '');
                            return KStatusDot(label: label, tone: tone);
                          }),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _OrderLine {
  _OrderLine(this.line)
      : qty = TextEditingController(text: qtyText(toNum(line['qty']))),
        confirmed = TextEditingController(text: qtyText(toNum(line['qty'])));

  final Map<String, dynamic> line;
  final TextEditingController qty;
  final TextEditingController confirmed;
  bool removed = false;
  Map<String, dynamic>? vendorItem; // picked by the supplier

  void dispose() {
    qty.dispose();
    confirmed.dispose();
  }
}

/// One order with the steps open to this side.
class SupplyOrderScreen extends StatefulWidget {
  const SupplyOrderScreen({super.key, required this.session, required this.orderId});

  final AppSession session;
  final String orderId;

  @override
  State<SupplyOrderScreen> createState() => _SupplyOrderScreenState();
}

class _SupplyOrderScreenState extends State<SupplyOrderScreen> {
  Map<String, dynamic>? _detail;
  List<_OrderLine> _lines = const [];
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final body = await widget.session.api.getJson('/api/supply-orders/${widget.orderId}');
      if (!mounted) return;
      for (final l in _lines) {
        l.dispose();
      }
      setState(() {
        _detail = body;
        _lines = [for (final l in hubList(body['lines'])) _OrderLine(l)];
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _act(String action, {String? confirmText}) async {
    if (confirmText != null) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          content: Text(confirmText),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Back')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Yes')),
          ],
        ),
      );
      if (ok != true) return;
    }
    final lines = <Map<String, dynamic>>[];
    for (final l in _lines) {
      final id = l.line['id'];
      if (l.removed) {
        lines.add({'id': id, 'remove': true});
        continue;
      }
      lines.add({
        'id': id,
        if (action == 'update' || action == 'send' || action == 'confirm') 'qty': double.tryParse(l.qty.text),
        if (action == 'respond') 'confirmed_qty': double.tryParse(l.confirmed.text) ?? 0,
        if (l.vendorItem != null) 'vendor_item_id': l.vendorItem!['id'],
      });
    }
    setState(() => _busy = true);
    try {
      final body = await widget.session.api.patchJson('/api/supply-orders/${widget.orderId}', {'action': action, 'lines': lines});
      if (mounted) hubSnack(context, supplyOrderTone(body['status']?.toString() ?? '').$2);
      await _load();
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickVendorItem(_OrderLine l) async {
    final picked = await pickOwnItem(context, widget.session, title: 'Your item for ${l.line['item_name']}');
    if (picked != null && mounted) setState(() => l.vendorItem = picked);
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    if (detail == null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: _loading
              ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 80))
              : Column(children: [const HubTitleBar('Order'), KEmptyState(icon: LucideIcons.circleAlert, title: 'Could not load', body: _error)]),
        ),
      );
    }
    final role = detail['role']?.toString() ?? 'buyer';
    final order = hubMap(detail['order']);
    final status = order['status']?.toString() ?? '';
    final (tone, label) = supplyOrderTone(status);
    final vendorDraft = role == 'vendor' && status == 'draft';
    final buyerConfirms = role == 'buyer' && status == 'proposed';
    final vendorResponds = role == 'vendor' && status == 'pending';
    final qtyEditable = vendorDraft || buyerConfirms;
    final canCancel = const ['draft', 'proposed', 'pending', 'confirmed', 'partial'].contains(status);
    final invoice = order['invoice'] is Map ? hubMap(order['invoice']) : null;
    final other = role == 'buyer' ? order['supplier_name'] : order['buyer_name'];

    final actions = <Widget>[
      if (vendorDraft) Expanded(child: KButton(label: 'Send to buyer', loading: _busy, onPressed: () => _act('send'))),
      if (buyerConfirms) ...[
        Expanded(child: KButton.secondary(label: 'Decline', onPressed: _busy ? null : () => _act('decline', confirmText: 'Decline this order?'))),
        Expanded(child: KButton(label: 'Confirm', loading: _busy, onPressed: () => _act('confirm'))),
      ],
      if (vendorResponds) ...[
        Expanded(child: KButton.secondary(label: 'Decline', onPressed: _busy ? null : () => _act('decline', confirmText: 'Decline this order?'))),
        Expanded(child: KButton(label: 'Confirm qty', loading: _busy, onPressed: () => _act('respond'))),
      ],
      if (role == 'vendor' && (status == 'confirmed' || status == 'partial'))
        Expanded(
          child: KButton(
            label: 'Create bill',
            icon: LucideIcons.fileText,
            onPressed: () => Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => InvoiceFormScreen(session: widget.session, supplyOrderId: widget.orderId)))
                .then((_) => _load()),
          ),
        ),
      if (role == 'buyer' && status == 'invoiced' && invoice != null)
        Expanded(
          child: KButton(
            label: 'Receive bill',
            icon: LucideIcons.packageCheck,
            onPressed: () => Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => ReceiveBillScreen(session: widget.session, invoiceId: invoice['id'].toString())))
                .then((_) => _load()),
          ),
        ),
    ];

    return Scaffold(
      backgroundColor: AppColors.bg,
      bottomNavigationBar: actions.isEmpty ? null : KBottomBar(children: actions),
      body: SafeArea(
        child: RefreshIndicator(
          color: AppColors.brand,
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.only(top: 8, bottom: 48),
            children: [
              HubTitleBar(role == 'buyer' ? 'Order from $other' : 'Order for $other',
                  trailing: canCancel
                      ? KIconButton(icon: LucideIcons.ban, tooltip: 'Cancel order', onTap: () => _act('cancel', confirmText: 'Cancel this order?'))
                      : null),
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
                child: Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  KPill(label: label, tone: tone),
                  if (order['origin'] == 'suggested') const KPill(label: 'From low stock', tone: KTone.neutral),
                  if (invoice != null) KPill(label: 'Bill ${invoice['invoice_number']}', tone: KTone.brand),
                  if (hubText(order['notes']) != null) Text(order['notes'].toString(), style: AppText.caption),
                ]),
              ),
              const KSectionHeader('Items'),
              for (final l in _lines)
                if (!l.removed)
                  KCard(
                    margin: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.md),
                    padding: const EdgeInsets.all(14),
                    child: _lineBody(l, role, qtyEditable, vendorDraft || vendorResponds, vendorResponds),
                  ),
              if (role == 'buyer' && status == 'pending')
                Padding(
                  padding: const EdgeInsets.all(AppSpace.gutter),
                  child: Text('Waiting for $other to confirm quantities.', style: AppText.caption),
                ),
              if (role == 'vendor' && status == 'proposed')
                Padding(
                  padding: const EdgeInsets.all(AppSpace.gutter),
                  child: Text('Waiting for $other to confirm.', style: AppText.caption),
                ),
              if (vendorDraft)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                  child: KButton.secondary(label: 'Save changes', loading: _busy, onPressed: () => _act('update')),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _lineBody(_OrderLine l, String role, bool qtyEditable, bool canPickItem, bool responding) {
    final line = l.line;
    final factor = toNum(line['factor']).toDouble();
    final name = role == 'buyer'
        ? (hubText(line['buyer_item_name']) ?? line['item_name']?.toString() ?? '')
        : (hubText(l.vendorItem?['name']) ?? hubText(line['vendor_item_name']) ?? line['item_name']?.toString() ?? '');
    final unit = role == 'vendor' || factor != 1 ? (hubText(line['vendor_unit']) ?? 'packs') : hubText(line['buyer_unit']);
    final price = line['unit_price'] == null ? null : toNum(line['unit_price']);
    final qty = double.tryParse(l.qty.text) ?? toNum(line['qty']).toDouble();
    final confirmedQty = line['confirmed_qty'] == null ? null : toNum(line['confirmed_qty']);
    final needsItem = canPickItem && line['vendor_item_id'] == null && l.vendorItem == null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(name, style: AppText.bodyStrong),
              Text(
                [
                  if (role == 'vendor' && name != line['item_name']) 'Buyer: ${line['item_name']}',
                  if (role == 'vendor' && line['buyer_stock_at_suggestion'] != null) 'buyer had ${qtyText(toNum(line['buyer_stock_at_suggestion']))}',
                  if (role == 'vendor' && line['vendor_current_stock'] != null) 'you have ${qtyText(toNum(line['vendor_current_stock']))}',
                  if (role == 'buyer' && line['buyer_current_stock'] != null) 'in stock ${qtyText(toNum(line['buyer_current_stock']))}',
                  if (factor != 1) '1 ${line['vendor_unit'] ?? 'pack'} = ${qtyText(factor)} ${line['buyer_unit'] ?? 'units'}',
                ].join(' · '),
                style: AppText.caption,
              ),
            ]),
          ),
          if (qtyEditable)
            HubQtyField(controller: l.qty, onChanged: (_) => setState(() {}))
          else
            Text(qtyText(confirmedQty ?? toNum(line['qty'])), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
          const SizedBox(width: 6),
          Text(unit ?? '', style: AppText.caption),
          if (qtyEditable) KIconButton(icon: LucideIcons.x, tooltip: 'Remove', onTap: () => setState(() => l.removed = true)),
        ]),
        if (role == 'buyer' && factor != 1)
          Text('= ${qtyText(qty * factor)} ${line['buyer_unit'] ?? 'units'}', style: AppText.caption),
        if (price != null)
          Text(
            '${inr(price, maxFraction: 2)} / ${unit ?? 'unit'} · ${inr((qtyEditable ? qty : (confirmedQty ?? toNum(line['qty']))) * price, maxFraction: 2)}',
            style: AppText.caption,
            textAlign: TextAlign.right,
          ),
        if (confirmedQty != null && confirmedQty != toNum(line['qty']) && !qtyEditable)
          Text('Asked ${qtyText(toNum(line['qty']))}, confirmed ${qtyText(confirmedQty)}', style: AppText.caption.copyWith(color: AppColors.due)),
        if (responding) ...[
          const SizedBox(height: AppSpace.sm),
          Row(children: [
            Text('You can supply', style: AppText.caption),
            const SizedBox(width: 8),
            HubQtyField(controller: l.confirmed),
            const SizedBox(width: 6),
            Text('of ${qtyText(toNum(line['qty']))}', style: AppText.caption),
          ]),
        ],
        if (canPickItem && (needsItem || l.vendorItem != null)) ...[
          const SizedBox(height: AppSpace.sm),
          KButton.secondary(
            label: l.vendorItem == null ? 'Pick your item' : 'Your item: ${l.vendorItem!['name']}',
            icon: LucideIcons.search,
            height: 40,
            onPressed: () => _pickVendorItem(l),
          ),
        ],
      ],
    );
  }
}

/// A new order to one connected supplier, starting from the items of theirs that are low.
class NewSupplyOrderScreen extends StatefulWidget {
  const NewSupplyOrderScreen({super.key, required this.session, required this.supplierId, this.supplierName});

  final AppSession session;
  final String supplierId;
  final String? supplierName;

  @override
  State<NewSupplyOrderScreen> createState() => _NewSupplyOrderScreenState();
}

class _NewLine {
  _NewLine(this.item, double qty) : qty = TextEditingController(text: qtyText(qty));
  final Map<String, dynamic> item;
  final TextEditingController qty;
}

class _NewSupplyOrderScreenState extends State<NewSupplyOrderScreen> {
  final _lines = <_NewLine>[];
  final _notes = TextEditingController();
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final l in _lines) {
      l.qty.dispose();
    }
    _notes.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/suppliers/${widget.supplierId}/items?filter=assigned');
      if (!mounted) return;
      setState(() {
        for (final r in hubList(body['items'])) {
          final stock = toNum(r['current_stock']).toDouble();
          final min = toNum(r['min_stock']).toDouble();
          if (min > 0 && stock <= min) {
            final suggest = (min * 2 - (stock < 0 ? 0 : stock)).clamp(min, double.infinity);
            _lines.add(_NewLine(r, suggest < 1 ? 1 : suggest));
          }
        }
      });
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _add() async {
    final picked = await pickOwnItem(context, widget.session, title: 'Add an item');
    if (picked == null || !mounted || _lines.any((l) => l.item['id'] == picked['id'])) return;
    setState(() => _lines.add(_NewLine(picked, 1)));
  }

  Future<void> _send() async {
    final lines = [
      for (final l in _lines)
        if ((double.tryParse(l.qty.text) ?? 0) > 0) {'buyer_item_id': l.item['id'], 'buyer_qty': double.parse(l.qty.text)},
    ];
    if (lines.isEmpty) {
      hubSnack(context, 'Add at least one item with a quantity');
      return;
    }
    setState(() => _saving = true);
    try {
      final body = await widget.session.api.postJson('/api/supply-orders', {
        'supplier_id': widget.supplierId,
        'notes': _notes.text.trim(),
        'lines': lines,
      });
      if (!mounted) return;
      final id = hubMap(body['order'])['id'].toString();
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => SupplyOrderScreen(session: widget.session, orderId: id)));
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      bottomNavigationBar: KBottomBar(children: [
        Expanded(child: KButton(label: 'Send order', icon: LucideIcons.send, loading: _saving, onPressed: _loading ? null : _send)),
      ]),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.only(top: 8, bottom: 48),
          children: [
            HubTitleBar(widget.supplierName == null ? 'New order' : 'Order from ${widget.supplierName}'),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0),
              child: Text('Quantities are in your units. Matched items are converted to the supplier’s packs.', style: AppText.caption),
            ),
            if (_loading)
              const KSpinner(padding: EdgeInsets.symmetric(vertical: 48))
            else ...[
              if (_lines.isEmpty)
                const KEmptyState(icon: LucideIcons.packageCheck, title: 'Nothing is low', body: 'Add items below.'),
              const SizedBox(height: AppSpace.md),
              for (final l in _lines)
                KCard(
                  margin: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(l.item['name']?.toString() ?? '', style: AppText.bodyStrong),
                        if (l.item['current_stock'] != null)
                          Text(
                            'In stock ${qtyText(toNum(l.item['current_stock']))}${toNum(l.item['min_stock']) > 0 ? ' · reorder at ${qtyText(toNum(l.item['min_stock']))}' : ''}',
                            style: AppText.caption,
                          ),
                      ]),
                    ),
                    HubQtyField(controller: l.qty),
                    KIconButton(icon: LucideIcons.x, tooltip: 'Remove', onTap: () => setState(() { l.qty.dispose(); _lines.remove(l); })),
                  ]),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0),
                child: KButton.secondary(label: 'Add item', icon: LucideIcons.plus, onPressed: _add),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
                child: TextField(controller: _notes, decoration: const InputDecoration(labelText: 'Note to supplier (optional)')),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
