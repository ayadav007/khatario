/// Status line on an open invoice or bill, matching the website aging report.
String agingDueLabel({required num outstanding, required int daysOverdue}) {
  if (outstanding < 0) return 'Credit';
  if (daysOverdue < 0) return 'Due in ${-daysOverdue} d';
  if (daysOverdue == 0) return 'Due today';
  return '$daysOverdue d overdue';
}

int agingDays(dynamic value) {
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}
