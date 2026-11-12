import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/invoices/invoice_detail_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/purchases/bill_form_screen.dart';
import 'package:khatario_phone/screens/sales/challan_logic.dart';
import 'package:khatario_phone/screens/sales/delivery_challans_screen.dart';
import 'package:khatario_phone/screens/sales/work_order_logic.dart';
import 'package:khatario_phone/screens/sales/work_orders_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/kit.dart';

Map<String, dynamic> _dc(
  String status, {
  String kind = 'supply',
  String purpose = '',
  String? posted,
  String? closed,
  String? transfer,
  String? invoice,
}) =>
    {
      'id': 'dc1',
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'challan_number': 'DC-1',
      'challan_date': '2026-11-01',
      'delivery_date': null,
      'status': status,
      'challan_kind': kind,
      'purpose': purpose,
      'stock_posted_at': posted,
      'closed_at': closed,
      'stock_transfer_id': transfer,
      'invoice_id': invoice,
      'invoice_number': invoice == null ? null : 'INV-5',
      'sales_order_id': null,
      'supplier_id': null,
      'warehouse_id': null,
      'expected_return_date': null,
      'job_work_goods': null,
      'e_way_bill_number': null,
      'vehicle_number': 'MH12AB1234',
      'transporter_name': 'Fast Cargo',
      'transporter_gstin': null,
      'shipping_address': '12 MG Road',
      'billing_address': '12 MG Road',
      'place_of_delivery': 'Pune',
      'place_of_supply_state_code': '27',
      'dispatch_from_address': null,
      'reason_for_transportation': 'supply',
      'notes': 'Handle with care',
      'terms': 'Net 7',
      'branch_id': 'br1',
      'subtotal': '1000.00',
      'cgst_total': '90.00',
      'sgst_total': '90.00',
      'igst_total': '0.00',
      'tax_total': '180.00',
      'grand_total': '1180.00',
      'created_at': '2026-11-01T05:00:00.000Z',
    };

Map<String, dynamic> _dcItem({String open = '2', String returned = '0'}) => {
      'id': 'l1',
      'item_id': 'it1',
      'item_name': 'Widget',
      'description': '',
      'hsn_sac': '8517',
      'qty': '2',
      'unit': 'PCS',
      'unit_price': '500',
      'tax_rate': '18',
      'line_total': '1180.00',
      'qty_returned': returned,
      'qty_invoiced': '0',
      'qty_written_off': '0',
      'qty_open': open,
    };

Map<String, dynamic> _wo(
  String status, {
  String? invoice,
  String invoiceStatus = 'final',
}) =>
    {
      'id': 'wo1',
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'work_order_number': 'WO-1',
      'work_order_date': '2026-11-01',
      'scheduled_start_date': '2026-11-03',
      'scheduled_end_date': '2026-11-05',
      'status': status,
      'priority': 'high',
      'work_description': 'Fix the AC',
      'work_location': 'Shop 4, MG Road',
      'assigned_to': 'Ravi',
      'labor_cost': '500.00',
      'material_cost': '1000.00',
      'other_cost': '50.00',
      'total_cost': '1550.00',
      'estimated_hours': '4.00',
      'actual_hours': null,
      'labor_sac': '9987',
      'labor_tax_rate': '18.00',
      'place_of_supply_state_code': '27',
      'notes': 'Call first',
      'terms': 'Warranty 30 days',
      'converted_invoice_id': invoice,
      'converted_invoice_number': invoice == null ? null : 'INV-5',
      'converted_invoice_status': invoice == null ? null : invoiceStatus,
      'created_at': '2026-11-01T05:00:00.000Z',
    };

Map<String, dynamic> _woItem() => {
      'id': 'm1',
      'item_id': 'it1',
      'item_name': 'Widget',
      'description': '',
      'hsn_sac': '8517',
      'qty': '2',
      'unit': 'PCS',
      'unit_price': '500',
      'tax_rate': '18',
      'total_cost': '1000.00',
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

/// Replies by route. Documents are read at request time so a test can change what the server says.
class _Srv {
  List<Map<String, dynamic>> dcRows = [];
  Map<String, dynamic> dc = _dc('draft');
  List<Map<String, dynamic>> dcItems = [_dcItem()];
  (int, Object?)? dcListStatus;
  (int, Object?)? dcGet;
  Future<(int, Object?)> Function(Map body)? dcPatch;
  Future<(int, Object?)> Function(Map body)? dcSettle;
  Future<(int, Object?)> Function(Map body)? dcPost;
  int dcPutStatus = 200;

  List<Map<String, dynamic>> woRows = [];
  Map<String, dynamic> wo = _wo('draft');
  List<Map<String, dynamic>> woItems = [_woItem()];
  (int, Object?)? woListStatus;
  (int, Object?)? woGet;
  Future<(int, Object?)> Function(Map body)? woPatch;
  Future<(int, Object?)> Function()? woConvert;
  Future<(int, Object?)> Function(Map body)? woPost;
  Map<String, Object?> woNext = {'work_order_number': 'WO-7', 'branch_id': null, 'supplier_state_code': '27', 'charge_tax': true};

  final sent = <RequestOptions>[];
  final bodies = <String, Object?>{};

  AppSession build() {
    final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
      sent.add(o);
      if (o.data != null) bodies['${o.method} ${o.uri.path}'] = o.data;
      final body = o.data is Map ? Map<String, dynamic>.from(o.data as Map) : <String, dynamic>{};
      (int, Object?) r;
      final path = o.uri.path;
      final m = o.method;
      if (path == '/api/delivery-challans' && m == 'GET') {
        r = dcListStatus ?? (200, {'deliveryChallans': dcRows});
      } else if (path == '/api/delivery-challans' && m == 'POST') {
        r = await (dcPost ?? (b) async => (201, {'deliveryChallan': {'id': 'dcN', 'challan_number': 'DC-7'}}))(body);
      } else if (path == '/api/delivery-challans/next-number') {
        r = (200, {'challan_number': 'DC-7', 'branch_id': null, 'supplier_state_code': '27', 'charge_tax': true});
      } else if (path == '/api/delivery-challans/dc1' && m == 'GET') {
        r = dcGet ?? (200, {'deliveryChallan': dc, 'items': dcItems, 'ewayBills': <Object>[]});
      } else if (path == '/api/delivery-challans/dc1' && m == 'PATCH') {
        r = await (dcPatch ??
            (b) async {
              dc = {...dc, 'status': b['status']};
              return (200, {'deliveryChallan': dc});
            })(body);
      } else if (path == '/api/delivery-challans/dc1' && m == 'PUT') {
        r = dcPutStatus == 200 ? (200, {'deliveryChallan': dc}) : (dcPutStatus, {'error': 'A sent challan cannot be edited'});
      } else if (path == '/api/delivery-challans/dc1/settle') {
        r = await (dcSettle ??
            (b) async {
              dc = {...dc, 'closed_at': '2026-11-02T00:00:00.000Z'};
              dcItems = [_dcItem(open: '0', returned: '2')];
              return (200, {'deliveryChallan': dc, 'closed': true, 'adjustmentIds': <Object>[]});
            })(body);
      } else if (path == '/api/work-orders' && m == 'GET') {
        r = woListStatus ?? (200, {'workOrders': woRows});
      } else if (path == '/api/work-orders' && m == 'POST') {
        r = await (woPost ?? (b) async => (201, {'workOrder': {'id': 'woN', 'work_order_number': 'WO-7'}}))(body);
      } else if (path == '/api/work-orders/next-number') {
        r = (200, woNext);
      } else if (path == '/api/work-orders/wo1' && m == 'GET') {
        r = woGet ?? (200, {'workOrder': wo, 'items': woItems});
      } else if (path == '/api/work-orders/wo1' && m == 'PATCH') {
        r = await (woPatch ??
            (b) async {
              wo = {...wo, 'status': b['status']};
              return (200, {'workOrder': wo});
            })(body);
      } else if (path == '/api/work-orders/wo1' && m == 'PUT') {
        r = (200, {'workOrder': wo});
      } else if (path == '/api/work-orders/wo1/convert') {
        r = await (woConvert ??
            () async {
              wo = {...wo, 'converted_invoice_id': 'i9', 'converted_invoice_number': 'INV-9', 'converted_invoice_status': 'final'};
              return (201, {'invoice': {'id': 'i9', 'invoice_number': 'INV-9'}, 'work_order_id': 'wo1'});
            })();
      } else if (path == '/api/invoices/i9') {
        r = (200, _invoice('i9', 'INV-9'));
      } else if (path == '/api/invoices/i5') {
        r = (200, _invoice('i5', 'INV-5'));
      } else if (path == '/api/customers') {
        r = (200, {'customers': [{'id': 'c1', 'name': 'Asha', 'state_code': '27'}]});
      } else if (path == '/api/items') {
        r = (200, {'items': [{'id': 'it1', 'name': 'Widget', 'unit': 'PCS', 'tax_rate': 18, 'selling_price': 500, 'hsn_sac': '8517'}]});
      } else {
        r = (200, <String, dynamic>{});
      }
      h.resolve(Response(requestOptions: o, statusCode: r.$1, data: r.$2));
    }));
    return AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b', 'state_code': '27'}});
  }

  Iterable<RequestOptions> _of(String method, String path) => sent.where((o) => o.method == method && o.uri.path == path);
  int count(String method, String path) => _of(method, path).length;
}

