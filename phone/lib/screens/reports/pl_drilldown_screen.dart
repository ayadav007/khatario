import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../accounting/books_logic.dart' show ledgerVoucherWords;
import '../accounting/journal_entries_screen.dart';
import '../docs/doc_logic.dart';
import '../invoices/invoice_detail_screen.dart';
import '../purchases/purchase_section.dart';
import 'report_period.dart';
import 'statement_kit.dart';
import 'statement_pdf.dart';

/// What a tapped Profit & Loss figure opens, as the website's `DrillTarget`: a list of its parts
/// (`breakdown`) or the server's entries for one `line`.
class PlDrillTarget {
  const PlDrillTarget.entries({required this.label, this.line = 'account', this.accountIds = const [], this.section})
      : total = null,
        parts = const [],
        note = null;

  const PlDrillTarget.breakdown({required this.label, required this.total, required this.parts, this.note})
      : line = 'breakdown',
        accountIds = const [],
        section = null;

  final String label;

  /// `account`, `purchases`, `opening_stock`, `closing_stock` or `breakdown`.
  final String line;
  final List<String> accountIds;
  final String? section;
  final num? total;
  final List<PlDrillPart> parts;
  final String? note;

  bool get isBreakdown => line == 'breakdown';
}

/// One row of a breakdown: its server amount, `+1` or `-1`, and what it opens (nothing when null).
class PlDrillPart {
  const PlDrillPart({required this.label, required this.amount, required this.sign, this.target});

  final String label;
  final num amount;
  final int sign;
  final PlDrillTarget? target;
}

/// Opens [target]: its parts for a breakdown, otherwise the entries behind it.
void openPlTarget(BuildContext context, AppSession session, ReportPeriod period, PlDrillTarget target, {String? financialYear}) {
  final Widget screen = target.isBreakdown
      ? PlBreakdownScreen(session: session, period: period, target: target, financialYear: financialYear)
      : PlDrilldownScreen(
          session: session,
          title: target.label,
          period: period,
          accountIds: target.accountIds,
          section: target.section,
          line: target.line,
          financialYear: financialYear,
        );
  Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
}

/// The parts of a section total or profit figure, each drillable further. Amounts are the server's.
class PlBreakdownScreen extends StatelessWidget {
  const PlBreakdownScreen({super.key, required this.session, required this.period, required this.target, this.financialYear});

  final AppSession session;
  final ReportPeriod period;
  final PlDrillTarget target;
  final String? financialYear;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(target.label),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter + 2, 0, AppSpace.gutter, AppSpace.xs),
              child: Text(period.label, style: AppText.caption),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xxl),
                children: [
                  if (target.total != null) StatementHeadline(tiles: [('Total', target.total!, null)]),
                  if (target.note != null) Padding(padding: const EdgeInsets.only(top: AppSpace.md), child: Text(target.note!, style: AppText.caption)),
                  const SizedBox(height: AppSpace.md),
                  KCard(child: KDivided(children: [for (final p in target.parts) _row(context, p)])),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(BuildContext context, PlDrillPart p) {
    final t = p.target;
    return InkWell(
      onTap: t == null ? null : () => openPlTarget(context, session, period, t, financialYear: financialYear),
      highlightColor: AppColors.sunken,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        child: Row(
          children: [
            SizedBox(width: 18, child: Text(p.sign > 0 ? '+' : '−', style: AppText.caption)),
            Expanded(child: Text(p.label, style: AppText.body)),
            const SizedBox(width: AppSpace.md),
            Text(statementMoney(p.amount), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
            if (t != null) Padding(padding: const EdgeInsets.only(left: 4), child: Icon(LucideIcons.chevronRight, size: 16, color: AppColors.ink3)),
          ],
        ),
      ),
    );
  }
}

/// The entries behind one Profit & Loss line, from `GET /api/reports/profit-loss/drilldown`.
///
/// The route replies `kind`, `title`, `total`, `count`, `truncated` (more than 500 vouchers) and
/// `rows`, each with `voucher_id`, `voucher_type`, `entry_date`, `document_number`, `party_name`,
/// `narration`, `amount`, `source_missing` and `link`. Every figure is the server's; the phone adds nothing up.
class PlDrilldownScreen extends StatefulWidget {
  const PlDrilldownScreen({
    super.key,
    required this.session,
    required this.title,
    required this.period,
    required this.accountIds,
    required this.section,
    this.line = 'account',
    this.financialYear,
  });

  final AppSession session;
  final String title;
  final ReportPeriod period;
  final List<String> accountIds;
  final String? section;

  /// `account`, `purchases`, `opening_stock` or `closing_stock`.
  final String line;
  final String? financialYear;

  @override
  State<PlDrilldownScreen> createState() => _PlDrilldownScreenState();
}

