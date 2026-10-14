import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'orders_logic.dart';

/// Pick what is coming back on a bill and why. Pops with the new return id.
class StartReturnScreen extends StatefulWidget {
  const StartReturnScreen({super.key, required this.session, required this.invoiceId, this.invoiceNumber});

  final AppSession session;
  final String invoiceId;
  final String? invoiceNumber;

  @override
  State<StartReturnScreen> createState() => _StartReturnScreenState();
}

class _StartReturnScreenState extends State<StartReturnScreen> {
  List<Map<String, dynamic>>? _lines;
  final Map<String, num> _qty = {};
  String _reason = 'damaged';
  final _note = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/returns?returnable_for=${widget.invoiceId}');
      final lines = body['lines'] is List ? (body['lines'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : <Map<String, dynamic>>[];
      if (mounted) setState(() => _lines = lines);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _lines = const [];
          _error = e.message;
        });
      }
    }
  }

  num get _estimate {
    num s = 0;
    for (final l in _lines ?? const <Map<String, dynamic>>[]) {
      final q = _qty[l['invoice_item_id']] ?? 0;
      s += toNum(l['unit_price']) * q * (1 + toNum(l['tax_rate']) / 100);
    }
    return s;
  }

  Future<void> _submit() async {
    final picked = _qty.entries.where((e) => e.value > 0).toList();
    if (picked.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await widget.session.api.postJson('/api/returns', {
        'invoice_id': widget.invoiceId,
        'reason': _reason,
        if (_note.text.trim().isNotEmpty) 'reason_note': _note.text.trim(),
        'lines': [for (final e in picked) {'invoice_item_id': e.key, 'quantity': e.value}],
      });
      if (mounted) Navigator.of(context).pop(res['id']?.toString());
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final any = _qty.values.any((v) => v > 0);
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: Text(widget.invoiceNumber == null ? 'Start a return' : 'Return on ${widget.invoiceNumber}')),
      body: _lines == null
          ? const KSpinner()
          : ListView(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 120),
              children: [
                Text('Pick what is coming back. Stock and money are settled when you receive it.', style: AppText.caption),
                const SizedBox(height: AppSpace.md),
                KCard(
                  child: KDivided(children: [
                    for (final l in _lines!)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(l['item_name']?.toString() ?? 'Item', style: AppText.bodyStrong),
                                  Text(
                                    toNum(l['returnable_qty']) <= 0
                                        ? 'Already returned'
                                        : 'Sold ${enIn(toNum(l['sold_qty']))} · can return ${enIn(toNum(l['returnable_qty']))}',
                                    style: AppText.caption,
                                  ),
                                ],
                              ),
                            ),
                            _Stepper(
                              value: _qty[l['invoice_item_id']] ?? 0,
                              max: toNum(l['returnable_qty']),
                              label: l['item_name']?.toString() ?? 'item',
                              onChanged: (v) => setState(() => _qty[l['invoice_item_id'].toString()] = v),
                            ),
                          ],
                        ),
                      ),
                  ]),
                ),
                const SizedBox(height: AppSpace.lg),
                Text('Reason', style: AppText.overline),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final e in returnReasonLabels.entries) KChip(label: e.value, selected: _reason == e.key, onTap: () => setState(() => _reason = e.key)),
                  ],
                ),
                const SizedBox(height: AppSpace.md),
                TextField(controller: _note, maxLines: 2, decoration: const InputDecoration(labelText: 'Note (optional)')),
                if (_error != null) ...[
                  const SizedBox(height: AppSpace.md),
                  Text(_error!, style: AppText.body.copyWith(color: AppColors.negative)),
                ],
              ],
            ),
      bottomNavigationBar: KBottomBar(children: [
        Expanded(
          child: KButton(
            label: any ? 'Start return · ${orderMoney(_estimate)}' : 'Start return',
            icon: LucideIcons.rotateCcw,
            loading: _busy,
            onPressed: any ? _submit : null,
          ),
        ),
      ]),
    );
  }
}

class _Stepper extends StatelessWidget {
  const _Stepper({required this.value, required this.max, required this.onChanged, required this.label});

