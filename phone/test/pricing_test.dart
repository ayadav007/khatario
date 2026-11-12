import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/stock/item_cleanup_screen.dart';
import 'package:khatario_phone/screens/stock/price_list_screen.dart';
import 'package:khatario_phone/screens/stock/pricing_logic.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/fake_session.dart';

/// A session whose reply is chosen per request, with its own status: (status, body).
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

const _c1 = 'c0000000-0000-4000-8000-000000000001';
const _i1 = 'a0000000-0000-4000-8000-000000000001';
const _i2 = 'a0000000-0000-4000-8000-000000000002';
const _i3 = 'a0000000-0000-4000-8000-000000000003';
const _v1 = 'b0000000-0000-4000-8000-000000000001';

Future<void> _pump(WidgetTester t, Widget screen) async {
  await t.pumpWidget(MaterialApp(home: screen));
  await t.pumpAndSettle();
}

void main() {
  group('price list logic', () {
    test('resolveRequestBody matches the website body', () {
      expect(resolveRequestBody(_c1, [_i1, _i2], date: '2026-11-10'), {
        'customer_id': _c1,
        'date': '2026-11-10',
        'lines': [
          {'item_id': _i1, 'variant_id': null, 'qty': 1},
          {'item_id': _i2, 'variant_id': null, 'qty': 1},
        ],
      });
    });

    test('no customer sends null, a variant id rides on its line, no ids are never invented', () {
      final body = resolveRequestBody(null, [_i1, _i1], variantIds: [null, _v1]);
      expect(body['customer_id'], isNull);
      expect(body.containsKey('date'), isFalse);
      expect((body['lines'] as List)[1]['variant_id'], _v1);
      expect(body.containsKey('business_id'), isFalse);
      expect(resolveRequestBody('  ', const [])['customer_id'], isNull);
    });

    test('items expand to variants only where the customer reply has them', () {
      final wants = priceWants([
        {'id': _i1, 'name': 'Shirt', 'unit': 'PCS'},
        {'id': _i2, 'name': 'Rice', 'unit': 'KG'},
        {'name': 'no id'},
      ], [
        {'id': _v1, 'item_id': _i1, 'variant_name': 'Large'},
      ]);
      expect(wants.map((w) => w.variantId), [_v1, null]);
      expect(wants.map((w) => w.variantName), ['Large', null]);
    });

    test('chunked keeps the route limit', () {
      expect(chunked(List.generate(650, (i) => i)).map((c) => c.length), [300, 300, 50]);
      expect(chunked(<int>[]), isEmpty);
    });

    test('reply lines are read by position and never throw on odd values', () {
      final wants = priceWants([
        {'id': _i1, 'name': 'A'},
        {'id': _i2, 'name': 'B'},
        {'id': _i3, 'name': 'C'},
      ], const []);
      final lines = priceLines(wants, {
        'lines': [
          {'price': '120.5', 'priceSource': 'party', 'discountPercent': 5, 'taxRate': 18, 'gstIncluded': true, 'mrp': 150},
          {'price': null, 'scheme': {'buyQty': 10, 'freeQty': 1}},
        ],
      });
      expect(lines.length, 3);
      expect(lines[0].price, 120.5);
      expect(lines[0].isSpecial, isTrue);
      expect(lines[0].gstIncluded, isTrue);
      expect(lines[1].price, isNull);
      expect(lines[1].hasScheme, isTrue);
      expect(lines[2].price, isNull);
      expect(lines[2].isSpecial, isFalse);
      expect(onlySpecial(lines).length, 2);
      expect(priceLines(wants, 'junk').length, 3);
    });
  });

  group('merge and units logic', () {
    test('mergeBody leaves out the kept id and repeats', () {
      expect(mergeBody('k', ['k', 'a', 'b', 'a', '']), [
        {'source_item_id': 'a', 'target_item_id': 'k'},
        {'source_item_id': 'b', 'target_item_id': 'k'},
      ]);
      expect(mergeBody('k', ['k']), isEmpty);
    });

    test('preview reads problems and the tables that move', () {
      final p = mergePreview({
        'problems': ['Units differ (KG and PCS)'],
        'references': {'invoice_items.item_id': 3, 'stock_movements.item_id': '2'},
      });
      expect(p.blocked, isTrue);
      expect(p.moves, ['invoice items: 3', 'stock movements: 2']);
      expect(mergePreview(null).blocked, isFalse);
      expect(mergePreview({'problems': 'x', 'references': []}).moves, isEmpty);
    });

    test('the confirm text names the kept item and the count', () {
      expect(mergeConfirmText('Rice 1kg', 2), contains('"Rice 1kg"'));
      expect(mergeConfirmText('Rice 1kg', 2), contains('2 items'));
      expect(mergeConfirmText('Rice 1kg', 1), contains('1 item'));
    });

    test('units round trip to the website body', () {
      final drafts = unitDrafts({
        'units': [
          {'unit': 'BOX', 'factor_to_base': 12, 'barcode': null, 'selling_price': 90.5},
        ],
      });
      expect(drafts.single.factor, '12');
      expect(drafts.single.price, '90.5');
      expect(unitsBody([...drafts, const UnitDraft(), const UnitDraft(unit: ' BAG ', factor: '50')]), {
        'units': [
          {'unit': 'BOX', 'factor_to_base': 12, 'barcode': '', 'selling_price': 90.5},
          {'unit': 'BAG', 'factor_to_base': 50, 'barcode': '', 'selling_price': null},
        ],
      });
      expect(baseUnitOf({'items': {_i1: {'unit': 'PCS'}}}, _i1), 'PCS');
      expect(baseUnitOf(null, _i1), '');
    });
  });

  test('both links have their screens', () {
    final (s, _) = fakeSession((_) => {});
    expect(nativeScreenFor(s, '/pricing/price-list'), isA<PriceListScreen>());
    expect(nativeScreenFor(s, '/items/cleanup'), isA<ItemCleanupScreen>());
  });

  group('price list screen', () {
    Object? server(RequestOptions o) {
      switch (o.uri.path) {
        case '/api/items':
          return {
            'items': [
              {'id': _i1, 'name': 'Rice', 'unit': 'KG'},
              {'id': _i2, 'name': 'Oil', 'unit': 'L'},
            ],
            'pagination': {'page': 1, 'totalPages': 1},
          };
        case '/api/pricing/resolve':
          final party = o.data['customer_id'] != null;
          return {
            'lines': [
              {'price': party ? 55 : 60, 'priceSource': party ? 'party' : 'catalog', 'discountPercent': party ? 5 : null, 'taxRate': 5, 'gstIncluded': false, 'mrp': 70},
              {'price': 200, 'priceSource': 'catalog', 'taxRate': 12, 'gstIncluded': true, 'scheme': {'buyQty': 10, 'freeQty': 1}},
            ],
          };
        case '/api/customers':
          return {
            'customers': [
              {'id': _c1, 'name': 'Asha Traders', 'phone': '9999'},
            ],
          };
        case '/api/pricing/party-item':
          return {'overrides': [], 'variants': []};
      }
      return {};
    }

    testWidgets('lists the items with the price the server returns', (t) async {
      final (s, sent) = fakeSession(server);
      await _pump(t, PriceListScreen(session: s));
      expect(find.text('Rice'), findsOneWidget);
      expect(find.text('Oil'), findsOneWidget);
      expect(find.textContaining('Buy 10, get 1 free'), findsOneWidget);
      final resolve = sent.where((o) => o.uri.path == '/api/pricing/resolve').single;
      expect(resolve.data['customer_id'], isNull);
      expect((resolve.data['lines'] as List).length, 2);
      expect(resolve.data['date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expect(sent.every((o) => !o.uri.queryParameters.containsKey('business_id') && !o.data.toString().contains('business_id')), isTrue);
    });

    testWidgets('picking a customer asks for that customer\'s prices and shows the discount', (t) async {
      final (s, sent) = fakeSession(server);
      await _pump(t, PriceListScreen(session: s));
      await t.tap(find.text('Everyone (item prices)'));
      await t.pumpAndSettle();
      await t.tap(find.text('Asha Traders'));
      await t.pumpAndSettle();
      final resolve = sent.where((o) => o.uri.path == '/api/pricing/resolve').last;
      expect(resolve.data['customer_id'], _c1);
      expect(find.text('Customer price'), findsWidgets);
      expect(find.text('Disc 5%'), findsOneWidget);
      expect(find.text('Edit party prices'), findsOneWidget);
    });

    testWidgets('a refused price request shows the server message and keeps the items', (t) async {
      var refuse = false;
      final (s, _) = _routed((o) async {
        if (o.uri.path == '/api/pricing/resolve' && refuse) return (400, {'error': 'Invalid customer_id'});
        return (200, server(o));
      });
      await _pump(t, PriceListScreen(session: s));
      refuse = true;
      await t.tap(find.text('Everyone (item prices)'));
      await t.pumpAndSettle();
      await t.tap(find.text('Asha Traders'));
      await t.pumpAndSettle();
      expect(find.text('Invalid customer_id'), findsOneWidget);
      expect(find.text('Rice'), findsOneWidget);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('an empty catalogue shows the empty state', (t) async {
      final (s, _) = fakeSession((o) => o.uri.path == '/api/items' ? {'items': []} : {});
      await _pump(t, PriceListScreen(session: s));
      expect(find.byType(KEmptyState), findsOneWidget);
    });

    testWidgets('a plan error shows the lock without Try again', (t) async {
      final (s, _) = fakeSession((_) => {'error': 'No', 'code': 'FEATURE_NOT_IN_PLAN'}, status: 403);
      await _pump(t, PriceListScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('a server error offers Try again', (t) async {
      final (s, _) = fakeSession((_) => {'error': 'Boom'}, status: 400);
      await _pump(t, PriceListScreen(session: s));
      expect(find.text('Try again'), findsOneWidget);
    });
  });

  group('item cleanup screen', () {
    Future<(int, Object?)> server(RequestOptions o) async {
      if (o.uri.path == '/api/items/search') {
        return (200, {
          'items': [
            {'id': _i1, 'name': 'Rice 1kg', 'unit': 'KG'},
            {'id': _i2, 'name': 'Rice loose', 'unit': 'KG'},
          ],
        });
      }
      if (o.uri.path == '/api/items/merge' && o.method == 'GET') {
        return (200, {'references': {'invoice_items.item_id': 3}, 'problems': []});
      }
      if (o.uri.path == '/api/items/merge') {
        return (200, {'moved': {}, 'target': {'id': _i1, 'name': 'Rice 1kg'}});
      }
      if (o.uri.path == '/api/items/units') {
        return (200, {'items': {_i1: {'unit': 'KG', 'units': []}}});
      }
      if (o.uri.path == '/api/items/$_i1/units' && o.method == 'GET') {
        return (200, {'units': [{'unit': 'BAG', 'factor_to_base': 50, 'barcode': null, 'selling_price': null}]});
      }
      if (o.uri.path == '/api/items/$_i1/units') return (200, {'units': []});
      return (200, {});
    }

    Future<void> pickKeepAndDuplicate(WidgetTester t) async {
      await t.tap(find.text('Select').first);
      await t.pumpAndSettle();
      await t.tap(find.text('Rice 1kg'));
      await t.pumpAndSettle();
      await t.tap(find.text('Select').first);
      await t.pumpAndSettle();
      await t.tap(find.text('Rice loose'));
      await t.pumpAndSettle();
    }

    Future<void> openUnitsOfRice(WidgetTester t) async {
      await t.tap(find.text('Alternate units'));
      await t.pumpAndSettle();
      await t.tap(find.text('Select').first);
      await t.pumpAndSettle();
      await t.tap(find.text('Rice 1kg'));
      await t.pumpAndSettle();
    }

    testWidgets('previews the merge, confirms by name and count, then sends the merge', (t) async {
      final (s, sent) = _routed(server);
      await _pump(t, ItemCleanupScreen(session: s));
      await pickKeepAndDuplicate(t);
      final preview = sent.where((o) => o.uri.path == '/api/items/merge' && o.method == 'GET').single;
      expect(preview.uri.queryParameters, {'source_item_id': _i2, 'target_item_id': _i1});
      expect(find.text('invoice items: 3'), findsOneWidget);

      await t.tap(find.text('Merge'));
      await t.pumpAndSettle();
      expect(find.text('Merge 1 item into "Rice 1kg"?'), findsOneWidget);
      expect(sent.where((o) => o.method == 'POST'), isEmpty);
      await t.tap(find.text('Merge 1 item'));
      await t.pumpAndSettle();
      final post = sent.where((o) => o.method == 'POST').single;
      expect(post.data, {'source_item_id': _i2, 'target_item_id': _i1});
      expect(find.text('Merged into Rice 1kg'), findsOneWidget);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('the merge goes out once while it runs', (t) async {
      final gate = Completer<void>();
      final (s, sent) = _routed((o) async {
        if (o.method == 'POST') await gate.future;
        return server(o);
      });
      await _pump(t, ItemCleanupScreen(session: s));
      await pickKeepAndDuplicate(t);
      await t.tap(find.text('Merge'));
      await t.pumpAndSettle();
      await t.tap(find.text('Merge 1 item'));
      await t.pump();
      expect(t.widget<KButton>(find.widgetWithText(KButton, 'Merge')).loading, isTrue);
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.byType(KButton).last, warnIfMissed: false);
      await t.pump();
      expect(sent.where((o) => o.method == 'POST').length, 1);
      gate.complete();
      await t.pumpAndSettle();
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a refused merge shows the server message and keeps the picks', (t) async {
      final (s, _) = _routed((o) async {
        if (o.method == 'POST') return (409, {'error': 'Units differ (KG and PCS)'});
        return server(o);
      });
      await _pump(t, ItemCleanupScreen(session: s));
      await pickKeepAndDuplicate(t);
      await t.tap(find.text('Merge'));
      await t.pumpAndSettle();
      await t.tap(find.text('Merge 1 item'));
      await t.pumpAndSettle();
      expect(find.text('Units differ (KG and PCS)'), findsOneWidget);
      expect(find.text('Rice loose'), findsOneWidget);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a blocked preview shows why and the merge cannot be sent', (t) async {
      final (s, sent) = _routed((o) async {
        if (o.method == 'GET' && o.uri.path == '/api/items/merge') return (200, {'references': {}, 'problems': ['Bundles cannot be merged']});
        return server(o);
      });
      await _pump(t, ItemCleanupScreen(session: s));
      await pickKeepAndDuplicate(t);
      expect(find.text('Bundles cannot be merged'), findsOneWidget);
      await t.tap(find.text('Merge'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(find.text('Merge 1 item'), findsNothing);
      expect(sent.where((o) => o.method == 'POST'), isEmpty);
    });

    testWidgets('alternate units load for an item and save with the website body', (t) async {
      final (s, sent) = _routed(server);
      await _pump(t, ItemCleanupScreen(session: s));
      await openUnitsOfRice(t);
      expect(find.text('BAG'), findsOneWidget);
      await t.tap(find.text('Save units'));
      await t.pumpAndSettle();
      final put = sent.where((o) => o.method == 'PUT').single;
      expect(put.uri.path, '/api/items/$_i1/units');
      expect(put.data, {
        'units': [
          {'unit': 'BAG', 'factor_to_base': 50, 'barcode': '', 'selling_price': null},
        ],
      });
      expect(find.text('Units saved'), findsOneWidget);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('a refused unit save shows the server message and keeps the rows', (t) async {
      final (s, _) = _routed((o) async {
        if (o.method == 'PUT') return (400, {'error': 'BAG is listed twice'});
        return server(o);
      });
      await _pump(t, ItemCleanupScreen(session: s));
      await openUnitsOfRice(t);
      await t.tap(find.text('Save units'));
      await t.pumpAndSettle();
      expect(find.text('BAG is listed twice'), findsOneWidget);
      expect(find.text('BAG'), findsOneWidget);
      await t.pump(const Duration(seconds: 4));
    });

    testWidgets('units that fail to load show Try again', (t) async {
      final (s, _) = _routed((o) async {
        if (o.uri.path == '/api/items/$_i1/units') return (400, {'error': 'Boom'});
        return server(o);
      });
      await _pump(t, ItemCleanupScreen(session: s));
      await openUnitsOfRice(t);
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('a plan error on the units shows the lock without Try again', (t) async {
      final (s2, _) = _routed((o) async {
        if (o.uri.path == '/api/items/$_i1/units') return (403, {'error': 'No', 'code': 'FEATURE_NOT_IN_PLAN'});
        return server(o);
      });
      await _pump(t, ItemCleanupScreen(session: s2));
      await openUnitsOfRice(t);
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });
  });
}
