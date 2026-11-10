import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../format.dart';
import '../../theme.dart';
import '../../ui/kit.dart';

/// Which period control a report uses, and so which query it sends.
enum ReportPeriodKind { none, range, month, financialYear, asOn }

/// A report's date span. Indian financial years start on 1 April.
class ReportPeriod {
  const ReportPeriod(this.preset, this.from, this.to);

  /// `this_month`, `last_month`, `this_quarter`, `this_fy`, `last_fy` or `custom`.
  final String preset;
  final DateTime from;
  final DateTime to;

  static DateTime _fyStart(DateTime d) => DateTime(d.month < 4 ? d.year - 1 : d.year, 4, 1);

  factory ReportPeriod.of(String preset, [DateTime? now]) {
    final t = dateOnly(now ?? DateTime.now());
    switch (preset) {
      case 'this_month':
        return ReportPeriod(preset, DateTime(t.year, t.month, 1), t);
      case 'last_month':
        return ReportPeriod(preset, DateTime(t.year, t.month - 1, 1), DateTime(t.year, t.month, 0));
      case 'this_quarter':
        // Financial quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
        final startMonth = ((t.month - 1) ~/ 3) * 3 + 1;
        return ReportPeriod(preset, DateTime(t.year, startMonth, 1), t);
      case 'last_fy':
        final start = _fyStart(t);
        return ReportPeriod(preset, DateTime(start.year - 1, 4, 1), DateTime(start.year, 3, 31));
      default:
        return ReportPeriod('this_fy', _fyStart(t), t);
    }
  }

  String get fromIso => ymd(from);
  String get toIso => ymd(to);

  String get query => 'from_date=$fromIso&to_date=$toIso';

  String get label => '${ddMMMyyyy(from)} – ${ddMMMyyyy(to)}';
}

const reportPresets = [
  ('this_month', 'This month'),
  ('last_month', 'Last month'),
  ('this_quarter', 'This quarter'),
  ('this_fy', 'This FY'),
  ('last_fy', 'Last FY'),
  ('custom', 'Custom'),
];

/// Preset chips plus the exact dates; "Custom" opens the range picker.
class ReportPeriodBar extends StatelessWidget {
  const ReportPeriodBar({super.key, required this.period, required this.onChanged});

  final ReportPeriod period;
  final ValueChanged<ReportPeriod> onChanged;

  Future<void> _pick(BuildContext context, String preset) async {
    if (preset != 'custom') {
      onChanged(ReportPeriod.of(preset));
      return;
    }
    final today = dateOnly(DateTime.now());
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2015),
      lastDate: today,
      initialDateRange: DateTimeRange(start: period.from, end: period.to.isAfter(today) ? today : period.to),
    );
    if (picked != null) onChanged(ReportPeriod('custom', dateOnly(picked.start), dateOnly(picked.end)));
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KChipBar<String>(value: period.preset, options: reportPresets, onChanged: (p) => _pick(context, p)),
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter + 2, 0, AppSpace.gutter, AppSpace.xs),
          child: Text(period.label, style: AppText.caption),
        ),
      ],
    );
  }
}

const _monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// One calendar month. Query: `month=10&year=2026`.
class MonthPeriod {
  const MonthPeriod(this.year, this.month);

  factory MonthPeriod.of(DateTime now) => MonthPeriod(now.year, now.month);

  final int year;

  /// 1-12.
  final int month;

  MonthPeriod get previous => month == 1 ? MonthPeriod(year - 1, 12) : MonthPeriod(year, month - 1);
  MonthPeriod get next => month == 12 ? MonthPeriod(year + 1, 1) : MonthPeriod(year, month + 1);

  String get query => 'month=$month&year=$year';
  String get label => '${_monthNames[month - 1]} $year';

  @override
  bool operator ==(Object other) => other is MonthPeriod && other.year == year && other.month == month;

