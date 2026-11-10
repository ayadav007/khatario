import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../items/scan_add_logic.dart' show batchBody, batchErrors;
import 'stock_logic.dart';

/// One item being adjusted.
class _Line {
  Map<String, dynamic>? item;
  bool checking = false;
  bool blocked = false;
  bool tracksBatch = false;
  String variantId = '';
  String direction = 'INCREASE';
  final qty = TextEditingController();
  final batch = TextEditingController();
  final mfg = TextEditingController();
  final exp = TextEditingController();

  /// The retry key for the body last sent. It changes only when the body does.
  String key = newAdjustKey();
  String? sentJson;
  String savedText = '';
  bool saved = false;

  void dispose() {
    for (final c in [qty, batch, mfg, exp]) {
      c.dispose();
    }
  }

  String get name => item == null ? 'Item' : docText(item!['name']);

  List<Map<String, dynamic>> get variants => item?['has_variants'] == true ? docRows(item, 'variants') : const [];
}

/// `app/(app)/inventory-adjustments/new/page.tsx` on the phone: add or reduce stock of one or more items, with a
/// reason, an optional warehouse and (for batch items) the batch of the stock added.
///
/// Each item is one `POST /api/inventory-adjustments` (the route takes one item), each with its own
/// `X-Idempotency-Key`. A line that is saved stays saved: after a refusal on a later line, saving again sends only
/// the lines still open. The phone never works out the stock after; it shows what the server answers.
/// Pops with true when everything was saved.
class AdjustmentFormScreen extends StatefulWidget {
  const AdjustmentFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<AdjustmentFormScreen> createState() => _AdjustmentFormScreenState();
}

