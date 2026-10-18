import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'report_period.dart';
import 'statement_kit.dart';

/// Website `/reports/profit-loss`: income and expense sections for a period.
class ProfitLossScreen extends StatefulWidget {
  const ProfitLossScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ProfitLossScreen> createState() => _ProfitLossScreenState();
}

class _ProfitLossScreenState extends State<ProfitLossScreen> with StatementLoader {
  ReportPeriod _period = ReportPeriod.of('this_fy');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => fetch(widget.session.api, '/api/reports/profit-loss?${_period.query}');

  @override
  Widget build(BuildContext context) {
    return StatementScaffold(
      title: 'Profit & loss',
      period: _period,
      onPeriod: (p) {
        setState(() => _period = p);
        _load();
      },
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      children: body == null ? const [] : _statement(body!),
    );
  }

  List<Widget> _statement(Map<String, dynamic> b) {
    final sections = {
      for (final s in (b['sections'] is List ? b['sections'] as List : const []).whereType<Map>())
        s['key']?.toString() ?? '': Map<String, dynamic>.from(s),
    };
    Widget section(String key) {
      final s = sections[key];
      if (s == null) return const SizedBox.shrink();
      return StatementSection(
        title: s['label']?.toString() ?? key,
        lines: plAccountLines(s['accounts']),
        totalLabel: 'Total ${(s['label']?.toString() ?? '').toLowerCase()}',
        total: toNum(s['total']),
        signed: false,
      );
    }

    final net = toNum(b['net_profit']);
    return [
      StatementHeadline(tiles: [
        ('Income', toNum(sections['operating_income']?['total']) + toNum(sections['other_income']?['total']), null),
        (
          'Expenses',
          toNum(sections['cost_of_goods_sold']?['total']) + toNum(sections['operating_expense']?['total']) + toNum(sections['other_expense']?['total']),
          null,
        ),
        ('Gross profit', toNum(b['gross_profit']), null),
        (net >= 0 ? 'Net profit' : 'Net loss', net, net < 0 ? KTone.negative : KTone.positive),
      ]),
      section('operating_income'),
      section('cost_of_goods_sold'),
      _subtotal('Gross profit', toNum(b['gross_profit'])),
      section('operating_expense'),
      _subtotal('Operating profit', toNum(b['operating_profit'])),
      section('other_income'),
      section('other_expense'),
      _subtotal(net >= 0 ? 'Net profit' : 'Net loss', net),
    ];
  }

  Widget _subtotal(String label, num amount) => Padding(
        padding: const EdgeInsets.only(top: AppSpace.md),
        child: KCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
          child: StatementRow(
            label: label,
            amount: amount,
            strong: true,
            color: amount.abs() < 0.005 ? null : (amount < 0 ? AppColors.negative : AppColors.positive),
          ),
        ),
      );
}

/// Top-level P&L accounts with their sub-accounts rolled in.
List<StatementLine> plAccountLines(dynamic accounts) {
  if (accounts is! List) return const [];
  return [
    for (final a in accounts.whereType<Map>())
      (label: a['account_name']?.toString() ?? '—', amount: toNum(a['total'] ?? a['amount'])),
  ];
}

/// "As on" date chip for point-in-time reports.
class AsOnBar extends StatelessWidget {
  const AsOnBar({super.key, required this.date, required this.onChanged});

  final DateTime date;
  final ValueChanged<DateTime> onChanged;

  @override
  Widget build(BuildContext context) {
    final today = dateOnly(DateTime.now());
    final fyEnd = DateTime(today.month < 4 ? today.year - 1 : today.year, 3, 31);
    final options = [('today', 'Today'), ('last_fy', 'End of last FY'), ('pick', 'Pick a date')];
    final selected = date == today ? 'today' : date == fyEnd ? 'last_fy' : 'pick';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KChipBar<String>(
          value: selected,
          options: options,
          onChanged: (id) async {
            if (id == 'today') return onChanged(today);
            if (id == 'last_fy') return onChanged(fyEnd);
            final picked = await showDatePicker(context: context, initialDate: date, firstDate: DateTime(2015), lastDate: today);
            if (picked != null) onChanged(dateOnly(picked));
          },
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter + 2, 0, AppSpace.gutter, AppSpace.xs),
          child: Text('As on ${ddMMMyyyy(date)}', style: AppText.caption),
        ),
      ],
    );
  }
}

