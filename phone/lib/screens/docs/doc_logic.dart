// Readers for document-list replies. They never throw on odd values.

/// A finite number, or a numeric string. Anything else (NaN, infinity, text) is null.
num? docNum(dynamic v) {
  final n = v is num ? v : (v is String ? num.tryParse(v.trim()) : null);
  return n != null && n.isFinite ? n : null;
}

/// Scalars as text. Lists, maps and null give ''.
String docText(dynamic v) {
  if (v is String) return v;
  if (v is num || v is bool) return v.toString();
  return '';
}

DateTime? docDate(dynamic v) {
  if (v is DateTime) return v.toLocal();
  if (v is! String || v.isEmpty) return null;
  return DateTime.tryParse(v)?.toLocal();
}

/// The rows of a reply: a bare list, or the list under [listKey].
List<Map<String, dynamic>> docRows(dynamic body, String listKey) {
  final dynamic raw = body is List ? body : (body is Map ? body[listKey] : null);
  if (raw is! List) return const [];
  return [
    for (final r in raw)
      if (r is Map) Map<String, dynamic>.from(r),
  ];
}

/// `pagination.page` and `pagination.totalPages` (or `total_pages`); null when absent.
({int page, int totalPages})? docPaging(dynamic body) {
  if (body is! Map) return null;
  final p = body['pagination'];
  if (p is! Map) return null;
  final page = docNum(p['page']);
  final total = docNum(p['totalPages'] ?? p['total_pages']);
  if (page == null || total == null) return null;
  return (page: page.toInt(), totalPages: total.toInt());
}

/// Rows whose [keys] fields contain [query], ignoring case. A blank query keeps everything.
List<Map<String, dynamic>> filterDocs(List<Map<String, dynamic>> rows, String query, List<String> keys) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty || keys.isEmpty) return rows;
  return [
    for (final r in rows)
      if (keys.any((k) => docText(r[k]).toLowerCase().contains(q))) r,
  ];
}

/// First parseable date among the usual date fields, or null.
DateTime? docRowDate(Map<String, dynamic> row) {
  for (final k in const ['invoice_date', 'order_date', 'bill_date', 'expense_date', 'date', 'entry_date', 'payment_date', 'challan_date', 'work_order_date', 'created_at']) {
    final d = docDate(row[k]);
    if (d != null) return d;
  }
  return null;
}

/// Walks nested maps by a dotted key (`summary.total_sales`). Null when any step is missing or not a map.
dynamic readPath(dynamic body, String dottedKey) {
  dynamic cur = body;
  for (final part in dottedKey.split('.')) {
    if (cur is! Map) return null;
    cur = cur[part];
  }
  return cur;
}