class _PlDrilldownScreenState extends State<PlDrilldownScreen> {
  Map<String, dynamic>? _body;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final body = await widget.session.api.getJson(plDrillPath(widget.period, widget.accountIds, widget.section, line: widget.line, financialYear: widget.financialYear));
      if (mounted) setState(() { _body = body; _loading = false; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  /// A row opens its source where the phone has a screen and the server says the source exists.
  void _open(Map<String, dynamic> row) {
    final id = docText(row['voucher_id']);
    if (id.isEmpty || row['source_missing'] == true || docText(row['link']).isEmpty) return;
    final session = widget.session;
    final Widget? screen = switch (docText(row['voucher_type'])) {
      'invoice' => InvoiceDetailScreen(api: session.api, invoiceId: id, businessName: session.businessName, session: session),
      'purchase' => PurchaseDetailScreen(session: session, title: 'Purchase', path: '/api/purchases/$id', objectKey: 'purchase', kind: PurchaseKind.bills),
      'journal' => JournalDetailScreen(session: session, voucherId: id),
      _ => null,
    };
    if (screen != null) Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
  }

  bool _openable(Map<String, dynamic> row) =>
      docText(row['voucher_id']).isNotEmpty &&
      row['source_missing'] != true &&
      docText(row['link']).isNotEmpty &&
      const {'invoice', 'purchase', 'journal'}.contains(docText(row['voucher_type']));

  @override
  Widget build(BuildContext context) {
    final title = docText(_body?['title']).isNotEmpty ? docText(_body?['title']) : widget.title;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(title),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter + 2, 0, AppSpace.gutter, AppSpace.xs),
              child: Text(widget.period.label, style: AppText.caption),
            ),
            Expanded(child: _content()),
          ],
        ),
      ),
    );
  }

  Widget _content() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null) {
      return ListView(children: [
        KEmptyState(
          icon: LucideIcons.cloudOff,
          title: 'Could not load the entries',
          body: _error,
          action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    final rows = docRows(_body, 'rows');
    final items = _body?['kind'] == 'items';
    final total = docNum(_body?['total']);
    final count = docNum(_body?['count']);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xxl),
        children: [
          if (total != null)
            StatementHeadline(tiles: [
              ('Total', total, null),
              if (count != null) ('Entries', count, null),
            ]),
          if (_body?['truncated'] == true)
            Padding(
              padding: const EdgeInsets.only(top: AppSpace.md),
              child: Text('Showing the first 500 of ${count?.toInt() ?? 'more'} entries.', style: AppText.caption),
            ),
          const SizedBox(height: AppSpace.md),
          if (rows.isEmpty)
            const KEmptyState(icon: LucideIcons.fileText, title: 'No entries in this period')
          else
            KCard(child: KDivided(children: [for (final r in rows) items ? _itemRow(r) : _row(r)])),
        ],
      ),
    );
  }

  /// Opening or closing stock: one item with its quantity, unit cost and value, all the server's.
  Widget _itemRow(Map<String, dynamic> r) {
    final qty = docNum(r['quantity']);
    final unit = docNum(r['unit_cost']);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(docText(r['item_name']).isEmpty ? '—' : docText(r['item_name']), style: AppText.bodyStrong),
                if (qty != null && unit != null)
                  Padding(padding: const EdgeInsets.only(top: 2), child: Text('${enIn(qty, maxFraction: 3)} × ${statementMoney(unit)}', style: AppText.caption)),
              ],
            ),
          ),
          const SizedBox(width: AppSpace.md),
          Text(statementMoney(docNum(r['total_value']) ?? 0), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> r) {
    final date = docDate(r['entry_date']);
    final number = docText(r['document_number']);
    final words = ledgerVoucherWords(r);
    final party = docText(r['party_name']);
    final narration = docText(r['narration']);
    final openable = _openable(r);
    return InkWell(
      onTap: openable ? () => _open(r) : null,
      highlightColor: AppColors.sunken,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(date == null ? '—' : ddMMMyyyy(date), style: AppText.caption),
                  const SizedBox(height: 2),
                  Text(number.isNotEmpty ? number : words, style: AppText.bodyStrong),
                  if (number.isNotEmpty && words.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(words, style: AppText.caption)),
                  if (party.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(party, style: AppText.caption)),
                  if (narration.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(narration, style: AppText.caption)),
                ],
              ),
            ),
            const SizedBox(width: AppSpace.md),
            Text(
              statementMoney(docNum(r['amount']) ?? 0),
              style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular),
            ),
            if (openable) Padding(padding: const EdgeInsets.only(left: 4, top: 2), child: Icon(LucideIcons.chevronRight, size: 16, color: AppColors.ink3)),
          ],
        ),
      ),
    );
  }
}
