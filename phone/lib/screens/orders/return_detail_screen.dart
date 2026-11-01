import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

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
  bool _connected = false;
  ReturnWayForm _way = ReturnWayForm.initial(shiprocketConnected: false);

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
      if (mounted) {
        setState(() {
          _lines = lines;
          _connected = body['shiprocket_connected'] == true;
          // The server fills a blank pickup address, PIN and weight from the order.
          _way = ReturnWayForm.initial(shiprocketConnected: _connected, serverFillsPickup: true);
        });
      }
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
    final wayError = _way.error;
    if (wayError != null) {
      setState(() => _error = wayError);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await widget.session.api.postJson('/api/returns', {
        'invoice_id': widget.invoiceId,
        'reason': _reason,
        if (_note.text.trim().isNotEmpty) 'reason_note': _note.text.trim(),
        ..._way.body,
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
                                  if (l['store_returnable'] == false) ...[
                                    const SizedBox(height: 4),
                                    const KPill(label: 'Not returnable online', tone: KTone.neutral),
                                  ],
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
                Text('How does it come back?', style: AppText.overline),
                const SizedBox(height: 8),
                ReturnWayFields(form: _way, shiprocketConnected: _connected, blankHint: 'Filled from the order if left empty', onChanged: () => setState(() => _error = null)),
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

/// "How does it come back?": the ways back, then the pickup details or the customer's instructions.
/// Edits [form] in place and calls [onChanged].
class ReturnWayFields extends StatefulWidget {
  const ReturnWayFields({super.key, required this.form, required this.shiprocketConnected, required this.onChanged, this.blankHint});

  final ReturnWayForm form;
  final bool shiprocketConnected;
  final VoidCallback onChanged;

  /// Hint for fields the server fills in when left empty.
  final String? blankHint;

  @override
  State<ReturnWayFields> createState() => _ReturnWayFieldsState();
}

class _ReturnWayFieldsState extends State<ReturnWayFields> {
  late final TextEditingController _instructions = TextEditingController(text: widget.form.instructions);

  @override
  void didUpdateWidget(ReturnWayFields old) {
    super.didUpdateWidget(old);
    if (!identical(old.form, widget.form)) _instructions.text = widget.form.instructions;
  }

  @override
  void dispose() {
    _instructions.dispose();
    super.dispose();
  }

  void _pick(String m) {
    setState(() => widget.form.method = m);
    widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final form = widget.form;
    final methods = widget.shiprocketConnected ? const ['courier_pickup', 'customer_sends', 'no_return'] : const ['customer_sends', 'no_return'];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final m in methods)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: InkWell(
              borderRadius: BorderRadius.circular(AppRadius.md),
              onTap: () => _pick(m),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: form.method == m ? AppColors.brandSoft : AppColors.surface,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(color: form.method == m ? AppColors.brand : AppColors.hairline, width: 1.5),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(form.method == m ? LucideIcons.circleCheck : LucideIcons.circle, size: 20, color: form.method == m ? AppColors.brand : AppColors.ink3),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(returnMethodLabels[m]!, style: AppText.bodyStrong),
                          Text(returnMethodHints[m]!, style: AppText.caption),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        if (!widget.shiprocketConnected) Text('Connect Shiprocket to book pickups', style: AppText.caption),
        if (form.method == 'courier_pickup') ...[
          const SizedBox(height: 4),
          _PickupFields(form: form, blankHint: widget.blankHint, onChanged: widget.onChanged),
        ],
        if (form.method == 'customer_sends') ...[
          const SizedBox(height: 4),
          TextField(
            controller: _instructions,
            maxLines: 3,
            decoration: InputDecoration(labelText: 'What the customer is told', hintText: widget.blankHint),
            onChanged: (v) {
              form.instructions = v;
              widget.onChanged();
            },
          ),
        ],
      ],
    );
  }
}

/// Where the courier collects the parcel and how heavy it is: the customer's address, PIN, phone and weight.
class _PickupFields extends StatefulWidget {
  const _PickupFields({required this.form, required this.onChanged, this.blankHint});

  final ReturnWayForm form;
  final VoidCallback onChanged;
  final String? blankHint;

  @override
  State<_PickupFields> createState() => _PickupFieldsState();
}

class _PickupFieldsState extends State<_PickupFields> {
  late final _address = TextEditingController(text: widget.form.address);
  late final _pin = TextEditingController(text: widget.form.pincode);
  late final _phone = TextEditingController(text: widget.form.phone);
  late final _weight = TextEditingController(text: widget.form.weightKg);

  @override
  void dispose() {
    for (final c in [_address, _pin, _phone, _weight]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final form = widget.form;
    final hint = widget.blankHint;
    void edit(void Function() set) {
      set();
      widget.onChanged();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _address,
          maxLines: 2,
          decoration: InputDecoration(labelText: "Pick up from (the customer's address)", hintText: hint),
          onChanged: (v) => edit(() => form.address = v),
        ),
        const SizedBox(height: AppSpace.md),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _pin,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: InputDecoration(labelText: 'PIN code', hintText: hint, counterText: ''),
                onChanged: (v) => edit(() => form.pincode = v.replaceAll(RegExp(r'\D'), '')),
              ),
            ),
            const SizedBox(width: AppSpace.md),
            Expanded(
              child: TextField(
                controller: _weight,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: 'Weight (kg)', hintText: hint),
                onChanged: (v) => edit(() => form.weightKg = v),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpace.md),
        TextField(
          controller: _phone,
          keyboardType: TextInputType.phone,
          decoration: InputDecoration(labelText: 'Phone', hintText: hint),
          onChanged: (v) => edit(() => form.phone = v),
        ),
      ],
    );
  }
}

