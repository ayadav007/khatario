import '../../format.dart';
import '../docs/doc_logic.dart';

// Request bodies and reply readers for Party Pricing, Price Levels and Schemes
// (website /pricing/party-item, /pricing/levels, /pricing/schemes). Prices here are what the owner
// types; the phone saves them as typed (two places) and shows the server's history as it is.
// No body carries a business, user or created-by id: the server takes them from the session.

// ---------------------------------------------------------------------------------------------
// A rate: price, discount and dates
// ---------------------------------------------------------------------------------------------

/// What is typed for one rate. Dates are `yyyy-MM-dd` or ''.
class RateDraft {
  const RateDraft({this.price = '', this.discount = '', this.from = '', this.to = ''});

  final String price;
  final String discount;
  final String from;
  final String to;
}

/// A rate as the routes read it. A rate with neither price nor discount means "remove it".
class RateFields {
  const RateFields({this.price, this.discountPercent, this.validFrom, this.validTo});

  final num? price;
  final num? discountPercent;
  final String? validFrom;
  final String? validTo;

  bool get isRemoval => price == null && discountPercent == null;
}

/// Either [rate] or the sentence to show.
class RateCheck {
  const RateCheck.ok(RateFields this.rate) : error = null;
  const RateCheck.fail(String this.error) : rate = null;

  final RateFields? rate;
  final String? error;
}

num _twoPlaces(num n) {
  final r = (n * 100).round() / 100;
  return r == r.roundToDouble() ? r.toInt() : r;
}

/// The website's check: blank is not set; a number must be 0 or more (a discount at most 100) and
/// is rounded to two places; the end date may not be before the start.
RateCheck checkRate(RateDraft d) {
  num? read(String text, {num? max}) {
    final s = text.trim();
    if (s.isEmpty) return null;
    final n = num.tryParse(s);
    if (n == null || !n.isFinite || n < 0 || (max != null && n > max)) return double.nan;
    return _twoPlaces(n);
  }

  final price = read(d.price);
  final discount = read(d.discount, max: 100);
  if ((price != null && price.isNaN) || (discount != null && discount.isNaN)) {
    return const RateCheck.fail('Prices and discounts must be 0 or more, and a discount at most 100.');
  }
  final from = d.from.trim();
  final to = d.to.trim();
  if (from.isNotEmpty && to.isNotEmpty && from.compareTo(to) > 0) {
    return const RateCheck.fail('The end date is before the start date.');
  }
  return RateCheck.ok(RateFields(price: price, discountPercent: discount, validFrom: from.isEmpty ? null : from, validTo: to.isEmpty ? null : to));
}

/// "₹55 · 5% off", or "none".
String rateText(num? price, num? discount) {
  final parts = [
    if (price != null) inr(price, maxFraction: 2),
    if (discount != null) '${_plain(discount)}% off',
  ];
  return parts.isEmpty ? 'none' : parts.join(' · ');
}

String _plain(num n) => n == n.roundToDouble() ? n.toInt().toString() : n.toString();

/// "2026-11-01 to ..." for a dated rate, or '' when it has no dates.
String dateRange(String? from, String? to) {
  final f = from ?? '';
  final t = to ?? '';
  if (f.isEmpty && t.isEmpty) return '';
  return '${f.isEmpty ? '...' : f} to ${t.isEmpty ? '...' : t}';
}

// ---------------------------------------------------------------------------------------------
// Party pricing (`/api/pricing/party-item`, `/party-category`, `/history`)
// ---------------------------------------------------------------------------------------------

/// Body of `POST /api/pricing/party-item`: one row, the way the website sends a saved row. A
/// [RateFields.isRemoval] rate removes the customer's price for that item (or variant).
Map<String, dynamic> partyItemBody(String partyId, String itemId, String? variantId, RateFields r) => {
      'party_id': partyId,
      'rows': [
        {
          'item_id': itemId,
          'variant_id': variantId == null || variantId.isEmpty ? null : variantId,
          'price': r.price,
          'discount_percent': r.discountPercent,
          'valid_from': r.validFrom,
          'valid_to': r.validTo,
        },
      ],
    };

/// Body of `POST /api/pricing/party-category`: a discount on a whole category (no price).
/// A null discount removes it.
Map<String, dynamic> partyCategoryBody(String partyId, String categoryId, RateFields r) => {
      'party_id': partyId,
      'rows': [
        {'category_id': categoryId, 'discount_percent': r.discountPercent, 'valid_from': r.validFrom, 'valid_to': r.validTo},
      ],
    };

