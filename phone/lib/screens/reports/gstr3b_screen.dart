import 'package:flutter/material.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../docs/doc_logic.dart';
import 'gst_cash_ledger_screen.dart';
import 'gst_kit.dart';
import 'gst_logic.dart';
import 'report_period.dart';
import 'statement_kit.dart';

/// Website `/reports/gst/gstr3b`: the return of one month. `GET /api/reports/gst/gstr3b?month&year` replies the
/// tables the website draws (3.1, 3.2, 4 and 5), the `summary`, the `reconciliation` against GSTR-1 and
/// `warnings`; the cash balances at the end of the month come from `GET /api/gst/cash-ledger?as_on_date`
/// (a second call that may fail without hiding the return). Every figure is the server's.
///
/// "Export JSON" and "Mark GSTR-3B as filed" stay on the website for now.
class Gstr3bScreen extends StatefulWidget {
  const Gstr3bScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<Gstr3bScreen> createState() => _Gstr3bScreenState();
}

class _Gstr3bScreenState extends State<Gstr3bScreen> with GstLoader<Gstr3bScreen> {
  MonthPeriod _month = MonthPeriod.of(DateTime.now());

  @override
  AppSession get gstSessionOf => widget.session;
  @override
  String get gstWhat => 'GSTR-3B';
  @override
  String get gstTitle => 'GSTR-3B';
  @override
  String gstPath() => gstr3bPath(_month);

  @override
  void initState() {
    super.initState();
    gstLoad();
  }

  @override
  Future<dynamic> gstLoadExtra(dynamic body) => widget.session.api.getData('/api/gst/cash-ledger?as_on_date=${gstMonthEnd(_month)}');

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

  static String _fmt(dynamic v) => statementMoney(toNum(v));

  List<Widget> _children() {
    final d = gstBody is Map ? Map<String, dynamic>.from(gstBody as Map) : <String, dynamic>{};
    final summary = d['summary'] is Map ? Map<String, dynamic>.from(d['summary'] as Map) : null;
    final recon = d['reconciliation'] is Map ? Map<String, dynamic>.from(d['reconciliation'] as Map) : null;
    final rcmAnalysis = readPath(d, 'ledger_basis.rcm_itc_analysis');
    final warnings = [for (final w in (d['warnings'] is List ? d['warnings'] as List : const [])) docText(w)].where((w) => w.isNotEmpty).toList();
    final itc = d['itc_details'] is Map ? Map<String, dynamic>.from(d['itc_details'] as Map) : null;
    final unregistered = d['inter_state_supplies_unregistered'];
    return [
      if (recon?['status'] == 'mismatch' || (d['rcm_mode'] == 'pooled' && toNum(readPath(d, 'rcm.total')) > 0))
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpace.md),
          child: Wrap(spacing: AppSpace.sm, runSpacing: AppSpace.sm, children: [
            if (recon?['status'] == 'mismatch') const KPill(label: 'Mismatch detected', tone: KTone.negative),
            if (d['rcm_mode'] == 'pooled' && toNum(readPath(d, 'rcm.total')) > 0) const KPill(label: 'RCM not classified', tone: KTone.due),
          ]),
        ),
      if (summary != null)
        StatementHeadline(tiles: [
          ('Total tax liability', toNum(summary['total_tax_liability']), null),
          ('Total ITC available', toNum(summary['total_itc']), null),
          ('Net tax payable', toNum(summary['net_tax_payable']), null),
        ]),
      if (gstExtra is Map) _cashCard(Map<String, dynamic>.from(gstExtra as Map)),
      if (recon != null)
        Padding(
          padding: const EdgeInsets.only(top: AppSpace.lg),
          child: KInfoCard(title: 'Ledger vs GSTR-1 (output tax 2150–2152)', rows: [
            ('Status', docText(recon['status'])),
            ('Ledger total', _fmt(recon['ledger_total'])),
            ('GSTR-1 total', _fmt(recon['gstr1_total'])),
            ('Difference', _fmt(recon['difference'])),
            ('Difference % of ledger', '${toNum(recon['difference_percent']).toStringAsFixed(2)}%'),
          ]),
        ),
      if (rcmAnalysis is Map)
        Padding(
          padding: const EdgeInsets.only(top: AppSpace.lg),
          child: KInfoCard(title: 'RCM output vs ITC claimed (ledger)', rows: [
            ('RCM output total', _fmt(rcmAnalysis['rcm_output_total'])),
            ('ITC claimed total', _fmt(rcmAnalysis['itc_claimed_total'])),
            if (rcmAnalysis['possible_rcm_itc_mismatch'] == true) ('Possible mismatch', 'RCM with no ITC in period — review purchases / 1110–1112.'),
          ]),
        ),
      if (warnings.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: AppSpace.lg),
          child: KCard(
            padding: const EdgeInsets.all(AppSpace.lg),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Warnings', style: AppText.bodyStrong),
              for (final w in warnings) Padding(padding: const EdgeInsets.only(top: AppSpace.sm), child: Text(w, style: AppText.body)),
            ]),
          ),
        ),
      const SizedBox(height: AppSpace.lg),
      const KSectionHeader('3.1 - Details of Outward Supplies and inward supplies liable to reverse charge'),
      for (final r in gstr3bTable31(d)) gstTaxRowCard(r.label, r.data, gstTaxHeads),
      if (unregistered is List) ...[
        const SizedBox(height: AppSpace.lg),
        const KSectionHeader('3.2 - Inter-state supplies to unregistered persons (out of 3.1(a))'),
        if (unregistered.isEmpty)
          Text('No inter-state supplies to unregistered persons in this period.', style: AppText.caption)
        else
          for (final r in docRows(unregistered, ''))
            gstTaxRowCard(docText(r['place_of_supply']), r, const [('Taxable value', 'taxable_value'), ('IGST', 'igst')]),
      ],
      if (itc != null) ...[
        const SizedBox(height: AppSpace.lg),
        const KSectionHeader('4 - Eligible ITC'),
        for (final r in gstr3bTable4(itc)) gstTaxRowCard(r.label, r.data, gstTaxHeads),
      ],
      const SizedBox(height: AppSpace.lg),
      const KSectionHeader('5 - Tax Liability'),
      gstTaxRowCard('From outward and reverse charge inward supplies', d['tax_liability'], gstTaxHeads),
      const SizedBox(height: AppSpace.lg),
      GstWebsiteButton(session: widget.session, label: 'Export JSON on the website', href: '/reports/gst/gstr3b', title: 'GSTR-3B'),
    ];
  }

  Widget _cashCard(Map<String, dynamic> cash) {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpace.lg),
      child: KCard(
        padding: const EdgeInsets.all(AppSpace.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text('Electronic cash ledger', style: AppText.bodyStrong)),
            KTextButton(
              label: 'Open ledger',
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => GstCashLedgerScreen(session: widget.session))),
            ),
          ]),
          GstFigureRows(rows: [
            for (final h in const ['igst', 'cgst', 'sgst', 'cess']) (h.toUpperCase(), _fmt(readPath(cash, '$h.cash_balance'))),
          ]),
        ]),
      ),
    );
  }
}
