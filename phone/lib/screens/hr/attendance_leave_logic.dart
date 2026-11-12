/// Pure helpers for attendance history, check-in reviews, regularization, the shift roster, bulk
/// shift assignment and the leave screens (apply, balances, calendar).
///
/// Every request here leaves out `business_id`, `user_id` and `created_by`: the session names the
/// business and the user. The phone shows the server's days, hours, balances and counts; it adds up
/// nothing itself.
library;

import 'dart:convert';
import 'dart:typed_data';

import '../../capability.dart';
import '../../format.dart';
import '../../session.dart';
import '../../ui/kit.dart';
import '../reports/report_period.dart';
import 'employee_logic.dart';
import 'leave_logic.dart';

String _t(dynamic v) => v?.toString().trim() ?? '';

String? _orNull(String? v) {
  final t = v?.trim() ?? '';
  return t.isEmpty ? null : t;
}

String _two(int n) => n.toString().padLeft(2, '0');

// ---------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------

/// What the plan and role let this user see, read the way the website's `hasCapability` does
/// (`/api/features/enabled` and `/api/settings/permissions`). When those cannot be read it allows
/// everything, so a link is never hidden by a failed request; the server still refuses with
/// `FEATURE_NOT_IN_PLAN`, which each screen shows.
class HrAccess {
  const HrAccess._(this._caps);

  final Capabilities? _caps;

  static const open = HrAccess._(null);

  bool has(String resource, [String action = 'view']) => _caps == null || _caps.has(resource, action);
}

HrAccess hrAccess(Object? features, Object? permissions, {required bool sessionIsPrimaryAdmin}) {
  if (features is! Map || features['enabledIds'] is! List) return HrAccess.open;
  final perms = <String, Map<String, dynamic>>{
    for (final e in ((permissions is Map ? permissions['permissions'] : null) as Map? ?? const {}).entries)
      if (e.value is Map) e.key.toString(): Map<String, dynamic>.from(e.value as Map),
  };
  final isAdmin = permissions is Map && permissions['isPrimaryAdmin'] == true;
  final reliable = perms.isNotEmpty || isAdmin;
  return HrAccess._(Capabilities(
    sessionIsPrimaryAdmin: sessionIsPrimaryAdmin,
    sessionPermissions: const {},
    snapshot: CapabilitySnapshot(
      permissions: reliable ? perms : const {},
      isPrimaryAdmin: reliable && isAdmin,
      enabledFeatures: [for (final id in features['enabledIds'] as List) id.toString()],
    ),
  ));
}

Future<HrAccess> loadHrAccess(AppSession session) async {
  final api = session.api;
  final results = await Future.wait<Object?>([
    api.getJson('/api/features/enabled').then<Object?>((v) => v).catchError((_) => null),
    api.getJson('/api/settings/permissions').then<Object?>((v) => v).catchError((_) => null),
  ]);
  return hrAccess(results[0], results[1], sessionIsPrimaryAdmin: session.isPrimaryAdmin);
}

// ---------------------------------------------------------------------------------------------
// Attendance history: `GET /api/employees/attendance/matrix?month=YYYY-MM`
// ---------------------------------------------------------------------------------------------

String matrixPath(MonthPeriod p) => '/api/employees/attendance/matrix?month=${p.year}-${_two(p.month)}';

class MatrixDay {
  const MatrixDay({required this.date, required this.day, required this.weekday, required this.isSunday});

  final String date;
  final int day;
  final String weekday;
  final bool isSunday;

  DateTime? get parsed => DateTime.tryParse(date);
}

/// One day of one employee, exactly as the server sent it.
class MatrixCell {
  const MatrixCell({
    required this.kind,
    required this.label,
    required this.hours,
    required this.calendarCode,
    required this.missingOutPunch,
    required this.earlyMinutes,
    required this.lateMinutes,
  });

  /// `present`, `overtime`, `half_day`, `absent`, `leave`, `off` or `empty`.
  final String kind;
  final String label;
  final num hours;
  final String calendarCode;
  final bool missingOutPunch;
  final num earlyMinutes;
  final num lateMinutes;