  @override
  int get hashCode => Object.hash(year, month);
}

/// One Indian financial year (1 April to 31 March). Query: `financial_year=2026-27`.
class FinancialYear {
  const FinancialYear(this.startYear);

  factory FinancialYear.of(DateTime now) => FinancialYear(now.month < 4 ? now.year - 1 : now.year);

  /// The calendar year in which the financial year starts.
  final int startYear;

  FinancialYear get previous => FinancialYear(startYear - 1);
  FinancialYear get next => FinancialYear(startYear + 1);

  String get code => '$startYear-${((startYear + 1) % 100).toString().padLeft(2, '0')}';
  String get query => 'financial_year=$code';
  String get label => 'FY $code';

  @override
  bool operator ==(Object other) => other is FinancialYear && other.startYear == startYear;

  @override
  int get hashCode => startYear.hashCode;
}

/// Query for "as on" reports.
String asOnQuery(DateTime date) => 'as_on_date=${ymd(date)}';

/// Previous / label / next row shared by the month and financial-year bars.
class _StepBar extends StatelessWidget {
  const _StepBar({required this.label, required this.previousTip, required this.nextTip, required this.onPrevious, required this.onNext});

  final String label, previousTip, nextTip;
  final VoidCallback onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.sm),
      child: Row(
        children: [
          KIconButton(icon: LucideIcons.chevronLeft, tooltip: previousTip, onTap: onPrevious),
          Expanded(child: Center(child: Text(label, style: AppText.bodyStrong))),
          if (onNext != null)
            KIconButton(icon: LucideIcons.chevronRight, tooltip: nextTip, onTap: onNext!)
          else
            const SizedBox(width: 44, height: 44),
        ],
      ),
    );
  }
}

/// Month with previous / next. Cannot step past the current month.
class MonthPeriodBar extends StatelessWidget {
  const MonthPeriodBar({super.key, required this.period, required this.onChanged, this.now});

  final MonthPeriod period;
  final ValueChanged<MonthPeriod> onChanged;

  /// For tests; defaults to today.
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final current = MonthPeriod.of(now ?? DateTime.now());
    final canNext = period.year < current.year || (period.year == current.year && period.month < current.month);
    return _StepBar(
      label: period.label,
      previousTip: 'Previous month',
      nextTip: 'Next month',
      onPrevious: () => onChanged(period.previous),
      onNext: canNext ? () => onChanged(period.next) : null,
    );
  }
}

/// Financial year with previous / next. Cannot step past the current financial year.
class FinancialYearBar extends StatelessWidget {
  const FinancialYearBar({super.key, required this.period, required this.onChanged, this.now});

  final FinancialYear period;
  final ValueChanged<FinancialYear> onChanged;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final current = FinancialYear.of(now ?? DateTime.now());
    return _StepBar(
      label: period.label,
      previousTip: 'Previous year',
      nextTip: 'Next year',
      onPrevious: () => onChanged(period.previous),
      onNext: period.startYear < current.startYear ? () => onChanged(period.next) : null,
    );
  }
}

/// "As on" date row; tapping it opens the date picker.
class AsOnDateBar extends StatelessWidget {
  const AsOnDateBar({super.key, required this.date, required this.onChanged});

  final DateTime date;
  final ValueChanged<DateTime> onChanged;

  Future<void> _pick(BuildContext context) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: date,
      firstDate: DateTime(2015),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null) onChanged(dateOnly(picked));
  }

  @override
  Widget build(BuildContext context) {
    return KCard(
      margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
      onTap: () => _pick(context),
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.lg, vertical: AppSpace.md),
      child: Row(
        children: [
          const Icon(LucideIcons.calendar, size: 18, color: AppColors.ink2),
          const SizedBox(width: AppSpace.md),
          Expanded(child: Text('As on ${ddMMMyyyy(date)}', style: AppText.bodyStrong)),
          const Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
        ],
      ),
    );
  }
}
