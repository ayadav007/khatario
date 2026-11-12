import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/invoices/invoice_detail_screen.dart';
import 'package:khatario_phone/screens/payments/payment_in_logic.dart';
import 'package:khatario_phone/screens/payments/payment_in_screen.dart';
import 'package:khatario_phone/screens/purchases/bill_form_screen.dart';
import 'package:khatario_phone/screens/sales/sales_order_logic.dart';
import 'package:khatario_phone/screens/sales/sales_orders_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/kit.dart';

Map<String, dynamic> _row(String id, String number, String status, {String? converted, int invoices = 0, String paid = '0', String remaining = '1180.50'}) => {
      'id': id,
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'order_number': number,
      'order_date': '2026-11-01',
      'expected_delivery_date': null,
      'status': status,
      'grand_total': '1180.50',
      'converted_invoice_id': converted,
      'total_paid': paid,
      'payment_remaining': remaining,
      'linked_invoice_count': invoices,
      'latest_invoice_id': invoices > 0 ? converted : null,
      'latest_invoice_number': invoices > 0 ? 'INV-5' : null,
    };

Map<String, dynamic> _order(String id, String number, String status, {String? converted, bool editable = true, num fulfilled = 0, num additional = 0}) => {
      'salesOrder': {
        'id': id,
        'customer_id': 'c1',
        'customer_name': 'Asha',
        'order_number': number,
        'order_date': '2026-11-01',
        'expected_delivery_date': '2026-11-09',
        'status': status,
        'converted_invoice_id': converted,
        'editable': editable,
        'subtotal': '1000.00',
        'discount_total': '0',
        'tax_total': '180.00',
        'round_off': '0',
        'additional_charges': '$additional',
        'grand_total': '1180.00',
        'notes': 'Deliver Monday',
        'terms': 'Net 7',
        'billing_address': '12 MG Road',
        'items': [
          {
            'id': 'l1',
            'item_id': 'it1',
            'item_name': 'Widget',
            'qty': '2',
            'fulfilled_qty': '$fulfilled',
            'unit': 'PCS',
            'unit_price': '500',
            'discount_percent': '0',
            'tax_rate': '18',
            'line_total': '1180.00',
          },
        ],
      },
    };

Map<String, dynamic> _invoice(String id, String number) => {
      'invoice': {
        'id': id,
        'invoice_number': number,
        'document_type': 'tax_invoice',
        'status': 'final',
        'customer_id': 'c1',
        'customer_name': 'Asha',
        'invoice_date': '2026-11-01',
        'grand_total': 1180,
        'balance_amount': 1180,
        'paid_amount': 0,
        'items': [
          {'item_name': 'Widget', 'quantity': 2, 'unit_price': 500, 'line_total': 1180, 'tax_amount': 180},
        ],
      },
    };

/// Replies by route. [orders] is read at request time so a test can change what the server says.
class _Server {
  _Server({List<Map<String, dynamic>>? rows, Map<String, dynamic>? order, this.summary, this.convert, this.listStatus, this.orderGet, this.putStatus = 200})
      : rows = rows ?? [],
        order = order ?? _order('so1', 'SO-1', 'confirmed');

  List<Map<String, dynamic>> rows;
  Map<String, dynamic> order;
  Map<String, dynamic>? summary;
  Future<(int, Object?)> Function()? convert;
  (int, Object?)? listStatus;
  (int, Object?)? orderGet;
  int putStatus;
  final sent = <RequestOptions>[];
  final bodies = <String, Object?>{};

