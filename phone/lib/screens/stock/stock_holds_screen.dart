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

/// `app/(app)/stock-holds/page.tsx`: stock in the godown that cannot be sold (our holds, and other people's goods kept
/// here). Two lists: `GET /api/stock-holds` `{ holds }` and `GET /api/inward-custody` `{ goods }`. A hold is added
/// (`POST /api/stock-holds`), released or written off (`POST /api/stock-holds/[id]`); others' goods are recorded
/// (`POST /api/inward-custody`) and handed back (`PATCH /api/inward-custody/[id]`). Each write asks first, naming what
/// changes, posts once and reloads.
class StockHoldsScreen extends StatefulWidget {
  const StockHoldsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<StockHoldsScreen> createState() => _StockHoldsScreenState();
}

class _StockHoldsScreenState extends State<StockHoldsScreen> {
  String _tab = 'holds';

  AppSession get _s => widget.session;

  Future<bool?> _addHold(BuildContext context) => Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => StockHoldFormScreen(session: _s)));

  Future<bool?> _addGoods(BuildContext context) => Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => OthersGoodsFormScreen(session: _s)));

  /// Tap a hold: release it back to saleable stock, or write some off.
  Future<bool?> _settleHold(BuildContext context, Map<String, dynamic> hold) async {
    final kind = await showKSheet<String>(
      context,
      title: holdTitle(hold),
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KSheetAction(icon: LucideIcons.packageCheck, label: 'Release to saleable stock', onTap: () => Navigator.of(ctx).pop('release')),
          KSheetAction(icon: LucideIcons.trash2, label: 'Write off', danger: true, onTap: () => Navigator.of(ctx).pop('write_off')),
        ],
      ),
    );
    if (kind == null || !context.mounted) return null;
    final release = kind == 'release';
    final answer = await askValueSheet(
      context,
      title: release ? 'Release how many?' : 'Write off how many?',
      label: 'Quantity (${_heldText(hold)} held)',
      initial: _heldText(hold),
      confirmLabel: 'Continue',
      pickLabel: release ? null : 'Reason',
      pickOptions: kWriteOffReasons,
      pickInitial: 'DAMAGE',
    );
    if (answer == null || !context.mounted) return null;
    final qty = positiveQty(answer.value);
    if (qty == null) {
      showKToast(context, 'Enter a quantity more than zero', tone: KTone.negative);
      return null;
    }
    final reasonLabel = kWriteOffReasons.firstWhere((r) => r.$1 == answer.pick, orElse: () => ('DAMAGE', 'Damaged')).$2;
    final ok = await askSheet(
      context,
      title: release ? 'Release this stock?' : 'Write off this stock?',
      text: release ? releaseText(hold, qty) : writeOffText(hold, qty, reasonLabel),
      confirmLabel: release ? 'Release' : 'Write off',
      cancelLabel: 'Not yet',
      danger: !release,
    );
    if (!ok || !context.mounted) return null;
    final now = dateOnly(DateTime.now());
    return guardedWrite(
      context,
      'hold-${holdId(hold)}',
      () => _s.api.postJson(
        '/api/stock-holds/${holdId(hold)}',
        release ? settleBody(date: now, release: qty) : settleBody(date: now, writeOff: qty, reason: answer.pick),
      ),
      success: release ? 'Released to saleable stock' : 'Written off',
      alreadyChanged: holdAlreadyChanged,
      alreadyText: kHoldChangedText,
    );
  }

  /// Tap an entry of others' goods: hand some back to their owner.
  Future<bool?> _handBack(BuildContext context, Map<String, dynamic> goods) async {
    final id = docText(goods['id']);
    final answer = await askValueSheet(
      context,
      title: 'Handed back',
      label: 'How many went back to ${docText(goods['owner_name'])}?',
      initial: jsNumberString(docNum(goods['qty']) ?? 0),
      confirmLabel: 'Continue',
    );
    if (answer == null || !context.mounted) return null;
    final qty = positiveQty(answer.value);
    if (qty == null) {
      showKToast(context, 'Enter a quantity more than zero', tone: KTone.negative);
      return null;
    }
    final ok = await askSheet(
      context,
      title: 'Hand these goods back?',
      text: returnText(goods, qty),
      confirmLabel: 'Hand back',
      cancelLabel: 'Not yet',
      danger: false,
    );
    if (!ok || !context.mounted) return null;
    return guardedWrite(
      context,
      'goods-$id',
      () => _s.api.patchJson('/api/inward-custody/$id', returnBody(qty, dateOnly(DateTime.now()))),
      success: 'Handed back',
      alreadyChanged: holdAlreadyChanged,
      alreadyText: kHoldChangedText,
    );
  }

  String _heldText(Map<String, dynamic> h) => jsNumberString(docNum(h['qty']) ?? 0);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Held goods'),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
              child: KSegmented<String>(
                value: _tab,
                options: const [('holds', 'Our stock on hold'), ('others', "Others' goods")],
                onChanged: (v) => setState(() => _tab = v),
              ),
            ),
            Expanded(
              child: _tab == 'holds'
                  ? DocListScreen(
                      key: const ValueKey('holds'),
                      session: _s,
                      embedded: true,
                      spec: DocListSpec(
                        title: 'Held stock',
                        href: '/stock-holds',
                        path: '/api/stock-holds',
                        listKey: 'holds',
                        titleOf: holdTitle,
                        subtitleOf: holdSubtitle,
                        searchKeys: const ['item_name', 'hold_number', 'warehouse_name'],
                        icon: LucideIcons.lock,
                        emptyTitle: 'Nothing is on hold',
                        emptyBody: 'Held stock cannot be sold until released, but a stock count still expects it on the shelf.',
                        createLabel: 'Put on hold',
                        onCreate: _addHold,
                        onOpen: _settleHold,
                      ),
                    )
                  : DocListScreen(
                      key: const ValueKey('others'),
                      session: _s,
                      embedded: true,
                      spec: DocListSpec(
                        title: "Others' goods",
                        href: '/stock-holds',
                        path: '/api/inward-custody',
                        listKey: 'goods',
                        titleOf: othersTitle,
                        subtitleOf: othersSubtitle,
                        searchKeys: const ['description', 'owner_name', 'warehouse_name'],
                        icon: LucideIcons.packageOpen,
                        emptyTitle: "No one else's goods are here",
                        emptyBody: 'Never our stock. A stock count compares what it finds with this list and leaves them out.',
                        createLabel: 'Record goods',
                        onCreate: _addGoods,
                        onOpen: _handBack,
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// "Put on hold" (`POST /api/stock-holds`): takes the quantity out of saleable stock until it is released.
class StockHoldFormScreen extends StatefulWidget {
  const StockHoldFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<StockHoldFormScreen> createState() => _StockHoldFormScreenState();
}

class _StockHoldFormScreenState extends State<StockHoldFormScreen> {
  final _qty = TextEditingController();
  final _reference = TextEditingController();
  String _itemId = '';
  String _itemName = '';
  String _purpose = 'qc_hold';
  String _godown = '';
  DateTime _date = dateOnly(DateTime.now());

  @override
  void dispose() {
    _qty.dispose();
    _reference.dispose();
    super.dispose();
  }

  Future<void> _save(List<(String, String)> godowns) async {
    final qty = num.tryParse(_qty.text.trim()) ?? 0;
    final refusal = holdRefusal(itemId: _itemId, qty: qty, needsGodown: godowns.isNotEmpty, godownId: _godown);
    if (refusal != null) throw ApiException(refusal);
    final ok = await askSheet(
      context,
      title: 'Put this stock on hold?',
      text: 'Put ${jsNumberString(qty)} of $_itemName on hold (${holdPurposeLabel(_purpose)})? It cannot be sold until it is released.',
      confirmLabel: 'Put on hold',
      cancelLabel: 'Not yet',
      danger: false,
    );
    if (!ok || !mounted) return;
    final done = await guardedWrite(
      context,
      'hold-new',
      () => widget.session.api.postJson(
        '/api/stock-holds',
        holdBody(
          itemId: _itemId,
          qty: qty,
          purpose: _purpose,
          date: _date,
          warehouseId: _godown,
          branchId: godowns.isEmpty ? (widget.session.defaultBranchId ?? '') : '',
          reference: _reference.text,
        ),
      ),
      success: 'Stock put on hold',
    );
    if (done == true && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return GodownGate(
      session: widget.session,
      title: 'Put stock on hold',
      builder: (context, godowns) => KFormScaffold(
        title: 'Put stock on hold',
        saveLabel: 'Put on hold',
        onSave: () => _save(godowns),
        children: [
          KAsyncPickField(
            label: 'Item',
            valueLabel: _itemName.isEmpty ? null : _itemName,
            search: (q) async => [for (final r in await searchStockItems(widget.session.api, q)) (docText(r['id']), docText(r['name']), stockItemSub(r))],
            onPicked: (id, name) => setState(() {
              _itemId = id;
              _itemName = name;
            }),
          ),
          KTextField(label: 'Quantity', controller: _qty, hint: '0', keyboard: const TextInputType.numberWithOptions(decimal: true)),
          KPickField<String>(label: 'Why', value: _purpose, options: kHoldPurposes, onChanged: (v) => setState(() => _purpose = v)),
          if (godowns.isNotEmpty)
            KPickField<String>(label: 'Godown', value: _godown.isEmpty ? null : _godown, options: godowns, onChanged: (v) => setState(() => _godown = v)),
          KDateField(label: 'Date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
          KTextField(label: 'Reference (optional)', controller: _reference),
        ],
      ),
    );
  }
}

/// "Record goods" (`POST /api/inward-custody`): someone else's goods kept in the godown. Never our stock.
class OthersGoodsFormScreen extends StatefulWidget {
  const OthersGoodsFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<OthersGoodsFormScreen> createState() => _OthersGoodsFormScreenState();
}

class _OthersGoodsFormScreenState extends State<OthersGoodsFormScreen> {
  final _owner = TextEditingController();
  final _goods = TextEditingController();
  final _qty = TextEditingController();
  final _unit = TextEditingController(text: 'PCS');
  final _reference = TextEditingController();
  String _reason = 'repair';
  String _godown = '';
  DateTime _date = dateOnly(DateTime.now());

  @override
  void dispose() {
    for (final c in [_owner, _goods, _qty, _unit, _reference]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save(List<(String, String)> godowns) async {
    final qty = num.tryParse(_qty.text.trim()) ?? 0;
    final refusal = othersRefusal(owner: _owner.text, description: _goods.text, qty: qty, needsGodown: godowns.isNotEmpty, godownId: _godown);
    if (refusal != null) throw ApiException(refusal);
    final done = await guardedWrite(
      context,
      'goods-new',
      () => widget.session.api.postJson(
        '/api/inward-custody',
        othersBody(
          owner: _owner.text,
          description: _goods.text,
          qty: qty,
          unit: _unit.text,
          reason: _reason,
          date: _date,
          warehouseId: _godown,
          branchId: godowns.isEmpty ? (widget.session.defaultBranchId ?? '') : '',
          reference: _reference.text,
        ),
      ),
      success: "Others' goods recorded",
    );
    if (done == true && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return GodownGate(
      session: widget.session,
      title: "Record others' goods",
      builder: (context, godowns) => KFormScaffold(
        title: "Record others' goods",
        saveLabel: 'Record',
        onSave: () => _save(godowns),
        children: [
          KTextField(label: 'Owner', controller: _owner),
          KTextField(label: 'Goods', controller: _goods, hint: "e.g. Customer's motor for rewinding"),
          KTextField(label: 'Quantity', controller: _qty, hint: '0', keyboard: const TextInputType.numberWithOptions(decimal: true)),
          KTextField(label: 'Unit', controller: _unit, caps: true),
          KPickField<String>(label: 'Why', value: _reason, options: kOthersReasons, onChanged: (v) => setState(() => _reason = v)),
          if (godowns.isNotEmpty)
            KPickField<String>(label: 'Godown', value: _godown.isEmpty ? null : _godown, options: godowns, onChanged: (v) => setState(() => _godown = v)),
          KDateField(label: 'Received on', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
          KTextField(label: 'Reference (optional)', controller: _reference),
        ],
      ),
    );
  }
}
