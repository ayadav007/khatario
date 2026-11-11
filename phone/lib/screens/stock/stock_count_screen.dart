import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../items/barcode_capture_screen.dart';
import '../pages/website_page_screen.dart';
import '../sales/doc_action_sheets.dart';
import 'stock_count_logic.dart';

/// `app/(app)/stock-counts/[id]/page.tsx` on the phone: count a godown, then review and post the differences.
///
/// While counting, each item has a counted box (ours) and a box for other people's goods found; a scan adds one unit
/// or a whole box to the matching item. Counted quantities save as the user goes (`PATCH { action: 'count' }` after
/// [saveDelay] of quiet, or at once with Save counts), so a long count survives a crash. Finishing is its own
/// confirmed action (`submit`), then in review the differences get reasons (`reasons`) and the count is posted
/// (`post`) or cancelled (`cancel`). Every figure is the server's. Left on the website: the supplier bills on the way
/// and the CARO class table (one "Open on website" row).
class StockCountScreen extends StatefulWidget {
  const StockCountScreen({
    super.key,
    required this.session,
    required this.countId,
    this.scanBarcode,
    this.saveDelay = const Duration(milliseconds: 800),
  });

  final AppSession session;
  final String countId;

  /// Opens the camera and returns a code. Defaults to [BarcodeCaptureScreen]; tests pass their own.
  final Future<String?> Function(BuildContext context)? scanBarcode;
  final Duration saveDelay;

  @override
  State<StockCountScreen> createState() => _StockCountScreenState();
}

class _StockCountScreenState extends State<StockCountScreen> {
  Map<String, dynamic>? _data;
  Map<String, CountBarcode> _barcodes = const {};
  bool _barcodesLoaded = false;
  bool _loading = true;
  bool _notInPlan = false;
  String? _error;
  String? _busy;
  bool _changed = false;
  int _seq = 0;

  final _physical = <String, TextEditingController>{};
  final _others = <String, TextEditingController>{};
  final _units = <String, String>{};
  final _dirty = <String>{};
  final _reasonCode = <String, String>{};
  final _reasonNote = <String, TextEditingController>{};
  final _search = TextEditingController();
  String _lastScan = '';
  String _saveState = '';
  Timer? _timer;
  Future<bool>? _saving;
  bool _saveFailed = false;
  bool _barcodesFailed = false;

  /// What the save now in flight carries, per item (see [_signature]); empty when none is out.
  Map<String, String> _inFlightSigs = const {};

  KhatarioApi get _api => widget.session.api;
  String get _path => '/api/stock-counts/${widget.countId}';

