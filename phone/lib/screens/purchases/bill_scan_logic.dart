/// Bill-scan rules shared with the website's purchase form (`app/(app)/purchases/new/page.tsx`).
/// Each function names the TypeScript it mirrors so the two stay in step.
library;

int _levenshtein(String a, String b) {
  if (a == b) return 0;
  if (a.isEmpty) return b.length;
  if (b.isEmpty) return a.length;
  var prev = List<int>.generate(b.length + 1, (i) => i);
  for (var i = 1; i <= a.length; i++) {
    final next = List<int>.filled(b.length + 1, 0)..[0] = i;
    for (var j = 1; j <= b.length; j++) {
      final cost = a.codeUnitAt(i - 1) == b.codeUnitAt(j - 1) ? 0 : 1;
      next[j] = [prev[j] + 1, next[j - 1] + 1, prev[j - 1] + cost].reduce((x, y) => x < y ? x : y);
    }
    prev = next;
  }
  return prev[b.length];
}

/// `levenshteinSimilarityPercent` in `lib/string-similarity.ts`.
int levenshteinSimilarityPercent(String a, String b) {
  final s1 = a.toLowerCase().trim();
  final s2 = b.toLowerCase().trim();
  if (s1.isEmpty && s2.isEmpty) return 100;
  if (s1.isEmpty || s2.isEmpty) return 0;
  if (s1 == s2) return 100;
  final maxLen = s1.length > s2.length ? s1.length : s2.length;
  return (100 * (1 - _levenshtein(s1, s2) / maxLen)).round();
}

String _itemLabel(String s) => s.toLowerCase().trim().replaceAll(RegExp(r'\s+'), ' ');

/// `calculateItemNameSimilarity` in `lib/matching/item-name-similarity.ts`.
int itemNameSimilarity(String a, String b) {
  final s1 = _itemLabel(a);
  final s2 = _itemLabel(b);
  if (s1.isEmpty || s2.isEmpty) return s1 == s2 ? 100 : 0;
  if (s1 == s2) return 100;
  if (s1.contains(s2) || s2.contains(s1)) {
    final lev = levenshteinSimilarityPercent(s1, s2);
    return lev > 85 ? lev : 85;
  }
  final words1 = s1.split(' ');
  final words2 = s2.split(' ');
  var matching = 0;
  for (final w1 in words1) {
    if (w1.isEmpty) continue;
    if (words2.any((w2) => w2.contains(w1) || w1.contains(w2))) matching++;
  }
  final longest = words1.length > words2.length ? words1.length : words2.length;
  final words = (matching / longest * 100).round();
  final lev = levenshteinSimilarityPercent(s1, s2);
  return words > lev ? words : lev;
}

const _supplierPrefixes = ['es', 'm s', 'm/s', 'shri', 'sri', 'mr', 'ms', 'mrs', 'dr'];
const _supplierSuffixes = [
  'pvt ltd', 'pvt. ltd.', 'private limited', 'pvt limited', 'ltd', 'ltd.', 'limited',
  'llp', 'l.l.p.', 'llc', 'l.l.c.', 'inc', 'inc.', 'incorporated', 'co', 'co.', 'company', '& co', '& co.',
];

/// `normalizeSupplierName` in `lib/matching/supplier-matcher.ts`.
String normalizeSupplierName(String name) {
  var n = name.toLowerCase().trim();
  for (final prefix in _supplierPrefixes) {
    n = n.replaceFirst(RegExp('^${RegExp.escape(prefix)}\\s+'), '');
  }
  for (final suffix in _supplierSuffixes) {
    n = n.replaceFirst(RegExp('\\s+${RegExp.escape(suffix)}\$'), '');
  }
  n = n.replaceAll(RegExp(r'[^\w\s]'), '');
  return n.replaceAll(RegExp(r'\s+'), ' ').trim();
}

/// `calculateSimilarity` in `lib/matching/supplier-matcher.ts`.
int supplierSimilarity(String a, String b) {
  final s1 = a.toLowerCase().trim();
  final s2 = b.toLowerCase().trim();
  final maxLen = s1.length > s2.length ? s1.length : s2.length;
  if (maxLen == 0) return 100;
  return ((maxLen - _levenshtein(s1, s2)) / maxLen * 100).round();
}

