import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../pages/native_routes.dart';
import '../sales/doc_action_sheets.dart';
import 'attendance_leave_logic.dart';
import 'employee_logic.dart';
import 'hr_logic.dart';

const _dayWidth = 104.0;
const _rowHeight = 56.0;
const _headHeight = 48.0;
const _nameWidth = 136.0;

Widget _planOrError({required bool notInPlan, required String title, required String? message, required VoidCallback onRetry}) {
  return ListView(children: [
    KEmptyState(
      icon: notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
      title: notInPlan ? 'Not included in your current plan' : title,
      body: message,
      action: notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: onRetry),
    ),
  ]);
}

/// Website `/hr/shifts/roster`: the week as employees by seven days. Tapping a day picks a shift or
/// Off and saves that one day.
class ShiftRosterScreen extends StatefulWidget {
  const ShiftRosterScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ShiftRosterScreen> createState() => _ShiftRosterScreenState();
}

class _ShiftRosterScreenState extends State<ShiftRosterScreen> {
  DateTime _weekStart = mondayOf(DateTime.now());
  String _department = '';
  String _branchId = '';
  List<String> _departments = const [];
  List<(String, String)> _branches = const [];
  RosterWeek? _week;
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  int _loadId = 0;
  final Set<String> _saving = {};
  bool _filling = false;

  @override
  void initState() {
    super.initState();
    _load();
    _loadFilters();
  }

  /// The department and branch choices only narrow the roster; it works without them.
  Future<void> _loadFilters() async {
    final api = widget.session.api;
    final results = await Future.wait<Object?>([
      api.getJson('/api/settings/hr-org-catalog').then<Object?>((v) => v).catchError((_) => null),
      api.getJson('/api/branches').then<Object?>((v) => v).catchError((_) => null),
    ]);
    if (!mounted) return;
    final branches = results[1];
    setState(() {
      _departments = catalogList(results[0], 'departments');
      _branches = [
        for (final b in jsonRows(branches is Map ? branches['branches'] : null))
          if ((b['id']?.toString() ?? '').isNotEmpty) (b['id'].toString(), b['name']?.toString() ?? 'Branch'),
      ];
    });
  }