  AppSession build() {
    final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
      sent.add(o);
      if (o.data != null) bodies['${o.method} ${o.uri.path}'] = o.data;
      (int, Object?) r;
      final path = o.uri.path;
      if (path == '/api/sales-orders' && o.method == 'GET') {
        r = listStatus ?? (200, {'salesOrders': rows});
      } else if (path == '/api/sales-orders/so1' && o.method == 'GET') {
        r = orderGet ?? (200, order);
      } else if (path == '/api/sales-orders/so1' && o.method == 'PUT') {
        r = (putStatus, putStatus == 200 ? order : {'error': 'This sales order can no longer be edited', 'code': 'SALES_ORDER_NOT_EDITABLE'});
      } else if (path == '/api/sales-orders/so1/payment-summary') {
        r = summary == null ? (404, {'error': 'Sales order not found'}) : (200, summary);
      } else if (path == '/api/sales-orders/so1/convert') {
        r = await (convert ??
            () async => (201, {'invoice': {'id': 'i9', 'invoice_number': 'INV-9'}, 'sales_order_id': 'so1', 'sales_order_status': 'fulfilled', 'partial': false}))();
      } else if (path == '/api/invoices/i9') {
        r = (200, _invoice('i9', 'INV-9'));
      } else if (path == '/api/invoices/i5') {
        r = (200, _invoice('i5', 'INV-5'));
      } else if (path == '/api/customers') {
        r = (200, {'customers': [{'id': 'c1', 'name': 'Asha', 'state_code': '27'}]});
      } else if (path == '/api/items') {
        r = (200, {'items': [{'id': 'it1', 'name': 'Widget', 'unit': 'PCS', 'tax_rate': 18, 'sale_price': 500}]});
      } else {
        r = (200, <String, dynamic>{});
      }
      h.resolve(Response(requestOptions: o, statusCode: r.$1, data: r.$2));
    }));
    return AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b', 'state_code': '27'}});
  }

  int get posts => sent.where((o) => o.method == 'POST').length;
  int get listLoads => sent.where((o) => o.uri.path == '/api/sales-orders' && o.method == 'GET').length;
}

/// A tall screen so every card of a long page is built.
void _tall(WidgetTester t) {
  t.view.physicalSize = const Size(800, 2400);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.resetPhysicalSize);
  addTearDown(t.view.resetDevicePixelRatio);
}

Future<void> _pump(WidgetTester t, AppSession s) async {
  _tall(t);
  await t.pumpWidget(MaterialApp(home: SalesOrdersScreen(session: s)));
  await t.pumpAndSettle();
}

const _summary = {
  'grand_total': 1180,
  'total_paid': 500,
  'remaining': 680,
  'payment_status': 'partial',
  'order_status': 'confirmed',
  'order_number': 'SO-1',
  'payment_amount_eps': 0.01,
};

