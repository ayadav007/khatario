import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/stock/adjustment_form_screen.dart';
import 'package:khatario_phone/screens/stock/adjustments_screen.dart';
import 'package:khatario_phone/screens/stock/repack_form_screen.dart';
import 'package:khatario_phone/screens/stock/stock_logic.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/finders.dart';
import 'support/recorded_session.dart';

Map<String, dynamic> _adj({String id = 'a1', String number = 'ADJ-1', String reason = 'DAMAGE', String? repackId, String type = 'QUANTITY'}) => {
      'id': id,
      'adjustment_number': number,
      'adjustment_date': '2026-11-01',
      'adjustment_type': type,
      'direction': 'DECREASE',
      'item_id': 'i1',
      'item_name': 'Rice',
      'item_code': 'RC',
      'item_unit': 'KG',
      'variant_name': null,
      'location_name': 'Main godown',
      'quantity_before': '10.000',
      'quantity_after': '8.000',
      'quantity_change': '-2.000',
      'unit_cost_before': '40.00',
      'unit_cost_after': '40.00',
      'total_value_before': '400.00',
      'total_value_after': '320.00',
      'reason_code': reason,
      'reason_notes': 'Wet bags',
      'notes': null,
      'repack_id': repackId,
      'created_by_name': 'Asha',
      'created_at': '2026-11-01T05:00:00.000Z',
    };

Map<String, dynamic> _repack({String id = 'r1', String status = 'posted'}) => {
      'id': id,
      'repack_number': 'RPK-1',
      'repack_date': '2026-11-02',
      'status': status,
      'source_item_id': 'bulk',
      'source_name': 'Rice',
      'source_unit': 'KG',
      'source_qty': 10,
      'packed_item_id': 'pack',
      'packed_name': 'Rice 1 kg pack',
      'packed_unit': 'PCS',
      'packed_qty': 9,
      'content_per_unit': 1,
      'wastage_qty': 1,
      'wastage_reason': 'SPILLAGE',
      'wastage_notes': null,
      'notes': null,
      'total_cost': 400,
      'unit_cost': 44.44,
      'location_name': 'Main godown',
      'branch_name': null,
      'created_by_name': 'Asha',
    };

class _Srv {
  List<Map<String, dynamic>> adjustments = [_adj()];
  List<Map<String, dynamic>> repacks = [_repack()];
  Map<String, dynamic> item = {'id': 'i1', 'name': 'Rice', 'unit': 'KG', 'current_stock': '12', 'has_variants': false, 'variants': []};
  Map<String, dynamic> itemFull = {'id': 'i1', 'track_batch': false, 'track_serial': false};
  bool warehouses = false;
  Reply? listReply, postReply, cancelReply;
  Reply? repackPostReply;
  Reply Function()? onPostAdjustment;
  Map<String, dynamic> prefill = {
    'source': {'id': 'bulk', 'name': 'Rice', 'unit': 'KG', 'stock': 50, 'unit_cost': 40, 'pack_source_item_id': null, 'pack_source_qty': null},
    'packed': {'id': 'pack', 'name': 'Rice 1 kg pack', 'unit': 'PCS', 'stock': 3, 'pack_source_item_id': 'bulk', 'pack_source_qty': 1},
    'content_per_unit': 1,
    'last': {'source_qty': 10, 'packed_qty': 9, 'wastage_reason': 'SPILLAGE'},
    'vendor_units': [],
  };