  static MatrixCell fromJson(dynamic json) {
    final j = json is Map ? json : const {};
    return MatrixCell(
      kind: _t(j['kind']).isEmpty ? 'empty' : _t(j['kind']),
      label: _t(j['label']),
      hours: toNum(j['hours']),
      calendarCode: _t(j['calendarCode']),
      missingOutPunch: j['missingOutPunch'] == true,
      earlyMinutes: toNum(j['earlyMinutes']),
      lateMinutes: toNum(j['lateMinutes']),
    );
  }

  /// The word for the day sheet.
  String get statusLabel => switch (kind) {
        'present' => 'Present',
        'overtime' => 'Overtime',
        'half_day' => 'Half day',
        'absent' => 'Absent',
        'leave' => 'On leave',
        'off' => calendarCode == 'H' ? 'Holiday' : 'Weekly off',
        _ => 'Not marked',
      };
}

class MatrixWorker {
  const MatrixWorker({required this.id, required this.code, required this.name, required this.cells, required this.days, required this.totalHoursLabel});

  final String id;
  final String code;
  final String name;
  final List<MatrixCell> cells;

  /// Worked days and total hours, as the server worked them out.
  final num days;
  final String totalHoursLabel;

  /// "22 days · 176h".
  String get totalsLine {
    final d = days == 1 ? '1 day' : '${jsNumberString(days)} days';
    return totalHoursLabel.isEmpty ? d : '$d · $totalHoursLabel';
  }
}

class AttendanceMatrix {
  const AttendanceMatrix({required this.days, required this.workers});

  final List<MatrixDay> days;
  final List<MatrixWorker> workers;

  factory AttendanceMatrix.fromJson(Map<String, dynamic> json) => AttendanceMatrix(
        days: [
          for (final d in jsonRows(json['days']))
            MatrixDay(date: _t(d['date']), day: toNum(d['day']).toInt(), weekday: _t(d['weekday']), isSunday: d['isSunday'] == true),
        ],
        workers: [
          for (final w in jsonRows(json['workers']))
            if (_t(w['id']).isNotEmpty)
              MatrixWorker(
                id: _t(w['id']),
                code: _t(w['code']),
                name: _t(w['name']).isEmpty ? (_t(w['code']).isEmpty ? 'Employee' : _t(w['code'])) : _t(w['name']),
                cells: [for (final c in (w['cells'] is List ? w['cells'] as List : const [])) MatrixCell.fromJson(c)],
                days: toNum(w['days']),
                totalHoursLabel: _t(w['totalHoursLabel']),
              ),
        ],
      );
}

/// The website's cell colours: emerald present, amber overtime, sky half day, rose absent. Leave
/// (fuchsia) and weekly off (grey) have no kit token of their own, so they use the neutral one and
/// are told apart by their letter. Null means no mark.
KTone? matrixTone(String kind) => switch (kind) {
      'present' => KTone.positive,
      'overtime' => KTone.due,
      'half_day' => KTone.brand,
      'absent' => KTone.negative,
      'leave' || 'off' => KTone.neutral,
      _ => null,
    };

List<MatrixWorker> filterWorkers(List<MatrixWorker> workers, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return workers;
  return [for (final w in workers) if (w.name.toLowerCase().contains(q) || w.code.toLowerCase().contains(q)) w];
}

// ---------------------------------------------------------------------------------------------
// Check-in reviews: `GET` / `POST /api/employees/attendance/reviews`
// ---------------------------------------------------------------------------------------------

/// `h:mm a` like date-fns.
String clock12(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${_two(d.minute)} ${d.hour < 12 ? 'AM' : 'PM'}';
}

/// The website's `formatTs`: `dd MMM yyyy, h:mm a`, or a dash when empty.
String clockTs(String? iso) {
  final d = DateTime.tryParse(_t(iso));
  if (d == null) return '—';
  final local = d.toLocal();
  return '${ddMMMyyyy(local)}, ${clock12(local)}';
}

class PunchReview {
  const PunchReview({
    required this.id,
    required this.action,
    required this.riskScore,
    required this.reasons,
    required this.distanceM,
    required this.mapUrl,
    required this.siteName,
    required this.wifiMatched,
    required this.faceSimilarity,
    required this.photos,
    required this.createdAt,
    required this.employeeName,
    required this.employeeCode,
  });

