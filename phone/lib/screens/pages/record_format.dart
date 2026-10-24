/// Turns API fields into labelled, formatted values for the generic record views.
library;

import '../../format.dart';

final _uuid = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', caseSensitive: false);
final _isoDate = RegExp(r'^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$');

const _secretWords = ['password', 'hash', 'token', 'secret', 'api_key', 'otp', 'raw_', 'payload'];

const _moneyWords = {
  'amount', 'total', 'balance', 'value', 'price', 'cost', 'salary', 'paid', 'due', 'outstanding', 'profit',
  'revenue', 'income', 'expense', 'expenses', 'debit', 'credit', 'tax', 'cgst', 'sgst', 'igst', 'cess', 'tds', 'tcs',
  'payable', 'receivable', 'cash', 'gross', 'net', 'sales', 'purchases', 'wage', 'wages', 'advance', 'commission',
  'liability', 'itc', 'discount', 'round', 'collected', 'pending', 'refund', 'fee', 'charges', 'mrp',
};

const _notMoney = {'events', 'chats', 'messages', 'invoices', 'items', 'bills', 'orders', 'customers', 'suppliers', 'employees', 'entries', 'transactions', 'records', 'leaves', 'members', 'users', 'notes', 'count', 'percent', 'percentage', 'rate', 'qty', 'quantity', 'days', 'number', 'no', 'code', 'type', 'status', 'mode', 'name', 'label', 'is', 'has', 'hours', 'month', 'year', 'date', 'at', 'method', 'category'};

/// Ids, foreign keys, audit columns and secrets are not shown to people.
bool isTechnicalKey(String key, dynamic value) {
  final k = key.toLowerCase();
  if (k == 'id' || k.endsWith('_id') || k.endsWith('_ids') || k == 'business' || k == 'created_by' || k == 'updated_by' || k == 'deleted_at') return true;
  if (_secretWords.any(k.contains)) return true;
  if (value is String && _uuid.hasMatch(value.trim())) return true;
  return false;
}

List<String> _words(String key) => key
    .replaceAllMapped(RegExp(r'([a-z0-9])([A-Z])'), (m) => '${m[1]}_${m[2]}')
    .toLowerCase()
    .split(RegExp(r'[_\s]+'))
    .where((w) => w.isNotEmpty)
    .toList();

/// A bare `total` or `pending` also names a count (4 chats), so a whole number there is a count.
const _bareCountKeys = {'total', 'pending', 'open', 'closed'};

bool isMoneyKey(String key) {
  final words = _words(key);
  if (words.any(_notMoney.contains)) return false;
  return words.any(_moneyWords.contains);
}

bool _isMoney(String key, num value, {bool hasDecimals = false}) {
  if (!isMoneyKey(key)) return false;
  if (_bareCountKeys.contains(key.toLowerCase())) return hasDecimals || value != value.truncate();
  return true;
}

String fieldLabel(String key) {
  final words = key
      .replaceAllMapped(RegExp(r'([a-z])([A-Z])'), (m) => '${m[1]} ${m[2]}')
      .replaceAll('_', ' ')
      .trim()
      .toLowerCase();
  if (words.isEmpty) return key;
  final fixed = words
      .split(' ')
      .map((w) => switch (w) {
            'gst' || 'gstin' || 'hsn' || 'sac' || 'pan' || 'itc' || 'tds' || 'tcs' || 'cgst' || 'sgst' || 'igst' || 'ifsc' || 'upi' || 'fy' || 'rcm' ||
            'uqc' || 'b2b' || 'b2c' || 'b2cs' || 'b2cl' || 'cdnr' || 'cdnur' || 'gstr1' || 'gstr3b' || 'gstr2b' || 'gstr9' || 'hr' || 'ecr' =>
              w.toUpperCase(),
            _ => w,
          })
      .join(' ');
  return fixed[0].toUpperCase() + fixed.substring(1);
}

