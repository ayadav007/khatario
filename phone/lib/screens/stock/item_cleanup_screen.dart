import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../pages/website_page_screen.dart';
import 'price_list_screen.dart' show PricingFailure;
import 'pricing_logic.dart';

/// Website `/items/cleanup` ("Item units and duplicates"): fold items entered twice into one, and
/// set the alternate units (BOX = 12 PCS) an item can be counted and sold in.
class ItemCleanupScreen extends StatefulWidget {
  const ItemCleanupScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ItemCleanupScreen> createState() => _ItemCleanupScreenState();
}

/// One duplicate chosen to be merged away, with the server's preview of what the merge would do.
class _Dup {
  _Dup(this.id, this.name);

  final String id;
  final String name;
  bool loading = true;
  MergePreview? preview;
  String? error;

  bool get ready => preview != null && !preview!.blocked;
}

/// One alternate unit being edited.
class _UnitRow {
  _UnitRow(UnitDraft d)
      : unit = TextEditingController(text: d.unit),
        factor = TextEditingController(text: d.factor),
        price = TextEditingController(text: d.price),
        barcode = TextEditingController(text: d.barcode);

  final TextEditingController unit;
  final TextEditingController factor;
  final TextEditingController price;
  final TextEditingController barcode;

  UnitDraft get draft => UnitDraft(unit: unit.text, factor: factor.text, price: price.text, barcode: barcode.text);

  void dispose() {
    unit.dispose();
    factor.dispose();
    price.dispose();
    barcode.dispose();
  }
}

class _ItemCleanupScreenState extends State<ItemCleanupScreen> {
  String _tab = 'merge';

  // Merge
  String? _keepId;
  String? _keepName;
  final List<_Dup> _dups = [];
  bool _merging = false;

  // Units
  String? _unitItemId;
  String? _unitItemName;
  String _baseUnit = '';
  final List<_UnitRow> _unitRows = [];
  bool _unitsLoading = false;
  String? _unitsError;
  bool _unitsNotInPlan = false;
  bool _savingUnits = false;
  int _unitsTicket = 0;

  @override
  void dispose() {
    for (final r in _unitRows) {
      r.dispose();
    }
    super.dispose();
  }

  // ---------------------------------------------------------------------------------------------
  // Merge
  // ---------------------------------------------------------------------------------------------

  Future<void> _loadPreview(_Dup dup) async {
    final keep = _keepId;
    if (keep == null) return;
    setState(() {
      dup.loading = true;
      dup.error = null;
      dup.preview = null;
    });
    try {
      final body = await widget.session.api.getJson(mergePreviewPath(dup.id, keep));
      if (!mounted || keep != _keepId) return;
      setState(() {
        dup.preview = mergePreview(body);
        dup.loading = false;
      });
    } catch (e) {
      if (!mounted || keep != _keepId) return;
      setState(() {
        dup.error = failureOf(e).message;
        dup.loading = false;
      });
    }
  }

  void _pickKeep(String id, String name) {
    setState(() {
      _keepId = id;
      _keepName = name;
      _dups.removeWhere((d) => d.id == id);
    });
    for (final d in List.of(_dups)) {
      _loadPreview(d);
    }
  }

  void _addDup(String id, String name) {
    if (id == _keepId) {
      showKToast(context, 'Choose a different item from the one that stays', tone: KTone.negative);
      return;
    }
    if (_dups.any((d) => d.id == id)) return;
    final dup = _Dup(id, name);
    setState(() => _dups.add(dup));
    _loadPreview(dup);
  }

  bool get _canMerge => !_merging && _keepId != null && _dups.isNotEmpty && _dups.every((d) => d.ready);

