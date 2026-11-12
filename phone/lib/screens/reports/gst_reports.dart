import 'package:flutter/material.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../pages/native_routes.dart';
import '../sales/doc_action_sheets.dart';
import 'gst_cash_ledger_screen.dart';
import 'gst_kit.dart';
import 'gst_logic.dart';
import 'gstr1_screen.dart';
import 'gstr2b_screen.dart';
import 'gstr3b_screen.dart';
import 'report_period.dart';
import 'table_report_screen.dart';

/// The website's GST pages (`app/(app)/reports/gst/*`). GSTR-9 stays on the website (`websiteByDesign`).
const gstReportHrefs = <String>[
  '/reports/gst/gstr1',
  '/reports/gst/gstr3b',
  '/reports/gst/gstr2b',
  '/reports/gst/gstr2b-reconciliation',
  '/reports/gst/reconciliation',
  '/reports/gst/compliance',
  '/reports/gst/cash-ledger',
];

/// The screen for one GST href, or null when it is not one.
Widget? gstReportScreen(AppSession session, String href) => switch (href) {
      '/reports/gst/gstr1' => Gstr1Screen(session: session),
      '/reports/gst/gstr3b' => Gstr3bScreen(session: session),
      '/reports/gst/gstr2b' => Gstr2bScreen(session: session),
      '/reports/gst/gstr2b-reconciliation' => Gstr2bReconciliationScreen(session: session),
      '/reports/gst/reconciliation' => Gstr13bReconciliationScreen(session: session),
      '/reports/gst/compliance' => GstAlertsScreen(session: session),
      '/reports/gst/cash-ledger' => GstCashLedgerScreen(session: session),
      _ => null,
    };

String _m(dynamic v) => reportCellText(v, money: true);
String _t(Map<String, dynamic> r, String k) => docText(r[k]);
String _join(Iterable<String> parts) => parts.where((p) => p.trim().isNotEmpty).join(' · ');

// ---------------------------------------------------------------- GSTR-1 vs GSTR-3B

/// Website `/reports/gst/reconciliation`: GSTR-1 against GSTR-3B for one month. `GET /api/reports/gst/reconciliation
/// ?period=YYYY-MM&mode` replies `status`, `totals`, `head_wise`, `categories`, `stats`, `exceptions`, `warnings` and
/// `insights` (`lib/gst/gstr1-3b-reconciliation.ts`). Every figure and every difference is the server's.
///
/// The website's alert notification settings and voucher table stay on the website.
class Gstr13bReconciliationScreen extends StatefulWidget {
  const Gstr13bReconciliationScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<Gstr13bReconciliationScreen> createState() => _Gstr13bReconciliationScreenState();
}

class _Gstr13bReconciliationScreenState extends State<Gstr13bReconciliationScreen> with GstLoader<Gstr13bReconciliationScreen> {
  MonthPeriod _month = MonthPeriod.of(DateTime.now());
  String _mode = 'live_vs_live';

  @override
  AppSession get gstSessionOf => widget.session;
  @override
  String get gstWhat => 'the reconciliation';
  @override
  String get gstTitle => 'GSTR-1 vs 3B';
  @override
  String gstPath() => gstReconciliationPath(_month, _mode);

  @override
  void initState() {
    super.initState();
    gstLoad();
  }

  void _reload(void Function() change) {
    setState(change);
    gstLoad();
  }

  @override
  Widget build(BuildContext context) {
    return gstScaffold(
      periodBar: MonthPeriodBar(period: _month, onChanged: (m) => _reload(() => _month = m)),
      filterBar: Padding(
        padding: const EdgeInsets.only(bottom: AppSpace.sm),
        child: KChipBar<String>(value: _mode, options: gstReconModes, onChanged: (v) => _reload(() => _mode = v)),
      ),
      children: _children,
    );
  }

