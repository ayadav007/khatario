import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/stock/party_pricing_screen.dart';
import 'package:khatario_phone/screens/stock/price_levels_screen.dart';
import 'package:khatario_phone/screens/stock/price_list_screen.dart';
import 'package:khatario_phone/screens/stock/schemes_screen.dart';
import 'package:khatario_phone/session.dart';

/// A session whose reply is chosen per request: (status, body). Records what was sent.
(AppSession, List<RequestOptions>) _routed(Future<(int, Object?)> Function(RequestOptions o) reply) {
  final sent = <RequestOptions>[];
  final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
  dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
    sent.add(o);
    final (status, data) = await reply(o);
    h.resolve(Response(requestOptions: o, statusCode: status, data: data));
  }));
  return (AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b'}}), sent);
}

const _p1 = 'c0000000-0000-4000-8000-000000000001';
const _i1 = 'a0000000-0000-4000-8000-000000000001';
const _i2 = 'a0000000-0000-4000-8000-000000000002';
const _v2 = 'b0000000-0000-4000-8000-000000000002';
const _l1 = 'd0000000-0000-4000-8000-000000000001';
const _s1 = 'e0000000-0000-4000-8000-000000000001';
const _cat = 'f0000000-0000-4000-8000-000000000001';

Future<void> _pump(WidgetTester t, Widget screen, {double width = 400}) async {
  t.view.physicalSize = Size(width, 1400);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  await t.pumpWidget(MaterialApp(home: screen));
  await t.pumpAndSettle();
}

Finder _field(String key) => find.descendant(of: find.byKey(Key(key)), matching: find.byType(TextField));

Future<void> _type(WidgetTester t, String key, String text) async {
  await t.enterText(_field(key), text);
  await t.pump();
}

Future<void> _tap(WidgetTester t, Finder f) async {
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pumpAndSettle();
}

/// The website routes, answered the way the real ones answer. [fail] replaces the reply of one
/// request, keyed "METHOD /path".
Future<(int, Object?)> Function(RequestOptions) _server({Map<String, (int, Object?)> fail = const {}}) {
  return (o) async {
    final key = '${o.method} ${o.uri.path}';
    final f = fail[key];
    if (f != null) return f;
    switch (key) {
      case 'GET /api/pricing/party-item':
        return (200, {
          'overrides': [
            {'item_id': _i1, 'variant_id': null, 'price': 50, 'discount_percent': null, 'valid_from': null, 'valid_to': null},
          ],
          'variants': [
            {'id': _v2, 'item_id': _i2, 'variant_name': 'Large', 'selling_price': 210},
          ],
          'price_level_id': null,
        });
      case 'GET /api/pricing/party-category':
        return (200, {
          'categories': [
            {'id': _cat, 'name': 'Grains'},
          ],
          'discounts': [],
        });
      case 'GET /api/pricing/history':
        return (200, {
          'history': [
            {
              'id': 'h1', 'scope': 'party_item', 'changed_at': '2026-11-10T08:00:00Z', 'item_name': 'Rice', 'variant_name': null,
              'old_price': 45, 'new_price': 50, 'old_discount_percent': null, 'new_discount_percent': null, 'changed_by_name': 'Asha Owner',
              'category_name': null, 'valid_from': null, 'valid_to': null,
            },
          ],
        });
      case 'GET /api/items':
        return (200, {
          'items': [
            {'id': _i1, 'name': 'Rice', 'unit': 'KG', 'selling_price': 60},
            {'id': _i2, 'name': 'Oil', 'unit': 'L', 'selling_price': 200},
          ],
        });
      case 'GET /api/items/search':
        return (200, {
          'items': [
            {'id': _i2, 'name': 'Oil', 'unit': 'L', 'selling_price': 200},
          ],
        });
      case 'GET /api/customers':
        return (200, {
          'customers': [
            {'id': _p1, 'name': 'Asha Traders', 'phone': '9999'},
          ],
        });
      case 'POST /api/pricing/resolve':
        return (200, {'lines': []});
      case 'GET /api/pricing/levels':
        return (200, {
          'levels': [
            {'id': _l1, 'name': 'Wholesale', 'description': null, 'is_active': true, 'customer_count': 3, 'rate_count': 7},
          ],
        });
      case 'GET /api/pricing/levels/$_l1/rates':
        return (200, {
          'level': {'id': _l1, 'name': 'Wholesale'},
          'rates': [
            {'item_id': _i1, 'variant_id': null, 'min_qty': 10, 'price': 55, 'discount_percent': null, 'valid_from': null, 'valid_to': null},
          ],
          'variants': [
            {'id': _v2, 'item_id': _i2, 'variant_name': 'Large', 'selling_price': 210},
          ],
          'customers': [
            {'id': _p1, 'name': 'Asha Traders'},
          ],
        });
      case 'GET /api/pricing/schemes':
        return (200, {
          'schemes': [
            {
              'id': _s1, 'item_id': _i1, 'variant_id': null, 'price_level_id': null, 'buy_qty': 10, 'free_qty': 1, 'valid_from': null,
              'valid_to': null, 'is_active': true, 'item_name': 'Rice', 'variant_name': null, 'level_name': null,
            },
          ],
          'variants': [
            {'id': _v2, 'item_id': _i2, 'variant_name': 'Large'},
          ],
        });
      case 'POST /api/pricing/levels':
        return (201, {'level': {'id': _l1, 'name': 'Dealer'}});
      case 'POST /api/pricing/schemes':
        return (201, {'ok': true, 'id': _s1});
    }
    return (200, {'ok': true});
  };
}