  Future<void> _load() async {
    final id = ++_loadId;
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson(rosterPath(_weekStart, department: _department, branchId: _branchId));
      if (!mounted || id != _loadId) return;
      setState(() {
        _week = RosterWeek.fromJson(body);
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

  void _moveWeek(int weeks) {
    setState(() => _weekStart = DateTime(_weekStart.year, _weekStart.month, _weekStart.day + 7 * weeks));
    _load();
  }

  void _toast(String message, {KTone tone = KTone.neutral}) {
    if (mounted) showKToast(context, message, tone: tone);
  }

  Future<void> _pickDay(RosterEmployee emp, String date) async {
    final week = _week;
    final key = '${emp.id}|$date';
    if (week == null || _saving.contains(key)) return;
    final current = week.cell(emp.id, date);
    final day = DateTime.tryParse(date);
    // `null` (closed) is told apart from a choice by the wrapper record.
    final picked = await showKSheet<({String? shiftId})>(
      context,
      title: '${emp.name} · ${day == null ? date : ddMMM(day)}',
      scrollable: true,
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final s in week.shifts)
            KSheetAction(
              key: ValueKey('pick-${s.id}'),
              icon: LucideIcons.clock,
              label: s.label,
              selected: current != null && !current.isDayOff && current.shiftId == s.id,
              onTap: () => Navigator.of(ctx).pop((shiftId: s.id)),
            ),
          KSheetAction(
            key: const ValueKey('pick-off'),
            icon: LucideIcons.moon,
            label: 'Off',
            selected: current?.isDayOff == true,
            onTap: () => Navigator.of(ctx).pop((shiftId: null)),
          ),
        ],
      ),
    );
    if (picked == null || !mounted || _saving.contains(key)) return;
    setState(() => _saving.add(key));
    try {
      await widget.session.api.patchJson('/api/hr/shifts/roster', rosterEntryBody(emp.id, date, shiftId: picked.shiftId));
      _toast('Roster saved', tone: KTone.positive);
      if (mounted) await _load();
    } on ApiException catch (e) {
      _toast(e.message, tone: KTone.negative);
    } catch (_) {
      _toast('Could not save. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _saving.remove(key));
    }
  }

  Future<void> _fillDefaults() async {
    if (_filling) return;
    final ok = await askSheet(
      context,
      title: 'Fill this week?',
      text: 'Fill ${_week?.label ?? 'this week'} from each employee\'s default shift, with weekly offs and holidays as days off?',
      confirmLabel: 'Fill week',
      cancelLabel: 'Cancel',
      danger: false,
    );
    if (!ok || !mounted || _filling) return;
    setState(() => _filling = true);
    try {
      final body = await widget.session.api.patchJson(
        '/api/hr/shifts/roster',
        fillDefaultsBody(_weekStart, department: _department, branchId: _branchId),
      );
      _toast('Filled ${jsNumberString(toNum(body['filled']))} roster cells from defaults', tone: KTone.positive);
      if (mounted) await _load();
    } on ApiException catch (e) {
      _toast(e.message, tone: KTone.negative);
    } catch (_) {
      _toast('Could not save. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _filling = false);
    }
  }

  void _openBulk() => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => BulkShiftAssignScreen(session: widget.session)));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar('Shift roster', trailing: KIconButton(icon: LucideIcons.calendarPlus, tooltip: 'Bulk assign', onTap: _openBulk)),
            _weekBar(),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _weekBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter - 8, 0, AppSpace.gutter - 8, AppSpace.xs),
      child: Row(children: [
        KIconButton(icon: LucideIcons.chevronLeft, tooltip: 'Previous week', onTap: () => _moveWeek(-1)),
        Expanded(child: Center(child: Text(_week?.label ?? '', style: AppText.bodyStrong))),
        KIconButton(icon: LucideIcons.chevronRight, tooltip: 'Next week', onTap: () => _moveWeek(1)),
      ]),
    );
  }

  Widget _filters() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
      child: Column(children: [
        if (_departments.isNotEmpty || _branches.isNotEmpty)
          Row(children: [
            if (_departments.isNotEmpty)
              Expanded(
                child: KPickField<String>(
                  label: 'Department',
                  value: _department,
                  options: [('', 'All departments'), for (final d in _departments) (d, d)],
                  onChanged: (v) {
                    setState(() => _department = v);
                    _load();
                  },
                ),
              ),
            if (_departments.isNotEmpty && _branches.isNotEmpty) const SizedBox(width: AppSpace.sm),
            if (_branches.isNotEmpty)
              Expanded(
                child: KPickField<String>(
                  label: 'Branch',
                  value: _branchId,
                  options: [('', 'All branches'), for (final b in _branches) (b.$1, b.$2)],
                  onChanged: (v) {
                    setState(() => _branchId = v);
                    _load();
                  },
                ),
              ),
          ]),
        const SizedBox(height: AppSpace.sm),
        Row(children: [
          Expanded(child: KButton.secondary(label: 'Fill from defaults', height: 44, loading: _filling, onPressed: _fillDefaults)),
          const SizedBox(width: AppSpace.sm),
          Expanded(child: KButton.secondary(label: 'Manage shifts', height: 44, onPressed: () => openAppHref(context, widget.session, '/settings/shifts', 'Shifts'))),
        ]),
      ]),
    );
  }

  Widget _body() {
    if (_loading && _week == null) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null) return _planOrError(notInPlan: _notInPlan, title: 'Could not load the roster', message: _error, onRetry: _load);
    final week = _week;
    if (week == null) return const SizedBox.shrink();
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: AppSpace.xl),
        children: [
          _filters(),
          if (_loading) const KSpinner(padding: EdgeInsets.symmetric(vertical: 16), size: 18),
          if (week.employees.isEmpty)
            const KEmptyState(icon: LucideIcons.users, title: 'No active employees match the filter.')
          else
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: KCard(padding: EdgeInsets.zero, child: _grid(week)),
            ),
        ],
      ),
    );
  }

  Widget _grid(RosterWeek week) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: _nameWidth,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(height: _headHeight, child: Padding(padding: const EdgeInsets.only(left: 12), child: Align(alignment: Alignment.centerLeft, child: Text('Employee', style: AppText.caption)))),
            for (final e in week.employees)
              SizedBox(
                height: _rowHeight,
                child: Padding(
                  padding: const EdgeInsets.only(left: 12, right: 6),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                    Text(e.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                    Text(e.code, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.small.copyWith(color: AppColors.ink2)),
                  ]),
                ),
              ),
          ]),
        ),
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Column(children: [
              Row(children: [
                for (final d in week.days)
                  SizedBox(
                    width: _dayWidth,
                    height: _headHeight,
                    child: Center(child: Text(_dayHead(d), style: AppText.label.copyWith(fontWeight: FontWeight.w600))),
                  ),
              ]),
              for (final e in week.employees)
                Row(children: [for (final d in week.days) _cell(week, e, d)]),
            ]),
          ),
        ),
      ],
    );
  }

  String _dayHead(String date) {
    final d = DateTime.tryParse(date);
    if (d == null) return date;
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return '${names[d.weekday - 1]} ${d.day.toString().padLeft(2, '0')}';
  }

  Widget _cell(RosterWeek week, RosterEmployee e, String date) {
    final c = week.cell(e.id, date);
    final text = week.cellText(e.id, date);
    final tone = c == null ? null : (c.isDayOff ? KTone.neutral : (c.shiftId != null ? KTone.brand : null));
    final saving = _saving.contains('${e.id}|$date');
    return SizedBox(
      width: _dayWidth,
      height: _rowHeight,
      child: Padding(
        padding: const EdgeInsets.all(4),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: saving ? null : () => _pickDay(e, date),
          child: Container(
            key: ValueKey('roster-${e.id}-$date'),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 6),
            decoration: BoxDecoration(color: tone?.bg, borderRadius: BorderRadius.circular(AppRadius.sm), border: tone == null ? Border.all(color: AppColors.hairline) : null),
            child: saving
                ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                : Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.small.copyWith(fontWeight: FontWeight.w600, color: tone?.fg ?? AppColors.ink3)),
          ),
        ),
      ),
    );
  }
}

