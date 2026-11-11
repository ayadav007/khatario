import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/more/more_navigation.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/pages/record_page.dart';
import 'package:khatario_phone/screens/reports/financial_statements_screens.dart';
import 'package:khatario_phone/screens/reports/report_period.dart';
import 'package:khatario_phone/screens/reports/reports_home_logic.dart';
import 'package:khatario_phone/screens/reports/reports_home_screen.dart';

import 'support/fake_session.dart';

const _menu = {
  'sections': [
    {
      'title': 'Reports',
      'items': [
        {'href': '/reports', 'label': 'Overview', 'locked': false},
        {'href': '/reports/builder', 'label': 'Custom Report Builder', 'locked': true},
        {'href': '/reports/profit-loss', 'label': 'Profit & Loss', 'locked': false},
        {'href': '/reports/gst/gstr1', 'label': 'GST Returns (GSTR-1)', 'locked': false},
      ],
    },
  ],
};

Object? _reply(RequestOptions o) {
  switch (o.uri.path) {
    case '/api/navigation/more':
      return _menu;
    case '/api/reports/sales-summary':
      return {'summary': {'total_sales': 125000.5}};
    case '/api/reports/purchase-summary':
      return {'summary': {'total_amount': 80000}};
    case '/api/reports/expense/summary':
      return {'totals': {'total_amount': 15000}};
    case '/api/reports/profit-loss':
      return {'net_profit': 30000.25};
  }
  return {};
}

