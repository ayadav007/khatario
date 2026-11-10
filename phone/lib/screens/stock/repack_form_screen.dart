import 'package:flutter/material.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import 'stock_logic.dart';

String _fmt(num n) => jsNumberString((n * 1000).round() / 1000);

num _num(String v) {
  final n = num.tryParse(v.trim());
  return n != null && n.isFinite ? n : 0;
}

/// `app/(app)/inventory-adjustments/repacks/new/page.tsx` on the phone: take stock out of a bulk item and put it into
/// your own packs. Picking an item calls `GET /api/inventory-adjustments/repacks/prefill` (both items with their stock,
/// the saved content per pack, the last repack's quantities and the supplier's unit), then
/// `POST /api/inventory-adjustments/repacks` saves. The server works out the cost and the stock; the phone only checks
/// the quantities it was given. The route does not read a retry key, so a save is guarded against a second tap and
/// not retried by the phone. Pops with true when saved.
class RepackFormScreen extends StatefulWidget {
  const RepackFormScreen({super.key, required this.session, this.initialItemId});

  final AppSession session;

  /// Opens already filled for this item (the website's `?item_id=`, used by "Repack again").
  final String? initialItemId;

  @override
  State<RepackFormScreen> createState() => _RepackFormScreenState();
}

class _RepackFormScreenState extends State<RepackFormScreen> {
  final _sourceQty = TextEditingController();
  final _packedQty = TextEditingController();
  final _content = TextEditingController();
  final _wastageNotes = TextEditingController();
  final _notes = TextEditingController();
  final _found = <String, Map<String, dynamic>>{};
  Map<String, dynamic>? _source;
  Map<String, dynamic>? _packed;
  List<({String unit, num per})> _vendorUnits = const [];
  DateTime _date = dateOnly(DateTime.now());
  String _reason = 'SPILLAGE';
  bool _warehousesOn = false;
  List<Map<String, dynamic>> _warehouses = const [];
  String _locationId = '';
  bool _prefilling = false;
  int _seq = 0;

  KhatarioApi get _api => widget.session.api;
  String get _branchId => widget.session.defaultBranchId ?? '';

  @override
  void initState() {
    super.initState();
    for (final c in [_sourceQty, _packedQty, _content, _wastageNotes]) {
      c.addListener(() => setState(() {}));
    }
    _start();
  }

