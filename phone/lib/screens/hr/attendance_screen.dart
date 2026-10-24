import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../pages/website_page_screen.dart';
import 'roll_call_logic.dart';

/// Website `/employees/attendance` roll call: one row per employee for the chosen day,
/// with Present / Absent / Half day / Off. Saves each tap straight away.
class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  DateTime _day = dateOnly(DateTime.now());
  List<RollCallRow> _rows = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  bool _noTeam = false;
  final Set<String> _saving = {};
  bool _markingAll = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
      _noTeam = false;
    });
    try {
      final body = await widget.session.api.getJson('/api/employees/manager/attendance?date=${ymd(_day)}');
      if (!mounted) return;
      setState(() {
        _rows = rollCallRows(body['team']);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        // 403 without a plan code: no one this user may mark, or no active employees yet.
        _noTeam = !_notInPlan && e.status == 403;
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not reach the server.'; _loading = false; });
    }
  }

  void _moveDay(int days) {
    final next = _day.add(Duration(days: days));
    if (next.isAfter(dateOnly(DateTime.now()))) return;
    setState(() => _day = next);
    _load();
  }

  Future<void> _pickDay() async {
    final picked = await showDatePicker(context: context, initialDate: _day, firstDate: DateTime(2000), lastDate: DateTime.now());
    if (picked == null) return;
    setState(() => _day = dateOnly(picked));
    _load();
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _mark(RollCallRow row, String status) async {
    if (row.status == status || _saving.contains(row.employeeId)) return;
    final before = _rows;
    setState(() {
      _saving.add(row.employeeId);
      _rows = [for (final r in _rows) r.employeeId == row.employeeId ? r.withStatus(status) : r];
    });
    try {
      await widget.session.api.putJson('/api/employees/manager/attendance', {
        'employee_id': row.employeeId,
        'date': ymd(_day),
        'status': status,
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _rows = before);
      _toast(e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _rows = before);
      _toast('Could not save. Try again.');
    } finally {
      if (mounted) setState(() => _saving.remove(row.employeeId));
    }
  }

  Future<void> _markAllPresent() async {
    final marks = markAllPresentMarks(_rows);
    if (marks.isEmpty || _markingAll) return;
    setState(() => _markingAll = true);
    try {
      await widget.session.api.postJson('/api/employees/manager/attendance', {'date': ymd(_day), 'marks': marks});
      if (!mounted) return;
      _toast('Marked ${marks.length} present');
      await _load();
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    } catch (_) {
      if (mounted) _toast('Could not save. Try again.');
    } finally {
      if (mounted) setState(() => _markingAll = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(
              'Attendance',
              trailing: KIconButton(
                icon: LucideIcons.globe,
                tooltip: 'History and reviews on the website',
                onTap: () => openWebsiteInApp(context, widget.session, '/employees/attendance', 'Attendance'),
              ),
            ),
            _dayBar(),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _dayBar() {
    final isToday = _day == dateOnly(DateTime.now());
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter - 8, 0, AppSpace.gutter - 8, AppSpace.xs),
      child: Row(children: [
        KIconButton(icon: LucideIcons.chevronLeft, tooltip: 'Previous day', onTap: () => _moveDay(-1)),
        Expanded(
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _pickDay,
            child: Column(children: [
              Text(rollCallDayLabel(_day, DateTime.now()), style: AppText.heading.copyWith(fontSize: 16)),
              Text(ddMMMyyyy(_day), style: AppText.caption),
            ]),
          ),
        ),
        KIconButton(
          icon: LucideIcons.chevronRight,
          tooltip: 'Next day',
          color: isToday ? AppColors.hairline : null,
          onTap: () => _moveDay(1),
        ),
      ]),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_noTeam) {
      return ListView(children: [
        KEmptyState(
          icon: LucideIcons.users,
          title: 'No employees to mark yet',
          body: _error,
          action: KButton(
            label: 'Add employee',
            expand: false,
            onPressed: () => openWebsiteInApp(context, widget.session, '/employees/new', 'Add Employee'),
          ),
        ),
      ]);
    }
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
    final summary = rollCallSummary(_rows);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          Wrap(spacing: 8, runSpacing: 8, children: [
            KPill(label: '${summary.present} present', tone: KTone.positive),
            KPill(label: '${summary.absent} absent', tone: KTone.negative),
            if (summary.half > 0) KPill(label: '${summary.half} half day', tone: KTone.due),
            if (summary.off > 0) KPill(label: '${summary.off} off', tone: KTone.neutral),
            KPill(label: '${summary.pending} not marked', tone: KTone.neutral),
          ]),
          if (summary.pending > 0) ...[
            const SizedBox(height: AppSpace.sm),
            KButton.secondary(
              label: 'Mark ${summary.pending} not marked as present',
              loading: _markingAll,
              onPressed: _markAllPresent,
            ),
          ],
          const SizedBox(height: AppSpace.sm),
          KCard(child: KDivided(indent: 0, children: [for (final row in _rows) _row(row)])),
        ],
      ),
    );
  }

  Widget _row(RollCallRow row) {
    final saving = _saving.contains(row.employeeId);
    final sub = [row.designation, row.code].where((v) => v != null && v.isNotEmpty).join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            KAvatar(name: row.name, size: 36),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(row.name, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                if (sub.isNotEmpty) Text(sub, style: AppText.caption),
              ]),
            ),
            if (saving)
              const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
            else
              Text(rollCallStatusLabel(row.status), style: AppText.caption),
          ]),
          const SizedBox(height: 10),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final (status, label) in rollCallStatuses)
              KChip(label: label, selected: row.status == status, onTap: () => _mark(row, status)),
          ]),
        ],
      ),
    );
  }
}
