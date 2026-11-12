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
import '../sales/doc_action_sheets.dart';
import 'gst_kit.dart';
import 'gst_logic.dart';

String _t(Map<String, dynamic> r, String k) => docText(r[k]);
String _join(Iterable<String> parts) => parts.where((p) => p.trim().isNotEmpty).join(' · ');
String _m(dynamic v) => gstMoney(v);

String _when(dynamic v) {
  final d = docDate(v);
  return d == null ? '' : ddMMMyyyyHm(d);
}

String _sentence(String s) => s.isEmpty ? '' : s[0].toUpperCase() + s.substring(1).replaceAll('_', ' ');

/// Website `/eway-bills`: e-way bills recorded against documents, with validity. `GET /api/eway-bills?status=` replies
/// `eway_bills` (at most 200, newest first; `lib/gst/eway-bill-records.ts`), each with `status`, `valid_until`,
/// `hours_to_expiry`, `can_cancel` and `can_extend` worked out by the server. A bill opens its detail; "Record e-way
/// bill" adds one (`POST /api/eway-bills`) with the fields of the website's panel.
///
/// Importing the portal's CSV of inward e-way bills needs a file, so it stays on the website.
class EwayBillsScreen extends StatefulWidget {
  const EwayBillsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<EwayBillsScreen> createState() => _EwayBillsScreenState();
}

class _EwayBillsScreenState extends State<EwayBillsScreen> with GstLoader<EwayBillsScreen> {
  String _status = '';

  @override
  AppSession get gstSessionOf => widget.session;
  @override
  String get gstWhat => 'e-way bills';
  @override
  String get gstTitle => 'E-way bills';
  @override
  String gstPath() => _status.isEmpty ? '/api/eway-bills' : '/api/eway-bills?status=$_status';

  @override
  void initState() {
    super.initState();
    gstLoad();
  }

  @override
  Widget build(BuildContext context) {
    return gstScaffold(
      filterBar: Padding(
        padding: const EdgeInsets.only(bottom: AppSpace.sm),
        child: KChipBar<String>(
          value: _status,
          options: ewayStatuses,
          onChanged: (v) {
            setState(() => _status = v);
            gstLoad();
          },
        ),
      ),
      children: _children,
    );
  }

  Future<void> _add() async {
    final message = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => EwayBillFormScreen(session: widget.session)));
    if (message == null || !mounted) return;
    showKToast(context, message, tone: KTone.positive);
    await gstLoad(spinner: false);
  }

  Future<void> _openBill(Map<String, dynamic> bill) async {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => EwayBillDetailScreen(session: widget.session, billId: _t(bill, 'id'))));
    if (mounted) await gstLoad(spinner: false);
  }

  List<Widget> _children() {
    final bills = docRows(gstBody, 'eway_bills');
    return [
      KButton(label: 'Record e-way bill', icon: LucideIcons.plus, onPressed: _add),
      const SizedBox(height: AppSpace.sm),
      GstWebsiteButton(session: widget.session, label: 'Import inward e-way bills on the website', href: '/eway-bills', title: 'E-way bills'),
      const SizedBox(height: AppSpace.lg),
      if (bills.isEmpty)
        gstEmpty('No e-way bills recorded yet.')
      else
        KCard(
          child: KDivided(children: [
            for (final b in bills) _row(b),
          ]),
        ),
    ];
  }

  Widget _row(Map<String, dynamic> b) {
    final (tone, label) = statusTone(_t(b, 'status'));
    final left = ewayHoursLeft(b);
    final source = _t(b, 'source_number').isNotEmpty ? _t(b, 'source_number') : _sentence(_t(b, 'source_type'));
    return KListRow(
      title: _t(b, 'ewb_number'),
      subtitle: _join([_sentence(_t(b, 'direction')), source, _t(b, 'valid_until').isEmpty ? '' : 'Valid until ${_when(b['valid_until'])}']),
      trailing: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(_m(b['goods_value']), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
          const SizedBox(height: 4),
          KPill(label: label, tone: tone),
          if (left.isNotEmpty) Text(left, style: AppText.caption.copyWith(color: AppColors.due)),
        ],
      ),
      onTap: () => _openBill(b),
    );
  }
}

/// One e-way bill: `GET /api/eway-bills/[id]` replies `eway_bill`. What can be done comes from the server's flags:
/// cancel (`can_cancel`, within 24 hours of generation), extend (`can_extend`), close, reject (a bill sent to you) and
/// a new vehicle. Each is `PATCH /api/eway-bills/[id]` with `{ action }`, asks first, and the server's refusal shows
/// as a toast. The website page lists bills but has no screen for these; the route is the reference.
class EwayBillDetailScreen extends StatefulWidget {
  const EwayBillDetailScreen({super.key, required this.session, required this.billId});