  final num value;
  final num max;
  final String label;
  final ValueChanged<num> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        KIconButton(icon: LucideIcons.minus, tooltip: 'Fewer $label', onTap: value <= 0 ? () {} : () => onChanged(value - 1)),
        SizedBox(width: 28, child: Text(enIn(value), textAlign: TextAlign.center, style: AppText.bodyStrong)),
        KIconButton(icon: LucideIcons.plus, tooltip: 'More $label', onTap: value >= max ? () {} : () => onChanged(value + 1)),
      ],
    );
  }
}

/// One return: approve or reject a request, receive the goods (back to stock or damaged), pay back.
class ReturnDetailScreen extends StatefulWidget {
  const ReturnDetailScreen({super.key, required this.session, required this.id});

  final AppSession session;
  final String id;

  @override
  State<ReturnDetailScreen> createState() => _ReturnDetailScreenState();
}

class _ReturnDetailScreenState extends State<ReturnDetailScreen> {
  Map<String, dynamic>? _ret;
  num _refundable = 0;
  String? _error;
  String? _notice;
  bool _busy = false;
  final Map<String, String> _condition = {};
  final Map<String, num> _got = {};
  String _method = 'cash';

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _apply(Map<String, dynamic> body) {
    final r = body['return'] is Map ? Map<String, dynamic>.from(body['return'] as Map) : null;
    setState(() {
      _ret = r;
      _refundable = toNum(body['refundable']);
      for (final l in _lines) {
        _condition[l['id'].toString()] = l['condition']?.toString() ?? 'restock';
        _got[l['id'].toString()] = toNum(l['received_qty'] ?? l['quantity']);
      }
    });
  }