  (AppSession, List<RequestOptions>) build() => recordedSession((o, body) {
        final p = o.uri.path;
        if (o.method == 'GET') {
          if (p == '/api/inventory-adjustments') {
            return listReply ??
                (200, {'adjustments': adjustments, 'pagination': {'page': 1, 'limit': 50, 'total': adjustments.length, 'totalPages': 1}});
          }
          if (p == '/api/inventory-adjustments/repacks') return listReply ?? (200, {'repacks': repacks});
          if (p == '/api/inventory-adjustments/repacks/prefill') return (200, prefill);
          if (p == '/api/inventory-adjustments/repacks/r1') return (200, {'repack': repacks.isEmpty ? _repack() : repacks.first});
          if (p.startsWith('/api/inventory-adjustments/')) return (200, {'adjustment': adjustments.first});
          if (p == '/api/settings/warehouses') return (200, {'warehouses_enabled': warehouses});
          if (p == '/api/warehouses') {
            return (200, {'warehouses': [{'id': 'w1', 'name': 'Main godown'}, {'id': 'w2', 'name': 'Back room'}]});
          }
          if (p == '/api/items/search') return (200, {'items': [item]});
          if (p.startsWith('/api/items/')) return (200, {'item': itemFull, 'variants': []});
        }
        if (o.method == 'POST') {
          if (p == '/api/inventory-adjustments') {
            return onPostAdjustment?.call() ??
                postReply ??
                (201, {'success': true, 'adjustment': {'adjustmentNumber': 'ADJ-9', 'quantityBefore': 12, 'quantityAfter': 7}});
          }
          if (p == '/api/inventory-adjustments/repacks') {
            return repackPostReply ?? (201, {'success': true, 'repack': {'id': 'r9', 'repackNumber': 'RPK-9'}});
          }
          if (p == '/api/inventory-adjustments/repacks/r1/cancel') {
            return cancelReply ?? (200, {'success': true, 'repack': _repack(status: 'cancelled')});
          }
        }
        return (404, {'error': 'not faked: ${o.method} $p'});
      });
}

final _repackButton = find.widgetWithText(KButton, 'Repack');

Finder _pick(String label) => find.byWidgetPredicate((w) => w is KAsyncPickField && w.label == label);

Future<void> _pickItem(WidgetTester t, {String label = 'Item', String name = 'Rice'}) async {
  await t.tap(_pick(label).first);
  await t.pumpAndSettle();
  await t.tap(find.text(name).last);
  await t.pumpAndSettle();
}

/// A detail action in flight keeps the bottom button spinning, so settle by time.
Future<void> _sheetUp(WidgetTester t) async {
  await t.pump();
  await t.pump(const Duration(seconds: 1));
}

