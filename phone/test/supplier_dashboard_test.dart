import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/hub/my_catalog_screen.dart';
import 'package:khatario_phone/screens/hub/supplier_dashboard_logic.dart';
import 'package:khatario_phone/screens/hub/supply_orders_screen.dart';
import 'package:khatario_phone/screens/hub/supplier_dashboard_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _alert(
  String id,
  String item, {
  String customer = 'Shree Traders',
  num stock = 2,
  num threshold = 10,
}) => {
  'id': id,
  'item_id': 'i-$id',
  'item_name': item,
  'item_code': 'C-$id',
  'current_stock': stock,
  'threshold': threshold,
  'customer_name': customer,
  'customer_phone': '98200 11111',
  'customer_email': 'shree@example.com',
  'customer_address': '12 Market Road',
  'customer_city': 'Surat',
  'customer_state': 'Gujarat',
  'customer_pincode': '395003',
  'first_alerted_at': '2026-11-10T08:00:00.000Z',
  'alert_status': 'active',
};

final _dashboard = {
  'success': true,
  'low_stock_alerts': [
    _alert('a1', 'Basmati rice 25kg'),
    _alert('item-9f', 'Sugar 50kg', stock: 0, threshold: 5),
  ],
  'stats': {
    'active_customers': 3,
    'low_stock_alerts': 2,
    'total_thresholds': 7,
    'pending_requests': 1,
  },
  'customer_groups': [
    {
      'customer_business_id': 'cb1',
      'customer_name': 'Shree Traders',
      'customer_phone': '98200 11111',
      'customer_email': 'shree@example.com',
      'customer_city': 'Surat',
      'customer_state': 'Gujarat',
      'items_count': 2,
      'total_shortage': 13,
      'items': [
        {
          'item_id': 'i-a1',
          'item_name': 'Basmati rice 25kg',
          'item_code': 'C-a1',
          'current_stock': 2,
          'threshold': 10,
        },
        {
          'item_id': 'i-9',
          'item_name': 'Sugar 50kg',
          'item_code': 'C-9',
          'current_stock': 0,
          'threshold': 5,
        },
      ],
    },
  ],
};

Map<String, dynamic> _area(
  String label, {
  int customers = 3,
  num sellIn = 120000,
  num sellThrough = 90000,
  int low = 2,
  String band = 'strong',
}) => {
  'state': label,
  'city': '',
  'pincode': '',
  'label': label,
  'customerCount': customers,
  'sellIn': sellIn,
  'sellThrough': sellThrough,
  'lowStockItems': low,
  'band': band,
};

final _analytics = {
  'success': true,
  'period': {'key': '90d', 'from': '2026-08-14', 'to': '2026-11-12'},
  'states': [
    _area('Gujarat'),
    _area('Maharashtra', sellIn: 5000, sellThrough: 0, low: 0, band: 'quiet'),
  ],
  'cities': [_area('Surat, Gujarat', customers: 4)],
  'pincodes': [_area('395003 · Surat, Gujarat', customers: 3)],
  'min_shops_per_area': 3,
  'shops_sharing': 7,
  'hidden_shops': {'states': 0, 'cities': 2, 'pincodes': 5},
  'pivot_items': ['Basmati rice 25kg', 'Sugar 50kg'],
  'pivot_matrix': [
    {
      'state': 'Gujarat',
      'cells': {'Basmati rice 25kg': 50000, 'Sugar 50kg': 12000},
      'total': 62000,
    },
  ],
};

final _thresholds = {
  'success': true,
  'thresholds': [
    {
      'id': 'th1',
      'customer_name': 'Shree Traders',
      'customer_phone': '98200 11111',
      'customer_city': 'Surat',
      'customer_state': 'Gujarat',
      'item_name': 'Basmati rice 25kg',
      'item_code': 'BR25',
      'low_stock_threshold': 10,
      'current_stock': 4,
    },
    {
      'id': 'th2',
      'customer_name': 'Om Stores',
      'item_name': 'Tea 1kg',
      'low_stock_threshold': 5,
      'current_stock': 30,
    },
  ],
};

