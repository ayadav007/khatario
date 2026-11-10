import 'dart:math';

import '../../api.dart';
import '../../format.dart';
import '../docs/doc_logic.dart';

/// Inventory adjustments and repacks (`app/(app)/inventory-adjustments/**`).
/// `GET /api/inventory-adjustments` replies `{ adjustments, pagination }` (rows are `ia.*` plus `item_name`,
/// `item_code`, `item_unit`, `variant_name`, `location_name`, `created_by_name`); `GET .../[id]` replies
/// `{ adjustment }`. `GET .../repacks` replies `{ repacks }` (not paged; `limit` up to 200), `GET .../repacks/[id]`
/// `{ repack }`. The phone shows the server's figures; it never works out stock, cost or value.

/// What the quantity form offers (`reasonCodeOptions` on the website, without the value-only reasons).
const kAdjustReasons = <(String, String)>[
  ('STOCK_TAKE', 'Stock take'),
  ('DAMAGE', 'Damage'),
  ('THEFT', 'Theft'),
  ('EXPIRED', 'Expired'),
  ('FREE_SAMPLE', 'Free sample'),
];

const _reasonLabels = <String, String>{
  'STOCK_TAKE': 'Stock take',
  'DAMAGE': 'Damage',
  'THEFT': 'Theft',
  'EXPIRED': 'Expired',
  'FREE_SAMPLE': 'Free sample',
  'COST_CORRECTION': 'Cost correction',
  'LANDED_COST': 'Landed cost',
  'REVALUATION': 'Revaluation',
  'WRITE_DOWN': 'Write down',
  'REPACK_OUT': 'Repacked out',
  'REPACK_IN': 'Repacked in',
};

/// The website's reason words; a code it has no word for reads as plain text ("OWN_CONSUMPTION" is "Own consumption").
String adjustmentReasonLabel(String code) {
  final known = _reasonLabels[code];
  if (known != null) return known;
  final words = code.toLowerCase().replaceAll('_', ' ').trim();
  return words.isEmpty ? '' : words[0].toUpperCase() + words.substring(1);
}

/// The website's Type filter (`adjustment_type`).
const kAdjustmentFilters = <(String, String)>[
  ('', 'All'),
  ('QUANTITY', 'Quantity'),
  ('VALUE', 'Value'),
];

/// Repack wastage reasons (`REASONS` on the repack page).
const kWastageReasons = <(String, String)>[
  ('SPILLAGE', 'Spillage'),
  ('MOISTURE', 'Drying / moisture'),
  ('PACKAGING', 'Packet weight'),
  ('OTHER', 'Other'),
];

String wastageReasonLabel(String code) {
  for (final (c, label) in kWastageReasons) {
    if (c == code) return label;
  }
  return code;
}

String adjustmentTitle(Map<String, dynamic> row) {
  final n = docText(row['adjustment_number']);
  return n.isEmpty ? 'Adjustment' : n;
}

/// "Rice · Damage · -2 KG": the item, the reason and the change the server recorded.
String adjustmentSubtitle(Map<String, dynamic> row) {
  final variant = docText(row['variant_name']);
  final item = docText(row['item_name']);
  final name = variant.isEmpty ? item : '$item ($variant)';
  final reason = adjustmentReasonLabel(docText(row['reason_code']));
  final value = docText(row['adjustment_type']) == 'VALUE';
  final change = docNum(value ? row['value_change'] : row['quantity_change']);
  final unit = docText(row['item_unit']);
  final changeText = change == null || change == 0
      ? ''
      : value
          ? '${change > 0 ? '+' : '-'}${inr(change.abs(), maxFraction: 2)}'
          : '${change > 0 ? '+' : '-'}${jsNumberString(_r3(change.abs()))}${unit.isEmpty ? '' : ' $unit'}';
  final date = docDate(row['adjustment_date']);
  return [name, reason, changeText, if (date != null) ddMMMyyyy(date)].where((p) => p.isNotEmpty).join(' · ');
}

/// A repack leg is read and undone as a whole repack (the website sends it to the repack page).
String? adjustmentRepackId(Map<String, dynamic> row) {
  final id = docText(row['repack_id']);
  return id.isEmpty ? null : id;
}

num _r3(num n) => (n * 1000).round() / 1000;

/// Whole numbers go as integers, as the single-item sheet does.
num _clean(num n) => n == n.truncateToDouble() ? n.toInt() : n;

/// An item that tracks serial numbers cannot be adjusted from the phone: the server does not take the serials.
bool adjustItemBlocked(Map<String, dynamic> item) => item['track_serial'] == true || item['track_serial'] == 1 || item['track_serial'] == 'true';

const adjustItemBlockedText = 'Adjust this item on the website';

bool adjustItemTracksBatch(Map<String, dynamic> item) => item['track_batch'] == true || item['track_batch'] == 1 || item['track_batch'] == 'true';

/// A random retry key for one adjustment line. A retried save sends the same key, so the server returns the
/// adjustment it already made instead of making a second one.
String newAdjustKey() {
  final r = Random.secure();
  return 'phone-adjust-${List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join()}';
}

