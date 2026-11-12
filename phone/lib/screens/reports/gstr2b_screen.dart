import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../../format.dart';
import '../../ui/form_kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../sales/doc_action_sheets.dart';
import 'gst_kit.dart';
import 'gst_logic.dart';
import 'report_period.dart';
import 'table_report_screen.dart';

String _t(Map<String, dynamic> r, String k) => docText(r[k]);
String _join(Iterable<String> parts) => parts.where((p) => p.trim().isNotEmpty).join(' · ');

/// One table of the 2B report: its title, what a row says and the columns a tap shows.
class _Table {
  const _Table(this.key, this.title, this.empty, this.rowTitle, this.rowSubtitle, this.rowAmount, this.columns);

  final String key, title, empty;
  final String Function(Map<String, dynamic>) rowTitle, rowSubtitle;
  final String? Function(Map<String, dynamic>) rowAmount;
  final List<ReportColumn> columns;
}

final _tables = <_Table>[
  _Table(
    'b2b',
    'B2B purchases',
    'No B2B purchases found',
    (r) => _t(r, 'bill_number'),
    (r) => _join([_t(r, 'supplier_name'), _t(r, 'bill_date'), 'ITC eligible ${_t(r, 'itc_eligible')}']),
    (r) => gstMoney(r['bill_value']),
    const [
      ReportColumn('GSTIN', 'supplier_gstin'),
      ReportColumn('Supplier', 'supplier_name'),
      ReportColumn('Bill no', 'bill_number'),
      ReportColumn('Date', 'bill_date'),
      ReportColumn('Value', 'bill_value', money: true),
      ReportColumn('Taxable', 'taxable_value', money: true),
      ReportColumn('IGST', 'igst', money: true),
      ReportColumn('CGST', 'cgst', money: true),
      ReportColumn('SGST', 'sgst', money: true),
      ReportColumn('ITC eligible', 'itc_eligible'),
    ],
  ),
  _Table(
    'imports',
    'Imports',
    'No import entries found',
    (r) => _t(r, 'bill_number'),
    (r) => _join([_t(r, 'port_code'), _t(r, 'bill_date')]),
    (r) => gstMoney(r['bill_value']),
    const [
      ReportColumn('Port code', 'port_code'),
      ReportColumn('Bill no', 'bill_number'),
      ReportColumn('Date', 'bill_date'),
      ReportColumn('Value', 'bill_value', money: true),
      ReportColumn('Taxable', 'taxable_value', money: true),
      ReportColumn('IGST', 'igst', money: true),
      ReportColumn('Cess', 'cess', money: true),
    ],
  ),
  _Table(
    'cdnr',
    'Credit and debit notes',
    'No credit/debit notes found',
    (r) => _t(r, 'note_number'),
    (r) => _join([_t(r, 'supplier_name'), _t(r, 'note_date'), _t(r, 'note_type') == 'C' ? 'Credit' : 'Debit']),
    (r) => gstMoney(r['note_value']),
    const [
      ReportColumn('GSTIN', 'supplier_gstin'),
      ReportColumn('Supplier', 'supplier_name'),
      ReportColumn('Note no', 'note_number'),
      ReportColumn('Date', 'note_date'),
      ReportColumn('Value', 'note_value', money: true),
      ReportColumn('Taxable', 'taxable_value', money: true),
    ],
  ),
  _Table(
    'itc_summary',
    'ITC summary',
    'No ITC data available',
    (r) => _t(r, 'description'),
    (r) => _join(['IGST ${gstMoney(r['igst'])}', 'CGST ${gstMoney(r['cgst'])}', 'SGST ${gstMoney(r['sgst'])}', 'Cess ${gstMoney(r['cess'])}']),
    (r) => null,
    const [
      ReportColumn('Description', 'description'),
      ReportColumn('IGST', 'igst', money: true),
      ReportColumn('CGST', 'cgst', money: true),
      ReportColumn('SGST', 'sgst', money: true),
      ReportColumn('Cess', 'cess', money: true),
    ],
  ),
];

/// Website `/reports/gst/gstr2b`: the auto-drafted ITC statement of one month. `GET /api/reports/gst/gstr2b?month&year`
/// replies `summary`, `b2b`, `imports`, `cdnr` and `itc_summary` (`lib/gst/gstr2b.ts`). Every figure is the server's.
///
/// Importing the 2B file needs a file upload and stays on the website; so do the CSV and JSON exports.
class Gstr2bScreen extends StatefulWidget {
  const Gstr2bScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<Gstr2bScreen> createState() => _Gstr2bScreenState();
}