List<RequestOptions> _writes(List<RequestOptions> sent) => [for (final o in sent) if (o.method != 'GET') o];

void _noSessionIds(List<RequestOptions> sent) {
  for (final o in sent) {
    final text = '${o.uri} ${o.data}';
    expect(text, isNot(contains('business_id')));
    expect(text, isNot(contains('user_id')));
    expect(text, isNot(contains('created_by')));
  }
}

int _gets(List<RequestOptions> sent, String path) => sent.where((o) => o.method == 'GET' && o.uri.path == path).length;

void main() {
  group('party pricing screen', () {
    Future<(AppSession, List<RequestOptions>)> open(WidgetTester t, {Map<String, (int, Object?)> fail = const {}, bool customer = true}) async {
      final (s, sent) = _routed(_server(fail: fail));
      await _pump(t, PartyPricingScreen(session: s, customerId: customer ? _p1 : null, customerName: customer ? 'Asha Traders' : null));
      return (s, sent);
    }

    testWidgets('loads the customer prices with the item names and the item price', (t) async {
      final (_, sent) = await open(t);
      expect(find.text('Rice'), findsOneWidget);
      expect(find.text('₹50'), findsOneWidget);
      expect(find.text('Item price ₹60'), findsOneWidget);
      final get = sent.firstWhere((o) => o.uri.path == '/api/pricing/party-item');
      expect(get.uri.queryParameters['party_id'], _p1);
      expect(_gets(sent, '/api/pricing/party-category'), 1);
      expect(_gets(sent, '/api/pricing/history'), 1);
      _noSessionIds(sent);
    });

    testWidgets('without a customer it asks for one, then loads the one picked', (t) async {
      final (_, sent) = await open(t, customer: false);
      expect(find.text('Choose a customer'), findsOneWidget);
      expect(_gets(sent, '/api/pricing/party-item'), 0);
      await _tap(t, find.text('Select'));
      await _tap(t, find.text('Asha Traders'));
      expect(find.text('Rice'), findsOneWidget);
      expect(sent.firstWhere((o) => o.uri.path == '/api/pricing/party-item').uri.queryParameters['party_id'], _p1);
    });

    testWidgets('adding a price sends the website row once and reloads', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Add a price'));
      await _tap(t, find.text('Select'));
      await _tap(t, find.text('Oil'));
      expect(find.text('All variants'), findsOneWidget);
      await _type(t, 'price', '55');
      await _type(t, 'discount', '5');
      final before = _gets(sent, '/api/pricing/party-item');
      await _tap(t, find.text('Save'));
      final posts = _writes(sent);
      expect(posts.length, 1);
      expect(posts.single.uri.path, '/api/pricing/party-item');
      expect(posts.single.data, {
        'party_id': _p1,
        'rows': [
          {'item_id': _i2, 'variant_id': null, 'price': 55, 'discount_percent': 5, 'valid_from': null, 'valid_to': null},
        ],
      });
      expect(_gets(sent, '/api/pricing/party-item'), before + 1);
      expect(find.text('Save'), findsNothing);
      _noSessionIds(sent);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('changing a price opens it filled and sends the new price once', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Rice'));
      expect(t.widget<TextField>(_field('price')).controller!.text, '50');
      await _type(t, 'price', '48.5');
      await _tap(t, find.text('Save'));
      final posts = _writes(sent);
      expect(posts.length, 1);
      final row = (posts.single.data['rows'] as List).single as Map;
      expect(row['item_id'], _i1);
      expect(row['price'], 48.5);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('removing a price asks first by name, then sends nulls once', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Rice'));
      await _tap(t, find.text('Remove price'));
      expect(find.textContaining('Rice'), findsWidgets);
      expect(_writes(sent), isEmpty);
      await _tap(t, find.text('Remove'));
      final posts = _writes(sent);
      expect(posts.length, 1);
      final row = (posts.single.data['rows'] as List).single as Map;
      expect(row['item_id'], _i1);
      expect(row['price'], isNull);
      expect(row['discount_percent'], isNull);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a refused save shows the server message and keeps the form filled', (t) async {
      final (_, sent) = await open(t, fail: {'POST /api/pricing/party-item': (404, {'error': 'Item not found: x'})});
      await _tap(t, find.text('Rice'));
      await _type(t, 'price', '61');
      await _tap(t, find.text('Save'));
      expect(find.text('Item not found: x'), findsOneWidget);
      expect(t.widget<TextField>(_field('price')).controller!.text, '61');
      expect(_writes(sent).length, 1);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a price must have a price or a discount, and a discount at most 100', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Rice'));
      await _type(t, 'price', '');
      await _tap(t, find.text('Save'));
      expect(find.text('Enter a price, a discount %, or both'), findsOneWidget);
      await _type(t, 'discount', '120');
      await _tap(t, find.text('Save'));
      expect(find.textContaining('at most 100'), findsOneWidget);
      expect(_writes(sent), isEmpty);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('the history tab shows the rows the server sent', (t) async {
      await open(t);
      await _tap(t, find.text('History'));
      expect(find.text('Rice'), findsOneWidget);
      expect(find.textContaining('45'), findsWidgets);
      expect(find.textContaining('Asha Owner'), findsOneWidget);
    });

    testWidgets('a category discount saves with the website body', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Category discounts'));
      await _tap(t, find.text('Grains'));
      await _type(t, 'discount', '10');
      await _tap(t, find.text('Save'));
      final posts = _writes(sent);
      expect(posts.single.uri.path, '/api/pricing/party-category');
      expect(posts.single.data, {
        'party_id': _p1,
        'rows': [
          {'category_id': _cat, 'discount_percent': 10, 'valid_from': null, 'valid_to': null},
        ],
      });
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('choosing the customer\'s price level assigns it', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('None (item prices)'));
      await _tap(t, find.text('Wholesale'));
      final posts = _writes(sent);
      expect(posts.length, 1);
      expect(posts.single.uri.path, '/api/pricing/levels');
      expect(posts.single.data, {'assign': {'price_level_id': _l1, 'customer_ids': [_p1]}});
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a refused level change goes back to the old level', (t) async {
      await open(t, fail: {'POST /api/pricing/levels': (400, {'error': 'Price level not found'})});
      await _tap(t, find.text('None (item prices)'));
      await _tap(t, find.text('Wholesale'));
      expect(find.text('Price level not found'), findsOneWidget);
      expect(find.text('None (item prices)'), findsOneWidget);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a failed load offers Try again', (t) async {
      await open(t, fail: {'GET /api/pricing/party-item': (400, {'error': 'Boom'})});
      expect(find.text('Boom'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('a plan error shows the lock without Try again', (t) async {
      await open(t, fail: {'GET /api/pricing/party-item': (403, {'error': 'No', 'code': 'FEATURE_NOT_IN_PLAN'})});
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('a customer with no prices shows the empty state', (t) async {
      final (s, _) = _routed((o) async {
        if (o.uri.path == '/api/pricing/party-item') return (200, {'overrides': [], 'variants': []});
        return _server()(o);
      });
      await _pump(t, PartyPricingScreen(session: s, customerId: _p1, customerName: 'Asha Traders'));
      expect(find.text('No customer prices yet'), findsOneWidget);
    });

    testWidgets('the price list opens it with the chosen customer', (t) async {
      final (s, sent) = _routed(_server());
      await _pump(t, PriceListScreen(session: s), width: 900); // the test font is wide: the chip row needs room
      await _tap(t, find.text('Everyone (item prices)'));
      await _tap(t, find.text('Asha Traders'));
      await _tap(t, find.text('Edit party prices'));
      expect(find.byType(PartyPricingScreen), findsOneWidget);
      expect(t.widget<PartyPricingScreen>(find.byType(PartyPricingScreen)).customerId, _p1);
      expect(_gets(sent, '/api/pricing/party-category'), 1);
    });
  });

  group('price levels screens', () {
    Future<(AppSession, List<RequestOptions>)> open(WidgetTester t, {Map<String, (int, Object?)> fail = const {}}) async {
      final (s, sent) = _routed(_server(fail: fail));
      await _pump(t, PriceLevelsScreen(session: s));
      return (s, sent);
    }

    testWidgets('lists the levels with their customer and rate counts', (t) async {
      await open(t);
      expect(find.text('Wholesale'), findsOneWidget);
      expect(find.text('3 customer(s) · 7 rate(s)'), findsOneWidget);
    });

    testWidgets('no levels shows the empty state', (t) async {
      await open(t, fail: {'GET /api/pricing/levels': (200, {'levels': []})});
      expect(find.text('No price levels yet'), findsOneWidget);
    });

    testWidgets('a failed list offers Try again', (t) async {
      await open(t, fail: {'GET /api/pricing/levels': (400, {'error': 'Boom'})});
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('a plan error shows the lock', (t) async {
      await open(t, fail: {'GET /api/pricing/levels': (403, {'error': 'No', 'code': 'FEATURE_NOT_IN_PLAN'})});
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('adding a level sends the name once', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Add level'));
      await _type(t, 'single', '  Dealer ');
      await _tap(t, find.text('Create level'));
      final posts = _writes(sent).where((o) => o.uri.path == '/api/pricing/levels').toList();
      expect(posts.length, 1);
      expect(posts.single.data, {'name': 'Dealer'});
      _noSessionIds(sent);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a refused new level keeps the name', (t) async {
      await open(t, fail: {'POST /api/pricing/levels': (400, {'error': 'Give the price level a name (up to 100 characters)'})});
      await _tap(t, find.text('Add level'));
      await _type(t, 'single', 'X');
      await _tap(t, find.text('Create level'));
      expect(find.text('Give the price level a name (up to 100 characters)'), findsOneWidget);
      expect(t.widget<TextField>(_field('single')).controller!.text, 'X');
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a level opens its rates, customers and actions', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Wholesale'));
      expect(_gets(sent, '/api/pricing/levels/$_l1/rates'), 1);
      expect(find.text('Rice'), findsOneWidget);
      expect(find.textContaining('Min 10'), findsOneWidget);
      expect(find.text('Asha Traders'), findsOneWidget);
      expect(find.text('Add a rate'), findsOneWidget);
    });

    testWidgets('adding a rate sends the website row once', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Wholesale'));
      await _tap(t, find.text('Add a rate'));
      await _tap(t, find.text('Select'));
      await _tap(t, find.text('Oil'));
      await _type(t, 'minQty', '5');
      await _type(t, 'price', '190');
      await _tap(t, find.text('Save'));
      final posts = _writes(sent);
      expect(posts.length, 1);
      expect(posts.single.uri.path, '/api/pricing/levels/$_l1/rates');
      expect(posts.single.data, {
        'rows': [
          {'item_id': _i2, 'variant_id': null, 'min_qty': 5, 'price': 190, 'discount_percent': null, 'valid_from': null, 'valid_to': null},
        ],
      });
      _noSessionIds(sent);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a refused rate keeps the form filled', (t) async {
      await open(t, fail: {'POST /api/pricing/levels/$_l1/rates': (404, {'error': 'Item not found: x'})});
      await _tap(t, find.text('Wholesale'));
      await _tap(t, find.text('Add a rate'));
      await _tap(t, find.text('Select'));
      await _tap(t, find.text('Oil'));
      await _type(t, 'price', '190');
      await _tap(t, find.text('Save'));
      expect(find.text('Item not found: x'), findsOneWidget);
      expect(t.widget<TextField>(_field('price')).controller!.text, '190');
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('removing a rate asks first, then sends the same key with no price', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Wholesale'));
      await _tap(t, find.text('Rice'));
      await _tap(t, find.text('Remove rate'));
      expect(_writes(sent), isEmpty);
      await _tap(t, find.text('Remove'));
      final posts = _writes(sent);
      expect(posts.length, 1);
      expect(posts.single.data, {
        'rows': [
          {'item_id': _i1, 'variant_id': null, 'min_qty': 10, 'price': null, 'discount_percent': null, 'valid_from': null, 'valid_to': null},
        ],
      });
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('deleting a level asks naming it, sends one DELETE, then goes back to the list', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Wholesale'));
      await _tap(t, find.text('Delete level'));
      expect(find.textContaining('"Wholesale"'), findsWidgets);
      expect(_writes(sent), isEmpty);
      await _tap(t, find.text('Delete'));
      final writes = _writes(sent);
      expect(writes.length, 1);
      expect(writes.single.method, 'DELETE');
      expect(writes.single.uri.path, '/api/pricing/levels');
      expect(writes.single.uri.queryParameters['id'], _l1);
      expect(find.text('Add level'), findsOneWidget);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a refused delete keeps the level open', (t) async {
      await open(t, fail: {'DELETE /api/pricing/levels': (404, {'error': 'Price level not found'})});
      await _tap(t, find.text('Wholesale'));
      await _tap(t, find.text('Delete level'));
      await _tap(t, find.text('Delete'));
      expect(find.text('Price level not found'), findsOneWidget);
      expect(find.text('Delete level'), findsOneWidget);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('deactivating sends the level again with is_active flipped', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Wholesale'));
      await _tap(t, find.text('Deactivate'));
      final posts = _writes(sent);
      expect(posts.single.data, {'id': _l1, 'name': 'Wholesale', 'description': null, 'is_active': false});
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('adding a customer to the level assigns them', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Wholesale'));
      await _tap(t, find.text('Select'));
      await _tap(t, find.text('Asha Traders').last);
      final posts = _writes(sent);
      expect(posts.single.data, {'assign': {'price_level_id': _l1, 'customer_ids': [_p1]}});
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('raising all rates asks for a percentage and sends it', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Wholesale'));
      await _tap(t, find.text('Raise all rates by %'));
      await _type(t, 'single', '-5');
      await _tap(t, find.text('Apply'));
      expect(_writes(sent).single.data, {'adjust_percent': -5});
      await t.pump(const Duration(seconds: 4));
    });
  });

  group('schemes screen', () {
    Future<(AppSession, List<RequestOptions>)> open(WidgetTester t, {Map<String, (int, Object?)> fail = const {}}) async {
      final (s, sent) = _routed(_server(fail: fail));
      await _pump(t, SchemesScreen(session: s));
      return (s, sent);
    }

    testWidgets('lists the schemes', (t) async {
      await open(t);
      expect(find.text('Rice'), findsOneWidget);
      expect(find.text('Buy 10, get 1 free'), findsOneWidget);
      expect(find.textContaining('Everyone'), findsOneWidget);
      expect(find.textContaining('Always'), findsOneWidget);
    });

    testWidgets('no schemes shows the empty state', (t) async {
      await open(t, fail: {'GET /api/pricing/schemes': (200, {'schemes': [], 'variants': []})});
      expect(find.text('No schemes yet'), findsOneWidget);
    });

    testWidgets('a failed list offers Try again', (t) async {
      await open(t, fail: {'GET /api/pricing/schemes': (400, {'error': 'Boom'})});
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('a plan error shows the lock', (t) async {
      await open(t, fail: {'GET /api/pricing/schemes': (403, {'error': 'No', 'code': 'FEATURE_NOT_IN_PLAN'})});
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('adding a scheme sends the website body once', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Add scheme'));
      await _tap(t, find.text('Select'));
      await _tap(t, find.text('Oil'));
      await _type(t, 'buy', '12');
      await _tap(t, find.text('Save scheme'));
      final posts = _writes(sent);
      expect(posts.length, 1);
      expect(posts.single.uri.path, '/api/pricing/schemes');
      expect(posts.single.data, {
        'item_id': _i2,
        'variant_id': null,
        'price_level_id': null,
        'buy_qty': 12,
        'free_qty': 1,
        'valid_from': null,
        'valid_to': null,
      });
      _noSessionIds(sent);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a scheme needs an item', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Add scheme'));
      await _tap(t, find.text('Save scheme'));
      expect(find.text('Pick an item'), findsOneWidget);
      expect(_writes(sent), isEmpty);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a refused scheme keeps the form filled', (t) async {
      await open(t, fail: {'POST /api/pricing/schemes': (404, {'error': 'Item not found'})});
      await _tap(t, find.text('Add scheme'));
      await _tap(t, find.text('Select'));
      await _tap(t, find.text('Oil'));
      await _type(t, 'buy', '12');
      await _tap(t, find.text('Save scheme'));
      expect(find.text('Item not found'), findsOneWidget);
      expect(t.widget<TextField>(_field('buy')).controller!.text, '12');
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('changing a scheme sends its id', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Rice'));
      await _tap(t, find.text('Edit'));
      expect(t.widget<TextField>(_field('buy')).controller!.text, '10');
      await _type(t, 'free', '2');
      await _tap(t, find.text('Save scheme'));
      final body = _writes(sent).single.data as Map;
      expect(body['id'], _s1);
      expect(body['free_qty'], 2);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('pausing resends the scheme with is_active false', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Rice'));
      await _tap(t, find.text('Pause'));
      final body = _writes(sent).single.data as Map;
      expect(body['id'], _s1);
      expect(body['is_active'], false);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('deleting asks naming the item, sends one DELETE and reloads', (t) async {
      final (_, sent) = await open(t);
      await _tap(t, find.text('Rice'));
      await _tap(t, find.text('Delete'));
      expect(find.textContaining('Delete the scheme on Rice?'), findsOneWidget);
      expect(_writes(sent), isEmpty);
      final before = _gets(sent, '/api/pricing/schemes');
      await _tap(t, find.text('Delete').last);
      final writes = _writes(sent);
      expect(writes.length, 1);
      expect(writes.single.method, 'DELETE');
      expect(writes.single.uri.queryParameters['id'], _s1);
      expect(_gets(sent, '/api/pricing/schemes'), before + 1);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a refused delete shows the message and keeps the list', (t) async {
      await open(t, fail: {'DELETE /api/pricing/schemes': (404, {'error': 'Scheme not found'})});
      await _tap(t, find.text('Rice'));
      await _tap(t, find.text('Delete'));
      await _tap(t, find.text('Delete').last);
      expect(find.text('Scheme not found'), findsOneWidget);
      expect(find.text('Rice'), findsOneWidget);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('changing a paused scheme keeps it paused', (t) async {
      final (_, sent) = await open(t, fail: {
        'GET /api/pricing/schemes': (200, {
          'schemes': [
            {
              'id': _s1, 'item_id': _i1, 'variant_id': null, 'price_level_id': null, 'buy_qty': 10, 'free_qty': 1, 'valid_from': null,
              'valid_to': null, 'is_active': false, 'item_name': 'Rice', 'variant_name': null, 'level_name': null,
            },
          ],
          'variants': [],
        }),
      });
      await _tap(t, find.text('Rice'));
      await _tap(t, find.text('Edit'));
      await _type(t, 'free', '3');
      await _tap(t, find.text('Save scheme'));
      final body = _writes(sent).single.data as Map;
      expect(body['id'], _s1);
      expect(body['free_qty'], 3);
      expect(body['is_active'], false);
      await t.pump(const Duration(seconds: 4));
    });
  });

  group('fix round 1', () {
    testWidgets('a level change that fails after the customer changed shows no toast', (t) async {
      final gate = Completer<void>();
      final server = _server();
      final (s, _) = _routed((o) async {
        if (o.method == 'POST' && o.uri.path == '/api/pricing/levels') {
          await gate.future;
          return (400, {'error': 'Late refusal'});
        }
        if (o.method == 'GET' && o.uri.path == '/api/customers') {
          return (200, {
            'customers': [
              {'id': _p1, 'name': 'Asha Traders'},
              {'id': 'c0000000-0000-4000-8000-000000000002', 'name': 'Bela Stores'},
            ],
          });
        }
        return server(o);
      });
      await _pump(t, PartyPricingScreen(session: s, customerId: _p1, customerName: 'Asha Traders'));
      await _tap(t, find.text('None (item prices)'));
      await t.tap(find.text('Wholesale'));
      await t.pump();
      await _tap(t, find.text('Asha Traders'));
      await t.pumpAndSettle();
      await _tap(t, find.text('Bela Stores'));
      gate.complete();
      await t.pumpAndSettle();
      expect(find.text('Late refusal'), findsNothing);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('the remove prompt does not call an unknown item "Item"', (t) async {
      final server = _server();
      final (s, _) = _routed((o) async {
        if (o.method == 'GET' && o.uri.path == '/api/items') return (200, {'items': []});
        return server(o);
      });
      await _pump(t, PartyPricingScreen(session: s, customerId: _p1, customerName: 'Asha Traders'));
      await _tap(t, find.text('Item'));
      await _tap(t, find.text('Remove price'));
      expect(find.textContaining('for Item'), findsNothing);
      expect(find.textContaining('this item'), findsOneWidget);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a level rate form says that a new minimum quantity or From date saves a new rate', (t) async {
      final (s, _) = _routed(_server());
      await _pump(t, PriceLevelsScreen(session: s));
      await _tap(t, find.text('Wholesale'));
      await _tap(t, find.text('Rice'));
      expect(find.textContaining('saves a new rate'), findsOneWidget);
    });
  });

  test('all three links have native screens and none is left generic or on the website', () {
    final (s, _) = _routed(_server());
    expect(nativeScreenFor(s, '/pricing/party-item'), isA<PartyPricingScreen>());
    expect(nativeScreenFor(s, '/pricing/levels'), isA<PriceLevelsScreen>());
    expect(nativeScreenFor(s, '/pricing/schemes'), isA<SchemesScreen>());
    for (final href in ['/pricing/party-item', '/pricing/levels', '/pricing/schemes']) {
      expect(routeTier(s, href), RouteTier.native, reason: href);
      expect(stillGeneric.contains(href) || websiteForNow.contains(href) || websiteByDesign.contains(href), isFalse, reason: href);
    }
  });
}