  Map<String, dynamic> _map(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : const {};

  List<Widget> _children() {
    final d = _map(gstBody);
    if (d.isEmpty) return [gstEmpty('Nothing to compare for this month')];
    final totals = _map(d['totals']);
    final stats = _map(d['stats']);
    final heads = _map(d['head_wise']);
    final categories = _map(d['categories']);
    final exceptions = docRows(d['exceptions'], '');
    final warnings = [for (final w in (d['warnings'] is List ? d['warnings'] as List : const [])) docText(w)].where((w) => w.isNotEmpty);
    final modeLabel = docText(readPath(d, 'insights.context.mode_label'));
    final matched = _t(d, 'status') == 'matched';
    return [
      Row(children: [
        KPill(label: matched ? 'Matched' : 'Mismatch', tone: matched ? KTone.positive : KTone.negative),
        const SizedBox(width: AppSpace.md),
        Expanded(child: Text(modeLabel.isEmpty ? gstReconModes.firstWhere((m) => m.$1 == _mode).$2 : modeLabel, style: AppText.caption)),
      ]),
      const SizedBox(height: AppSpace.md),
      GstTiles(tiles: [
        ('GSTR-1 tax', _m(totals['gstr1'])),
        ('GSTR-3B tax', _m(totals['gstr3b'])),
        ('Difference', _m(totals['difference'])),
      ]),
      const SizedBox(height: AppSpace.xl),
      const KSectionHeader('Head-wise output tax'),
      _headTable(heads),
      const SizedBox(height: AppSpace.xl),
      const KSectionHeader('Vouchers'),
      GstTiles(tiles: [
        ('Vouchers compared', reportCellText(stats['total_vouchers_compared'], qty: true)),
        ('Matched', reportCellText(stats['matched'], qty: true)),
        ('Mismatched', reportCellText(stats['mismatched'], qty: true)),
        ('Missing (1↔3B)', '−3B: ${reportCellText(stats['missing_in_ledger'], qty: true)} | −1: ${reportCellText(stats['missing_in_gstr1'], qty: true)}'),
      ]),
      for (final (key, title) in const [
        ('outward_taxable', 'Outward taxable'),
        ('zero_rated', 'Zero rated'),
        ('inward_rcm', 'RCM (inward)'),
        ('cdn_adjustments', 'CDN adjustments'),
      ]) ...[
        if (categories[key] is Map) ..._category(key, title, _map(categories[key])),
      ],
      const SizedBox(height: AppSpace.xl),
      const KSectionHeader('Exceptions'),
      if (exceptions.isEmpty)
        Text('No structured exceptions — voucher-level view may still show matched rows only.', style: AppText.caption)
      else
        KCard(
          child: KDivided(children: [
            for (final e in exceptions)
              KListRow(
                title: gstExceptionLabels[_t(e, 'type')] ?? _t(e, 'type'),
                subtitle: _t(e, 'details'),
                trailing: docNum(e['difference']) == null ? null : Text(_m(e['difference']), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
              ),
          ]),
        ),
      if (warnings.isNotEmpty) ...[
        const SizedBox(height: AppSpace.lg),
        KCard(
          padding: const EdgeInsets.all(AppSpace.lg),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Warnings', style: AppText.bodyStrong),
            for (final w in warnings) Padding(padding: const EdgeInsets.only(top: AppSpace.sm), child: Text(w, style: AppText.body)),
          ]),
        ),
      ],
    ];
  }

  Widget _headTable(Map<String, dynamic> heads) {
    final style = AppText.body.copyWith(fontFeatures: AppText.tabular);
    Widget cell(String text, {TextStyle? s, TextAlign align = TextAlign.end}) =>
        Expanded(child: Text(text, textAlign: align, maxLines: 1, overflow: TextOverflow.ellipsis, style: s ?? style));
    return KCard(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.lg, vertical: AppSpace.sm),
      child: Column(children: [
        Row(children: [
          cell('Tax head', s: AppText.caption, align: TextAlign.start),
          cell('GSTR-1', s: AppText.caption),
          cell('GSTR-3B', s: AppText.caption),
          cell('Difference', s: AppText.caption),
        ]),
        for (final h in const ['igst', 'cgst', 'sgst', 'cess'])
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpace.sm),
            child: Row(children: [
              cell(h.toUpperCase(), s: AppText.bodyStrong, align: TextAlign.start),
              cell(_m(readPath(heads, '$h.gstr1'))),
              cell(_m(readPath(heads, '$h.gstr3b'))),
              cell(
                _m(readPath(heads, '$h.difference')),
                s: style.copyWith(color: readPath(heads, '$h.status') == 'mismatch' ? AppColors.negative : null),
              ),
            ]),
          ),
      ]),
    );
  }

  List<Widget> _category(String key, String title, Map<String, dynamic> c) {
    final diff = _map(c['difference']);
    const parts = [('taxable value', 'taxable_value'), ('IGST', 'igst'), ('CGST', 'cgst'), ('SGST', 'sgst'), ('Cess', 'cess')];
    return [
      const SizedBox(height: AppSpace.lg),
      KInfoCard(title: title, rows: [
        ('GSTR-1 taxable value', _m(readPath(c, 'gstr1.taxable_value'))),
        ('GSTR-3B taxable value', _m(readPath(c, 'gstr3b.taxable_value'))),
        for (final (label, k) in parts)
          if ((docNum(diff[k]) ?? 0).abs() >= 0.005) ('Difference $label', _m(diff[k])),
      ]),
      if (_t(c, 'note').isNotEmpty) Padding(padding: const EdgeInsets.only(top: AppSpace.sm), child: Text(_t(c, 'note'), style: AppText.caption)),
    ];
  }
}