  Map<String, dynamic> get _count => _data == null || _data!['count'] is! Map ? const {} : Map<String, dynamic>.from(_data!['count'] as Map);
  String get _status => docText(_count['status']);
  List<Map<String, dynamic>> get _lines => docRows(_data, 'lines');

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _timer?.cancel();
    // Leaving with edits not yet sent: send them, so a long count does not lose them. Entries a save already in
    // flight carries are left out (sent twice, a recount line would count as recounted); newer values go after it.
    final pending = _saveFailed ? null : _entriesBody(skipSigs: _inFlightSigs);
    if (pending != null) {
      final after = _saving ?? Future<bool>.value(true);
      unawaited(after.then((_) => _api.patchJson(_path, pending)).then((_) => null).catchError((Object _) => null));
    }
    for (final c in [..._physical.values, ..._others.values, ..._reasonNote.values, _search]) {
      c.dispose();
    }
    super.dispose();
  }

  void _rebuild(VoidCallback fn) => setState(fn);

  void _toast(String text, {KTone tone = KTone.neutral}) {
    if (mounted) showKToast(context, text, tone: tone);
  }

  Future<void> _load({bool spinner = true}) async {
    final seq = ++_seq;
    if (spinner) {
      setState(() {
        _loading = true;
        _error = null;
        _notInPlan = false;
      });
    }
    try {
      final body = await _api.getJson(_path);
      if (!mounted || seq != _seq) return;
      setState(() {
        _data = body;
        _loading = false;
        _error = null;
        _syncFields();
      });
      if (_status == 'counting' && !_barcodesLoaded && !_barcodesFailed) _loadBarcodes();
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _data != null) return _toast(e.message, tone: KTone.negative);
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN' || e.code == 'FEATURE_NOT_AVAILABLE';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _data != null) return _toast('Could not reach the server.', tone: KTone.negative);
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  /// `GET .../barcodes`: what each code adds. A failure only turns scanning off (every scan reads "not on this count").
  Future<void> _loadBarcodes() async {
    try {
      final body = await _api.getJson('$_path/barcodes');
      if (!mounted) return;
      setState(() {
        _barcodes = parseCountBarcodes(body);
        _barcodesLoaded = true;
        _barcodesFailed = false;
      });
    } catch (_) {
      if (mounted) setState(() => _barcodesFailed = true);
    }
  }

  TextEditingController _ctrl(Map<String, TextEditingController> m, String id) => m.putIfAbsent(id, () => TextEditingController());

  /// Boxes show what the server holds, except where the user has typed something not yet saved.
  void _syncFields() {
    for (final l in _lines) {
      final id = docText(l['item_id']);
      if (_dirty.contains(id)) continue;
      final phys = docNum(l['physical_qty']);
      _ctrl(_physical, id).text = countLineNeedsRecount(l) || phys == null ? '' : jsNumberString(phys);
      final others = docNum(l['third_party_qty']) ?? 0;
      _ctrl(_others, id).text = others > 0 ? jsNumberString(others) : '';
      _units.remove(id);
    }
    final diffs = countDifferences(_lines);
    final shortageById = {for (final l in diffs) docText(l['item_id']): (docNum(l['difference']) ?? 0) < 0};
    _reasonCode.removeWhere((id, _) => !shortageById.containsKey(id));
    for (final l in diffs) {
      final id = docText(l['item_id']);
      final saved = docText(l['reason_code']);
      final allowed = countReasonOptions(shortage: shortageById[id]!).map((o) => o.$1);
      _reasonCode.putIfAbsent(id, () => allowed.contains(saved) ? saved : 'STOCK_TAKE');
      final note = _ctrl(_reasonNote, id);
      if (note.text.isEmpty) note.text = docText(l['reason_notes']);
    }
  }

  void _edited(String id) {
    _dirty.add(id);
    _saveState = 'Unsaved changes';
    _timer?.cancel();
    _timer = Timer(widget.saveDelay, () => _save());
    setState(() {});
  }

  /// The count body for everything typed and not yet saved; null when there is nothing to send.
  Map<String, dynamic>? _entriesBody({Map<String, String> skipSigs = const {}}) {
    final entries = <({String itemId, num physical, num others, String? unit})>[];
    for (final l in _lines) {
      final id = docText(l['item_id']);
      if (!_dirty.contains(id)) continue;
      if (skipSigs[id] != null && skipSigs[id] == _signature(id)) continue;
      final text = _physical[id]?.text.trim() ?? '';
      final phys = text.isEmpty ? null : num.tryParse(text);
      if (phys == null || !phys.isFinite) continue;
      final others = num.tryParse(_others[id]?.text.trim() ?? '') ?? 0;
      final unit = _units[id];
      entries.add((itemId: id, physical: phys, others: others, unit: unit == null || unit.isEmpty ? null : unit));
    }
    return entries.isEmpty ? null : countEntriesBody(entries);
  }

  /// The first edited item whose counted box cannot be sent (cleared, or never filled in), or null. Such an edit is
  /// not saved, so finishing on it would take the old figure as counted.
  String? _unsendable() {
    for (final l in _lines) {
      final id = docText(l['item_id']);
      if (!_dirty.contains(id)) continue;
      final phys = num.tryParse(_physical[id]?.text.trim() ?? '');
      if (phys == null || !phys.isFinite) return docText(l['item_name']);
    }
    return null;
  }

  /// Saves typed quantities. False when the server refused them. [manual] is the Save counts button.
  Future<bool> _save({bool manual = false}) async {
    _timer?.cancel();
    while (_saving != null) {
      await _saving;
    }
    if (!mounted) return true;
    final body = _entriesBody();
    if (body == null) {
      if (manual) _toast('Enter at least one counted quantity', tone: KTone.negative);
      return true;
    }
    _inFlightSigs = {for (final e in body['entries'] as List) (e as Map)['item_id'] as String: _signature(e['item_id'] as String)};
    final run = _send(body, manual);
    _saving = run;
    try {
      return await run;
    } finally {
      _saving = null;
      _inFlightSigs = const {};
    }
  }

  String _signature(String id) {
    final p = num.tryParse(_physical[id]?.text.trim() ?? '');
    final o = num.tryParse(_others[id]?.text.trim() ?? '') ?? 0;
    final u = _units[id];
    return '$p|$o|${u == null || u.isEmpty ? '' : u}';
  }

  Future<bool> _send(Map<String, dynamic> body, bool manual) async {
    final sent = {for (final e in body['entries'] as List) (e as Map)['item_id'] as String: _signature(e['item_id'] as String)};
    setState(() => _saveState = 'Saving...');
    _saveFailed = false;
    try {
      final reply = await _api.patchJson(_path, body);
      if (!mounted) return true;
      _changed = true;
      sent.forEach((id, sig) {
        if (_signature(id) == sig) _dirty.remove(id);
      });
      final recount = reply['recount'] is List ? (reply['recount'] as List).length : 0;
      await _load(spinner: false);
      if (!mounted) return true;
      setState(() => _saveState = _dirty.isEmpty ? 'All counts saved' : 'Unsaved changes');
      if (recount > 0) {
        _toast(recountText(recount), tone: KTone.negative);
      } else if (manual) {
        _toast('Counts saved', tone: KTone.positive);
      }
      return true;
    } on ApiException catch (e) {
      if (!mounted) return false;
      if (countAlreadyChanged(e)) {
        _dirty.clear();
        _toast(kCountChangedText);
        await _load(spinner: false);
      } else {
        _toast(e.message, tone: KTone.negative);
      }
      _saveFailed = true;
      if (mounted) setState(() => _saveState = 'Not saved');
      return false;
    } catch (_) {
      _saveFailed = true;
      _toast('Could not reach the server. Try again.', tone: KTone.negative);
      if (mounted) setState(() => _saveState = 'Not saved');
      return false;
    }
  }

  /// One confirmed action at a time. A refusal is the server's words and nothing changes; an already-done one reloads.
  Future<void> _act(String key, Future<void> Function() body) async {
    if (_busy != null) return;
    setState(() => _busy = key);
    try {
      await body();
    } on ApiException catch (e) {
      if (countAlreadyChanged(e)) {
        _toast(kCountChangedText);
        _dirty.clear();
        await _load(spinner: false);
      } else {
        _toast(e.message, tone: KTone.negative);
      }
    } catch (_) {
      _toast('Could not reach the server. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  // ---- scanning ----

  Future<void> _scan() async {
    final code = await (widget.scanBarcode ?? BarcodeCaptureScreen.open)(context);
    if (code == null || !mounted) return;
    if (_barcodesFailed) {
      setState(() => _lastScan = '');
      _toast('Barcodes could not be loaded. Try again.', tone: KTone.negative);
      return;
    }
    final hit = _barcodes[code.trim()];
    if (hit == null) {
      setState(() => _lastScan = 'Not on this count: ${code.trim()}');
      return;
    }
    final line = _lines.where((l) => docText(l['item_id']) == hit.itemId).firstOrNull;
    final id = hit.itemId;
    final typed = _dirty.contains(id) && (_units[id] ?? '').isEmpty;
    final start = typed ? (num.tryParse(_physical[id]?.text.trim() ?? '') ?? 0) : (line == null ? 0 : countLineStartQty(line));
    _ctrl(_physical, id).text = jsNumberString(tallyAfterScan(start, hit.qty));
    _units.remove(id);
    _lastScan = '+ ${hit.label}';
    _edited(id);
  }

  // ---- actions ----

  Future<void> _finish() => _act('submit', () async {
        _timer?.cancel();
        // Until nothing typed is waiting: an edit made while a save was out goes in a save of its own, before asking.
        do {
          if (!await _save()) return;
          final bad = _unsendable();
          if (bad != null) {
            _toast('Enter a quantity for $bad or leave it as it was', tone: KTone.negative);
            return;
          }
        } while (mounted && (_entriesBody() != null || _saving != null));
        if (!mounted) return;
        final uncounted = countUncounted(_lines);
        if (!mounted) return;
        final ok = await askSheet(
          context,
          title: 'Finish counting?',
          text: finishCountText(uncounted),
          confirmLabel: 'Finish counting',
          cancelLabel: 'Keep counting',
          danger: false,
        );
        if (!ok || !mounted) return;
        await _api.patchJson(_path, submitCountBody(fillFromBooks: uncounted > 0));
        _changed = true;
        _toast('Counting closed; review the differences', tone: KTone.positive);
        await _load(spinner: false);
      });

  Future<void> _post() => _act('post', () async {
        final ok = await askSheet(
          context,
          title: 'Approve and post?',
          text: postCountText(countDifferences(_lines).length),
          confirmLabel: 'Approve and post',
          cancelLabel: 'Not yet',
          danger: false,
        );
        if (!ok || !mounted) return;
        await _api.patchJson(_path, postCountBody());
        _changed = true;
        _toast('Count posted', tone: KTone.positive);
        await _load(spinner: false);
      });

  Future<void> _cancel() => _act('cancel', () async {
        final ok = await askSheet(
          context,
          title: 'Cancel this count?',
          text: cancelCountText(),
          confirmLabel: 'Cancel count',
          cancelLabel: 'Keep count',
        );
        if (!ok || !mounted) return;
        _timer?.cancel();
        _dirty.clear();
        await _api.patchJson(_path, cancelCountBody());
        _changed = true;
        _toast('Count cancelled', tone: KTone.positive);
        await _load(spinner: false);
      });

  Future<void> _saveReasons() => _act('reasons', () async {
        final list = [
          for (final l in countDifferences(_lines))
            (itemId: docText(l['item_id']), code: _reasonCode[docText(l['item_id'])] ?? 'STOCK_TAKE', notes: _reasonNote[docText(l['item_id'])]?.text ?? ''),
        ];
        await _api.patchJson(_path, reasonsBody(list));
        _toast('Reasons saved', tone: KTone.positive);
        await _load(spinner: false);
      });

  Future<void> _more() async {
    final cancel = await showKSheet<bool>(
      context,
      title: 'Stock count',
      builder: (ctx) => KSheetAction(icon: LucideIcons.circleX, label: 'Cancel count', danger: true, onTap: () => Navigator.of(ctx).pop(true)),
    );
    if (cancel == true && mounted) await _cancel();
  }

  // ---- build ----

  @override
  Widget build(BuildContext context) {
    final open = _status == 'counting' || _status == 'review';
    final number = docText(_count['count_number']);
    return PopScope(
      canPop: !_changed,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(true);
      },
      child: Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KBackBar(
                number.isEmpty ? 'Stock count' : number,
                trailing: open
                    ? Tooltip(message: 'More', child: KIconButton(icon: LucideIcons.ellipsisVertical, tooltip: 'More', onTap: _more))
                    : null,
              ),
              Expanded(child: _body()),
              if (_data != null && _status == 'counting')
                KBottomBar(children: [
                  Expanded(child: KButton.secondary(label: 'Save counts', onPressed: _busy == null ? () => _save(manual: true) : null)),
                  Expanded(child: KButton(label: 'Finish counting', loading: _busy == 'submit', onPressed: _busy == null ? _finish : null)),
                ]),
              if (_data != null && _status == 'review')
                KBottomBar(children: [
                  Expanded(child: KButton(label: 'Approve and post', loading: _busy == 'post', onPressed: _busy == null ? _post : null)),
                ]),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_data == null || _error != null && _data == null) {
      return ListView(children: [
        if (_notInPlan)
          const KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')
        else
          KEmptyState(
            icon: LucideIcons.cloudOff,
            title: 'Could not load this count',
            body: _error,
            action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
          ),
      ]);
    }
    const pad = EdgeInsets.symmetric(horizontal: AppSpace.gutter);
    final counting = _status == 'counting';
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: AppSpace.xl),
        children: [
          Padding(padding: pad, child: _details()),
          if (docText(_count['gst_place_type']) == 'not_registered' && docText(_count['warehouse_id']).isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
              child: Text(
                'This godown is marked as not on the GST registration. Stock kept at an undeclared place can be seized (s.35); add it as an additional place of business.',
                style: AppText.caption.copyWith(color: AppColors.negative),
              ),
            ),
          const SizedBox(height: AppSpace.lg),
          if (counting) ..._countingBody(pad) else ..._reviewBody(pad),
        ],
      ),
    );
  }

  Widget _details() {
    final date = docDate(_count['count_date']);
    final godown = docText(_count['warehouse_name']).isNotEmpty ? docText(_count['warehouse_name']) : docText(_count['branch_name']);
    final frozen = _count['freeze_stock'] == true && (_status == 'counting' || _status == 'review');
    return KInfoCard(title: 'Details', rows: [
      if (godown.isNotEmpty) ('Godown', godown),
      if (date != null) ('Count date', ddMMMyyyy(date)),
      ('Status', countStatusLabel(_status)),
      if (frozen) ('Stock', 'Frozen while counting'),
    ]);
  }
}