/// The choice of how it comes back, with its own confirm button. Pops with the filled form.
class _WaySheet extends StatefulWidget {
  const _WaySheet({required this.form, required this.connected, required this.confirmLabel});

  final ReturnWayForm form;
  final bool connected;
  final String confirmLabel;

  @override
  State<_WaySheet> createState() => _WaySheetState();
}

class _WaySheetState extends State<_WaySheet> {
  @override
  Widget build(BuildContext context) {
    final error = widget.form.error;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('How does it come back?', style: AppText.overline),
          const SizedBox(height: 8),
          ReturnWayFields(form: widget.form, shiprocketConnected: widget.connected, onChanged: () => setState(() {})),
          if (error != null) ...[
            const SizedBox(height: 4),
            Text(error, style: AppText.caption.copyWith(color: AppColors.negative)),
          ],
          const SizedBox(height: AppSpace.md),
          KButton(label: widget.confirmLabel, icon: LucideIcons.check, onPressed: error != null ? null : () => Navigator.pop(context, widget.form)),
        ],
      ),
    );
  }
}

/// The extra chips on a return row: where the pickup stands, and a refund still on its way.
class ReturnChips extends StatelessWidget {
  const ReturnChips(this.row, {super.key});

  final Map<String, dynamic> row;

  @override
  Widget build(BuildContext context) {
    final pickup = row['pickup_status']?.toString();
    final pending = row['gateway_refund_status'] == 'pending';
    if ((pickup == null || pickup.isEmpty) && !pending) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (pickup != null && pickup.isNotEmpty) ...[
          const SizedBox(height: 4),
          KPill(label: pickupStatusLabels[pickup] ?? pickup, tone: pickupTone(pickup)),
        ],
        if (pending) ...[
          const SizedBox(height: 4),
          const KPill(label: 'Refund pending', tone: KTone.due),
        ],
      ],
    );
  }
}

/// Courier pickup of an approved return: where it stands, the AWB, Track, and the ways to fix or change it.
class _PickupCard extends StatefulWidget {
  const _PickupCard({required this.ret, required this.busy, required this.onAction});

  final Map<String, dynamic> ret;
  final bool busy;
  final void Function(Map<String, dynamic> body) onAction;

