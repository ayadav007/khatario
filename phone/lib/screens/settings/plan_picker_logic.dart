import '../../format.dart';

/// Percent saved by paying yearly instead of twelve monthly bills. Null when yearly is not cheaper.
int? yearlySavePercent(num monthly, num yearly) {
  if (monthly <= 0 || yearly <= 0) return null;
  final full = monthly * 12;
  if (yearly >= full) return null;
  return ((1 - yearly / full) * 100).round();
}

/// Highest yearly discount among the plans, for the toggle badge.
int? bestYearlySave(Iterable<Map<String, dynamic>> plans) {
  int? best;
  for (final plan in plans) {
    final save = yearlySavePercent(toNum(plan['price_monthly']), toNum(plan['price_yearly']));
    if (save != null && (best == null || save > best)) best = save;
  }
  return best;
}

/// Price on the right of a plan card. Yearly shows the per-month equivalent.
String planCardPrice(Map<String, dynamic> plan, {required bool yearly}) {
  final monthly = toNum(plan['price_monthly']);
  final year = toNum(plan['price_yearly']);
  if (yearly && year > 0) return '${inr(year / 12)}/mo';
  if (monthly <= 0 && year <= 0) return 'Free';
  return '${inr(monthly)}/mo';
}

/// Struck monthly price when the yearly cycle is cheaper. Empty otherwise.
String planStruckMonthly(Map<String, dynamic> plan, {required bool yearly}) {
  if (!yearly) return '';
  final monthly = toNum(plan['price_monthly']);
  if (yearlySavePercent(monthly, toNum(plan['price_yearly'])) == null) return '';
  return '${inr(monthly)}/mo';
}

String planBilledYearly(Map<String, dynamic> plan, {required bool yearly}) {
  if (!yearly) return '';
  final year = toNum(plan['price_yearly']);
  if (year <= 0) return '';
  return '${inr(year)} billed yearly';
}

bool planIsPopular(Map<String, dynamic> plan) {
  final name = '${plan['name'] ?? ''} ${plan['display_name'] ?? ''}'.toLowerCase();
  return name.contains('growth');
}

/// Short lines under "Included in …": limits first, then enabled features.
List<String> planIncludedLines(Map<String, dynamic> plan) {
  final lines = <String>[];
  final raw = plan['features'];
  final features = raw is Map ? Map<String, dynamic>.from(raw) : const <String, dynamic>{};
  final limits = features['limits'] is Map ? Map<String, dynamic>.from(features['limits'] as Map) : const <String, dynamic>{};
  const limitLabels = {
    'max_invoices_per_month': 'invoices a month',
    'max_customers': 'customers',
    'max_items': 'items',
    'max_users': 'console seats',
    'max_whatsapp_per_day': 'WhatsApp messages a day',
    'max_employees': 'employees',
    'max_ai_replies_per_month': 'AI replies a month',
  };
  for (final entry in limitLabels.entries) {
    if (!limits.containsKey(entry.key)) continue;
    final value = toNum(limits[entry.key]);
    if (value == 0) continue;
    lines.add(value < 0 ? 'Unlimited ${entry.value}' : '${value.toInt()} ${entry.value}');
  }
  final flags = features['features'] is Map ? Map<String, dynamic>.from(features['features'] as Map) : const <String, dynamic>{};
  for (final entry in flags.entries) {
    if (entry.value != true) continue;
    lines.add(_words(entry.key));
    if (lines.length >= 8) break;
  }
  final description = plan['description']?.toString().trim() ?? '';
  if (lines.isEmpty && description.isNotEmpty) lines.add(description);
  return lines;
}

String _words(String key) {
  final text = key.replaceAll('_', ' ').trim();
  if (text.isEmpty) return text;
  return text[0].toUpperCase() + text.substring(1);
}
