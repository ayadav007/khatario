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
import '../sales/doc_action_sheets.dart';
import 'stock_transfer_logic.dart';

/// `app/(app)/stock-transfers/[id]/receive/page.tsx` on the phone: per line, the quantity that arrived.
///
/// [transfer] is the transfer as the detail just loaded it (its `items` come from `GET .../[id]/items`). Confirm sends
/// `POST /api/stock-transfers/[id]/receive` once with `received_items` (`item_id`, `received_qty`, `qty` per line) and
/// `notes`. `received_qty` is the cumulative total received; less than was sent is a shortage the server records and
/// the transfer stays in transit until every line is fully received or closed short. The phone refuses what the
/// website refuses (more than was sent, or nothing); the server decides the stock. Pops with true when the transfer
/// changed.
///
/// The receive route takes no batch or serial numbers, and neither does the website's page, so a batch or serial line
/// is received here exactly as there.
class StockTransferReceiveScreen extends StatefulWidget {
  const StockTransferReceiveScreen({super.key, required this.session, required this.transfer});

  final AppSession session;
  final Map<String, dynamic> transfer;

  @override
  State<StockTransferReceiveScreen> createState() => _StockTransferReceiveScreenState();
}

class _StockTransferReceiveScreenState extends State<StockTransferReceiveScreen> {
  late final List<Map<String, dynamic>> _items = docRows(widget.transfer, 'items');
  late final Map<String, TextEditingController> _qty = {
    for (final i in _items) docText(i['id']): TextEditingController(text: transferQty(defaultReceivedQty(i))),
  };
  final _notes = TextEditingController();
  bool _submitted = false;

  String get _id => docText(widget.transfer['id']);

  @override
  void dispose() {
    for (final c in _qty.values) {
      c.dispose();
    }
    _notes.dispose();
    super.dispose();
  }

  num? _typed(Map<String, dynamic> item) {
    final n = num.tryParse(_qty[docText(item['id'])]!.text.trim());
    return n != null && n.isFinite ? n : null;
  }

  String? _error(Map<String, dynamic> item) {
    if (!_submitted) return null;
    final q = _typed(item) ?? 0;
    final sent = transferDispatched(item);
    if (q > sent) return 'Cannot receive more than dispatched (${transferQty(sent)})';
    if (q <= 0) return 'Quantity must be greater than 0';
    return null;
  }

  Future<void> _save() async {
    setState(() => _submitted = true);
    final typed = {for (final i in _items) docText(i['id']): _typed(i)};
    final refusal = receiveRefusal(_items, typed);
    if (refusal != null) throw ApiException(refusal);
    final body = receiveBody(
      lines: [for (final i in _items) (itemId: docText(i['item_id']), qty: typed[docText(i['id'])]!)],
      notes: _notes.text,
    );
    final Map<String, dynamic> reply;
    try {
      reply = await widget.session.api.postJson('/api/stock-transfers/$_id/receive', body);
    } on ApiException catch (e) {
      if (!transferAlreadyChanged(e)) rethrow;
      if (mounted) {
        showKToast(context, kTransferChangedText);
        Navigator.of(context).pop(true);
      }
      return;
    }
    if (!mounted) return;
    final status = docText((reply['transfer'] is Map ? reply['transfer'] as Map : const {})['status']);
    showKToast(
      context,
      status == 'in_transit' ? 'Receipt saved. Some goods are still in transit.' : 'Transfer received',
      tone: KTone.positive,
    );
    Navigator.of(context).pop(true);
  }

