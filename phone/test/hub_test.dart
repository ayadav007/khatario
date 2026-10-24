import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/hub/hub_common.dart';
import 'package:khatario_phone/screens/hub/incoming_bills_screen.dart';
import 'package:khatario_phone/screens/hub/supply_orders_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/theme.dart';
import 'package:khatario_phone/ui/kit.dart';

/// Supplier Hub on the phone: receiving a connected supplier's bill and confirming an order.
class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());

  final posts = <Map<String, dynamic>>[];
  final patches = <Map<String, dynamic>>[];
  bool received = false;

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    if (path.startsWith('/api/purchases/incoming-bills/bill1')) {
      return {
        'bill': {
          'invoice_id': 'bill1',
          'invoice_number': 'B-77',
          'invoice_date': '2026-10-17',
          'supplier_name': 'Sharma Traders',
          'supplier_id': 's1',
          'tax_total': 0,
          'grand_total': 5940,
        },
        'lines': [
          {
            'invoice_item_id': 'l1',
            'item_name': 'PARLE G 50GM CTN',
            'quantity': 1,
            'unit': 'CTN',
            'unit_price': 1440,
            'line_total': 1440,
            'is_service': false,
            'match': {'item_id': 'a1', 'item_name': 'Parle-G 50g', 'unit': 'PCS', 'factor': 144, 'quantity': 144, 'rate': 10},
            'suggestions': [],
          },
          {
            'invoice_item_id': 'l2',
            'item_name': 'Kurti Floral Blue M',
            'quantity': 10,
            'unit': 'PCS',
            'unit_price': 450,
            'line_total': 4500,
            'is_service': false,
            'match': null,
            'suggestions': [],
          },
        ],
        'purchase': received ? {'id': 'p1', 'bill_number': 'B-77', 'receipt_status': 'received_with_issues'} : null,
        'receipt_lines': received
            ? [
                {'buyer_item_id': 'a1', 'item_name': 'Parle-G 50g', 'billed_qty': 144, 'short_qty': 4, 'damaged_qty': 0, 'note': null},
              ]
            : [],
        'purchase_returns': [],
      };
    }
    if (path.startsWith('/api/supply-orders/o1')) {
      return {
        'role': 'buyer',
        'order': {'id': 'o1', 'status': 'proposed', 'origin': 'suggested', 'supplier_name': 'Sharma Traders', 'buyer_name': 'Me'},
        'lines': [
          {'id': 'ol1', 'item_name': 'Good Day 75g', 'qty': 3, 'confirmed_qty': null, 'factor': 12, 'buyer_item_name': 'Good Day 75g', 'buyer_unit': 'PCS', 'buyer_current_stock': 5},
        ],
      };
    }
    return {};
  }

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    posts.add({'path': path, ...body});
    if (path.endsWith('/create-item')) {
      return {'item': {'id': 'new1', 'name': body['name'], 'unit': 'PCS'}, 'factor': 1};
    }
    if (path.endsWith('/convert-to-purchase')) {
      received = true;
      return {'purchase': {'id': 'p1', 'bill_number': 'B-77'}};
    }
    return {};
  }

  @override
  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async {
    patches.add({'path': path, ...body});
    return {'ok': true, 'status': 'confirmed'};
  }
}

AppSession _session(KhatarioApi api) => AppSession(api, {
      'user': {'id': 'u', 'name': 'Shalini'},
      'business': {'id': 'b', 'name': 'Shop'},
    });

Future<void> _pump(WidgetTester tester, Widget home) async {
  tester.view.physicalSize = const Size(420, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: khatarioTheme(), debugShowCheckedModeBanner: false, home: home));
  await tester.pumpAndSettle();
}

void main() {
  test('quantities and order statuses read plainly', () {
    expect(qtyText(3), '3');
    expect(qtyText(2.5), '2.5');
    expect(qtyText(0.125), '0.125');
    expect(supplyOrderTone('proposed'), (KTone.due, 'Waiting for buyer'));
    expect(supplyOrderTone('invoiced').$2, 'Billed');
  });

  testWidgets('receive a bill: create the new item, record a shortfall, then the purchase', (tester) async {
    final api = _FakeApi();
    await _pump(tester, ReceiveBillScreen(session: _session(api), invoiceId: 'bill1'));

    // The carton line is already matched and converted; the new design is not.
    expect(find.text('Adds 144 PCS of Parle-G 50g'), findsOneWidget);
    expect(find.text('Match 1 item(s) first'), findsOneWidget);

    await tester.tap(find.text('Create new item'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(KButton, 'Create item'));
    await tester.pumpAndSettle();
    expect(api.posts.last['path'], '/api/purchases/incoming-bills/bill1/create-item');
    expect(api.posts.last['invoice_item_id'], 'l2');
    expect(find.text('Adds 10 PCS of Kurti Floral Blue M'), findsOneWidget);

    // 4 packs short on the carton line.
    await tester.enterText(find.widgetWithText(TextField, 'Short').first, '4');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Receive and create purchase'));
    await tester.pumpAndSettle();

    final convert = api.posts.firstWhere((p) => p['path'] == '/api/invoices/bill1/convert-to-purchase');
    expect(convert['item_map'], {'l2': {'item_id': 'new1', 'factor': 1.0}});
    expect((convert['received'] as Map)['l1'], containsPair('short_qty', 4.0));
    // After receiving, the screen offers the debit note for the shortfall.
    expect(find.text('Record debit note for these'), findsOneWidget);
  });

  testWidgets('confirm a proposed order with a changed quantity', (tester) async {
    final api = _FakeApi();
    await _pump(tester, SupplyOrderScreen(session: _session(api), orderId: 'o1'));

    expect(find.text('Waiting for buyer'), findsOneWidget);
    expect(find.text('= 36 PCS'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, '5');
    await tester.pumpAndSettle();
    expect(find.text('= 60 PCS'), findsOneWidget);

    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();
    expect(api.patches.first['path'], '/api/supply-orders/o1');
    expect(api.patches.first['action'], 'confirm');
    expect((api.patches.first['lines'] as List).first, containsPair('qty', 5.0));
  });
}
