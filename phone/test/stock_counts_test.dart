import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/stock/stock_count_logic.dart';
import 'package:khatario_phone/screens/stock/stock_count_screen.dart';
import 'package:khatario_phone/screens/stock/stock_counts_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _line({
  String id = 'i1',
  String name = 'Rice',
  num? physical,
  bool recount = false,
  bool recounted = false,
  num? difference,
  num book = 10,
}) =>
    {
      'item_id': id,
      'item_name': name,
      'item_code': 'R1',
      'unit': 'KG',
      'book_qty': book,
      'with_third_party_qty': 0,
      'in_transit_qty': 0,
      'held_qty': 0,
      'expected_qty': book,
      'physical_qty': physical,
      'third_party_qty': 0,
      'difference': difference,
      'difference_value': difference == null ? null : difference * 50,
      'recount_required': recount,
      'recounted': recounted,
      'first_count_qty': null,
      'reason_code': null,
      'reason_notes': null,
      'needs_reason': false,
    };

Map<String, dynamic> _countRow({String id = 'c1', String number = 'SC-1', String status = 'counting'}) => {
      'id': id,
      'count_number': number,
      'count_date': '2026-11-05',
      'status': status,
      'blind': true,
      'freeze_stock': true,
      'warehouse_id': 'w1',
      'warehouse_name': 'Main godown',
      'branch_name': null,
      'lines': 2,
      'counted': 0,
    };

class _Srv {
  String status = 'counting';
  List<Map<String, dynamic>> lines = [_line(), _line(id: 'i2', name: 'Soap')];
  List<Map<String, dynamic>> counts = [_countRow()];
  Map<String, dynamic> barcodes = {
    '890': {'item_id': 'i1', 'qty': 1, 'label': 'Rice (1 KG)'},
    'BOX1': {'item_id': 'i1', 'qty': 12, 'label': 'Rice (1 BOX = 12 KG)'},
  };
  List<Map<String, dynamic>> warehouses = [
    {'id': 'w1', 'name': 'Main godown', 'is_active': true},
    {'id': 'w2', 'name': 'Back room', 'is_active': true},
  ];
  Reply? listReply;
  Reply? patchReply;
  Reply? createReply;
  Reply? getReply;

  /// The next PATCH waits for this before it is answered (a save that is slow to come back).
  Completer<void>? gate;
  Reply? barcodesReply;

  Map<String, dynamic> reconciliation(String id) => {
        'count': {
          'id': id,
          'count_number': id == 'c9' ? 'SC-9' : 'SC-1',
          'count_date': '2026-11-05',
          'status': status,
          'warehouse_id': 'w1',
          'warehouse_name': 'Main godown',
          'freeze_stock': true,
        },
        'blind': status == 'counting',
        'lines': lines,
        'with_third_party': [
          {'challan_id': 'ch1', 'item_id': 'i1', 'item_name': 'Rice', 'party_name': 'Ravi', 'purpose': 'repair', 'qty': 2, 'days_out': 4, 'overdue': false, 'challan_number': 'DC-3'},
        ],
        'in_transit': [],
        'inward_transit': [],
        'held': [],
        'others_goods': [],
        'units': [
          {'item_id': 'i2', 'unit': 'BOX', 'factor_to_base': 12},
        ],
        'summary': {
          'book_qty': 100,
          'with_third_party_qty': 2,
          'in_transit_qty': 0,
          'expected_qty': 98,
          'physical_qty': 90,
          'unexplained_qty': -8,
          'shortage_value': 400,
          'excess_value': 0,
          'unproven': 0,
          'overdue_returns': 0,
          'held_qty': 0,
        },
        'classes': [],
      };

  void submit(bool fill) {
    status = 'review';
    lines = [
      for (final l in lines)
        () {
          final phys = l['physical_qty'] ?? (fill ? l['book_qty'] : null);
          final diff = phys == null ? null : (phys as num) - (l['book_qty'] as num);
          return {...l, 'physical_qty': phys, 'difference': diff, 'difference_value': diff == null ? null : diff * 50};
        }(),
    ];
  }

  (AppSession, List<RequestOptions>) build() => recordedSession((o, body) async {
        if (o.method == 'PATCH' && gate != null) {
          final g = gate!;
          gate = null;
          await g.future;
        }
        return _handle(o, body);
      });

  Reply _handle(RequestOptions o, Map body) {
        final p = o.uri.path;
        if (o.method == 'GET') {
          if (p == '/api/warehouses') return (200, {'warehouses': warehouses});
          if (p == '/api/stock-counts') return listReply ?? (200, {'counts': counts});
          final b = RegExp(r'^/api/stock-counts/([^/]+)/barcodes$').firstMatch(p);
          if (b != null) return barcodesReply ?? (200, {'barcodes': barcodes});
          final m = RegExp(r'^/api/stock-counts/([^/]+)$').firstMatch(p);
          if (m != null) return getReply ?? (200, reconciliation(m.group(1)!));
        }
        if (o.method == 'POST' && p == '/api/stock-counts') return createReply ?? (201, {'id': 'c9'});
        final m = RegExp(r'^/api/stock-counts/([^/]+)$').firstMatch(p);
        if (o.method == 'PATCH' && m != null) {
          if (patchReply != null) return patchReply!;
          switch (body['action']) {
            case 'count':
              final entries = body['entries'] as List;
              lines = [
                for (final l in lines)
                  () {
                    final e = entries.cast<Map>().where((e) => e['item_id'] == l['item_id']).firstOrNull;
                    return e == null ? l : {...l, 'physical_qty': e['physical_qty']};
                  }(),
              ];
              return (200, {'ok': true, 'saved': entries.length, 'recount': []});
            case 'submit':
              submit(body['fill_uncounted'] == 'book');
              return (200, {'ok': true});
            case 'post':
              status = 'posted';
              return (200, {'ok': true, 'adjustments': 1});
            case 'cancel':
              status = 'cancelled';
              return (200, {'ok': true});
            case 'reasons':
              return (200, {'ok': true});
          }
        }
        return (404, {'error': 'not faked: ${o.method} $p'});
  }
}