void main() {
  group('tile paths', () {
    final p = ReportPeriod('custom', DateTime(2026, 4, 1), DateTime(2026, 4, 30));
    test('each tile reads its route with the period', () {
      expect(homeTiles.map((t) => t.label), ['Sales', 'Purchases', 'Expenses', 'Profit']);
      expect(homeTiles[0].path(p), '/api/reports/sales-summary?from_date=2026-04-01&to_date=2026-04-30');
      expect(homeTiles[1].path(p), '/api/reports/purchase-summary?from_date=2026-04-01&to_date=2026-04-30');
      expect(homeTiles[2].path(p), '/api/reports/expense/summary?from_date=2026-04-01&to_date=2026-04-30&period=month');
      expect(homeTiles[3].path(p), '/api/reports/profit-loss?from_date=2026-04-01&to_date=2026-04-30');
      for (final t in homeTiles) {
        expect(t.path(p), isNot(contains('business_id')));
        expect(t.path(p), isNot(contains('user_id')));
      }
    });
    test('tile figures are the server keys', () {
      expect(homeTiles[0].figure({'summary': {'total_sales': 5}}), 5);
      expect(homeTiles[1].figure({'summary': {'total_amount': '7.5'}}), 7.5);
      expect(homeTiles[2].figure({'totals': {'total_amount': 9}}), 9);
      expect(homeTiles[3].figure({'net_profit': -4}), -4);
      expect(homeTiles[3].figure({}), isNull);
      expect(homeTiles[0].figure({'summary': {}}), isNull);
      expect(homeTiles[0].figure({'summary': null}), isNull);
    });
  });

  group('groups', () {
    test('six website groups in order, plus the builder', () {
      expect(reportGroups.map((g) => g.title), ['Financial', 'Sales', 'Purchase', 'GST', 'Stock', 'Party', 'Custom']);
      final hrefs = [for (final g in reportGroups) ...g.rows.map((r) => r.href)];
      expect(hrefs.toSet().length, hrefs.length);
      expect(
        hrefs,
        containsAll(['/reports/profit-loss', '/reports/sales/summary', '/reports/gst/gstr1', '/reports/stock/summary', '/reports/aging/receivables', '/reports/builder']),
      );
    });
    test('visibleGroups: menu hides rows it omits and carries the lock', () {
      final menu = parseMoreMenu(Map<String, dynamic>.from(_menu))!;
      final shown = visibleGroups(menu);
      expect(shown.map((g) => g.title), ['Financial', 'GST', 'Custom']);
      expect(shown.last.rows.single.locked, isTrue);
      expect(shown.first.rows.single.locked, isFalse);
    });
    test('visibleGroups: no menu shows everything unlocked', () {
      final all = visibleGroups(null);
      expect(all.length, reportGroups.length);
      expect(all.expand((g) => g.rows).any((r) => r.locked), isFalse);
    });
  });

  group('screen', () {
    Future<List<RequestOptions>> open(WidgetTester t, {Object? Function(RequestOptions)? reply}) async {
      t.view.physicalSize = const Size(800, 3000);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.reset);
      final (s, sent) = fakeSession(reply ?? _reply);
      await t.pumpWidget(MaterialApp(home: ReportsHomeScreen(session: s)));
      await t.pumpAndSettle();
      return sent;
    }

    testWidgets('tiles show the server figures', (t) async {
      final sent = await open(t);
      expect(find.byType(ReportPeriodBar), findsOneWidget);
      expect(find.textContaining('1,25,000'), findsOneWidget);
      expect(find.textContaining('80,000'), findsOneWidget);
      expect(find.textContaining('15,000'), findsOneWidget);
      expect(find.textContaining('30,000'), findsOneWidget);
      expect(sent.where((o) => o.uri.path.startsWith('/api/reports')).length, 4);
    });

    testWidgets('a failed tile shows a dash and the rest still show', (t) async {
      await open(t, reply: (o) => o.uri.path == '/api/reports/expense/summary' ? throw DioException(requestOptions: o) : _reply(o));
      expect(find.text('—'), findsOneWidget);
      expect(find.textContaining('1,25,000'), findsOneWidget);
      expect(find.textContaining('30,000'), findsOneWidget);
    });

    testWidgets('a second failed tile also shows a dash and the others stay', (t) async {
      await open(t, reply: (o) => o.uri.path == '/api/reports/profit-loss' ? throw DioException(requestOptions: o) : _reply(o));
      expect(find.text('—'), findsOneWidget);
    });

    testWidgets('every tile failing shows the error with Try again, which reloads the tiles', (t) async {
      var fail = true;
      final sent = await open(t, reply: (o) => o.uri.path.startsWith('/api/reports') && fail ? throw DioException(requestOptions: o) : _reply(o));
      expect(find.text('Try again'), findsOneWidget);
      fail = false;
      sent.clear();
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Try again'), findsNothing);
      expect(find.textContaining('1,25,000'), findsOneWidget);
      expect(sent.where((o) => o.uri.path.startsWith('/api/reports')).length, 4);
    });

    testWidgets('changing the period reloads the tiles', (t) async {
      final sent = await open(t);
      sent.clear();
      await t.tap(find.text('Last FY'));
      await t.pumpAndSettle();
      final last = ReportPeriod.of('last_fy');
      final reports = sent.where((o) => o.uri.path.startsWith('/api/reports')).toList();
      expect(reports.length, 4);
      for (final o in reports) {
        expect(o.uri.queryParameters['from_date'], last.fromIso);
        expect(o.uri.queryParameters['to_date'], last.toIso);
      }
    });

    testWidgets('a native report row opens its screen', (t) async {
      await open(t);
      await t.tap(find.text('Profit & loss'));
      await t.pumpAndSettle();
      expect(find.byType(ReportsHomeScreen), findsNothing);
    });

    testWidgets('a locked row shows the lock pill and opens the upgrade sheet', (t) async {
      await open(t);
      await t.scrollUntilVisible(find.text('Custom report builder'), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text('Upgrade'), findsOneWidget);
      await t.tap(find.text('Custom report builder'));
      await t.pumpAndSettle();
      expect(find.byType(ReportsHomeScreen), findsOneWidget);
      expect(find.byType(BottomSheet), findsOneWidget);
    });
  });

  testWidgets('openAppHref: native screen, then the automatic list', (t) async {
    final (s, _) = fakeSession(_reply);
    late BuildContext ctx;
    await t.pumpWidget(MaterialApp(home: Builder(builder: (c) {
      ctx = c;
      return const SizedBox();
    })));
    openAppHref(ctx, s, '/reports/profit-loss', 'P&L');
    await t.pumpAndSettle();
    expect(find.byType(ProfitLossScreen), findsOneWidget);
    Navigator.of(ctx).pop();
    await t.pumpAndSettle();
    openAppHref(ctx, s, '/reports/sales/summary', 'Sales summary');
    await t.pumpAndSettle();
    expect(find.byType(RecordPage), findsOneWidget);
  });

  test('route: /reports is native and not generic', () {
    final (s, _) = fakeSession((_) => {});
    expect(nativeScreenFor(s, '/reports'), isA<ReportsHomeScreen>());
    expect(stillGeneric.contains('/reports'), isFalse);
  });
}
