import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../format.dart';
import '../theme.dart';
import '../ui/kit.dart';

/// Dashboard period, as TopBar `DateRangeControls` hands it to the dashboard.
class DashboardRange {
  const DashboardRange({required this.mode, required this.startDate, required this.endDate});

  factory DashboardRange.today() {
    final t = dateOnly(DateTime.now());
    return DashboardRange(mode: 'today', startDate: t, endDate: t);
  }

  /// `today`, `this_week`, `this_month` or `custom`.
  final String mode;
  final DateTime startDate;
  final DateTime endDate;

  String get start => ymd(startDate);
  String get end => ymd(endDate);

  String get label => switch (mode) {
        'today' => 'Today',
        'this_week' => 'This Week',
        'this_month' => 'This Month',
        _ => '${ddMMM(startDate)} - ${ddMMM(endDate)}',
      };

  /// Home page title: Today, Yesterday, 9 Oct, This week, This month or a span.
  String get title {
    final t = dateOnly(DateTime.now());
    if (startDate == endDate) {
      if (startDate == t) return 'Today';
      if (startDate == t.subtract(const Duration(days: 1))) return 'Yesterday';
      return dMMM(startDate);
    }
    return switch (mode) {
      'this_week' => 'This week',
      'this_month' => 'This month',
      _ => barLabel,
    };
  }

  /// Stepper caption (`barLabel`).
  String get barLabel {
    if (startDate == endDate) return dMMM(startDate);
    if (startDate.year == endDate.year && startDate.month == endDate.month) {
      return '${startDate.day}–${dMMM(endDate)}';
    }
    return '${dMMM(startDate)} – ${dMMM(endDate)}';
  }
}

DateTime _startOfWeek(DateTime d) => dateOnly(d).subtract(Duration(days: d.weekday - 1));

/// Today / Yesterday / This week / This month, as on the phone prototype.
class DateChips extends StatelessWidget {
  const DateChips({super.key, required this.range, required this.onChanged, this.onDark = false});

  final DashboardRange range;
  final ValueChanged<DashboardRange> onChanged;
  final bool onDark;

  bool _isYesterday() {
    final y = dateOnly(DateTime.now()).subtract(const Duration(days: 1));
    return range.mode == 'custom' && range.startDate == y && range.endDate == y;
  }

  String? get _selected {
    if (range.mode == 'today') return 'today';
    if (_isYesterday()) return 'yesterday';
    if (range.mode == 'this_week') return 'week';
    if (range.mode == 'this_month') return 'month';
    return null;
  }

  void _pick(String id) {
    final t = dateOnly(DateTime.now());
    switch (id) {
      case 'today':
        onChanged(DashboardRange(mode: 'today', startDate: t, endDate: t));
      case 'yesterday':
        final y = t.subtract(const Duration(days: 1));
        onChanged(DashboardRange(mode: 'custom', startDate: y, endDate: y));
      case 'week':
        onChanged(DashboardRange(mode: 'this_week', startDate: _startOfWeek(t), endDate: t));
      case 'month':
        onChanged(DashboardRange(mode: 'this_month', startDate: DateTime(t.year, t.month, 1), endDate: t));
    }
  }

  @override
  Widget build(BuildContext context) {
    const items = [('today', 'Today'), ('yesterday', 'Yesterday'), ('week', 'This week'), ('month', 'This month')];
    return KChipBar<String>(value: _selected, options: items, onChanged: _pick, onDark: onDark);
  }
}

class DateStepper extends StatefulWidget {
  const DateStepper({super.key, required this.range, required this.onChanged});

  final DashboardRange range;
  final ValueChanged<DashboardRange> onChanged;

  @override
  State<DateStepper> createState() => _DateStepperState();
}

class _DateStepperState extends State<DateStepper> {
  bool _menuOpen = false;

  DateTime get _today => dateOnly(DateTime.now());