  Widget _lineCard(Map<String, dynamic> item) {
    final unit = docText(item['unit']).isEmpty ? 'PCS' : docText(item['unit']);
    final sent = transferDispatched(item);
    final typed = _typed(item) ?? 0;
    final less = transferQty(sent - typed);
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(docText(item['item_name']), style: AppText.bodyStrong),
          Text('Dispatched: ${transferQty(sent)} $unit', style: AppText.caption),
          const SizedBox(height: AppSpace.md),
          KTextField(
            label: 'Received quantity',
            controller: _qty[docText(item['id'])]!,
            hint: '0',
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            error: _error(item),
            onChanged: (_) => setState(() {}),
          ),
          if (typed > 0 && typed < sent)
            Padding(
              padding: const EdgeInsets.only(top: AppSpace.sm),
              child: Text(
                'Receiving $less $unit less than dispatched. This will be recorded as a discrepancy.',
                style: AppText.caption.copyWith(color: AppColors.due),
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final to = docText(widget.transfer['to_warehouse_name']);
    return KFormScaffold(
      title: 'Receive transfer',
      saveLabel: 'Confirm receipt',
      onSave: _save,
      dirty: false,
      canSave: _items.isNotEmpty,
      children: [
        Text(
          '${transferTitle(widget.transfer)}: ${docText(widget.transfer['from_warehouse_name'])} → $to',
          style: AppText.bodyStrong,
        ),
        Text(
          'Enter the quantities that actually arrived. You can receive less than was sent if there is a discrepancy. '
          'Stock is added to the destination warehouse when you confirm.',
          style: AppText.caption,
        ),
        if (_items.isEmpty) const KEmptyState(icon: LucideIcons.package, title: 'No items in this transfer'),
        for (final i in _items) _lineCard(i),
        KTextField(label: 'Receipt notes (optional)', controller: _notes, hint: 'Damages, shortages or other details', maxLines: 3),
      ],
    );
  }
}

/// `app/components/stock-transfers/TransferShortfallPanel.tsx` on the phone: goods that left the source warehouse and
/// will not arrive are written off (a transit loss, input tax credit reversed), or written off and claimed from the
/// carrier. Asks first, then `POST /api/stock-transfers/[id]/close-short` once with `{ date, lines }`. Pops with true
/// when the transfer changed.
class StockTransferCloseShortScreen extends StatefulWidget {
  const StockTransferCloseShortScreen({super.key, required this.session, required this.transfer});

  final AppSession session;
  final Map<String, dynamic> transfer;

  @override
  State<StockTransferCloseShortScreen> createState() => _StockTransferCloseShortScreenState();
}

class _StockTransferCloseShortScreenState extends State<StockTransferCloseShortScreen> {
  late final List<Map<String, dynamic>> _open = [
    for (final i in docRows(widget.transfer, 'items'))
      if (openShortQty(i) > 0) i,
  ];
  late final Map<String, TextEditingController> _qty = {
    for (final i in _open) docText(i['id']): TextEditingController(text: transferQty(openShortQty(i))),
  };
  final _carrier = TextEditingController();
  final _amount = TextEditingController();
  DateTime _date = dateOnly(DateTime.now());
  String _reason = 'transit_loss';

  String get _id => docText(widget.transfer['id']);

  @override
  void dispose() {
    for (final c in _qty.values) {
      c.dispose();
    }
    _carrier.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final lines = <({String itemId, num qty})>[];
    final picked = <Map<String, dynamic>>[];
    for (final i in _open) {
      final n = num.tryParse(_qty[docText(i['id'])]!.text.trim());
      if (n != null && n.isFinite && n > 0) {
        lines.add((itemId: docText(i['item_id']), qty: n));
        picked.add(i);
      }
    }
    if (lines.isEmpty) throw ApiException('Enter the quantity that never arrived');
    final text = lines.length == 1
        ? closeShortText(docText(picked.first['item_name']), lines.first.qty, docText(picked.first['unit']), _reason)
        : closeShortManyText(lines.length, _reason);
    final ok = await askSheet(
      context,
      title: 'Write off this shortfall?',
      text: text,
      confirmLabel: 'Write off',
      cancelLabel: 'Go back',
    );
    if (!ok || !mounted) return;
    final Map<String, dynamic> reply;
    try {
      reply = await widget.session.api.postJson(
        '/api/stock-transfers/$_id/close-short',
        closeShortBody(date: _date, lines: lines, reason: _reason, carrier: _carrier.text, amount: _amount.text),
      );
    } on ApiException catch (e) {
      if (!transferAlreadyChanged(e)) rethrow;
      if (mounted) {
        showKToast(context, kTransferChangedText);
        Navigator.of(context).pop(true);
      }
      return;
    }
    if (!mounted) return;
    showKToast(
      context,
      reply['completed'] == true ? 'Shortfall written off; transfer completed' : 'Shortfall written off',
      tone: KTone.positive,
    );
    Navigator.of(context).pop(true);
  }

  Widget _lineCard(Map<String, dynamic> item) {
    final unit = docText(item['unit']).isEmpty ? 'PCS' : docText(item['unit']);
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(docText(item['item_name']), style: AppText.bodyStrong),
          Text('${transferQty(openShortQty(item))} still in transit', style: AppText.caption),
          Text(unit, style: AppText.caption),
          const SizedBox(height: AppSpace.md),
          KTextField(
            label: 'Quantity that never arrived',
            controller: _qty[docText(item['id'])]!,
            hint: '0',
            keyboard: const TextInputType.numberWithOptions(decimal: true),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Close shortfall',
      saveLabel: 'Write off',
      onSave: _save,
      canSave: _open.isNotEmpty,
      children: [
        Text(
          'Goods that left the source warehouse and will not arrive. They are written off as a transit loss and their '
          'input tax credit is reversed.',
          style: AppText.caption,
        ),
        KDateField(label: 'Date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        if (_open.isEmpty) const KEmptyState(icon: LucideIcons.package, title: 'Nothing is still in transit on this transfer'),
        for (final i in _open) _lineCard(i),
        KPickField<String>(
          label: 'What happened',
          value: _reason,
          options: kShortReasons,
          onChanged: (v) => setState(() => _reason = v),
        ),
        if (_reason == 'carrier_claim') ...[
          KTextField(label: 'Carrier', controller: _carrier, hint: 'Who is the claim made on'),
          KTextField(
            label: 'Claim amount (optional)',
            controller: _amount,
            hint: '0',
            keyboard: const TextInputType.numberWithOptions(decimal: true),
          ),
        ],
      ],
    );
  }
}
