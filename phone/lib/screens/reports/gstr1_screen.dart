import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../sales/doc_action_sheets.dart';
import 'gst_kit.dart';
import 'gst_logic.dart';
import 'report_period.dart';
import 'table_report_screen.dart';

/// Website `/reports/gst/gstr1`: outward supplies of one month in sections, the filing status with "Mark as
/// filed", and the Excel download.
///
/// `GET /api/reports/gst/gstr1?month&year&customer_type` replies `summary` and one list per section (`b2b`,
/// `b2cl`, `b2cs`, `exports`, `sez`, `cdn`, `nil`, `hsn`) plus `filing_id` and `filing_period`
/// (`app/api/reports/gst/gstr1/route.ts`). The filing comes from `GET .../gstr1/filings` (`filings`). Every
/// figure is the server's.
class Gstr1Screen extends StatefulWidget {
  const Gstr1Screen({super.key, required this.session, this.shareFile = shareGstFile});

  final AppSession session;

  /// Where the downloaded workbook goes (the share sheet); tests replace it.
  final GstShareFile shareFile;

  @override
  State<Gstr1Screen> createState() => _Gstr1ScreenState();
}

class _Gstr1ScreenState extends State<Gstr1Screen> with GstLoader<Gstr1Screen> {
  MonthPeriod _month = MonthPeriod.of(DateTime.now());
  String _type = 'all';
  bool _busy = false;

  @override
  AppSession get gstSessionOf => widget.session;
  @override
  String get gstWhat => 'GSTR-1';
  @override
  String get gstTitle => 'GSTR-1';
  @override
  String gstPath() => gstr1Path(_month, _type);

  @override
  void initState() {
    super.initState();
    gstLoad();
  }

  /// The filing of the period, or null when the filings call fails (the report still shows).
  @override
  Future<dynamic> gstLoadExtra(dynamic body) async {
    final filings = await widget.session.api.getData('/api/reports/gst/gstr1/filings');
    return gstr1Filing(filings, filingId: docText(readPath(body, 'filing_id')), period: gstPeriodKey(_month));
  }

  void _reload(void Function() change) {
    setState(change);
    gstLoad();
  }

  Future<void> _markFiled(Map<String, dynamic> filing) async {
    final sure = await askSheet(
      context,
      title: 'Mark GSTR-1 as filed?',
      text: gstr1MarkFiledQuestion(filing),
      confirmLabel: 'Yes, mark as filed',
      cancelLabel: 'Not now',
    );
    if (!sure || !mounted || _busy) return;
    setState(() => _busy = true);
    final id = docText(filing['id']);
    final ok = await gstAct(context, () => widget.session.api.postJson('/api/reports/gst/gstr1/$id/mark-filed', const {}));
    if (mounted) setState(() => _busy = false);
    if (!ok || !mounted) return;
    showKToast(context, 'GSTR-1 marked as filed. All invoices have been locked.', tone: KTone.positive);
    await gstLoad(spinner: false);
  }

  Future<void> _download() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      List<int>? bytes;
      final ok = await gstAct(context, () async {
        final gate = gstReadinessGate(await widget.session.api.getData(gstReadinessPath('gstr1', _month)));
        if (!gate.ok) throw ApiException(gate.message!);
        bytes = await widget.session.api.getBytes(gstr1ExcelPath(_month));
      });
      if (!ok || bytes == null || !mounted) return;
      try {
        await widget.shareFile(bytes!, gstr1ExcelName(_month));
      } catch (_) {
        if (mounted) showKToast(context, 'Could not share the file. Try again.', tone: KTone.negative);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return gstScaffold(
      periodBar: MonthPeriodBar(period: _month, onChanged: (m) => _reload(() => _month = m)),
      filterBar: Padding(
        padding: const EdgeInsets.only(bottom: AppSpace.sm),
        child: KChipBar<String>(value: _type, options: gstr1CustomerTypes, onChanged: (v) => _reload(() => _type = v)),
      ),
      children: _children,
    );
  }

  List<Widget> _children() {
    final body = gstBody;
    final summary = readPath(body, 'summary');
    final filing = gstExtra is Map ? Map<String, dynamic>.from(gstExtra as Map) : null;
    String figure(String key, {bool money = true}) => reportCellText(readPath(summary, key), money: money);
    return [
      if (summary is Map)
        GstTiles(tiles: [
          ('Total taxable value', figure('total_outward_taxable_supplies')),
          ('Total tax', figure('total_tax_amount')),
          ('Total invoices', figure('invoice_count', money: false)),
          ('B2B count', figure('b2b_count', money: false)),
        ]),
      if (filing != null) ...[const SizedBox(height: AppSpace.lg), _filingCard(filing)],
      const SizedBox(height: AppSpace.lg),
      KButton.secondary(label: 'Download Excel', icon: LucideIcons.download, loading: _busy, onPressed: _download),
      const SizedBox(height: AppSpace.lg),
      _sections(body),
    ];
  }

  Widget _filingCard(Map<String, dynamic> filing) {
    final filed = docText(filing['status']) == 'filed';
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            KPill(label: filed ? 'Filed' : 'Draft', tone: filed ? KTone.positive : KTone.due),
            const SizedBox(width: AppSpace.md),
            Expanded(child: Text(gstr1FilingLine(filing), style: AppText.caption)),
          ]),
          if (!filed) ...[
            const SizedBox(height: AppSpace.md),
            KButton(label: 'Mark as filed', icon: LucideIcons.fileCheck, loading: _busy, onPressed: () => _markFiled(filing)),
          ],
        ],
      ),
    );
  }

  Widget _sections(dynamic body) {
    final shown = [
      for (final s in gstr1Sections)
        if (s.key != 'sez' || docRows(readPath(body, s.key), '').isNotEmpty) s,
    ];
    return KCard(
      child: KDivided(children: [
        for (final s in shown)
          KListRow(
            title: s.title,
            trailing: Text('${_rows(body, s).length}', style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
            onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => Gstr1SectionScreen(section: s, rows: _rows(body, s)))),
          ),
      ]),
    );
  }

  List<Map<String, dynamic>> _rows(dynamic body, Gstr1Section s) => docRows(readPath(body, s.key), '');
}

/// The rows of one GSTR-1 section; a row opens its columns.
class Gstr1SectionScreen extends StatelessWidget {
  const Gstr1SectionScreen({super.key, required this.section, required this.rows});

  final Gstr1Section section;
  final List<Map<String, dynamic>> rows;

  void _open(BuildContext context, Map<String, dynamic> row) {
    final title = section.rowTitle(row);
    showGstSheet<void>(
      context,
      title: title.isEmpty ? section.title : title,
      rows: [for (final c in section.columns) (c.label, reportCellText(readPath(row, c.key), money: c.money, qty: c.qty))],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(section.title),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xxl),
                children: [
                  if (rows.isEmpty)
                    gstEmpty(section.emptyText)
                  else
                    KCard(
                      child: KDivided(children: [
                        for (final r in rows)
                          KListRow(
                            title: section.rowTitle(r).isEmpty ? '—' : section.rowTitle(r),
                            subtitle: section.rowSubtitle(r),
                            trailing: Text(section.rowAmount(r), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                            onTap: () => _open(context, r),
                          ),
                      ]),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