  bool get _canStepForward => _today.isAfter(widget.range.endDate);

  void _step(int direction) {
    final r = widget.range;
    var start = r.startDate;
    var end = r.endDate;
    if (r.mode == 'this_week') {
      start = _startOfWeek(start).add(Duration(days: direction * 7));
      end = start.add(const Duration(days: 6));
    } else if (r.mode == 'this_month') {
      start = DateTime(start.year, start.month + direction, 1);
      end = DateTime(start.year, start.month + 1, 0);
    } else if (start == end) {
      start = start.add(Duration(days: direction));
      end = start;
    } else {
      final span = end.difference(start).inDays + 1;
      start = start.add(Duration(days: direction * span));
      end = end.add(Duration(days: direction * span));
    }
    if (direction == 1 && start.isAfter(_today)) return;
    if (end.isAfter(_today)) end = _today;
    setState(() => _menuOpen = false);
    widget.onChanged(DashboardRange(mode: 'custom', startDate: start, endDate: end));
  }

  Future<void> _applyPreset(String id) async {
    setState(() => _menuOpen = false);
    final t = _today;
    switch (id) {
      case 'yesterday':
        final y = t.subtract(const Duration(days: 1));
        widget.onChanged(DashboardRange(mode: 'custom', startDate: y, endDate: y));
      case 'today':
        widget.onChanged(DashboardRange(mode: 'today', startDate: t, endDate: t));
      case 'this_week':
        widget.onChanged(DashboardRange(mode: 'this_week', startDate: _startOfWeek(t), endDate: t));
      case 'this_month':
        widget.onChanged(DashboardRange(mode: 'this_month', startDate: DateTime(t.year, t.month, 1), endDate: t));
      case 'custom':
        final picked = await showDateRangePicker(
          context: context,
          firstDate: DateTime(2000),
          lastDate: t,
          initialDateRange: DateTimeRange(start: widget.range.startDate, end: widget.range.endDate),
        );
        if (picked != null) {
          widget.onChanged(DashboardRange(mode: 'custom', startDate: dateOnly(picked.start), endDate: dateOnly(picked.end)));
        }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: const BoxDecoration(
        color: KhatarioColors.surface,
        border: Border(bottom: BorderSide(color: KhatarioColors.line)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              _StepBtn(icon: LucideIcons.chevronLeft, onTap: () => _step(-1)),
              Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => setState(() => _menuOpen = !_menuOpen),
                  child: Text(
                    widget.range.barLabel.toUpperCase(),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 14,
                      height: 20 / 14,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.35,
                      color: KhatarioColors.ink,
                    ),
                  ),
                ),
              ),
              Opacity(
                opacity: _canStepForward ? 1 : 0.4,
                child: _StepBtn(icon: LucideIcons.chevronRight, onTap: _canStepForward ? () => _step(1) : null),
              ),
            ],
          ),
          if (_menuOpen)
            Container(
              margin: const EdgeInsets.only(top: 8),
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: KhatarioColors.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: KhatarioColors.line),
                boxShadow: const [BoxShadow(color: Color(0x40000000), blurRadius: 50, offset: Offset(0, 25), spreadRadius: -12)],
              ),
              child: Column(
                children: [
                  for (final (id, label) in const [
                    ('yesterday', 'Yesterday'),
                    ('today', 'Today'),
                    ('this_week', 'This week'),
                    ('this_month', 'This month'),
                    ('custom', 'Custom'),
                  ])
                    InkWell(
                      onTap: () => _applyPreset(id),
                      highlightColor: Tw.slate50,
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        child: Text(label, style: const TextStyle(fontSize: 14, height: 20 / 14, color: KhatarioColors.ink)),
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

class _StepBtn extends StatelessWidget {
  const _StepBtn({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: SizedBox(width: 36, height: 36, child: Icon(icon, size: 20, color: KhatarioColors.inkSecondary)),
    );
  }
}