/// Website `/hr/shifts/bulk-assign`, with the employees chosen by hand: sets the default shift of
/// each chosen employee from a date. The server answers with how many it changed.
class BulkShiftAssignScreen extends StatefulWidget {
  const BulkShiftAssignScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<BulkShiftAssignScreen> createState() => _BulkShiftAssignScreenState();
}

class _BulkShiftAssignScreenState extends State<BulkShiftAssignScreen> {
  List<RosterShift> _shifts = const [];
  List<({String id, String name, String sub})> _people = const [];
  final Set<String> _selected = {};
  String _shiftId = '';
  DateTime _from = dateOnly(DateTime.now());
  DateTime? _to;
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  final _search = TextEditingController();
  bool _saving = false;

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
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final api = widget.session.api;
      final shiftBody = await api.getJson('/api/shifts?active_only=true');
      final people = <({String id, String name, String sub})>[];
      for (var page = 1; page <= 20; page++) {
        final body = await api.getJson('/api/employees?status=active&limit=100&page=$page');
        final rows = jsonRows(body['employees']);
        for (final r in rows) {
          final id = r['id']?.toString() ?? '';
          if (id.isEmpty) continue;
          final role = r['designation']?.toString().trim() ?? '';
          people.add((id: id, name: employeeName(r), sub: role.isNotEmpty ? role : (r['employee_code']?.toString() ?? '')));
        }
        if (rows.length < 100) break;
      }
      if (!mounted) return;
      setState(() {
        _shifts = [
          for (final s in jsonRows(shiftBody['shifts']))
            if (s['is_active'] != false) ?RosterShift.fromJson(s),
        ];
        _people = people;
        _selected.removeWhere((id) => !people.any((p) => p.id == id));
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not reach the server.'; _loading = false; });
    }
  }

  List<({String id, String name, String sub})> get _visible {
    final q = _search.text.trim().toLowerCase();
    if (q.isEmpty) return _people;
    return [for (final p in _people) if (p.name.toLowerCase().contains(q) || p.sub.toLowerCase().contains(q)) p];
  }

  String get _shiftName {
    for (final s in _shifts) {
      if (s.id == _shiftId) return s.name;
    }
    return 'no default shift';
  }

