import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/stock/stock_transfer_form_screen.dart';
import 'package:khatario_phone/screens/stock/stock_transfer_logic.dart';
import 'package:khatario_phone/screens/stock/stock_transfer_receive_screen.dart';
import 'package:khatario_phone/screens/stock/stock_transfers_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/finders.dart';
import 'support/recorded_session.dart';

Map<String, dynamic> _tr({String id = 't1', String number = 'TRF-1', String status = 'draft', String? challan}) => {
      'id': id,
      'transfer_number': number,
      'transfer_date': '2026-11-05T00:00:00.000Z',
      'from_location_id': 'w1',
      'to_location_id': 'w2',
      'from_warehouse_name': 'Main godown',
      'to_warehouse_name': 'Back room',
      'status': status,
      'notes': 'Festival stock',
      'created_at': '2026-11-05T05:00:00.000Z',
      'created_by_name': 'Asha',
      'approved_by_name': status == 'draft' ? null : 'Ravi',
      'approved_at': status == 'draft' ? null : '2026-11-05T06:00:00.000Z',
      'delivery_challan_id': challan,
      'delivery_challan_number': challan == null ? null : 'DC-7',
    };

Map<String, dynamic> _item({
  String id = 'ti1',
  String itemId = 'i1',
  String name = 'Rice',
  String requested = '10.00',
  String dispatched = '0.000',
  String? received,
  String short = '0.000',
  String? reason,
  String? party,
}) =>
    {
      'id': id,
      'item_id': itemId,
      'item_name': name,
      'qty': requested,
      'quantity_requested': requested,
      'quantity_dispatched': dispatched,
      'received_qty': received,
      'qty_short': short,
      'short_reason': reason,
      'claim_party': party,
      'unit': 'PCS',
      'notes': null,
    };

class _Srv {
  List<Map<String, dynamic>> transfers = [_tr()];
  Map<String, List<Map<String, dynamic>>> items = {
    't1': [_item()],
  };
  Reply? listReply;
  Reply? actionReply;
  Reply? createReply;
  Reply? warehousesReply;

  (AppSession, List<RequestOptions>) build() => recordedSession((o, body) {
        final p = o.uri.path;
        if (o.method == 'GET') {
          if (p == '/api/stock-transfers') return listReply ?? (200, {'transfers': transfers});
          final m = RegExp(r'^/api/stock-transfers/([^/]+)/items$').firstMatch(p);
          if (m != null) return (200, {'items': items[m.group(1)] ?? []});
          if (p == '/api/warehouses') {
            return warehousesReply ??
                (200, {
                  'warehouses': [
                    {'id': 'w1', 'name': 'Main godown', 'warehouse_code': 'MG'},
                    {'id': 'w2', 'name': 'Back room', 'warehouse_code': null},
                  ],
                });
          }
          if (p == '/api/items/search') {
            return (200, {'items': [{'id': 'i1', 'name': 'Rice', 'unit': 'KG', 'current_stock': '40'}]});
          }
        }
        final m = RegExp(r'^/api/stock-transfers/([^/]+)/(approve|dispatch|receive|close-short|cancel)$').firstMatch(p);
        if (m != null && (o.method == 'POST' || o.method == 'PATCH')) {
          if (actionReply != null) return actionReply!;
          final id = m.group(1)!;
          final next = {'approve': 'pending', 'dispatch': 'in_transit', 'receive': 'completed', 'close-short': 'completed', 'cancel': 'cancelled'}[m.group(2)]!;
          final i = transfers.indexWhere((r) => r['id'] == id);
          if (i >= 0) transfers[i] = {...transfers[i], 'status': next};
          return (200, {'success': true, 'transfer': transfers[i], 'completed': next == 'completed'});
        }
        if (o.method == 'POST' && p == '/api/stock-transfers') {
          return createReply ?? (201, {'transfer': {'id': 't9', 'transfer_number': body['transfer_number']}, 'eway_bill_required': false, 'eway_bill_missing': false});
        }
        return (404, {'error': 'not faked: ${o.method} $p'});
      });
}

Future<void> _sheetUp(WidgetTester t) async {
  await t.pump();
  await t.pump(const Duration(seconds: 1));
}

