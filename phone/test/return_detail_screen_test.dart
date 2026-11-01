import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/orders/return_detail_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/theme.dart';

class _ReturnApi extends KhatarioApi {
  _ReturnApi(this.ret) : super(Dio());

  Map<String, dynamic> ret;
  final patches = <Map<String, dynamic>>[];

  Map<String, dynamic> get _payload => {'return': ret, 'refundable': 1180, 'payment_accounts': const []};

  @override
  Future<Map<String, dynamic>> getJson(String path) async => _payload;

  @override
  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async {
    patches.add(body);
    return _payload;
  }
}

Map<String, dynamic> _return(Map<String, dynamic> over) => {
      'id': 'r1',
      'return_number': 'RET-0001',
      'status': 'requested',
      'customer_name': 'Asha Rao',
      'invoice_number': 'INV-88',
      'reason': 'damaged',
      'initiated_by': 'customer',
      'lines': [
        {'id': 'l1', 'item_name': 'Cotton shirt', 'quantity': 2, 'unit_price': 500, 'tax_rate': 5},
      ],
      'method': null,
      'shiprocket_connected': true,
      'default_instructions': 'Send it to 12 MG Road',
      'original_refund': {'allowed': false, 'max': 0, 'reason': null},
      'pickup': {'address': '12 Park Street', 'pincode': '411001', 'phone': '98765 43210', 'weight_kg': 0.5},
      'events': const [],
      ...over,
    };

Future<void> _open(WidgetTester tester, _ReturnApi api) async {
  tester.view.physicalSize = const Size(390, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: khatarioTheme(),
    home: ReturnDetailScreen(
      session: AppSession(api, {'user': {'id': 'u'}, 'business': {'id': 'b'}}),
      id: 'r1',
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('approving opens the way-back sheet with courier pickup preselected', (tester) async {
    final api = _ReturnApi(_return({}));
    await _open(tester, api);
    await tester.tap(find.text('Approve'));
    await tester.pumpAndSettle();
    expect(find.text('Courier pickup'), findsOneWidget);
    expect(find.text('Customer sends it'), findsOneWidget);
    expect(find.text('No need to send it back'), findsOneWidget);
    await tester.tap(find.text('Approve').last);
    await tester.pumpAndSettle();
    expect(api.patches.single, {
      'action': 'approve',
      'method': 'courier_pickup',
      'pickup': {'address': '12 Park Street', 'pincode': '411001', 'phone': '98765 43210', 'weight_kg': '0.5'},
    });
  });

  testWidgets('Shiprocket not connected hides courier pickup and says how to connect', (tester) async {
    final api = _ReturnApi(_return({'shiprocket_connected': false}));
    await _open(tester, api);
    await tester.tap(find.text('Approve'));
    await tester.pumpAndSettle();
    expect(find.text('Courier pickup'), findsNothing);
    expect(find.text('Connect Shiprocket to book pickups'), findsOneWidget);
    await tester.tap(find.text('Approve').last);
    await tester.pumpAndSettle();
    expect(api.patches.single['method'], 'customer_sends');
    expect(api.patches.single['instructions'], 'Send it to 12 MG Road');
  });

  testWidgets('a live pickup shows its status and AWB, lets you cancel it, and hides "send it instead"', (tester) async {
    final api = _ReturnApi(_return({
      'status': 'approved',
      'method': 'courier_pickup',
      'pickup_status': 'booked',
      'carrier_order_id': 'c1',
      'awb': '1490123',
      'courier_name': 'Delhivery',
      'tracking_url': 'https://track.example/1490123',
    }));
    await _open(tester, api);
    expect(find.text('Pickup booked'), findsOneWidget);
    expect(find.text('Delhivery · AWB 1490123'), findsOneWidget);
    expect(find.text('Track'), findsOneWidget);
    expect(find.text('Customer will send it instead'), findsNothing);
    expect(find.text('Book again'), findsNothing);
    await tester.tap(find.text('Cancel pickup'));
    await tester.pumpAndSettle();
    expect(api.patches.single, {'action': 'cancel_pickup'});
  });

  testWidgets('a failed booking shows the error with the details open, and books again with the corrections', (tester) async {
    final api = _ReturnApi(_return({
      'status': 'approved',
      'method': 'courier_pickup',
      'pickup_status': null,
      'pickup_error': 'Pincode not serviceable',
    }));
    await _open(tester, api);
    expect(find.text('Pincode not serviceable'), findsOneWidget);
    expect(find.text('Not booked yet'), findsOneWidget);
    expect(find.text('Customer will send it instead'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, '411001'), '560001');
    await tester.tap(find.text('Book again'));
    await tester.pumpAndSettle();
    expect(api.patches.single['action'], 'book_pickup');
    expect(api.patches.single['pickup']['pincode'], '560001');
  });

  testWidgets('back to the original payment is first, preselected, and shows the most it can take back', (tester) async {
    final api = _ReturnApi(_return({
      'status': 'received',
      'method': 'customer_sends',
      'original_refund': {'allowed': true, 'max': 1000, 'reason': null},
    }));
    await _open(tester, api);
    expect(find.text('Back to original payment'), findsOneWidget);
    expect(find.textContaining('Up to ₹1,000'), findsOneWidget);
    expect(find.widgetWithText(TextField, '1000'), findsOneWidget);
    await tester.tap(find.text('Refund to original payment'));
    await tester.pumpAndSettle();
    expect(api.patches.single, {
      'action': 'settle',
      'refund': {'method': 'original_payment', 'amount': 1000},
    });
  });

  testWidgets('a refund on its way shows Check now', (tester) async {
    final api = _ReturnApi(_return({
      'status': 'received',
      'gateway_refund': {'status': 'pending', 'amount': 1000, 'error': null},
    }));
    await _open(tester, api);
    expect(find.text('Refund on its way (₹1,000)'), findsOneWidget);
    expect(find.text('Cash'), findsNothing);
    await tester.tap(find.text('Check now'));
    await tester.pumpAndSettle();
    expect(api.patches.single, {'action': 'check_refund'});
  });

  testWidgets('a failed refund shows its error and the other methods', (tester) async {
    final api = _ReturnApi(_return({
      'status': 'received',
      'gateway_refund': {'status': 'failed', 'amount': 1000, 'error': 'Gateway said no'},
    }));
    await _open(tester, api);
    expect(find.textContaining('Gateway said no'), findsOneWidget);
    expect(find.text('Cash'), findsOneWidget);
  });

  testWidgets('the timeline lists what happened', (tester) async {
    final api = _ReturnApi(_return({
      'status': 'approved',
      'method': 'customer_sends',
      'events': [
        {'kind': 'requested', 'note': null, 'created_at': '2026-11-01T05:00:00Z'},
        {'kind': 'approved', 'note': 'Customer sends it', 'created_at': '2026-11-01T06:00:00Z'},
      ],
    }));
    await _open(tester, api);
    await tester.scrollUntilVisible(find.text('Return requested'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('Return requested'), findsOneWidget);
    expect(find.text('Approved'), findsOneWidget);
  });
}