String _sentence(String code) {
  final w = code.replaceAll('_', ' ').trim();
  return w.isEmpty ? '' : w[0].toUpperCase() + w.substring(1);
}

extension _CountSections on _StockCountScreenState {
  List<Widget> _countingBody(EdgeInsets pad) {
    final q = _search.text.trim().toLowerCase();
    final shown = [
      for (final l in _lines)
        if (q.isEmpty || docText(l['item_name']).toLowerCase().contains(q) || docText(l['item_code']).toLowerCase().contains(q)) l,
    ];
    return [
      Padding(
        padding: pad,
        child: Text(
          'Count what is on the shelf and belongs to us. Goods held here for others (customer goods in for repair) go in the second box.'
          '${_data!['blind'] == true ? ' Book quantities are hidden until counting is finished.' : ''}',
          style: AppText.caption,
        ),
      ),
      const SizedBox(height: AppSpace.md),
      Padding(padding: pad, child: KSearchField(controller: _search, hint: 'Search item or code', onChanged: (_) => _rebuild(() {}))),
      const SizedBox(height: AppSpace.md),
      Padding(
        padding: pad,
        child: KButton.secondary(label: 'Scan barcode', icon: LucideIcons.scanBarcode, onPressed: _busy == null ? _scan : null),
      ),
      if (_barcodesFailed)
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0),
          child: Row(children: [
            Expanded(child: Text('Barcodes could not be loaded', style: AppText.body.copyWith(color: AppColors.negative))),
            KTextButton(label: 'Try again', onTap: _loadBarcodes),
          ]),
        ),
      if (_lastScan.isNotEmpty)
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0),
          child: Text(_lastScan, style: AppText.body.copyWith(color: _lastScan.startsWith('+') ? AppColors.positive : AppColors.negative)),
        ),
      Padding(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.sm),
        child: Text(_saveState.isEmpty ? 'Counts save as you go.' : _saveState, style: AppText.caption),
      ),
      if (shown.isEmpty) const KEmptyState(icon: LucideIcons.package, title: 'No items match'),
      for (final l in shown) _countCard(l),
    ];
  }

  Widget _countCard(Map<String, dynamic> l) {
    final id = docText(l['item_id']);
    final again = countLineNeedsRecount(l);
    final state = countLineState(l);
    final base = docText(l['unit']);
    final alts = [
      for (final u in docRows(_data, 'units'))
        if (docText(u['item_id']) == id) u,
    ];
    return KCard(
      margin: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(docText(l['item_name']), style: AppText.bodyStrong),
                    if (docText(l['item_code']).isNotEmpty) Text(docText(l['item_code']), style: AppText.caption),
                  ],
                ),
              ),
              Text(
                state,
                style: AppText.small.copyWith(color: again ? AppColors.due : (state == 'Not counted' ? AppColors.ink3 : AppColors.positive)),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.md),
          KTextField(
            key: ValueKey('counted-$id'),
            label: base.isEmpty ? 'Counted (ours)' : 'Counted (ours, $base)',
            controller: _ctrl(_physical, id),
            enabled: _busy == null,
            hint: '0',
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => _edited(id),
          ),
          if (alts.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            KPickField<String>(
              label: 'Unit',
              value: _units[id] ?? '',
              options: [
                ('', base.isEmpty ? 'Unit' : base),
                for (final u in alts) (docText(u['unit']), '${docText(u['unit'])} (${enIn(docNum(u['factor_to_base']) ?? 0)} $base)'),
              ],
              onChanged: (v) {
                _units[id] = v;
                _edited(id);
              },
            ),
          ],
          const SizedBox(height: AppSpace.md),
          KTextField(
            key: ValueKey('others-$id'),
            label: "Others' goods here",
            controller: _ctrl(_others, id),
            enabled: _busy == null,
            hint: '0',
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => _edited(id),
          ),
        ],
      ),
    );
  }

  List<Widget> _reviewBody(EdgeInsets pad) {
    final review = _status == 'review';
    final summary = _data!['summary'] is Map ? Map<String, dynamic>.from(_data!['summary'] as Map) : <String, dynamic>{};
    final diffs = countDifferences(_lines);
    final others = docRows(_data, 'with_third_party');
    final transit = docRows(_data, 'in_transit');
    return [
      Padding(padding: pad, child: KInfoCard(title: 'Summary', rows: countSummaryRows(summary))),
      Padding(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0),
        child: Text(countSummaryNote(summary), style: AppText.caption),
      ),
      const SizedBox(height: AppSpace.lg),
      Padding(padding: pad, child: KSectionHeader('Differences (${diffs.length})')),
      if (diffs.isEmpty) Padding(padding: pad, child: Text('The count matches the books.', style: AppText.body.copyWith(color: AppColors.ink2))),
      for (final l in diffs) _diffCard(l, review),
      if (review && diffs.isNotEmpty)
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0),
          child: KButton.secondary(label: 'Save reasons', loading: _busy == 'reasons', onPressed: _busy == null ? _saveReasons : null),
        ),
      if (others.isNotEmpty) ...[
        const SizedBox(height: AppSpace.lg),
        Padding(padding: pad, child: KSectionHeader('Held by others (${others.length})')),
        KCard(
          margin: pad,
          child: KDivided(children: [
            for (final r in others)
              KListRow(
                title: docText(r['item_name']),
                subtitle: [
                  docText(r['party_name']),
                  _sentence(docText(r['purpose'])),
                  docText(r['challan_number']),
                  '${(docNum(r['days_out']) ?? 0).toInt()} days out${r['overdue'] == true ? ' (overdue)' : ''}',
                ].where((p) => p.isNotEmpty).join(' · '),
                trailing: Text(enIn(docNum(r['qty']) ?? 0), style: AppText.bodyStrong),
              ),
          ]),
        ),
      ],
      if (transit.isNotEmpty) ...[
        const SizedBox(height: AppSpace.lg),
        Padding(padding: pad, child: KSectionHeader('In transit (${transit.length})')),
        KCard(
          margin: pad,
          child: KDivided(children: [
            for (final r in transit)
              KListRow(
                title: docText(r['item_name']),
                subtitle: [docText(r['transfer_number']), docText(r['to_warehouse_name'])].where((p) => p.isNotEmpty).join(' · '),
                trailing: Text(enIn(docNum(r['qty']) ?? 0), style: AppText.bodyStrong),
              ),
          ]),
        ),
      ],
      const SizedBox(height: AppSpace.lg),
      KCard(
        margin: pad,
        child: KListRow(
          title: 'Open on website',
          subtitle: 'Supplier bills on the way, and the class table for the auditor',
          leading: const Icon(LucideIcons.globe, size: 20, color: AppColors.ink2),
          onTap: () => openWebsiteInApp(context, widget.session, '/stock-counts/${widget.countId}', 'Stock count'),
        ),
      ),
    ];
  }

  Widget _diffCard(Map<String, dynamic> l, bool review) {
    final id = docText(l['item_id']);
    final shortage = (docNum(l['difference']) ?? 0) < 0;
    final options = countReasonOptions(shortage: shortage);
    final needs = l['needs_reason'] == true;
    return KCard(
      margin: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: Text(docText(l['item_name']), style: AppText.bodyStrong)),
              Text(countDiffText(l), style: AppText.bodyStrong.copyWith(color: shortage ? AppColors.negative : AppColors.positive)),
            ],
          ),
          Text(countDiffSubtitle(l), style: AppText.caption),
          if (docNum(l['first_count_qty']) != null && l['recounted'] == true) Text('First count ${enIn(docNum(l['first_count_qty'])!)}', style: AppText.caption),
          const SizedBox(height: AppSpace.md),
          if (review) ...[
            KPickField<String>(
              label: 'Reason',
              value: _reasonCode[id] ?? 'STOCK_TAKE',
              options: options,
              onChanged: (v) => _rebuild(() => _reasonCode[id] = v),
            ),
            const SizedBox(height: AppSpace.md),
            KTextField(
              key: ValueKey('note-$id'),
              label: 'Note',
              hint: needs ? 'Note required for a large difference' : null,
              controller: _ctrl(_reasonNote, id),
            ),
          ] else
            Text(
              '${countReasonLabel(docText(l['reason_code']))}${docText(l['reason_notes']).isEmpty ? '' : ': ${docText(l['reason_notes'])}'}',
              style: AppText.body,
            ),
        ],
      ),
    );
  }
}
