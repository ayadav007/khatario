import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/reports/stock_reports.dart';
import 'package:khatario_phone/screens/reports/table_report_screen.dart';
import 'package:khatario_phone/session.dart';

import 'support/fake_session.dart';

/// Each reply below was written from the route and the function it calls (see the report), not recorded.
Map<String, dynamic> _fixture(String name) =>
    jsonDecode(File('test/fixtures/reports/$name.json').readAsStringSync()) as Map<String, dynamic>;

Future<List<dynamic>> _open(WidgetTester t, String href, String fixture) async {
  t.view.physicalSize = const Size(800, 2400);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  final (s, sent) = fakeSession((_) => _fixture(fixture));
  await t.pumpWidget(MaterialApp(home: stockReportScreen(s, href)!));
  await t.pumpAndSettle();
  return [s, sent];
}

void main() {
  testWidgets('every stock report href has a phone screen and a spec', (t) async {
    final (s, _) = fakeSession((_) => {});
    for (final href in stockReportHrefs) {
      expect(stockReportScreen(s, href), isA<TableReportScreen>(), reason: href);
      expect(nativeScreenFor(s, href), isNotNull, reason: href);
    }
  });

  testWidgets('Stock Summary: server totals as tiles, first row and no period query', (t) async {
    final r = await _open(t, '/reports/stock/summary', 'stock_summary');
    final sent = r[1] as List;
    expect(sent.single.uri.path, '/api/reports/stock/summary');
    expect(sent.single.uri.query, isEmpty);
    expect(find.text('Stock value'), findsOneWidget);
    expect(find.text('₹17,940'), findsOneWidget);
    expect(find.text('Total items'), findsOneWidget);
    expect(find.text('48'), findsOneWidget); // total quantity, no rupee sign
    expect(find.text('Basmati Rice 5kg'), findsOneWidget);
    expect(find.text('₹17,220'), findsOneWidget);
    expect(find.textContaining('Low stock'), findsWidgets);
  });

  testWidgets('Closing Stock: financial year in the long form the server registers', (t) async {
    final r = await _open(t, '/reports/stock/closing-stock', 'stock_closing');
    final sent = r[1] as List;
    expect(sent.single.uri.path, '/api/reports/stock/closing-stock');
    expect(sent.single.uri.queryParameters['financial_year'], matches(RegExp(r'^\d{4}-\d{4}$')));
    final fy = sent.single.uri.queryParameters['financial_year'] as String;
    expect(int.parse(fy.substring(5)), int.parse(fy.substring(0, 4)) + 1);
    expect(find.text('Total value'), findsOneWidget);
    expect(find.text('₹26,500.50'), findsOneWidget);
    expect(find.text('80'), findsOneWidget);
    expect(find.text('Basmati Rice 5kg'), findsOneWidget);
    expect(find.text('₹24,600'), findsOneWidget);
  });

  testWidgets('Stock with Parties: totals tiles, held rows and the two transit tables', (t) async {
    final r = await _open(t, '/reports/stock/third-party', 'stock_third_party');
    final sent = r[1] as List;
    expect(sent.single.uri.path, '/api/reports/stock/third-party');
    expect(sent.single.uri.query, isEmpty);
    expect(find.text('Past return date'), findsOneWidget);
    expect(find.text('On an expired e-way bill'), findsOneWidget);
    expect(find.text('₹10,400'), findsWidgets);
    expect(find.text('Held by others'), findsOneWidget);
    expect(find.text('Gold Ring 22K'), findsOneWidget);
    expect(find.text('Silk Saree'), findsOneWidget);
    expect(find.text('Cotton Thaan'), findsOneWidget);
  });

  testWidgets('Valuation: as-on date, server total and item count', (t) async {
    final r = await _open(t, '/reports/stock/valuation', 'stock_valuation');
    final sent = r[1] as List;
    expect(sent.single.uri.path, '/api/reports/stock/valuation');
    expect(sent.single.uri.queryParameters['as_on_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    expect(find.text('₹17,940'), findsWidgets);
    expect(find.text('Items'), findsOneWidget);
    expect(find.text('Basmati Rice 5kg'), findsOneWidget);
    expect(find.text('₹17,220'), findsOneWidget);
  });

  testWidgets('Quantity details: from and to (not from_date), quantity rows without a rupee sign', (t) async {
    final r = await _open(t, '/reports/stock/quantitative', 'stock_quantitative');
    final sent = r[1] as List;
    final q = sent.single.uri.queryParameters as Map<String, String>;
    expect(sent.single.uri.path, '/api/reports/stock/quantitative');
    expect(q.containsKey('from'), isTrue);
    expect(q.containsKey('to'), isTrue);
    expect(q.containsKey('from_date'), isFalse);
    expect(find.text('Basmati Rice 5kg'), findsOneWidget);
    expect(find.text('58'), findsOneWidget); // closing
    expect(find.text('₹58'), findsNothing);
    await t.tap(find.text('Basmati Rice 5kg'));
    await t.pumpAndSettle();
    expect(find.text('Opening'), findsOneWidget);
    expect(find.text('Purchases'), findsOneWidget);
    expect(find.text('Sales'), findsOneWidget);
    expect(find.text('110'), findsOneWidget);
  });

  testWidgets('Bank stock statement: as_of, drawing power and the creditors tile', (t) async {
    final r = await _open(t, '/reports/stock/bank-statement', 'stock_bank_statement');
    final sent = r[1] as List;
    expect(sent.single.uri.path, '/api/reports/stock/bank-statement');
    expect(sent.single.uri.queryParameters['as_of'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    expect(sent.single.uri.queryParameters.containsKey('as_on_date'), isFalse);
    expect(find.text('Drawing power'), findsOneWidget);
    expect(find.text('₹1,68,750'), findsOneWidget);
    expect(find.text('Less creditors'), findsOneWidget);
    expect(find.text('Basmati Rice 5kg'), findsOneWidget);
  });

  testWidgets('Job work: from and to, goods still out first, then sent and received', (t) async {
    final r = await _open(t, '/reports/stock/job-work', 'stock_job_work');
    final sent = r[1] as List;
    final q = sent.single.uri.queryParameters as Map<String, String>;
    expect(sent.single.uri.path, '/api/reports/stock/job-work');
    expect(q.containsKey('from'), isTrue);
    expect(q.containsKey('to'), isTrue);
    expect(find.text('Steel sheet'), findsNWidgets(3));
    expect(find.text('39'), findsOneWidget); // still out, a quantity
    expect(find.text('₹39'), findsNothing);
    expect(find.text('Still out'), findsOneWidget);
    expect(find.text('Sent to job workers'), findsOneWidget);
    expect(find.text('Received back'), findsOneWidget);
  });

  testWidgets('FIFO lots: as_on_date, open lot value and the ledger difference from the server', (t) async {
    final r = await _open(t, '/reports/stock/fifo-lots', 'stock_fifo_lots');
    final sent = r[1] as List;
    expect(sent.single.uri.path, '/api/reports/stock/fifo-lots');
    expect(sent.single.uri.queryParameters['as_on_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    expect(find.text('Open lot value'), findsOneWidget);
    expect(find.text('Inventory account (1104)'), findsOneWidget);
    expect(find.text('Difference'), findsOneWidget);
    expect(find.text('Basmati Rice 5kg'), findsOneWidget);
  });


  testWidgets('Closing Stock sends limit=200 with the year and has no Show more when unpaged', (t) async {
    final r = await _open(t, '/reports/stock/closing-stock', 'stock_closing');
    final sent = r[1] as List;
    expect(sent.single.uri.queryParameters['limit'], '200');
    expect(sent.single.uri.queryParameters['financial_year'], isNotNull);
    expect(find.text('Show more'), findsNothing);
  });

  testWidgets('an unpaged report has no Show more and sends no page', (t) async {
    final r = await _open(t, '/reports/stock/valuation', 'stock_valuation');
    expect(find.text('Show more'), findsNothing);
    expect((r[1] as List).single.uri.queryParameters.containsKey('page'), isFalse);
  });

  testWidgets('a paged reply shows Show more, which requests page=2 and appends the rows', (t) async {
    t.view.physicalSize = const Size(800, 2400);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final (s, sent) = fakeSession((o) {
      if (o.uri.queryParameters['page'] == '2') {
        return {
          'summary': _fixture('stock_closing')['summary'],
          'snapshots': [
            {'item_id': 'i9', 'item_name': 'Sugar 1kg', 'quantity': 5, 'unit_cost': 40, 'total_value': 200, 'valuation_method': 'weighted_avg', 'last_purchase_date': null},
          ],
          'pagination': {'page': 2, 'limit': 200, 'total': 3, 'totalPages': 2},
        };
      }
      return _fixture('stock_closing_paged');
    });
    await t.pumpWidget(MaterialApp(home: stockReportScreen(s, '/reports/stock/closing-stock')!));
    await t.pumpAndSettle();
    expect(find.text('Sugar 1kg'), findsNothing);
    await t.ensureVisible(find.text('Show more'));
    await t.tap(find.text('Show more'));
    await t.pumpAndSettle();
    final q = sent.last.uri.queryParameters;
    expect(q['page'], '2');
    expect(q['limit'], '200');
    expect(q['financial_year'], isNotNull);
    expect(find.text('Sugar 1kg'), findsOneWidget);
    expect(find.text('Basmati Rice 5kg'), findsOneWidget);
    expect(find.text('Show more'), findsNothing);
  });

  testWidgets('Closing Stock with no snapshot says so and offers the website', (t) async {
    final (s, _) = fakeSession((_) => {'summary': null, 'snapshots': [], 'pagination': {'page': 1, 'limit': 200, 'total': 0, 'totalPages': 1}});
    await t.pumpWidget(MaterialApp(home: stockReportScreen(s, '/reports/stock/closing-stock')!));
    await t.pumpAndSettle();
    expect(find.text('No closing stock for this year yet'), findsOneWidget);
    expect(find.text('Create it on the website.'), findsOneWidget);
    expect(find.text('Open on website'), findsOneWidget);
    expect(find.text('Nothing for this period'), findsNothing);
  });

  testWidgets('Stock Summary is titled as the item-level summary', (t) async {
    final (s, _) = fakeSession((_) => _fixture('stock_summary'));
    await t.pumpWidget(MaterialApp(home: stockReportScreen(s, '/reports/stock/summary')!));
    await t.pumpAndSettle();
    expect(find.text('Stock Summary (by item)'), findsOneWidget);
  });

  testWidgets('a reply with no totals shows dashes, not sums of the rows', (t) async {
    final (s, _) = fakeSession((_) => {'stock': _fixture('stock_summary')['stock']});
    t.view.physicalSize = const Size(800, 2400);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(MaterialApp(home: stockReportScreen(s, '/reports/stock/summary')!));
    await t.pumpAndSettle();
    expect(find.text('₹17,940'), findsNothing);
    expect(find.text('—'), findsWidgets);
  });

  testWidgets('FEATURE_NOT_IN_PLAN shows the plan message', (t) async {
    final (s, _) = fakeSession((_) => {'error': 'Upgrade your plan', 'code': 'FEATURE_NOT_IN_PLAN'}, status: 403);
    await t.pumpWidget(MaterialApp(home: stockReportScreen(s, '/reports/stock/valuation')!));
    await t.pumpAndSettle();
    expect(find.text('Not included in your current plan'), findsOneWidget);
  });

  testWidgets('an unknown href has no stock report screen', (t) async {
    final AppSession s = fakeSession((_) => {}).$1;
    expect(stockReportScreen(s, '/reports/stock/nope'), isNull);
  });
}