void _tall(WidgetTester t) {
  t.view.physicalSize = const Size(800, 2400);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.resetPhysicalSize);
  addTearDown(t.view.resetDevicePixelRatio);
}

Future<void> _pumpChallans(WidgetTester t, AppSession s) async {
  _tall(t);
  await t.pumpWidget(MaterialApp(home: DeliveryChallansScreen(session: s)));
  await t.pumpAndSettle();
}

Future<void> _pumpOrders(WidgetTester t, AppSession s) async {
  _tall(t);
  await t.pumpWidget(MaterialApp(home: WorkOrdersScreen(session: s)));
  await t.pumpAndSettle();
}

Future<void> _pumpForm(WidgetTester t, AppSession s, BillKind kind, {String? challanId, String? workOrderId}) async {
  _tall(t);
  await t.pumpWidget(MaterialApp(home: BillFormScreen(session: s, kind: kind, challanId: challanId, workOrderId: workOrderId)));
  await t.pumpAndSettle();
}

Future<void> _more(WidgetTester t, String label) async {
  await t.tap(find.byTooltip('More'));
  await t.pumpAndSettle();
  await t.tap(find.text(label));
}

/// Picks the customer and the first item on a new document form.
Future<void> _fillParty(WidgetTester t) async {
  await t.tap(find.text('Choose').first);
  await t.pumpAndSettle();
  await t.tap(find.text('Asha').last);
  await t.pumpAndSettle();
}

Future<void> _fillItem(WidgetTester t) async {
  await t.tap(find.text('Item 1'));
  await t.pumpAndSettle();
  await t.tap(find.text('Widget').last);
  await t.pumpAndSettle();
}

/// A sheet opened from a detail action: the bottom button spins meanwhile, so settle by time.
Future<void> _sheetUp(WidgetTester t) async {
  await t.pump();
  await t.pump(const Duration(seconds: 1));
}

/// The text input inside the kit field with this label.
Finder _field(String label) => find.descendant(of: find.widgetWithText(KTextField, label), matching: find.byType(TextField));

const _forbidden = ['business_id', 'user_id', 'created_by'];