class _AdjustmentFormScreenState extends State<AdjustmentFormScreen> {
  final _lines = <_Line>[_Line()];
  final _reasonNotes = TextEditingController();
  final _notes = TextEditingController();
  final _found = <String, Map<String, dynamic>>{};
  DateTime _date = dateOnly(DateTime.now());
  String _reason = 'STOCK_TAKE';
  bool _warehousesOn = false;
  List<Map<String, dynamic>> _warehouses = const [];
  String _locationId = '';
  bool _submitted = false;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _loadPlaces();
  }

  @override
  void dispose() {
    for (final l in _lines) {
      l.dispose();
    }
    _reasonNotes.dispose();
    _notes.dispose();
    super.dispose();
  }

  /// `GET /api/settings/warehouses` (`warehouses_enabled`), then `GET /api/warehouses` (`warehouses`).
  Future<void> _loadPlaces() async {
    try {
      final s = await _api.getJson('/api/settings/warehouses');
      if (s['warehouses_enabled'] != true) return;
      final w = await _api.getJson('/api/warehouses');
      final rows = docRows(w, 'warehouses');
      if (!mounted) return;
      setState(() {
        _warehousesOn = true;
        _warehouses = rows;
        if (rows.length == 1) _locationId = docText(rows.first['id']);
      });
    } catch (_) {
      // The form still works for a business without warehouses.
    }
  }

  Future<List<(String, String, String)>> _search(String q) async {
    final rows = await searchStockItems(_api, q);
    for (final r in rows) {
      _found[docText(r['id'])] = r;
    }
    return [for (final r in rows) (docText(r['id']), docText(r['name']), stockItemSub(r))];
  }

  Future<void> _picked(_Line line, String id, String name) async {
    setState(() {
      line.item = _found[id] ?? {'id': id, 'name': name};
      line.variantId = '';
      line.checking = true;
      line.blocked = false;
      line.tracksBatch = false;
    });
    try {
      // The search reply does not say whether an item tracks batches or serials; the item page does.
      final body = await _api.getJson('/api/items/$id');
      final raw = body['item'];
      if (raw is! Map) throw ApiException('Item not found');
      final item = Map<String, dynamic>.from(raw);
      if (!mounted || docText(line.item?['id']) != id) return;
      setState(() {
        line.checking = false;
        line.blocked = adjustItemBlocked(item);
        line.tracksBatch = adjustItemTracksBatch(item);
      });
    } catch (_) {
      if (!mounted || docText(line.item?['id']) != id) return;
      setState(() {
        line.item = null;
        line.checking = false;
      });
      showKToast(context, 'Could not check this item. Try again.', tone: KTone.negative);
    }
  }

  num? _qty(_Line l) {
    final n = num.tryParse(l.qty.text.trim());
    return n != null && n.isFinite ? n : null;
  }

  bool _needsBatchFields(_Line l) => l.tracksBatch && l.direction == 'INCREASE' && !l.saved;

  String? _qtyError(_Line l) {
    if (!_submitted || l.saved || l.item == null) return null;
    final q = _qty(l);
    return q == null || q <= 0 ? 'Enter a quantity greater than zero' : null;
  }

  Map<String, String> _batchErrors(_Line l) => _needsBatchFields(l) && _submitted ? batchErrors(l.mfg.text, l.exp.text) : const {};

  bool _valid() {
    for (final l in _lines) {
      if (l.saved) continue;
      if (l.item == null || l.checking || l.blocked) return false;
      final q = _qty(l);
      if (q == null || q <= 0) return false;
      if (_needsBatchFields(l) && batchErrors(l.mfg.text, l.exp.text).isNotEmpty) return false;
    }
    if (_warehousesOn && _locationId.isEmpty) return false;
    return true;
  }

  Map<String, dynamic> _body(_Line l) => adjustmentBody(
        itemId: docText(l.item!['id']),
        variantId: l.variantId,
        direction: l.direction,
        quantity: _qty(l)!,
        reason: _reason,
        reasonNotes: _reasonNotes.text,
        notes: _notes.text,
        date: _date,
        locationId: _warehousesOn ? _locationId : '',
        branchId: _warehousesOn ? '' : (widget.session.defaultBranchId ?? ''),
        batch: _needsBatchFields(l) ? batchBody(l.qty.text, l.batch.text, l.mfg.text, l.exp.text) : null,
      );

  String _savedText(Map<String, dynamic> reply, _Line l) {
    final a = reply['adjustment'];
    final map = a is Map ? a : const {};
    final number = docText(map['adjustmentNumber']);
    final after = docNum(map['quantityAfter']);
    final unit = docText(l.item?['unit']);
    return [
      number.isEmpty ? 'Saved' : 'Saved $number',
      if (after != null) 'stock now ${jsNumberString((after * 1000).round() / 1000)}${unit.isEmpty ? '' : ' $unit'}',
    ].join(' · ');
  }

  Future<void> _save() async {
    setState(() => _submitted = true);
    if (!_valid()) return;
    try {
      for (final l in _lines) {
        if (l.saved) continue;
        final body = _body(l);
        final json = jsonEncode(body);
        if (l.sentJson != json) {
          l.sentJson = json;
          l.key = newAdjustKey();
        }
        try {
          final reply = await _api.postJson('/api/inventory-adjustments', body, headers: {'X-Idempotency-Key': l.key});
          l.saved = true;
          l.savedText = _savedText(reply, l);
        } on ApiException catch (e) {
          // The refused line stays filled; say which one when there are several.
          final several = _lines.length > 1;
          throw ApiException(several ? '${l.name}: ${e.message}' : e.message, status: e.status, code: e.code, body: e.body);
        }
      }
    } finally {
      if (mounted) setState(() {});
    }
    if (!mounted) return;
    final count = _lines.length;
    showKToast(
      context,
      count == 1 ? _lines.first.savedText : '$count adjustments saved',
      tone: KTone.positive,
    );
    Navigator.of(context).pop(true);
  }

  Widget _lineCard(int index, _Line l) {
    final multiple = _lines.length > 1;
    final unit = docText(l.item?['unit']);
    final variant = l.variants.where((v) => docText(v['id']) == l.variantId).firstOrNull;
    final stock = docNum((variant ?? l.item)?['current_stock']);
    final needsItem = _submitted && l.item == null && !l.saved;
    final batchErr = _batchErrors(l);
    if (l.saved) {
      return KCard(
        padding: const EdgeInsets.all(AppSpace.lg),
        child: Row(
          children: [
            const Icon(LucideIcons.circleCheck, size: 18, color: AppColors.positive),
            const SizedBox(width: AppSpace.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l.name, style: AppText.bodyStrong),
                  Text(l.savedText, style: AppText.caption),
                ],
              ),
            ),
          ],
        ),
      );
    }
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (multiple)
            Row(
              children: [
                Expanded(child: Text('Item ${index + 1}', style: AppText.bodyStrong)),
                KIconButton(
                  icon: LucideIcons.trash2,
                  tooltip: 'Remove item',
                  onTap: () => setState(() {
                    _lines.removeAt(index).dispose();
                  }),
                ),
              ],
            ),
          KAsyncPickField(
            label: 'Item',
            valueLabel: l.item == null ? null : l.name,
            search: _search,
            onPicked: (id, name) => _picked(l, id, name),
          ),
          if (needsItem) _hint('Pick the item', error: true),
          if (l.checking) const Padding(padding: EdgeInsets.only(top: AppSpace.sm), child: KSpinner(padding: EdgeInsets.zero)),
          if (l.item != null && stock != null) _hint('In stock ${jsNumberString((stock * 1000).round() / 1000)}${unit.isEmpty ? '' : ' $unit'}'),
          if (l.blocked) ...[
            const SizedBox(height: AppSpace.sm),
            Text(adjustItemBlockedText, style: AppText.caption.copyWith(color: AppColors.negative)),
          ],
          if (l.item != null && !l.checking && !l.blocked) ...[
            if (l.variants.isNotEmpty) ...[
              const SizedBox(height: AppSpace.md),
              KPickField<String>(
                label: 'Variant',
                value: l.variantId,
                options: [
                  ('', 'Base item (no variant)'),
                  for (final v in l.variants) (docText(v['id']), docText(v['variant_name'])),
                ],
                onChanged: (v) => setState(() => l.variantId = v),
              ),
            ],
            const SizedBox(height: AppSpace.md),
            KSegmented<String>(
              value: l.direction,
              options: const [('INCREASE', 'Add stock'), ('DECREASE', 'Reduce stock')],
              onChanged: (v) => setState(() => l.direction = v),
            ),
            const SizedBox(height: AppSpace.md),
            KTextField(
              label: 'Quantity',
              controller: l.qty,
              hint: '0',
              keyboard: const TextInputType.numberWithOptions(decimal: true),
              error: _qtyError(l),
              onChanged: (_) => setState(() {}),
            ),
            if (_needsBatchFields(l)) ...[
              const SizedBox(height: AppSpace.md),
              KTextField(label: 'Batch number', controller: l.batch, hint: 'Optional'),
              const SizedBox(height: AppSpace.md),
              KTextField(
                label: 'Manufacturing date (YYYY-MM-DD or YYYY-MM)',
                controller: l.mfg,
                hint: 'Optional',
                keyboard: TextInputType.datetime,
                error: batchErr['manufacturing_date'],
              ),
              const SizedBox(height: AppSpace.md),
              KTextField(
                label: 'Expiry (YYYY-MM-DD or YYYY-MM)',
                controller: l.exp,
                hint: 'Optional',
                keyboard: TextInputType.datetime,
                error: batchErr['expiry_date'],
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _hint(String text, {bool error = false}) => Padding(
        padding: const EdgeInsets.only(top: 6, left: 2),
        child: Text(text, style: AppText.caption.copyWith(color: error ? AppColors.negative : AppColors.ink2)),
      );

  @override
  Widget build(BuildContext context) {
    final open = _lines.where((l) => !l.saved).toList();
    final blocked = open.any((l) => l.blocked || l.checking);
    final dirty = _lines.any((l) => l.item != null) && open.isNotEmpty;
    return KFormScaffold(
      title: 'New inventory adjustment',
      saveLabel: 'Save adjustment',
      onSave: _save,
      dirty: dirty,
      canSave: open.isNotEmpty && !blocked,
      children: [
        KDateField(label: 'Date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        if (_warehousesOn)
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KPickField<String>(
                label: 'Warehouse',
                value: _locationId.isEmpty ? null : _locationId,
                options: [for (final w in _warehouses) (docText(w['id']), docText(w['name']))],
                onChanged: (v) => setState(() => _locationId = v),
              ),
              if (_submitted && _locationId.isEmpty) _hint('Select a warehouse', error: true),
            ],
          ),
        KPickField<String>(
          label: 'Reason',
          value: _reason,
          options: [for (final (c, label) in kAdjustReasons) (c, label)],
          onChanged: (v) => setState(() => _reason = v),
        ),
        KTextField(label: 'Reason notes (optional)', controller: _reasonNotes, hint: 'Details about the reason', maxLines: 2),
        for (final (i, l) in _lines.indexed) _lineCard(i, l),
        KButton.secondary(
          label: 'Add another item',
          icon: LucideIcons.plus,
          onPressed: () => setState(() => _lines.add(_Line())),
        ),
        KTextField(label: 'Notes (optional)', controller: _notes, hint: 'Additional notes', maxLines: 2),
      ],
    );
  }
}