class _Gstr2bScreenState extends State<Gstr2bScreen> with GstLoader<Gstr2bScreen> {
  MonthPeriod _month = MonthPeriod.of(DateTime.now());

  @override
  AppSession get gstSessionOf => widget.session;
  @override
  String get gstWhat => 'GSTR-2B';
  @override
  String get gstTitle => 'GSTR-2B';
  @override
  String gstPath() => gstr2bPath(_month);

  @override
  void initState() {
    super.initState();
    gstLoad();
  }

  @override
  Widget build(BuildContext context) {
    return gstScaffold(
      periodBar: MonthPeriodBar(period: _month, onChanged: (m) {
        setState(() => _month = m);
        gstLoad();
      }),
      children: _children,
    );
  }

  void _openRow(_Table table, Map<String, dynamic> row) {
    final title = table.rowTitle(row);
    showGstSheet<void>(
      context,
      title: title.isEmpty ? table.title : title,
      rows: [for (final c in table.columns) (c.label, reportCellText(readPath(row, c.key), money: c.money, qty: c.qty))],
    );
  }

  List<Widget> _children() {
    final summary = readPath(gstBody, 'summary');
    String figure(String key, {bool money = true}) => reportCellText(readPath(summary, key), money: money);
    return [
      if (summary is Map)
        GstTiles(tiles: [
          ('Total inward supplies', figure('total_inward_supplies')),
          ('Total tax', figure('total_tax_amount')),
          ('ITC eligible', figure('total_itc_eligible')),
          ('Total bills', figure('purchase_count', money: false)),
        ]),
      const SizedBox(height: AppSpace.lg),
      KButton.secondary(
        label: 'Reconcile with books',
        onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => Gstr2bReconciliationScreen(session: widget.session))),
      ),
      const SizedBox(height: AppSpace.md),
      GstWebsiteButton(session: widget.session, label: 'Import 2B file on the website', href: '/reports/gst/gstr2b-reconciliation', title: 'GSTR-2B reconciliation'),
      for (final table in _tables) ...[
        const SizedBox(height: AppSpace.xl),
        KSectionHeader(table.title),
        _tableCard(table),
      ],
    ];
  }

  Widget _tableCard(_Table table) {
    final rows = docRows(readPath(gstBody, table.key), '');
    if (rows.isEmpty) return Text(table.empty, style: AppText.caption);
    return KCard(
      child: KDivided(children: [
        for (final r in rows)
          KListRow(
            title: table.rowTitle(r).isEmpty ? '—' : table.rowTitle(r),
            subtitle: table.rowSubtitle(r),
            trailing: table.rowAmount(r) == null ? null : Text(table.rowAmount(r)!, style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
            onTap: () => _openRow(table, r),
          ),
      ]),
    );
  }
}

/// Website `/reports/gst/gstr2b-reconciliation`: the purchase register against GSTR-2B for one filing period.
/// `GET /api/gst/gstr2b/reconcile?filing_period` replies `summary` (count and ITC per match status),
/// `missing_references` and `invoices` with the books and 2B figures, their differences and any decision. The
/// business is the signed-in session's: the phone sends no `business_id` in the query or in any body.
///
/// Decisions (`POST /api/gst/gstr2b/decision`) and "Run reconciliation" (`POST .../reconcile`) are native: each asks
/// first, posts once and reloads. Importing the 2B file needs a file upload and stays on the website.
class Gstr2bReconciliationScreen extends StatefulWidget {
  const Gstr2bReconciliationScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<Gstr2bReconciliationScreen> createState() => _Gstr2bReconciliationScreenState();
}

class _Gstr2bReconciliationScreenState extends State<Gstr2bReconciliationScreen> with GstLoader<Gstr2bReconciliationScreen> {
  MonthPeriod _month = MonthPeriod.of(DateTime.now());
  String _status = 'ALL';

  @override
  AppSession get gstSessionOf => widget.session;
  @override
  String get gstWhat => 'the reconciliation';
  @override
  String get gstTitle => 'GSTR-2B reconciliation';
  @override
  String gstPath() => gstr2bReconcilePath(_month);

  @override
  void initState() {
    super.initState();
    gstLoad();
  }

  static const _href = '/reports/gst/gstr2b-reconciliation';

  bool _busy = false;