void main() {
  group('stock logic', () {
    test('an add line posts the website body: QUANTITY, INCREASE, no identity keys', () {
      final body = adjustmentBody(
        itemId: 'i1',
        direction: 'INCREASE',
        quantity: 5,
        reason: 'STOCK_TAKE',
        date: DateTime(2026, 11, 10),
        branchId: 'br1',
      );
      expect(body, {
        'adjustment_type': 'QUANTITY',
        'adjustment_date': '2026-11-10',
        'item_id': 'i1',
        'direction': 'INCREASE',
        'quantity': 5,
        'reason_code': 'STOCK_TAKE',
        'branch_id': 'br1',
      });
    });

    test('a reduce line with a variant, warehouse and notes; a batch is sent only when stock is added', () {
      final reduce = adjustmentBody(
        itemId: 'i1',
        variantId: 'v1',
        direction: 'DECREASE',
        quantity: 2.5,
        reason: 'DAMAGE',
        reasonNotes: ' Wet bags ',
        notes: 'Monsoon',
        date: DateTime(2026, 11, 10),
        locationId: 'w1',
        branchId: 'br1',
        batch: {'batch_number': 'B1'},
      );
      expect(reduce['variant_id'], 'v1');
      expect(reduce['direction'], 'DECREASE');
      expect(reduce['quantity'], 2.5);
      expect(reduce['reason_notes'], 'Wet bags');
      expect(reduce['notes'], 'Monsoon');
      expect(reduce['location_id'], 'w1');
      expect(reduce.containsKey('branch_id'), isFalse, reason: 'a warehouse replaces the branch');
      expect(reduce.containsKey('batch'), isFalse);
      final add = adjustmentBody(
        itemId: 'i1',
        direction: 'INCREASE',
        quantity: 2,
        reason: 'STOCK_TAKE',
        date: DateTime(2026, 11, 10),
        batch: {'batch_number': 'B1', 'expiry_date': '2027-01'},
      );
      expect(add['batch'], {'batch_number': 'B1', 'expiry_date': '2027-01'});
      for (final k in ['business_id', 'user_id', 'created_by']) {
        expect(add.containsKey(k), isFalse);
        expect(reduce.containsKey(k), isFalse);
      }
    });

    test('the form offers the website quantity reasons with the website words', () {
      expect(kAdjustReasons.map((r) => r.$1), ['STOCK_TAKE', 'DAMAGE', 'THEFT', 'EXPIRED', 'FREE_SAMPLE']);
      expect(adjustmentReasonLabel('STOCK_TAKE'), 'Stock take');
      expect(adjustmentReasonLabel('COST_CORRECTION'), 'Cost correction');
      expect(adjustmentReasonLabel('REPACK_OUT'), 'Repacked out');
      expect(adjustmentReasonLabel('REPACK_IN'), 'Repacked in');
      expect(adjustmentReasonLabel('OWN_CONSUMPTION'), 'Own consumption');
    });

    test('rows read as the server sends them', () {
      expect(adjustmentTitle(_adj()), 'ADJ-1');
      expect(adjustmentSubtitle(_adj()), contains('Rice'));
      expect(adjustmentSubtitle(_adj()), contains('Damage'));
      expect(adjustmentSubtitle(_adj()), contains('-2 KG'));
      expect(adjustmentRepackId(_adj()), isNull);
      expect(adjustmentRepackId(_adj(repackId: 'r1')), 'r1');
    });

    test('an item that tracks serial numbers is blocked; batch items are not', () {
      expect(adjustItemBlocked({'track_serial': true}), isTrue);
      expect(adjustItemBlocked({'track_serial': false, 'track_batch': true}), isFalse);
      expect(adjustItemBlockedText, 'Adjust this item on the website');
    });

    test('repack body is the website one; wastage and its reason only when something is lost', () {
      final body = repackBody(
        sourceId: 'bulk',
        packedId: 'pack',
        sourceQty: 10,
        packedQty: 9,
        content: 1,
        wastage: 1,
        reason: 'OTHER',
        wastageNotes: ' Mice ',
        notes: ' ',
        date: DateTime(2026, 11, 10),
        locationId: 'w1',
        branchId: 'br1',
      );
      expect(body, {
        'source_item_id': 'bulk',
        'packed_item_id': 'pack',
        'source_qty': 10,
        'packed_qty': 9,
        'content_per_unit': 1,
        'wastage_reason': 'OTHER',
        'wastage_notes': 'Mice',
        'notes': null,
        'repack_date': '2026-11-10',
        'location_id': 'w1',
      });
      final clean = repackBody(
        sourceId: 'bulk',
        packedId: 'pack',
        sourceQty: 9,
        packedQty: 9,
        content: 1,
        wastage: 0,
        reason: 'SPILLAGE',
        date: DateTime(2026, 11, 10),
        branchId: 'br1',
      );
      expect(clean['wastage_reason'], isNull);
      expect(clean['wastage_notes'], isNull);
      expect(clean['branch_id'], 'br1');
      expect(clean.containsKey('location_id'), isFalse);
    });

    test('wastage is what went in minus what the packs hold', () {
      expect(repackWastage(10, 9, 1), 1);
      expect(repackWastage(9, 9, 1), 0);
      expect(repackWastage(10, 3, 0.333), 9.001);
      expect(kWastageReasons.map((r) => r.$2), ['Spillage', 'Drying / moisture', 'Packet weight', 'Other']);
    });

    test('cancel names the repack and what it reverses', () {
      expect(repackCancelText(_repack()), 'RPK-1: put back 10 KG of Rice and remove 9 Rice 1 kg pack?');
      expect(repackCanCancel(_repack()), isTrue);
      expect(repackCanCancel(_repack(status: 'cancelled')), isFalse);
    });
  });

  group('adjustments list', () {
    testWidgets('loads adjustments, no business id; the Repacks switch loads repacks', (t) async {
      final (s, sent) = _Srv().build();
      await pumpScreen(t, AdjustmentsScreen(session: s));
      expect(find.text('ADJ-1'), findsOneWidget);
      expect(requestsOf(sent, 'GET', '/api/inventory-adjustments').first.uri.queryParameters.containsKey('business_id'), isFalse);
      await t.tap(find.text('Repacks'));
      await t.pumpAndSettle();
      expect(find.text('RPK-1'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/inventory-adjustments/repacks'), 1);
    });

    testWidgets('a row opens the adjustment with the server figures', (t) async {
      final (s, sent) = _Srv().build();
      await pumpScreen(t, AdjustmentsScreen(session: s));
      await t.tap(find.text('ADJ-1'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'GET', '/api/inventory-adjustments/a1'), 1);
      expect(find.text('Wet bags'), findsOneWidget);
      expect(find.text('Main godown'), findsOneWidget);
      expect(find.text('Damage'), findsWidgets);
    });

    testWidgets('a repack leg opens its repack, as the website does', (t) async {
      final srv = _Srv()..adjustments = [_adj(reason: 'REPACK_OUT', repackId: 'r1')];
      final (s, sent) = srv.build();
      await pumpScreen(t, AdjustmentsScreen(session: s));
      await t.tap(find.text('ADJ-1'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'GET', '/api/inventory-adjustments/repacks/r1'), 1);
      expect(requestCount(sent, 'GET', '/api/inventory-adjustments/a1'), 0);
      expect(find.text('Took out'), findsOneWidget);
    });

    testWidgets('empty, error with Try again, and plan refusal are each handled', (t) async {
      final empty = _Srv()..adjustments = [];
      var (s, _) = empty.build();
      await pumpScreen(t, AdjustmentsScreen(session: s));
      expect(find.text('No adjustments yet'), findsOneWidget);

      final bad = _Srv()..listReply = (500, {'error': 'Boom'});
      (s, _) = bad.build();
      await pumpScreen(t, AdjustmentsScreen(session: s));
      expect(find.text('Try again'), findsOneWidget);
      bad.listReply = null;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('ADJ-1'), findsOneWidget);

      final plan = _Srv()..listReply = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'});
      (s, _) = plan.build();
      await pumpScreen(t, AdjustmentsScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });

  group('repack detail and cancel', () {
    Future<(AppSession, List<RequestOptions>)> open(WidgetTester t, _Srv srv) async {
      final r = srv.build();
      await pumpScreen(t, AdjustmentsScreen(session: r.$1));
      await t.tap(find.text('Repacks'));
      await t.pumpAndSettle();
      await t.tap(find.text('RPK-1'));
      await t.pumpAndSettle();
      return r;
    }

    testWidgets('cancel asks first, posts once even on a double tap, then shows it cancelled', (t) async {
      final (_, sent) = await open(t, _Srv());
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Cancel repack'));
      await _sheetUp(t);
      expect(inSheet('RPK-1: put back 10 KG of Rice and remove 9 Rice 1 kg pack?'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/inventory-adjustments/repacks/r1/cancel'), 0);
      final yes = find.descendant(of: find.byType(BottomSheet), matching: find.text('Cancel repack'));
      await t.tap(yes);
      await t.tap(yes, warnIfMissed: false);
      await _sheetUp(t);
      expect(requestCount(sent, 'POST', '/api/inventory-adjustments/repacks/r1/cancel'), 1);
    });

    testWidgets('keeping the repack posts nothing', (t) async {
      final (_, sent) = await open(t, _Srv());
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Cancel repack'));
      await _sheetUp(t);
      await t.tap(find.text('Keep repack'));
      await _sheetUp(t);
      expect(requestCount(sent, 'POST', '/api/inventory-adjustments/repacks/r1/cancel'), 0);
    });

    testWidgets('a refusal (stock already used) is shown as the server words it', (t) async {
      final srv = _Srv()..cancelReply = (409, {'error': 'Rice 1 kg pack already sold; cannot put it back', 'code': 'STOCK_USED'});
      final (_, sent) = await open(t, srv);
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Cancel repack'));
      await _sheetUp(t);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Cancel repack')));
      await _sheetUp(t);
      expect(find.text('Rice 1 kg pack already sold; cannot put it back'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/inventory-adjustments/repacks/r1/cancel'), 1);
    });
  });

  group('adjustment form', () {
    Future<void> fill(WidgetTester t, {String qty = '5'}) async {
      await _pickItem(t);
      await t.enterText(textFieldLabelled('Quantity'), qty);
      await t.pumpAndSettle();
    }

    testWidgets('posts the website body once, with a retry key and no identity', (t) async {
      final (s, sent) = _Srv().build();
      await pumpScreen(t, AdjustmentFormScreen(session: s));
      await fill(t);
      await t.tap(find.text('Reduce stock'));
      await t.pumpAndSettle();
      await t.tap(find.text('Save adjustment'));
      await t.tap(find.text('Save adjustment'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/inventory-adjustments').toList();
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body['adjustment_type'], 'QUANTITY');
      expect(body['direction'], 'DECREASE');
      expect(body['quantity'], 5);
      expect(body['item_id'], 'i1');
      expect(body['reason_code'], 'STOCK_TAKE');
      expect(body['adjustment_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expectNoIdentity(body);
      expect(posts.single.headers['X-Idempotency-Key'], isNotEmpty);
    });

    testWidgets('a refused save keeps the form filled; trying again reuses the retry key', (t) async {
      final srv = _Srv()..postReply = (400, {'error': 'Stock cannot go below zero'});
      final (s, sent) = srv.build();
      await pumpScreen(t, AdjustmentFormScreen(session: s));
      await fill(t, qty: '50');
      await t.tap(find.text('Save adjustment'));
      await t.pumpAndSettle();
      expect(find.text('Stock cannot go below zero'), findsOneWidget);
      expect(find.widgetWithText(TextField, '50'), findsOneWidget);
      expect(find.text('Rice'), findsWidgets);
      srv.postReply = null;
      await t.tap(find.text('Save adjustment'));
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/inventory-adjustments').toList();
      expect(posts, hasLength(2));
      expect(posts[1].headers['X-Idempotency-Key'], posts[0].headers['X-Idempotency-Key']);
    });

    testWidgets('a plan refusal on save shows the server message', (t) async {
      final srv = _Srv()..postReply = (403, {'error': 'Inventory adjustments are not in your plan', 'code': 'FEATURE_NOT_IN_PLAN'});
      final (s, _) = srv.build();
      await pumpScreen(t, AdjustmentFormScreen(session: s));
      await fill(t);
      await t.tap(find.text('Save adjustment'));
      await t.pumpAndSettle();
      expect(find.text('Inventory adjustments are not in your plan'), findsOneWidget);
    });

    testWidgets('an item that tracks serials is blocked; nothing is sent', (t) async {
      final srv = _Srv()..itemFull = {'id': 'i1', 'track_batch': false, 'track_serial': true};
      final (s, sent) = srv.build();
      await pumpScreen(t, AdjustmentFormScreen(session: s));
      await _pickItem(t);
      expect(find.text('Adjust this item on the website'), findsOneWidget);
      expect(find.text('Quantity'), findsNothing);
      await t.tap(find.text('Save adjustment'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/inventory-adjustments'), 0);
    });

    testWidgets('a batch item collects the batch when stock is added and sends it', (t) async {
      final srv = _Srv()..itemFull = {'id': 'i1', 'track_batch': true, 'track_serial': false};
      final (s, sent) = srv.build();
      await pumpScreen(t, AdjustmentFormScreen(session: s));
      await fill(t, qty: '4');
      await t.enterText(textFieldLabelled('Batch number'), 'B-7');
      await t.enterText(textFieldLabelled('Expiry (YYYY-MM-DD or YYYY-MM)'), '2027-03');
      await t.pumpAndSettle();
      await t.tap(find.text('Save adjustment'));
      await t.pumpAndSettle();
      final body = lastBody(sent, 'POST', '/api/inventory-adjustments');
      expect(body['direction'], 'INCREASE');
      expect(body['batch'], {'batch_number': 'B-7', 'expiry_date': '2027-03'});
    });

    testWidgets('batch fields are not offered when reducing', (t) async {
      final srv = _Srv()..itemFull = {'id': 'i1', 'track_batch': true, 'track_serial': false};
      final (s, _) = srv.build();
      await pumpScreen(t, AdjustmentFormScreen(session: s));
      await fill(t);
      expect(find.text('Batch number'), findsOneWidget);
      await t.tap(find.text('Reduce stock'));
      await t.pumpAndSettle();
      expect(find.text('Batch number'), findsNothing);
    });

    testWidgets('a quantity is needed; a second item is a second line posted on its own key', (t) async {
      final (s, sent) = _Srv().build();
      await pumpScreen(t, AdjustmentFormScreen(session: s));
      await _pickItem(t);
      await t.tap(find.text('Save adjustment'));
      await t.pumpAndSettle();
      expect(find.text('Enter a quantity greater than zero'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/inventory-adjustments'), 0);
      await t.enterText(textFieldLabelled('Quantity'), '1');
      await t.tap(find.text('Add another item'));
      await t.pumpAndSettle();
      await t.tap(_pick('Item').last);
      await t.pumpAndSettle();
      await t.tap(find.text('Rice').last);
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Quantity').last, '2');
      await t.pumpAndSettle();
      await t.tap(find.text('Save adjustment'));
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/inventory-adjustments').toList();
      expect(posts, hasLength(2));
      expect(posts[0].headers['X-Idempotency-Key'], isNot(posts[1].headers['X-Idempotency-Key']));
    });

    testWidgets('with warehouses on, a warehouse is needed and goes as location_id', (t) async {
      final srv = _Srv()..warehouses = true;
      final (s, sent) = srv.build();
      await pumpScreen(t, AdjustmentFormScreen(session: s));
      await fill(t);
      await t.tap(find.text('Save adjustment'));
      await t.pumpAndSettle();
      expect(find.text('Select a warehouse'), findsWidgets);
      expect(requestCount(sent, 'POST', '/api/inventory-adjustments'), 0);
      await t.tap(find.byWidgetPredicate((w) => w is KPickField && w.label == 'Warehouse'));
      await t.pumpAndSettle();
      await t.tap(find.text('Back room').last);
      await t.pumpAndSettle();
      await t.tap(find.text('Save adjustment'));
      await t.pumpAndSettle();
      expect(lastBody(sent, 'POST', '/api/inventory-adjustments')['location_id'], 'w2');
    });
  });

  group('repack form', () {
    testWidgets('picking an item fills the form from the server, then posts once', (t) async {
      final (s, sent) = _Srv().build();
      await pumpScreen(t, RepackFormScreen(session: s));
      await _pickItem(t, label: 'From');
      expect(requestCount(sent, 'GET', '/api/inventory-adjustments/repacks/prefill'), 1);
      expect(requestsOf(sent, 'GET', '/api/inventory-adjustments/repacks/prefill').single.uri.queryParameters['item_id'], 'i1');
      expect(find.text('Rice 1 kg pack'), findsOneWidget);
      expect(find.widgetWithText(TextField, '10'), findsOneWidget);
      expect(find.widgetWithText(TextField, '9'), findsOneWidget);
      await t.tap(_repackButton);
      await t.tap(_repackButton, warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/inventory-adjustments/repacks').toList();
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body['source_item_id'], 'bulk');
      expect(body['packed_item_id'], 'pack');
      expect(body['source_qty'], 10);
      expect(body['packed_qty'], 9);
      expect(body['content_per_unit'], 1);
      expect(body['wastage_reason'], 'SPILLAGE');
      expectNoIdentity(body);
    });

    testWidgets('packing more than was taken out is refused before sending', (t) async {
      final srv = _Srv();
      srv.prefill = {...srv.prefill, 'last': null};
      final (s, sent) = srv.build();
      await pumpScreen(t, RepackFormScreen(session: s));
      await _pickItem(t, label: 'From');
      await t.enterText(textFieldLabelled('Take out (KG)'), '5');
      await t.enterText(textFieldLabelled('Made'), '9');
      await t.pumpAndSettle();
      expect(find.text('Packed more than you took out; check the numbers.'), findsOneWidget);
      await t.tap(_repackButton, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/inventory-adjustments/repacks'), 0);
    });

    testWidgets('a refused repack shows the server message and keeps the form', (t) async {
      final srv = _Srv()..repackPostReply = (400, {'error': 'Not enough Rice in stock', 'code': 'INSUFFICIENT_STOCK'});
      final (s, _) = srv.build();
      await pumpScreen(t, RepackFormScreen(session: s));
      await _pickItem(t, label: 'From');
      await t.tap(_repackButton);
      await t.pumpAndSettle();
      expect(find.text('Not enough Rice in stock'), findsOneWidget);
      expect(find.widgetWithText(TextField, '10'), findsOneWidget);
    });

    testWidgets('a failed prefill says so and leaves the form empty', (t) async {
      final (s, sent) = recordedSession((o, body) {
        if (o.uri.path == '/api/inventory-adjustments/repacks/prefill') return (400, {'error': 'Item not found'});
        if (o.uri.path == '/api/items/search') {
          return (200, {'items': [{'id': 'i1', 'name': 'Rice', 'unit': 'KG'}]});
        }
        if (o.uri.path == '/api/settings/warehouses') return (200, {'warehouses_enabled': false});
        return (404, {'error': 'x'});
      });
      await pumpScreen(t, RepackFormScreen(session: s));
      await _pickItem(t, label: 'From');
      expect(find.text('Item not found'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/inventory-adjustments/repacks'), 0);
    });
  });

  group('routes', () {
    test('the adjustments links open the phone screens', () {
      final (s, _) = _Srv().build();
      expect(nativeScreenFor(s, '/inventory-adjustments'), isA<AdjustmentsScreen>());
      expect(nativeScreenFor(s, '/inventory-adjustments/new'), isA<AdjustmentFormScreen>());
      expect(nativeScreenFor(s, '/inventory-adjustments/repacks/new'), isA<RepackFormScreen>());
    });
  });
}
