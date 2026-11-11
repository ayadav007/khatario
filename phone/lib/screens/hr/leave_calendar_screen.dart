import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../reports/report_period.dart';
import 'attendance_leave_logic.dart';
import 'leave_logic.dart';

const _weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const _longWeekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

Widget _stateMessage({required bool notInPlan, required String title, required String? message, required VoidCallback onRetry}) {
  return ListView(children: [
    KEmptyState(
      icon: notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
      title: notInPlan ? 'Not included in your current plan' : title,
      body: message,
      action: notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: onRetry),
    ),
  ]);
}

/// Website `/employees/leaves/calendar` (Team Calendar): the month in whole weeks, with a dot per
/// leave or attendance mark on each day. Tapping a day lists who is off and why.
class LeaveCalendarScreen extends StatefulWidget {
  const LeaveCalendarScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<LeaveCalendarScreen> createState() => _LeaveCalendarScreenState();
}

class _LeaveCalendarScreenState extends State<LeaveCalendarScreen> {
  MonthPeriod _month = MonthPeriod.of(DateTime.now());
  DateTime _selected = dateOnly(DateTime.now());
  Map<String, List<CalendarEvent>> _events = const {};
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  int _loadId = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final id = ++_loadId;
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson(leaveCalendarPath(_month));
      if (!mounted || id != _loadId) return;
      setState(() {
        _events = calendarEvents(body['events_by_date']);
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
    setState(() => _month = month);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Leave calendar'),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter - 8, 0, AppSpace.gutter - 8, AppSpace.xs),
              child: Row(children: [
                KIconButton(icon: LucideIcons.chevronLeft, tooltip: 'Previous month', onTap: () => _setMonth(_month.previous)),
                Expanded(child: Center(child: Text(_month.label, style: AppText.bodyStrong))),
                KTextButton(
                  label: 'Today',
                  onTap: () {
                    final today = DateTime.now();
                    setState(() => _selected = dateOnly(today));
                    _setMonth(MonthPeriod.of(today));
                  },
                ),
                KIconButton(icon: LucideIcons.chevronRight, tooltip: 'Next month', onTap: () => _setMonth(_month.next)),
              ]),
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null) return _stateMessage(notInPlan: _notInPlan, title: 'Could not load the calendar', message: _error, onRetry: _load);
    final days = calendarGridDays(_month);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.xl),
        children: [
          Wrap(spacing: 12, runSpacing: 4, children: [
            const KStatusDot(label: 'Approved leave', tone: KTone.positive),
            const KStatusDot(label: 'Pending leave', tone: KTone.due),
            const KStatusDot(label: 'Absent', tone: KTone.negative),
            const KStatusDot(label: 'Half day', tone: KTone.brand),
          ]),
          const SizedBox(height: AppSpace.xs),
          Text(calendarSummary(_events), style: AppText.caption),
          const SizedBox(height: AppSpace.sm),
          KCard(
            padding: const EdgeInsets.all(AppSpace.sm),
            child: Column(children: [
              Row(children: [
                for (final w in _weekdays) Expanded(child: Center(child: Text(w, style: AppText.small.copyWith(color: AppColors.ink3)))),
              ]),
              const SizedBox(height: 4),
              for (var i = 0; i < days.length; i += 7) Row(children: [for (final d in days.skip(i).take(7)) Expanded(child: _dayCell(d))]),
            ]),
          ),
          const SizedBox(height: AppSpace.md),
          _details(),
        ],
      ),
    );
  }

  Widget _dayCell(DateTime day) {
    final key = ymd(day);
    final events = _events[key] ?? const <CalendarEvent>[];
    final inMonth = day.month == _month.month;
    final selected = day == _selected;
    final today = day == dateOnly(DateTime.now());
    final tones = {for (final e in events) calendarTone(e)};
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => setState(() => _selected = day),
      child: Container(
        key: ValueKey('cal-$key'),
        height: 52,
        margin: const EdgeInsets.all(2),
        decoration: BoxDecoration(
          color: selected ? AppColors.brandSoft : null,
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border.all(color: selected ? AppColors.brand : (today ? AppColors.ink3 : AppColors.hairline)),
        ),
        child: Opacity(
          opacity: inMonth ? 1 : 0.4,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('${day.day}', style: AppText.label.copyWith(fontWeight: today ? FontWeight.w800 : FontWeight.w500)),
              const SizedBox(height: 4),
              SizedBox(
                height: 8,
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  for (final t in tones)
                    Container(width: 7, height: 7, margin: const EdgeInsets.symmetric(horizontal: 1.5), decoration: BoxDecoration(color: t.fg, shape: BoxShape.circle)),
                ]),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _details() {
    final events = _events[ymd(_selected)] ?? const <CalendarEvent>[];
    final title = '${_longWeekdays[_selected.weekday - 1]}, ${ddMMMyyyy(_selected)}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KSectionHeader(title),
        if (events.isEmpty)
          Padding(padding: const EdgeInsets.symmetric(vertical: AppSpace.sm), child: Text('Nothing recorded for this day.', style: AppText.body.copyWith(color: AppColors.ink2)))
        else
          KCard(child: KDivided(indent: 0, children: [for (final e in events) _event(e, events)])),
      ],
    );
  }

  Widget _event(CalendarEvent e, List<CalendarEvent> dayEvents) {
    final tone = calendarTone(e);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(e.employeeName, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                if (e.employeeCode.isNotEmpty) Text(e.employeeCode, style: AppText.caption),
              ]),
            ),
            KPill(label: e.statusLabel, tone: tone),
          ]),
          const SizedBox(height: 6),
          if (e.isLeave) ...[
            Text(e.leaveName, style: AppText.body),
            Text(e.rangeLine, style: AppText.caption),
          ] else ...[
            Text('Marked on attendance register (${e.status == 'half_day' ? 'half day' : 'absent'}).', style: AppText.caption),
            if (lacksApprovedLeave(e, dayEvents))
              Text('No approved leave request — may count as LWP in payroll.', style: AppText.caption.copyWith(color: AppColors.due)),
          ],
        ],
      ),
    );
  }
}

