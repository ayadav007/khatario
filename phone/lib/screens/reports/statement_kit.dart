import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'report_period.dart';

/// Accounting money: negatives in brackets, always two decimals.
String statementMoney(num value) {
  var digits = enIn(value.abs(), maxFraction: 2);
  final dot = digits.indexOf('.');
  if (dot == -1) {
    digits = '$digits.00';
  } else if (digits.length - dot == 2) {
    digits = '${digits}0';
  }
  final text = '$rupeeSign$digits';
  return value < -0.004 ? '($text)' : text;
}

/// One labelled amount in a statement.
typedef StatementLine = ({String label, num amount});

List<StatementLine> statementLines(dynamic value, {String labelKey = 'label', String amountKey = 'amount'}) {
  if (value is! List) return const [];
  return [
    for (final row in value.whereType<Map>())
      (label: row[labelKey]?.toString() ?? '—', amount: toNum(row[amountKey])),
  ];
}

/// A titled card of lines with a bold total at the bottom.
class StatementSection extends StatelessWidget {
  const StatementSection({
    super.key,
    required this.title,
    required this.lines,
    this.totalLabel,
    this.total,
    this.icon,
    this.emptyText = 'Nothing in this period',
    this.signed = true,
  });

  final String title;
  final List<StatementLine> lines;
  final String? totalLabel;
  final num? total;
  final IconData? icon;
  final String emptyText;

  /// Colour the total green / red by its sign.
  final bool signed;

  @override
  Widget build(BuildContext context) {
    final shown = lines.where((l) => l.amount.abs() >= 0.005).toList();
    return Padding(
      padding: const EdgeInsets.only(top: AppSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KSectionHeader(title),
          KCard(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (shown.isEmpty)
                  Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(emptyText, style: AppText.caption)),
                for (final (i, line) in shown.indexed) ...[
                  if (i > 0) const Divider(height: 1, color: AppColors.hairline),
                  StatementRow(label: line.label, amount: line.amount),
                ],
                if (total != null) ...[
                  const Divider(height: 1, thickness: 1.5, color: AppColors.hairline),
                  StatementRow(
                    label: totalLabel ?? 'Total',
                    amount: total!,
                    strong: true,
                    color: !signed || total!.abs() < 0.005 ? null : (total! < 0 ? AppColors.negative : AppColors.positive),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class StatementRow extends StatelessWidget {
  const StatementRow({super.key, required this.label, required this.amount, this.strong = false, this.color});

  final String label;
  final num amount;
  final bool strong;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final style = (strong ? AppText.bodyStrong : AppText.body).copyWith(fontFeatures: AppText.tabular);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 11),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(label, style: strong ? AppText.bodyStrong : AppText.body.copyWith(color: AppColors.ink2))),
          const SizedBox(width: AppSpace.md),
          Text(statementMoney(amount), style: style.copyWith(color: color ?? (amount < -0.004 ? AppColors.negative : null))),
        ],
      ),
    );
  }
}

/// Big number tiles at the top of a statement.
class StatementHeadline extends StatelessWidget {
  const StatementHeadline({super.key, required this.tiles});

  final List<(String, num, KTone?)> tiles;

  @override
  Widget build(BuildContext context) {
    return KCard(
      padding: const EdgeInsets.all(16),
      child: Wrap(
        spacing: 16,
        runSpacing: 14,
        children: [
          for (final (label, value, tone) in tiles)
            SizedBox(
              width: (MediaQuery.sizeOf(context).width - 2 * AppSpace.gutter - 32 - 16) / 2,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: AppText.label),
                  const SizedBox(height: 4),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(
                      statementMoney(value),
                      style: AppText.amount.copyWith(fontSize: 20, color: tone?.fg ?? AppColors.ink),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Scaffold for a dated financial report: back bar, period chips, loading / error / plan states.
class StatementScaffold extends StatelessWidget {
  const StatementScaffold({
    super.key,
    required this.title,
    required this.period,
    required this.onPeriod,
    required this.loading,
    required this.error,
    required this.notInPlan,
    required this.onRetry,
    required this.children,
    this.periodBar,
  });

  final String title;
  final ReportPeriod? period;
  final ValueChanged<ReportPeriod>? onPeriod;
  final bool loading;
  final String? error;
  final bool notInPlan;
  final Future<void> Function() onRetry;
  final List<Widget> children;

  /// Replaces the period chips (for an "as on" date instead of a range).
  final Widget? periodBar;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 64,
              child: Row(children: [
                const SizedBox(width: 4),
                KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).maybePop()),
                const SizedBox(width: 4),
                Expanded(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.heading.copyWith(fontSize: 18))),
                const SizedBox(width: AppSpace.gutter),
              ]),
            ),
            ?periodBar,
            if (periodBar == null && period != null && onPeriod != null) ReportPeriodBar(period: period!, onChanged: onPeriod!),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (error != null) {
      return ListView(children: [
        KEmptyState(
          icon: notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: notInPlan ? 'Not included in your current plan' : 'Could not load this report',
          body: error,
          action: notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: onRetry),
        ),
      ]);
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: onRetry,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xl),
        children: children,
      ),
    );
  }
}

/// Loads a report body and tracks loading / error / not-in-plan.
mixin StatementLoader<T extends StatefulWidget> on State<T> {
  Map<String, dynamic>? body;
  bool loading = true;
  String? error;
  bool notInPlan = false;

  Future<void> fetch(KhatarioApi api, String path) async {
    setState(() {
      loading = true;
      error = null;
      notInPlan = false;
    });
    try {
      final result = await api.getJson(path);
      if (mounted) setState(() { body = result; loading = false; });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
          error = e.message;
          loading = false;
        });
      }
    }
  }
}