/// Body of `POST /api/pricing/levels` that puts a customer on a level (null takes them off).
Map<String, dynamic> assignLevelBody(String? levelId, String customerId) => {
      'assign': {
        'price_level_id': levelId == null || levelId.isEmpty ? null : levelId,
        'customer_ids': [customerId],
      },
    };

/// One saved customer price from `overrides`.
class PartyRate {
  const PartyRate({required this.itemId, this.variantId, this.price, this.discountPercent, this.validFrom, this.validTo});

  final String itemId;
  final String? variantId;
  final num? price;
  final num? discountPercent;
  final String? validFrom;
  final String? validTo;

  String get key => variantId == null ? itemId : '$itemId::$variantId';

  RateDraft get draft => RateDraft(
        price: price == null ? '' : _plain(price!),
        discount: discountPercent == null ? '' : _plain(discountPercent!),
        from: validFrom ?? '',
        to: validTo ?? '',
      );
}

/// The reply of `GET /api/pricing/party-item?party_id=`.
class PartyPrices {
  const PartyPrices({required this.rates, required this.variants, required this.levelId});

  final List<PartyRate> rates;

  /// `{id, item_id, variant_name, selling_price}` for every variant in the business.
  final List<Map<String, dynamic>> variants;
  final String levelId;
}

String? _orNull(dynamic v) {
  final t = docText(v);
  return t.isEmpty ? null : t;
}

PartyPrices partyPrices(dynamic body) {
  return PartyPrices(
    rates: [
      for (final r in docRows(body, 'overrides'))
        if (docText(r['item_id']).isNotEmpty)
          PartyRate(
            itemId: docText(r['item_id']),
            variantId: _orNull(r['variant_id']),
            price: docNum(r['price']),
            discountPercent: docNum(r['discount_percent']),
            validFrom: _orNull(r['valid_from']),
            validTo: _orNull(r['valid_to']),
          ),
    ],
    variants: docRows(body, 'variants'),
    levelId: body is Map ? docText(body['price_level_id']) : '',
  );
}

/// `categories` and `discounts` of `GET /api/pricing/party-category?party_id=`.
class PartyCategories {
  const PartyCategories({required this.categories, required this.discounts});

  final List<Map<String, dynamic>> categories;

  /// category id -> its saved discount.
  final Map<String, PartyRate> discounts;
}

PartyCategories partyCategories(dynamic body) {
  return PartyCategories(
    categories: docRows(body, 'categories'),
    discounts: {
      for (final r in docRows(body, 'discounts'))
        if (docText(r['category_id']).isNotEmpty)
          docText(r['category_id']): PartyRate(
            itemId: docText(r['category_id']),
            discountPercent: docNum(r['discount_percent']),
            validFrom: _orNull(r['valid_from']),
            validTo: _orNull(r['valid_to']),
          ),
    },
  );
}

/// One line of the customer's price history, from `GET /api/pricing/history?party_id=`.
class HistoryEntry {
  const HistoryEntry({required this.id, required this.what, required this.was, required this.now, required this.range, required this.by, required this.when});

  final String id;
  final String what;
  final String was;
  final String now;
  final String range;
  final String by;
  final String when;
}

List<HistoryEntry> historyEntries(dynamic body) {
  return [
    for (final h in docRows(body, 'history'))
      () {
        final category = docText(h['category_name']);
        final item = docText(h['item_name']);
        final variant = docText(h['variant_name']);
        final at = docDate(h['changed_at']);
        return HistoryEntry(
          id: docText(h['id']),
          what: category.isNotEmpty ? '$category (category)' : '${item.isEmpty ? '-' : item}${variant.isEmpty ? '' : ' - $variant'}',
          was: rateText(docNum(h['old_price']), docNum(h['old_discount_percent'])),
          now: rateText(docNum(h['new_price']), docNum(h['new_discount_percent'])),
          range: dateRange(_orNull(h['valid_from']), _orNull(h['valid_to'])),
          by: docText(h['changed_by_name']),
          when: at == null ? '' : ddMMMyyyyHm(at),
        );
      }(),
  ];
}

// ---------------------------------------------------------------------------------------------
// Price levels (`/api/pricing/levels`, `/levels/{id}/rates`)
// ---------------------------------------------------------------------------------------------

class PriceLevel {
  const PriceLevel({required this.id, required this.name, this.description, required this.isActive, required this.customerCount, required this.rateCount});

  final String id;
  final String name;
  final String? description;
  final bool isActive;
  final int customerCount;
  final int rateCount;