Reply _handler(RequestOptions o, Map b) {
  final p = o.uri.path;
  if (p == '/api/suppliers/dashboard' && o.method == 'GET') {
    return (200, _dashboard);
  }
  if (p == '/api/suppliers/dashboard/analytics') return (200, _analytics);
  if (p == '/api/suppliers/hub/linked-customer') {
    return (200, {'customer_id': 'cust9'});
  }
  if (p == '/api/supply-orders') {
    return (
      201,
      {
        'order': {'id': 'so1'},
      },
    );
  }
  if (p == '/api/suppliers/thresholds' && o.method == 'GET') {
    return (200, _thresholds);
  }
  return (200, <String, dynamic>{'success': true});
}

Finder _icon(String label) =>
    find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == label);

void _noIdentity(List<RequestOptions> sent) {
  for (final o in sent) {
    expect(
      o.uri.query.contains('business_id'),
      isFalse,
      reason: o.uri.toString(),
    );
    expect(o.uri.query.contains('user_id'), isFalse, reason: o.uri.toString());
    if (o.data is Map) expectNoIdentity(o.data as Map);
  }
}

void main() {
  group('supplier dashboard logic', () {
    test('paths carry no business id', () {
      expect(supplierDashboardPath, '/api/suppliers/dashboard');
      expect(
        supplierAnalyticsPath('30d'),
        '/api/suppliers/dashboard/analytics?period=30d',
      );
      expect(supplierThresholdsPath, '/api/suppliers/thresholds');
      expect(
        supplierThresholdDeletePath('a b'),
        '/api/suppliers/thresholds?id=a+b',
      );
      expect(
        supplierDismissPath('x1'),
        '/api/suppliers/dashboard/dismiss-alert?alert_id=x1',
      );
    });

    test('the dashboard reply gives the three tiles and the alerts', () {
      final d = SupplierDashboard.fromJson(_dashboard);
      expect(
        (d.activeCustomers, d.lowStockAlerts, d.monitoredItems),
        (3, 2, 7),
      );
      expect(d.alerts.map((a) => a.itemName), [
        'Basmati rice 25kg',
        'Sugar 50kg',
      ]);
      expect(d.alerts.first.shortage, 8);
      expect(d.alerts.first.location, 'Surat, Gujarat 395003');
      expect(SupplierDashboard.fromJson({}).alerts, isEmpty);
      expect(
        SupplierDashboard.fromJson({
          'low_stock_alerts': [
            {'item_name': 'no id'},
          ],
        }).alerts,
        isEmpty,
      );
    });

    test('customer groups parse; the order bodies carry only the buyer, the customer and the lines', () {
      final d = SupplierDashboard.fromJson(_dashboard);
      final g = d.groups.single;
      expect(
        (g.customerBusinessId, g.name, g.itemsCount, g.totalShortage),
        ('cb1', 'Shree Traders', 2, 13),
      );
      expect(g.location, 'Surat, Gujarat');
      expect(g.items.map((i) => i.shortage), [8, 5]);
      expect(linkedCustomerPath, '/api/suppliers/hub/linked-customer');
      expect(supplyOrdersPath, '/api/supply-orders');
      expect(linkedCustomerBody('cb1'), {'buyer_business_id': 'cb1'});
      final lines = proposalLines(g.items, ['8', '  ', 'x']);
      expect(lines, [
        {'buyer_item_id': 'i-a1', 'buyer_qty': 8},
      ]);
      expect(proposalLines(g.items, ['2.5', '0']), [
        {'buyer_item_id': 'i-a1', 'buyer_qty': 2.5},
      ]);
      expect(proposeOrderBody('c9', lines), {
        'customer_id': 'c9',
        'lines': lines,
        'send': true,
      });
      expect(quantityText(8), '8');
      expect(quantityText(2.5), '2.5');
      expect(whatsAppUri('98200 11111').toString(), 'https://wa.me/9820011111');
      expect(whatsAppUri('  '), isNull);
    });

    test('items below their reorder level without an alert row (item- ids) cannot be dismissed', () {
      expect(alertCanBeDismissed('a1'), isTrue);
      expect(alertCanBeDismissed('item-9f'), isFalse);
    });

    test('analytics rows, pivot and the privacy note parse', () {
      final a = AreaAnalytics.fromJson(_analytics);
      expect(a.from, '2026-08-14');
      expect(a.states.map((r) => r.label), ['Gujarat', 'Maharashtra']);
      expect(a.states.first.sellIn, 120000);
      expect(a.rowsFor('city').single.label, 'Surat, Gujarat');
      expect(a.rowsFor('pincode').single.customers, 3);
      expect(a.pivotItems, ['Basmati rice 25kg', 'Sugar 50kg']);
      expect(a.pivot.single.state, 'Gujarat');
      expect(a.pivot.single.cells['Sugar 50kg'], 12000);
      expect(a.hiddenFor('city'), 2);
      expect(a.minShops, 3);
      expect(areaBandLabel('weak'), 'Needs attention');
      expect(areaBandLabel('strong'), 'Doing well');
      expect(areaBandLabel('watch'), 'Watch');
      expect(areaBandLabel('quiet'), 'No movement');
      expect(analyticsPeriods.map((p) => p.$2), [
        'Last 30 days',
        'Last 90 days',
        'This financial year',
      ]);
      expect(a.emptyNote, isNull);
      expect(
        AreaAnalytics.fromJson({
          'shops_sharing': 2,
          'min_shops_per_area': 3,
          'states': [],
        }).emptyNote,
        "2 shops share with you so far. Area totals appear once at least 3 shops in an area share, so no single shop's sales can be seen.",
      );
      expect(
        AreaAnalytics.fromJson({'shops_sharing': 1, 'states': []}).emptyNote,
        startsWith('1 shop shares with you so far.'),
      );
      expect(
        AreaAnalytics.fromJson({'states': []}).emptyNote,
        'No connected shops share their stock and sales with you yet.',
      );
    });

    test('thresholds parse; low means stock at or under the level', () {
      final t = supplierThresholds(_thresholds);
      expect(t.map((e) => e.id), ['th1', 'th2']);
      expect(t.first.isLow, isTrue);
      expect(t.last.isLow, isFalse);
      expect(t.first.location, 'Surat, Gujarat');
      expect(t.last.location, '');
    });
  });

  group('routes', () {
    test('the three supplier dashboard links open native screens and nothing is generic', () {
      final (session, _) = recordedSession(_handler);
      expect(
        nativeScreenFor(session, '/suppliers/dashboard'),
        isA<SupplierDashboardScreen>(),
      );
      expect(
        nativeScreenFor(session, '/suppliers/dashboard/analytics'),
        isA<SupplierAnalyticsScreen>(),
      );
      expect(
        nativeScreenFor(session, '/suppliers/dashboard/thresholds'),
        isA<SupplierThresholdsScreen>(),
      );
    });
  });

  group('supplier dashboard screen', () {
    testWidgets('shows the tiles and the alerts, asking with no business id', (
      t,
    ) async {
      final (session, sent) = recordedSession(_handler);
      await pumpScreen(t, SupplierDashboardScreen(session: session));
      expect(find.text('Active customers'), findsOneWidget);
      expect(find.text('Low stock alerts'), findsOneWidget);
      expect(find.text('Monitored items'), findsOneWidget);
      expect(find.text('7'), findsOneWidget);
      expect(find.text('Basmati rice 25kg'), findsWidgets);
      expect(find.text('Sugar 50kg'), findsWidgets);
      expect(find.text('Shree Traders'), findsWidgets);
      expect(find.text('Customers with Low Stock'), findsOneWidget);
      expect(find.text('Low Stock Alerts'), findsOneWidget);
      expect(
        requestsOf(sent, 'GET', '/api/suppliers/dashboard').single.uri.query,
        isEmpty,
      );
      _noIdentity(sent);
    });

    testWidgets(
      'Dismiss shows on a real alert only, and sends one request on a double tap',
      (t) async {
        final (session, sent) = recordedSession(_handler);
        await pumpScreen(t, SupplierDashboardScreen(session: session));
        expect(find.text('Dismiss'), findsOneWidget);
        await t.tap(find.text('Dismiss'));
        await t.tap(find.text('Dismiss'), warnIfMissed: false);
        await t.pumpAndSettle();
        final posts = requestsOf(
          sent,
          'POST',
          '/api/suppliers/dashboard/dismiss-alert',
        ).toList();
        expect(posts.length, 1);
        expect(posts.single.uri.query, 'alert_id=a1');
        expect(requestCount(sent, 'GET', '/api/suppliers/dashboard'), 2);
        _noIdentity(sent);
      },
    );

    testWidgets('a refused dismiss shows the server reason and reloads', (
      t,
    ) async {
      final (session, sent) = recordedSession(
        (o, b) => o.method == 'POST'
            ? (403, {'error': 'You can only dismiss your own alerts'})
            : _handler(o, b),
      );
      await pumpScreen(t, SupplierDashboardScreen(session: session));
      await t.tap(find.text('Dismiss'));
      await t.pumpAndSettle();
      expect(find.text('You can only dismiss your own alerts'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/suppliers/dashboard'), 2);
    });

    testWidgets('empty, server error with Try again, and not in the plan', (
      t,
    ) async {
      final (empty, _) = recordedSession(
        (o, b) => (
          200,
          {
            'success': true,
            'low_stock_alerts': [],
            'stats': {
              'active_customers': 0,
              'low_stock_alerts': 0,
              'total_thresholds': 0,
              'pending_requests': 0,
            },
          },
        ),
      );
      await pumpScreen(t, SupplierDashboardScreen(session: empty));
      expect(find.text('No low stock alerts'), findsOneWidget);

      var fail = true;
      final (flaky, sent) = recordedSession(
        (o, b) => fail ? (500, {'error': 'Boom'}) : _handler(o, b),
      );
      await pumpScreen(t, SupplierDashboardScreen(session: flaky));
      expect(
        find.text('Could not load the supplier dashboard'),
        findsOneWidget,
      );
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Basmati rice 25kg'), findsWidgets);
      expect(requestCount(sent, 'GET', '/api/suppliers/dashboard'), 2);

      final (locked, _) = recordedSession(
        (o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}),
      );
      await pumpScreen(t, SupplierDashboardScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets(
      'each customer card shows the item count, total shortage and items, and there is no website row',
      (t) async {
        final (session, _) = recordedSession(_handler);
        await pumpScreen(t, SupplierDashboardScreen(session: session));
        expect(find.textContaining('Items in low stock: 2'), findsOneWidget);
        expect(find.textContaining('Total shortage: 13'), findsOneWidget);
        expect(find.text('Propose order'), findsOneWidget);
        expect(find.text('Propose an order to a customer'), findsNothing);
      },
    );

    testWidgets(
      'Contact opens WhatsApp on the digits of the phone, as the website does',
      (t) async {
        final (session, _) = recordedSession(_handler);
        final opened = <Uri>[];
        await pumpScreen(
          t,
          SupplierDashboardScreen(
            session: session,
            launcher: (u) async {
              opened.add(u);
              return true;
            },
          ),
        );
        await t.ensureVisible(find.text('Contact').first);
        await t.tap(find.text('Contact').first);
        await t.pumpAndSettle();
        expect(opened.single.toString(), 'https://wa.me/9820011111');
      },
    );

    testWidgets(
      'Suggested orders, My catalog and View Requests open their phone screens',
      (t) async {
        final (session, _) = recordedSession(_handler);
        await pumpScreen(t, SupplierDashboardScreen(session: session));
        await t.tap(find.text('Suggested orders'));
        await t.pumpAndSettle();
        expect(find.byType(SupplyOrdersScreen), findsOneWidget);
        await t.tap(_icon('Back'));
        await t.pumpAndSettle();
        await t.tap(find.text('My catalog'));
        await t.pumpAndSettle();
        expect(find.byType(MyCatalogScreen), findsOneWidget);
        await t.tap(_icon('Back'));
        await t.pumpAndSettle();
        await t.tap(find.text('View Requests'));
        await t.pumpAndSettle();
        expect(
          t.widget<SupplyOrdersScreen>(find.byType(SupplyOrdersScreen)).selling,
          isTrue,
        );
      },
    );

    testWidgets(
      'Propose order pre-fills the shortage, asks, then posts the linked customer and the order',
      (t) async {
        final (session, sent) = recordedSession(_handler);
        await pumpScreen(t, SupplierDashboardScreen(session: session));
        await t.tap(find.text('Propose order'));
        await t.pumpAndSettle();
        expect(
          find.text('Request quantities from Shree Traders'),
          findsOneWidget,
        );
        final fields = find.byType(TextField);
        expect(t.widget<TextField>(fields.at(0)).controller!.text, '8');
        expect(t.widget<TextField>(fields.at(1)).controller!.text, '5');
        await t.enterText(fields.at(1), '7');
        await t.tap(find.text('Send order'));
        await t.pump();
        await t.pump(const Duration(milliseconds: 400));
        expect(
          requestCount(sent, 'POST', '/api/suppliers/hub/linked-customer'),
          0,
        );
        expect(
          find.text(
            'Propose an order to Shree Traders for 2 item(s)? They confirm it in Supplier Hub.',
          ),
          findsOneWidget,
        );
        await t.tap(inSheet('Send order'));
        await t.tap(inSheet('Send order'), warnIfMissed: false);
        await t.pumpAndSettle();
        expect(lastBody(sent, 'POST', '/api/suppliers/hub/linked-customer'), {
          'buyer_business_id': 'cb1',
        });
        expect(requestCount(sent, 'POST', '/api/supply-orders'), 1);
        final order = lastBody(sent, 'POST', '/api/supply-orders');
        expect(order, {
          'customer_id': 'cust9',
          'lines': [
            {'buyer_item_id': 'i-a1', 'buyer_qty': 8},
            {'buyer_item_id': 'i-9', 'buyer_qty': 7},
          ],
          'send': true,
        });
        final posts = sent
            .where((o) => o.method == 'POST')
            .map((o) => o.uri.path)
            .toList();
        expect(posts, [
          '/api/suppliers/hub/linked-customer',
          '/api/supply-orders',
        ]);
        expectNoIdentity(order);
        expect(requestCount(sent, 'GET', '/api/suppliers/dashboard'), 2);
      },
    );

    testWidgets(
      'backing out of the ask sends nothing; no quantities is refused before asking',
      (t) async {
        final (session, sent) = recordedSession(_handler);
        await pumpScreen(t, SupplierDashboardScreen(session: session));
        await t.tap(find.text('Propose order'));
        await t.pumpAndSettle();
        await t.tap(find.text('Send order'));
        await t.pump();
        await t.pump(const Duration(milliseconds: 400));
        await t.tap(inSheet('Cancel'));
        await t.pumpAndSettle();
        expect(
          requestCount(sent, 'POST', '/api/suppliers/hub/linked-customer'),
          0,
        );
        final fields = find.byType(TextField);
        await t.enterText(fields.at(0), '');
        await t.enterText(fields.at(1), '0');
        await t.tap(find.text('Send order'));
        await t.pump();
        await t.pump(const Duration(milliseconds: 400));
        expect(
          find.text('Please enter quantities for at least one item'),
          findsOneWidget,
        );
        expect(find.byType(BottomSheet), findsNothing);
        expect(sent.where((o) => o.method == 'POST'), isEmpty);
      },
    );

    testWidgets(
      'a buyer that is not linked, or a plan refusal, shows the server words and posts no order',
      (t) async {
        final (session, sent) = recordedSession((o, b) {
          if (o.uri.path == '/api/suppliers/hub/linked-customer') {
            return (
              403,
              {
                'error': 'This business is not a connected buyer of yours',
                'code': 'NOT_LINKED',
              },
            );
          }
          return _handler(o, b);
        });
        await pumpScreen(t, SupplierDashboardScreen(session: session));
        await t.tap(find.text('Propose order'));
        await t.pumpAndSettle();
        await t.tap(find.text('Send order'));
        await t.pump();
        await t.pump(const Duration(milliseconds: 400));
        await t.tap(inSheet('Send order'));
        await t.pumpAndSettle();
        expect(
          find.text('This business is not a connected buyer of yours'),
          findsOneWidget,
        );
        expect(requestCount(sent, 'POST', '/api/supply-orders'), 0);
        expect(
          find.text('Request quantities from Shree Traders'),
          findsOneWidget,
        );

        await t.tap(_icon('Back'));
        await t.pumpAndSettle();
        final (planned, sent2) = recordedSession(
          (o, b) => o.uri.path == '/api/supply-orders'
              ? (
                  403,
                  {
                    'error': 'Upgrade your plan to use supplier orders',
                    'code': 'FEATURE_NOT_IN_PLAN',
                  },
                )
              : _handler(o, b),
        );
        await pumpScreen(t, SupplierDashboardScreen(session: planned));
        await t.tap(find.text('Propose order'));
        await t.pumpAndSettle();
        await t.tap(find.text('Send order'));
        await t.pump();
        await t.pump(const Duration(milliseconds: 400));
        await t.tap(inSheet('Send order'));
        await t.pumpAndSettle();
        expect(
          find.text('Upgrade your plan to use supplier orders'),
          findsOneWidget,
        );
        expect(requestCount(sent2, 'POST', '/api/supply-orders'), 1);
      },
    );

    testWidgets('Area performance and Thresholds open their screens', (
      t,
    ) async {
      final (session, sent) = recordedSession(_handler);
      await pumpScreen(t, SupplierDashboardScreen(session: session));
      await t.ensureVisible(find.text('Area performance'));
      await t.tap(find.text('Area performance'));
      await t.pumpAndSettle();
      expect(
        requestsOf(
          sent,
          'GET',
          '/api/suppliers/dashboard/analytics',
        ).single.uri.query,
        'period=90d',
      );
      expect(find.byType(SupplierAnalyticsScreen), findsOneWidget);
    });
  });

  group('area performance screen', () {
    testWidgets(
      'lists the areas with their signal, period and the privacy note',
      (t) async {
        final (session, sent) = recordedSession(_handler);
        await pumpScreen(t, SupplierAnalyticsScreen(session: session));
        expect(find.text('Gujarat'), findsWidgets);
        expect(find.text('Doing well'), findsWidgets);
        expect(find.textContaining('2026-08-14 to 2026-11-12'), findsOneWidget);
        _noIdentity(sent);
      },
    );

    testWidgets(
      'a period chip loads that period; Ranking by city and the pivot show their rows',
      (t) async {
        final (session, sent) = recordedSession(_handler);
        await pumpScreen(t, SupplierAnalyticsScreen(session: session));
        await t.tap(find.text('Last 30 days'));
        await t.pumpAndSettle();
        expect(
          requestsOf(
            sent,
            'GET',
            '/api/suppliers/dashboard/analytics',
          ).last.uri.query,
          'period=30d',
        );
        await t.tap(find.text('Ranking'));
        await t.pumpAndSettle();
        await t.tap(find.text('City'));
        await t.pumpAndSettle();
        expect(find.text('Surat, Gujarat'), findsOneWidget);
        expect(
          find.textContaining('2 shops are not shown at this level'),
          findsOneWidget,
        );
        await t.tap(find.text('Pivot'));
        await t.pumpAndSettle();
        expect(find.text('State by item'), findsOneWidget);
        expect(find.text('Basmati rice 25kg'), findsWidgets);
      },
    );

    testWidgets('empty, server error with Try again, and not in the plan', (
      t,
    ) async {
      final (few, _) = recordedSession(
        (o, b) => (200, {'success': true, 'states': [], 'shops_sharing': 0}),
      );
      await pumpScreen(t, SupplierAnalyticsScreen(session: few));
      expect(
        find.text(
          'No connected shops share their stock and sales with you yet.',
        ),
        findsOneWidget,
      );

      var fail = true;
      final (flaky, _) = recordedSession(
        (o, b) => fail ? (500, {'error': 'Boom'}) : _handler(o, b),
      );
      await pumpScreen(t, SupplierAnalyticsScreen(session: flaky));
      expect(find.text('Could not load area performance'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Gujarat'), findsWidgets);

      final (locked, _) = recordedSession(
        (o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}),
      );
      await pumpScreen(t, SupplierAnalyticsScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });

  group('thresholds screen', () {
    testWidgets(
      'lists the levels, marks a low one, and says setting new ones is retired',
      (t) async {
        final (session, sent) = recordedSession(_handler);
        await pumpScreen(t, SupplierThresholdsScreen(session: session));
        expect(find.text('Basmati rice 25kg'), findsOneWidget);
        expect(find.text('Low Stock Alert'), findsOneWidget);
        expect(find.text('10 / 4'), findsOneWidget);
        expect(
          find.textContaining(
            "Alerts now follow each customer's own reorder levels",
          ),
          findsOneWidget,
        );
        expect(
          requestsOf(sent, 'GET', '/api/suppliers/thresholds').single.uri.query,
          isEmpty,
        );
        _noIdentity(sent);
      },
    );

    testWidgets(
      'Delete asks naming the item and the customer, deletes once, then reloads',
      (t) async {
        final (session, sent) = recordedSession(_handler);
        await pumpScreen(t, SupplierThresholdsScreen(session: session));
        await t.tap(_icon('Delete threshold').first);
        await t.pumpAndSettle();
        expect(find.textContaining('Basmati rice 25kg'), findsWidgets);
        expect(requestCount(sent, 'DELETE', '/api/suppliers/thresholds'), 0);
        await t.tap(inSheet('Delete threshold'));
        await t.tap(inSheet('Delete threshold'), warnIfMissed: false);
        await t.pumpAndSettle();
        final deletes = requestsOf(
          sent,
          'DELETE',
          '/api/suppliers/thresholds',
        ).toList();
        expect(deletes.length, 1);
        expect(deletes.single.uri.query, 'id=th1');
        expect(requestCount(sent, 'GET', '/api/suppliers/thresholds'), 2);
        _noIdentity(sent);
      },
    );

    testWidgets(
      'a second tap while the ask sheet is open opens no second sheet',
      (t) async {
        final (session, sent) = recordedSession(_handler);
        await pumpScreen(t, SupplierThresholdsScreen(session: session));
        final trash = t.widget<KIconButton>(_icon('Delete threshold').first);
        trash.onTap();
        await t.pumpAndSettle();
        trash.onTap();
        await t.pumpAndSettle();
        expect(find.byType(BottomSheet), findsOneWidget);
        await t.tap(inSheet('Keep it'));
        await t.pumpAndSettle();
        expect(requestCount(sent, 'DELETE', '/api/suppliers/thresholds'), 0);
      },
    );

    testWidgets('keeping it sends nothing; a refused delete shows the reason', (
      t,
    ) async {
      final (session, sent) = recordedSession(
        (o, b) => o.method == 'DELETE'
            ? (403, {'error': 'You can only delete your own thresholds'})
            : _handler(o, b),
      );
      await pumpScreen(t, SupplierThresholdsScreen(session: session));
      await t.tap(_icon('Delete threshold').first);
      await t.pumpAndSettle();
      await t.tap(inSheet('Keep it'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'DELETE', '/api/suppliers/thresholds'), 0);
      await t.tap(_icon('Delete threshold').first);
      await t.pumpAndSettle();
      await t.tap(inSheet('Delete threshold'));
      await t.pumpAndSettle();
      expect(
        find.text('You can only delete your own thresholds'),
        findsOneWidget,
      );
    });

    testWidgets('empty, server error with Try again, and not in the plan', (
      t,
    ) async {
      final (empty, _) = recordedSession(
        (o, b) => (200, {'success': true, 'thresholds': []}),
      );
      await pumpScreen(t, SupplierThresholdsScreen(session: empty));
      expect(find.text('No thresholds set yet'), findsOneWidget);

      var fail = true;
      final (flaky, _) = recordedSession(
        (o, b) => fail ? (500, {'error': 'Boom'}) : _handler(o, b),
      );
      await pumpScreen(t, SupplierThresholdsScreen(session: flaky));
      expect(find.text('Could not load thresholds'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Om Stores'), findsOneWidget);

      final (locked, _) = recordedSession(
        (o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}),
      );
      await pumpScreen(t, SupplierThresholdsScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });
}