  Future<void> _decide(Map<String, dynamic> inv) async {
    final message = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => Gstr2bDecisionScreen(session: widget.session, invoice: inv, period: gstPeriodKey(_month))),
    );
    if (message == null || !mounted) return;
    showKToast(context, message, tone: KTone.positive);
    await gstLoad(spinner: false);
  }

  /// `POST /api/gst/gstr2b/reconcile` `{ filing_period }`: matches the purchase register with the imported 2B data again.
  Future<void> _run() async {
    final period = gstPeriodKey(_month);
    final sure = await askSheet(
      context,
      title: 'Run reconciliation?',
      text: 'Run the GSTR-2B reconciliation for $period? It matches your purchase register with the imported 2B data again. Your decisions are kept.',
      confirmLabel: 'Run now',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted || _busy) return;
    setState(() => _busy = true);
    Map<String, dynamic>? reply;
    final ok = await gstAct(context, () async => reply = await widget.session.api.postJson('/api/gst/gstr2b/reconcile', gstReconcileBody(_month)));
    if (mounted) setState(() => _busy = false);
    if (!ok || !mounted) return;
    final n = (docNum(reply?['total_invoices']) ?? 0).toInt();
    final left = reply?['missing_references'] is List ? (reply!['missing_references'] as List).length : 0;
    showKToast(
      context,
      left > 0 ? 'Reconciliation completed. $n invoices processed. $left without a bill number were left out.' : 'Reconciliation completed. $n invoices processed.',
      tone: KTone.positive,
    );
    await gstLoad(spinner: false);
  }

  @override
  Widget build(BuildContext context) {
    return gstScaffold(
      periodBar: MonthPeriodBar(period: _month, onChanged: (m) {
        setState(() {
          _month = m;
          _status = 'ALL';
        });
        gstLoad();
      }),
      children: _children,
    );
  }

  Map<String, dynamic> _summaryOf(String key) {
    final s = readPath(gstBody, 'summary.$key');
    return s is Map ? Map<String, dynamic>.from(s) : const {};
  }

  Future<void> _openInvoice(Map<String, dynamic> inv) async {
    final books = inv['books'] is Map ? Map<String, dynamic>.from(inv['books'] as Map) : const <String, dynamic>{};
    final twoB = inv['gstr2b'] is Map ? Map<String, dynamic>.from(inv['gstr2b'] as Map) : const <String, dynamic>{};
    final diff = inv['differences'] is Map ? Map<String, dynamic>.from(inv['differences'] as Map) : const <String, dynamic>{};
    const parts = [('Taxable value', 'taxable_value'), ('IGST', 'igst'), ('CGST', 'cgst'), ('SGST', 'sgst'), ('Cess', 'cess')];
    final decision = _t(inv, 'decision');
    final wants = await showGstSheet<bool>(
      context,
      title: _t(inv, 'invoice_number').isEmpty ? 'Invoice' : _t(inv, 'invoice_number'),
      rows: [
        ('Supplier GSTIN', _t(inv, 'supplier_gstin')),
        ('Date', reportCellText(inv['invoice_date'])),
        ('Status', gstMatchLabel(_t(inv, 'match_status'))),
        for (final (label, key) in parts) ('Books $label', gstMoney(books[key])),
        ('Books ITC', gstMoney(books['itc_amount'])),
        for (final (label, key) in parts) ('GSTR-2B $label', gstMoney(twoB[key])),
        if (_t(twoB, 'itc_eligibility').isNotEmpty) ('GSTR-2B ITC eligibility', _t(twoB, 'itc_eligibility')),
        for (final (label, key) in parts) ('Difference $label', gstMoney(diff[key])),
        ('Decision', decision.isEmpty ? 'No decision' : gstDecisionLabel(decision)),
        if (_t(inv, 'remarks').isNotEmpty) ('Remarks', _t(inv, 'remarks')),
        if (docNum(inv['eligible_itc_amount']) != null) ('Eligible ITC', gstMoney(inv['eligible_itc_amount'])),
        if (_t(inv, 'deferred_to_period').isNotEmpty) ('Deferred to', _t(inv, 'deferred_to_period')),
        if (_t(inv, 'decided_by_name').isNotEmpty) ('Decided by', _t(inv, 'decided_by_name')),
      ],
      after: [
        Builder(builder: (ctx) => KButton(label: decision.isEmpty ? 'Record decision' : 'Update decision', onPressed: () => Navigator.of(ctx).pop(true))),
      ],
    );
    if (wants == true && mounted) await _decide(inv);
  }

  List<Widget> _children() {
    final invoices = docRows(readPath(gstBody, 'invoices'), '');
    final missing = docRows(readPath(gstBody, 'missing_references'), '');
    final summaryEmpty = readPath(gstBody, 'summary') is! Map || (readPath(gstBody, 'summary') as Map).isEmpty;
    final shown = _status == 'ALL' ? invoices : [for (final i in invoices) if (_t(i, 'match_status') == _status) i];
    int count(String key) => (docNum(_summaryOf(key)['count']) ?? 0).toInt();
    return [
      KCard(
        padding: const EdgeInsets.all(AppSpace.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('ITC eligibility is based on GSTR-2B', style: AppText.bodyStrong),
          const SizedBox(height: AppSpace.xs),
          Text(
            'As per GST law, GSTR-2B is the final authority for ITC eligibility. Books of accounts are NOT the authority. All mismatches require your decision. No automatic adjustments are made.',
            style: AppText.caption,
          ),
        ]),
      ),
      const SizedBox(height: AppSpace.md),
      GstWebsiteButton(session: widget.session, label: 'Import 2B file on the website', href: _href, title: 'GSTR-2B reconciliation'),
      const SizedBox(height: AppSpace.sm),
      KButton(label: 'Run reconciliation', icon: LucideIcons.refreshCw, loading: _busy, onPressed: _run),
      if (missing.isNotEmpty) ...[
        const SizedBox(height: AppSpace.lg),
        KCard(
          padding: const EdgeInsets.all(AppSpace.lg),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${missing.length} document${missing.length == 1 ? '' : 's'} left out of matching', style: AppText.bodyStrong),
            const SizedBox(height: AppSpace.xs),
            Text(
              'These purchases have no supplier bill number, so they were not matched. Enter the number printed on the bill, then run reconciliation again.',
              style: AppText.caption,
            ),
            for (final m in missing)
              Padding(
                padding: const EdgeInsets.only(top: AppSpace.sm),
                child: Text(_join([_t(m, 'purchase_id').isEmpty ? 'Statement line' : 'Purchase', reportCellText(m['bill_date']) == '—' ? '' : reportCellText(m['bill_date']), 'no bill number']), style: AppText.body),
              ),
          ]),
        ),
      ],
      if (!summaryEmpty) ...[
        const SizedBox(height: AppSpace.lg),
        _statusTiles(),
      ],
      const SizedBox(height: AppSpace.lg),
      KChipBar<String>(
        value: _status,
        padding: EdgeInsets.zero,
        options: [
          ('ALL', 'All invoices (${invoices.length})'),
          for (final (key, label) in gstMatchStatuses) (key, '$label (${count(key)})'),
        ],
        onChanged: (v) => setState(() => _status = v),
      ),
      const SizedBox(height: AppSpace.md),
      if (shown.isEmpty)
        gstEmpty('No invoices found', body: 'Import GSTR-2B data on the website, then run reconciliation.')
      else
        KCard(
          child: KDivided(children: [
            for (final inv in shown)
              KListRow(
                title: _t(inv, 'invoice_number').isEmpty ? '—' : _t(inv, 'invoice_number'),
                subtitle: _join([
                  _t(inv, 'supplier_gstin'),
                  reportCellText(inv['invoice_date']),
                  gstMatchLabel(_t(inv, 'match_status')),
                  _t(inv, 'decision').isEmpty ? '' : gstDecisionLabel(_t(inv, 'decision')),
                ]),
                trailing: Text(gstMoney(readPath(inv, 'books.itc_amount')), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                onTap: () => _openInvoice(inv),
              ),
          ]),
        ),
    ];
  }

  Widget _statusTiles() {
    final tiles = <Widget>[];
    for (final (key, label) in gstMatchStatuses) {
      final s = _summaryOf(key);
      tiles.add(KCard(
        padding: const EdgeInsets.all(AppSpace.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: AppText.caption, maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: AppSpace.xs),
          Text('${(docNum(s['count']) ?? 0).toInt()}', style: AppText.amount),
          if (s.isNotEmpty) Text('ITC ${gstMoney(s['total_gstr2b_itc'])}', style: AppText.caption),
        ]),
      ));
    }
    return Column(children: [
      for (var i = 0; i < tiles.length; i += 2) ...[
        if (i > 0) const SizedBox(height: AppSpace.md),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: tiles[i]),
          const SizedBox(width: AppSpace.md),
          Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox.shrink()),
        ]),
      ],
    ]);
  }
}

