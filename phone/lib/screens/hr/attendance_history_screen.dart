import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../reports/report_period.dart';
import 'attendance_leave_logic.dart';

const _cellWidth = 40.0;
const _rowHeight = 56.0;
const _headHeight = 48.0;
const _nameWidth = 136.0;

/// Website `/employees/attendance` "Attendance matrix": one row per employee for the month, a cell
/// per day with the server's code (`P`, `A`, `HD`, `L`, hours for overtime, a dash for weekly off).
/// Tapping a cell opens that day. Worked days and total hours are the server's.
class AttendanceHistoryScreen extends StatefulWidget {
  const AttendanceHistoryScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<AttendanceHistoryScreen> createState() => _AttendanceHistoryScreenState();
}

class _AttendanceHistoryScreenState extends State<AttendanceHistoryScreen> {
  MonthPeriod _month = MonthPeriod.of(DateTime.now());
  AttendanceMatrix? _matrix;
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  int _loadId = 0;
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

  Future<void> _load() async {
    final id = ++_loadId;
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson(matrixPath(_month));
      if (!mounted || id != _loadId) return;
      setState(() {
        _matrix = AttendanceMatrix.fromJson(body);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted || id != _loadId) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (mounted && id == _loadId) setState(() { _error = 'Could not reach the server.'; _loading = false; });
    }
  }

  void _setMonth(MonthPeriod month) {
    if (month == _month) return;
    setState(() => _month = month);
    _load();
  }

  void _openDay(MatrixWorker worker, MatrixDay day, MatrixCell cell) {
    final date = day.parsed;
    showKSheet<void>(
      context,
      title: worker.name,
      scrollable: true,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, AppSpace.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KInfoCard(
              title: 'Day details',
              rows: [
                ('Date', date == null ? day.date : ddMMMyyyy(date)),
                ('Status', cell.statusLabel),
                if (cell.hours > 0) ('Hours worked', jsNumberString(cell.hours)),
                if (cell.lateMinutes > 0) ('Arrival', 'Late by ${jsNumberString(cell.lateMinutes)} min'),
                if (cell.earlyMinutes > 0) ('Arrival', 'Early by ${jsNumberString(cell.earlyMinutes)} min'),
              ],
            ),
            if (cell.missingOutPunch) ...[
              const SizedBox(height: AppSpace.sm),
              const Align(alignment: Alignment.centerLeft, child: KPill(label: 'Out punch missing', tone: KTone.negative)),
            ],
          ],
        ),
      ),
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
            const KBackBar('Attendance history'),
            MonthPeriodBar(period: _month, onChanged: _setMonth),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.sm),
              child: KSearchField(controller: _search, hint: 'Search by name or code', onChanged: (_) => setState(() {})),
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null) {
      return ListView(children: [
        KEmptyState(
          icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: _notInPlan ? 'Not included in your current plan' : 'Could not load attendance',
          body: _error,
          action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    final matrix = _matrix;
    final workers = matrix == null ? const <MatrixWorker>[] : filterWorkers(matrix.workers, _search.text);
    if (matrix == null || workers.isEmpty) {
      return ListView(children: const [
        KEmptyState(icon: LucideIcons.calendarDays, title: 'No employees to show for this month.'),
      ]);
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.xl),
        children: [
          Wrap(spacing: 6, runSpacing: 6, children: const [
            KPill(label: 'P Present', tone: KTone.positive),
            KPill(label: '9.5 Overtime', tone: KTone.due),
            KPill(label: 'HD Half day', tone: KTone.brand),
            KPill(label: 'A Absent', tone: KTone.negative),
            KPill(label: 'L Leave', tone: KTone.neutral),
            KPill(label: '– Weekly off', tone: KTone.neutral),
          ]),
          const SizedBox(height: AppSpace.sm),
          KCard(
            padding: EdgeInsets.zero,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: _nameWidth,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    SizedBox(height: _headHeight, child: Padding(padding: const EdgeInsets.only(left: 12), child: Align(alignment: Alignment.centerLeft, child: Text('Employee', style: AppText.caption)))),
                    for (final w in workers) _nameCell(w),
                  ]),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Column(children: [
                      Row(children: [for (final d in matrix.days) _dayHead(d)]),
                      for (final w in workers)
                        Row(children: [
                          for (final (i, d) in matrix.days.indexed)
                            if (i < w.cells.length) _cell(w, d, w.cells[i]),
                        ]),
                    ]),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _nameCell(MatrixWorker w) {
    return SizedBox(
      height: _rowHeight,
      child: Padding(
        padding: const EdgeInsets.only(left: 12, right: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(w.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
            Text(w.totalsLine, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.small.copyWith(color: AppColors.ink2)),
          ],
        ),
      ),
    );
  }

  Widget _dayHead(MatrixDay d) {
    return SizedBox(
      width: _cellWidth,
      height: _headHeight,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(d.weekday, style: AppText.small.copyWith(color: d.isSunday ? AppColors.negative : AppColors.ink3)),
          Text('${d.day}', style: AppText.label.copyWith(fontWeight: FontWeight.w600, color: d.isSunday ? AppColors.negative : AppColors.ink)),
        ],
      ),
    );
  }

  Widget _cell(MatrixWorker w, MatrixDay d, MatrixCell c) {
    final tone = matrixTone(c.kind);
    return SizedBox(
      width: _cellWidth,
      height: _rowHeight,
      child: c.label.isEmpty
          ? null
          : Center(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => _openDay(w, d, c),
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Container(
                      key: ValueKey('cell-${w.id}-${d.date}'),
                      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: tone?.bg, borderRadius: BorderRadius.circular(8)),
                      child: Text(c.label, style: AppText.small.copyWith(fontWeight: FontWeight.w700, color: tone?.fg ?? AppColors.ink3)),
                    ),
                    if (c.missingOutPunch)
                      Positioned(top: -2, right: -2, child: Container(width: 8, height: 8, decoration: const BoxDecoration(color: AppColors.negative, shape: BoxShape.circle))),
                  ],
                ),
              ),
            ),
    );
  }
}