Future<void> _sheetUp(WidgetTester t) async {
  await t.pump();
  await t.pump(const Duration(seconds: 1));
}

Finder _pick(String label) => find.byWidgetPredicate((w) => w is KPickField && w.label == label);

Finder _field(String key) => find.descendant(of: find.byKey(ValueKey(key)), matching: find.byType(TextField));

String _text(WidgetTester t, String key) => t.widget<TextField>(_field(key)).controller!.text;

Future<void> _enter(WidgetTester t, String key, String value) async {
  await t.enterText(_field(key), value);
  await t.pump();
}

/// Past the save-as-you-go wait, and the save and reload it triggers.
Future<void> _autosave(WidgetTester t) async {
  await t.pump(const Duration(seconds: 2));
  await t.pumpAndSettle();
}

void main() {
  group('stock count logic', () {
    test('status chips and words are the website ones', () {
      expect(kCountFilters.map((f) => f.$1), ['', 'counting', 'review', 'posted', 'cancelled']);
      expect(countStatusLabel('counting'), 'Counting');
      expect(countStatusLabel('review'), 'In review');
      expect(countStatusLabel('posted'), 'Posted');
      expect(countStatusLabel('cancelled'), 'Cancelled');
      expect(countMatchesFilter({'status': 'review'}, ''), isTrue);
      expect(countMatchesFilter({'status': 'review'}, 'review'), isTrue);
      expect(countMatchesFilter({'status': 'posted'}, 'review'), isFalse);
    });

    test('a list row reads count number, godown, progress, status and date', () {
      final row = {
        'count_number': 'SC-1',
        'count_date': '2026-11-05',
        'status': 'counting',
        'warehouse_name': 'Main godown',
        'lines': 12,
        'counted': 3,
        'freeze_stock': true,
      };
      expect(countTitle(row), 'SC-1');
      expect(countSubtitle(row), 'Counting, stock frozen · Main godown · 3 of 12 counted · 05 Nov 2026');
      expect(countSubtitle({...row, 'status': 'posted'}), 'Posted · Main godown · 3 of 12 counted · 05 Nov 2026');
      expect(countSubtitle({...row, 'warehouse_name': null, 'branch_name': 'Head office'}), contains('Head office'));
    });

    test('opening a count sends the website fields with one godown, and no identity', () {
      final body = openCountBody(date: DateTime(2026, 11, 10), warehouseId: 'w1', branchId: 'b1', blind: true, freeze: false);
      expect(body, {'count_date': '2026-11-10', 'blind': true, 'freeze_stock': false, 'warehouse_id': 'w1'});
      expectNoIdentity(body);
      expect(openCountBody(date: DateTime(2026, 11, 10), branchId: 'b1', blind: true, freeze: true)['branch_id'], 'b1');
      final bare = openCountBody(date: DateTime(2026, 11, 10), blind: true, freeze: true);
      expect(bare.containsKey('warehouse_id'), isFalse);
      expect(bare.containsKey('branch_id'), isFalse);
    });

    test('action bodies are the website ones', () {
      final count = countEntriesBody([(itemId: 'i1', physical: 5, others: 0, unit: null), (itemId: 'i2', physical: 2.5, others: 1, unit: 'BOX')]);
      expect(count, {
        'action': 'count',
        'entries': [
          {'item_id': 'i1', 'physical_qty': 5, 'third_party_qty': 0, 'unit': null},
          {'item_id': 'i2', 'physical_qty': 2.5, 'third_party_qty': 1, 'unit': 'BOX'},
        ],
      });
      expectNoIdentity(count);
      expect(submitCountBody(), {'action': 'submit'});
      expect(submitCountBody(fillFromBooks: true), {'action': 'submit', 'fill_uncounted': 'book'});
      expect(postCountBody(), {'action': 'post'});
      expect(cancelCountBody(), {'action': 'cancel'});
      expect(
        reasonsBody([(itemId: 'i1', code: 'DAMAGE', notes: ' wet '), (itemId: 'i2', code: 'STOCK_TAKE', notes: ' ')]),
        {
          'action': 'reasons',
          'reasons': [
            {'item_id': 'i1', 'reason_code': 'DAMAGE', 'reason_notes': 'wet'},
            {'item_id': 'i2', 'reason_code': 'STOCK_TAKE', 'reason_notes': null},
          ],
        },
      );
    });

    test('barcodes are read from the reply, and a scan adds one unit or a whole box', () {
      final codes = parseCountBarcodes({
        'barcodes': {
          '890': {'item_id': 'i1', 'qty': 1, 'label': 'Rice (1 KG)'},
          'BOX1': {'item_id': 'i1', 'qty': '12', 'label': 'Rice (1 BOX = 12 KG)'},
          'bad': {'qty': 1},
        },
      });
      expect(codes.keys.toSet(), {'890', 'BOX1'});
      expect(codes['890']!.itemId, 'i1');
      expect(codes['BOX1']!.qty, 12);
      expect(codes['BOX1']!.label, 'Rice (1 BOX = 12 KG)');
      expect(parseCountBarcodes({'barcodes': []}), isEmpty);
      expect(parseCountBarcodes(null), isEmpty);
      expect(tallyAfterScan(2.1, 1.2), 3.3);
      expect(tallyAfterScan(0, 12), 12);
    });

    test('a line is counted, recounted, to count again or not counted, as the website says', () {
      expect(countLineState(_line()), 'Not counted');
      expect(countLineState(_line(physical: 4)), 'Counted');
      expect(countLineState(_line(physical: 4, recounted: true)), 'Recounted');
      expect(countLineState(_line(physical: 4, recount: true)), 'Count again');
      expect(countLineState(_line(physical: 4, recount: true, recounted: true)), 'Recounted');
      expect(countLineNeedsRecount(_line(physical: 4, recount: true)), isTrue);
      expect(countLineStartQty(_line(physical: 4)), 4);
      expect(countLineStartQty(_line()), 0);
      expect(countLineStartQty(_line(physical: 4, recount: true)), 0, reason: 'a recount starts again from nothing');
    });

    test('uncounted and difference lines come from what the server returned', () {
      final lines = [_line(physical: 4, difference: -6), _line(id: 'i2', name: 'Soap'), _line(id: 'i3', name: 'Oil', physical: 10, difference: 0)];
      expect(countUncounted(lines), 1);
      expect(countDifferences(lines).map((l) => l['item_id']), ['i1']);
    });

    test('the questions name what will change', () {
      expect(finishCountText(0), allOf(contains('Counting closes'), contains('review')));
      expect(finishCountText(3), contains('3 items have not been counted'));
      expect(finishCountText(1), contains('1 item has not been counted'));
      expect(postCountText(2), allOf(contains('2 differences'), contains('stock adjustment'), contains('lock')));
      expect(postCountText(1), contains('1 difference'));
      expect(cancelCountText(), allOf(contains('Nothing is posted'), contains('unfrozen')));
      expect(recountText(2), '2 items are well off the book figure. Count them again.');
      expect(recountText(1), '1 item is well off the book figure. Count it again.');
    });

    test('difference reasons: a shortage may pick any, an excess only "Excess found"', () {
      expect(countReasonOptions(shortage: true).map((o) => o.$1), [
        'STOCK_TAKE',
        'DAMAGE',
        'THEFT',
        'EXPIRED',
        'PROCESS_LOSS',
        'TRANSIT_LOSS',
        'OWN_CONSUMPTION',
        'FREE_SAMPLE',
        'CUSTODY_LOSS',
      ]);
      expect(countReasonOptions(shortage: true).first.$2, 'Unexplained');
      expect(countReasonOptions(shortage: false), [('STOCK_TAKE', 'Excess found')]);
      expect(countReasonLabel('DAMAGE'), 'Damaged');
      expect(countReasonLabel(null), 'Unexplained');
    });

    test('summary and difference figures are shown as the server sent them', () {
      final rows = countSummaryRows({
        'book_qty': 100,
        'with_third_party_qty': 5,
        'in_transit_qty': 0,
        'expected_qty': 95,
        'physical_qty': 90,
        'unexplained_qty': -5,
      });
      expect(rows, [
        ('Book stock', '100'),
        ('With third parties', '−5'),
        ('In transit', '0'),
        ('Expected in godown', '95'),
        ('Counted', '90'),
        ('Unexplained', '-5'),
      ]);
      expect(countDiffText(_line(physical: 4, difference: -6)), '-6');
      expect(countDiffText(_line(physical: 12, difference: 2)), '+2');
      expect(countDiffSubtitle(_line(physical: 4, difference: -6)), allOf(contains('Book 10'), contains('Expected 10'), contains('Counted 4')));
    });

    test('an already-changed refusal is a 409 with no code of its own', () {
      expect(countAlreadyChanged(ApiException('Count SC-1 is review; counting is closed.', status: 409)), isTrue);
      expect(countAlreadyChanged(ApiException('Stock count SC-1 is already open for this godown.', status: 409, code: 'COUNT_OPEN')), isFalse);
      expect(countAlreadyChanged(ApiException('2 item(s) still need a second count.', status: 409, code: 'RECOUNT_PENDING')), isFalse);
      expect(countAlreadyChanged(ApiException('x', status: 400)), isFalse);
    });
  });

  group('stock counts list', () {
    testWidgets('loads counts with no identity in the request; chips filter on the phone', (t) async {
      final srv = _Srv()..counts = [_countRow(), _countRow(id: 'c2', number: 'SC-2', status: 'posted')];
      final (s, sent) = srv.build();
      await pumpScreen(t, StockCountsScreen(session: s));
      expect(find.text('SC-1'), findsOneWidget);
      expect(find.text('SC-2'), findsOneWidget);
      expect(find.textContaining('Counting, stock frozen'), findsOneWidget);
      final q = requestsOf(sent, 'GET', '/api/stock-counts').first.uri.queryParameters;
      expect(q.containsKey('business_id'), isFalse);
      expect(q.containsKey('user_id'), isFalse);
      await t.tap(find.text('Posted').first);
      await t.pumpAndSettle();
      expect(find.text('SC-2'), findsOneWidget);
      expect(find.text('SC-1'), findsNothing);
    });

    testWidgets('empty, error with Try again, and plan refusal are each handled', (t) async {
      var (s, _) = (_Srv()..counts = []).build();
      await pumpScreen(t, StockCountsScreen(session: s));
      expect(find.text('No stock counts yet'), findsOneWidget);

      final bad = _Srv()..listReply = (500, {'error': 'Boom'});
      (s, _) = bad.build();
      await pumpScreen(t, StockCountsScreen(session: s));
      expect(find.text('Try again'), findsOneWidget);
      bad.listReply = null;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('SC-1'), findsOneWidget);

      (s, _) = (_Srv()..listReply = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'})).build();
      await pumpScreen(t, StockCountsScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });

  group('start a count', () {
    Future<(_Srv, AppSession, List<RequestOptions>)> openForm(WidgetTester t, {_Srv? srv}) async {
      final server = srv ?? _Srv();
      final (s, sent) = server.build();
      await pumpScreen(t, StockCountsScreen(session: s));
      await t.tap(find.text('New count'));
      await t.pumpAndSettle();
      return (server, s, sent);
    }

    testWidgets('posts once with the chosen warehouse, then opens the new count', (t) async {
      final (_, _, sent) = await openForm(t);
      expect(find.text('Open count'), findsOneWidget);
      await t.tap(_pick('Godown'));
      await _sheetUp(t);
      await t.tap(find.text('Main godown').last);
      await _sheetUp(t);
      await t.tap(find.text('Open count'));
      await t.tap(find.text('Open count'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/stock-counts').toList();
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body['warehouse_id'], 'w1');
      expect(body['blind'], true);
      expect(body['freeze_stock'], true);
      expect(RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(body['count_date'] as String), isTrue);
      expectNoIdentity(body);
      expect(requestCount(sent, 'GET', '/api/stock-counts/c9'), 1);
      expect(find.text('SC-9'), findsOneWidget);
    });

    testWidgets('asks for a godown first when the business has warehouses', (t) async {
      final (_, _, sent) = await openForm(t);
      await t.tap(find.text('Open count'));
      await t.pumpAndSettle();
      expect(find.text('Choose the godown to count'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/stock-counts'), 0);
    });

    testWidgets('a business with no warehouses opens the count on its branch without a godown', (t) async {
      final srv = _Srv()..warehouses = [];
      final (s, sent) = srv.build();
      await pumpScreen(t, StockCountsScreen(session: s));
      await t.tap(find.text('New count'));
      await t.pumpAndSettle();
      expect(_pick('Godown'), findsNothing);
      await t.tap(find.text('Open count'));
      await t.pumpAndSettle();
      final body = requestsOf(sent, 'POST', '/api/stock-counts').single.data as Map;
      expect(body.containsKey('warehouse_id'), isFalse);
      expectNoIdentity(body);
    });

    testWidgets('the server\'s refusal is shown as worded and the form stays', (t) async {
      final srv = _Srv()..createReply = (409, {'error': 'Stock count SC-1 is already open for this godown.', 'code': 'COUNT_OPEN'});
      final (_, _, sent) = await openForm(t, srv: srv);
      await t.tap(_pick('Godown'));
      await _sheetUp(t);
      await t.tap(find.text('Main godown').last);
      await _sheetUp(t);
      await t.tap(find.text('Open count'));
      await t.pumpAndSettle();
      expect(find.text('Stock count SC-1 is already open for this godown.'), findsOneWidget);
      expect(find.text('Open count'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/stock-counts'), 1);
    });
  });

  group('count screen: counting', () {
    Future<(_Srv, List<RequestOptions>)> open(WidgetTester t, {_Srv? srv, Future<String?> Function(BuildContext)? scan, Duration? wait}) async {
      final server = srv ?? _Srv();
      final (s, sent) = server.build();
      await pumpScreen(t, StockCountScreen(session: s, countId: 'c1', scanBarcode: scan, saveDelay: wait ?? const Duration(milliseconds: 800)));
      return (server, sent);
    }

    testWidgets('loads the count with its items, states and barcodes, and no identity', (t) async {
      final srv = _Srv()..lines = [_line(physical: 4), _line(id: 'i2', name: 'Soap'), _line(id: 'i3', name: 'Oil', physical: 3, recount: true)];
      final (_, sent) = await open(t, srv: srv);
      expect(find.text('SC-1'), findsOneWidget);
      expect(find.text('Rice'), findsOneWidget);
      expect(find.text('Soap'), findsOneWidget);
      expect(find.text('Counted'), findsWidgets);
      expect(find.text('Not counted'), findsOneWidget);
      expect(find.text('Count again'), findsOneWidget);
      expect(_text(t, 'counted-i1'), '4');
      expect(_text(t, 'counted-i2'), '');
      expect(_text(t, 'counted-i3'), '', reason: 'a recount starts empty');
      expect(requestCount(sent, 'GET', '/api/stock-counts/c1'), 1);
      expect(requestCount(sent, 'GET', '/api/stock-counts/c1/barcodes'), 1);
      expect(requestsOf(sent, 'GET', '/api/stock-counts/c1').single.uri.queryParameters.containsKey('business_id'), isFalse);
    });

    testWidgets('error with Try again, plan refusal and a missing count', (t) async {
      final bad = _Srv()..getReply = (500, {'error': 'Boom'});
      var (s, _) = bad.build();
      await pumpScreen(t, StockCountScreen(session: s, countId: 'c1'));
      expect(find.text('Try again'), findsOneWidget);
      bad.getReply = null;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Rice'), findsOneWidget);

      (s, _) = (_Srv()..getReply = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'})).build();
      await pumpScreen(t, StockCountScreen(session: s, countId: 'c1'));
      expect(find.text('Not included in your current plan'), findsOneWidget);

      (s, _) = (_Srv()..getReply = (404, {'error': 'Stock count not found'})).build();
      await pumpScreen(t, StockCountScreen(session: s, countId: 'gone'));
      expect(find.text('Stock count not found'), findsOneWidget);
    });

    testWidgets('a scan fills the matching line: one unit, then a whole box; an unknown code is said so', (t) async {
      final codes = ['890', '890', 'BOX1', '999'];
      final (_, sent) = await open(t, scan: (_) async => codes.removeAt(0));
      await t.tap(find.text('Scan barcode'));
      await t.pump();
      expect(_text(t, 'counted-i1'), '1');
      expect(find.text('+ Rice (1 KG)'), findsOneWidget);
      await t.tap(find.text('Scan barcode'));
      await t.pump();
      expect(_text(t, 'counted-i1'), '2');
      await t.tap(find.text('Scan barcode'));
      await t.pump();
      expect(_text(t, 'counted-i1'), '14');
      await t.tap(find.text('Scan barcode'));
      await t.pump();
      expect(find.text('Not on this count: 999'), findsOneWidget);
      expect(_text(t, 'counted-i1'), '14');
      expect(_text(t, 'counted-i2'), '');
      // Still inside the wait: nothing has been sent yet.
      expect(requestCount(sent, 'PATCH', '/api/stock-counts/c1'), 0);
      await _autosave(t);
    });

    testWidgets('closing the scanner without a code changes nothing', (t) async {
      final (_, sent) = await open(t, scan: (_) async => null);
      await t.tap(find.text('Scan barcode'));
      await t.pumpAndSettle();
      expect(_text(t, 'counted-i1'), '');
      await _autosave(t);
      expect(requestCount(sent, 'PATCH', '/api/stock-counts/c1'), 0);
    });

    testWidgets('a counted quantity saves by itself, once, as the website\'s count action', (t) async {
      final (srv, sent) = await open(t);
      await _enter(t, 'counted-i2', '7');
      expect(requestCount(sent, 'PATCH', '/api/stock-counts/c1'), 0);
      await _autosave(t);
      final patches = requestsOf(sent, 'PATCH', '/api/stock-counts/c1').toList();
      expect(patches, hasLength(1));
      final body = patches.single.data as Map;
      expect(body['action'], 'count');
      expect(body['entries'], [
        {'item_id': 'i2', 'physical_qty': 7, 'third_party_qty': 0, 'unit': null},
      ]);
      expectNoIdentity(body);
      expect(srv.lines[1]['physical_qty'], 7);
      expect(requestCount(sent, 'GET', '/api/stock-counts/c1'), 2, reason: 'reloaded after the save');
      expect(find.text('Counted'), findsWidgets);
      expect(_text(t, 'counted-i2'), '7');
    });

    testWidgets('several edits inside the wait go in one save; Save counts sends at once', (t) async {
      final (_, sent) = await open(t);
      await _enter(t, 'counted-i1', '3');
      await _enter(t, 'counted-i2', '4');
      await t.tap(find.text('Save counts'));
      await t.pumpAndSettle();
      final patches = requestsOf(sent, 'PATCH', '/api/stock-counts/c1').toList();
      expect(patches, hasLength(1));
      expect(((patches.single.data as Map)['entries'] as List).map((e) => (e as Map)['item_id']), ['i1', 'i2']);
      expect(find.text('Counts saved'), findsOneWidget);
      await _autosave(t);
      expect(requestCount(sent, 'PATCH', '/api/stock-counts/c1'), 1, reason: 'nothing left to save');
    });

    testWidgets('Save counts with nothing entered says so and sends nothing', (t) async {
      final (_, sent) = await open(t);
      await t.tap(find.text('Save counts'));
      await t.pumpAndSettle();
      expect(find.text('Enter at least one counted quantity'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/stock-counts/c1'), 0);
    });

    testWidgets('others\' goods found are sent with the count, and an alternate unit with it', (t) async {
      final (_, sent) = await open(t, wait: const Duration(minutes: 5));
      await _enter(t, 'counted-i2', '2');
      await _enter(t, 'others-i2', '1');
      await t.tap(_pick('Unit'));
      await _sheetUp(t);
      await t.tap(find.textContaining('BOX').last);
      await _sheetUp(t);
      await t.tap(find.text('Save counts'));
      await t.pumpAndSettle();
      final entry = (((requestsOf(sent, 'PATCH', '/api/stock-counts/c1').single.data as Map)['entries']) as List).single as Map;
      expect(entry, {'item_id': 'i2', 'physical_qty': 2, 'third_party_qty': 1, 'unit': 'BOX'});
    });

    testWidgets('items far off the book figure are told to be counted again', (t) async {
      final srv = _Srv()..patchReply = (200, {'ok': true, 'saved': 1, 'recount': ['i1']});
      await open(t, srv: srv);
      await _enter(t, 'counted-i1', '1');
      await t.tap(find.text('Save counts'));
      await t.pumpAndSettle();
      expect(find.text('1 item is well off the book figure. Count it again.'), findsOneWidget);
    });

    testWidgets('a refused save shows the server\'s words and keeps what was typed', (t) async {
      final srv = _Srv()..patchReply = (400, {'error': 'Counted quantities cannot be negative.'});
      final (_, sent) = await open(t, srv: srv);
      await _enter(t, 'counted-i1', '-1');
      await t.tap(find.text('Save counts'));
      await t.pumpAndSettle();
      expect(find.text('Counted quantities cannot be negative.'), findsOneWidget);
      expect(_text(t, 'counted-i1'), '-1');
      expect(requestCount(sent, 'PATCH', '/api/stock-counts/c1'), 1);
    });

    testWidgets('Finish counting asks first, naming the uncounted items, then submits once', (t) async {
      final srv = _Srv()..lines = [_line(physical: 4), _line(id: 'i2', name: 'Soap')];
      final (_, sent) = await open(t, srv: srv);
      await t.tap(find.widgetWithText(KButton, 'Finish counting'));
      await _sheetUp(t);
      expect(find.textContaining('1 item has not been counted'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/stock-counts/c1'), 0);
      final yes = find.descendant(of: find.byType(BottomSheet), matching: find.text('Finish counting'));
      await t.tap(yes);
      await t.tap(yes, warnIfMissed: false);
      await _sheetUp(t);
      await t.pumpAndSettle();
      final patches = requestsOf(sent, 'PATCH', '/api/stock-counts/c1').toList();
      expect(patches, hasLength(1));
      expect(patches.single.data, {'action': 'submit', 'fill_uncounted': 'book'});
      expect(find.text('Approve and post'), findsOneWidget, reason: 'now in review');
    });

    testWidgets('typed quantities are saved before the finish question, and nothing is filled when all are counted', (t) async {
      final srv = _Srv()..lines = [_line(physical: 4), _line(id: 'i2', name: 'Soap')];
      final (_, sent) = await open(t, srv: srv);
      await _enter(t, 'counted-i2', '9');
      await t.tap(find.widgetWithText(KButton, 'Finish counting'));
      await _sheetUp(t);
      await _sheetUp(t);
      expect(requestsOf(sent, 'PATCH', '/api/stock-counts/c1').map((o) => (o.data as Map)['action']), ['count']);
      expect(find.textContaining('have not been counted'), findsNothing);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Finish counting')));
      await _sheetUp(t);
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'PATCH', '/api/stock-counts/c1').map((o) => (o.data as Map)['action']), ['count', 'submit']);
      expect(requestsOf(sent, 'PATCH', '/api/stock-counts/c1').last.data, {'action': 'submit'});
    });

    testWidgets('keeping the count open at the question sends nothing', (t) async {
      final (_, sent) = await open(t);
      await t.tap(find.widgetWithText(KButton, 'Finish counting'));
      await _sheetUp(t);
      await t.tap(find.text('Keep counting'));
      await _sheetUp(t);
      expect(requestCount(sent, 'PATCH', '/api/stock-counts/c1'), 0);
      expect(find.widgetWithText(KButton, 'Finish counting'), findsOneWidget);
    });

    testWidgets('a refused finish shows the server\'s words and the screen stays as it was', (t) async {
      final srv = _Srv()..patchReply = (409, {'error': '1 item(s) still need a second count.', 'code': 'RECOUNT_PENDING'});
      final (_, sent) = await open(t, srv: srv);
      await t.tap(find.widgetWithText(KButton, 'Finish counting'));
      await _sheetUp(t);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Finish counting')));
      await _sheetUp(t);
      await t.pumpAndSettle();
      expect(find.text('1 item(s) still need a second count.'), findsOneWidget);
      expect(find.widgetWithText(KButton, 'Finish counting'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/stock-counts/c1'), 1);
    });

    testWidgets('an already-closed count reloads and says so neutrally', (t) async {
      final srv = _Srv();
      await open(t, srv: srv);
      srv.patchReply = (409, {'error': 'Count SC-1 is review; counting is closed.'});
      srv.submit(true);
      await t.tap(find.widgetWithText(KButton, 'Finish counting'));
      await _sheetUp(t);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Finish counting')));
      await _sheetUp(t);
      await t.pumpAndSettle();
      expect(find.text(kCountChangedText), findsOneWidget);
      expect(find.text('Approve and post'), findsOneWidget);
    });

    testWidgets('Cancel count is under More, asks first, and PATCHes once', (t) async {
      final (_, sent) = await open(t);
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Cancel count'));
      await _sheetUp(t);
      expect(inSheet('Cancel this count? Nothing is posted and the godown is unfrozen.'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/stock-counts/c1'), 0);
      final yes = find.descendant(of: find.byType(BottomSheet), matching: find.text('Cancel count'));
      await t.tap(yes);
      await t.tap(yes, warnIfMissed: false);
      await _sheetUp(t);
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'PATCH', '/api/stock-counts/c1').single.data, {'action': 'cancel'});
      expect(find.text('Cancelled'), findsWidgets);
      expect(find.widgetWithText(KButton, 'Finish counting'), findsNothing);
    });
  });

  group('count screen: review and post', () {
    Future<(_Srv, List<RequestOptions>)> open(WidgetTester t) async {
      final srv = _Srv()
        ..status = 'review'
        ..lines = [
          _line(physical: 4, difference: -6),
          _line(id: 'i2', name: 'Soap', physical: 12, difference: 2, book: 10),
          _line(id: 'i3', name: 'Oil', physical: 10, difference: 0),
        ];
      final (s, sent) = srv.build();
      await pumpScreen(t, StockCountScreen(session: s, countId: 'c1'));
      return (srv, sent);
    }

    testWidgets('shows the server\'s summary and only the lines that differ, and does not fetch barcodes', (t) async {
      final (_, sent) = await open(t);
      expect(find.text('Book stock'), findsOneWidget);
      expect(find.text('100'), findsOneWidget);
      expect(find.text('Unexplained'), findsWidgets);
      expect(find.text('-8'), findsOneWidget);
      expect(find.text('Differences (2)'), findsOneWidget);
      expect(find.text('Rice'), findsWidgets);
      expect(find.text('Soap'), findsWidgets);
      expect(find.text('Oil'), findsNothing);
      expect(find.text('-6'), findsOneWidget);
      expect(find.text('+2'), findsOneWidget);
      expect(find.text('Held by others (1)'), findsOneWidget);
      expect(find.textContaining('Ravi'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/stock-counts/c1/barcodes'), 0);
    });

    testWidgets('a shortage can be given a reason and a note; an excess offers only "Excess found"', (t) async {
      final (_, sent) = await open(t);
      await t.tap(_pick('Reason').first);
      await _sheetUp(t);
      expect(find.text('Damaged'), findsOneWidget);
      await t.tap(find.text('Damaged'));
      await _sheetUp(t);
      await _enter(t, 'note-i1', 'Wet in the rain');
      await t.tap(_pick('Reason').last);
      await _sheetUp(t);
      expect(find.text('Excess found'), findsWidgets);
      expect(inSheet('Damaged'), findsNothing);
      await t.tap(find.text('Excess found').last);
      await _sheetUp(t);
      await t.tap(find.text('Save reasons'));
      await t.pumpAndSettle();
      final body = requestsOf(sent, 'PATCH', '/api/stock-counts/c1').single.data as Map;
      expect(body['action'], 'reasons');
      expect(body['reasons'], [
        {'item_id': 'i1', 'reason_code': 'DAMAGE', 'reason_notes': 'Wet in the rain'},
        {'item_id': 'i2', 'reason_code': 'STOCK_TAKE', 'reason_notes': null},
      ]);
      expect(find.text('Reasons saved'), findsOneWidget);
    });

    testWidgets('Approve and post asks first, naming what changes, then posts once and reloads', (t) async {
      final (_, sent) = await open(t);
      await t.tap(find.widgetWithText(KButton, 'Approve and post'));
      await _sheetUp(t);
      expect(find.textContaining('Post 2 differences as stock adjustments'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/stock-counts/c1'), 0);
      final yes = find.descendant(of: find.byType(BottomSheet), matching: find.text('Approve and post'));
      await t.tap(yes);
      await t.tap(yes, warnIfMissed: false);
      await _sheetUp(t);
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'PATCH', '/api/stock-counts/c1').single.data, {'action': 'post'});
      expect(find.text('Count posted'), findsOneWidget);
      expect(find.text('Approve and post'), findsNothing);
      expect(find.text('Posted'), findsWidgets);
    });

    testWidgets('a refused post shows the server\'s words and leaves the count in review', (t) async {
      final (srv, sent) = await open(t);
      srv.patchReply = (403, {'error': 'Someone who did not count must approve and post this count.', 'code': 'SAME_COUNTER'});
      await t.tap(find.widgetWithText(KButton, 'Approve and post'));
      await _sheetUp(t);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Approve and post')));
      await _sheetUp(t);
      await t.pumpAndSettle();
      expect(find.text('Someone who did not count must approve and post this count.'), findsOneWidget);
      expect(find.widgetWithText(KButton, 'Approve and post'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/stock-counts/c1'), 1);
    });

    testWidgets('a posted count has no actions; the rest of the website page is one tap away', (t) async {
      final srv = _Srv()
        ..status = 'posted'
        ..lines = [_line(physical: 4, difference: -6)];
      final (s, _) = srv.build();
      await pumpScreen(t, StockCountScreen(session: s, countId: 'c1'));
      expect(find.text('Approve and post'), findsNothing);
      expect(find.byTooltip('More'), findsNothing);
      expect(find.text('Open on website'), findsOneWidget);
    });
  });

  group('fix round 1: finishing and leaving never lose or double a count', () {
    Future<(_Srv, List<RequestOptions>)> open(WidgetTester t, _Srv srv, {Future<String?> Function(BuildContext)? scan}) async {
      final (s, sent) = srv.build();
      await pumpScreen(t, StockCountScreen(session: s, countId: 'c1', scanBarcode: scan));
      return (srv, sent);
    }

    Iterable<String> actions(List<RequestOptions> sent) => requestsOf(sent, 'PATCH', '/api/stock-counts/c1').map((o) => (o.data as Map)['action'] as String);

    testWidgets('an edit typed while a save is in flight is sent before the finish question, and the submit comes after it', (t) async {
      final srv = _Srv()..lines = [_line(physical: 4), _line(id: 'i2', name: 'Soap', physical: 5)];
      final (_, sent) = await open(t, srv);
      srv.gate = Completer<void>();
      final gate = srv.gate!;
      await _enter(t, 'counted-i1', '6');
      await t.pump(const Duration(milliseconds: 900));
      expect(actions(sent), ['count'], reason: 'the first autosave is out and waiting');
      await _enter(t, 'counted-i2', '7');
      await t.tap(find.widgetWithText(KButton, 'Finish counting'));
      await t.pump();
      expect(find.textContaining('Counting closes'), findsNothing, reason: 'no question while a save is still out');
      expect(actions(sent), ['count']);
      gate.complete();
      await _sheetUp(t);
      await _sheetUp(t);
      expect(actions(sent), ['count', 'count'], reason: 'the typed edit went out before asking');
      expect(inSheet('Finish counting'), findsOneWidget);
      expect(srv.lines[1]['physical_qty'], 7);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Finish counting')));
      await _sheetUp(t);
      await _sheetUp(t);
      expect(actions(sent), ['count', 'count', 'submit']);
    });

    testWidgets('the count boxes are switched off while an action runs', (t) async {
      final srv = _Srv()..lines = [_line(physical: 4)];
      await open(t, srv);
      await t.tap(find.widgetWithText(KButton, 'Finish counting'));
      await _sheetUp(t);
      expect(t.widget<TextField>(_field('counted-i1')).enabled, isFalse);
      await t.tap(find.text('Keep counting'));
      await _sheetUp(t);
      await _sheetUp(t);
      expect(t.widget<TextField>(_field('counted-i1')).enabled, isTrue);
    });

    testWidgets('a cleared counted box stops the finish and says what to do; nothing is submitted', (t) async {
      final srv = _Srv()..lines = [_line(physical: 4), _line(id: 'i2', name: 'Soap', physical: 5)];
      final (_, sent) = await open(t, srv);
      await _enter(t, 'counted-i1', '');
      await t.tap(find.widgetWithText(KButton, 'Finish counting'));
      await _sheetUp(t);
      await _sheetUp(t);
      expect(find.text('Enter a quantity for Rice or leave it as it was'), findsOneWidget);
      expect(find.textContaining('Counting closes'), findsNothing);
      expect(actions(sent), isEmpty);
    });

    testWidgets('a value typed only in Others\' goods on an uncounted item stops the finish too', (t) async {
      final srv = _Srv();
      final (_, sent) = await open(t, srv);
      await _enter(t, 'others-i2', '1');
      await t.tap(find.widgetWithText(KButton, 'Finish counting'));
      await _sheetUp(t);
      await _sheetUp(t);
      expect(find.text('Enter a quantity for Soap or leave it as it was'), findsOneWidget);
      expect(actions(sent), isEmpty);
    });

    testWidgets('leaving sends what was typed and not yet saved', (t) async {
      final (_, sent) = await open(t, _Srv());
      await _enter(t, 'counted-i2', '7');
      await t.pumpWidget(const SizedBox());
      await t.pump(const Duration(seconds: 2));
      final patches = requestsOf(sent, 'PATCH', '/api/stock-counts/c1').toList();
      expect(patches, hasLength(1));
      expect(((patches.single.data as Map)['entries'] as List).single, {'item_id': 'i2', 'physical_qty': 7, 'third_party_qty': 0, 'unit': null});
    });

    testWidgets('leaving while a save is in flight does not send the same entries twice', (t) async {
      final srv = _Srv();
      final (_, sent) = await open(t, srv);
      srv.gate = Completer<void>();
      final gate = srv.gate!;
      await _enter(t, 'counted-i1', '3');
      await t.pump(const Duration(milliseconds: 900));
      expect(actions(sent), ['count']);
      await t.pumpWidget(const SizedBox());
      gate.complete();
      await t.pump(const Duration(seconds: 2));
      expect(actions(sent), ['count'], reason: 'the in-flight save already carries it');
    });
  });

  group('fix round 1: barcodes that fail to load', () {
    testWidgets('say so with a retry, instead of reading every scan as "not on this count"', (t) async {
      final srv = _Srv()..barcodesReply = (500, {'error': 'Boom'});
      final (s, sent) = srv.build();
      await pumpScreen(t, StockCountScreen(session: s, countId: 'c1', scanBarcode: (_) async => '890'));
      expect(find.text('Barcodes could not be loaded'), findsOneWidget);
      await t.tap(find.text('Scan barcode'));
      await t.pump();
      expect(find.text('Not on this count: 890'), findsNothing);
      expect(_text(t, 'counted-i1'), '');
      srv.barcodesReply = null;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'GET', '/api/stock-counts/c1/barcodes'), 2);
      expect(find.text('Barcodes could not be loaded'), findsNothing);
      await t.tap(find.text('Scan barcode'));
      await t.pump();
      expect(_text(t, 'counted-i1'), '1');
      await _autosave(t);
    });
  });

  group('stock count summary note', () {
    test('says shortage and excess at cost and the extra warnings, from the server figures', () {
      expect(
        countSummaryNote({'shortage_value': 300, 'excess_value': 50, 'unproven': 2, 'overdue_returns': 1, 'held_qty': 4}),
        'Shortage ₹300, excess ₹50 at cost. 2 lines out of the godown rest on an expired e-way bill. '
        '1 challan line is past its return date. Expected includes 4 held (quarantine, QC, damaged, returns).',
      );
      expect(countSummaryNote({'shortage_value': 0, 'excess_value': 0}), 'Shortage ₹0, excess ₹0 at cost.');
    });
  });

  group('wiring', () {
    test('stock counts has a phone screen and is no longer a website link', () {
      final session = recordedSession((o, b) => (404, {})).$1;
      expect(nativeScreenFor(session, '/stock-counts'), isA<StockCountsScreen>());
      expect(routeTier(session, '/stock-counts'), RouteTier.native);
    });
  });

}