/// Leave balances for one employee and year, from `GET /api/employees/leave-balances`. The numbers
/// are the server's: available, and what it is made of.
class LeaveBalancesScreen extends StatefulWidget {
  const LeaveBalancesScreen({super.key, required this.session, this.employeeId, this.employeeName});

  final AppSession session;

  /// Opens straight on this employee when given.
  final String? employeeId;
  final String? employeeName;

  @override
  State<LeaveBalancesScreen> createState() => _LeaveBalancesScreenState();
}

class _LeaveBalancesScreenState extends State<LeaveBalancesScreen> {
  String? _employeeId;
  String? _employeeName;
  int _year = DateTime.now().year;
  List<LeaveBalanceRow> _rows = const [];
  bool _loading = false;
  String? _error;
  bool _notInPlan = false;
  int _loadId = 0;

  @override
  void initState() {
    super.initState();
    _employeeId = widget.employeeId;
    _employeeName = widget.employeeName;
    if (_employeeId != null) _load();
  }

  Future<void> _load() async {
    final employeeId = _employeeId;
    if (employeeId == null) return;
    final id = ++_loadId;
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson(leaveBalancePath(employeeId, _year));
      if (!mounted || id != _loadId) return;
      setState(() {
        _rows = leaveBalances(body['balances']);
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

  void _setYear(int year) {
    setState(() => _year = year);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Leave balances'),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.xs),
              child: KAsyncPickField(
                label: 'Employee',
                valueLabel: _employeeName,
                search: (q) => searchEmployees(widget.session.api, q),
                onPicked: (id, label) {
                  setState(() {
                    _employeeId = id;
                    _employeeName = label;
                  });
                  _load();
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.sm),
              child: Row(children: [
                KIconButton(icon: LucideIcons.chevronLeft, tooltip: 'Previous year', onTap: () => _setYear(_year - 1)),
                Expanded(child: Center(child: Text('$_year', style: AppText.bodyStrong))),
                KIconButton(icon: LucideIcons.chevronRight, tooltip: 'Next year', onTap: () => _setYear(_year + 1)),
              ]),
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_employeeId == null) {
      return ListView(children: const [
        KEmptyState(icon: LucideIcons.users, title: 'Choose an employee to see their leave balances'),
      ]);
    }
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null) return _stateMessage(notInPlan: _notInPlan, title: 'Could not load balances', message: _error, onRetry: _load);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          if (_rows.isEmpty)
            KEmptyState(icon: LucideIcons.calendarCheck, title: 'No leave balances for $_year')
          else
            KCard(
              child: KDivided(indent: 0, children: [
                for (final r in _rows)
                  KListRow(
                    title: r.label,
                    subtitle: r.breakdown,
                    trailing: Text(leaveDays(r.current), style: AppText.bodyStrong),
                  ),
              ]),
            ),
        ],
      ),
    );
  }
}