/// `POST /api/inventory-adjustments` body for one quantity line. The session names the business and the user.
/// [direction] is INCREASE or DECREASE. A warehouse replaces the branch. [batch] goes only when stock is added
/// (the route reads it for added stock only).
Map<String, dynamic> adjustmentBody({
  required String itemId,
  String variantId = '',
  required String direction,
  required num quantity,
  required String reason,
  String reasonNotes = '',
  String notes = '',
  required DateTime date,
  String locationId = '',
  String branchId = '',
  Map<String, dynamic>? batch,
}) {
  return {
    'adjustment_type': 'QUANTITY',
    'adjustment_date': ymd(date),
    'item_id': itemId,
    if (variantId.isNotEmpty) 'variant_id': variantId,
    'direction': direction,
    'quantity': _clean(quantity),
    'reason_code': reason,
    if (reasonNotes.trim().isNotEmpty) 'reason_notes': reasonNotes.trim(),
    if (notes.trim().isNotEmpty) 'notes': notes.trim(),
    if (locationId.isNotEmpty) 'location_id': locationId else if (branchId.isNotEmpty) 'branch_id': branchId,
    if (direction == 'INCREASE' && batch != null && batch.isNotEmpty) 'batch': batch,
  };
}

/// `GET /api/items/search` rows (`id`, `name`, `unit`, `current_stock`, `has_variants`, `variants`), kept whole so a
/// pick can read the stock and variants the server sent.
Future<List<Map<String, dynamic>>> searchStockItems(KhatarioApi api, String q) async {
  final text = q.trim();
  final query = text.isEmpty ? {'browse': '1', 'limit': '30'} : {'q': text, 'limit': '30'};
  final body = await api.getData(Uri(path: '/api/items/search', queryParameters: query).toString());
  return [
    for (final r in docRows(body, 'items'))
      if (docText(r['id']).isNotEmpty) r,
  ];
}

String stockItemSub(Map<String, dynamic> r) {
  final stock = docNum(r['current_stock']);
  final unit = docText(r['unit']);
  return [if (stock != null) 'In stock ${jsNumberString(_r3(stock))}${unit.isEmpty ? '' : ' $unit'}', if (unit.isNotEmpty && stock == null) unit].join(' · ');
}

// ---------------------------------------------------------------------------------------------
// Repacks
// ---------------------------------------------------------------------------------------------

/// What went in minus what the packs hold (`wastage` on the repack page). Quantities only; the server works out
/// the cost and the stock.
num repackWastage(num out, num made, num content) => _r3(out - made * content);

/// `POST /api/inventory-adjustments/repacks` body. [wastage] is [repackWastage]; the reason goes only when something
/// is lost, and the note only for "Other". A warehouse replaces the branch.
Map<String, dynamic> repackBody({
  required String sourceId,
  required String packedId,
  required num sourceQty,
  required num packedQty,
  required num content,
  required num wastage,
  required String reason,
  String wastageNotes = '',
  String notes = '',
  required DateTime date,
  String locationId = '',
  String branchId = '',
}) {
  final lost = wastage > 0;
  final note = wastageNotes.trim();
  final extra = notes.trim();
  return {
    'source_item_id': sourceId,
    'packed_item_id': packedId,
    'source_qty': _clean(sourceQty),
    'packed_qty': _clean(packedQty),
    'content_per_unit': _clean(content),
    'wastage_reason': lost ? reason : null,
    'wastage_notes': lost && reason == 'OTHER' && note.isNotEmpty ? note : null,
    'notes': extra.isEmpty ? null : extra,
    'repack_date': ymd(date),
    if (locationId.isNotEmpty) 'location_id': locationId else if (branchId.isNotEmpty) 'branch_id': branchId,
  };
}

String repackTitle(Map<String, dynamic> row) {
  final n = docText(row['repack_number']);
  return n.isEmpty ? 'Repack' : n;
}

String repackStatus(Map<String, dynamic> row) {
  final s = docText(row['status']).trim().toLowerCase();
  return s == 'cancelled' ? 'cancelled' : 'posted';
}

bool repackCanCancel(Map<String, dynamic> row) => repackStatus(row) != 'cancelled';

String _qty(dynamic v) => jsNumberString(_r3(docNum(v) ?? 0));

/// "Rice → Rice 1 kg pack · 10 KG to 9 packs".
String repackSubtitle(Map<String, dynamic> row) {
  final unit = docText(row['source_unit']);
  final date = docDate(row['repack_date']);
  return [
    '${docText(row['source_name'])} → ${docText(row['packed_name'])}',
    '${_qty(row['source_qty'])}${unit.isEmpty ? '' : ' $unit'} to ${_qty(row['packed_qty'])}',
    if (date != null) ddMMMyyyy(date),
  ].where((p) => p.isNotEmpty).join(' · ');
}

/// The cancel question: names the repack and what undoing it does.
String repackCancelText(Map<String, dynamic> row) {
  final unit = docText(row['source_unit']);
  return '${repackTitle(row)}: put back ${_qty(row['source_qty'])}${unit.isEmpty ? '' : ' $unit'} of ${docText(row['source_name'])} '
      'and remove ${_qty(row['packed_qty'])} ${docText(row['packed_name'])}?';
}
