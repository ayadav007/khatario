import 'package:flutter/material.dart';

import '../../format.dart';
import '../../theme.dart';
import '../../ui/kit.dart';

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