void main() {
  group('challan logic', () {
    test('the website chips, in order', () {
      expect(kChallanFilters.map((f) => f.$2).toList(), ['All', 'Draft', 'Sent', 'Delivered', 'Cancelled']);
      expect(kChallanFilters.map((f) => f.$1).toList(), ['', 'draft', 'sent', 'delivered', 'cancelled']);
    });

    test('moves between statuses follow the website (delivered and cancelled are final)', () {
      expect(canTransitionChallan('draft', 'sent'), isTrue);
      expect(canTransitionChallan('draft', 'cancelled'), isTrue);
      expect(canTransitionChallan('draft', 'delivered'), isFalse);
      expect(canTransitionChallan('sent', 'delivered'), isTrue);
      expect(canTransitionChallan('sent', 'cancelled'), isTrue);
      expect(canTransitionChallan('delivered', 'cancelled'), isFalse);
      expect(canTransitionChallan('cancelled', 'sent'), isFalse);
    });

    test('actions per status', () {
      expect(challanActions(_dc('draft')), [ChallanAction.generate, ChallanAction.edit, ChallanAction.cancel, ChallanAction.share]);
      expect(challanActions(_dc('sent')), [ChallanAction.markDelivered, ChallanAction.edit, ChallanAction.cancel, ChallanAction.share]);
      expect(challanActions(_dc('delivered', invoice: 'i5')), [ChallanAction.openInvoice, ChallanAction.share]);
      expect(challanActions(_dc('cancelled')), [ChallanAction.share]);
    });

    test('a returnable challan sends goods out, then takes returns, and is not edited or cancelled while the goods are out', () {
      expect(challanActions(_dc('draft', kind: 'returnable', purpose: 'repair')),
          [ChallanAction.sendOut, ChallanAction.edit, ChallanAction.cancel, ChallanAction.share]);
      final out = _dc('sent', kind: 'returnable', purpose: 'repair', posted: '2026-11-01T06:00:00Z');
      expect(challanActions(out), [ChallanAction.recordReturn, ChallanAction.share]);
    });

    test('a settled (closed) returnable challan has no Record return', () {
      final closed = _dc('sent', kind: 'returnable', purpose: 'repair', posted: '2026-11-01T06:00:00Z', closed: '2026-11-02T06:00:00Z');
      expect(challanActions(closed), isNot(contains(ChallanAction.recordReturn)));
      expect(challanActions(closed), contains(ChallanAction.share));
    });

    test('a stock transfer challan follows its transfer: no edit, no cancel', () {
      final t = _dc('sent', transfer: 'st1');
      expect(challanActions(t), [ChallanAction.markDelivered, ChallanAction.share]);
    });

    test('the status change body is the website one: only the new status', () {
      expect(challanStatusBody('sent'), {'status': 'sent'});
      expect(challanStatusBody('cancelled'), {'status': 'cancelled'});
    });

    test('only lines still out can take a return', () {
      final open = challanOpenLines([_dcItem(), _dcItem(open: '0', returned: '2'), {..._dcItem(), 'item_id': null}]);
      expect(open, hasLength(1));
    });

    test('the return body keeps only lines with a quantity and sends the website keys', () {
      final body = challanReturnBody(
        date: DateTime(2026, 11, 2),
        entries: [
          const ChallanReturnEntry(lineId: 'l1', returned: 2),
          const ChallanReturnEntry(lineId: 'l2'),
        ],
        reason: 'CUSTODY_LOSS',
        notes: '',
      );
      expect(body['date'], '2026-11-02');
      expect(body['lines'], [
        {'line_id': 'l1', 'returned': 2, 'invoiced': 0, 'written_off': 0},
      ]);
      expect(body['write_off_reason'], 'CUSTODY_LOSS');
      expect(body['notes'], isNull);
      expect(body.containsKey('business_id'), isFalse);
    });
  });

  group('work order logic', () {
    test('the website chips, in order', () {
      expect(kWorkOrderFilters.map((f) => f.$2).toList(), ['All', 'Draft', 'Scheduled', 'In Progress', 'Completed', 'Cancelled']);
      expect(kWorkOrderFilters.map((f) => f.$1).toList(), ['', 'draft', 'scheduled', 'in_progress', 'completed', 'cancelled']);
    });

    test('moves between statuses follow the website', () {
      expect(canTransitionWorkOrder('draft', 'scheduled'), isTrue);
      expect(canTransitionWorkOrder('draft', 'in_progress'), isTrue);
      expect(canTransitionWorkOrder('draft', 'completed'), isFalse);
      expect(canTransitionWorkOrder('scheduled', 'in_progress'), isTrue);
      expect(canTransitionWorkOrder('in_progress', 'completed'), isTrue);
      expect(canTransitionWorkOrder('in_progress', 'scheduled'), isFalse);
      expect(canTransitionWorkOrder('completed', 'cancelled'), isFalse);
    });

    test('actions per status', () {
      expect(workOrderActions(_wo('draft')),
          [WorkOrderAction.start, WorkOrderAction.schedule, WorkOrderAction.edit, WorkOrderAction.cancel, WorkOrderAction.share]);
      expect(workOrderActions(_wo('scheduled')), [WorkOrderAction.start, WorkOrderAction.edit, WorkOrderAction.cancel, WorkOrderAction.share]);
      expect(workOrderActions(_wo('in_progress')), [WorkOrderAction.complete, WorkOrderAction.edit, WorkOrderAction.cancel, WorkOrderAction.share]);
      expect(workOrderActions(_wo('completed')), [WorkOrderAction.createInvoice, WorkOrderAction.share]);
      expect(workOrderActions(_wo('completed', invoice: 'i5')), [WorkOrderAction.openInvoice, WorkOrderAction.share]);
      expect(workOrderActions(_wo('completed', invoice: 'i5', invoiceStatus: 'cancelled')),
          [WorkOrderAction.createInvoice, WorkOrderAction.openInvoice, WorkOrderAction.share]);
      expect(workOrderActions(_wo('cancelled')), [WorkOrderAction.share]);
    });

    test('status change bodies are the website ones', () {
      expect(workOrderStatusBody('in_progress'), {'status': 'in_progress', 'actual_hours': null});
      expect(workOrderStatusBody('completed', hours: 6.5), {'status': 'completed', 'actual_hours': 6.5});
      expect(workOrderStatusBody('completed'), {'status': 'completed', 'actual_hours': null});
    });

    test('the status words match the website badges', () {
      expect(statusTone('in_progress').$2, 'In progress');
      expect(statusTone('scheduled').$2, 'Scheduled');
      expect(statusTone('completed').$2, 'Completed');
      expect(statusTone('delivered').$2, 'Delivered');
    });
  });

  group('delivery challans list', () {
    testWidgets('shows the website chips; a chip is sent as status and no business id', (t) async {
      final srv = _Srv()..dcRows = [_dc('draft'), {..._dc('sent'), 'id': 'dc2', 'challan_number': 'DC-2'}];
      await _pumpChallans(t, srv.build());
      expect(find.text('DC-1'), findsOneWidget);
      expect(find.text('DC-2'), findsOneWidget);
      for (final c in ['All', 'Draft', 'Sent', 'Delivered', 'Cancelled']) {
        expect(find.text(c), findsWidgets, reason: c);
      }
      await t.tap(find.widgetWithText(KChip, 'Delivered'));
      await t.pumpAndSettle();
      expect(srv.sent.last.uri.path, '/api/delivery-challans');
      expect(srv.sent.last.uri.queryParameters['status'], 'delivered');
      expect(srv.sent.every((o) => !o.uri.queryParameters.containsKey('business_id')), isTrue);
    });

    testWidgets('empty list says so and New delivery challan stays', (t) async {
      await _pumpChallans(t, _Srv().build());
      expect(find.text('No delivery challans yet'), findsOneWidget);
      expect(find.text('New delivery challan'), findsOneWidget);
    });

    testWidgets('a server error offers Try again', (t) async {
      final srv = _Srv()..dcListStatus = (500, {'error': 'boom'});
      await _pumpChallans(t, srv.build());
      expect(find.text('Try again'), findsOneWidget);
      srv.dcListStatus = null;
      srv.dcRows = [_dc('draft')];
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('DC-1'), findsOneWidget);
    });

    testWidgets('a plan without delivery challans says so', (t) async {
      final srv = _Srv()..dcListStatus = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'});
      await _pumpChallans(t, srv.build());
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('a row opens the detail with its lines and the generate action', (t) async {
      final srv = _Srv()..dcRows = [_dc('draft')];
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      expect(srv.count('GET', '/api/delivery-challans/dc1'), 1);
      expect(find.text('Widget'), findsOneWidget);
      expect(find.text('Generate'), findsOneWidget);
    });

    testWidgets('a long press offers the actions that fit the row', (t) async {
      final srv = _Srv()..dcRows = [_dc('delivered', invoice: 'i5')];
      await _pumpChallans(t, srv.build());
      await t.longPress(find.text('DC-1'));
      await t.pumpAndSettle();
      expect(find.text('Open invoice'), findsOneWidget);
      expect(find.text('Share'), findsOneWidget);
      expect(find.text('Generate'), findsNothing);
      expect(find.text('Cancel challan'), findsNothing);
    });
  });

  group('challan status changes', () {
    testWidgets('Generate sends the website PATCH once, even on a double tap, then the detail moves on', (t) async {
      final gate = Completer<(int, Object?)>();
      final srv = _Srv()
        ..dcRows = [_dc('draft')]
        ..dcPatch = (b) => gate.future;
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Generate'));
      await t.tap(find.text('Generate'), warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 100));
      expect(srv.count('PATCH', '/api/delivery-challans/dc1'), 1);
      expect(srv.bodies['PATCH /api/delivery-challans/dc1'], {'status': 'sent'});
      srv.dc = {...srv.dc, 'status': 'sent'};
      gate.complete((200, {'deliveryChallan': srv.dc}));
      await t.pumpAndSettle();
      expect(srv.count('PATCH', '/api/delivery-challans/dc1'), 1);
      expect(find.text('Challan generated'), findsOneWidget);
      expect(find.text('Mark delivered'), findsOneWidget);
      expect(find.text('Generate'), findsNothing);
    });

    testWidgets('Mark delivered sends status delivered', (t) async {
      final srv = _Srv()
        ..dc = _dc('sent')
        ..dcRows = [_dc('sent')];
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Mark delivered'));
      await t.pumpAndSettle();
      expect(srv.bodies['PATCH /api/delivery-challans/dc1'], {'status': 'delivered'});
      expect(find.text('Marked as delivered'), findsOneWidget);
      expect(find.text('Mark delivered'), findsNothing);
    });

    testWidgets('Cancel asks first and sends status cancelled only after yes', (t) async {
      final srv = _Srv()..dcRows = [_dc('draft')];
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      await _more(t, 'Cancel challan');
      await _sheetUp(t);
      expect(srv.count('PATCH', '/api/delivery-challans/dc1'), 0);
      expect(find.textContaining('cannot be undone'), findsOneWidget);
      await t.tap(find.widgetWithText(KButton, 'Cancel challan'));
      await t.pumpAndSettle();
      expect(srv.bodies['PATCH /api/delivery-challans/dc1'], {'status': 'cancelled'});
      expect(find.text('Challan cancelled'), findsOneWidget);
    });

    testWidgets('keeping the challan sends nothing', (t) async {
      final srv = _Srv()..dcRows = [_dc('draft')];
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      await _more(t, 'Cancel challan');
      await _sheetUp(t);
      await t.tap(find.widgetWithText(KButton, 'Keep challan'));
      await t.pumpAndSettle();
      expect(srv.count('PATCH', '/api/delivery-challans/dc1'), 0);
    });

    testWidgets('a refused change shows the server message and leaves the screen as it was', (t) async {
      final srv = _Srv()
        ..dcRows = [_dc('draft')]
        ..dcPatch = (b) async => (409, {'error': 'Cannot change a draft challan to sent'});
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Generate'));
      await t.pumpAndSettle();
      expect(find.text('Cannot change a draft challan to sent'), findsOneWidget);
      expect(find.text('Generate'), findsOneWidget);
      expect(find.text('Challan generated'), findsNothing);
    });

    testWidgets('the list reloads after a change made in the detail', (t) async {
      final srv = _Srv()..dcRows = [_dc('draft')];
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Generate'));
      await t.pumpAndSettle();
      srv.dcRows = [_dc('sent')];
      Navigator.of(t.element(find.byType(DeliveryChallanDetailScreen))).maybePop();
      await t.pumpAndSettle();
      expect(srv.count('GET', '/api/delivery-challans'), 2);
    });

    testWidgets('a change from the long-press sheet sends the same PATCH and reloads the list', (t) async {
      final srv = _Srv()..dcRows = [_dc('draft')];
      await _pumpChallans(t, srv.build());
      await t.longPress(find.text('DC-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Generate'));
      await t.pumpAndSettle();
      expect(srv.bodies['PATCH /api/delivery-challans/dc1'], {'status': 'sent'});
      expect(srv.count('GET', '/api/delivery-challans'), 2);
    });
  });

  group('record return (settle)', () {
    Map<String, dynamic> out() => _dc('sent', kind: 'returnable', purpose: 'repair', posted: '2026-11-01T06:00:00Z');

    testWidgets('asks for the quantities, posts the website body once and reloads', (t) async {
      final gate = Completer<(int, Object?)>();
      final srv = _Srv()
        ..dc = out()
        ..dcRows = [out()]
        ..dcSettle = (b) => gate.future;
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Record return'));
      await _sheetUp(t);
      expect(srv.count('POST', '/api/delivery-challans/dc1/settle'), 0);
      expect(find.text('Widget'), findsWidgets);
      expect(find.textContaining('2 of 2 PCS still out'), findsOneWidget);
      expect(find.text('Sold to holder'), findsNothing);
      await t.tap(find.text('Save return'));
      await t.tap(find.text('Save return'), warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 100));
      expect(srv.count('POST', '/api/delivery-challans/dc1/settle'), 1);
      final body = srv.bodies['POST /api/delivery-challans/dc1/settle'] as Map;
      final d = DateTime.now();
      expect(body['date'], '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}');
      expect(body['lines'], [
        {'line_id': 'l1', 'returned': 2, 'invoiced': 0, 'written_off': 0},
      ]);
      expect(body['write_off_reason'], 'CUSTODY_LOSS');
      for (final k in _forbidden) {
        expect(body.containsKey(k), isFalse, reason: k);
      }
      srv.dc = {...srv.dc, 'closed_at': '2026-11-02T00:00:00.000Z'};
      srv.dcItems = [_dcItem(open: '0', returned: '2')];
      gate.complete((200, {'deliveryChallan': srv.dc, 'closed': true}));
      await t.pumpAndSettle();
      expect(srv.count('POST', '/api/delivery-challans/dc1/settle'), 1);
      expect(find.text('All goods are back; challan closed'), findsOneWidget);
      expect(find.text('Record return'), findsNothing);
    });

    testWidgets('an approval challan can also sell the goods to the holder', (t) async {
      final doc = _dc('sent', kind: 'returnable', purpose: 'approval', posted: '2026-11-01T06:00:00Z');
      final srv = _Srv()
        ..dc = doc
        ..dcRows = [doc];
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Record return'));
      await _sheetUp(t);
      expect(find.text('Sold to holder'), findsOneWidget);
      await t.tap(find.byIcon(LucideIcons.x));
      await t.pumpAndSettle();
    });

    testWidgets('nothing entered sends nothing', (t) async {
      final srv = _Srv()
        ..dc = out()
        ..dcRows = [out()];
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Record return'));
      await _sheetUp(t);
      await t.enterText(_field('Came back'), '0');
      await t.tap(find.text('Save return'));
      await _sheetUp(t);
      expect(find.text('Enter what came back'), findsOneWidget);
      expect(srv.count('POST', '/api/delivery-challans/dc1/settle'), 0);
      await t.tap(find.byIcon(LucideIcons.x));
      await t.pumpAndSettle();
    });

    testWidgets('a refused return shows the server message; "already closed" reloads the challan', (t) async {
      final srv = _Srv()
        ..dc = out()
        ..dcRows = [out()]
        ..dcSettle = (b) async {
          return (409, {'error': 'This challan is already closed.'});
        };
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      srv.dc = {...srv.dc, 'closed_at': '2026-11-02T00:00:00.000Z'};
      final loads = srv.count('GET', '/api/delivery-challans/dc1');
      await t.tap(find.text('Record return'));
      await _sheetUp(t);
      await t.tap(find.text('Save return'));
      await t.pumpAndSettle();
      expect(find.text('This challan is already closed.'), findsOneWidget);
      expect(srv.count('GET', '/api/delivery-challans/dc1'), loads + 1);
      expect(find.text('Record return'), findsNothing);
    });

    testWidgets('a settled challan offers no Record return', (t) async {
      final closed = _dc('sent', kind: 'returnable', purpose: 'repair', posted: '2026-11-01T06:00:00Z', closed: '2026-11-02T06:00:00Z');
      final srv = _Srv()
        ..dc = closed
        ..dcItems = [_dcItem(open: '0', returned: '2')]
        ..dcRows = [closed];
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      expect(find.text('Record return'), findsNothing);
    });
  });

  group('challan edit', () {
    testWidgets('waits for the challan, then saves with PUT keeping what the form cannot show', (t) async {
      final srv = _Srv()
        ..dcRows = [_dc('draft')]
        ..dcGet = null;
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      await _more(t, 'Edit');
      await t.pumpAndSettle();
      expect(find.text('Edit delivery challan'), findsOneWidget);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      final body = srv.bodies['PUT /api/delivery-challans/dc1'] as Map;
      expect(body['customer_id'], 'c1');
      expect(body['challan_number'], 'DC-1');
      expect(body['challan_date'], '2026-11-01');
      expect(body['challan_kind'], 'supply');
      expect(body['vehicle_number'], 'MH12AB1234');
      expect(body['transporter_name'], 'Fast Cargo');
      expect(body['shipping_address'], '12 MG Road');
      expect(body['place_of_supply_state_code'], '27');
      expect(body['reason_for_transportation'], 'supply');
      expect(body['terms'], 'Net 7');
      expect(body['branch_id'], 'br1');
      final items = body['items'] as List;
      expect(items, hasLength(1));
      final line = items.first as Map;
      expect(line['item_id'], 'it1');
      expect(line['item_name'], 'Widget');
      expect(line['hsn_sac'], '8517');
      expect(line['qty'], 2);
      expect(line['unit_price'], 500);
      expect(line['tax_rate'], 18);
      expect(line.containsKey('taxable_value'), isFalse);
      for (final k in _forbidden) {
        expect(body.containsKey(k), isFalse, reason: k);
      }
      expect(srv.count('POST', '/api/delivery-challans'), 0);
      expect(find.byType(BillFormScreen), findsNothing);
    });

    testWidgets('a challan that fails to load shows Try again, no form and no Save', (t) async {
      final srv = _Srv()..dcGet = (500, {'error': 'boom'});
      await _pumpForm(t, srv.build(), BillKind.deliveryChallan, challanId: 'dc1');
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Save'), findsNothing);
      expect(find.text('Add item'), findsNothing);
      srv.dcGet = null;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Save'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
      expect(srv.count('PUT', '/api/delivery-challans/dc1'), 0);
    });

    testWidgets('a challan whose goods are out cannot be edited here: the reason, no Save', (t) async {
      final srv = _Srv()..dc = _dc('sent', kind: 'returnable', purpose: 'repair', posted: '2026-11-01T06:00:00Z');
      await _pumpForm(t, srv.build(), BillKind.deliveryChallan, challanId: 'dc1');
      expect(find.textContaining('can no longer be edited'), findsOneWidget);
      expect(find.text('Save'), findsNothing);
      expect(srv.count('PUT', '/api/delivery-challans/dc1'), 0);
    });

    testWidgets('a challan held by a supplier (no customer) saves without forcing one', (t) async {
      final srv = _Srv()..dc = {..._dc('draft', kind: 'returnable', purpose: 'repair'), 'customer_id': null, 'customer_name': null, 'supplier_id': 's1'};
      await _pumpForm(t, srv.build(), BillKind.deliveryChallan, challanId: 'dc1');
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      final body = srv.bodies['PUT /api/delivery-challans/dc1'] as Map;
      expect(body['customer_id'], isNull);
      expect(body['supplier_id'], 's1');
      expect(body['challan_kind'], 'returnable');
      expect(body['purpose'], 'repair');
    });

    testWidgets('a refused edit shows the server message and stays on the form', (t) async {
      final srv = _Srv()..dcPutStatus = 409;
      await _pumpForm(t, srv.build(), BillKind.deliveryChallan, challanId: 'dc1');
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect(find.text('A sent challan cannot be edited'), findsOneWidget);
      expect(find.byType(BillFormScreen), findsOneWidget);
    });

    testWidgets('Edit is not offered once the goods are out', (t) async {
      final srv = _Srv()
        ..dc = _dc('delivered')
        ..dcRows = [_dc('delivered')];
      await _pumpChallans(t, srv.build());
      await t.tap(find.text('DC-1'));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      expect(find.text('Edit'), findsNothing);
    });
  });

  group('challan create', () {
    testWidgets('posts the website body (number from next-number), once on a double tap, with no forbidden keys', (t) async {
      final gate = Completer<(int, Object?)>();
      final srv = _Srv()..dcPost = (b) => gate.future;
      await _pumpForm(t, srv.build(), BillKind.deliveryChallan);
      expect(srv.count('GET', '/api/delivery-challans/next-number'), 1);
      await _fillParty(t);
      await _fillItem(t);
      await t.tap(find.text('Save'));
      await t.tap(find.text('Save'), warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 100));
      expect(srv.count('POST', '/api/delivery-challans'), 1);
      final body = srv.bodies['POST /api/delivery-challans'] as Map;
      expect(body['customer_id'], 'c1');
      expect(body['challan_number'], 'DC-7');
      expect(body['auto_number'], true);
      expect(body['reason_for_transportation'], 'supply');
      expect(body['challan_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      for (final k in _forbidden) {
        expect(body.containsKey(k), isFalse, reason: k);
      }
      final line = (body['items'] as List).single as Map;
      expect(line['item_id'], 'it1');
      expect(line['qty'], 1);
      expect(line['unit_price'], 500);
      expect(line['tax_rate'], 18);
      expect(line.containsKey('taxable_value'), isFalse);
      expect(line.containsKey('tax_amount'), isFalse);
      gate.complete((201, {'deliveryChallan': {'id': 'dcN', 'challan_number': 'DC-7'}}));
      await t.pumpAndSettle();
      expect(srv.count('POST', '/api/delivery-challans'), 1);
    });

    testWidgets('a typed number is not auto-numbered', (t) async {
      final srv = _Srv();
      await _pumpForm(t, srv.build(), BillKind.deliveryChallan);
      await _fillParty(t);
      await _fillItem(t);
      await t.enterText(find.widgetWithText(TextField, 'DC-7'), 'DC-99');
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      final body = srv.bodies['POST /api/delivery-challans'] as Map;
      expect(body['challan_number'], 'DC-99');
      expect(body['auto_number'], false);
    });

    testWidgets('a challan with no customer is not sent', (t) async {
      final srv = _Srv();
      await _pumpForm(t, srv.build(), BillKind.deliveryChallan);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect(find.text('Choose a customer.'), findsOneWidget);
      expect(srv.count('POST', '/api/delivery-challans'), 0);
    });

    testWidgets('a refused create shows the server message and stays on the form', (t) async {
      final srv = _Srv()..dcPost = (b) async => (409, {'error': 'This challan number is already used. Change the number and try again.'});
      await _pumpForm(t, srv.build(), BillKind.deliveryChallan);
      await _fillParty(t);
      await _fillItem(t);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect(find.textContaining('already used'), findsOneWidget);
      expect(find.byType(BillFormScreen), findsOneWidget);
    });
  });

  group('work orders list', () {
    testWidgets('shows the website chips; a chip is sent as status and no business id', (t) async {
      final srv = _Srv()..woRows = [_wo('draft'), {..._wo('completed'), 'id': 'wo2', 'work_order_number': 'WO-2'}];
      await _pumpOrders(t, srv.build());
      expect(find.text('WO-1'), findsOneWidget);
      for (final c in ['All', 'Draft', 'Scheduled', 'In Progress', 'Completed', 'Cancelled']) {
        expect(find.text(c), findsWidgets, reason: c);
      }
      await t.tap(find.widgetWithText(KChip, 'In Progress'));
      await t.pumpAndSettle();
      expect(srv.sent.last.uri.queryParameters['status'], 'in_progress');
      expect(srv.sent.every((o) => !o.uri.queryParameters.containsKey('business_id') && !o.uri.queryParameters.containsKey('user_id')), isTrue);
    });

    testWidgets('empty, error and plan states', (t) async {
      final srv = _Srv();
      await _pumpOrders(t, srv.build());
      expect(find.text('No work orders yet'), findsOneWidget);
      expect(find.text('New work order'), findsOneWidget);
    });

    testWidgets('a server error offers Try again', (t) async {
      final srv = _Srv()..woListStatus = (500, {'error': 'boom'});
      await _pumpOrders(t, srv.build());
      srv.woListStatus = null;
      srv.woRows = [_wo('draft')];
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('WO-1'), findsOneWidget);
    });

    testWidgets('a plan without work orders says so', (t) async {
      final srv = _Srv()..woListStatus = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'});
      await _pumpOrders(t, srv.build());
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('a row opens the detail with the materials, labour and the server totals', (t) async {
      final srv = _Srv()..woRows = [_wo('draft')];
      await _pumpOrders(t, srv.build());
      await t.tap(find.text('WO-1'));
      await t.pumpAndSettle();
      expect(srv.count('GET', '/api/work-orders/wo1'), 1);
      expect(find.text('Widget'), findsOneWidget);
      expect(find.text('Fix the AC'), findsOneWidget);
      expect(find.text('₹1,550'), findsWidgets);
      expect(find.text('Start work'), findsOneWidget);
    });
  });

  group('work order status changes', () {
    testWidgets('Start work sends the website PATCH once on a double tap', (t) async {
      final gate = Completer<(int, Object?)>();
      final srv = _Srv()
        ..woRows = [_wo('draft')]
        ..woPatch = (b) => gate.future;
      await _pumpOrders(t, srv.build());
      await t.tap(find.text('WO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Start work'));
      await t.tap(find.text('Start work'), warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 100));
      expect(srv.count('PATCH', '/api/work-orders/wo1'), 1);
      expect(srv.bodies['PATCH /api/work-orders/wo1'], {'status': 'in_progress', 'actual_hours': null});
      srv.wo = {...srv.wo, 'status': 'in_progress'};
      gate.complete((200, {'workOrder': srv.wo}));
      await t.pumpAndSettle();
      expect(find.text('Work started'), findsOneWidget);
      expect(find.text('Mark completed'), findsOneWidget);
      expect(find.text('Start work'), findsNothing);
    });

    testWidgets('Schedule is under More and sends status scheduled', (t) async {
      final srv = _Srv()..woRows = [_wo('draft')];
      await _pumpOrders(t, srv.build());
      await t.tap(find.text('WO-1'));
      await t.pumpAndSettle();
      await _more(t, 'Schedule');
      await t.pumpAndSettle();
      expect(srv.bodies['PATCH /api/work-orders/wo1'], {'status': 'scheduled', 'actual_hours': null});
      expect(find.text('Work order scheduled'), findsOneWidget);
    });

    testWidgets('Mark completed asks for the hours first and sends them', (t) async {
      final srv = _Srv()
        ..wo = _wo('in_progress')
        ..woRows = [_wo('in_progress')];
      await _pumpOrders(t, srv.build());
      await t.tap(find.text('WO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Mark completed'));
      await _sheetUp(t);
      expect(srv.count('PATCH', '/api/work-orders/wo1'), 0);
      await t.enterText(find.byType(TextField).last, '6.5');
      await t.tap(find.widgetWithText(KButton, 'Complete'));
      await t.pumpAndSettle();
      expect(srv.bodies['PATCH /api/work-orders/wo1'], {'status': 'completed', 'actual_hours': 6.5});
      expect(find.text('Work order completed'), findsOneWidget);
      expect(find.text('Create invoice'), findsOneWidget);
    });

    testWidgets('hours left blank send null; closing the question sends nothing', (t) async {
      final srv = _Srv()
        ..wo = _wo('in_progress')
        ..woRows = [_wo('in_progress')];
      await _pumpOrders(t, srv.build());
      await t.tap(find.text('WO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Mark completed'));
      await _sheetUp(t);
      await t.tap(find.byIcon(LucideIcons.x));
      await t.pumpAndSettle();
      expect(srv.count('PATCH', '/api/work-orders/wo1'), 0);
      await t.tap(find.text('Mark completed'));
      await _sheetUp(t);
      await t.tap(find.widgetWithText(KButton, 'Complete'));
      await t.pumpAndSettle();
      expect(srv.bodies['PATCH /api/work-orders/wo1'], {'status': 'completed', 'actual_hours': null});
    });

    testWidgets('Cancel asks first', (t) async {
      final srv = _Srv()..woRows = [_wo('draft')];
      await _pumpOrders(t, srv.build());
      await t.tap(find.text('WO-1'));
      await t.pumpAndSettle();
      await _more(t, 'Cancel work order');
      await _sheetUp(t);
      expect(srv.count('PATCH', '/api/work-orders/wo1'), 0);
      await t.tap(find.widgetWithText(KButton, 'Cancel work order'));
      await t.pumpAndSettle();
      expect(srv.bodies['PATCH /api/work-orders/wo1'], {'status': 'cancelled', 'actual_hours': null});
      expect(find.text('Work order cancelled'), findsOneWidget);
    });

    testWidgets('a refused change shows the server message and leaves the screen as it was', (t) async {
      final srv = _Srv()
        ..woRows = [_wo('draft')]
        ..woPatch = (b) async => (409, {'error': 'The work order changed meanwhile. Reload and try again.'});
      await _pumpOrders(t, srv.build());
      await t.tap(find.text('WO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Start work'));
      await t.pumpAndSettle();
      expect(find.text('The work order changed meanwhile. Reload and try again.'), findsOneWidget);
      expect(find.text('Start work'), findsOneWidget);
    });
  });

  group('work order convert', () {
    testWidgets('asks first, posts once with no business id, opens the new invoice, and the list reloads', (t) async {
      final gate = Completer<(int, Object?)>();
      final srv = _Srv()
        ..wo = _wo('completed')
        ..woRows = [_wo('completed')]
        ..woConvert = () => gate.future;
      await _pumpOrders(t, srv.build());
      await t.tap(find.text('WO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Create invoice'));
      // The bottom button spins while the sheet is open, so settle by time.
      await t.pump();
      await t.pump(const Duration(seconds: 1));
      expect(srv.count('POST', '/api/work-orders/wo1/convert'), 0);
      expect(find.textContaining('WO-1'), findsWidgets);
      await t.tap(find.text('Convert'));
      await t.tap(find.text('Convert'), warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 100));
      expect(srv.count('POST', '/api/work-orders/wo1/convert'), 1);
      final data = srv._of('POST', '/api/work-orders/wo1/convert').single.data;
      expect(data, isA<Map>());
      for (final k in _forbidden) {
        expect((data as Map).containsKey(k), isFalse, reason: k);
      }
      srv.wo = {...srv.wo, 'converted_invoice_id': 'i9', 'converted_invoice_number': 'INV-9', 'converted_invoice_status': 'final'};
      srv.woRows = [srv.wo];
      gate.complete((201, {'invoice': {'id': 'i9', 'invoice_number': 'INV-9'}, 'work_order_id': 'wo1'}));
      await t.pumpAndSettle();
      expect(srv.count('POST', '/api/work-orders/wo1/convert'), 1);
      expect(srv.count('GET', '/api/invoices/i9'), 1);
      expect(find.byType(InvoiceDetailScreen), findsOneWidget);
      Navigator.of(t.element(find.byType(InvoiceDetailScreen))).pop();
      await t.pumpAndSettle();
      // Back on the detail, which now offers the invoice instead.
      expect(find.text('Create invoice'), findsNothing);
      expect(find.text('View invoice'), findsOneWidget);
      Navigator.of(t.element(find.byType(WorkOrderDetailScreen))).maybePop();
      await t.pumpAndSettle();
      expect(srv.count('GET', '/api/work-orders'), 2);
    });

    testWidgets('a refused convert shows the server message and leaves the screen', (t) async {
      final srv = _Srv()
        ..wo = _wo('completed')
        ..woRows = [_wo('completed')]
        ..woConvert = () async => (400, {'error': 'The work order has no labour cost or materials to invoice'});
      await _pumpOrders(t, srv.build());
      await t.longPress(find.text('WO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Create invoice'));
      await t.pumpAndSettle();
      await t.tap(find.text('Convert'));
      await t.pumpAndSettle();
      expect(find.textContaining('no labour cost or materials'), findsOneWidget);
      expect(find.byType(InvoiceDetailScreen), findsNothing);
      expect(srv.count('GET', '/api/work-orders'), 1);
    });

    testWidgets('"already raised" refreshes the list so Create invoice goes away', (t) async {
      final srv = _Srv()
        ..wo = _wo('completed')
        ..woRows = [_wo('completed')]
        ..woConvert = () async => (409, {'error': 'An invoice has already been raised for this work order', 'invoice_id': 'i5'});
      await _pumpOrders(t, srv.build());
      srv.woRows = [_wo('completed', invoice: 'i5')];
      await t.longPress(find.text('WO-1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Create invoice'));
      await t.pumpAndSettle();
      await t.tap(find.text('Convert'));
      await t.pumpAndSettle();
      expect(find.textContaining('already been raised'), findsOneWidget);
      expect(srv.count('GET', '/api/work-orders'), 2);
      await t.longPress(find.text('WO-1'));
      await t.pumpAndSettle();
      expect(find.text('Create invoice'), findsNothing);
      expect(find.text('View invoice'), findsOneWidget);
    });

    testWidgets('an invoiced order offers View invoice and opens it', (t) async {
      final srv = _Srv()
        ..wo = _wo('completed', invoice: 'i5')
        ..woRows = [_wo('completed', invoice: 'i5')];
      await _pumpOrders(t, srv.build());
      await t.tap(find.text('WO-1'));
      await t.pumpAndSettle();
      expect(find.text('Create invoice'), findsNothing);
      await t.tap(find.text('View invoice'));
      await t.pumpAndSettle();
      expect(srv.count('GET', '/api/invoices/i5'), 1);
    });
  });

  group('work order create', () {
    testWidgets('posts the website body (number from next-number), once on a double tap, with no forbidden keys', (t) async {
      final gate = Completer<(int, Object?)>();
      final srv = _Srv()..woPost = (b) => gate.future;
      await _pumpForm(t, srv.build(), BillKind.workOrder);
      expect(srv.count('GET', '/api/work-orders/next-number'), 1);
      expect(find.text('New work order'), findsOneWidget);
      await _fillParty(t);
      await t.enterText(_field('Work description'), 'Fix the AC');
      await _fillItem(t);
      await t.enterText(_field('Labour cost'), '500');
      await t.tap(find.text('Save'));
      await t.tap(find.text('Save'), warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 100));
      expect(srv.count('POST', '/api/work-orders'), 1);
      final body = srv.bodies['POST /api/work-orders'] as Map;
      expect(body['customer_id'], 'c1');
      expect(body['work_order_number'], 'WO-7');
      expect(body['auto_number'], true);
      expect(body['work_description'], 'Fix the AC');
      expect(body['priority'], 'medium');
      expect(body['labor_cost'], 500);
      expect(body['other_cost'], 0);
      expect(body['labor_sac'], '9987');
      expect(body['labor_tax_rate'], 18);
      expect(body['status'], 'draft');
      expect(body['work_order_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      for (final k in _forbidden) {
        expect(body.containsKey(k), isFalse, reason: k);
      }
      final line = (body['items'] as List).single as Map;
      expect(line['item_id'], 'it1');
      expect(line['item_name'], 'Widget');
      expect(line['qty'], 1);
      expect(line['unit_price'], 500);
      expect(line['tax_rate'], 18);
      expect(line.containsKey('taxable_value'), isFalse);
      gate.complete((201, {'workOrder': {'id': 'woN', 'work_order_number': 'WO-7'}}));
      await t.pumpAndSettle();
      expect(srv.count('POST', '/api/work-orders'), 1);
    });

    testWidgets('a business that charges no GST sends zero tax on labour and materials', (t) async {
      final srv = _Srv()..woNext = {'work_order_number': 'WO-7', 'branch_id': null, 'supplier_state_code': '27', 'charge_tax': false};
      await _pumpForm(t, srv.build(), BillKind.workOrder);
      await t.enterText(_field('Work description'), 'Fix the AC');
      await _fillItem(t);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      final body = srv.bodies['POST /api/work-orders'] as Map;
      expect(body['labor_tax_rate'], 0);
      expect(((body['items'] as List).single as Map)['tax_rate'], 0);
    });

    testWidgets('labour only (no materials) is a valid work order and no customer is needed', (t) async {
      final srv = _Srv();
      await _pumpForm(t, srv.build(), BillKind.workOrder);
      await t.enterText(_field('Work description'), 'Paint the wall');
      await t.enterText(_field('Labour cost'), '800');
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      final body = srv.bodies['POST /api/work-orders'] as Map;
      expect(body['items'], isEmpty);
      expect(body['customer_id'], isNull);
      expect(body['labor_cost'], 800);
    });

    testWidgets('a missing description or cost sends nothing', (t) async {
      final srv = _Srv();
      await _pumpForm(t, srv.build(), BillKind.workOrder);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect(find.text('Describe the work to be done.'), findsOneWidget);
      await t.enterText(_field('Work description'), 'Fix');
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect(find.text('Enter the labour cost or add materials.'), findsOneWidget);
      expect(srv.count('POST', '/api/work-orders'), 0);
    });

    testWidgets('a refused create shows the server message and stays on the form', (t) async {
      final srv = _Srv()..woPost = (b) async => (409, {'error': 'This work order number is already used. Change the number and try again.'});
      await _pumpForm(t, srv.build(), BillKind.workOrder);
      await t.enterText(_field('Work description'), 'Fix');
      await t.enterText(_field('Labour cost'), '10');
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect(find.textContaining('already used'), findsOneWidget);
      expect(find.byType(BillFormScreen), findsOneWidget);
    });
  });

  group('work order edit', () {
    testWidgets('saves with PUT keeping what the form cannot show', (t) async {
      final srv = _Srv()..woRows = [_wo('scheduled')];
      srv.wo = _wo('scheduled');
      await _pumpOrders(t, srv.build());
      await t.tap(find.text('WO-1'));
      await t.pumpAndSettle();
      await _more(t, 'Edit');
      await t.pumpAndSettle();
      expect(find.text('Edit work order'), findsOneWidget);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      final body = srv.bodies['PUT /api/work-orders/wo1'] as Map;
      expect(body['customer_id'], 'c1');
      expect(body['work_order_number'], 'WO-1');
      expect(body['work_order_date'], '2026-11-01');
      expect(body['scheduled_start_date'], '2026-11-03');
      expect(body['scheduled_end_date'], '2026-11-05');
      expect(body['work_description'], 'Fix the AC');
      expect(body['work_location'], 'Shop 4, MG Road');
      expect(body['assigned_to'], 'Ravi');
      expect(body['priority'], 'high');
      expect(body['labor_cost'], 500);
      expect(body['other_cost'], 50);
      expect(body['estimated_hours'], '4.00');
      expect(body['labor_sac'], '9987');
      expect(body['labor_tax_rate'], '18.00');
      expect(body['place_of_supply_state_code'], '27');
      expect(body['notes'], 'Call first');
      expect(body['terms'], 'Warranty 30 days');
      for (final k in _forbidden) {
        expect(body.containsKey(k), isFalse, reason: k);
      }
      expect(body.containsKey('auto_number'), isFalse);
      final items = body['items'] as List;
      expect(items, hasLength(1));
      expect((items.first as Map)['item_id'], 'it1');
      expect(srv.count('POST', '/api/work-orders'), 0);
    });

    testWidgets('a work order that fails to load shows Try again, no form and no Save', (t) async {
      final srv = _Srv()..woGet = (500, {'error': 'boom'});
      await _pumpForm(t, srv.build(), BillKind.workOrder, workOrderId: 'wo1');
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Save'), findsNothing);
      srv.woGet = null;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Save'), findsOneWidget);
      expect(srv.count('PUT', '/api/work-orders/wo1'), 0);
    });

    testWidgets('a completed work order cannot be edited here: the reason, no Save', (t) async {
      final srv = _Srv()..wo = _wo('completed');
      await _pumpForm(t, srv.build(), BillKind.workOrder, workOrderId: 'wo1');
      expect(find.textContaining('can no longer be edited'), findsOneWidget);
      expect(find.text('Save'), findsNothing);
    });

    testWidgets('Edit is not offered on a completed work order', (t) async {
      final srv = _Srv()
        ..wo = _wo('completed', invoice: 'i5')
        ..woRows = [_wo('completed', invoice: 'i5')];
      await _pumpOrders(t, srv.build());
      await t.tap(find.text('WO-1'));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      expect(find.text('Edit'), findsNothing);
    });
  });

  group('routes', () {
    test('both links open their own screen', () {
      final s = AppSession(KhatarioApi(Dio()), {'user': {'id': 'u'}, 'business': {'id': 'b'}});
      expect(nativeScreenFor(s, '/delivery-challans'), isA<DeliveryChallansScreen>());
      expect(nativeScreenFor(s, '/work-orders'), isA<WorkOrdersScreen>());
    });
  });
}