/// Record or change the decision on one reconciliation line (`POST /api/gst/gstr2b/decision`), the fields of the
/// website's "Record Decision" dialog: decision, eligible ITC amount (when eligible), the period it is deferred to
/// (when deferred) and remarks. The business and the user come from the session. Asks first naming the line, the
/// books ITC and the period. Pops the toast text on success.
class Gstr2bDecisionScreen extends StatefulWidget {
  const Gstr2bDecisionScreen({super.key, required this.session, required this.invoice, required this.period});

  final AppSession session;
  final Map<String, dynamic> invoice;

  /// The filing period on screen, `2026-11`.
  final String period;

  @override
  State<Gstr2bDecisionScreen> createState() => _Gstr2bDecisionScreenState();
}

class _Gstr2bDecisionScreenState extends State<Gstr2bDecisionScreen> {
  late String _decision = _t(widget.invoice, 'decision').isEmpty ? 'PENDING_SUPPLIER_CORRECTION' : _t(widget.invoice, 'decision');
  late final String _initialDecision = _decision;
  late final _amount = TextEditingController(text: docNum(widget.invoice['eligible_itc_amount']) == null ? '' : jsNumberString(docNum(widget.invoice['eligible_itc_amount'])!));
  late final _defer = TextEditingController(text: _t(widget.invoice, 'deferred_to_period'));
  late final _remarks = TextEditingController(text: _t(widget.invoice, 'remarks'));
  late final String _initialAmount = _amount.text, _initialDefer = _defer.text, _initialRemarks = _remarks.text;