  Future<void> _assign() async {
    if (_saving) return;
    // In list order, so the body does not depend on the order of the taps.
    final ids = [for (final p in _people) if (_selected.contains(p.id)) p.id];
    final body = bulkAssignBody(shiftId: _shiftId.isEmpty ? null : _shiftId, employeeIds: ids, from: _from, to: _to);
    if (body == null) return;
    final count = ids.length == 1 ? '1 employee' : '${ids.length} employees';
    final from = ddMMMyyyy(_from);
    final until = _to == null ? '' : ' to ${ddMMMyyyy(_to!)}';
    final clearing = _shiftId.isEmpty;
    final ok = await askSheet(
      context,
      title: clearing ? 'Clear shift?' : 'Assign shift?',
      text: clearing
          ? 'Clear the default shift of $count from $from$until?'
          : 'Set $_shiftName as the shift of $count from $from$until?',
      confirmLabel: clearing ? 'Clear shift' : 'Assign',
      cancelLabel: 'Cancel',
      danger: clearing,
    );
    if (!ok || !mounted || _saving) return;
    setState(() => _saving = true);
    try {
      final reply = await widget.session.api.postJson('/api/hr/shifts/bulk-assign', body);
      if (!mounted) return;
      showKToast(context, 'Assigned shift to ${jsNumberString(toNum(reply['assigned']))} employee(s)', tone: KTone.positive);
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not save. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _error != null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const KBackBar('Bulk shift assignment'),
            Expanded(
              child: _loading
                  ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
                  : _planOrError(notInPlan: _notInPlan, title: 'Could not load shifts and employees', message: _error, onRetry: _load),
            ),
          ]),
        ),
      );
    }
    final visible = _visible;
    final allVisible = visible.isNotEmpty && visible.every((p) => _selected.contains(p.id));
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Bulk shift assignment'),
            Expanded(
              child: ListView(
                keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xl),
                children: [
                  for (final (i, c) in _fields(visible, allVisible).indexed) ...[
                    if (i > 0) const SizedBox(height: AppSpace.md),
                    c,
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: KBottomBar(
        children: [
          Expanded(child: KButton(label: 'Assign shift', loading: _saving, onPressed: _saving || _selected.isEmpty ? null : _assign)),
        ],
      ),
    );
  }

  List<Widget> _fields(List<({String id, String name, String sub})> visible, bool allVisible) {
    return [
      KPickField<String>(
        label: 'Shift',
        value: _shiftId,
        options: [('', 'No default shift'), for (final s in _shifts) (s.id, s.label)],
        onChanged: (v) => setState(() => _shiftId = v),
      ),
      KDateField(label: 'Effective from', value: _from, onChanged: (d) => setState(() => _from = dateOnly(d))),
      KDateField(label: 'Effective to (optional)', value: _to, onChanged: (d) => setState(() => _to = dateOnly(d))),
      KFormSection(title: 'Employees', children: [
        KSearchField(controller: _search, hint: 'Search by name or role', onChanged: (_) => setState(() {})),
        Row(children: [
          Expanded(child: Text('${_selected.length} selected', style: AppText.bodyStrong)),
          KTextButton(
            label: allVisible ? 'Clear' : 'Select all',
            onTap: () => setState(() {
              if (allVisible) {
                _selected.removeAll(visible.map((p) => p.id));
              } else {
                _selected.addAll(visible.map((p) => p.id));
              }
            }),
          ),
        ]),
        if (visible.isEmpty)
          const KEmptyState(icon: LucideIcons.users, title: 'No employees found')
        else
          KCard(
            child: KDivided(indent: 0, children: [
              for (final p in visible)
                KListRow(
                  key: ValueKey('emp-${p.id}'),
                  title: p.name,
                  subtitle: p.sub,
                  leading: Icon(_selected.contains(p.id) ? LucideIcons.squareCheck : LucideIcons.square, size: 22, color: _selected.contains(p.id) ? AppColors.brand : AppColors.ink3),
                  onTap: () => setState(() {
                    if (!_selected.remove(p.id)) _selected.add(p.id);
                  }),
                ),
            ]),
          ),
      ]),
    ];
  }
}
