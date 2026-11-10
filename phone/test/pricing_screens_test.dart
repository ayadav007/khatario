import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/stock/pricing_logic.dart';

const _p1 = 'c0000000-0000-4000-8000-000000000001';
const _i1 = 'a0000000-0000-4000-8000-000000000001';
const _v1 = 'b0000000-0000-4000-8000-000000000001';
const _l1 = 'd0000000-0000-4000-8000-000000000001';
const _s1 = 'e0000000-0000-4000-8000-000000000001';
const _cat = 'f0000000-0000-4000-8000-000000000001';

void main() {
  group('rate check', () {
    test('blank fields mean not set, numbers round to two places, dates stay as typed', () {
      final ok = checkRate(const RateDraft(price: ' 55.456 ', discount: '5', from: '2026-11-01', to: '2026-11-30'));
      expect(ok.error, isNull);
      expect(ok.rate!.price, 55.46);
      expect(ok.rate!.discountPercent, 5);
      expect(ok.rate!.validFrom, '2026-11-01');
      expect(checkRate(const RateDraft()).rate!.isRemoval, isTrue);
      expect(checkRate(const RateDraft(discount: '0')).rate!.isRemoval, isFalse);
    });

    test('refuses a negative, a discount over 100, a bad number and an end before the start', () {
      expect(checkRate(const RateDraft(price: '-1')).error, isNotNull);
      expect(checkRate(const RateDraft(discount: '100.5')).error, isNotNull);
      expect(checkRate(const RateDraft(price: 'abc')).error, isNotNull);
      expect(checkRate(const RateDraft(price: '1', from: '2026-12-01', to: '2026-11-01')).error, contains('end date'));
    });
  });

  group('party pricing bodies', () {
    test('a price saves as one row with the website keys and no business or user id', () {
      final rate = checkRate(const RateDraft(price: '55', discount: '5', from: '2026-11-01')).rate!;
      final body = partyItemBody(_p1, _i1, _v1, rate);
      expect(body, {
        'party_id': _p1,
        'rows': [
          {'item_id': _i1, 'variant_id': _v1, 'price': 55, 'discount_percent': 5, 'valid_from': '2026-11-01', 'valid_to': null},
        ],
      });
      expect(body.toString(), isNot(contains('business_id')));
      expect(body.toString(), isNot(contains('user_id')));
      expect(body.toString(), isNot(contains('created_by')));
    });

    test('removing a price sends nulls for both, a whole item sends variant_id null', () {
      final body = partyItemBody(_p1, _i1, null, checkRate(const RateDraft()).rate!);
      final row = (body['rows'] as List).single as Map;
      expect(row['variant_id'], isNull);
      expect(row['price'], isNull);
      expect(row['discount_percent'], isNull);
    });

    test('a category discount has no price key', () {
      final body = partyCategoryBody(_p1, _cat, checkRate(const RateDraft(discount: '10', to: '2026-12-31')).rate!);
      expect(body, {
        'party_id': _p1,
        'rows': [
          {'category_id': _cat, 'discount_percent': 10, 'valid_from': null, 'valid_to': '2026-12-31'},
        ],
      });
    });

    test('putting a customer on a level, and taking them off', () {
      expect(assignLevelBody(_l1, _p1), {'assign': {'price_level_id': _l1, 'customer_ids': [_p1]}});
      expect(assignLevelBody(null, _p1), {'assign': {'price_level_id': null, 'customer_ids': [_p1]}});
    });

    test('the customer reply is read into prices, variants and the level', () {
      final r = partyPrices({
        'overrides': [
          {'item_id': _i1, 'variant_id': null, 'price': 50, 'discount_percent': null, 'valid_from': null, 'valid_to': '2026-12-31'},
          {'item_id': _i1, 'variant_id': _v1, 'price': '45.5', 'discount_percent': 2, 'valid_from': null, 'valid_to': null},
        ],
        'variants': [
          {'id': _v1, 'item_id': _i1, 'variant_name': 'Large', 'selling_price': 60},
        ],
        'price_level_id': _l1,
      });
      expect(r.rates.length, 2);
      expect(r.rates[1].price, 45.5);
      expect(r.rates[0].validTo, '2026-12-31');
      expect(r.variants.single['variant_name'], 'Large');
      expect(r.levelId, _l1);
      expect(partyPrices(null).rates, isEmpty);
    });

    test('history lines read the server rows', () {
      final h = historyEntries({
        'history': [
          {
            'id': '1', 'scope': 'party_item', 'changed_at': '2026-11-10T08:00:00Z', 'item_name': 'Rice', 'variant_name': 'Large',
            'old_price': 50, 'new_price': 55, 'old_discount_percent': null, 'new_discount_percent': 5, 'valid_from': '2026-11-01', 'valid_to': null,
            'changed_by_name': 'Asha', 'category_name': null,
          },
          {'id': '2', 'category_name': 'Grains', 'old_price': null, 'new_price': null, 'old_discount_percent': null, 'new_discount_percent': 10},
        ],
      });
      expect(h[0].what, 'Rice - Large');
      expect(h[0].was, '₹50');
      expect(h[0].now, '₹55 · 5% off');
      expect(h[0].range, '2026-11-01 to ...');
      expect(h[0].by, 'Asha');
      expect(h[1].what, 'Grains (category)');
      expect(h[1].was, 'none');
    });
  });

  group('price level bodies', () {
    test('create, rename, activate and delete use the website shapes', () {
      expect(levelCreateBody('  Wholesale '), {'name': 'Wholesale'});
      final level = priceLevels({
        'levels': [
          {'id': _l1, 'name': 'Wholesale', 'description': 'Bulk', 'is_active': true, 'customer_count': 3, 'rate_count': 7},
        ],
      }).single;
      expect(level.customerCount, 3);
      expect(levelUpdateBody(level, name: 'Dealer'), {'id': _l1, 'name': 'Dealer', 'description': 'Bulk', 'is_active': true});
      expect(levelUpdateBody(level, isActive: false)['is_active'], false);
      expect(levelDeletePath(_l1), '/api/pricing/levels?id=$_l1');
    });

    test('a rate row carries the slab, and a removal sends nulls', () {
      final rate = checkRate(const RateDraft(price: '80', from: '2026-11-01')).rate!;
      expect(levelRateBody(_i1, null, '10', rate), {
        'rows': [
          {'item_id': _i1, 'variant_id': null, 'min_qty': 10, 'price': 80, 'discount_percent': null, 'valid_from': '2026-11-01', 'valid_to': null},
        ],
      });
      final gone = levelRateBody(_i1, _v1, '0', checkRate(const RateDraft(from: '2026-11-01')).rate!);
      expect((gone['rows'] as List).single['price'], isNull);
      expect((gone['rows'] as List).single['valid_from'], '2026-11-01');
      expect(((levelRateBody(_i1, null, '', rate)['rows'] as List).single as Map)['min_qty'], 0);
    });

    test('min quantity must be 0 or more', () {
      expect(minQtyError('0'), isNull);
      expect(minQtyError(''), isNull);
      expect(minQtyError('-1'), isNotNull);
      expect(minQtyError('x'), isNotNull);
    });

    test('the rates reply is read', () {
      final r = levelRatesReply({
        'level': {'id': _l1, 'name': 'Wholesale'},
        'rates': [
          {'item_id': _i1, 'variant_id': null, 'min_qty': 10, 'price': 80, 'discount_percent': null, 'valid_from': null, 'valid_to': null},
        ],
        'variants': [
          {'id': _v1, 'item_id': _i1, 'variant_name': 'Large'},
        ],
        'customers': [
          {'id': _p1, 'name': 'Asha'},
        ],
      });
      expect(r.rates.single.minQty, 10);
      expect(r.rates.single.price, 80);
      expect(r.customers.single['name'], 'Asha');
      expect(r.variants.length, 1);
    });

    test('bulk changes send the percentage under the website key', () {
      expect(levelBulkBody(LevelBulk.raise, -5), {'adjust_percent': -5});
      expect(levelBulkBody(LevelBulk.fill, 10), {'fill_from_catalog_percent': 10});
      expect(parsePercent(' -5% '), -5);
      expect(parsePercent('abc'), isNull);
      expect(parsePercent(''), isNull);
    });
  });

  group('scheme bodies', () {
    test('a scheme saves with the website keys', () {
      const draft = SchemeDraft(itemId: _i1, variantId: _v1, levelId: _l1, buy: '10', free: '1', from: '2026-11-01', to: '');
      expect(checkScheme(draft), isNull);
      expect(schemeBody(draft), {
        'item_id': _i1,
        'variant_id': _v1,
        'price_level_id': _l1,
        'buy_qty': 10,
        'free_qty': 1,
        'valid_from': '2026-11-01',
        'valid_to': null,
      });
      expect(schemeBody(const SchemeDraft(id: _s1, itemId: _i1, buy: '5', free: '1'))['id'], _s1);
      expect(schemeBody(const SchemeDraft(itemId: _i1, buy: '5', free: '1')).containsKey('id'), isFalse);
    });

    test('an item and positive quantities are needed', () {
      expect(checkScheme(const SchemeDraft(buy: '10', free: '1')), 'Pick an item');
      expect(checkScheme(const SchemeDraft(itemId: _i1, buy: '0', free: '1')), isNotNull);
      expect(checkScheme(const SchemeDraft(itemId: _i1, buy: '10', free: '')), isNotNull);
      expect(checkScheme(const SchemeDraft(itemId: _i1, buy: '10', free: '1', from: '2026-12-01', to: '2026-11-01')), isNotNull);
    });

    test('pause and resume resend the scheme flipped, delete goes by id', () {
      final s = schemeRows({
        'schemes': [
          {'id': _s1, 'item_id': _i1, 'variant_id': null, 'price_level_id': null, 'buy_qty': 10, 'free_qty': 1, 'valid_from': null, 'valid_to': null, 'is_active': true, 'item_name': 'Rice', 'variant_name': null, 'level_name': null},
        ],
      }).single;
      expect(s.summary, 'Buy 10, get 1 free');
      expect(s.audience, 'Everyone');
      expect(s.dates, 'Always');
      final b = schemeToggleBody(s);
      expect(b['id'], _s1);
      expect(b['is_active'], false);
      expect(b['buy_qty'], 10);
      expect(schemeDeletePath(_s1), '/api/pricing/schemes?id=$_s1');
    });
  });
}
