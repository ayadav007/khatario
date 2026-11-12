import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_list_screen.dart';
import '../docs/doc_logic.dart';
import '../sales/doc_action_sheets.dart';
import 'stock_logic.dart' show searchStockItems, stockItemSub;
import 'stock_misc_logic.dart';
import 'stock_misc_sheets.dart';

Future<List<(String, String, String)>> _searchItems(AppSession s, String q) async => [
      for (final r in await searchStockItems(s.api, q)) (docText(r['id']), docText(r['name']), stockItemSub(r)),
    ];

/// `app/(app)/manufacturing/page.tsx`: recipes (bills of materials) and production entries.
/// `GET /api/manufacturing/boms` `{ boms }`, `POST /api/manufacturing/boms`; `GET /api/manufacturing/production`
/// `{ entries }`, `POST /api/manufacturing/production`. Posting production takes the inputs out of stock and adds the
/// finished goods at the cost the server works out (the phone shows it, never computes it).
class ManufacturingScreen extends StatefulWidget {
  const ManufacturingScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ManufacturingScreen> createState() => _ManufacturingScreenState();
}

class _ManufacturingScreenState extends State<ManufacturingScreen> {
  String _tab = 'recipes';

  AppSession get _s => widget.session;

  Future<bool?> _newRecipe(BuildContext context) => Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => BomFormScreen(session: _s)));

  Future<bool?> _produce(BuildContext context, [Map<String, dynamic>? bom]) =>
      Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ProductionFormScreen(session: _s, bom: bom)));

  /// Tap a recipe: its lines, and Produce.
  Future<bool?> _openRecipe(BuildContext context, Map<String, dynamic> bom) async {
    final go = await showKSheet<bool>(
      context,
      title: bomTitle(bom),
      scrollable: true,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(bomBatchText(bom), style: AppText.body),
            const SizedBox(height: AppSpace.md),
            for (final (role, text) in bomLineRows(bom))
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpace.sm),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(width: 90, child: Text(role, style: AppText.caption)),
                    Expanded(child: Text(text, style: AppText.body)),
                  ],
                ),
              ),
            const SizedBox(height: AppSpace.md),
            if (bomIsActive(bom)) KButton(label: 'Produce', icon: LucideIcons.factory, onPressed: () => Navigator.of(ctx).pop(true)),
          ],
        ),
      ),
    );
    if (go != true || !context.mounted) return null;
    return _produce(context, bom);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Manufacturing'),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
              child: KSegmented<String>(
                value: _tab,
                options: const [('recipes', 'Recipes'), ('production', 'Production')],
                onChanged: (v) => setState(() => _tab = v),
              ),
            ),
            Expanded(
              child: _tab == 'recipes'
                  ? DocListScreen(
                      key: const ValueKey('recipes'),
                      session: _s,
                      embedded: true,
                      spec: DocListSpec(
                        title: 'Recipes',
                        href: '/manufacturing',
                        path: '/api/manufacturing/boms',
                        listKey: 'boms',
                        titleOf: bomTitle,
                        subtitleOf: bomSubtitle,
                        statusOf: (b) => bomIsActive(b) ? null : 'inactive',
                        searchKeys: const ['name', 'output_item_name'],
                        icon: LucideIcons.factory,
                        emptyTitle: 'No recipes yet',
                        emptyBody: 'A recipe says what goes in and what comes out of one batch.',
                        createLabel: 'New recipe',
                        onCreate: _newRecipe,
                        onOpen: _openRecipe,
                      ),
                    )
                  : DocListScreen(
                      key: const ValueKey('production'),
                      session: _s,
                      embedded: true,
                      spec: DocListSpec(
                        title: 'Production',
                        href: '/manufacturing',
                        path: '/api/manufacturing/production',
                        listKey: 'entries',
                        titleOf: productionTitle,
                        subtitleOf: productionSubtitle,
                        amountOf: productionCost,
                        searchKeys: const ['entry_number', 'output_item_name'],
                        icon: LucideIcons.packageCheck,
                        emptyTitle: 'Nothing produced yet',
                        emptyBody: 'Post production to turn inputs into finished goods.',
                        createLabel: 'Post production',
                        onCreate: (ctx) => _produce(ctx),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LineEdit {
  Map<String, dynamic>? item;
  String role = 'input';
  final qty = TextEditingController();
  final recovery = TextEditingController();

  String get id => item == null ? '' : docText(item!['id']);

  void dispose() {
    qty.dispose();
    recovery.dispose();
  }
}

/// "New bill of materials" (`POST /api/manufacturing/boms`): name, what it makes and per batch, and its lines.
/// Nothing moves in stock until production is posted.
class BomFormScreen extends StatefulWidget {
  const BomFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<BomFormScreen> createState() => _BomFormScreenState();
}

class _BomFormScreenState extends State<BomFormScreen> {
  final _name = TextEditingController();
  final _outQty = TextEditingController(text: '1');
  final _lines = <_LineEdit>[_LineEdit()];
  String _outId = '';
  String _outName = '';

  @override
  void dispose() {
    _name.dispose();
    _outQty.dispose();
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  List<BomLine> get _bomLines => [
        for (final l in _lines)
          (itemId: l.id, role: l.role, qty: num.tryParse(l.qty.text.trim()) ?? 0, recovery: num.tryParse(l.recovery.text.trim()) ?? 0),
      ];

  Future<void> _save() async {
    final outQty = num.tryParse(_outQty.text.trim()) ?? 0;
    final refusal = bomRefusal(name: _name.text, outputItemId: _outId, outputQty: outQty, lines: _bomLines);
    if (refusal != null) throw ApiException(refusal);
    final done = await guardedWrite(
      context,
      'bom-new',
      () => widget.session.api.postJson('/api/manufacturing/boms', bomBody(name: _name.text, outputItemId: _outId, outputQty: outQty, lines: _bomLines)),
      success: 'Bill of materials saved',
    );
    if (done == true && mounted) Navigator.of(context).pop(true);
  }

  Widget _lineCard(int i, _LineEdit l) {
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: Text('Line ${i + 1}', style: AppText.bodyStrong)),
              if (_lines.length > 1)
                KIconButton(
                  icon: LucideIcons.trash2,
                  tooltip: 'Remove line ${i + 1}',
                  onTap: () => setState(() => _lines.removeAt(i).dispose()),
                ),
            ],
          ),
          const SizedBox(height: AppSpace.sm),
          KAsyncPickField(
            key: ValueKey('line-$i-item'),
            label: 'Item',
            valueLabel: l.item == null ? null : docText(l.item!['name']),
            search: (q) => _searchItems(widget.session, q),
            onPicked: (id, name) => setState(() => l.item = {'id': id, 'name': name}),
          ),
          const SizedBox(height: AppSpace.md),
          KPickField<String>(key: ValueKey('line-$i-role'), label: 'Role', value: l.role, options: kBomRoles, onChanged: (v) => setState(() => l.role = v)),
          const SizedBox(height: AppSpace.md),
          KTextField(key: ValueKey('line-$i-qty'), label: 'Quantity per batch', controller: l.qty, hint: '0', keyboard: const TextInputType.numberWithOptions(decimal: true)),
          if (l.role != 'input') ...[
            const SizedBox(height: AppSpace.md),
            KTextField(
              key: ValueKey('line-$i-recovery'),
              label: 'Fetches (₹ each)',
              controller: l.recovery,
              hint: '0',
              keyboard: const TextInputType.numberWithOptions(decimal: true),
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'New recipe',
      saveLabel: 'Save recipe',
      onSave: _save,
      children: [
        KTextField(label: 'Name', controller: _name),
        KAsyncPickField(
          label: 'Makes',
          valueLabel: _outName.isEmpty ? null : _outName,
          search: (q) => _searchItems(widget.session, q),
          onPicked: (id, name) => setState(() {
            _outId = id;
            _outName = name;
          }),
        ),
        KTextField(label: 'Quantity per batch', controller: _outQty, keyboard: const TextInputType.numberWithOptions(decimal: true)),
        for (final (i, l) in _lines.indexed) _lineCard(i, l),
        KButton.secondary(label: 'Add line', icon: LucideIcons.plus, onPressed: () => setState(() => _lines.add(_LineEdit()))),
      ],
    );
  }
}

/// "Post production" (`POST /api/manufacturing/production`): pick a recipe, the batches, the date and the godown.
/// Asks first, naming the recipe and that stock moves, posts once and says what the server costed it at.
class ProductionFormScreen extends StatelessWidget {
  const ProductionFormScreen({super.key, required this.session, this.bom});

  final AppSession session;

  /// A recipe to start from (Produce on a recipe); null lets the user pick.
  final Map<String, dynamic>? bom;

  @override
  Widget build(BuildContext context) {
    return GodownGate(
      session: session,
      title: 'Post production',
      builder: (context, godowns) => _ProductionForm(session: session, godowns: godowns, bom: bom),
    );
  }
}

class _ProductionForm extends StatefulWidget {
  const _ProductionForm({required this.session, required this.godowns, required this.bom});

  final AppSession session;
  final List<(String, String)> godowns;
  final Map<String, dynamic>? bom;

  @override
  State<_ProductionForm> createState() => _ProductionFormState();
}

class _ProductionFormState extends State<_ProductionForm> {
  final _batches = TextEditingController(text: '1');
  List<Map<String, dynamic>> _boms = const [];
  String _bomId = '';
  String _godown = '';
  DateTime _date = dateOnly(DateTime.now());
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _bomId = widget.bom == null ? '' : docText(widget.bom!['id']);
    _load();
  }

  @override
  void dispose() {
    _batches.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final body = await widget.session.api.getJson('/api/manufacturing/boms');
      if (!mounted) return;
      setState(() {
        _boms = [for (final b in docRows(body, 'boms')) if (bomIsActive(b)) b];
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
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

  Map<String, dynamic>? get _chosen => _boms.where((b) => docText(b['id']) == _bomId).firstOrNull;

  Future<void> _save() async {
    final batches = num.tryParse(_batches.text.trim()) ?? 0;
    final refusal = productionRefusal(bomId: _bomId, batches: batches, needsGodown: widget.godowns.isNotEmpty, godownId: _godown);
    if (refusal != null) throw ApiException(refusal);
    final bom = _chosen;
    if (bom == null) throw ApiException('Choose a bill of materials');
    final ok = await askSheet(
      context,
      title: 'Post this production?',
      text: productionAskText(bom, batches),
      confirmLabel: 'Post production',
      cancelLabel: 'Not yet',
      danger: false,
    );
    if (!ok || !mounted) return;
    Map<String, dynamic> reply = const {};
    final done = await guardedWrite(
      context,
      'production-new',
      () async {
        reply = await widget.session.api.postJson(
          '/api/manufacturing/production',
          productionBody(
            bomId: _bomId,
            batches: batches,
            date: _date,
            warehouseId: _godown,
            branchId: widget.godowns.isEmpty ? (widget.session.defaultBranchId ?? '') : '',
          ),
        );
      },
    );
    if (done != true || !mounted) return;
    showKToast(context, productionDoneText(reply), tone: KTone.positive);
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _error != null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const KBackBar('Post production'),
              Expanded(
                child: _loading
                    ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
                    : ListView(children: [
                        KEmptyState(
                          icon: LucideIcons.cloudOff,
                          title: 'Could not load recipes',
                          body: _error,
                          action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
                        ),
                      ]),
              ),
            ],
          ),
        ),
      );
    }
    final chosen = _chosen;
    return KFormScaffold(
      title: 'Post production',
      saveLabel: 'Post production',
      onSave: _save,
      children: [
        KPickField<String>(
          label: 'Recipe',
          value: _bomId.isEmpty ? null : _bomId,
          options: [for (final b in _boms) (docText(b['id']), '${bomTitle(b)} → ${docText(b['output_item_name'])}')],
          searchable: true,
          onChanged: (v) => setState(() => _bomId = v),
        ),
        if (chosen != null) Text(bomBatchText(chosen), style: AppText.caption),
        KTextField(label: 'Batches', controller: _batches, keyboard: const TextInputType.numberWithOptions(decimal: true)),
        KDateField(label: 'Date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        if (widget.godowns.isNotEmpty)
          KPickField<String>(label: 'Godown', value: _godown.isEmpty ? null : _godown, options: widget.godowns, onChanged: (v) => setState(() => _godown = v)),
      ],
    );
  }
}