  final String id;
  final String action;
  final num riskScore;
  final List<String> reasons;
  final num? distanceM;
  final String? mapUrl;
  final String siteName;
  final bool wifiMatched;
  final num? faceSimilarity;
  final List<String> photos;
  final DateTime? createdAt;
  final String employeeName;
  final String employeeCode;

  static PunchReview? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = _t(json['id']);
    if (id.isEmpty) return null;
    return PunchReview(
      id: id,
      action: _t(json['action']),
      riskScore: toNum(json['risk_score']),
      reasons: [
        for (final r in (json['reasons'] is List ? json['reasons'] as List : const []))
          if (r is Map && _t(r['message']).isNotEmpty) _t(r['message']),
      ],
      distanceM: json['distance_m'] == null ? null : toNum(json['distance_m']),
      mapUrl: _t(json['lat']).isNotEmpty && _t(json['lng']).isNotEmpty ? 'https://www.google.com/maps?q=${_t(json['lat'])},${_t(json['lng'])}' : null,
      siteName: _t(json['site_name']),
      wifiMatched: json['wifi_matched'] == true,
      faceSimilarity: json['face_similarity'] == null ? null : toNum(json['face_similarity']),
      photos: [
        for (final p in (json['photos'] is List ? json['photos'] as List : const []))
          if (p is Map && _t(p['data_url']).isNotEmpty) _t(p['data_url']),
      ],
      createdAt: DateTime.tryParse(_t(json['created_at']))?.toLocal(),
      employeeName: _t(json['employee_name']).isEmpty ? 'Employee' : _t(json['employee_name']),
      employeeCode: _t(json['employee_code']),
    );
  }

  /// "Asha Rao (EMP1)".
  String get title => employeeCode.isEmpty ? employeeName : '$employeeName ($employeeCode)';

  String get actionLabel => action == 'check_out' ? 'Check-out' : 'Check-in';

  /// "Check-in · 10 Nov 2026, 9:45 AM".
  String get whenLine => createdAt == null ? actionLabel : '$actionLabel · ${ddMMMyyyy(createdAt!)}, ${clock12(createdAt!)}';

  /// "540 m from Main shop", or "Map" when there is no distance.
  String? get placeLine {
    if (mapUrl == null) return null;
    if (distanceM == null) return 'Map';
    return '${jsNumberString(distanceM!)} m from ${siteName.isEmpty ? 'the office' : siteName}';
  }

  String? get faceLine => faceSimilarity == null ? null : 'Face match ${(faceSimilarity! * 100).round()}%';

  String get wifiLine => wifiMatched ? 'Office Wi-Fi seen' : 'No office Wi-Fi';
}

List<PunchReview> punchReviews(dynamic list) => list is List ? list.map(PunchReview.fromJson).whereType<PunchReview>().toList() : const [];

/// The image bytes of a `data:image/...;base64,...` photo, or null when it cannot be read.
Uint8List? photoBytes(String dataUrl) {
  final comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) return null;
  try {
    return base64Decode(dataUrl.substring(comma + 1));
  } catch (_) {
    return null;
  }
}

/// The website's body for `POST /api/employees/attendance/reviews`.
Map<String, dynamic> punchDecisionBody(String punchId, {required bool approve}) =>
    {'punch_id': punchId, 'decision': approve ? 'approved' : 'rejected'};

// ---------------------------------------------------------------------------------------------
// Regularization: the manager's pending asks and `PATCH /api/employees/manager/attendance-regularization/[id]`
// ---------------------------------------------------------------------------------------------

const _regularizationLabels = {
  'missing_check_in': 'Missing check-in',
  'missing_check_out': 'Missing check-out',
  'missing_both': 'Missing check-in & check-out',
  'override_check_in': 'Override check-in time',
  'override_check_out': 'Override check-out time',
  'delete_check_in': 'Delete check-in log',
  'delete_check_out': 'Delete check-out log',
  'partial_late_in': 'Partial day — late arrival',
  'partial_early_out': 'Partial day — early departure',
};

String regularizationTypeLabel(String type) => _regularizationLabels[type] ?? type;

class RegularizationAsk {
  const RegularizationAsk({
    required this.id,
    required this.employeeName,
    required this.employeeCode,
    required this.date,
    required this.type,
    required this.originalIn,
    required this.originalOut,
    required this.requestedIn,
    required this.requestedOut,
    required this.reason,
  });