/// Website `/reports/balance-sheet`: assets against liabilities and equity on a date.
class BalanceSheetScreen extends StatefulWidget {
  const BalanceSheetScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<BalanceSheetScreen> createState() => _BalanceSheetScreenState();
}

class _BalanceSheetScreenState extends State<BalanceSheetScreen> with StatementLoader {
  DateTime _asOn = dateOnly(DateTime.now());

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => fetch(widget.session.api, '/api/reports/balance-sheet?as_on_date=${ymd(_asOn)}');

  @override
  Widget build(BuildContext context) {
    return StatementScaffold(
      title: 'Balance sheet',
      period: null,
      onPeriod: null,
      periodBar: AsOnBar(
        date: _asOn,
        onChanged: (d) {
          setState(() => _asOn = d);
          _load();
        },
      ),
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      children: body == null ? const [] : _statement(body!),
    );
  }

  List<Widget> _statement(Map<String, dynamic> b) {
    Map<String, dynamic> m(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : const {};
    final assets = m(b['assets']);
    final liabilities = m(b['liabilities']);
    final equity = m(b['equity']);
    final retained = m(equity['retained_earnings']);
    final current = m(assets['current']);
    final invAdj = toNum(current['inventory_adjustment']);
    Widget block(String title, Map<String, dynamic> s, {List<StatementLine> extra = const []}) => StatementSection(
          title: title,
          lines: [...statementLines(s['accounts'], labelKey: 'account_name', amountKey: 'balance'), ...extra],
          totalLabel: 'Total ${title.toLowerCase()}',
          total: toNum(s['total']),
          signed: false,
        );
    final difference = toNum(b['difference']);
    return [
      StatementHeadline(tiles: [
        ('Total assets', toNum(assets['total']), null),
        ('Liabilities + equity', toNum(b['total_liabilities_and_equity']), null),
      ]),
      if (b['is_balanced'] == false)
        Padding(
          padding: const EdgeInsets.only(top: AppSpace.md),
          child: KPill(label: 'Out of balance by ${statementMoney(difference)}', tone: KTone.negative, icon: LucideIcons.triangleAlert),
        ),
      block('Current assets', current, extra: [if (invAdj.abs() >= 0.005) (label: 'Stock valuation adjustment', amount: invAdj)]),
      block('Fixed assets', m(assets['fixed'])),
      if (toNum(m(assets['investments'])['total']).abs() >= 0.005) block('Investments', m(assets['investments'])),
      if (toNum(m(assets['other'])['total']).abs() >= 0.005) block('Other assets', m(assets['other'])),
      block('Current liabilities', m(liabilities['current'])),
      if (toNum(m(liabilities['long_term'])['total']).abs() >= 0.005) block('Long-term liabilities', m(liabilities['long_term'])),
      if (toNum(m(liabilities['other'])['total']).abs() >= 0.005) block('Other liabilities', m(liabilities['other'])),
      StatementSection(
        title: 'Equity',
        lines: [
          ...statementLines(m(equity['capital'])['accounts'], labelKey: 'account_name', amountKey: 'balance'),
          (label: 'Retained earnings (opening)', amount: toNum(retained['opening'])),
          (label: 'Profit for the year', amount: toNum(retained['current_year_profit'])),
        ],
        totalLabel: 'Total equity',
        total: toNum(equity['total']),
        signed: false,
      ),
    ];
  }
}

/// Website `/reports/trial-balance`: every account's debit or credit balance on a date.
class TrialBalanceScreen extends StatefulWidget {
  const TrialBalanceScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<TrialBalanceScreen> createState() => _TrialBalanceScreenState();
}

class _TrialBalanceScreenState extends State<TrialBalanceScreen> with StatementLoader {
  DateTime _asOn = dateOnly(DateTime.now());
  final _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() => fetch(widget.session.api, '/api/reports/trial-balance?as_on_date=${ymd(_asOn)}');

