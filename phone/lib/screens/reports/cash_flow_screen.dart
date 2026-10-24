import 'package:flutter/material.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'report_period.dart';
import 'statement_kit.dart';

/// Website `/reports/cash-flow`: indirect-method cash flow for a period.
class CashFlowScreen extends StatefulWidget {
  const CashFlowScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<CashFlowScreen> createState() => _CashFlowScreenState();
}

class _CashFlowScreenState extends State<CashFlowScreen> with StatementLoader {
  ReportPeriod _period = ReportPeriod.of('this_fy');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => fetch(widget.session.api, '/api/reports/cash-flow?${_period.query}');

  void _setPeriod(ReportPeriod period) {
    setState(() => _period = period);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return StatementScaffold(
      title: 'Cash flow',
      period: _period,
      onPeriod: _setPeriod,
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      children: body == null ? const [] : _statement(body!),
    );
  }

  List<Widget> _statement(Map<String, dynamic> b) {
    Map<String, dynamic> section(String key) => b[key] is Map ? Map<String, dynamic>.from(b[key] as Map) : const {};
    final operating = section('operating_activities');
    final investing = section('investing_activities');
    final financing = section('financing_activities');
    final net = toNum(b['net_cash_flow']);
    final difference = toNum(b['unreconciled_difference']);
    final inflow = [operating['net_cash_from_operating'], investing['net_cash_from_investing'], financing['net_cash_from_financing']]
        .map(toNum)
        .where((v) => v > 0)
        .fold<num>(0, (a, v) => a + v);
    final outflow = [operating['net_cash_from_operating'], investing['net_cash_from_investing'], financing['net_cash_from_financing']]
        .map(toNum)
        .where((v) => v < 0)
        .fold<num>(0, (a, v) => a + v);
    return [
      StatementHeadline(tiles: [
        ('Opening cash', toNum(b['opening_cash_balance']), null),
        ('Closing cash', toNum(b['closing_cash_balance']), null),
        ('Cash in', inflow, KTone.positive),
        ('Cash out', outflow, outflow < 0 ? KTone.negative : null),
      ]),
      StatementSection(
        title: 'Operating activities',
        lines: [
          (label: 'Net profit', amount: toNum(operating['net_profit'])),
          ...statementLines(operating['adjustments']),
          ...statementLines(operating['working_capital_lines']),
        ],
        totalLabel: 'Net cash from operations',
        total: toNum(operating['net_cash_from_operating']),
      ),
      StatementSection(
        title: 'Investing activities',
        lines: statementLines(investing['lines']),
        totalLabel: 'Net cash from investing',
        total: toNum(investing['net_cash_from_investing']),
      ),
      StatementSection(
        title: 'Financing activities',
        lines: statementLines(financing['lines']),
        totalLabel: 'Net cash from financing',
        total: toNum(financing['net_cash_from_financing']),
      ),
      Padding(
        padding: const EdgeInsets.only(top: AppSpace.md),
        child: KCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: Column(children: [
            StatementRow(label: 'Opening cash and bank', amount: toNum(b['opening_cash_balance'])),
            const Divider(height: 1, color: AppColors.hairline),
            StatementRow(
              label: net >= 0 ? 'Net increase in cash' : 'Net decrease in cash',
              amount: net,
              strong: true,
              color: net.abs() < 0.005 ? null : (net < 0 ? AppColors.negative : AppColors.positive),
            ),
            const Divider(height: 1, thickness: 1.5, color: AppColors.hairline),
            StatementRow(label: 'Closing cash and bank', amount: toNum(b['closing_cash_balance']), strong: true),
          ]),
        ),
      ),
      if (difference.abs() >= 0.01)
        Padding(
          padding: const EdgeInsets.only(top: AppSpace.md),
          child: KCard(
            padding: const EdgeInsets.all(14),
            child: Text(
              'The books differ from the calculated closing cash by ${statementMoney(difference)}. '
              'Check entries posted to cash or bank without a matching account.',
              style: AppText.caption.copyWith(color: AppColors.due),
            ),
          ),
        ),
    ];
  }
}