  final AppSession session;
  final String billId;

  @override
  State<EwayBillDetailScreen> createState() => _EwayBillDetailScreenState();
}

class _EwayBillDetailScreenState extends State<EwayBillDetailScreen> with GstLoader<EwayBillDetailScreen> {
  bool _busy = false;

  @override
  AppSession get gstSessionOf => widget.session;
  @override
  String get gstWhat => 'the e-way bill';
  @override
  String get gstTitle => 'E-way bill';
  @override
  String gstPath() => '/api/eway-bills/${widget.billId}';

  @override
  void initState() {
    super.initState();
    gstLoad();
  }

  @override
  Widget build(BuildContext context) => gstScaffold(children: _children);

  Map<String, dynamic> get _bill => readPath(gstBody, 'eway_bill') is Map ? Map<String, dynamic>.from(readPath(gstBody, 'eway_bill') as Map) : const {};

  Future<void> _patch(Map<String, dynamic> body, String done) async {
    if (_busy) return;
    setState(() => _busy = true);
    final ok = await gstAct(context, () => widget.session.api.patchJson('/api/eway-bills/${widget.billId}', body));
    if (mounted) setState(() => _busy = false);
    if (!ok || !mounted) return;
    showKToast(context, done, tone: KTone.positive);
    await gstLoad(spinner: false);
  }

  Future<void> _cancel() async {
    final reason = await showGstReasonSheet(
      context,
      title: 'Cancel ${ewayName(_bill)}?',
      confirmLabel: 'Cancel bill',
      hint: 'Reason (optional)',
    );
    if (reason == null || !mounted) return;
    await _patch(ewayCancelBody(reason), 'E-way bill cancelled');
  }

  Future<void> _reject() async {
    final reason = await showGstReasonSheet(
      context,
      title: 'Reject ${ewayName(_bill)}?',
      confirmLabel: 'Reject bill',
      hint: 'Reason (optional)',
    );
    if (reason == null || !mounted) return;
    await _patch(ewayRejectBody(reason), 'E-way bill rejected');
  }

  Future<void> _close() async {
    final sure = await askSheet(
      context,
      title: 'Close this e-way bill?',
      text: 'Close ${ewayName(_bill)}? It is marked closed and cannot be used again.',
      confirmLabel: 'Yes, close it',
      cancelLabel: 'Not now',
    );
    if (!sure || !mounted) return;
    await _patch(ewayCloseBody, 'E-way bill closed');
  }

  Future<void> _extend() async {
    final message = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => EwayExtendScreen(session: widget.session, bill: _bill)));
    if (message == null || !mounted) return;
    showKToast(context, message, tone: KTone.positive);
    await gstLoad(spinner: false);
  }

  Future<void> _vehicle() async {
    final message = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => EwayVehicleScreen(session: widget.session, bill: _bill)));
    if (message == null || !mounted) return;
    showKToast(context, message, tone: KTone.positive);
    await gstLoad(spinner: false);
  }

  List<Widget> _children() {
    final b = _bill;
    if (b.isEmpty) return [gstEmpty('E-way bill not found')];
    final (tone, label) = statusTone(_t(b, 'status'));
    final active = _t(b, 'status') == 'active';
    final left = ewayHoursLeft(b);
    String km() => docNum(b['distance_km']) == null ? '' : '${docNum(b['distance_km'])!.toInt()} km';
    final rows = <(String, String)>[
      ('E-way bill', _t(b, 'ewb_number')),
      ('Direction', _sentence(_t(b, 'direction'))),
      ('Document', _t(b, 'source_number').isNotEmpty ? _t(b, 'source_number') : _sentence(_t(b, 'source_type'))),
      ('Document type', _sentence(_t(b, 'doc_type'))),
      ('Sub-supply type', _sentence(_t(b, 'sub_supply_type'))),
      ('Generated', _when(b['generated_at'])),
      ('Valid until', _when(b['valid_until'])),
      ('Distance', km()),
      ('Goods value', _m(b['goods_value'])),
      ('Over-dimensional cargo', b['is_odc'] == true ? 'Yes' : ''),
      ('From GSTIN', _t(b, 'from_gstin')),
      ('To GSTIN', _t(b, 'to_gstin')),
      ('From PIN code', _t(b, 'from_pincode')),
      ('To PIN code', _t(b, 'to_pincode')),
      ('Vehicle', _t(b, 'vehicle_number')),
      ('Transporter', _t(b, 'transporter_name')),
      ('Extensions', (docNum(b['extension_count']) ?? 0) > 0 ? '${docNum(b['extension_count'])!.toInt()}' : ''),
      ('Notes', _t(b, 'notes')),
    ];
    return [
      Row(children: [
        KPill(label: label, tone: tone),
        if (left.isNotEmpty) ...[const SizedBox(width: AppSpace.md), Text(left, style: AppText.caption.copyWith(color: AppColors.due))],
      ]),
      const SizedBox(height: AppSpace.md),
      KInfoCard(title: 'Details', rows: [for (final r in rows) if (r.$2.isNotEmpty) r]),
      const SizedBox(height: AppSpace.lg),
      if (b['can_extend'] == true) ...[KButton(label: 'Extend validity', icon: LucideIcons.clock, loading: _busy, onPressed: _extend), const SizedBox(height: AppSpace.sm)],
      if (active) ...[KButton.secondary(label: 'Change vehicle', icon: LucideIcons.truck, onPressed: _vehicle), const SizedBox(height: AppSpace.sm)],
      if (active) ...[KButton.secondary(label: 'Close e-way bill', onPressed: _close), const SizedBox(height: AppSpace.sm)],
      if (active && _t(b, 'direction') == 'inward') ...[KButton(label: 'Reject e-way bill', kind: KButtonKind.danger, onPressed: _reject), const SizedBox(height: AppSpace.sm)],
      if (b['can_cancel'] == true) KButton(label: 'Cancel e-way bill', kind: KButtonKind.danger, onPressed: _cancel),
    ];
  }
}