// ---------------------------------------------------------------- GST alerts

/// Website `/reports/gst/compliance` (the GST Alert Center). `GET /api/gst/compliance-alerts` replies `alerts` (active),
/// `dismissed`, `resolved` (this financial year), `checked_at` and `skipped`. The website has no manual "resolve": an
/// alert closes when its check stops finding the problem. What the user can do is dismiss an active alert with a reason
/// and restore a dismissed one (`POST` `{ alert_id, action: 'dismiss' | 'restore', reason }`), which is what this does.
/// The business and the user come from the session.
class GstAlertsScreen extends StatefulWidget {
  const GstAlertsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<GstAlertsScreen> createState() => _GstAlertsScreenState();
}

class _GstAlertsScreenState extends State<GstAlertsScreen> with GstLoader<GstAlertsScreen> {
  String _tab = 'alerts';
  bool _busy = false;

  @override
  AppSession get gstSessionOf => widget.session;
  @override
  String get gstWhat => 'GST alerts';
  @override
  String get gstTitle => 'GST alerts';
  @override
  String gstPath() => '/api/gst/compliance-alerts';

  @override
  void initState() {
    super.initState();
    gstLoad();
  }

  @override
  Widget build(BuildContext context) => gstScaffold(children: _children);

  List<Map<String, dynamic>> _list(String key) => docRows(readPath(gstBody, key), '');