Finder _pick(String label) => find.byWidgetPredicate((w) => (w is KAsyncPickField && w.label == label) || (w is KPickField && w.label == label));

void main() {
  group('stock transfer logic', () {
    test('which actions each status offers, as the website does', () {
      expect(transferActions('draft'), [TransferAction.approve, TransferAction.cancel]);
      expect(transferActions('pending_approval'), [TransferAction.approve, TransferAction.cancel]);
      expect(transferActions('pending'), [TransferAction.dispatch, TransferAction.cancel]);
      expect(transferActions('in_transit'), [TransferAction.receive, TransferAction.closeShort]);
      expect(transferActions('completed'), isEmpty);
      expect(transferActions('cancelled'), isEmpty);
      expect(transferActions('something_new'), isEmpty);
    });

    test('status words are the website ones', () {
      expect(transferStatusLabel('pending'), 'Pending dispatch');
      expect(transferStatusLabel('pending_approval'), 'Pending approval');
      expect(transferStatusLabel('in_transit'), 'In transit');
      expect(transferStatusLabel('draft'), 'Draft');
      expect(transferStatusKey('pending'), 'pending_dispatch');
      expect(transferStatusKey('in_transit'), 'in_transit');
      expect(kTransferFilters.map((f) => f.$1), ['', 'draft', 'pending_approval', 'pending', 'in_transit', 'completed', 'cancelled']);
    });

    test('filter keeps only the chosen status', () {
      expect(transferMatchesFilter(_tr(status: 'pending'), ''), isTrue);
      expect(transferMatchesFilter(_tr(status: 'pending'), 'pending'), isTrue);
      expect(transferMatchesFilter(_tr(status: 'in_transit'), 'pending'), isFalse);
    });

    test('action bodies carry no identity', () {
      expect(approveBody(), <String, dynamic>{});
      expect(dispatchBody(), <String, dynamic>{});
      expect(cancelBody(), {'cancellation_reason': 'Cancelled by user'});
    });

    test('receive body is the website one: received_qty and qty per line, notes or null', () {
      final body = receiveBody(lines: [(itemId: 'i1', qty: 7), (itemId: 'i2', qty: 2.5)], notes: ' Two bags torn ');
      expect(body, {
        'received_items': [
          {'item_id': 'i1', 'received_qty': 7, 'qty': 7},
          {'item_id': 'i2', 'received_qty': 2.5, 'qty': 2.5},
        ],
        'notes': 'Two bags torn',
      });
      expect(receiveBody(lines: [(itemId: 'i1', qty: 1)], notes: ' ')['notes'], isNull);
      expectNoIdentity(body);
    });

    test('received more than was sent is refused before sending; so is nothing or less', () {
      final items = [_item(dispatched: '10.000'), _item(id: 'ti2', itemId: 'i2', name: 'Soap', dispatched: '4.000')];
      expect(receiveRefusal(items, {'ti1': 10, 'ti2': 4}), isNull);
      expect(receiveRefusal(items, {'ti1': 10, 'ti2': 3}), isNull, reason: 'less than sent is a shortage, allowed');
      expect(receiveRefusal(items, {'ti1': 11, 'ti2': 4}), 'Cannot receive more than dispatched for item "Rice". Dispatched: 10, Received: 11');
      expect(receiveRefusal(items, {'ti1': 10, 'ti2': 0}), 'Received quantity must be greater than 0 for item "Soap"');
      expect(receiveRefusal(items, {'ti1': 10}), 'Received quantity must be greater than 0 for item "Soap"');
    });

    test('the receive box starts at what is already received, else what was sent less any written-off shortfall', () {
      expect(defaultReceivedQty(_item(dispatched: '10.000')), 10);
      expect(defaultReceivedQty(_item(dispatched: '10.000', received: '6.000')), 6);
      expect(defaultReceivedQty(_item(dispatched: '10.000', short: '3.000')), 7);
      expect(defaultReceivedQty(_item(dispatched: '0', requested: '5.00')), 5);
    });

    test('quantity still in transit is sent less received less written off', () {
      expect(openShortQty(_item(dispatched: '10.000', received: '6.000', short: '1.000')), 3);
      expect(openShortQty(_item(dispatched: '10.000')), 10);
      expect(openShortQty(_item(dispatched: '10.000', received: '10.000')), 0);
    });

    test('close-short body is {date, lines}; a carrier claim names the carrier', () {
      final body = closeShortBody(
        date: DateTime(2026, 11, 10),
        lines: [(itemId: 'i1', qty: 2), (itemId: 'i2', qty: 0)],
        reason: 'carrier_claim',
        carrier: ' Speedy ',
        amount: '250',
      );
      expect(body, {
        'date': '2026-11-10',
        'lines': [
          {'item_id': 'i1', 'qty': 2, 'reason': 'carrier_claim', 'claim_party': 'Speedy', 'claim_amount': 250},
        ],
      });
      final loss = closeShortBody(date: DateTime(2026, 11, 10), lines: [(itemId: 'i1', qty: 1.5)], reason: 'transit_loss', carrier: 'x', amount: '9');
      expect(loss['lines'], [
        {'item_id': 'i1', 'qty': 1.5, 'reason': 'transit_loss', 'claim_party': null, 'claim_amount': null},
      ]);
      expectNoIdentity(body);
    });

    test('create body is the website one with warehouse ids; no identity keys', () {
      final body = createBody(
        number: ' TRF-20261110-001 ',
        date: DateTime(2026, 11, 10),
        fromId: 'w1',
        toId: 'w2',
        notes: ' ',
        lines: [(itemId: 'i1', qty: 5, unit: 'KG', notes: ' fragile ')],
      );
      expect(body, {
        'transfer_number': 'TRF-20261110-001',
        'transfer_date': '2026-11-10',
        'from_location_id': 'w1',
        'to_location_id': 'w2',
        'notes': null,
        'items': [
          {'item_id': 'i1', 'qty': 5, 'unit': 'KG', 'notes': 'fragile'},
        ],
      });
      expectNoIdentity(body);
    });

    test('create refusals are the website ones', () {
      String? r({String from = 'w1', String to = 'w2', List<({String itemId, num qty})> lines = const [(itemId: 'i1', qty: 1)]}) =>
          createRefusal(fromId: from, toId: to, lines: lines);
      expect(r(), isNull);
      expect(r(from: ''), 'Please select both source and destination warehouses');
      expect(r(to: 'w1'), 'Source and destination warehouses cannot be the same');
      expect(r(lines: const []), 'Please add at least one item to transfer');
      expect(r(lines: const [(itemId: '', qty: 1)]), 'Please select an item for all rows');
      expect(r(lines: const [(itemId: 'i1', qty: 0)]), 'Quantity must be greater than 0');
    });

    test('the next number follows the day\'s earlier ones', () {
      final d = DateTime(2026, 11, 10);
      expect(nextTransferNumber(const [], d), 'TRF-20261110-001');
      expect(nextTransferNumber(['TRF-20261110-001', 'TRF-20261110-004', 'TRF-20261109-009', 'ODD'], d), 'TRF-20261110-005');
    });
  });

  group('transfers list', () {
    testWidgets('loads transfers with no identity in the request; chips filter by status on the phone', (t) async {
      final srv = _Srv()
        ..transfers = [_tr(), _tr(id: 't2', number: 'TRF-2', status: 'in_transit')]
        ..items = {'t1': [_item()], 't2': [_item()]};
      final (s, sent) = srv.build();
      await pumpScreen(t, StockTransfersScreen(session: s));
      expect(find.text('TRF-1'), findsOneWidget);
      expect(find.text('TRF-2'), findsOneWidget);
      final q = requestsOf(sent, 'GET', '/api/stock-transfers').first.uri.queryParameters;
      expect(q.containsKey('business_id'), isFalse);
      expect(q.containsKey('user_id'), isFalse);
      await t.tap(find.text('In transit').first);
      await t.pumpAndSettle();
      expect(find.text('TRF-2'), findsOneWidget);
      expect(find.text('TRF-1'), findsNothing);
      expect(requestsOf(sent, 'GET', '/api/stock-transfers').every((o) => !o.uri.queryParameters.containsKey('status')), isTrue);
    });

    testWidgets('empty, error with Try again, and plan refusal are each handled', (t) async {
      var (s, _) = (_Srv()..transfers = []).build();
      await pumpScreen(t, StockTransfersScreen(session: s));
      expect(find.text('No stock transfers yet'), findsOneWidget);

      final bad = _Srv()..listReply = (500, {'error': 'Boom'});
      (s, _) = bad.build();
      await pumpScreen(t, StockTransfersScreen(session: s));
      expect(find.text('Try again'), findsOneWidget);
      bad.listReply = null;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('TRF-1'), findsOneWidget);

      (s, _) = (_Srv()..listReply = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'})).build();
      await pumpScreen(t, StockTransfersScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });

  group('transfer detail and actions', () {
    Future<(AppSession, List<RequestOptions>)> open(WidgetTester t, _Srv srv) async {
      final r = srv.build();
      await pumpScreen(t, StockTransfersScreen(session: r.$1));
      await t.tap(find.text('TRF-1'));
      await t.pumpAndSettle();
      return r;
    }

    testWidgets('a row opens the detail with its lines read from the items route', (t) async {
      final srv = _Srv()
        ..transfers = [_tr(status: 'in_transit', challan: 'c1')]
        ..items = {
          't1': [_item(dispatched: '10.000', received: '4.000', short: '2.000', reason: 'carrier_claim', party: 'Speedy')],
        };
      final (_, sent) = await open(t, srv);
      expect(requestCount(sent, 'GET', '/api/stock-transfers/t1/items'), 1);
      expect(requestsOf(sent, 'GET', '/api/stock-transfers/t1/items').single.uri.queryParameters.containsKey('business_id'), isFalse);
      expect(find.text('Rice'), findsOneWidget);
      expect(find.textContaining('Dispatched 10'), findsOneWidget);
      expect(find.textContaining('Received 4'), findsOneWidget);
      expect(find.textContaining('claimed from Speedy'), findsOneWidget);
      expect(find.text('Main godown'), findsOneWidget);
      expect(find.text('Back room'), findsOneWidget);
      expect(find.text('DC-7'), findsOneWidget);
      expect(find.text('Festival stock'), findsOneWidget);
    });

    testWidgets('Approve posts {} once even on a double tap, then the transfer reads Pending dispatch', (t) async {
      final (_, sent) = await open(t, _Srv());
      await t.tap(find.widgetWithText(KButton, 'Approve'));
      await t.tap(find.widgetWithText(KButton, 'Approve'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/stock-transfers/t1/approve').toList();
      expect(posts, hasLength(1));
      expect((posts.single.data as Map), isEmpty);
      expect(find.widgetWithText(KButton, 'Dispatch'), findsOneWidget);
      expect(find.text('Pending dispatch'), findsWidgets);
    });

    testWidgets('Dispatch asks first (it takes stock out), then PATCHes once', (t) async {
      final srv = _Srv()..transfers = [_tr(status: 'pending')];
      final (_, sent) = await open(t, srv);
      await t.tap(find.widgetWithText(KButton, 'Dispatch'));
      await _sheetUp(t);
      expect(inSheet('Stock will be deducted from the source warehouse. Dispatch TRF-1?'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/stock-transfers/t1/dispatch'), 0);
      final yes = find.descendant(of: find.byType(BottomSheet), matching: find.text('Dispatch'));
      await t.tap(yes);
      await t.tap(yes, warnIfMissed: false);
      await _sheetUp(t);
      expect(requestCount(sent, 'PATCH', '/api/stock-transfers/t1/dispatch'), 1);
      expect(requestsOf(sent, 'PATCH', '/api/stock-transfers/t1/dispatch').single.data as Map, isEmpty);
    });

    testWidgets('keeping a transfer at the Dispatch question sends nothing', (t) async {
      final srv = _Srv()..transfers = [_tr(status: 'pending')];
      final (_, sent) = await open(t, srv);
      await t.tap(find.widgetWithText(KButton, 'Dispatch'));
      await _sheetUp(t);
      await t.tap(find.text('Not yet'));
      await _sheetUp(t);
      expect(requestCount(sent, 'PATCH', '/api/stock-transfers/t1/dispatch'), 0);
    });

    testWidgets('Cancel is under More, asks first, PATCHes the website reason', (t) async {
      final (_, sent) = await open(t, _Srv());
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Cancel transfer'));
      await _sheetUp(t);
      expect(inSheet('Cancel TRF-1? It will not move any stock.'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/stock-transfers/t1/cancel'), 0);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Cancel transfer')));
      await _sheetUp(t);
      final patches = requestsOf(sent, 'PATCH', '/api/stock-transfers/t1/cancel').toList();
      expect(patches, hasLength(1));
      expectNoIdentity(patches.single.data as Map);
      expect((patches.single.data as Map)['cancellation_reason'], 'Cancelled by user');
    });

    testWidgets('an already-done refusal reloads and says so neutrally; the screen shows the new state', (t) async {
      final srv = _Srv();
      final (_, sent) = await open(t, srv);
      srv.transfers[0] = {...srv.transfers[0], 'status': 'pending'};
      srv.actionReply = (409, {'error': 'Transfer is pending; it can no longer be approved.', 'code': 'TRANSFER_STATE_CHANGED'});
      await t.tap(find.widgetWithText(KButton, 'Approve'));
      await t.pumpAndSettle();
      expect(find.text('This transfer has already changed. Showing the latest.'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/stock-transfers/t1/approve'), 1);
      expect(find.widgetWithText(KButton, 'Dispatch'), findsOneWidget);
    });

    testWidgets('another refusal shows the server words and leaves the screen as it was', (t) async {
      final srv = _Srv()..transfers = [_tr(status: 'pending')];
      final (_, sent) = await open(t, srv);
      srv.actionReply = (400, {'error': 'Insufficient stock for item. Available: 2, Requested: 10'});
      await t.tap(find.widgetWithText(KButton, 'Dispatch'));
      await _sheetUp(t);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Dispatch')));
      await _sheetUp(t);
      expect(find.text('Insufficient stock for item. Available: 2, Requested: 10'), findsOneWidget);
      expect(find.widgetWithText(KButton, 'Dispatch'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/stock-transfers/t1/dispatch'), 1);
    });

    testWidgets('a completed transfer offers no action', (t) async {
      final srv = _Srv()..transfers = [_tr(status: 'completed')];
      await open(t, srv);
      expect(find.byType(KBottomBar), findsNothing);
      expect(find.byTooltip('More'), findsNothing);
    });

    testWidgets('a transfer that is not on the list any more says so', (t) async {
      final srv = _Srv();
      final (s, _) = srv.build();
      await pumpScreen(t, StockTransferDetailScreen(session: s, seed: _tr(id: 'gone')));
      expect(find.text('Transfer not found'), findsOneWidget);
    });
  });

  group('receive', () {
    Future<(AppSession, List<RequestOptions>)> open(WidgetTester t, _Srv srv) async {
      final r = srv.build();
      await pumpScreen(t, StockTransfersScreen(session: r.$1));
      await t.tap(find.text('TRF-1'));
      await t.pumpAndSettle();
      await t.tap(find.widgetWithText(KButton, 'Receive'));
      await t.pumpAndSettle();
      return r;
    }

    _Srv inTransit() => _Srv()
      ..transfers = [_tr(status: 'in_transit')]
      ..items = {
        't1': [_item(dispatched: '10.000'), _item(id: 'ti2', itemId: 'i2', name: 'Soap', requested: '4.00', dispatched: '4.000')],
      };

    testWidgets('sends per-line received quantities once, with no identity', (t) async {
      final (_, sent) = await open(t, inTransit());
      expect(find.text('Receive transfer'), findsWidgets);
      await t.enterText(textFieldLabelled('Received quantity').first, '8');
      await t.pumpAndSettle();
      expect(find.textContaining('2 PCS less than dispatched'), findsOneWidget);
      await t.tap(find.text('Confirm receipt'));
      await t.tap(find.text('Confirm receipt'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/stock-transfers/t1/receive').toList();
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body['received_items'], [
        {'item_id': 'i1', 'received_qty': 8, 'qty': 8},
        {'item_id': 'i2', 'received_qty': 4, 'qty': 4},
      ]);
      expect(body['notes'], isNull);
      expectNoIdentity(body);
      expect(find.byType(StockTransferReceiveScreen), findsNothing);
    });

    testWidgets('receiving more than was sent is refused before any request', (t) async {
      final (_, sent) = await open(t, inTransit());
      await t.enterText(textFieldLabelled('Received quantity').first, '11');
      await t.pumpAndSettle();
      await t.tap(find.text('Confirm receipt'));
      await t.pumpAndSettle();
      expect(find.text('Cannot receive more than dispatched for item "Rice". Dispatched: 10, Received: 11'), findsWidgets);
      expect(requestCount(sent, 'POST', '/api/stock-transfers/t1/receive'), 0);
      expect(find.byType(StockTransferReceiveScreen), findsOneWidget);
    });

    testWidgets('a refusal by the server keeps the form filled', (t) async {
      final srv = inTransit();
      final (_, sent) = await open(t, srv);
      srv.actionReply = (400, {'error': 'Cannot receive more than dispatched. Dispatched: 10, Received: 10'});
      await t.enterText(textFieldLabelled('Received quantity').first, '9');
      await t.pumpAndSettle();
      await t.tap(find.text('Confirm receipt'));
      await t.pumpAndSettle();
      expect(find.text('Cannot receive more than dispatched. Dispatched: 10, Received: 10'), findsOneWidget);
      expect(find.byType(StockTransferReceiveScreen), findsOneWidget);
      expect(find.text('9'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/stock-transfers/t1/receive'), 1);
    });

    testWidgets('an already-received refusal closes the screen and reloads the transfer', (t) async {
      final srv = inTransit();
      final (_, sent) = await open(t, srv);
      srv.transfers[0] = {...srv.transfers[0], 'status': 'completed'};
      srv.actionReply = (409, {'error': 'Transfer is completed; only in-transit transfers can be received.', 'code': 'TRANSFER_STATE_CHANGED'});
      await t.tap(find.text('Confirm receipt'));
      await t.pumpAndSettle();
      expect(find.byType(StockTransferReceiveScreen), findsNothing);
      expect(find.text('This transfer has already changed. Showing the latest.'), findsOneWidget);
      expect(find.widgetWithText(KButton, 'Receive'), findsNothing);
      expect(requestCount(sent, 'POST', '/api/stock-transfers/t1/receive'), 1);
    });
  });

  group('close the shortfall', () {
    Future<(AppSession, List<RequestOptions>)> open(WidgetTester t, _Srv srv) async {
      final r = srv.build();
      await pumpScreen(t, StockTransfersScreen(session: r.$1));
      await t.tap(find.text('TRF-1'));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Close shortfall'));
      await t.pumpAndSettle();
      return r;
    }

    _Srv inTransit() => _Srv()
      ..transfers = [_tr(status: 'in_transit')]
      ..items = {
        't1': [_item(dispatched: '10.000', received: '6.000')],
      };

    testWidgets('asks first, then posts {date, lines} once with no identity', (t) async {
      final (_, sent) = await open(t, inTransit());
      expect(find.text('4 still in transit'), findsOneWidget);
      await t.enterText(textFieldLabelled('Quantity that never arrived').first, '3');
      await t.pumpAndSettle();
      await t.tap(find.text('Write off'));
      await _sheetUp(t);
      expect(requestCount(sent, 'POST', '/api/stock-transfers/t1/close-short'), 0);
      expect(inSheet('Write off 3 PCS of Rice as lost in transit? Their input tax credit is reversed and this cannot be undone.'), findsOneWidget);
      final yes = find.descendant(of: find.byType(BottomSheet), matching: find.text('Write off'));
      await t.tap(yes);
      await t.tap(yes, warnIfMissed: false);
      await _sheetUp(t);
      final posts = requestsOf(sent, 'POST', '/api/stock-transfers/t1/close-short').toList();
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body['date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expect(body['lines'], [
        {'item_id': 'i1', 'qty': 3, 'reason': 'transit_loss', 'claim_party': null, 'claim_amount': null},
      ]);
      expect(body.keys.toSet(), {'date', 'lines'});
    });

    testWidgets('keeping the goods posts nothing', (t) async {
      final (_, sent) = await open(t, inTransit());
      await t.tap(find.text('Write off'));
      await _sheetUp(t);
      await t.tap(find.text('Go back'));
      await _sheetUp(t);
      expect(requestCount(sent, 'POST', '/api/stock-transfers/t1/close-short'), 0);
    });

    testWidgets('a refusal shows the server words and keeps the form', (t) async {
      final srv = inTransit();
      final (_, sent) = await open(t, srv);
      srv.actionReply = (409, {'error': 'Rice: only 4 is still in transit.', 'code': 'GODOWN_STOCK'});
      await t.tap(find.text('Write off'));
      await _sheetUp(t);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Write off')));
      await _sheetUp(t);
      expect(find.text('Rice: only 4 is still in transit.'), findsOneWidget);
      expect(find.byType(StockTransferCloseShortScreen), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/stock-transfers/t1/close-short'), 1);
    });
  });

  group('new transfer', () {
    Future<void> pickWarehouse(WidgetTester t, String label, String name) async {
      await t.tap(_pick(label));
      await t.pumpAndSettle();
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text(name)));
      await t.pumpAndSettle();
    }

    Future<void> fill(WidgetTester t, {String from = 'Main godown (MG)', String to = 'Back room'}) async {
      await pickWarehouse(t, 'From warehouse', from);
      await pickWarehouse(t, 'To warehouse', to);
      await t.tap(_pick('Item').first);
      await t.pumpAndSettle();
      await t.tap(find.text('Rice').last);
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Quantity'), '5');
      await t.pumpAndSettle();
    }

    testWidgets('posts once with both warehouse ids and the line, and no identity', (t) async {
      final (s, sent) = _Srv().build();
      await pumpScreen(t, StockTransferFormScreen(session: s));
      expect(requestCount(sent, 'GET', '/api/warehouses'), 1);
      await fill(t);
      await t.tap(find.text('Create transfer'));
      await t.tap(find.text('Create transfer'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/stock-transfers').toList();
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body['from_location_id'], 'w1');
      expect(body['to_location_id'], 'w2');
      expect(body['items'], [
        {'item_id': 'i1', 'qty': 5, 'unit': 'KG', 'notes': null},
      ]);
      expect(body['transfer_number'], matches(RegExp(r'^TRF-\d{8}-001$')));
      expect(body['transfer_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expectNoIdentity(body);
    });

    testWidgets('a refusal keeps the form filled', (t) async {
      final srv = _Srv()..createReply = (400, {'error': 'Warehouse not found', 'code': 'WAREHOUSE_NOT_FOUND'});
      final (s, sent) = srv.build();
      await pumpScreen(t, StockTransferFormScreen(session: s));
      await fill(t);
      await t.tap(find.text('Create transfer'));
      await t.pumpAndSettle();
      expect(find.text('Warehouse not found'), findsOneWidget);
      expect(find.byType(StockTransferFormScreen), findsOneWidget);
      expect(find.text('Main godown (MG)'), findsOneWidget);
      expect(find.text('5'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/stock-transfers'), 1);
    });

    testWidgets('the same warehouse on both ends is refused before any request', (t) async {
      final (s, sent) = _Srv().build();
      await pumpScreen(t, StockTransferFormScreen(session: s));
      await fill(t, to: 'Main godown (MG)');
      await t.tap(find.text('Create transfer'));
      await t.pumpAndSettle();
      expect(find.text('Source and destination warehouses cannot be the same'), findsWidgets);
      expect(requestCount(sent, 'POST', '/api/stock-transfers'), 0);
    });

    testWidgets('a plan refusal on the warehouses is said, not an empty form', (t) async {
      final srv = _Srv()..warehousesReply = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'});
      final (s, _) = srv.build();
      await pumpScreen(t, StockTransferFormScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('a warehouse list that fails offers Try again', (t) async {
      final srv = _Srv()..warehousesReply = (500, {'error': 'Boom'});
      final (s, _) = srv.build();
      await pumpScreen(t, StockTransferFormScreen(session: s));
      expect(find.text('Try again'), findsOneWidget);
      srv.warehousesReply = null;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Create transfer'), findsOneWidget);
    });
  });

  group('routes', () {
    test('the stock transfers link opens the phone screen and is no longer generic', () {
      final (s, _) = _Srv().build();
      expect(nativeScreenFor(s, '/stock-transfers'), isA<StockTransfersScreen>());
      expect(nativeScreenFor(s, '/stock-transfers/new'), isA<StockTransferFormScreen>());
    });
  });
}