  final String id;
  final String employeeName;
  final String employeeCode;
  final DateTime? date;
  final String type;
  final String? originalIn, originalOut, requestedIn, requestedOut;
  final String reason;

  static RegularizationAsk? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = _t(json['id']);
    if (id.isEmpty) return null;
    final raw = _t(json['attendance_date']);
    final day = DateTime.tryParse(raw.length >= 10 ? raw.substring(0, 10) : raw);
    return RegularizationAsk(
      id: id,
      employeeName: _t(json['employee_name']).isEmpty ? 'Employee' : _t(json['employee_name']),
      employeeCode: _t(json['employee_code']),
      date: day == null ? null : dateOnly(day),
      type: _t(json['request_type']),
      originalIn: _orNull(json['original_check_in']?.toString()),
      originalOut: _orNull(json['original_check_out']?.toString()),
      requestedIn: _orNull(json['requested_check_in']?.toString()),
      requestedOut: _orNull(json['requested_check_out']?.toString()),
      reason: _t(json['reason']),
    );
  }

  String get title => employeeCode.isEmpty ? employeeName : '$employeeName ($employeeCode)';

  /// "09 Nov 2026 · Missing check-out".
  String get dateLine => '${date == null ? '' : ddMMMyyyy(date!)} · ${regularizationTypeLabel(type)}'.replaceFirst(RegExp(r'^ · '), '');

  String get inLine => 'In: ${clockTs(originalIn)} → ${clockTs(requestedIn)}';
  String get outLine => 'Out: ${clockTs(originalOut)} → ${clockTs(requestedOut)}';
}

List<RegularizationAsk> regularizationAsks(dynamic list) =>
    list is List ? list.map(RegularizationAsk.fromJson).whereType<RegularizationAsk>().toList() : const [];

Map<String, dynamic> regularizationDecisionBody({required bool approve, String? reason}) => {
      'action': approve ? 'approve' : 'reject',
      if (!approve && _orNull(reason) != null) 'rejection_reason': _orNull(reason),
    };

// ---------------------------------------------------------------------------------------------
// Shift roster: `GET` / `PATCH /api/hr/shifts/roster`
// ---------------------------------------------------------------------------------------------

/// The Monday of the week [d] falls in (the website's week start).
DateTime mondayOf(DateTime d) => DateTime(d.year, d.month, d.day - (d.weekday - 1));

String rosterPath(DateTime weekStart, {String? department, String? branchId}) {
  final dept = _orNull(department);
  final branch = _orNull(branchId);
  return '/api/hr/shifts/roster?week_start=${ymd(weekStart)}'
      '${dept == null ? '' : '&department=${Uri.encodeQueryComponent(dept)}'}'
      '${branch == null ? '' : '&branch_id=${Uri.encodeQueryComponent(branch)}'}';
}

class RosterShift {
  const RosterShift({required this.id, required this.name, required this.start, required this.end});

  final String id, name, start, end;

  /// "Morning (09:00–17:00)".
  String get label {
    String hm(String v) => v.length >= 5 ? v.substring(0, 5) : v;
    return start.isEmpty && end.isEmpty ? name : '$name (${hm(start)}–${hm(end)})';
  }

  static RosterShift? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = _t(json['id']);
    if (id.isEmpty) return null;
    return RosterShift(id: id, name: _t(json['shift_name']).isEmpty ? 'Shift' : _t(json['shift_name']), start: _t(json['start_time']), end: _t(json['end_time']));
  }
}

class RosterCell {
  const RosterCell({this.shiftId, this.shiftName, this.isDayOff = false});

  final String? shiftId;
  final String? shiftName;
  final bool isDayOff;
}

class RosterEmployee {
  const RosterEmployee({required this.id, required this.code, required this.name});

  final String id, code, name;
}

class RosterWeek {
  const RosterWeek({required this.days, required this.employees, required this.cells, required this.shifts});

  /// Seven `yyyy-MM-dd` dates, as the server listed them.
  final List<String> days;
  final List<RosterEmployee> employees;
  final Map<String, RosterCell> cells;
  final List<RosterShift> shifts;