  @override
  void initState() {
    super.initState();
    for (final c in [_amount, _defer, _remarks]) {
      c.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _defer.dispose();
    _remarks.dispose();
    super.dispose();
  }

  bool get _eligible => _decision == 'ITC_ELIGIBLE_THIS_PERIOD';
  bool get _deferred => _decision == 'ITC_DEFERRED_TO_FUTURE';
  num? get _typedAmount => gstTypedAmount(_amount.text);
  bool get _deferOk => !_deferred || gstPeriodTextOk(_defer.text);

  Future<void> _save() async {
    if (!_deferOk) return;
    final number = _t(widget.invoice, 'invoice_number');
    final books = gstMoney(readPath(widget.invoice, 'books.itc_amount'));
    final sure = await askSheet(
      context,
      title: 'Record this decision?',
      text: 'Record "${gstDecisionName(_decision)}" for $number (${_t(widget.invoice, 'supplier_gstin')}), books ITC $books, in ${widget.period}?'
          '${_eligible && _typedAmount != null ? ' Eligible ITC ${inr(_typedAmount!, maxFraction: 2)}.' : ''}'
          '${_deferred && _defer.text.trim().isNotEmpty ? ' Deferred to ${_defer.text.trim()}.' : ''}'
          ' This changes the ITC you can claim; nothing is adjusted automatically.',
      confirmLabel: 'Yes, record it',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted) return;
    await widget.session.api.postJson(
      '/api/gst/gstr2b/decision',
      gstDecisionBody(
        reconciliationId: _t(widget.invoice, 'id'),
        decision: _decision,
        remarks: _remarks.text,
        eligibleItc: _typedAmount,
        deferredTo: _defer.text,
      ),
    );
    if (mounted) Navigator.of(context).pop('Decision recorded');
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Record ITC decision',
      saveLabel: 'Review decision',
      onSave: _save,
      canSave: _deferOk,
      dirty: _decision != _initialDecision || _amount.text != _initialAmount || _defer.text != _initialDefer || _remarks.text != _initialRemarks,
      children: [
        Text('${_t(widget.invoice, 'invoice_number')} · ${_t(widget.invoice, 'supplier_gstin')}', style: AppText.caption),
        KPickField<String>(label: 'Decision', value: _decision, options: gstDecisions, onChanged: (v) => setState(() => _decision = v)),
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_eligible) KAmountField(label: 'Eligible ITC amount', controller: _amount),
            if (_deferred) KTextField(label: 'Defer to period (YYYY-MM)', controller: _defer, hint: '2026-12', error: _deferOk ? null : 'Use YYYY-MM'),
          ],
        ),
        KTextField(label: 'Remarks', controller: _remarks, maxLines: 3, minLines: 1, hint: 'Add any remarks or notes...'),
      ],
    );
  }
}