/// Extend the validity (`PATCH` `{ action: 'extend', remaining_km }`). The server works out the new validity.
class EwayExtendScreen extends StatefulWidget {
  const EwayExtendScreen({super.key, required this.session, required this.bill});

  final AppSession session;
  final Map<String, dynamic> bill;

  @override
  State<EwayExtendScreen> createState() => _EwayExtendScreenState();
}

class _EwayExtendScreenState extends State<EwayExtendScreen> {
  final _km = TextEditingController();

  @override
  void initState() {
    super.initState();
    _km.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _km.dispose();
    super.dispose();
  }

  num? get _typed => gstTypedAmount(_km.text);

  Future<void> _save() async {
    final km = _typed;
    if (km == null) return;
    final sure = await askSheet(
      context,
      title: 'Extend validity?',
      text: 'Extend ${ewayName(widget.bill)} for ${km.toInt()} km more? The server works out the new validity, one day for every 200 km.',
      confirmLabel: 'Extend now',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted) return;
    await widget.session.api.patchJson('/api/eway-bills/${_t(widget.bill, 'id')}', ewayExtendBody(km));
    if (mounted) Navigator.of(context).pop('Validity extended');
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Extend e-way bill validity',
      saveLabel: 'Review extension',
      onSave: _save,
      canSave: _typed != null,
      dirty: _km.text.isNotEmpty,
      children: [
        Text('Valid until ${_when(widget.bill['valid_until'])}. Validity can be extended from 8 hours before expiry to 8 hours after it.', style: AppText.caption),
        KTextField(label: 'Distance still to go (km)', controller: _km, keyboard: TextInputType.number),
      ],
    );
  }
}

/// Part B: a new vehicle or transporter (`PATCH` `{ action: 'vehicle', vehicle_number, transporter_name }`).
class EwayVehicleScreen extends StatefulWidget {
  const EwayVehicleScreen({super.key, required this.session, required this.bill});

  final AppSession session;
  final Map<String, dynamic> bill;

  @override
  State<EwayVehicleScreen> createState() => _EwayVehicleScreenState();
}

class _EwayVehicleScreenState extends State<EwayVehicleScreen> {
  final _vehicle = TextEditingController();
  final _transporter = TextEditingController();

  @override
  void initState() {
    super.initState();
    for (final c in [_vehicle, _transporter]) {
      c.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    _vehicle.dispose();
    _transporter.dispose();
    super.dispose();
  }

  bool get _ready => _vehicle.text.trim().isNotEmpty || _transporter.text.trim().isNotEmpty;

  Future<void> _save() async {
    if (!_ready) return;
    final sure = await askSheet(
      context,
      title: 'Change vehicle?',
      text: 'Update the vehicle on ${ewayName(widget.bill)}${_vehicle.text.trim().isEmpty ? '' : ' to ${_vehicle.text.trim()}'}? This is the Part B update on the portal.',
      confirmLabel: 'Change now',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted) return;
    await widget.session.api.patchJson(
      '/api/eway-bills/${_t(widget.bill, 'id')}',
      ewayVehicleBody(vehicle: _vehicle.text, transporter: _transporter.text),
    );
    if (mounted) Navigator.of(context).pop('Vehicle updated');
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Change vehicle details',
      saveLabel: 'Review vehicle change',
      onSave: _save,
      canSave: _ready,
      dirty: _ready,
      children: [
        KTextField(label: 'Vehicle number', controller: _vehicle, caps: true),
        KTextField(label: 'Transporter', controller: _transporter),
      ],
    );
  }
}