  List<Map<String, dynamic>> get _lines => _ret?['lines'] is List
      ? (_ret!['lines'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : const [];

  Future<void> _load() async {
    try {
      _apply(await widget.session.api.getJson('/api/returns/${widget.id}'));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _act(Map<String, dynamic> body) async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final res = await widget.session.api.patchJson('/api/returns/${widget.id}', body);
      if (!mounted) return;
      _apply(res);
      if (res['credit_note_number'] != null) setState(() => _notice = 'Credit note ${res['credit_note_number']} posted for ${orderMoney(res['credit_amount'])}');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Map<String, dynamic> get _refund => {'method': _method};

  Future<void> _reject() async {
    final reason = TextEditingController();
    final ok = await showKSheet<bool>(
      context,
      title: 'Reject request',
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(controller: reason, maxLines: 2, decoration: const InputDecoration(labelText: 'Why? The customer sees this.')),
            const SizedBox(height: 16),
            KButton(label: 'Reject', kind: KButtonKind.danger, onPressed: () => Navigator.pop(ctx, true)),
          ],
        ),
      ),
    );
    if (ok == true) await _act({'action': 'reject', 'reason': reason.text.trim()});
  }

  @override
  Widget build(BuildContext context) {
    final r = _ret;
    final status = r?['status']?.toString() ?? '';
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: Text(r?['return_number']?.toString() ?? 'Return')),
      body: r == null
          ? (_error != null ? KEmptyState(icon: LucideIcons.circleAlert, title: _error!) : const KSpinner())
          : ListView(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 140),
              children: [
                KCard(
                  raised: true,
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(child: Text(r['customer_name']?.toString() ?? 'Customer', style: AppText.heading)),
                          Builder(builder: (_) {
                            final (t, l) = returnTone(status);
                            return KPill(label: l, tone: t);
                          }),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Bill ${r['invoice_number']} · ${returnReasonLabels[r['reason']] ?? r['reason']}'
                        '${r['initiated_by'] == 'customer' ? ' · asked by customer' : r['initiated_by'] == 'courier' ? ' · came back with courier' : ''}',
                        style: AppText.caption,
                      ),
                      if ((r['reason_note'] ?? '').toString().isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text('“${r['reason_note']}”', style: AppText.body),
                      ],
                      if (r['credit_note_number'] != null) ...[
                        const SizedBox(height: 10),
                        Text('Credit note ${r['credit_note_number']} · ${orderMoney(r['credit_amount'])}', style: AppText.bodyStrong),
                      ],
                    ],
                  ),
                ),
                if (_error != null) _banner(_error!, AppColors.negative, AppColors.negativeSoft),
                if (_notice != null) _banner(_notice!, AppColors.positive, AppColors.positiveSoft),
                const SizedBox(height: AppSpace.md),
                Text(status == 'approved' ? 'What came back?' : 'Items', style: AppText.overline),
                const SizedBox(height: 8),
                KCard(
                  child: KDivided(children: [for (final l in _lines) _line(l, editable: status == 'approved')]),
                ),
                if (status == 'approved' || status == 'received') ...[
                  const SizedBox(height: AppSpace.lg),
                  Text(status == 'received' ? 'Refund due · ${orderMoney(_refundable)}' : 'Pay back as', style: AppText.overline),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final (k, l) in const [('cash', 'Cash'), ('upi', 'UPI'), ('bank', 'Bank'), ('store_credit', 'Keep as credit')])
                        KChip(label: l, selected: _method == k, onTap: () => setState(() => _method = k)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _method == 'store_credit'
                        ? 'The credit stays on the customer and is used on their next bill.'
                        : 'If the bill is not fully paid, the credit first reduces what is due; only the rest is paid back.',
                    style: AppText.caption,
                  ),
                ],
                if (status == 'closed') ...[
                  const SizedBox(height: AppSpace.lg),
                  KCard(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      children: [
                        const Icon(LucideIcons.circleCheck, color: AppColors.positive),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            r['refund_method'] == 'store_credit'
                                ? 'Kept as credit for the next bill'
                                : toNum(r['refunded_amount']) > 0
                                    ? 'Paid back ${orderMoney(r['refunded_amount'])}'
                                    : 'Settled against the unpaid bill',
                            style: AppText.bodyStrong,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
      bottomNavigationBar: r == null ? null : _bar(status),
    );
  }

  Widget? _bar(String status) {
    return switch (status) {
      'requested' => KBottomBar(children: [
          Expanded(child: KButton.secondary(label: 'Reject', onPressed: _busy ? null : _reject)),
          const SizedBox(width: 12),
          Expanded(child: KButton(label: 'Approve', icon: LucideIcons.check, loading: _busy, onPressed: () => _act({'action': 'approve'}))),
        ]),
      'approved' => KBottomBar(children: [
          Expanded(
            child: KButton(
              label: 'Receive & post credit',
              icon: LucideIcons.packageCheck,
              loading: _busy,
              onPressed: () => _act({
                'action': 'receive',
                'lines': [
                  for (final l in _lines) {'id': l['id'], 'received_qty': _got[l['id'].toString()], 'condition': _condition[l['id'].toString()]},
                ],
                'refund': _refund,
              }),
            ),
          ),
        ]),
      'received' => KBottomBar(children: [
          Expanded(
            child: KButton(
              label: _method == 'store_credit' ? 'Keep as credit' : 'Record refund · ${orderMoney(_refundable)}',
              icon: LucideIcons.banknote,
              loading: _busy,
              onPressed: () => _act({'action': 'settle', 'refund': _refund}),
            ),
          ),
        ]),
      _ => null,
    };
  }

  Widget _banner(String text, Color fg, Color bg) => Container(
        margin: const EdgeInsets.only(top: AppSpace.md),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(AppRadius.md)),
        child: Text(text, style: AppText.body.copyWith(color: fg)),
      );

  Widget _line(Map<String, dynamic> l, {required bool editable}) {
    final id = l['id'].toString();
    final cond = _condition[id] ?? 'restock';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(l['item_name']?.toString() ?? 'Item', style: AppText.bodyStrong),
                    Text('Asked ${enIn(toNum(l['quantity']))} · ${orderMoney(l['unit_price'])} + ${enIn(toNum(l['tax_rate']))}%', style: AppText.caption),
                  ],
                ),
              ),
              if (editable)
                _Stepper(
                  value: _got[id] ?? toNum(l['quantity']),
                  max: toNum(l['quantity']),
                  label: l['item_name']?.toString() ?? 'item',
                  onChanged: (v) => setState(() => _got[id] = v),
                )
              else if (l['condition'] != null)
                KPill(
                  label: l['condition'] == 'damaged' ? 'Written off' : 'Back in stock',
                  tone: l['condition'] == 'damaged' ? KTone.negative : KTone.positive,
                ),
            ],
          ),
          if (editable) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                KChip(label: 'Good, back to stock', icon: LucideIcons.packageCheck, selected: cond == 'restock', onTap: () => setState(() => _condition[id] = 'restock')),
                KChip(label: 'Damaged', icon: LucideIcons.packageX, selected: cond == 'damaged', onTap: () => setState(() => _condition[id] = 'damaged')),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
