import '../../api.dart';
import '../docs/doc_logic.dart';

/// Why a request failed, for the error state: the server's words, and whether the plan (not a
/// glitch) stopped it, in which case there is nothing to retry.
({String message, bool notInPlan}) failureOf(Object e) {
  if (e is ApiException) return (message: e.message, notInPlan: e.code == 'FEATURE_NOT_IN_PLAN');
  return (message: 'Could not reach the server.', notInPlan: false);
}

// Request bodies and reply readers for the Price List and Units & Duplicates screens.
// Nothing here touches widgets, and nothing computes a price: the server's answer is shown as it is.

// ---------------------------------------------------------------------------------------------
// Price list (website /pricing/price-list)
// ---------------------------------------------------------------------------------------------

/// One row the price list asks the server to price: an item, or one variant of it.
class PriceWant {
  const PriceWant({required this.itemId, required this.itemName, required this.unit, this.variantId, this.variantName});

  final String itemId;
  final String itemName;
  final String unit;
  final String? variantId;
  final String? variantName;
}

String _dateOnly(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// `yyyy-MM-dd`, the date format the pricing route reads.
String priceDate(DateTime d) => _dateOnly(d);

/// Body of `POST /api/pricing/resolve`, as the website sends it: the customer (or null for the
/// item prices), the date, and one line per item with quantity 1. [variantIds] lines up with
/// [itemIds]; a null entry means the whole item. At most 300 lines per request (the route's limit).
Map<String, dynamic> resolveRequestBody(String? customerId, List<String> itemIds, {String? date, List<String?>? variantIds}) {
  final id = customerId?.trim();
  return {
    'customer_id': id == null || id.isEmpty ? null : id,
    'date': ?date,
    'lines': [
      for (final (i, itemId) in itemIds.indexed)
        {
          'item_id': itemId,
          'variant_id': variantIds != null && i < variantIds.length ? variantIds[i] : null,
          'qty': 1,
        },
    ],
  };
}

/// Items from `GET /api/items`, expanded to one row per variant when the customer's variant list
/// (from `GET /api/pricing/party-item?party_id=`, key `variants`) has any for that item.
List<PriceWant> priceWants(List<Map<String, dynamic>> items, List<Map<String, dynamic>> variants) {
  final out = <PriceWant>[];
  for (final item in items) {
    final id = docText(item['id']);
    if (id.isEmpty) continue;
    final name = docText(item['name']);
    final unit = docText(item['unit']);
    final mine = [for (final v in variants) if (docText(v['item_id']) == id && docText(v['id']).isNotEmpty) v];
    if (mine.isEmpty) {
      out.add(PriceWant(itemId: id, itemName: name, unit: unit));
    } else {
      for (final v in mine) {
        out.add(PriceWant(itemId: id, itemName: name, unit: unit, variantId: docText(v['id']), variantName: docText(v['variant_name'])));
      }
    }
  }
  return out;
}

/// Splits [all] into slices of at most [size] (the route takes 300 lines).
List<List<T>> chunked<T>(List<T> all, [int size = 300]) {
  return [for (var i = 0; i < all.length; i += size) all.sublist(i, i + size > all.length ? all.length : i + size)];
}

/// One priced row, read from a `lines[]` entry of the resolve reply.
class PriceLine {
  const PriceLine({
    required this.want,
    this.price,
    this.priceSource = 'catalog',
    this.discountPercent,
    this.gstIncluded = false,
    this.taxRate,
    this.mrp,
    this.buyQty,
    this.freeQty,
  });

  final PriceWant want;
  final num? price;

  /// `party`, `level` or `catalog`.
  final String priceSource;
  final num? discountPercent;
  final bool gstIncluded;
  final num? taxRate;
  final num? mrp;
  final num? buyQty;
  final num? freeQty;

  bool get hasScheme => buyQty != null && freeQty != null;

  /// Not the plain item price: the customer's own price, a level rate, a discount or a scheme.
  bool get isSpecial => priceSource != 'catalog' || discountPercent != null || hasScheme;
}

/// Pairs each wanted row with the reply line at the same position. A short reply leaves the
/// remaining rows unpriced (price null) instead of dropping them.
List<PriceLine> priceLines(List<PriceWant> wants, dynamic body) {
  final replies = docRows(body, 'lines');
  return [
    for (final (i, w) in wants.indexed) _priceLine(w, i < replies.length ? replies[i] : const {}),
  ];
}

PriceLine _priceLine(PriceWant want, Map<String, dynamic> r) {
  final scheme = r['scheme'];
  return PriceLine(
    want: want,
    price: docNum(r['price']),
    priceSource: docText(r['priceSource']).isEmpty ? 'catalog' : docText(r['priceSource']),
    discountPercent: docNum(r['discountPercent']),
    gstIncluded: r['gstIncluded'] == true,
    taxRate: docNum(r['taxRate']),
    mrp: docNum(r['mrp']),
    buyQty: scheme is Map ? docNum(scheme['buyQty']) : null,
    freeQty: scheme is Map ? docNum(scheme['freeQty']) : null,
  );
}

/// "Only special prices" on the website.
List<PriceLine> onlySpecial(List<PriceLine> lines) => [for (final l in lines) if (l.isSpecial) l];

/// Where the rate came from, in words.
String priceSourceLabel(String source) => switch (source) {
      'party' => 'Customer price',
      'level' => 'Price level',
      _ => 'Item price',
    };

/// A number without trailing zeros: 5 -> "5", 2.5 -> "2.5".
String plainNum(num n) => n == n.roundToDouble() ? n.toInt().toString() : n.toString();

// ---------------------------------------------------------------------------------------------
// Merge duplicates (website /items/cleanup, "Merge a duplicate")
// ---------------------------------------------------------------------------------------------

/// Bodies for `POST /api/items/merge`, one per duplicate in [group]: the duplicate is
/// `source_item_id` (it is removed) and [keepId] is `target_item_id` (it stays). The kept item is
/// never sent as a source, and an id listed twice is merged once. The route folds one item into one
/// target per call.
List<Map<String, String>> mergeBody(String keepId, List<String> group) {
  final seen = <String>{};
  return [
    for (final id in group)
      if (id.isNotEmpty && id != keepId && seen.add(id)) {'source_item_id': id, 'target_item_id': keepId},
  ];
}

/// Query of `GET /api/items/merge`, the preview of one merge.
String mergePreviewPath(String sourceId, String keepId) =>
    '/api/items/merge?source_item_id=${Uri.encodeQueryComponent(sourceId)}&target_item_id=${Uri.encodeQueryComponent(keepId)}';

/// What a merge would do, from the preview reply (`problems`, `references`).
class MergePreview {
  const MergePreview({required this.problems, required this.moves});

  /// Why the merge is blocked; empty when it can go ahead.
  final List<String> problems;

  /// "invoice items: 3", one line per table the duplicate appears in.
  final List<String> moves;

  bool get blocked => problems.isNotEmpty;
}

MergePreview mergePreview(dynamic body) {
  final problems = <String>[];
  final raw = body is Map ? body['problems'] : null;
  if (raw is List) {
    for (final p in raw) {
      final t = docText(p).trim();
      if (t.isNotEmpty) problems.add(t);
    }
  }
  final moves = <String>[];
  final refs = body is Map ? body['references'] : null;
  if (refs is Map) {
    for (final e in refs.entries) {
      // Keys read "invoice_items.item_id": the table is what the owner recognises.
      final table = e.key.toString().split('.').first.replaceAll('_', ' ');
      moves.add('$table: ${docText(e.value)}');
    }
  }
  return MergePreview(problems: problems, moves: moves);
}

/// The sentence on the confirm sheet.
String mergeConfirmText(String keepName, int count) {
  final what = count == 1 ? '1 item' : '$count items';
  return 'Every bill, invoice and stock entry of the $what moves to "$keepName", and the $what is removed. This cannot be undone.';
}

// ---------------------------------------------------------------------------------------------
// Alternate units (website /items/cleanup, "Alternate units")
// ---------------------------------------------------------------------------------------------

/// One alternate unit as typed: BOX = 12 PCS, with an optional price and box barcode.
class UnitDraft {
  const UnitDraft({this.unit = '', this.factor = '', this.price = '', this.barcode = ''});

  final String unit;
  final String factor;
  final String price;
  final String barcode;
}

/// Alternate units from `GET /api/items/{id}/units` (key `units`).
List<UnitDraft> unitDrafts(dynamic body) {
  return [
    for (final u in docRows(body, 'units'))
      UnitDraft(
        unit: docText(u['unit']),
        factor: docNum(u['factor_to_base']) == null ? '' : plainNum(docNum(u['factor_to_base'])!),
        price: docNum(u['selling_price']) == null ? '' : plainNum(docNum(u['selling_price'])!),
        barcode: docText(u['barcode']),
      ),
  ];
}

/// Body of `PUT /api/items/{id}/units`: blank rows dropped, the factor as a number, a blank price
/// as null (the server then charges the item price times the box size).
Map<String, dynamic> unitsBody(List<UnitDraft> drafts) {
  return {
    'units': [
      for (final d in drafts)
        if (d.unit.trim().isNotEmpty)
          {
            'unit': d.unit.trim(),
            'factor_to_base': num.tryParse(d.factor.trim()) ?? 0,
            'barcode': d.barcode.trim(),
            'selling_price': d.price.trim().isEmpty ? null : num.tryParse(d.price.trim()),
          },
    ],
  };
}

/// The item's own unit from `GET /api/items/units?ids={id}` (`items.{id}.unit`).
String baseUnitOf(dynamic body, String itemId) => docText(readPath(body, 'items.$itemId.unit'));