/// `findAutoLinkLocalSupplierMatch` in `lib/matching/find-local-supplier-match.ts`:
/// exact GSTIN, exact normalized name, or one clear fuzzy match of 88 and up.
Map<String, dynamic>? autoLinkSupplier(List<Map<String, dynamic>> suppliers, {String? name, String? gstin}) {
  final extGstin = (gstin ?? '').trim().toUpperCase();
  final extName = (name ?? '').trim();
  if (extName.isEmpty && extGstin.length != 15) return null;
  final ranked = <({Map<String, dynamic> supplier, bool exact, int score})>[];
  for (final supplier in suppliers) {
    final supGstin = (supplier['gstin']?.toString() ?? '').trim().toUpperCase();
    if (extGstin.length == 15 && supGstin.length == 15 && extGstin == supGstin) {
      ranked.add((supplier: supplier, exact: true, score: 100));
      continue;
    }
    if (extName.isEmpty) continue;
    final supName = supplier['name']?.toString() ?? '';
    final a = normalizeSupplierName(extName);
    final b = normalizeSupplierName(supName);
    final equal = a.isNotEmpty && a == b;
    final direct = supplierSimilarity(extName, supName);
    final normalized = supplierSimilarity(a, b);
    final score = equal ? 100 : (direct > normalized ? direct : normalized);
    if (score < 82) continue;
    ranked.add((supplier: supplier, exact: equal, score: score));
  }
  if (ranked.isEmpty) return null;
  ranked.sort((x, y) => y.score.compareTo(x.score));
  final best = ranked.first;
  if (best.exact) return best.supplier;
  if (best.score < 88) return null;
  final second = ranked.length > 1 ? ranked[1] : null;
  if (second == null || second.score < 75 || best.score - second.score >= 8) return best.supplier;
  return null;
}

String? _hsnDigits(String? code) {
  final clean = (code ?? '').trim().replaceAll(RegExp(r'[^0-9]'), '');
  return clean.length == 4 || clean.length == 6 || clean.length == 8 ? clean : null;
}

/// `isHSNSACMatch` in `lib/matching/hsn-sac-matcher.ts`: equal, or one code is the other's chapter.
bool hsnMatches(String? a, String? b) {
  final x = _hsnDigits(a);
  final y = _hsnDigits(b);
  if (x == null || y == null) return false;
  return x.length < y.length ? y.startsWith(x) : x.startsWith(y);
}

