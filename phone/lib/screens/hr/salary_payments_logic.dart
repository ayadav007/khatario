import '../../format.dart';

/// One row of `GET /api/employees/salary/payments`.
class SalaryPaymentRow {
  const SalaryPaymentRow({
    required this.id,
    required this.employeeName,
    required this.month,
    required this.net,
    required this.gross,
    required this.deductions,
    required this.status,
    this.code,
    this.paidOn,
  });

  final String id;
  final String employeeName;
  final String? code;
  final String month;
  final num net;
  final num gross;
  final num deductions;
  final String status;
  final DateTime? paidOn;

  static SalaryPaymentRow? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = json['id']?.toString();
    if (id == null || id.isEmpty) return null;
    final paid = json['payment_date']?.toString();
    return SalaryPaymentRow(
      id: id,
      employeeName: json['employee_name']?.toString() ?? json['employee_code']?.toString() ?? 'Employee',
      code: json['employee_code']?.toString(),
      month: json['salary_month']?.toString() ?? '',
      net: toNum(json['net_salary']),
      gross: toNum(json['gross_salary']),
      deductions: toNum(json['total_deductions']),
      status: json['status']?.toString() ?? '',
      paidOn: paid == null || paid.length < 10 ? null : DateTime.tryParse(paid.substring(0, 10)),
    );
  }
}

List<SalaryPaymentRow> salaryPaymentRows(dynamic list) =>
    list is List ? list.map(SalaryPaymentRow.fromJson).whereType<SalaryPaymentRow>().toList() : const [];

/// `salary_month` is "2026-10" (or older free text such as "October 2026"); shows "October 2026".
String salaryMonthLabel(String month) {
  final m = RegExp(r'^(\d{4})-(\d{1,2})$').firstMatch(month.trim());
  if (m == null) return month.trim().isEmpty ? 'No month' : month.trim();
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  final i = int.parse(m.group(2)!);
  return i >= 1 && i <= 12 ? '${names[i - 1]} ${m.group(1)}' : month;
}

typedef SalaryMonth = ({String month, List<SalaryPaymentRow> rows, num total});

/// Payments grouped by salary month, newest first (the API already sorts them that way).
List<SalaryMonth> salaryMonths(List<SalaryPaymentRow> rows) {
  final order = <String>[];
  final byMonth = <String, List<SalaryPaymentRow>>{};
  for (final r in rows) {
    byMonth.putIfAbsent(r.month, () {
      order.add(r.month);
      return [];
    }).add(r);
  }
  return [
    for (final m in order) (month: m, rows: byMonth[m]!, total: byMonth[m]!.fold<num>(0, (sum, r) => sum + r.net)),
  ];
}

String salaryStatusLabel(String status) => switch (status) {
      'paid' => 'Paid',
      'pending' => 'Pending',
      'processed' => 'Processed',
      'cancelled' => 'Cancelled',
      _ => status.isEmpty ? 'Recorded' : status[0].toUpperCase() + status.substring(1).replaceAll('_', ' '),
    };