  String get counts => '$customerCount customer(s) · $rateCount rate(s)';
}

PriceLevel _level(Map<String, dynamic> r) => PriceLevel(
      id: docText(r['id']),
      name: docText(r['name']),
      description: _orNull(r['description']),
      isActive: r['is_active'] != false,
      customerCount: docNum(r['customer_count'])?.toInt() ?? 0,
      rateCount: docNum(r['rate_count'])?.toInt() ?? 0,
    );

/// `levels` of `GET /api/pricing/levels`.
List<PriceLevel> priceLevels(dynamic body) => [
      for (final r in docRows(body, 'levels'))
        if (docText(r['id']).isNotEmpty) _level(r),
    ];

/// Body of `POST /api/pricing/levels` that creates a level.
Map<String, dynamic> levelCreateBody(String name) => {'name': name.trim()};

/// Body of `POST /api/pricing/levels` that renames, activates or deactivates [level].
Map<String, dynamic> levelUpdateBody(PriceLevel level, {String? name, bool? isActive}) => {
      'id': level.id,
      'name': (name ?? level.name).trim(),
      'description': level.description,
      'is_active': isActive ?? level.isActive,
    };

String levelDeletePath(String id) => '/api/pricing/levels?id=${Uri.encodeQueryComponent(id)}';

String levelRatesPath(String id) => '/api/pricing/levels/$id/rates';

/// One rate on a level.
class LevelRate {
  const LevelRate({required this.itemId, this.variantId, required this.minQty, this.price, this.discountPercent, this.validFrom, this.validTo});

  final String itemId;
  final String? variantId;
  final num minQty;
  final num? price;
  final num? discountPercent;
  final String? validFrom;
  final String? validTo;

  RateDraft get draft => RateDraft(
        price: price == null ? '' : _plain(price!),
        discount: discountPercent == null ? '' : _plain(discountPercent!),
        from: validFrom ?? '',
        to: validTo ?? '',
      );

  RateFields get fields => RateFields(price: price, discountPercent: discountPercent, validFrom: validFrom, validTo: validTo);
}

class LevelRates {
  const LevelRates({required this.name, required this.rates, required this.variants, required this.customers});

  final String name;
  final List<LevelRate> rates;
  final List<Map<String, dynamic>> variants;

  /// `{id, name}` of the customers on the level.
  final List<Map<String, dynamic>> customers;
}

/// The reply of `GET /api/pricing/levels/{id}/rates`.
LevelRates levelRatesReply(dynamic body) {
  final level = body is Map ? body['level'] : null;
  return LevelRates(
    name: level is Map ? docText(level['name']) : '',
    rates: [
      for (final r in docRows(body, 'rates'))
        if (docText(r['item_id']).isNotEmpty)
          LevelRate(
            itemId: docText(r['item_id']),
            variantId: _orNull(r['variant_id']),
            minQty: docNum(r['min_qty']) ?? 0,
            price: docNum(r['price']),
            discountPercent: docNum(r['discount_percent']),
            validFrom: _orNull(r['valid_from']),
            validTo: _orNull(r['valid_to']),
          ),
    ],
    variants: docRows(body, 'variants'),
    customers: docRows(body, 'customers'),
  );
}

/// Why [text] is not a minimum quantity (blank means 0), or null.
String? minQtyError(String text) {
  final t = text.trim();
  if (t.isEmpty) return null;
  final n = num.tryParse(t);
  return n == null || !n.isFinite || n < 0 ? 'Minimum quantity must be 0 or more' : null;
}

/// Body of `POST /api/pricing/levels/{id}/rates`: one row. A rate is identified by item, variant,
/// minimum quantity and start date, so a removal sends the same four with no price or discount.
Map<String, dynamic> levelRateBody(String itemId, String? variantId, String minQty, RateFields r) => {
      'rows': [
        {
          'item_id': itemId,
          'variant_id': variantId == null || variantId.isEmpty ? null : variantId,
          'min_qty': num.tryParse(minQty.trim()) ?? 0,
          'price': r.price,
          'discount_percent': r.discountPercent,
          'valid_from': r.validFrom,
          'valid_to': r.validTo,
        },
      ],
    };

enum LevelBulk { raise, fill }

/// Body of the two bulk changes on a level's rates.
Map<String, dynamic> levelBulkBody(LevelBulk kind, num percent) => {
      kind == LevelBulk.raise ? 'adjust_percent' : 'fill_from_catalog_percent': percent,
    };