  Future<void> _confirmMerge() async {
    final keepName = _keepName ?? '';
    final count = _dups.length;
    final what = count == 1 ? '1 item' : '$count items';
    final go = await showKSheet<bool>(
      context,
      title: 'Merge $what into "$keepName"?',
      scrollable: true,
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: Text(mergeConfirmText(keepName, count), style: AppText.body.copyWith(color: AppColors.ink2)),
          ),
          for (final d in _dups)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 2, 20, 2),
              child: Text('${d.name} (removed)', style: AppText.bodyStrong),
            ),
          const SizedBox(height: AppSpace.sm),
          KSheetAction(icon: LucideIcons.gitMerge, label: 'Merge $what', danger: true, onTap: () => Navigator.of(ctx).pop(true)),
          KSheetAction(icon: LucideIcons.x, label: 'Cancel', onTap: () => Navigator.of(ctx).pop(false)),
        ],
      ),
    );
    if (go == true && mounted) await _merge();
  }

  Future<void> _merge() async {
    final keepId = _keepId;
    if (keepId == null || _merging) return;
    final keepName = _keepName ?? '';
    final bodies = mergeBody(keepId, [for (final d in _dups) d.id]);
    if (bodies.isEmpty) return;
    setState(() => _merging = true);
    var done = 0;
    String? refused;
    String? keptAs;
    for (final body in bodies) {
      try {
        final reply = await widget.session.api.postJson('/api/items/merge', body);
        done++;
        final name = docText(readPath(reply, 'target.name'));
        if (name.isNotEmpty) keptAs = name;
        if (!mounted) return;
        setState(() => _dups.removeWhere((d) => d.id == body['source_item_id']));
      } catch (e) {
        refused = failureOf(e).message;
        break;
      }
    }
    if (!mounted) return;
    setState(() => _merging = false);
    if (refused != null) {
      showKToast(context, refused, tone: KTone.negative);
    } else {
      showKToast(context, 'Merged into ${keptAs ?? keepName}');
    }
    if (done > 0 && refused != null) {
      for (final d in List.of(_dups)) {
        _loadPreview(d);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Alternate units
  // ---------------------------------------------------------------------------------------------

  void _clearUnitRows() {
    for (final r in _unitRows) {
      r.dispose();
    }
    _unitRows.clear();
  }

  Future<void> _pickUnitItem(String id, String name) async {
    setState(() {
      _unitItemId = id;
      _unitItemName = name;
    });
    await _loadUnits();
  }

  Future<void> _loadUnits() async {
    final id = _unitItemId;
    if (id == null) return;
    final ticket = ++_unitsTicket;
    setState(() {
      _unitsLoading = true;
      _unitsError = null;
      _unitsNotInPlan = false;
    });
    try {
      final enc = Uri.encodeComponent(id);
      final api = widget.session.api;
      final results = await Future.wait([
        api.getJson('/api/items/units?ids=$enc'),
        api.getJson('/api/items/$enc/units'),
      ]);
      if (!mounted || ticket != _unitsTicket) return;
      setState(() {
        _baseUnit = baseUnitOf(results[0], id);
        _clearUnitRows();
        _unitRows.addAll(unitDrafts(results[1]).map(_UnitRow.new));
        _unitsLoading = false;
      });
    } catch (e) {
      if (!mounted || ticket != _unitsTicket) return;
      final fail = failureOf(e);
      setState(() {
        _unitsError = fail.message;
        _unitsNotInPlan = fail.notInPlan;
        _unitsLoading = false;
      });
    }
  }

  Future<void> _saveUnits() async {
    final id = _unitItemId;
    if (id == null || _savingUnits) return;
    setState(() => _savingUnits = true);
    try {
      await widget.session.api.putJson('/api/items/${Uri.encodeComponent(id)}/units', unitsBody([for (final r in _unitRows) r.draft]));
      if (mounted) showKToast(context, 'Units saved');
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not save the units. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _savingUnits = false);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final merge = _tab == 'merge';
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(
              'Units & Duplicates',
              trailing: KIconButton(
                icon: LucideIcons.globe,
                tooltip: 'Open on website',
                onTap: () => openWebsiteInApp(context, widget.session, '/items/cleanup', 'Units & Duplicates'),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
              child: KSegmented<String>(
                value: _tab,
                options: const [('merge', 'Merge duplicates'), ('units', 'Alternate units')],
                onChanged: (v) => setState(() => _tab = v),
              ),
            ),
            Expanded(
              child: ListView(
                keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                children: merge ? _mergeBody() : _unitsBody(),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: merge
          ? KBottomBar(children: [
              Expanded(
                child: KButton(
                  label: 'Merge',
                  loading: _merging,
                  onPressed: _canMerge ? _confirmMerge : null,
                ),
              ),
            ])
          : (_unitItemId != null && _unitsError == null && !_unitsLoading)
              ? KBottomBar(children: [
                  Expanded(
                    child: KButton.secondary(
                      label: 'Add unit',
                      onPressed: _savingUnits ? null : () => setState(() => _unitRows.add(_UnitRow(const UnitDraft()))),
                    ),
                  ),
                  const SizedBox(width: AppSpace.sm),
                  Expanded(child: KButton(label: 'Save units', loading: _savingUnits, onPressed: _savingUnits ? null : _saveUnits)),
                ])
              : null,
    );
  }

  List<Widget> _mergeBody() {
    return [
      Text(
        'The same goods under two names show a shortage on one and an excess on the other. Merging moves every document and stock entry of the duplicate to the item that stays.',
        style: AppText.caption,
      ),
      const SizedBox(height: AppSpace.md),
      KAsyncPickField(
        label: 'Item that stays',
        valueLabel: _keepName,
        search: (q) => searchItems(widget.session.api, q),
        onPicked: _pickKeep,
      ),
      const SizedBox(height: AppSpace.md),
      KAsyncPickField(
        label: 'Duplicate (removed)',
        valueLabel: null,
        search: (q) => searchItems(widget.session.api, q),
        onPicked: _addDup,
      ),
      const SizedBox(height: AppSpace.md),
      if (_dups.isNotEmpty) KCard(child: KDivided(indent: 0, children: [for (final d in _dups) _dupRow(d)])),
    ];
  }

  Widget _dupRow(_Dup d) {
    final p = d.preview;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 4, 10),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(d.name, style: AppText.bodyStrong),
            const SizedBox(height: 2),
            if (_keepId == null)
              Text('Choose the item that stays', style: AppText.caption)
            else if (d.loading)
              Text('Checking what would move…', style: AppText.caption)
            else if (d.error != null) ...[
              Text(d.error!, style: AppText.caption.copyWith(color: AppColors.negative)),
              KTextButton(label: 'Try again', onTap: () => _loadPreview(d)),
            ] else if (p != null && p.blocked)
              for (final problem in p.problems) Text(problem, style: AppText.caption.copyWith(color: AppColors.negative))
            else if (p != null) ...[
              if (p.moves.isEmpty)
                Text('Nothing references this item.', style: AppText.caption)
              else ...[
                Text('Moves:', style: AppText.caption),
                for (final m in p.moves) Text(m, style: AppText.caption),
              ],
            ],
          ]),
        ),
        KIconButton(
          icon: LucideIcons.x,
          tooltip: 'Remove ${d.name}',
          onTap: _merging ? () {} : () => setState(() => _dups.remove(d)),
        ),
      ]),
    );
  }

  List<Widget> _unitsBody() {
    return [
      Text(
        'Stock stays in the item\'s own unit. A bill can sell in any of these (stock goes down by the whole box), a stock count can be entered in them, and a box barcode scanned at the counter adds the whole box. Leave the price empty to charge the item\'s price × the box size.',
        style: AppText.caption,
      ),
      const SizedBox(height: AppSpace.md),
      KAsyncPickField(
        label: 'Item',
        valueLabel: _unitItemName,
        search: (q) => searchItems(widget.session.api, q),
        onPicked: (id, name) => _pickUnitItem(id, name),
      ),
      const SizedBox(height: AppSpace.md),
      if (_unitItemId != null) ..._unitRowsBody(),
    ];
  }

  List<Widget> _unitRowsBody() {
    if (_unitsLoading) return const [KSpinner(padding: EdgeInsets.symmetric(vertical: 40))];
    if (_unitsError != null) {
      return [PricingFailure(title: 'Could not load the units', message: _unitsError!, notInPlan: _unitsNotInPlan, onRetry: _loadUnits)];
    }
    if (_unitRows.isEmpty) {
      return const [KEmptyState(icon: LucideIcons.package, title: 'No alternate units', body: 'Tap Add unit to count this item in boxes or bags.')];
    }
    return [
      for (final r in _unitRows) ...[
        KCard(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            KTextField(label: 'Unit', controller: r.unit, hint: 'e.g. BOX', caps: true),
            const SizedBox(height: AppSpace.md),
            KTextField(
              label: _baseUnit.isEmpty ? 'Holds (in the item\'s unit)' : 'Holds ($_baseUnit)',
              controller: r.factor,
              keyboard: const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: AppSpace.md),
            KAmountField(label: 'Price of one (optional)', controller: r.price),
            const SizedBox(height: AppSpace.md),
            KTextField(label: 'Box barcode (optional)', controller: r.barcode),
            Align(
              alignment: Alignment.centerRight,
              child: KTextButton(
                label: 'Remove',
                color: AppColors.negative,
                onTap: _savingUnits
                    ? null
                    : () {
                        setState(() => _unitRows.remove(r));
                        // The row is still drawn this frame, so its controllers go after it.
                        WidgetsBinding.instance.addPostFrameCallback((_) => r.dispose());
                      },
              ),
            ),
          ]),
        ),
        const SizedBox(height: AppSpace.md),
      ],
    ];
  }
}
