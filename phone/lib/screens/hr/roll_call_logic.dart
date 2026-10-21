import '../../format.dart';

/// Website `ManagerTeamRollCall` statuses, in the order the buttons show.
const rollCallStatuses = <(String, String)>[
  ('present', 'Present'),
  ('absent', 'Absent'),
  ('half_day', 'Half day'),
  ('off', 'Off'),
];

String rollCallStatusLabel(String? status) => switch (status) {
      'present' => 'Present',
      'absent' => 'Absent',
      'half_day' => 'Half day',
      'leave' => 'On leave',
      'off' => 'Off',
      _ => 'Not marked',
    };

/// One employee on the day's roll call (`GET /api/employees/manager/attendance`).
class RollCallRow {
  const RollCallRow({required this.employeeId, required this.name, this.code, this.designation, this.status, this.isLate = false});

  final String employeeId;
  final String name;
  final String? code;
  final String? designation;
  final String? status;
  final bool isLate;

  RollCallRow withStatus(String? next) =>
      RollCallRow(employeeId: employeeId, name: name, code: code, designation: designation, status: next, isLate: next == 'present' && isLate);

  static RollCallRow? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = json['id']?.toString();
    if (id == null || id.isEmpty) return null;
    final name = json['name']?.toString().trim();
    final code = json['employee_code']?.toString();
    return RollCallRow(
      employeeId: id,
      name: (name == null || name.isEmpty) ? (code ?? 'Employee') : name,
      code: code,
      designation: json['designation']?.toString(),
      status: json['attendance_status']?.toString(),
      isLate: json['is_late'] == true,
    );
  }
}

List<RollCallRow> rollCallRows(dynamic team) =>
    team is List ? team.map(RollCallRow.fromJson).whereType<RollCallRow>().toList() : const [];

typedef RollCallSummary = ({int present, int absent, int half, int off, int pending, int total});

/// Same counts as the API's `summary`, worked out locally so marks update it straight away.
RollCallSummary rollCallSummary(List<RollCallRow> rows) {
  var present = 0, absent = 0, half = 0, off = 0, pending = 0;
  for (final r in rows) {
    switch (r.status) {
      case null || '':
        pending++;
      case 'present':
        present++;
      case 'half_day':
        half++;
      case 'off':
        off++;
      default:
        absent++;
    }
  }
  return (present: present, absent: absent, half: half, off: off, pending: pending, total: rows.length);
}

/// "Mark all present" only fills in people not yet marked; it never overwrites a mark.
List<Map<String, String>> markAllPresentMarks(List<RollCallRow> rows) => [
      for (final r in rows)
        if (r.status == null || r.status!.isEmpty) {'employee_id': r.employeeId, 'status': 'present'},
    ];

/// The date line above the roll call: "Today", "Yesterday" or "Fri, 16 Oct".
String rollCallDayLabel(DateTime day, DateTime now) {
  final d = DateTime(day.year, day.month, day.day);
  final today = DateTime(now.year, now.month, now.day);
  final diff = today.difference(d).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Yesterday';
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return '${days[d.weekday - 1]}, ${dMMM(d)}';
}
