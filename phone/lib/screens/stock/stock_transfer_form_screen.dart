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
import 'stock_logic.dart' show searchStockItems, stockItemSub;
import 'stock_transfer_logic.dart';

/// One item on the transfer.
class _Line {
  Map<String, dynamic>? item;
  final qty = TextEditingController();
  final unit = TextEditingController();
  final notes = TextEditingController();

  void dispose() {
    for (final c in [qty, unit, notes]) {
      c.dispose();
    }
  }

  String get id => item == null ? '' : docText(item!['id']);
  String get name => item == null ? '' : docText(item!['name']);
}

/// `app/(app)/stock-transfers/new/page.tsx` on the phone: move stock from one warehouse to another.
///
/// The warehouses come from `GET /api/warehouses` (`warehouses`), the table whose ids the create route checks. Create is
/// one `POST /api/stock-transfers` with `transfer_number`, `transfer_date`, `from_location_id`, `to_location_id`,
/// `notes` and `items` (`item_id`, `qty`, `unit`, `notes`); the session names the business and the creator. Nothing
/// moves yet: the server makes it a draft, or pending dispatch when the user may approve. Pops with true when created.
class StockTransferFormScreen extends StatefulWidget {
  const StockTransferFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<StockTransferFormScreen> createState() => _StockTransferFormScreenState();
}

class _StockTransferFormScreenState extends State<StockTransferFormScreen> {
  final _lines = <_Line>[_Line()];
  final _number = TextEditingController();
  final _notes = TextEditingController();
  final _found = <String, Map<String, dynamic>>{};
  DateTime _date = dateOnly(DateTime.now());
  List<Map<String, dynamic>> _warehouses = const [];
  String _from = '';
  String _to = '';
  bool _loading = true;
  bool _notInPlan = false;
  String? _error;
  bool _submitted = false;

  KhatarioApi get _api => widget.session.api;

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
    _number.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await _api.getJson('/api/warehouses');
      var numbers = <String>[];
      try {
        // Only to number the transfer after the day's earlier ones; the form works without it.
        final list = await _api.getData('/api/stock-transfers');
        numbers = [for (final r in docRows(list, 'transfers')) docText(r['transfer_number'])];
      } catch (_) {}
      if (!mounted) return;
      setState(() {
        _warehouses = docRows(body, 'warehouses');
        if (_number.text.isEmpty) _number.text = nextTransferNumber(numbers, _date);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN' || e.code == 'FEATURE_NOT_AVAILABLE';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  List<(String, String)> get _options => [
        for (final w in _warehouses)
          (
            docText(w['id']),
            docText(w['warehouse_code']).isEmpty ? docText(w['name']) : '${docText(w['name'])} (${docText(w['warehouse_code'])})',
          ),
      ];

  Future<List<(String, String, String)>> _search(String q) async {
    final rows = await searchStockItems(_api, q);
    for (final r in rows) {
      _found[docText(r['id'])] = r;
    }
    return [for (final r in rows) (docText(r['id']), docText(r['name']), stockItemSub(r))];
  }

  void _picked(_Line line, String id, String name) {
    setState(() {
      line.item = _found[id] ?? {'id': id, 'name': name};
      line.unit.text = docText(line.item!['unit']).isEmpty ? 'PCS' : docText(line.item!['unit']);
    });
  }

  num _qty(_Line l) {
    final n = num.tryParse(l.qty.text.trim());
    return n != null && n.isFinite ? n : 0;
  }

  Future<void> _save() async {
    setState(() => _submitted = true);
    final refusal = createRefusal(
      fromId: _from,
      toId: _to,
      lines: [for (final l in _lines) (itemId: l.id, qty: _qty(l))],
    );
    if (refusal != null) throw ApiException(refusal);
    final body = createBody(
      number: _number.text,
      date: _date,
      fromId: _from,
      toId: _to,
      notes: _notes.text,
      lines: [
        for (final l in _lines) (itemId: l.id, qty: _qty(l), unit: l.unit.text.trim().isEmpty ? 'PCS' : l.unit.text.trim(), notes: l.notes.text),
      ],
    );
    final reply = await _api.postJson('/api/stock-transfers', body);
    if (!mounted) return;
    final made = reply['transfer'];
    final number = made is Map ? docText(made['transfer_number']) : '';
    final eway = reply['eway_bill_missing'] == true ? ' An e-way bill is needed for this value; add it on the website.' : '';
    showKToast(context, '${number.isEmpty ? 'Transfer' : number} created.$eway', tone: KTone.positive);
    Navigator.of(context).pop(true);
  }

  Widget _hint(String text) => Padding(
        padding: const EdgeInsets.only(top: 6, left: 2),
        child: Text(text, style: AppText.caption.copyWith(color: AppColors.negative)),
      );

  Widget _lineCard(int index, _Line l) {
    final multiple = _lines.length > 1;
    final q = _qty(l);
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
          if (_submitted && l.item == null) _hint('Pick the item'),
          const SizedBox(height: AppSpace.md),
          KTextField(
            label: 'Quantity',
            controller: l.qty,
            hint: '0',
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            error: _submitted && q <= 0 ? 'Enter a quantity greater than zero' : null,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: AppSpace.md),
          KTextField(label: 'Unit', controller: l.unit, hint: 'PCS'),
          const SizedBox(height: AppSpace.md),
          KTextField(label: 'Item notes (optional)', controller: l.notes, hint: 'Optional item notes'),
        ],
      ),
    );
  }

  Widget _shell(Widget child) => Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [const KBackBar('New stock transfer'), Expanded(child: child)],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    if (_loading) return _shell(const KSpinner(padding: EdgeInsets.symmetric(vertical: 64)));
    if (_error != null) {
      return _shell(
        ListView(children: [
          if (_notInPlan)
            const KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')
          else
            KEmptyState(
              icon: LucideIcons.cloudOff,
              title: 'Could not load warehouses',
              body: _error,
              action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
            ),
        ]),
      );
    }
    final dirty = _lines.any((l) => l.item != null || l.qty.text.isNotEmpty) || _from.isNotEmpty || _to.isNotEmpty || _notes.text.isNotEmpty;
    return KFormScaffold(
      title: 'New stock transfer',
      saveLabel: 'Create transfer',
      onSave: _save,
      dirty: dirty,
      children: [
        KTextField(label: 'Transfer number', controller: _number, hint: 'TRF-YYYYMMDD-001'),
        KDateField(label: 'Transfer date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        KPickField<String>(
          label: 'From warehouse',
          value: _from.isEmpty ? null : _from,
          options: _options,
          onChanged: (v) => setState(() => _from = v),
        ),
        if (_submitted && _from.isEmpty) _hint('Select the source warehouse'),
        KPickField<String>(
          label: 'To warehouse',
          value: _to.isEmpty ? null : _to,
          options: _options,
          onChanged: (v) => setState(() => _to = v),
        ),
        if (_submitted && _to.isEmpty) _hint('Select the destination warehouse'),
        KTextField(label: 'Notes (optional)', controller: _notes, hint: 'Optional notes about this transfer', maxLines: 2),
        for (final (i, l) in _lines.indexed) _lineCard(i, l),
        KButton.secondary(
          label: 'Add another item',
          icon: LucideIcons.plus,
          onPressed: () => setState(() => _lines.add(_Line())),
        ),
      ],
    );
  }
}
