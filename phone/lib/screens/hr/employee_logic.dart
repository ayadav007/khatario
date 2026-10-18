/// Pure helpers for the employee list and detail screens.
library;

List<Map<String, dynamic>> jsonRows(dynamic value) =>
    value is List ? value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];

String employeeName(Map<String, dynamic> row) {
  for (final key in const ['user_name', 'name', 'full_name']) {
    final value = row[key]?.toString().trim() ?? '';
    if (value.isNotEmpty) return value;
  }
  final code = row['employee_code']?.toString().trim() ?? '';
  return code.isEmpty ? 'Employee' : code;
}

/// The website treats an employee as active only when both the employee and the login are active.
bool employeeActive(Map<String, dynamic> row) => row['is_active'] != false && row['user_is_active'] != false;

String employmentLabel(dynamic value) => switch (value?.toString()) {
      'full_time' => 'Full time',
      'part_time' => 'Part time',
      'contract' => 'Contract',
      null || '' => '',
      final other => other.replaceAll('_', ' '),
    };

/// Role line under the name: designation and department, else the phone.
String employeeSubtitle(Map<String, dynamic> row) {
  final parts = [row['designation'], row['department']]
      .map((v) => v?.toString().trim() ?? '')
      .where((v) => v.isNotEmpty)
      .toList();
  if (parts.isNotEmpty) return parts.join(' · ');
  return (row['user_phone'] ?? row['phone'])?.toString().trim() ?? '';
}

List<Map<String, dynamic>> filterEmployees(List<Map<String, dynamic>> rows, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return rows;
  return rows.where((row) {
    final haystack = [
      employeeName(row),
      row['employee_code'],
      row['designation'],
      row['department'],
      row['user_phone'] ?? row['phone'],
    ].map((v) => v?.toString().toLowerCase() ?? '').join(' ');
    return haystack.contains(q);
  }).toList();
}

/// Bank and Aadhaar numbers show only their last four digits.
String? maskTail(dynamic value) {
  final raw = value?.toString().replaceAll(' ', '') ?? '';
  if (raw.isEmpty) return null;
  if (raw.length <= 4) return raw;
  return '•••• ${raw.substring(raw.length - 4)}';
}