/// Record an e-way bill generated on the GST portal (`POST /api/eway-bills`), the fields of the website's
/// "Record e-way bill" panel (`components/eway-bills/EwayBillPanel.tsx`). A bill added from the list is not linked to
/// a document (`source_type: other`). The number is 12 digits and the server checks the rest: distance up to 4000 km,
/// generation time not in the future, a number not already recorded. Pops the toast text on success.
class EwayBillFormScreen extends StatefulWidget {
  const EwayBillFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<EwayBillFormScreen> createState() => _EwayBillFormScreenState();
}

class _EwayBillFormScreenState extends State<EwayBillFormScreen> {
  final _number = TextEditingController();
  final _distance = TextEditingController();
  final _value = TextEditingController();
  final _vehicle = TextEditingController();
  final _transporter = TextEditingController();
  late final TextEditingController _time;
  DateTime _date = dateOnly(DateTime.now());
  String _direction = 'outward';
  String _docType = 'tax_invoice';
  String _subSupply = 'supply';
  bool _odc = false;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _time = TextEditingController(text: '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}');
    for (final c in [_number, _distance, _value, _vehicle, _transporter, _time]) {
      c.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    for (final c in [_number, _distance, _value, _vehicle, _transporter, _time]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _ready => RegExp(r'^\d{12}$').hasMatch(_number.text.trim()) && docNum(_distance.text.trim()) != null;

  DateTime _generatedAt() {
    final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(_time.text.trim());
    final h = m == null ? null : int.parse(m.group(1)!);
    final min = m == null ? null : int.parse(m.group(2)!);
    if (h == null || min == null || h > 23 || min > 59) throw ApiException('Enter the time as HH:MM, for example 14:30');
    return DateTime(_date.year, _date.month, _date.day, h, min);
  }

  Future<void> _save() async {
    if (!_ready) return;
    final reply = await widget.session.api.postJson(
      '/api/eway-bills',
      ewayCreateBody(
        direction: _direction,
        number: _number.text,
        generatedAt: _generatedAt(),
        distanceKm: docNum(_distance.text.trim())!,
        odc: _odc,
        docType: _docType,
        subSupply: _subSupply,
        goodsValue: gstTypedAmount(_value.text) ?? 0,
        vehicle: _vehicle.text,
        transporter: _transporter.text,
      ),
    );
    final until = _when(readPath(reply, 'eway_bill.valid_until'));
    if (mounted) Navigator.of(context).pop(until.isEmpty ? 'E-way bill recorded' : 'E-way bill recorded, valid until $until');
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Record e-way bill',
      saveLabel: 'Save e-way bill',
      onSave: _save,
      canSave: _ready,
      dirty: _number.text.isNotEmpty || _distance.text.isNotEmpty,
      children: [
        KPickField<String>(label: 'Direction', value: _direction, options: ewayDirections, onChanged: (v) => setState(() => _direction = v)),
        KTextField(label: 'E-way bill number (12 digits)', controller: _number, keyboard: TextInputType.number, maxLength: 12),
        KDateField(label: 'Generated on', value: _date, last: DateTime.now(), onChanged: (d) => setState(() => _date = dateOnly(d))),
        KTextField(label: 'Time (HH:MM)', controller: _time, keyboard: TextInputType.datetime),
        KTextField(label: 'Distance (km)', controller: _distance, keyboard: TextInputType.number),
        KAmountField(label: 'Goods value', controller: _value),
        KToggleField(label: 'Over-dimensional cargo (20 km a day)', value: _odc, onChanged: (v) => setState(() => _odc = v)),
        KPickField<String>(label: 'Document type', value: _docType, options: ewayDocTypes, onChanged: (v) => setState(() => _docType = v)),
        KPickField<String>(label: 'Sub-supply type', value: _subSupply, options: ewaySubSupplyTypes, onChanged: (v) => setState(() => _subSupply = v)),
        KTextField(label: 'Vehicle number', controller: _vehicle, caps: true),
        KTextField(label: 'Transporter', controller: _transporter),
        Text('Valid for one day per 200 km, ending at midnight.', style: AppText.caption),
      ],
    );
  }
}