  factory RosterWeek.fromJson(Map<String, dynamic> json) {
    final rawCells = json['cells'];
    return RosterWeek(
      days: [for (final d in (json['days'] is List ? json['days'] as List : const [])) _t(d)],
      employees: [
        for (final e in jsonRows(json['employees']))
          if (_t(e['id']).isNotEmpty) RosterEmployee(id: _t(e['id']), code: _t(e['employee_code']), name: _t(e['employee_name']).isEmpty ? _t(e['employee_code']) : _t(e['employee_name'])),
      ],
      cells: {
        if (rawCells is Map)
          for (final e in rawCells.entries)
            if (e.value is Map)
              e.key.toString(): RosterCell(
                shiftId: _orNull((e.value as Map)['shift_id']?.toString()),
                shiftName: _orNull((e.value as Map)['shift_name']?.toString()),
                isDayOff: (e.value as Map)['is_day_off'] == true,
              ),
      },
      shifts: [for (final s in (json['shifts'] is List ? json['shifts'] as List : const [])) ?RosterShift.fromJson(s)],
    );
  }

  RosterCell? cell(String employeeId, String date) => cells['$employeeId|$date'];

  /// What the day shows: the shift's name, "Off" or a dash.
  String cellText(String employeeId, String date) {
    final c = cell(employeeId, date);
    if (c == null) return '—';
    if (c.isDayOff) return 'Off';
    if (c.shiftId == null) return '—';
    if (c.shiftName != null) return c.shiftName!;
    for (final s in shifts) {
      if (s.id == c.shiftId) return s.name;
    }
    return 'Shift';
  }

  /// "10 Nov – 16 Nov 2026".
  String get label {
    final first = days.isEmpty ? null : DateTime.tryParse(days.first);
    final last = days.length < 7 ? null : DateTime.tryParse(days[6]);
    if (first == null || last == null) return '';
    return '${ddMMM(first)} – ${ddMMMyyyy(last)}';
  }
}

/// One roster day as the website's save sends it. A shift id and `off` are alternatives; Off wins.
Map<String, dynamic> rosterEntryBody(String employeeId, String date, {String? shiftId}) => {
      'entries': [
        {'employee_id': employeeId, 'roster_date': date, 'shift_id': shiftId, 'is_day_off': shiftId == null},
      ],
    };

Map<String, dynamic> fillDefaultsBody(DateTime weekStart, {String? department, String? branchId}) => {
      'action': 'fill_defaults',
      'week_start': ymd(weekStart),
      if (_orNull(department) != null) 'department': _orNull(department),
      if (_orNull(branchId) != null) 'branch_id': _orNull(branchId),
    };

/// `POST /api/hr/shifts/bulk-assign`. Null when no employee is named: the server reads an empty
/// list as "every active employee", which the phone never asks for by accident.
Map<String, dynamic>? bulkAssignBody({required String? shiftId, required List<String> employeeIds, required DateTime from, DateTime? to}) {
  if (employeeIds.isEmpty) return null;
  return {
    'shift_id': shiftId,
    'employee_ids': employeeIds,
    'effective_from': ymd(from),
    'effective_to': to == null ? null : ymd(to),
  };
}

// ---------------------------------------------------------------------------------------------
// Apply leave on someone's behalf: `POST /api/employees/leave-requests`
// ---------------------------------------------------------------------------------------------

class LeaveTypeOption {
  const LeaveTypeOption({required this.id, required this.name, required this.code});

  final String id, name, code;

  /// "Casual Leave (CL)".
  String get label => code.isEmpty ? name : '$name ($code)';
}

/// `GET /api/leave-types?active_only=true` -> `{leave_types: [...]}`.
List<LeaveTypeOption> leaveTypeOptions(dynamic list) => [
      if (list is List)
        for (final t in list)
          if (t is Map && _t(t['id']).isNotEmpty)
            LeaveTypeOption(id: _t(t['id']), name: _t(t['leave_name']).isEmpty ? 'Leave' : _t(t['leave_name']), code: _t(t['leave_code'])),
    ];

/// The days the server counts for these dates and this type (weekly offs, holidays and sandwich
/// days included). The phone never counts them.
String leavePreviewPath({required DateTime start, required DateTime end, required String typeId}) =>
    '/api/hr/leave/preview-days?start_date=${ymd(start)}&end_date=${ymd(end)}&leave_type_id=${Uri.encodeQueryComponent(typeId)}';

