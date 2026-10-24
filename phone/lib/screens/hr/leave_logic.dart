import '../../format.dart';

/// One row of `GET /api/employees/leave-requests`.
class LeaveRow {
  const LeaveRow({
    required this.id,
    required this.employeeName,
    required this.leaveName,
    required this.start,
    required this.end,
    required this.days,
    required this.status,
    this.reason,
    this.rejectionReason,
  });

  final String id;
  final String employeeName;
  final String leaveName;
  final DateTime? start;
  final DateTime? end;
  final num days;
  final String status;
  final String? reason;
  final String? rejectionReason;

  bool get isPending => status == 'pending';

  static LeaveRow? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = json['id']?.toString();
    if (id == null || id.isEmpty) return null;
    String? text(String key) {
      final v = json[key]?.toString().trim();
      return (v == null || v.isEmpty) ? null : v;
    }

    return LeaveRow(
      id: id,
      employeeName: text('employee_name') ?? text('employee_code') ?? 'Employee',
      leaveName: text('leave_name') ?? text('leave_code') ?? 'Leave',
      start: _date(json['start_date']),
      end: _date(json['end_date']),
      days: toNum(json['total_days']),
      status: text('status') ?? 'pending',
      reason: text('reason'),
      rejectionReason: text('rejection_reason'),
    );
  }
}

DateTime? _date(dynamic v) {
  final s = v?.toString();
  if (s == null || s.length < 10) return null;
  final d = DateTime.tryParse(s.substring(0, 10));
  return d == null ? null : dateOnly(d);
}

List<LeaveRow> leaveRows(dynamic list) =>
    list is List ? list.map(LeaveRow.fromJson).whereType<LeaveRow>().toList() : const [];

/// "20 Oct" for one day, "20–22 Oct" in one month, "30 Oct – 2 Nov" across months.
String leaveDates(LeaveRow row) {
  final s = row.start, e = row.end;
  if (s == null) return '';
  if (e == null || e == s) return dMMM(s);
  if (s.month == e.month && s.year == e.year) return '${s.day}–${dMMM(e)}';
  return '${dMMM(s)} – ${dMMM(e)}';
}

String leaveDays(num days) => days == 1 ? '1 day' : '${jsNumberString(days)} days';

String leaveStatusLabel(String status) => switch (status) {
      'pending' => 'Pending',
      'approved' => 'Approved',
      'rejected' => 'Rejected',
      'cancelled' => 'Cancelled',
      'on_hold' || 'hold' => 'On hold',
      _ => status.isEmpty ? 'Pending' : status[0].toUpperCase() + status.substring(1).replaceAll('_', ' '),
    };