/// The first result of `matchItem` in `lib/matching/item-matcher.ts`, which the website links
/// a scanned line to: HSN match, then exact name, then the best name of 60 and up.
Map<String, dynamic>? matchScannedItem(List<Map<String, dynamic>> items, {required String name, String? hsn}) {
  final label = name.trim();
  if (label.isEmpty && (hsn ?? '').trim().isEmpty) return null;
  if (_hsnDigits(hsn) != null) {
    for (final item in items) {
      if (hsnMatches(hsn, item['hsn_sac']?.toString())) return item;
    }
  }
  final lower = label.toLowerCase();
  for (final item in items) {
    if ((item['name']?.toString() ?? '').toLowerCase().trim() == lower) return item;
  }
  Map<String, dynamic>? best;
  var bestScore = 59;
  for (final item in items) {
    final score = itemNameSimilarity(label, item['name']?.toString() ?? '');
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/// "Match automatically" on the website: the closest catalogue name at 85 and up.
Map<String, dynamic>? closeCatalogueMatch(List<Map<String, dynamic>> items, String name) {
  Map<String, dynamic>? best;
  var bestScore = 0;
  for (final item in items) {
    if (item['is_active'] == false) continue;
    final score = itemNameSimilarity(name, item['name']?.toString() ?? '');
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return bestScore >= 85 ? best : null;
}

double _round(num value, int places) {
  final factor = [1, 10, 100, 1000, 10000, 100000, 1000000][places];
  return (value * factor).round() / factor;
}

double? _num(dynamic value) {
  if (value is num) return value.isFinite ? value.toDouble() : null;
  return double.tryParse(value?.toString() ?? '');
}

/// One scanned line as the website's `handleAcceptExtractedData` puts it on the form.
typedef ScannedLine = ({
  String name,
  String hsn,
  String unit,
  double quantity,
  double unitPrice,
  double discountPercent,
  double discountAmount,
  bool discountOnTaxInclusive,
  double taxRate,
  String? taxMode,
  double? inclusiveTotal,
});

ScannedLine scannedLine(Map entry) {
  var qty = _round(_num(entry['quantity'] ?? entry['qty']) ?? 0, 4);
  if (!(qty > 0)) qty = 1;
  final discAmt = _round(_num(entry['discount_amount']) ?? 0, 2);
  final discPct = _round(_num(entry['discount_percent']) ?? 0, 2);
  final amount = _num(entry['amount']);
  final mode = entry['tax_mode']?.toString();
  final unit = entry['unit']?.toString().trim() ?? '';
  // `resolvePurchaseFormLineFromExtractItem`: new extracts carry provenance and keep the
  // mapper's exclusive unit price; the bill's line total is kept only when it checked out.
  final provenance = (entry['mapping_rule']?.toString() ?? '').isNotEmpty || _num(entry['printed_rate']) != null;
  final keepTotal = amount != null && amount != 0 && (!provenance || entry['validation_status'] == 'ok');
  return (
    name: (entry['item_name'] ?? entry['name'] ?? entry['description'] ?? '').toString().trim(),
    hsn: entry['hsn_sac']?.toString().trim() ?? '',
    unit: unit.isEmpty ? 'PCS' : unit,
    quantity: qty,
    unitPrice: _round(_num(entry['unit_price'] ?? entry['rate']) ?? 0, 6),
    discountPercent: discAmt > 0 ? 0 : discPct,
    discountAmount: discAmt,
    discountOnTaxInclusive: entry['discount_on_tax_inclusive'] == true,
    taxRate: _round(_num(entry['tax_rate']) ?? 0, 2),
    taxMode: mode == 'inclusive' || mode == 'exclusive' ? mode : null,
    inclusiveTotal: keepTotal ? _round(amount, 2) : null,
  );
}

/// Place of supply the way the website fills it from a scan: the bill's state code, the
/// state named on the bill, then the supplier GSTIN's state.
String? scannedPlaceOfSupply(Map invoice, {String? gstin, required String Function(String) stateCodeOf}) {
  final code = invoice['place_of_supply_state_code']?.toString().trim() ?? '';
  if (code.length >= 2) return code.substring(0, 2);
  final named = stateCodeOf(invoice['place_of_supply']?.toString() ?? '');
  if (named.isNotEmpty) return named;
  final g = (gstin ?? '').trim();
  return RegExp(r'^\d{2}').hasMatch(g) ? g.substring(0, 2) : null;
}

String _norm(dynamic v) {
  if (v == null) return '';
  if (v is num && v.isFinite) {
    final r = (v * 10000).round() / 10000;
    return r == r.roundToDouble() ? r.toInt().toString() : r.toString();
  }
  return v.toString().trim();
}

int _diff(Map? a, Map? b, List<String> keys) => keys.where((k) => _norm(a?[k]) != _norm(b?[k])).length;

/// `summarizeInvoiceCorrectionDelta` in `lib/services/invoice-extract/invoiceExtractionCorrectionSummary.ts`.
Map<String, dynamic> correctionSummary(Map before, Map after) {
  const supKeys = ['name', 'gstin', 'address', 'state_code', 'phone', 'email'];
  const invKeys = ['invoice_number', 'invoice_date', 'due_date', 'place_of_supply', 'reverse_charge'];
  const itemKeys = ['item_name', 'quantity', 'unit_price', 'amount', 'tax_rate', 'hsn_sac', 'discount_percent', 'discount_amount', 'discount_on_tax_inclusive'];
  const totalKeys = ['subtotal', 'tax_amount', 'grand_total', 'cgst_total', 'sgst_total', 'igst_total', 'round_off'];
  final supplier = _diff(before['supplier'] as Map?, after['supplier'] as Map?, supKeys);
  final invoice = _diff(before['invoice'] as Map?, after['invoice'] as Map?, invKeys);
  final totals = _diff(before['totals'] as Map?, after['totals'] as Map?, totalKeys) > 0;
  final bItems = before['items'] is List ? before['items'] as List : const [];
  final aItems = after['items'] is List ? after['items'] as List : const [];
  final fieldChanges = <String, int>{};
  var rows = 0;
  final n = bItems.length > aItems.length ? bItems.length : aItems.length;
  for (var i = 0; i < n; i++) {
    final b = i < bItems.length && bItems[i] is Map ? bItems[i] as Map : const {};
    final a = i < aItems.length && aItems[i] is Map ? aItems[i] as Map : const {};
    var changed = false;
    for (final k in itemKeys) {
      if (_norm(b[k]) != _norm(a[k])) {
        fieldChanges[k] = (fieldChanges[k] ?? 0) + 1;
        changed = true;
      }
    }
    if (changed) rows++;
  }
  final edited = supplier + invoice + rows + (totals ? 1 : 0) > 0;
  return {
    'accept_kind': edited ? 'edited' : 'clean',
    'supplier_field_changes': supplier,
    'invoice_field_changes': invoice,
    'items_rows_changed': rows,
    'item_field_changes': fieldChanges,
    'totals_changed': totals,
  };
}