class LeavePreview {
  const LeavePreview({required this.totalDays, required this.sandwichDays});

  final num totalDays;
  final num sandwichDays;

  factory LeavePreview.fromJson(Map<String, dynamic> json) =>
      LeavePreview(totalDays: toNum(json['total_days']), sandwichDays: toNum(json['sandwich_days']));

  /// "3 days".
  String get daysLine => leaveDays(totalDays);
}

String leaveBalancePath(String employeeId, int year) =>
    '/api/employees/leave-balances?employee_id=${Uri.encodeQueryComponent(employeeId)}&year=$year';

/// One leave type's balance for one employee and year, as `GET /api/employees/leave-balances` has it.
class LeaveBalanceRow {
  const LeaveBalanceRow({
    required this.typeId,
    required this.name,
    required this.code,
    required this.current,
    required this.opening,
    required this.earned,
    required this.used,
    required this.carryForward,
  });

  final String typeId, name, code;
  final num current, opening, earned, used, carryForward;

  String get label => code.isEmpty ? name : '$name ($code)';

  /// "Opening 6 · Earned 0 · Carried 0 · Used 1.5".
  String get breakdown =>
      'Opening ${jsNumberString(opening)} · Earned ${jsNumberString(earned)} · Carried ${jsNumberString(carryForward)} · Used ${jsNumberString(used)}';
}

List<LeaveBalanceRow> leaveBalances(dynamic list) => [
      if (list is List)
        for (final b in list)
          if (b is Map)
            LeaveBalanceRow(
              typeId: _t(b['leave_type_id']),
              name: _t(b['leave_name']).isEmpty ? 'Leave' : _t(b['leave_name']),
              code: _t(b['leave_code']),
              current: toNum(b['current_balance']),
              opening: toNum(b['opening_balance']),
              earned: toNum(b['earned_days']),
              used: toNum(b['used_days']),
              carryForward: toNum(b['carry_forward_days']),
            ),
    ];

LeaveBalanceRow? balanceFor(List<LeaveBalanceRow> rows, String typeId) {
  for (final r in rows) {
    if (r.typeId == typeId) return r;
  }
  return null;
}

/// The website's body: the person it is for, the type, the dates, and the optional reason and link.
/// The session names the business and the user who applies; neither is sent.
Map<String, dynamic> leaveRequestBody({
  required String employeeId,
  required String typeId,
  required DateTime start,
  required DateTime end,
  String reason = '',
  String attachmentUrl = '',
}) =>
    {
      'employee_id': employeeId,
      'leave_type_id': typeId,
      'start_date': ymd(start),
      'end_date': ymd(end),
      if (_orNull(reason) != null) 'reason': _orNull(reason),
      if (_orNull(attachmentUrl) != null) 'attachment_url': _orNull(attachmentUrl),
    };

