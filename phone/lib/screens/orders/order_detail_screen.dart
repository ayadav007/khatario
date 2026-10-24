import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../whatsapp_compose.dart';
import 'orders_logic.dart';
import 'return_detail_screen.dart';

/// One order: where it goes, what is in the parcel, its timeline and the next step.
class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({super.key, required this.session, required this.source, required this.id});

  final AppSession session;
  final String source;
  final String id;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  String? _notice;
  bool _busy = false;
  String? _activeId;
  List<Map<String, dynamic>> _returns = const [];

  String get _path => '/api/orders/${widget.source}/${widget.id}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  List<Map<String, dynamic>> _list(dynamic v) =>
      v is List ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson(_path);
      if (!mounted) return;
      setState(() {
        _data = body;
        _error = null;
      });
      _loadReturns();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _loadReturns() async {
    final inv = _order['invoice_id']?.toString();
    if (inv == null || inv.isEmpty) return;
    try {
      final body = await widget.session.api.getJson('/api/returns?invoice_id=$inv');
      if (mounted) setState(() => _returns = _list(body['returns']));
    } catch (_) {}
  }

  Map<String, dynamic> get _order => _data?['order'] is Map ? Map<String, dynamic>.from(_data!['order'] as Map) : const {};
  List<Map<String, dynamic>> get _parcels => _list(_data?['fulfilments']);
  Map<String, dynamic>? get _parcel {
    final ps = _parcels;
    if (ps.isEmpty) return null;
    return ps.firstWhere((p) => p['id'] == _activeId, orElse: () => ps.first);
  }

  bool get _paid => _order['payment_status']?.toString() == 'paid';

  Future<Map<String, dynamic>?> _act(Map<String, dynamic> body, {String? done}) async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final res = await widget.session.api.postJson(_path, {if (_parcel != null) 'fulfilment_id': _parcel!['id'], ...body});
      if (!mounted) return res;
      setState(() {
        if (res['order'] != null) _data = res;
        if (res['active_fulfilment_id'] != null) _activeId = res['active_fulfilment_id'].toString();
        _notice = res['warning']?.toString() ?? done;
      });
      _loadReturns();
      return res;
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
      return null;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _move(String to, {Map<String, dynamic>? details}) =>
      _act({'action': 'transition', 'to': to, 'details': ?details}, done: deliveryLabels[to]);

  // ---------- sheets ----------

  Future<void> _dispatchSheet() async {
    String method = _parcel?['method']?.toString() ?? 'courier';
    final partner = TextEditingController(text: _parcel?['partner_name']?.toString() ?? '');
    final awb = TextEditingController();
    final rider = TextEditingController();
    final riderPhone = TextEditingController();
    final cod = TextEditingController(text: _paid ? '' : enIn(toNum(_order['amount']), maxFraction: 2).replaceAll(',', ''));
    final ok = await showKSheet<bool>(
      context,
      title: 'How is it going out?',
      scrollable: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final (k, l) in const [('courier', 'Courier'), ('own_rider', 'Own rider'), ('local_app', 'Porter / app'), ('pickup', 'Buyer picks up')])
                    KChip(label: l, selected: method == k, onTap: () => set(() => method = k)),
                ],
              ),
              const SizedBox(height: 14),
              if (method == 'courier' || method == 'local_app') ...[
                TextField(controller: partner, decoration: InputDecoration(labelText: method == 'courier' ? 'Courier name' : 'App (Porter, Dunzo…)')),
                const SizedBox(height: 10),
              ],
              if (method == 'courier') ...[
                TextField(controller: awb, decoration: const InputDecoration(labelText: 'Tracking number (AWB)')),
                const SizedBox(height: 10),
              ],
              if (method == 'own_rider' || method == 'local_app') ...[
                TextField(controller: rider, decoration: const InputDecoration(labelText: 'Rider name')),
                const SizedBox(height: 10),
                TextField(controller: riderPhone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Rider phone')),
                const SizedBox(height: 10),
              ],
              if (!_paid && method != 'pickup')
                TextField(
                  controller: cod,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Cash to collect on delivery (₹)'),
                ),
              const SizedBox(height: 16),
              KButton(label: method == 'pickup' ? 'Ready for pickup' : 'Dispatch', icon: LucideIcons.send, onPressed: () => Navigator.pop(ctx, true)),
            ],
          ),
        ),
      ),
    );
    if (ok != true) return;
    final details = <String, dynamic>{'method': method};
    if (method == 'courier' || method == 'local_app') details['partner_name'] = partner.text.trim();
    if (method == 'courier') details['awb'] = awb.text.trim();
    if (method == 'own_rider' || method == 'local_app') {
      details['rider_name'] = rider.text.trim();
      details['rider_phone'] = riderPhone.text.trim();
    }
    if (!_paid && cod.text.trim().isNotEmpty) details['cod_amount'] = toNum(cod.text.trim());
    await _move(method == 'pickup' ? 'ready_for_pickup' : 'shipped', details: details);
  }

  Future<void> _failedSheet() async {
    const reasons = ['Customer not reachable', 'Customer not at home', 'Wrong address', 'Customer refused'];
    final r = await showKSheet<String>(
      context,
      title: 'Why could it not be delivered?',
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [for (final x in reasons) KSheetAction(icon: LucideIcons.circleAlert, label: x, onTap: () => Navigator.pop(ctx, x))],
      ),
    );
    if (r != null) await _move('delivery_failed', details: {'failure_reason': r});
  }

  Future<void> _ndrSheet() async {
    String action = 'reattempt';
    final address = TextEditingController();
    final phone = TextEditingController();
    final ok = await showKSheet<bool>(
      context,
      title: 'What next?',
      scrollable: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KSegmented<String>(
                value: action,
                options: const [('reattempt', 'Try again'), ('change_address', 'New address'), ('return_to_origin', 'Bring back')],
                onChanged: (v) => set(() => action = v),
              ),
              const SizedBox(height: 14),
              if (action != 'return_to_origin')
                TextField(controller: phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Buyer phone (if changed)')),
              if (action == 'change_address') ...[
                const SizedBox(height: 10),
                TextField(controller: address, maxLines: 2, decoration: const InputDecoration(labelText: 'Corrected address')),
              ],
              const SizedBox(height: 16),
              KButton(
                label: action == 'return_to_origin' ? 'Bring parcel back' : 'Re-attempt delivery',
                kind: action == 'return_to_origin' ? KButtonKind.danger : KButtonKind.primary,
                onPressed: () => Navigator.pop(ctx, true),
              ),
            ],
          ),
        ),
      ),
    );
    if (ok != true) return;
    await _act({
      'action': 'ndr',
      'ndr_action': action,
      if (phone.text.trim().isNotEmpty) 'phone': phone.text.trim(),
      if (address.text.trim().isNotEmpty) 'address': address.text.trim(),
    }, done: action == 'return_to_origin' ? 'Coming back; a return was opened' : 'Re-attempt requested');
  }

  Future<void> _sendToRider() async {
    final res = await _act({'action': 'rider_link'});
    final msg = res?['message']?.toString();
    if (msg == null) return;
    var to = (res?['rider_phone'] ?? _parcel?['rider_phone'] ?? '').toString().replaceAll(RegExp(r'\D'), '');
    if (to.length == 10) to = '91$to';
    if (!mounted) return;
    await composeBusinessWhatsApp(context, widget.session.api, to: to, message: msg, title: 'Message the rider');
  }

  Future<void> _startReturn() async {
    final inv = _order['invoice_id']?.toString();
    if (inv == null) return;
    final id = await Navigator.of(context).push<String>(MaterialPageRoute(
      builder: (_) => StartReturnScreen(session: widget.session, invoiceId: inv, invoiceNumber: _order['invoice_number']?.toString()),
    ));
    if (id != null && mounted) {
      await _loadReturns();
      if (!mounted) return;
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ReturnDetailScreen(session: widget.session, id: id)));
      _load();
    }
  }

  Future<void> _more() async {
    final p = _parcel;
    final status = p?['status']?.toString();
    final next = fulfilmentTransitions[status] ?? const <String>[];
    final primary = primaryStep(status)?.$1;
    final codDue = p != null && toNum(p['cod_amount']) > 0 && p['cod_collected_at'] == null;
    final onRoad = status == 'shipped' || status == 'out_for_delivery' || status == 'delivery_failed';
    final riderMethod = p?['method'] == 'own_rider' || p?['method'] == 'local_app';
    await showKSheet<void>(
      context,
      title: 'More actions',
      scrollable: true,
      builder: (ctx) {
        void run(Future<void> Function() f) {
          Navigator.pop(ctx);
          f();
        }

        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (p == null) KSheetAction(icon: LucideIcons.truck, label: 'Start delivery tracking', onTap: () => run(() async => _act({'action': 'start'}))),
            if (riderMethod && onRoad) KSheetAction(icon: LucideIcons.messageCircle, label: 'Send drop to rider', subtitle: 'WhatsApp with address, cash and a status link', onTap: () => run(_sendToRider)),
            if (codDue && (status == 'delivered' || onRoad)) KSheetAction(icon: LucideIcons.banknote, label: 'Cash collected', onTap: () => run(() async => _act({'action': 'cod_collected'}, done: 'Cash marked collected'))),
            if (status == 'delivery_failed') KSheetAction(icon: LucideIcons.rotateCw, label: 'What next? (re-attempt / bring back)', onTap: () => run(_ndrSheet)),
            for (final to in next)
              if (to != primary && to != 'shipped' && to != 'ready_for_pickup' && to != 'delivery_failed')
                KSheetAction(
                  icon: to == 'cancelled' ? LucideIcons.ban : LucideIcons.arrowRight,
                  label: to == 'cancelled' ? 'Cancel order' : 'Mark ${deliveryLabels[to]?.toLowerCase()}',
                  danger: to == 'cancelled' || to == 'returned',
                  onTap: () => run(() => _move(to)),
                ),
            if (next.contains('delivery_failed')) KSheetAction(icon: LucideIcons.circleAlert, label: 'Could not deliver', danger: true, onTap: () => run(_failedSheet)),
            if (_order['invoice_id'] != null) KSheetAction(icon: LucideIcons.rotateCcw, label: 'Start a return', onTap: () => run(_startReturn)),
          ],
        );
      },
    );
  }

  // ---------- build ----------

  @override
  Widget build(BuildContext context) {
    final o = _order;
    final p = _parcel;
    final status = p?['status']?.toString() ?? o['delivery_status']?.toString();
    final step = primaryStep(status);
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: Text(o['order_number']?.toString() ?? 'Order'),
        actions: [if (_data != null) KIconButton(icon: LucideIcons.ellipsisVertical, tooltip: 'More', onTap: _more)],
      ),
      body: _data == null
          ? (_error != null ? KEmptyState(icon: LucideIcons.circleAlert, title: _error!) : const KSpinner())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 120),
                children: [
                  _hero(o, status),
                  if (_error != null) _banner(_error!, AppColors.negative, AppColors.negativeSoft),
                  if (_notice != null) _banner(_notice!, AppColors.positive, AppColors.positiveSoft),
                  if (_parcels.length > 1) ...[
                    const SizedBox(height: AppSpace.md),
                    KChipBar<String>(
                      padding: EdgeInsets.zero,
                      value: p?['id']?.toString(),
                      options: [for (final x in _parcels) (x['id'].toString(), 'Parcel ${x['seq']} · ${deliveryLabels[x['status']] ?? x['status']}')],
                      onChanged: (v) => setState(() => _activeId = v),
                    ),
                  ],
                  if (status == 'delivery_failed') ...[
                    const SizedBox(height: AppSpace.md),
                    KCard(
                      padding: const EdgeInsets.all(14),
                      child: Row(
                        children: [
                          const Icon(LucideIcons.circleAlert, color: AppColors.negative),
                          const SizedBox(width: 10),
                          Expanded(child: Text(p?['failure_reason']?.toString() ?? 'Delivery failed', style: AppText.bodyStrong)),
                          KTextButton(label: 'What next?', onTap: _ndrSheet),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSpace.md),
                  _shipTo(p),
                  const SizedBox(height: AppSpace.md),
                  _items(p),
                  if (p != null) ...[
                    const SizedBox(height: AppSpace.md),
                    _delivery(p),
                    const SizedBox(height: AppSpace.md),
                    _timeline(p),
                  ],
                  if (o['invoice_id'] != null) ...[
                    const SizedBox(height: AppSpace.md),
                    _returnsCard(),
                  ],
                ],
              ),
            ),
      bottomNavigationBar: _data == null
          ? null
          : KBottomBar(children: [
              if (p == null)
                Expanded(child: KButton(label: 'Start tracking', icon: LucideIcons.truck, loading: _busy, onPressed: () => _act({'action': 'start'})))
              else if (step != null)
                Expanded(
                  child: KButton(
                    label: step.$2,
                    icon: step.$1 == 'shipped' ? LucideIcons.send : LucideIcons.check,
                    loading: _busy,
                    onPressed: () => step.$1 == 'shipped' ? _dispatchSheet() : _move(step.$1),
                  ),
                )
              else
                Expanded(child: KButton.secondary(label: 'More actions', icon: LucideIcons.ellipsis, onPressed: _more)),
            ]),
    );
  }

  Widget _banner(String text, Color fg, Color bg) => Container(
        margin: const EdgeInsets.only(top: AppSpace.md),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(AppRadius.md)),
        child: Text(text, style: AppText.body.copyWith(color: fg)),
      );

  Widget _hero(Map<String, dynamic> o, String? status) {
    final (tone, label) = deliveryTone(status);
    final (ptone, plabel) = paymentTone(o['payment_status']?.toString());
    return KCard(
      raised: true,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(o['customer_name']?.toString() ?? 'Customer', style: AppText.heading)),
              KPill(label: label, tone: tone),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            [channelLabels[o['channel']] ?? '', o['customer_phone']?.toString() ?? '', if (o['invoice_number'] != null) 'Bill ${o['invoice_number']}']
                .where((s) => s.isNotEmpty)
                .join(' · '),
            style: AppText.caption,
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(child: KAmount(toNum(o['amount']), maxFraction: 2, style: AppText.amount.copyWith(fontSize: 26))),
              KPill(label: plabel, tone: ptone),
            ],
          ),
        ],
      ),
    );
  }

  Widget _shipTo(Map<String, dynamic>? p) {
    final shipTo = _data?['ship_to'] is Map ? Map<String, dynamic>.from(_data!['ship_to'] as Map) : const <String, dynamic>{};
    final address = (p?['ship_address'] ?? shipTo['address'])?.toString();
    final pin = (p?['ship_pincode'] ?? shipTo['pincode'])?.toString();
    if (p?['method'] == 'pickup') {
      return KInfoCard(title: 'Pickup', rows: [('Buyer collects from the shop', p?['pickup_code'] != null ? 'Code ${p!['pickup_code']}' : '')]);
    }
    return KInfoCard(
      title: 'Deliver to',
      rows: [
        ('Address', (address ?? '').isEmpty ? 'Not added yet' : address!),
        if ((pin ?? '').isNotEmpty) ('PIN', pin!),
        if (p != null && toNum(p['packages']) > 1) ('Boxes', '${p['packages']}'),
      ],
    );
  }

  Widget _items(Map<String, dynamic>? p) {
    final parcelItems = _list(p?['items']);
    final lines = parcelItems.isNotEmpty ? parcelItems : _list(_data?['lines']);
    return KCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(_parcels.length > 1 ? 'In this parcel' : 'Items', style: AppText.overline),
          const SizedBox(height: 8),
          if (lines.isEmpty) Text('Nothing left to send', style: AppText.caption),
          for (final l in lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Expanded(child: Text(l['name']?.toString() ?? 'Item', style: AppText.body)),
                  Text('× ${enIn(toNum(l['quantity']))}', style: AppText.bodyStrong),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _delivery(Map<String, dynamic> p) {
    final codAmt = toNum(p['cod_amount']);
    return KInfoCard(
      title: 'Delivery',
      rows: [
        if (p['partner_name'] != null) ('Courier', p['partner_name'].toString()),
        if (p['awb'] != null) ('Tracking no', p['awb'].toString()),
        if (p['rider_name'] != null || p['rider_phone'] != null)
          ('Rider', [p['rider_name'], p['rider_phone']].where((v) => v != null).join(' · ')),
        if (codAmt > 0) ('Cash on delivery', '${orderMoney(codAmt)} · ${p['cod_collected_at'] != null ? 'collected' : 'to collect'}'),
        if (p['weight_kg'] != null) ('Weight', '${p['weight_kg']} kg'),
      ],
      child: p['public_url'] != null
          ? Align(
              alignment: Alignment.centerLeft,
              child: KTextButton(
                label: 'Copy buyer tracking link',
                onTap: () async {
                  await Clipboard.setData(ClipboardData(text: p['public_url'].toString()));
                  if (mounted) setState(() => _notice = 'Tracking link copied');
                },
              ),
            )
          : null,
    );
  }

  Widget _timeline(Map<String, dynamic> p) {
    final events = _list(p['events']).reversed.toList();
    return KCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Timeline', style: AppText.overline),
          const SizedBox(height: 8),
          if (events.isEmpty) Text('No updates yet', style: AppText.caption),
          for (var i = 0; i < events.length; i++)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Column(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      margin: const EdgeInsets.only(top: 4),
                      decoration: BoxDecoration(color: i == 0 ? AppColors.brand : AppColors.hairline, shape: BoxShape.circle),
                    ),
                    if (i < events.length - 1) Container(width: 2, height: 30, color: AppColors.hairline),
                  ],
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(deliveryLabels[events[i]['status']] ?? events[i]['status'].toString(), style: AppText.bodyStrong),
                        Text(
                          [ageOf(events[i]['created_at']).isEmpty ? '' : '${ageOf(events[i]['created_at'])} ago', events[i]['note']?.toString() ?? '']
                              .where((s) => s.isNotEmpty)
                              .join(' · '),
                          style: AppText.caption,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _returnsCard() {
    return KCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 6, 4),
            child: Row(
              children: [
                Expanded(child: Text('Returns', style: AppText.overline)),
                KTextButton(label: 'Start return', onTap: _startReturn),
              ],
            ),
          ),
          if (_returns.isEmpty)
            Padding(padding: const EdgeInsets.fromLTRB(14, 0, 14, 14), child: Text('No returns on this order', style: AppText.caption))
          else
            KDivided(children: [
              for (final r in _returns)
                KListRow(
                  title: r['return_number'].toString(),
                  subtitle: '${enIn(toNum(r['total_qty']))} item(s)${toNum(r['credit_amount']) > 0 ? ' · ${orderMoney(r['credit_amount'])}' : ''}',
                  trailing: Builder(builder: (_) {
                    final (t, l) = returnTone(r['status'].toString());
                    return KPill(label: l, tone: t);
                  }),
                  onTap: () async {
                    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ReturnDetailScreen(session: widget.session, id: r['id'].toString())));
                    _load();
                  },
                ),
            ]),
        ],
      ),
    );
  }
}