void main() {
  group('sales order logic', () {
    test('the website chips, in order', () {
      expect(kSalesOrderFilters.map((f) => f.$2).toList(), ['All', 'Draft', 'Open', 'Partial Open', 'Completed', 'Cancelled']);
      expect(kSalesOrderFilters.map((f) => f.$1).toList(), ['', 'draft', 'confirmed', 'partially_fulfilled', 'fulfilled', 'cancelled']);
    });

    test('order statuses read like the website badges', () {
      expect(statusTone('confirmed').$2, 'Open');
      expect(statusTone('partially_fulfilled').$2, 'Partial open');
      expect(statusTone('fulfilled').$2, 'Completed');
      expect(statusTone('cancelled').$2, 'Cancelled');
    });

    test('Convert is offered until fulfilled, cancelled or rejected (the website rule)', () {
      for (final s in ['draft', 'confirmed', 'partially_fulfilled']) {
        expect(canConvertSalesOrder({'status': s}), isTrue, reason: s);
      }
      for (final s in ['fulfilled', 'cancelled', 'rejected', 'FULFILLED']) {
        expect(canConvertSalesOrder({'status': s}), isFalse, reason: s);
      }
    });

    test('Edit needs draft or confirmed, no invoice, and the server not saying editable false', () {
      expect(canEditSalesOrder({'status': 'draft'}), isTrue);
      expect(canEditSalesOrder({'status': 'confirmed', 'editable': true}), isTrue);
      expect(canEditSalesOrder({'status': 'confirmed', 'editable': false}), isFalse);
      expect(canEditSalesOrder({'status': 'confirmed', 'converted_invoice_id': 'i1'}), isFalse);
      expect(canEditSalesOrder({'status': 'partially_fulfilled'}), isFalse);
      expect(canEditSalesOrder({'status': 'fulfilled'}), isFalse);
    });

    test('row actions: convert only while open, open invoice when one exists, share always', () {
      expect(salesOrderRowActions(_row('a', 'SO-1', 'confirmed')), [SalesOrderAction.convert, SalesOrderAction.share]);
      expect(salesOrderRowActions(_row('a', 'SO-1', 'fulfilled', converted: 'i5', invoices: 1)), [SalesOrderAction.openInvoice, SalesOrderAction.share]);
      expect(salesOrderRowActions(_row('a', 'SO-1', 'partially_fulfilled', converted: 'i5', invoices: 2)),
          [SalesOrderAction.convert, SalesOrderAction.openInvoice, SalesOrderAction.share]);
      expect(linkedInvoiceIdOf({'converted_invoice_id': 'i1'}), 'i1');
      expect(linkedInvoiceIdOf({'linked_invoice_count': 2, 'latest_invoice_id': 'i7', 'converted_invoice_id': 'i1'}), 'i7');
      expect(linkedInvoiceIdOf({}), isNull);
    });

    test('payment summary rows are the server figures, formatted', () {
      expect(salesOrderPaymentRows(_summary), [
        ('Payment', 'Part paid'),
        ('Order total', '₹1,180.00'),
        ('Paid', '₹500.00'),
        ('Remaining', '₹680.00'),
      ]);
      expect(salesOrderPaymentRows(null), isEmpty);
      expect(salesOrderPaymentRows({'grand_total': 100, 'total_paid': 0, 'remaining': 100}), [
        ('Order total', '₹100.00'),
        ('Paid', '₹0.00'),
        ('Remaining', '₹100.00'),
      ]);
    });

    test('a line says how much of it is invoiced, from the server quantities', () {
      expect(salesOrderLineSubtitle({'qty': '2', 'fulfilled_qty': '1', 'unit': 'PCS', 'unit_price': '500', 'tax_rate': '18'}), contains('Invoiced 1 of 2'));
      expect(salesOrderLineSubtitle({'qty': '2', 'fulfilled_qty': '0', 'unit_price': '500'}), isNot(contains('Invoiced')));
    });

    test('the phone refuses to edit an order it could not total (discount, extra charges, round off)', () {
      expect(salesOrderPhoneEditBlock(_order('a', 'SO-1', 'confirmed')['salesOrder'] as Map<String, dynamic>), isNull);
      expect(salesOrderPhoneEditBlock(_order('a', 'SO-1', 'confirmed', additional: 50)['salesOrder'] as Map<String, dynamic>), isNotNull);
      expect(salesOrderPhoneEditBlock({'round_off': '0.4', 'items': []}), isNotNull);
      expect(salesOrderPhoneEditBlock({'discount_total': '10', 'items': []}), isNotNull);
    });
  });

  group('sales orders list', () {
    testWidgets('shows the website chips and sends a chip as status, never a business id', (t) async {
      final srv = _Server(rows: [_row('so1', 'SO-1', 'confirmed'), _row('so2', 'SO-2', 'fulfilled', converted: 'i5', invoices: 1)]);
      await _pump(t, srv.build());
      expect(find.text('SO-1'), findsOneWidget);
      for (final c in ['All', 'Draft', 'Open', 'Partial Open', 'Completed', 'Cancelled']) {
        expect(find.text(c), findsWidgets, reason: c);
      }
      await t.tap(find.widgetWithText(KChip, 'Partial Open'));
      await t.pumpAndSettle();
      expect(srv.sent.last.uri.queryParameters['status'], 'partially_fulfilled');
      expect(srv.sent.every((o) => !o.uri.queryParameters.containsKey('business_id')), isTrue);
    });

    testWidgets('empty list says so, and New sales order stays', (t) async {
      await _pump(t, _Server(rows: []).build());
      expect(find.text('No sales orders yet'), findsOneWidget);
      expect(find.text('New sales order'), findsOneWidget);
    });

    testWidgets('a server error offers Try again', (t) async {
      final srv = _Server(listStatus: (500, {'error': 'boom'}));
      await _pump(t, srv.build());
      expect(find.text('Try again'), findsOneWidget);
      srv.listStatus = null;
      srv.rows = [_row('so1', 'SO-1', 'confirmed')];
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('SO-1'), findsOneWidget);
    });

    testWidgets('a plan without sales orders says so', (t) async {
      await _pump(t, _Server(listStatus: (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'})).build());
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('a row opens the detail with lines and the payment summary', (t) async {
      final srv = _Server(rows: [_row('so1', 'SO-1', 'confirmed')], summary: _summary);
      await _pump(t, srv.build());
      await t.tap(find.text('SO-1'));
      await t.pumpAndSettle();
      expect(srv.sent.any((o) => o.uri.path == '/api/sales-orders/so1'), isTrue);
      expect(srv.sent.any((o) => o.uri.path == '/api/sales-orders/so1/payment-summary'), isTrue);
      expect(find.text('Widget'), findsOneWidget);
      expect(find.text('Order total'), findsOneWidget);
      expect(find.text('₹500.00'), findsWidgets);
      expect(find.text('Remaining'), findsOneWidget);
      expect(find.text('₹680.00'), findsOneWidget);
      expect(find.text('Convert to invoice'), findsOneWidget);
    });

    testWidgets('a failing payment summary leaves the order on screen', (t) async {
      final srv = _Server(rows: [_row('so1', 'SO-1', 'confirmed')]);
      await _pump(t, srv.build());
      await t.tap(find.text('SO-1'));
      await t.pumpAndSettle();
      expect(find.text('Widget'), findsOneWidget);
      expect(find.text('Remaining'), findsNothing);
    });
  });

  group('convert', () {
    testWidgets('asks first, posts once, opens the new invoice by the id in the reply', (t) async {
      final gate = Completer<(int, Object?)>();
      final srv = _Server(rows: [_row('so1', 'SO-1', 'confirmed')], convert: () => gate.future);
      await _pump(t, srv.build());
      await t.longPress(find.text('SO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Convert to invoice'));
      await t.pumpAndSettle();
      expect(srv.posts, 0);
      expect(find.textContaining('SO-1'), findsWidgets);
      await t.tap(find.text('Convert'));
      await t.tap(find.text('Convert'), warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 100));
      expect(srv.posts, 1);
      final post = srv.sent.firstWhere((o) => o.method == 'POST');
      expect(post.uri.path, '/api/sales-orders/so1/convert');
      expect(post.data, isA<Map>());
      expect((post.data as Map).containsKey('business_id'), isFalse);
      gate.complete((201, {'invoice': {'id': 'i9', 'invoice_number': 'INV-9'}, 'sales_order_status': 'fulfilled', 'partial': false}));
      await t.pumpAndSettle();
      expect(srv.posts, 1);
      expect(srv.sent.any((o) => o.uri.path == '/api/invoices/i9'), isTrue);
      expect(find.byType(InvoiceDetailScreen), findsOneWidget);
    });

    testWidgets('the list reloads after the new invoice closes, and the row no longer offers Convert', (t) async {
      final srv = _Server(rows: [_row('so1', 'SO-1', 'confirmed')]);
      srv.convert = () async {
        srv.rows = [_row('so1', 'SO-1', 'fulfilled', converted: 'i9', invoices: 1)];
        return (201, {'invoice': {'id': 'i9', 'invoice_number': 'INV-9'}, 'sales_order_status': 'fulfilled', 'partial': false});
      };
      await _pump(t, srv.build());
      await t.longPress(find.text('SO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Convert to invoice'));
      await t.pumpAndSettle();
      await t.tap(find.text('Convert'));
      await t.pumpAndSettle();
      Navigator.of(t.element(find.byType(InvoiceDetailScreen))).pop();
      await t.pumpAndSettle();
      expect(srv.listLoads, greaterThanOrEqualTo(2));
      await t.longPress(find.text('SO-1'));
      await t.pumpAndSettle();
      expect(find.text('Convert to invoice'), findsNothing);
      expect(find.text('Open invoice'), findsOneWidget);
    });

    testWidgets('a partial result stays on the order and reloads it', (t) async {
      final srv = _Server(rows: [_row('so1', 'SO-1', 'confirmed')], summary: _summary);
      srv.convert = () async {
        srv.order = _order('so1', 'SO-1', 'partially_fulfilled', converted: 'i9', fulfilled: 1);
        return (201, {'invoice': {'id': 'i9', 'invoice_number': 'INV-9'}, 'sales_order_status': 'partially_fulfilled', 'partial': true});
      };
      await _pump(t, srv.build());
      await t.tap(find.text('SO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Convert to invoice'));
      // The bottom button spins while the sheet is open, so settle by time.
      await t.pump();
      await t.pump(const Duration(seconds: 1));
      await t.tap(find.text('Convert'));
      await t.pumpAndSettle();
      expect(find.byType(InvoiceDetailScreen), findsNothing);
      expect(find.textContaining('Invoiced 1 of 2'), findsOneWidget);
    });

    testWidgets('a fully invoiced order hides Convert and offers Open invoice', (t) async {
      final srv = _Server(
        rows: [_row('so1', 'SO-1', 'fulfilled', converted: 'i5', invoices: 1)],
        order: _order('so1', 'SO-1', 'fulfilled', converted: 'i5', editable: false, fulfilled: 2),
      );
      await _pump(t, srv.build());
      await t.tap(find.text('SO-1'));
      await t.pumpAndSettle();
      expect(find.text('Convert to invoice'), findsNothing);
      expect(find.text('Open invoice'), findsOneWidget);
      await t.tap(find.text('Open invoice'));
      await t.pumpAndSettle();
      expect(srv.sent.any((o) => o.uri.path == '/api/invoices/i5'), isTrue);
    });

    testWidgets('fix3: a convert reply without an invoice id says to open the order, in the neutral tone', (t) async {
      final srv = _Server(rows: [_row('so1', 'SO-1', 'confirmed')], convert: () async => (201, {'sales_order_status': 'fulfilled', 'partial': false}));
      await _pump(t, srv.build());
      await t.longPress(find.text('SO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Convert to invoice'));
      await t.pumpAndSettle();
      await t.tap(find.text('Convert'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 300));
      expect(find.text('Converted. Open the order to see the new invoice.'), findsOneWidget);
      await t.pumpAndSettle();
    });

    testWidgets('a refused convert shows the server message and leaves the screen', (t) async {
      final srv = _Server(
        rows: [_row('so1', 'SO-1', 'confirmed')],
        convert: () async => (400, {'error': 'Warehouse mode is enabled but no default warehouse is configured for this branch.', 'code': 'WAREHOUSE_REQUIRED'}),
      );
      await _pump(t, srv.build());
      await t.longPress(find.text('SO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Convert to invoice'));
      await t.pumpAndSettle();
      await t.tap(find.text('Convert'));
      await t.pumpAndSettle();
      expect(find.textContaining('Warehouse mode is enabled'), findsOneWidget);
      expect(find.byType(InvoiceDetailScreen), findsNothing);
      expect(find.text('SO-1'), findsOneWidget);
      expect(srv.listLoads, 1);
    });

    testWidgets('nothing left to invoice refreshes the order so Convert goes away', (t) async {
      final srv = _Server(
        rows: [_row('so1', 'SO-1', 'confirmed')],
        convert: () async => (400, {'error': 'Nothing left to invoice on this sales order', 'code': 'NOTHING_REMAINING'}),
      );
      await _pump(t, srv.build());
      srv.rows = [_row('so1', 'SO-1', 'fulfilled', converted: 'i5', invoices: 1)];
      await t.longPress(find.text('SO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Convert to invoice'));
      await t.pumpAndSettle();
      await t.tap(find.text('Convert'));
      await t.pumpAndSettle();
      expect(find.textContaining('Nothing left to invoice'), findsOneWidget);
      expect(srv.listLoads, 2);
    });
  });

  group('edit', () {
    testWidgets('Edit opens the order in the bill form and saves with PUT, keeping what the form cannot show', (t) async {
      final srv = _Server(rows: [_row('so1', 'SO-1', 'confirmed')], summary: _summary);
      await _pump(t, srv.build());
      await t.tap(find.text('SO-1'));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Edit'));
      await t.pumpAndSettle();
      expect(find.byType(BillFormScreen), findsOneWidget);
      expect(find.text('Edit sales order'), findsOneWidget);
      expect(find.text('SO-1'), findsWidgets);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      final body = srv.bodies['PUT /api/sales-orders/so1'] as Map;
      expect(body['customer_id'], 'c1');
      expect(body['order_number'], 'SO-1');
      expect(body['order_date'], '2026-11-01');
      expect(body['status'], 'confirmed');
      expect(body['expected_delivery_date'], startsWith('2026-11-09'));
      expect(body['billing_address'], '12 MG Road');
      expect(body['terms'], 'Net 7');
      expect(body.containsKey('business_id'), isFalse);
      expect(body.containsKey('created_by'), isFalse);
      expect(body.containsKey('user_id'), isFalse);
      final items = body['items'] as List;
      expect(items, hasLength(1));
      expect((items.first as Map)['item_id'], 'it1');
      expect(srv.sent.any((o) => o.method == 'POST'), isFalse);
      // Back on the (reloaded) detail.
      expect(find.byType(BillFormScreen), findsNothing);
    });

    testWidgets('fix1: an order the phone cannot total shows the reason and Open on website, no form and no Save', (t) async {
      final srv = _Server(order: _order('so1', 'SO-1', 'confirmed', additional: 50));
      final s = srv.build();
      _tall(t);
      await t.pumpWidget(MaterialApp(home: BillFormScreen(session: s, kind: BillKind.salesOrder, salesOrderId: 'so1')));
      await t.pumpAndSettle();
      expect(find.textContaining('Edit it on the website'), findsOneWidget);
      expect(find.text('Open on website'), findsOneWidget);
      expect(find.text('Save'), findsNothing);
      expect(find.text('Add item'), findsNothing);
      expect(srv.sent.any((o) => o.method == 'PUT'), isFalse);
    });

    testWidgets('fix1: when the order fails to load there is no form or Save, and Try again reloads it', (t) async {
      final srv = _Server(orderGet: (500, {'error': 'boom'}));
      final s = srv.build();
      _tall(t);
      await t.pumpWidget(MaterialApp(home: BillFormScreen(session: s, kind: BillKind.salesOrder, salesOrderId: 'so1')));
      await t.pumpAndSettle();
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Save'), findsNothing);
      expect(find.text('Add item'), findsNothing);
      expect(srv.sent.any((o) => o.method == 'PUT'), isFalse);
      srv.orderGet = null;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Save'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect(((srv.bodies['PUT /api/sales-orders/so1'] as Map)['items'] as List), hasLength(1));
    });

    testWidgets('a refused edit shows the server message and stays on the form', (t) async {
      final srv = _Server(putStatus: 400);
      final s = srv.build();
      _tall(t);
      await t.pumpWidget(MaterialApp(home: BillFormScreen(session: s, kind: BillKind.salesOrder, salesOrderId: 'so1')));
      await t.pumpAndSettle();
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect(find.text('This sales order can no longer be edited'), findsOneWidget);
      expect(find.byType(BillFormScreen), findsOneWidget);
    });

    testWidgets('Edit is not offered once invoicing has started', (t) async {
      final srv = _Server(order: _order('so1', 'SO-1', 'partially_fulfilled', converted: 'i9', editable: false, fulfilled: 1), rows: [_row('so1', 'SO-1', 'partially_fulfilled', converted: 'i9', invoices: 1)]);
      await _pump(t, srv.build());
      await t.tap(find.text('SO-1'));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      expect(find.text('Edit'), findsNothing);
    });
  });

  group('record advance', () {
    testWidgets('opens the payment form for the order\'s customer, then reloads the detail', (t) async {
      final srv = _Server(rows: [_row('so1', 'SO-1', 'confirmed')], summary: _summary);
      await _pump(t, srv.build());
      await t.tap(find.text('SO-1'));
      await t.pumpAndSettle();
      final loadsBefore = srv.sent.where((o) => o.uri.path == '/api/sales-orders/so1/payment-summary').length;
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Record advance'));
      await t.pumpAndSettle();
      expect(find.byType(PaymentInFormScreen), findsOneWidget);
      expect(find.text('Asha'), findsOneWidget);
      expect(find.text('Choose who paid'), findsNothing);
      Navigator.of(t.element(find.byType(PaymentInFormScreen))).pop(const RecordedPayments(['p1']));
      await t.pumpAndSettle();
      expect(srv.sent.where((o) => o.uri.path == '/api/sales-orders/so1/payment-summary').length, loadsBefore + 1);
    });

    testWidgets('cancelling the payment form changes nothing', (t) async {
      final srv = _Server(rows: [_row('so1', 'SO-1', 'confirmed')], summary: _summary);
      await _pump(t, srv.build());
      await t.tap(find.text('SO-1'));
      await t.pumpAndSettle();
      final loadsBefore = srv.sent.where((o) => o.uri.path == '/api/sales-orders/so1').length;
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Record advance'));
      await t.pumpAndSettle();
      Navigator.of(t.element(find.byType(PaymentInFormScreen))).pop();
      await t.pumpAndSettle();
      expect(srv.sent.where((o) => o.uri.path == '/api/sales-orders/so1').length, loadsBefore);
    });

    testWidgets('a cancelled order offers no advance', (t) async {
      final srv = _Server(order: _order('so1', 'SO-1', 'cancelled', editable: false), rows: [_row('so1', 'SO-1', 'cancelled')]);
      await _pump(t, srv.build());
      await t.tap(find.text('SO-1'));
      await t.pumpAndSettle();
      expect(find.byTooltip('More'), findsOneWidget);
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      expect(find.text('Record advance'), findsNothing);
    });
  });
}