/// One value as a person reads it. Null means "nothing worth showing".
String? formatField(String key, dynamic value) {
  if (value == null) return null;
  if (value is bool) return value ? 'Yes' : 'No';
  if (value is num) {
    if (_isMoney(key, value)) {
      final text = '$rupeeSign${enIn(value.abs(), maxFraction: 2)}';
      return value < 0 ? '-$text' : text;
    }
    return enIn(value, maxFraction: 2);
  }
  final text = value.toString().trim();
  if (text.isEmpty) return null;
  if (_isoDate.hasMatch(text)) {
    final parsed = DateTime.tryParse(text);
    if (parsed != null) {
      // A date stored as midnight UTC is a plain date, not 05:30 in India.
      final utcMidnight = parsed.isUtc && parsed.hour == 0 && parsed.minute == 0 && parsed.second == 0;
      if (text.length <= 10 || utcMidnight) return ddMMMyyyy(parsed);
      final local = parsed.toLocal();
      return local.hour == 0 && local.minute == 0 ? ddMMMyyyy(local) : ddMMMyyyyHm(local);
    }
  }
  final asNumber = num.tryParse(text);
  if (asNumber != null && _isMoney(key, asNumber, hasDecimals: text.contains('.'))) {
    final money = '$rupeeSign${enIn(asNumber.abs(), maxFraction: 2)}';
    return asNumber < 0 ? '-$money' : money;
  }
  final k = key.toLowerCase();
  if ((k == 'status' || k == 'mode' || k == 'type' || k.endsWith('_status') || k.endsWith('_type') || k.endsWith('_mode') || k.endsWith('_method') || k.endsWith('_category')) && RegExp(r'^[a-z0-9_]+$').hasMatch(text)) {
    const upper = {'upi', 'neft', 'rtgs', 'imps', 'b2b', 'b2c', 'b2cs', 'b2cl', 'gst', 'itc', 'tds'};
    final words = text.split('_').map((w) => upper.contains(w) ? w.toUpperCase() : w).join(' ');
    return words[0].toUpperCase() + words.substring(1);
  }
  return text;
}

/// Label / value rows for the plain fields of [row]; nested objects and lists are left to [nestedSections].
List<(String, String)> plainFields(Map<String, dynamic> row) {
  final out = <(String, String)>[];
  for (final entry in row.entries) {
    if (entry.value is Map || entry.value is List) continue;
    if (isTechnicalKey(entry.key, entry.value)) continue;
    final shown = formatField(entry.key, entry.value);
    if (shown != null) out.add((fieldLabel(entry.key), shown));
  }
  return out;
}

/// A nested object or list inside a record, shown as its own section.
sealed class NestedSection {
  const NestedSection(this.title);
  final String title;
}

class NestedFields extends NestedSection {
  const NestedFields(super.title, this.rows);
  final List<(String, String)> rows;
}

class NestedList extends NestedSection {
  const NestedList(super.title, this.items);
  final List<Map<String, dynamic>> items;
}

class NestedValues extends NestedSection {
  const NestedValues(super.title, this.values);
  final List<String> values;
}

List<NestedSection> nestedSections(Map<String, dynamic> row, [String prefix = '']) {
  final out = <NestedSection>[];
  for (final entry in row.entries) {
    if (isTechnicalKey(entry.key, null) || entry.key == 'pagination' || entry.key == 'meta') continue;
    final title = prefix.isEmpty ? fieldLabel(entry.key) : '$prefix · ${fieldLabel(entry.key)}';
    final value = entry.value;
    if (value is Map) {
      final map = Map<String, dynamic>.from(value);
      final rows = plainFields(map);
      if (rows.isNotEmpty) out.add(NestedFields(title, rows));
      out.addAll(nestedSections(map, title));
    } else if (value is List && value.isNotEmpty) {
      final maps = value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      if (maps.isNotEmpty) {
        out.add(NestedList(title, maps));
      } else {
        final values = value.where((v) => v != null && '$v'.trim().isNotEmpty && !(v is String && _uuid.hasMatch(v))).map((v) => formatField('item', v) ?? '$v').toList();
        if (values.isNotEmpty) out.add(NestedValues(title, values));
      }
    }
  }
  return out;
}

/// Best human title for a list item when none of the known title keys is present.
String? fallbackTitle(Map<String, dynamic> row) {
  for (final entry in row.entries) {
    final value = entry.value;
    if (value is! String || isTechnicalKey(entry.key, value)) continue;
    final text = value.trim();
    if (text.isEmpty || _isoDate.hasMatch(text) || num.tryParse(text) != null) continue;
    return text;
  }
  return null;
}

/// The first money field (its key and value), for a list row's right-hand side.
const _preferredAmountKeys = ['grand_total', 'total_amount', 'net_amount', 'amount', 'total', 'line_total', 'total_value', 'stock_value', 'balance'];

(String, num)? primaryAmount(Map<String, dynamic> row) {
  for (final key in _preferredAmountKeys) {
    final value = row[key];
    final n = value is num ? value : num.tryParse(value?.toString() ?? '');
    if (n != null) return (key, n);
  }
  for (final entry in row.entries) {
    if (!isMoneyKey(entry.key)) continue;
    final value = entry.value;
    final n = value is num ? value : num.tryParse(value?.toString() ?? '');
    if (n != null) return (entry.key, n);
  }
  return null;
}