  @override
  Widget build(BuildContext context) {
    return StatementScaffold(
      title: 'Trial balance',
      period: null,
      onPeriod: null,
      periodBar: AsOnBar(
        date: _asOn,
        onChanged: (d) {
          setState(() => _asOn = d);
          _load();
        },
      ),
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      children: body == null ? const [] : _statement(body!),
    );
  }

  List<Widget> _statement(Map<String, dynamic> b) {
    final totals = b['totals'] is Map ? Map<String, dynamic>.from(b['totals'] as Map) : const <String, dynamic>{};
    final q = _search.text.trim().toLowerCase();
    final accounts = (b['accounts'] is List ? b['accounts'] as List : const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .where((a) => toNum(a['debit']).abs() >= 0.005 || toNum(a['credit']).abs() >= 0.005)
        .where((a) => q.isEmpty || '${a['account_name']} ${a['account_code']}'.toLowerCase().contains(q))
        .toList();
    const typeOrder = ['asset', 'liability', 'equity', 'income', 'revenue', 'expense'];
    final types = accounts.map((a) => a['account_type']?.toString() ?? 'other').toSet().toList()
      ..sort((a, b) {
        final ia = typeOrder.indexOf(a), ib = typeOrder.indexOf(b);
        return (ia == -1 ? 99 : ia).compareTo(ib == -1 ? 99 : ib);
      });
    final balanced = b['is_balanced'] != false;
    return [
      StatementHeadline(tiles: [
        ('Total debit', toNum(totals['total_debit']), null),
        ('Total credit', toNum(totals['total_credit']), null),
      ]),
      const SizedBox(height: AppSpace.sm),
      Align(
        alignment: Alignment.centerLeft,
        child: KPill(
          label: balanced ? 'Debits equal credits' : 'Out of balance',
          tone: balanced ? KTone.positive : KTone.negative,
          icon: balanced ? LucideIcons.check : LucideIcons.triangleAlert,
        ),
      ),
      const SizedBox(height: AppSpace.md),
      KSearchField(controller: _search, hint: 'Search accounts', onChanged: (_) => setState(() {})),
      if (accounts.isEmpty)
        const KEmptyState(icon: LucideIcons.search, title: 'No accounts with a balance'),
      for (final type in types) ...[
        Padding(
          padding: const EdgeInsets.only(top: AppSpace.md),
          child: KSectionHeader(_typeLabel(type)),
        ),
        KCard(
          child: KDivided(children: [
            for (final a in accounts.where((a) => (a['account_type']?.toString() ?? 'other') == type)) _accountRow(a),
          ]),
        ),
      ],
    ];
  }

  Widget _accountRow(Map<String, dynamic> a) {
    final debit = toNum(a['debit']);
    final credit = toNum(a['credit']);
    final isDebit = debit.abs() >= 0.005;
    return KListRow(
      title: a['account_name']?.toString() ?? '—',
      subtitle: [a['account_code'], a['account_group_name']].where((v) => v != null && '$v'.isNotEmpty).join(' · '),
      trailing: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(statementMoney(isDebit ? debit : credit), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
          Text(isDebit ? 'Dr' : 'Cr', style: AppText.caption),
        ],
      ),
    );
  }

  String _typeLabel(String type) => switch (type) {
        'asset' => 'Assets',
        'liability' => 'Liabilities',
        'equity' => 'Equity',
        'income' || 'revenue' => 'Income',
        'expense' => 'Expenses',
        _ => type.isEmpty ? 'Other' : type[0].toUpperCase() + type.substring(1),
      };
}