/// The website's `validateForm` messages, by field (`employee`, `type`, `start`, `end`).
Map<String, String> leaveFormErrors({required String employeeId, required String typeId, required DateTime? start, required DateTime? end}) {
  final errors = <String, String>{};
  if (employeeId.isEmpty) errors['employee'] = 'Employee is required';
  if (typeId.isEmpty) errors['type'] = 'Leave type is required';
  if (start == null) errors['start'] = 'Start date is required';
  if (end == null) errors['end'] = 'End date is required';
  if (start != null && end != null && dateOnly(start).isAfter(dateOnly(end))) errors['end'] = 'End date must be after start date';
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Leave calendar: `GET /api/employees/leave-calendar?start_date&end_date`
// ---------------------------------------------------------------------------------------------

/// The Sunday on or before the first of the month, to the Saturday on or after its last day.
(DateTime, DateTime) calendarRange(MonthPeriod month) {
  final first = DateTime(month.year, month.month, 1);
  final last = DateTime(month.year, month.month + 1, 0);
  return (
    DateTime(first.year, first.month, first.day - first.weekday % 7),
    DateTime(last.year, last.month, last.day + (6 - last.weekday % 7)),
  );
}

String leaveCalendarPath(MonthPeriod month) {
  final (start, end) = calendarRange(month);
  return '/api/employees/leave-calendar?start_date=${ymd(start)}&end_date=${ymd(end)}';
}

List<DateTime> calendarGridDays(MonthPeriod month) {
  final (start, end) = calendarRange(month);
  final days = <DateTime>[];
  for (var d = start; !d.isAfter(end); d = DateTime(d.year, d.month, d.day + 1)) {
    days.add(d);
  }
  return days;
}

/// A leave request or an absent / half-day mark on one day.
class CalendarEvent {
  const CalendarEvent({
    required this.isLeave,
    required this.id,
    required this.employeeId,
    required this.employeeName,
    required this.employeeCode,
    required this.status,
    required this.leaveName,
    required this.start,
    required this.end,
    required this.days,
  });

  final bool isLeave;
  final String id, employeeId, employeeName, employeeCode;

  /// Leave: `approved` or `pending`. Attendance: `absent` or `half_day`.
  final String status;
  final String leaveName;
  final DateTime? start, end;
  final num days;

  static CalendarEvent? fromJson(dynamic json) {
    if (json is! Map) return null;
    final isLeave = _t(json['event_kind']) != 'attendance';
    DateTime? day(dynamic v) {
      final raw = _t(v);
      final d = DateTime.tryParse(raw.length >= 10 ? raw.substring(0, 10) : raw);
      return d == null ? null : dateOnly(d);
    }

    final date = day(json['date']);
    final name = _t(json['employee_name']);
    return CalendarEvent(
      isLeave: isLeave,
      id: _t(json['id']),
      employeeId: _t(json['employee_id']),
      employeeName: name.isEmpty ? (_t(json['employee_code']).isEmpty ? 'Employee' : _t(json['employee_code'])) : name,
      employeeCode: _t(json['employee_code']),
      status: _t(json['status']),
      leaveName: _t(json['leave_name']),
      start: isLeave ? day(json['start_date']) : date,
      end: isLeave ? day(json['end_date']) : date,
      days: toNum(json['total_days']),
    );
  }

  /// First name, with a half or a cross mark for an attendance mark.
  String get chip {
    final first = employeeName.split(' ').first;
    if (isLeave) return first;
    return status == 'half_day' ? '$first ½' : '$first ✕';
  }

  String get statusLabel => isLeave ? leaveStatusLabel(status) : (status == 'half_day' ? 'Half day' : 'Absent');

  /// "03 Nov – 05 Nov 2026 · 3 days".
  String get rangeLine {
    final s = start, e = end;
    if (s == null || e == null) return '';
    return '${ddMMM(s)} – ${ddMMMyyyy(e)} · ${leaveDays(days)}';
  }
}

/// `events_by_date`: `yyyy-MM-dd` -> the events on that day.
Map<String, List<CalendarEvent>> calendarEvents(dynamic byDate) {
  final out = <String, List<CalendarEvent>>{};
  if (byDate is! Map) return out;
  for (final e in byDate.entries) {
    final list = e.value is List ? (e.value as List).map(CalendarEvent.fromJson).whereType<CalendarEvent>().toList() : <CalendarEvent>[];
    if (list.isNotEmpty) out[e.key.toString()] = list;
  }
  return out;
}

/// The website's chip colours: approved green, pending amber, absent red, half day blue.
KTone calendarTone(CalendarEvent e) {
  if (e.isLeave) return e.status == 'approved' ? KTone.positive : KTone.due;
  return e.status == 'half_day' ? KTone.brand : KTone.negative;
}

/// "2 leave · 1 attendance mark", counted over every event the server listed, as the website does.
String calendarSummary(Map<String, List<CalendarEvent>> byDate) {
  var leaves = 0, marks = 0;
  for (final events in byDate.values) {
    for (final e in events) {
      if (e.isLeave) {
        leaves++;
      } else {
        marks++;
      }
    }
  }
  return '$leaves leave · $marks attendance mark${marks == 1 ? '' : 's'}';
}

/// True when [e] is an attendance mark with no approved leave for the same person that day.
bool lacksApprovedLeave(CalendarEvent e, List<CalendarEvent> dayEvents) =>
    !e.isLeave && !dayEvents.any((o) => o.isLeave && o.employeeId == e.employeeId && o.status == 'approved');
