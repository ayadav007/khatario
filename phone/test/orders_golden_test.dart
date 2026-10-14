import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/orders/order_detail_screen.dart';
import 'package:khatario_phone/screens/orders/orders_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/theme.dart';

class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());

  final posts = <Map<String, dynamic>>[];

  static final _order = {
    'source_type': 'store_order',
    'source_id': 'o1',
    'channel': 'online_store',
    'order_number': 'ST-104',
    'invoice_id': 'i1',
    'invoice_number': 'INV-88',
    'customer_name': 'Asha Rao',
    'customer_phone': '98765 43210',
    'amount': 1180,
    'payment_status': 'cod',
    'delivery_status': 'confirmed',
    'created_at': DateTime.now().subtract(const Duration(hours: 5)).toIso8601String(),
  };

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    if (path.startsWith('/api/orders/store_order/o1')) {
      return {
        'order': _order,
        'lines': [
          {'line_id': 'l1', 'name': 'Cotton shirt', 'quantity': 2, 'amount': 1000},
          {'line_id': 'l2', 'name': 'Cap', 'quantity': 1, 'amount': 180},
        ],
        'ship_to': {'address': '12 MG Road, Pune', 'pincode': '411001'},
        'fulfilments': [
          {
            'id': 'f1',
            'seq': 1,
            'status': 'confirmed',
            'method': null,
            'cod_amount': 1180,
            'cod_collected_at': null,
            'packages': 1,
            'items': [
              {'line_id': 'l1', 'name': 'Cotton shirt', 'quantity': 2},
              {'line_id': 'l2', 'name': 'Cap', 'quantity': 1},
            ],
            'events': [
              {'status': 'confirmed', 'note': 'Order confirmed', 'created_at': DateTime.now().subtract(const Duration(hours: 4)).toIso8601String()},
            ],
          },
        ],
      };
    }
    if (path.startsWith('/api/orders')) {
      return {
        'orders': [
          _order,
          {
            ..._order,
            'source_id': 'o2',
            'order_number': 'WA-17',
            'channel': 'whatsapp',
            'customer_name': 'Vikram Shah',
            'amount': 640,
            'payment_status': 'paid',
            'delivery_status': 'delivery_failed',
          },
        ],
        'total': 2,
        'needs': {'to_confirm': 0, 'payment_pending': 1, 'to_pack': 3, 'to_dispatch': 1, 'delivery_failed': 1, 'stale': 0, 'in_transit_late': 0},
      };
    }
    if (path.startsWith('/api/returns')) return {'returns': [], 'counts': {'requested': 1}};
    return {};
  }

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    posts.add({'path': path, ...body});
    return {};
  }
}

Future<void> _loadFonts() async {
  final inter = FontLoader('Inter');
  for (final w in [400, 500, 600, 700]) {
    inter.addFont(rootBundle.load('fonts/Inter-$w.ttf'));
  }
  await inter.load();
  final lucide = FontLoader('packages/lucide_icons_flutter/Lucide');
  lucide.addFont(rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'));
  await lucide.load();
}

AppSession _session(KhatarioApi api) => AppSession(api, {
      'user': {'id': 'u', 'name': 'Shalini'},
      'business': {'id': 'b', 'name': 'Shop'},
    });

void main() {
  setUpAll(_loadFonts);

  testWidgets('orders list: needs-action counts, rows and the returns badge', (tester) async {
    tester.view.physicalSize = const Size(390, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      theme: khatarioTheme(),
      debugShowCheckedModeBanner: false,
      home: OrdersScreen(session: _session(_FakeApi())),
    ));
    await tester.pumpAndSettle();

    expect(find.text('To pack'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    expect(find.text('ST-104 · Asha Rao'), findsOneWidget);
    expect(find.text('Delivery failed'), findsWidgets);
    expect(find.text('Returns · 1'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/95-orders-list.png'));
  });

  testWidgets('order detail: parcel items, ship-to and "Mark packed" as the next step', (tester) async {
    tester.view.physicalSize = const Size(390, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = _FakeApi();
    await tester.pumpWidget(MaterialApp(
      theme: khatarioTheme(),
      debugShowCheckedModeBanner: false,
      home: OrderDetailScreen(session: _session(api), source: 'store_order', id: 'o1'),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Cotton shirt'), findsOneWidget);
    expect(find.text('12 MG Road, Pune'), findsOneWidget);
    expect(find.text('Mark packed'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/96-order-detail.png'));

    await tester.tap(find.text('Mark packed'));
    await tester.pumpAndSettle();
    expect(api.posts.last, containsPair('to', 'packed'));
    expect(api.posts.last, containsPair('fulfilment_id', 'f1'));
  });
}