  @override
  State<_PickupCard> createState() => _PickupCardState();
}

class _PickupCardState extends State<_PickupCard> {
  ReturnWayForm? _form;

  Map<String, dynamic> get _r => widget.ret;
  String get _status => _r['pickup_status']?.toString() ?? '';
  bool get _live => hasLivePickup(_r);
  bool get _onItsWay => _status == 'in_transit' || _status == 'arrived';

  ReturnWayForm _open() => ReturnWayForm.initial(
        shiprocketConnected: true,
        pickup: _r['pickup'] is Map ? Map<String, dynamic>.from(_r['pickup'] as Map) : null,
      )..method = 'courier_pickup';

  @override
  void initState() {
    super.initState();
    // A booking that failed usually needs a corrected PIN or address, so the details open for editing.
    if ((_r['pickup_error'] ?? '').toString().isNotEmpty && !_live && !_onItsWay) _form = _open();
  }

  Future<void> _track(String url) async {
    final uri = Uri.tryParse(url);
    final ok = uri != null && await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not open the tracking link')));
  }

  @override
  Widget build(BuildContext context) {
    final awb = (_r['awb'] ?? '').toString();
    final courier = (_r['courier_name'] ?? '').toString();
    final trackUrl = (_r['tracking_url'] ?? '').toString();
    final error = (_r['pickup_error'] ?? '').toString();
    final form = _form;
    final formError = form?.error;
    return KCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(LucideIcons.truck, size: 18, color: AppColors.ink2),
              const SizedBox(width: 8),
              Expanded(child: Text('Courier pickup', style: AppText.bodyStrong)),
              if (_status.isNotEmpty) KPill(label: pickupStatusLabels[_status] ?? _status, tone: pickupTone(_status)) else const KPill(label: 'Not booked yet', tone: KTone.due),
            ],
          ),
          if (awb.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(child: Text('${courier.isEmpty ? 'Courier' : courier} · AWB $awb', style: AppText.body)),
                if (trackUrl.isNotEmpty) KTextButton(label: 'Track', onTap: () => _track(trackUrl)),
              ],
            ),
          ],
          if (error.isNotEmpty)
            Container(
              margin: const EdgeInsets.only(top: 10),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: AppColors.negativeSoft, borderRadius: BorderRadius.circular(AppRadius.md)),
              child: Text(error, style: AppText.body.copyWith(color: AppColors.negative)),
            ),
          if (!_live && !_onItsWay && form != null) ...[
            const SizedBox(height: AppSpace.md),
            _PickupFields(form: form, onChanged: () => setState(() {})),
            if (formError != null) ...[
              const SizedBox(height: 4),
              Text(formError, style: AppText.caption.copyWith(color: AppColors.negative)),
            ],
          ],
          if (!_onItsWay) ...[
            const SizedBox(height: AppSpace.md),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (!_live)
                  KButton(
                    label: 'Book again',
                    icon: LucideIcons.truck,
                    expand: false,
                    height: 44,
                    loading: widget.busy,
                    onPressed: formError != null ? null : () => widget.onAction({'action': 'book_pickup', if (form != null) 'pickup': form.pickupBody}),
                  ),
                if (!_live)
                  KButton.secondary(
                    label: form != null ? 'Close details' : 'Edit details',
                    expand: false,
                    height: 44,
                    onPressed: widget.busy ? null : () => setState(() => _form = form != null ? null : _open()),
                  ),
                if (_live)
                  KButton.secondary(label: 'Cancel pickup', expand: false, height: 44, onPressed: widget.busy ? null : () => widget.onAction({'action': 'cancel_pickup'})),
                if (!_live)
                  KButton(
                    label: 'Customer will send it instead',
                    kind: KButtonKind.ghost,
                    expand: false,
                    height: 44,
                    onPressed: widget.busy ? null : () => widget.onAction({'action': 'set_method', 'method': 'customer_sends'}),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// What happened to a return, oldest first.
class _Timeline extends StatelessWidget {
  const _Timeline(this.events);

  final List<Map<String, dynamic>> events;

  @override
  Widget build(BuildContext context) {
    if (events.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: AppSpace.lg),
        Text('Timeline', style: AppText.overline),
        const SizedBox(height: 8),
        KCard(
          padding: const EdgeInsets.all(14),
          child: Column(
            children: [
              for (final e in events)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(margin: const EdgeInsets.only(top: 6, right: 10), width: 8, height: 8, decoration: const BoxDecoration(color: AppColors.ink3, shape: BoxShape.circle)),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(returnEventLabels[e['kind']] ?? e['kind'].toString(), style: AppText.bodyStrong),
                            if ((e['note'] ?? '').toString().isNotEmpty) Text(e['note'].toString(), style: AppText.caption),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(_when(e['created_at']), style: AppText.caption),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  static String _when(dynamic iso) {
    final t = DateTime.tryParse(iso?.toString() ?? '');
    return t == null ? '' : ddMMMyyyyHm(t.toLocal());
  }
}

/// One return: approve or reject a request, follow the pickup, receive the goods (back to stock or damaged), pay back.
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
  final _amount = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Map<String, dynamic> _mapOf(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : const {};

  /// What the gateway can still take back, from the order's online payment.
  Map<String, dynamic> get _original => _mapOf(_ret?['original_refund']);
  bool get _originalAllowed => _original['allowed'] == true;

  /// Back to the original payment is a choice once received with room left, or at the receive step when the order was paid online.
  bool get _originalOffered => _originalAllowed || (_ret?['status'] == 'approved' && _original['eligible'] == true);
  Map<String, dynamic>? get _gateway => _ret?['gateway_refund'] is Map ? _mapOf(_ret!['gateway_refund']) : null;

  void _apply(Map<String, dynamic> body) {
    final r = body['return'] is Map ? Map<String, dynamic>.from(body['return'] as Map) : null;
    setState(() {
      _ret = r;
      _refundable = toNum(body['refundable']);
      for (final l in _lines) {
        _condition[l['id'].toString()] = l['condition']?.toString() ?? 'restock';
        _got[l['id'].toString()] = toNum(l['received_qty'] ?? l['quantity']);
      }
      // Back to the original payment is first and preselected when the order was paid online, from the receive step on.
      if (_originalOffered) {
        _method = 'original_payment';
      } else if (_method == 'original_payment') {
        _method = 'cash';
      }
      _amount.text = _refundable > 0 ? plainNumber(originalRefundAmount(_refundable, toNum(_original['max']))) : '';
    });
  }

  List<Map<String, dynamic>> get _lines => _ret?['lines'] is List
      ? (_ret!['lines'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : const [];

  List<Map<String, dynamic>> get _events => _ret?['events'] is List
      ? (_ret!['events'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
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
      final pickup = _mapOf(res['pickup']);
      final refundError = _mapOf(res['refund_error']);
      setState(() {
        if (res['credit_note_number'] != null) {
          _notice = 'Credit note ${res['credit_note_number']} posted for ${orderMoney(res['credit_amount'])}';
        } else if (pickup['ok'] == true && (pickup['awb'] ?? '').toString().isNotEmpty) {
          _notice = 'Pickup booked. AWB ${pickup['awb']}.';
        }
        // The goods were received but the refund to the original payment did not go through; it can be tried again.
        if ((refundError['error'] ?? '').toString().isNotEmpty) _error = refundError['error'].toString();
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The refund the shop chose. A refund to the original payment can carry a smaller amount once the credit note exists.
  Map<String, dynamic> get _refund {
    if (_method != 'original_payment') return {'method': _method};
    final amount = num.tryParse(_amount.text.trim());
    return {'method': _method, if (_ret?['status'] == 'received' && amount != null && amount > 0) 'amount': amount};
  }

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

  /// The way back as the website starts it: courier only when Shiprocket is connected and the pickup address and PIN are known.
  ReturnWayForm _wayForm(Map<String, dynamic> r) {
    final saved = (r['instructions'] ?? '').toString();
    return ReturnWayForm.initial(
      shiprocketConnected: r['shiprocket_connected'] == true,
      pickup: r['pickup'] is Map ? _mapOf(r['pickup']) : null,
      defaultInstructions: saved.isNotEmpty ? saved : r['default_instructions']?.toString(),
    );
  }

  Future<void> _chooseWay({required String action, required String title, required String confirm}) async {
    final r = _ret;
    if (r == null) return;
    // Made once: the sheet's builder re-runs when the keyboard opens or closes, and must not start the form over.
    final form = _wayForm(r);
    final picked = await showKSheet<ReturnWayForm>(
      context,
      title: title,
      scrollable: true,
      builder: (ctx) => _WaySheet(form: form, connected: r['shiprocket_connected'] == true, confirmLabel: confirm),
    );
    if (picked != null) await _act({'action': action, ...picked.body});
  }

  @override
  Widget build(BuildContext context) {
    final r = _ret;
    final status = r?['status']?.toString() ?? '';
    final gateway = _gateway;
    final pending = gateway?['status'] == 'pending';
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
                if (status == 'approved' && r['pickup_status'] == 'arrived') ...[
                  const SizedBox(height: AppSpace.md),
                  KCard(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      children: [
                        const Icon(LucideIcons.packageCheck, color: AppColors.positive),
                        const SizedBox(width: 10),
                        Expanded(child: Text('Arrived at shop, check the items', style: AppText.bodyStrong)),
                      ],
                    ),
                  ),
                ],
                if (status == 'approved' && r['method'] == 'courier_pickup') ...[
                  const SizedBox(height: AppSpace.md),
                  _PickupCard(ret: r, busy: _busy, onAction: _act),
                ],
                if (status == 'approved' && r['method'] != null && r['method'] != 'courier_pickup') ...[
                  const SizedBox(height: AppSpace.md),
                  _wayCard(r),
                ],
                const SizedBox(height: AppSpace.md),
                Text(status == 'approved' ? 'What came back?' : 'Items', style: AppText.overline),
                const SizedBox(height: 8),
                KCard(
                  child: KDivided(children: [for (final l in _lines) _line(l, editable: status == 'approved')]),
                ),
                if (status == 'approved' || (status == 'received' && !pending)) ...[
                  const SizedBox(height: AppSpace.lg),
                  Text(status == 'received' ? 'Refund due · ${orderMoney(_refundable)}' : 'Pay back as', style: AppText.overline),
                  if (gateway?['status'] == 'failed')
                    _banner(
                      'The refund to the original payment failed${(gateway!['error'] ?? '').toString().isNotEmpty ? ': ${gateway['error']}' : '.'} Try again, or pay back another way.',
                      AppColors.negative,
                      AppColors.negativeSoft,
                    ),
                  const SizedBox(height: 8),
                  _refundPicker(status),
                ],
                if (status == 'received' && pending) ...[
                  const SizedBox(height: AppSpace.lg),
                  Text('Refund due · ${orderMoney(_refundable)}', style: AppText.overline),
                  const SizedBox(height: 8),
                  KCard(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            const Icon(LucideIcons.clock, size: 18, color: AppColors.due),
                            const SizedBox(width: 8),
                            Expanded(child: Text('Refund on its way (${orderMoney(gateway!['amount'])})', style: AppText.bodyStrong)),
                          ],
                        ),
                        if ((gateway['error'] ?? '').toString().isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(gateway['error'].toString(), style: AppText.caption),
                        ],
                        const SizedBox(height: 4),
                        Text('It closes by itself when the payment gateway confirms.', style: AppText.caption),
                        const SizedBox(height: AppSpace.md),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            // The send never got an answer: Try again repeats the same attempt (same key), so it cannot refund twice.
                            if ((gateway['provider_refund_id'] ?? '').toString().isEmpty && (gateway['error'] ?? '').toString().isNotEmpty)
                              KButton(
                                label: 'Try again',
                                icon: LucideIcons.rotateCcw,
                                expand: false,
                                height: 44,
                                loading: _busy,
                                onPressed: () => _act({
                                  'action': 'settle',
                                  'refund': {'method': 'original_payment'},
                                }),
                              ),
                            KButton.secondary(label: 'Check now', icon: LucideIcons.refreshCw, expand: false, height: 44, loading: _busy, onPressed: () => _act({'action': 'check_refund'})),
                          ],
                        ),
                      ],
                    ),
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
                                : r['refund_method'] == 'original_payment'
                                    ? 'Refunded ${orderMoney(r['refunded_amount'])} to the original payment'
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
                _Timeline(_events),
              ],
            ),
      bottomNavigationBar: r == null ? null : _bar(status, pending),
    );
  }

  /// How the goods come back, once approved without a courier: the method, the customer's instructions, Change.
  Widget _wayCard(Map<String, dynamic> r) {
    final method = r['method'].toString();
    final instructions = (r['instructions'] ?? '').toString();
    return KCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: Text(returnMethodLabels[method] ?? method, style: AppText.bodyStrong)),
              if (method == 'customer_sends')
                KTextButton(label: 'Change', onTap: _busy ? () {} : () => _chooseWay(action: 'set_method', title: 'Change how it comes back', confirm: 'Save')),
            ],
          ),
          if (method == 'customer_sends' && instructions.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(instructions, style: AppText.body),
          ],
        ],
      ),
    );
  }

  /// The refund choices: back to the original payment first when the order was paid online.
  Widget _refundPicker(String status) {
    final max = toNum(_original['max']);
    final choices = [if (_originalOffered) 'original_payment', 'cash', 'upi', 'bank', 'store_credit'];
    // Before the goods are in, the most that can go back is an estimate (the return's value, capped by the online payment left).
    final estimate = _original['estimated_max'];
    final upTo = status == 'approved'
        ? (estimate == null ? '' : ' · Up to about ${orderMoney(toNum(estimate))}')
        : ' · Up to ${orderMoney(max)}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [for (final m in choices) KChip(label: refundMethodLabels[m]!, selected: _method == m, onTap: () => setState(() => _method = m))],
        ),
        const SizedBox(height: 6),
        if (_method == 'original_payment') ...[
          Text('Goes back to the UPI or card the customer paid with$upTo. It reaches them in 5 to 7 working days.', style: AppText.caption),
          if (status == 'received') ...[
            const SizedBox(height: AppSpace.md),
            TextField(controller: _amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount')),
          ],
        ] else
          Text(
            _method == 'store_credit'
                ? 'The credit stays on the customer and is used on their next bill.'
                : 'If the bill is not fully paid, the credit first reduces what is due; only the rest is paid back.',
            style: AppText.caption,
          ),
      ],
    );
  }

  Widget? _bar(String status, bool pending) {
    return switch (status) {
      'requested' => KBottomBar(children: [
          Expanded(child: KButton.secondary(label: 'Reject', onPressed: _busy ? null : _reject)),
          const SizedBox(width: 12),
          Expanded(
            child: KButton(
              label: 'Approve',
              icon: LucideIcons.check,
              loading: _busy,
              onPressed: () => _chooseWay(action: 'approve', title: 'Approve return', confirm: 'Approve'),
            ),
          ),
        ]),
      'approved' => KBottomBar(children: [
          Expanded(
            child: KButton(
              label: _method == 'original_payment' ? 'Receive & refund' : 'Receive & post credit',
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
      'received' when !pending => KBottomBar(children: [
          Expanded(
            child: KButton(
              label: _method == 'store_credit'
                  ? 'Keep as credit'
                  : _method == 'original_payment'
                      ? 'Refund to original payment'
                      : 'Record refund · ${orderMoney(_refundable)}',
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