  @override
  void dispose() {
    for (final c in [_sourceQty, _packedQty, _content, _wastageNotes, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _start() async {
    await _loadPlaces();
    final id = widget.initialItemId;
    if (id != null && id.isNotEmpty && mounted) await _prefill(id);
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

  Map<String, dynamic>? _side(dynamic raw) => raw is Map ? Map<String, dynamic>.from(raw) : null;

  Future<void> _prefill(String itemId, {String? otherId, bool fillQuantities = true}) async {
    final seq = ++_seq;
    setState(() => _prefilling = true);
    try {
      final query = <String, String>{
        'item_id': itemId,
        'other_item_id': ?otherId,
        if (_warehousesOn && _locationId.isNotEmpty) 'location_id': _locationId,
        if (!_warehousesOn && _branchId.isNotEmpty) 'branch_id': _branchId,
      };
      final data = await _api.getJson(Uri(path: '/api/inventory-adjustments/repacks/prefill', queryParameters: query).toString());
      if (!mounted || seq != _seq) return;
      final content = docNum(data['content_per_unit']);
      final last = _side(data['last']);
      setState(() {
        _source = _side(data['source']);
        _packed = _side(data['packed']);
        _content.text = content != null && content > 0 ? _fmt(content) : '';
        _vendorUnits = [
          for (final v in docRows(data, 'vendor_units'))
            if ((docNum(v['per']) ?? 0) > 0) (unit: docText(v['unit']).isEmpty ? 'unit' : docText(v['unit']), per: docNum(v['per'])!),
        ];
        if (fillQuantities && last != null) {
          _sourceQty.text = _fmt(docNum(last['source_qty']) ?? 0);
          _packedQty.text = _fmt(docNum(last['packed_qty']) ?? 0);
          final r = docText(last['wastage_reason']);
          if (kWastageReasons.any((w) => w.$1 == r)) _reason = r;
        }
      });
    } on ApiException catch (e) {
      if (mounted && seq == _seq) showKToast(context, e.message.isEmpty ? 'Could not load the items' : e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted && seq == _seq) showKToast(context, 'Could not load the items', tone: KTone.negative);
    } finally {
      if (mounted && seq == _seq) setState(() => _prefilling = false);
    }
  }

  void _pickSource(String id, String name) {
    final packedId = docText(_packed?['id']);
    if (packedId.isNotEmpty && id != packedId) {
      _prefill(id, otherId: packedId);
    } else {
      _prefill(id);
    }
  }

  void _pickPacked(String id, String name) {
    final sourceId = docText(_source?['id']);
    if (sourceId.isEmpty) {
      _prefill(id);
    } else if (id == sourceId) {
      showKToast(context, 'Pick a different item to pack into', tone: KTone.negative);
    } else {
      _prefill(sourceId, otherId: id);
    }
  }

  num get _out => _num(_sourceQty.text);
  num get _made => _num(_packedQty.text);
  num get _per => _num(_content.text);
  num get _wastage => repackWastage(_out, _made, _per);
  num get _stock => docNum(_source?['stock']) ?? 0;
  bool get _short => _source != null && _out > _stock + 1e-9;

  bool get _ready =>
      _source != null &&
      _packed != null &&
      _out > 0 &&
      _made > 0 &&
      _per > 0 &&
      _wastage >= 0 &&
      !_short &&
      (!_warehousesOn || _locationId.isNotEmpty) &&
      !_prefilling;

  Future<void> _save() async {
    if (!_ready) return;
    final body = repackBody(
      sourceId: docText(_source!['id']),
      packedId: docText(_packed!['id']),
      sourceQty: _out,
      packedQty: _made,
      content: _per,
      wastage: _wastage,
      reason: _reason,
      wastageNotes: _wastageNotes.text,
      notes: _notes.text,
      date: _date,
      locationId: _warehousesOn ? _locationId : '',
      branchId: _warehousesOn ? '' : _branchId,
    );
    final reply = await _api.postJson('/api/inventory-adjustments/repacks', body);
    if (!mounted) return;
    final repack = reply['repack'];
    final number = repack is Map ? docText(repack['repackNumber']) : '';
    showKToast(
      context,
      '${number.isEmpty ? 'Repack' : number} saved: ${_fmt(_made)} ${docText(_packed!['name'])}',
      tone: KTone.positive,
    );
    Navigator.of(context).pop(true);
  }

  Widget _hint(String text, {bool error = false}) => Padding(
        padding: const EdgeInsets.only(top: 6, left: 2),
        child: Text(text, style: AppText.caption.copyWith(color: error ? AppColors.negative : AppColors.ink2)),
      );

  @override
  Widget build(BuildContext context) {
    final unit = docText(_source?['unit']);
    final both = _source != null && _packed != null;
    final entered = both && _out > 0 && _made > 0 && _per > 0;
    final wastage = _wastage;
    return KFormScaffold(
      title: 'Repack',
      saveLabel: 'Repack',
      onSave: _save,
      dirty: _source != null,
      canSave: _ready,
      children: [
        if (_warehousesOn)
          KPickField<String>(
            label: 'Warehouse',
            value: _locationId.isEmpty ? null : _locationId,
            options: [for (final w in _warehouses) (docText(w['id']), docText(w['name']))],
            onChanged: (v) {
              setState(() => _locationId = v);
              final src = docText(_source?['id']);
              if (src.isNotEmpty) _prefill(src, otherId: docText(_packed?['id']).isEmpty ? null : docText(_packed?['id']), fillQuantities: false);
            },
          ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KAsyncPickField(label: 'From', valueLabel: _source == null ? null : docText(_source!['name']), search: _search, onPicked: _pickSource),
            if (_source != null) _hint('In stock ${_fmt(_stock)}${unit.isEmpty ? '' : ' $unit'}', error: _short),
          ],
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KTextField(
              label: 'Take out${unit.isEmpty ? '' : ' ($unit)'}',
              controller: _sourceQty,
              hint: '0',
              keyboard: const TextInputType.numberWithOptions(decimal: true),
              error: _short ? 'Only ${_fmt(_stock)} $unit in stock here'.trim() : null,
            ),
            if (_vendorUnits.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: AppSpace.sm),
                child: Wrap(
                  spacing: AppSpace.sm,
                  runSpacing: AppSpace.sm,
                  children: [
                    for (final v in _vendorUnits)
                      KChip(
                        label: '+ 1 ${v.unit.toLowerCase()} (${_fmt(v.per)} ${unit.toLowerCase()})',
                        selected: false,
                        onTap: () {
                          final next = _fmt(_out + v.per);
                          _sourceQty.text = next;
                          if (_per > 0 && _packedQty.text.trim().isEmpty) _packedQty.text = _fmt((_out / _per).floor());
                        },
                      ),
                  ],
                ),
              ),
          ],
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KAsyncPickField(label: 'Into', valueLabel: _packed == null ? null : docText(_packed!['name']), search: _search, onPicked: _pickPacked),
            if (both) _hint('In stock ${_fmt(docNum(_packed!['stock']) ?? 0)}'),
          ],
        ),
        if (both)
          KTextField(
            label: 'Each pack holds${unit.isEmpty ? '' : ' ($unit)'}',
            controller: _content,
            hint: '0',
            keyboard: const TextInputType.numberWithOptions(decimal: true),
          ),
        KTextField(
          label: 'Made',
          controller: _packedQty,
          hint: '0',
          keyboard: const TextInputType.numberWithOptions(decimal: true),
        ),
        if (entered)
          wastage < 0
              ? Text('Packed more than you took out; check the numbers.', style: AppText.body.copyWith(color: AppColors.negative))
              : wastage > 0
                  ? KCard(
                      padding: const EdgeInsets.all(AppSpace.lg),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text('Wastage ${_fmt(wastage)} $unit (${(wastage / _out * 1000).round() / 10}%)'.replaceAll('  ', ' '), style: AppText.bodyStrong),
                          const SizedBox(height: AppSpace.md),
                          KPickField<String>(
                            label: 'Wastage reason',
                            value: _reason,
                            options: [for (final (c, l) in kWastageReasons) (c, l)],
                            onChanged: (v) => setState(() => _reason = v),
                          ),
                          if (_reason == 'OTHER') ...[
                            const SizedBox(height: AppSpace.md),
                            KTextField(label: 'What happened?', controller: _wastageNotes),
                          ],
                        ],
                      ),
                    )
                  : Text('No wastage.', style: AppText.body.copyWith(color: AppColors.ink2)),
        KDateField(label: 'Date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        KTextField(label: 'Note (optional)', controller: _notes, hint: 'Optional'),
      ],
    );
  }
}