  List<Widget> _children() {
    final skipped = readPath(gstBody, 'skipped');
    if (skipped != null && skipped != false && '$skipped'.isNotEmpty) {
      return [
        KCard(
          padding: const EdgeInsets.all(AppSpace.lg),
          child: Text(
            'These checks apply to businesses registered under GST, and your business profile has no GSTIN. If that is wrong, update the GST details in your business profile.',
            style: AppText.body,
          ),
        ),
      ];
    }
    final active = _list('alerts');
    final resolved = _list('resolved');
    final dismissed = _list('dismissed');
    int severity(String s) => active.where((a) => _t(a, 'severity') == s).length;
    final shown = switch (_tab) {
      'resolved' => resolved,
      'dismissed' => dismissed,
      _ => active,
    };
    final checkedAt = docDate(readPath(gstBody, 'checked_at'));
    return [
      if (checkedAt != null) Padding(padding: const EdgeInsets.only(bottom: AppSpace.md), child: Text('Last checked ${ddMMMyyyyHm(checkedAt)}', style: AppText.caption)),
      GstTiles(tiles: [
        ('Act now', '${severity('critical')}'),
        ('Due soon', '${severity('warning')}'),
        ('Reminders', '${severity('info')}'),
        ('Resolved this FY', '${resolved.length}'),
      ]),
      const SizedBox(height: AppSpace.lg),
      KChipBar<String>(
        value: _tab,
        padding: EdgeInsets.zero,
        options: [('alerts', 'Active (${active.length})'), ('resolved', 'Resolved this FY (${resolved.length})'), ('dismissed', 'Dismissed (${dismissed.length})')],
        onChanged: (v) => setState(() => _tab = v),
      ),
      const SizedBox(height: AppSpace.md),
      if (shown.isEmpty)
        gstEmpty(switch (_tab) {
          'resolved' => 'No alerts resolved this financial year yet',
          'dismissed' => 'No dismissed alerts',
          _ => 'No GST alerts right now',
        }, body: _tab == 'alerts' ? 'We will notify you when a deadline comes close.' : null)
      else
        KCard(
          child: KDivided(children: [
            for (final a in shown)
              KListRow(
                title: _t(a, 'title'),
                subtitle: _join([gstCheckOf(_t(a, 'check_id')).chip, _dateNote(a)]),
                trailing: _amountOf(a) == null ? null : Text(_amountOf(a)!, style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                onTap: () => _open(a),
              ),
          ]),
        ),
      const SizedBox(height: AppSpace.lg),
      Text(
        'Alerts close by themselves once your books no longer show the problem. Alerts are general information from the GST law applied to your books, not tax advice. Please check with your CA for your case.',
        style: AppText.caption,
      ),
    ];
  }

  String? _amountOf(Map<String, dynamic> a) {
    final impact = gstCheckOf(_t(a, 'check_id')).impact;
    final n = docNum(a['amount']);
    return impact != null && n != null && n > 0 ? _m(n) : null;
  }

  String _dateNote(Map<String, dynamic> a) {
    if (_tab == 'resolved') return _t(a, 'resolved_at').isEmpty ? '' : 'Resolved ${reportCellText(a['resolved_at'])}';
    if (_tab == 'dismissed') return _t(a, 'dismissed_at').isEmpty ? '' : 'Dismissed ${reportCellText(a['dismissed_at'])}';
    return _t(a, 'due_date').isEmpty ? '' : 'Due ${reportCellText(a['due_date'])}';
  }

  Future<void> _open(Map<String, dynamic> alert) async {
    final meta = gstCheckOf(_t(alert, 'check_id'));
    final url = _t(alert, 'action_url');
    final isDismissed = _tab == 'dismissed';
    final isActive = _tab == 'alerts';
    final choice = await showGstSheet<String>(
      context,
      title: _t(alert, 'title'),
      before: [
        Text(_t(alert, 'message'), style: AppText.body),
        const SizedBox(height: AppSpace.sm),
        Text(_t(alert, 'legal_ref'), style: AppText.caption),
        const SizedBox(height: AppSpace.md),
      ],
      rows: [
        ('Check', meta.chip),
        if (_t(alert, 'due_date').isNotEmpty) ('Due date', reportCellText(alert['due_date'])),
        if (_amountOf(alert) != null) (meta.impact!, _amountOf(alert)!),
        if (isDismissed && _t(alert, 'dismissed_reason').isNotEmpty) ('Dismissed because', _t(alert, 'dismissed_reason')),
        if (isDismissed && _t(alert, 'dismissed_by_name').isNotEmpty) ('Dismissed by', _t(alert, 'dismissed_by_name')),
      ],
      after: [
        if (url.isNotEmpty && _t(alert, 'action_label').isNotEmpty)
          Builder(builder: (ctx) => KButton.secondary(label: _t(alert, 'action_label'), onPressed: () => Navigator.of(ctx).pop('open'))),
        if (isActive)
          Builder(builder: (ctx) => Padding(padding: const EdgeInsets.only(top: AppSpace.sm), child: KButton(label: 'Dismiss alert', kind: KButtonKind.danger, onPressed: () => Navigator.of(ctx).pop('dismiss')))),
        if (isDismissed) Builder(builder: (ctx) => KButton(label: 'Restore alert', onPressed: () => Navigator.of(ctx).pop('restore'))),
      ],
    );
    if (!mounted) return;
    switch (choice) {
      case 'open':
        openAppHref(context, widget.session, url, _t(alert, 'action_label'));
      case 'dismiss':
        await _dismiss(alert);
      case 'restore':
        await _restore(alert);
    }
  }

  Future<void> _dismiss(Map<String, dynamic> alert) async {
    final reason = await showGstReasonSheet(
      context,
      title: 'Dismiss "${_t(alert, 'title')}"?',
      confirmLabel: 'Dismiss',
      hint: 'Why are you dismissing it? (3 to 300 characters)',
    );
    if (reason == null || !mounted) return;
    if (!gstReasonOk(reason)) return showKToast(context, 'Give a reason for dismissing this alert (3 to 300 characters)', tone: KTone.negative);
    await _post(gstDismissBody(_t(alert, 'id'), reason), 'Alert dismissed');
  }

  Future<void> _restore(Map<String, dynamic> alert) async {
    final sure = await askSheet(
      context,
      title: 'Show this alert again?',
      text: 'Show "${_t(alert, 'title')}" in the active list again?',
      confirmLabel: 'Yes, restore',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted) return;
    await _post(gstRestoreBody(_t(alert, 'id')), 'Alert is active again');
  }

  Future<void> _post(Map<String, dynamic> body, String done) async {
    if (_busy) return;
    setState(() => _busy = true);
    final ok = await gstAct(context, () => widget.session.api.postJson('/api/gst/compliance-alerts', body));
    if (mounted) setState(() => _busy = false);
    if (!ok || !mounted) return;
    showKToast(context, done, tone: KTone.positive);
    await gstLoad(spinner: false);
  }
}