/// "-5%" or "5" as a number; null when blank or not a number.
num? parsePercent(String text) {
  final t = text.replaceAll('%', '').trim();
  if (t.isEmpty) return null;
  final n = num.tryParse(t);
  return n != null && n.isFinite ? n : null;
}

// ---------------------------------------------------------------------------------------------
// Schemes (`/api/pricing/schemes`)
// ---------------------------------------------------------------------------------------------

class Scheme {
  const Scheme({
    required this.id,
    required this.itemId,
    this.variantId,
    this.levelId,
    required this.buyQty,
    required this.freeQty,
    this.validFrom,
    this.validTo,
    required this.isActive,
    required this.itemName,
    this.variantName,
    this.levelName,
  });

  final String id;
  final String itemId;
  final String? variantId;
  final String? levelId;
  final num buyQty;
  final num freeQty;
  final String? validFrom;
  final String? validTo;
  final bool isActive;
  final String itemName;
  final String? variantName;
  final String? levelName;

  String get title => variantName == null ? itemName : '$itemName - $variantName';
  String get summary => 'Buy ${_plain(buyQty)}, get ${_plain(freeQty)} free';
  String get audience => levelName == null ? 'Everyone' : '$levelName customers';
  String get dates {
    final r = dateRange(validFrom, validTo);
    return r.isEmpty ? 'Always' : r;
  }
}

/// `schemes` of `GET /api/pricing/schemes`.
List<Scheme> schemeRows(dynamic body) => [
      for (final r in docRows(body, 'schemes'))
        if (docText(r['id']).isNotEmpty)
          Scheme(
            id: docText(r['id']),
            itemId: docText(r['item_id']),
            variantId: _orNull(r['variant_id']),
            levelId: _orNull(r['price_level_id']),
            buyQty: docNum(r['buy_qty']) ?? 0,
            freeQty: docNum(r['free_qty']) ?? 0,
            validFrom: _orNull(r['valid_from']),
            validTo: _orNull(r['valid_to']),
            isActive: r['is_active'] != false,
            itemName: docText(r['item_name']),
            variantName: _orNull(r['variant_name']),
            levelName: _orNull(r['level_name']),
          ),
    ];

/// What is typed on the scheme form. [id] is set when changing a scheme.
class SchemeDraft {
  const SchemeDraft({this.id = '', this.itemId = '', this.variantId = '', this.levelId = '', this.buy = '10', this.free = '1', this.from = '', this.to = ''});

  final String id;
  final String itemId;
  final String variantId;
  final String levelId;
  final String buy;
  final String free;
  final String from;
  final String to;

  factory SchemeDraft.of(Scheme s) => SchemeDraft(
        id: s.id,
        itemId: s.itemId,
        variantId: s.variantId ?? '',
        levelId: s.levelId ?? '',
        buy: _plain(s.buyQty),
        free: _plain(s.freeQty),
        from: s.validFrom ?? '',
        to: s.validTo ?? '',
      );
}

/// The sentence to show when the form cannot be saved yet, or null.
String? checkScheme(SchemeDraft d) {
  if (d.itemId.isEmpty) return 'Pick an item';
  final buy = num.tryParse(d.buy.trim());
  final free = num.tryParse(d.free.trim());
  if (buy == null || free == null || !(buy > 0) || !(free > 0)) return 'Buy and free quantities must be more than 0';
  if (d.from.isNotEmpty && d.to.isNotEmpty && d.from.compareTo(d.to) > 0) return 'The end date is before the start date.';
  return null;
}

/// Body of `POST /api/pricing/schemes`; with `id` the route changes that scheme.
Map<String, dynamic> schemeBody(SchemeDraft d, {bool? isActive}) => {
      if (d.id.isNotEmpty) 'id': d.id,
      'item_id': d.itemId,
      'variant_id': d.variantId.isEmpty ? null : d.variantId,
      'price_level_id': d.levelId.isEmpty ? null : d.levelId,
      'buy_qty': num.parse(d.buy.trim()),
      'free_qty': num.parse(d.free.trim()),
      'valid_from': d.from.isEmpty ? null : d.from,
      'valid_to': d.to.isEmpty ? null : d.to,
      'is_active': ?isActive,
    };

/// Pause or resume: the scheme sent again with `is_active` flipped, as the website does.
Map<String, dynamic> schemeToggleBody(Scheme s) => schemeBody(SchemeDraft.of(s), isActive: !s.isActive);

String schemeDeletePath(String id) => '/api/pricing/schemes?id=${Uri.encodeQueryComponent(id)}';
