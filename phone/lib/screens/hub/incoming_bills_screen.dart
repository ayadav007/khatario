import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../purchases/purchase_section.dart';
import 'hub_common.dart';

/// Bills from connected suppliers. Receiving one turns it into a purchase with no typing.
class IncomingBillsScreen extends StatefulWidget {
  const IncomingBillsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<IncomingBillsScreen> createState() => _IncomingBillsScreenState();
}

class _IncomingBillsScreenState extends State<IncomingBillsScreen> {
  String _status = 'pending';
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final body = await widget.session.api.getJson('/api/purchases/incoming-bills?status=$_status');
      if (mounted) setState(() => _rows = hubList(body['bills']));
    } on ApiException catch (e) {
      if (mounted) setState(() { _rows = const []; _error = e.message; });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _open(Map<String, dynamic> row) async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => ReceiveBillScreen(session: widget.session, invoiceId: row['invoice_id'].toString()),
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
              const HubTitleBar('Incoming bills'),
              const SizedBox(height: AppSpace.md),
              KChipBar<String>(
                value: _status,
                options: const [('pending', 'To receive'), ('received', 'Received'), ('all', 'All')],
                onChanged: (v) { setState(() => _status = v); _load(); },
              ),
              if (_loading)
                const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
              else if (_error != null)
                KEmptyState(icon: LucideIcons.circleAlert, title: 'Could not load', body: _error)
              else if (_rows.isEmpty)
                KEmptyState(
                  icon: LucideIcons.inbox,
                  title: _status == 'pending' ? 'Nothing to receive' : 'No bills here',
                  body: 'Bills from your connected suppliers show up here.',
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
                          leading: KAvatar(name: row['supplier_name']?.toString() ?? ''),
                          title: row['supplier_name']?.toString() ?? 'Supplier',
                          subtitle: [
                            'Bill ${row['invoice_number'] ?? ''}',
                            hubDate(row['invoice_date']),
                            '${row['line_count'] ?? 0} items',
                            if (row['possible_duplicate'] == true && row['purchase_id'] == null) 'may already be entered',
                          ].where((s) => s.isNotEmpty).join(' · '),
                          trailing: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(inr(toNum(row['grand_total']), maxFraction: 2), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                              const SizedBox(height: 2),
                              row['purchase_id'] == null
                                  ? const KStatusDot(label: 'To receive', tone: KTone.due)
                                  : row['receipt_status'] == 'received_with_issues'
                                      ? const KStatusDot(label: 'With issues', tone: KTone.due)
                                      : const KStatusDot(label: 'Received', tone: KTone.positive),
                            ],
                          ),
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

class _LineState {
  _LineState(this.line);

  final Map<String, dynamic> line;
  Map<String, dynamic>? chosen; // { id, name, unit }
  final factor = TextEditingController(text: '1');
  final short = TextEditingController();
  final damaged = TextEditingController();
  final note = TextEditingController();
  bool changing = false;

  Map<String, dynamic>? get match => line['match'] is Map ? Map<String, dynamic>.from(line['match']) : null;
  bool get isService => line['is_service'] == true;

  /// The item, unit and factor this line will use.
  ({String id, String name, String? unit, double factor})? get effective {
    if (chosen != null) {
      return (id: chosen!['id'].toString(), name: chosen!['name']?.toString() ?? '', unit: hubText(chosen!['unit']), factor: double.tryParse(factor.text) ?? 0);
    }
    final m = match;
    if (m == null) return null;
    return (id: m['item_id'].toString(), name: m['item_name']?.toString() ?? '', unit: hubText(m['unit']), factor: toNum(m['factor']).toDouble());
  }

  void dispose() {
    factor.dispose();
    short.dispose();
    damaged.dispose();
    note.dispose();
  }
}

/// Check a connected supplier's bill line by line, then create the purchase.
class ReceiveBillScreen extends StatefulWidget {
  const ReceiveBillScreen({super.key, required this.session, required this.invoiceId});

  final AppSession session;
  final String invoiceId;

  @override
  State<ReceiveBillScreen> createState() => _ReceiveBillScreenState();
}

class _ReceiveBillScreenState extends State<ReceiveBillScreen> {
  Map<String, dynamic>? _detail;
  List<_LineState> _lines = const [];
  bool _loading = true;
  bool _saving = false;
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
      final body = await widget.session.api.getJson('/api/purchases/incoming-bills/${widget.invoiceId}');
      if (!mounted) return;
      for (final l in _lines) {
        l.dispose();
      }
      setState(() {
        _detail = body;
        _lines = [for (final l in hubList(body['lines'])) _LineState(l)];
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pick(_LineState s) async {
    final picked = await pickOwnItem(context, widget.session, suggestions: hubList(s.line['suggestions']));
    if (picked == null || !mounted) return;
    setState(() {
      s.chosen = {'id': picked['id'], 'name': picked['name'], 'unit': picked['unit']};
      s.changing = false;
      final m = s.match;
      s.factor.text = m != null && m['item_id'] == picked['id'] ? qtyText(toNum(m['factor'])) : '1';
    });
  }

  Future<void> _createItem(_LineState s) async {
    final name = TextEditingController(text: s.line['item_name']?.toString() ?? '');
    final factor = TextEditingController(text: '1');
    final selling = TextEditingController();
    final ok = await showKSheet<bool>(
      context,
      title: 'New item from this line',
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 4, AppSpace.gutter, AppSpace.md),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(controller: name, decoration: const InputDecoration(labelText: 'Name')),
            const SizedBox(height: AppSpace.sm),
            TextField(
              controller: factor,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: 'Your units in 1 ${s.line['unit'] ?? 'supplier unit'}'),
            ),
            const SizedBox(height: AppSpace.sm),
            TextField(
              controller: selling,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Your selling price (optional)'),
            ),
            const SizedBox(height: AppSpace.sm),
            Text('HSN, GST rate and cost come from the bill.', style: AppText.caption),
            const SizedBox(height: AppSpace.md),
            KButton(label: 'Create item', onPressed: () => Navigator.pop(ctx, true)),
          ],
        ),
      ),
    );
    if (ok == true && mounted) {
      try {
        final body = await widget.session.api.postJson('/api/purchases/incoming-bills/${widget.invoiceId}/create-item', {
          'invoice_item_id': s.line['invoice_item_id'],
          'name': name.text.trim(),
          'factor': double.tryParse(factor.text) ?? 1,
          'selling_price': selling.text.trim().isEmpty ? null : double.tryParse(selling.text),
        });
        final item = hubMap(body['item']);
        if (mounted) {
          setState(() {
            s.chosen = {'id': item['id'], 'name': item['name'], 'unit': item['unit']};
            s.factor.text = qtyText(toNum(body['factor']));
            s.changing = false;
          });
          hubSnack(context, 'Created ${item['name']}');
        }
      } on ApiException catch (e) {
        if (mounted) hubSnack(context, e.message);
      }
    }
    name.dispose();
    factor.dispose();
    selling.dispose();
  }

  Future<void> _receive() async {
    final itemMap = <String, dynamic>{};
    final received = <String, dynamic>{};
    for (final s in _lines) {
      final id = s.line['invoice_item_id'].toString();
      if (s.chosen != null) itemMap[id] = {'item_id': s.chosen!['id'], 'factor': double.tryParse(s.factor.text) ?? 1};
      final short = double.tryParse(s.short.text) ?? 0;
      final damaged = double.tryParse(s.damaged.text) ?? 0;
      if (short > 0 || damaged > 0) {
        received[id] = {'short_qty': short, 'damaged_qty': damaged, 'note': s.note.text.trim()};
      }
    }
    setState(() => _saving = true);
    try {
      final body = await widget.session.api.postJson('/api/invoices/${widget.invoiceId}/convert-to-purchase', {
        'item_map': itemMap,
        'received': received,
      });
      if (!mounted) return;
      hubSnack(context, 'Purchase ${hubMap(body['purchase'])['bill_number'] ?? ''} created');
      await _load();
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _debitNote() {
    final detail = _detail!;
    final bill = hubMap(detail['bill']);
    final purchase = hubMap(detail['purchase']);
    final qty = <String, double>{};
    for (final r in hubList(detail['receipt_lines'])) {
      final id = hubText(r['buyer_item_id']);
      final q = toNum(r['short_qty']) + toNum(r['damaged_qty']);
      if (id != null && q > 0) qty[id] = (qty[id] ?? 0) + q.toDouble();
    }
    Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => PurchaseReturnForm(
        session: widget.session,
        purchaseId: purchase['id']?.toString(),
        supplierId: bill['supplier_id']?.toString(),
        prefillQty: qty,
        reason: 'Short/damaged on delivery of bill ${bill['invoice_number'] ?? ''}',
      ),
    )).then((saved) { if (saved == true) _load(); });
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    if (_loading && detail == null) {
      return const Scaffold(backgroundColor: AppColors.bg, body: SafeArea(child: KSpinner(padding: EdgeInsets.symmetric(vertical: 80))));
    }
    if (detail == null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(child: Column(children: [
          const HubTitleBar('Bill'),
          KEmptyState(icon: LucideIcons.circleAlert, title: 'Could not load', body: _error),
        ])),
      );
    }
    final bill = hubMap(detail['bill']);
    final purchase = detail['purchase'] is Map ? hubMap(detail['purchase']) : null;
    final missing = _lines.where((s) => !s.isService && (s.effective == null || s.effective!.factor <= 0)).toList();

    return Scaffold(
      backgroundColor: AppColors.bg,
      bottomNavigationBar: purchase != null
          ? null
          : KBottomBar(children: [
              Expanded(
                child: KButton(
                  label: missing.isEmpty ? 'Receive and create purchase' : 'Match ${missing.length} item(s) first',
                  icon: LucideIcons.packageCheck,
                  loading: _saving,
                  onPressed: missing.isEmpty ? _receive : null,
                ),
              ),
            ]),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.only(top: 8, bottom: 48),
          children: [
            HubTitleBar(bill['supplier_name']?.toString() ?? 'Bill'),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
              child: KInfoCard(title: 'Bill', rows: [
                ('Number', bill['invoice_number']?.toString() ?? ''),
                ('Date', hubDate(bill['invoice_date'])),
                ('Total', inr(toNum(bill['grand_total']), maxFraction: 2)),
                ('Tax', inr(toNum(bill['tax_total']), maxFraction: 2)),
              ]),
            ),
            if (purchase != null) ..._received(purchase) else ..._lineCards(),
          ],
        ),
      ),
    );
  }

  List<Widget> _received(Map<String, dynamic> purchase) {
    final detail = _detail!;
    final issues = hubList(detail['receipt_lines']).where((r) => toNum(r['short_qty']) + toNum(r['damaged_qty']) > 0).toList();
    final returns = hubList(detail['purchase_returns']);
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xl, AppSpace.gutter, 0),
        child: KInfoCard(title: 'Received', rows: [
          ('Purchase', purchase['bill_number']?.toString() ?? ''),
          ('Status', purchase['receipt_status'] == 'received_with_issues' ? 'Received with issues' : 'Received in full'),
          for (final r in issues)
            (
              r['item_name']?.toString() ?? '',
              [
                if (toNum(r['short_qty']) > 0) '${qtyText(toNum(r['short_qty']))} short',
                if (toNum(r['damaged_qty']) > 0) '${qtyText(toNum(r['damaged_qty']))} damaged',
                ?hubText(r['note']),
              ].join(', '),
            ),
          if (returns.isNotEmpty) ('Debit note', returns.map((r) => r['return_number']).join(', ')),
        ]),
      ),
      if (issues.isNotEmpty && returns.isEmpty)
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
          child: KButton(label: 'Record debit note for these', icon: LucideIcons.undo2, onPressed: _debitNote),
        ),
    ];
  }

  List<Widget> _lineCards() {
    return [
      const KSectionHeader('Items'),
      for (final s in _lines)
        KCard(
          margin: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.md),
          padding: const EdgeInsets.all(14),
          child: _lineBody(s),
        ),
    ];
  }

  Widget _lineBody(_LineState s) {
    final l = s.line;
    final e = s.effective;
    final ownQty = e == null || e.factor <= 0 ? null : toNum(l['quantity']) * e.factor;
    final showPicker = !s.isService && (s.match == null || s.changing) && s.chosen == null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(l['item_name']?.toString() ?? '', style: AppText.bodyStrong),
              Text(
                '${qtyText(toNum(l['quantity']))} ${l['unit'] ?? ''} × ${inr(toNum(l['unit_price']), maxFraction: 2)}',
                style: AppText.caption,
              ),
            ]),
          ),
          Text(inr(toNum(l['line_total']), maxFraction: 2), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
        ]),
        const SizedBox(height: AppSpace.sm),
        if (s.isService)
          Text('Service, no stock.', style: AppText.caption)
        else if (showPicker)
          Wrap(spacing: 8, runSpacing: 8, children: [
            KButton.secondary(label: 'Pick my item', icon: LucideIcons.search, expand: false, height: 40, onPressed: () => _pick(s)),
            KButton.secondary(label: 'Create new item', icon: LucideIcons.plus, expand: false, height: 40, onPressed: () => _createItem(s)),
          ])
        else if (e != null) ...[
          Row(children: [
            Expanded(
              child: Text(
                ownQty == null ? 'Set units per ${l['unit'] ?? 'supplier unit'}' : 'Adds ${qtyText(ownQty)} ${e.unit ?? ''} of ${e.name}',
                style: AppText.body,
              ),
            ),
            KTextButton(label: 'Change', onTap: () => setState(() { s.chosen = null; s.changing = true; })),
          ]),
          if (s.chosen != null)
            Row(children: [
              Text('1 ${l['unit'] ?? 'supplier unit'} =', style: AppText.caption),
              const SizedBox(width: 8),
              HubQtyField(controller: s.factor, width: 80, onChanged: (_) => setState(() {})),
              const SizedBox(width: 8),
              Expanded(child: Text(e.unit ?? 'units', style: AppText.caption)),
            ]),
          const SizedBox(height: AppSpace.sm),
          Row(children: [
            HubQtyField(controller: s.short, label: 'Short', onChanged: (_) => setState(() {})),
            const SizedBox(width: 8),
            HubQtyField(controller: s.damaged, label: 'Damaged', onChanged: (_) => setState(() {})),
            const SizedBox(width: 8),
            Expanded(child: Text(e.unit ?? 'units', style: AppText.caption)),
          ]),
          if ((double.tryParse(s.short.text) ?? 0) > 0 || (double.tryParse(s.damaged.text) ?? 0) > 0) ...[
            const SizedBox(height: AppSpace.sm),
            TextField(controller: s.note, decoration: const InputDecoration(labelText: 'Note', isDense: true)),
          ],
        ],
      ],
    );
  }
}
