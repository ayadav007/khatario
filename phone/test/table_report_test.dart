import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/reports/report_period.dart';
import 'package:khatario_phone/screens/reports/table_report_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/fake_session.dart';

final _oct17 = DateTime(2026, 10, 17);

TableReportSpec _spec({
  ReportPeriodKind period = ReportPeriodKind.range,
  String path = '/api/reports/x',
  String Function()? extraQuery,
  void Function(BuildContext, Map<String, dynamic>)? onOpenRow,
  List<(String, String)> sections = const [],
  Set<String> countTiles = const {},
}) =>
    TableReportSpec(
      title: 'Sales',
      path: path,
      period: period,
      tiles: const [('Total sales', 'summary.total_sales'), ('Orders', 'summary.orders'), ('Gone', 'summary.nope')],
      rowsKey: 'data.rows',
      rowTitle: (r) => docTitle(r['name']),
      rowSubtitle: (r) => docTitle(r['city']),
      rowAmountKey: 'total',
      columns: const [ReportColumn('Name', 'name'), ReportColumn('Total', 'total', money: true), ReportColumn('Qty', 'qty', qty: true)],
      extraQuery: extraQuery,
      onOpenRow: onOpenRow,
      sections: sections,
      countTiles: countTiles,
    );

String docTitle(dynamic v) => v is String ? v : '';

Map<String, dynamic> _reply() => {
      'summary': {'total_sales': 1234.5, 'orders': '7'},
      'data': {
        'rows': [
          {'name': 'Asha', 'city': 'Pune', 'total': 100, 'qty': 3},
          {'name': 'Ravi', 'city': 'Delhi', 'total': '250.5', 'qty': 4},
        ],
      },
      'extra': [
        {'name': 'Extra row', 'city': 'Goa', 'total': 9},
      ],
    };

Future<void> _pump(WidgetTester t, AppSession s, TableReportSpec spec) async {
  await t.pumpWidget(MaterialApp(home: TableReportScreen(session: s, spec: spec)));
  await t.pumpAndSettle();
}

void main() {
  group('period queries for 17 Oct 2026', () {
    test('range', () {
      expect(ReportPeriod.of('this_month', _oct17).query, 'from_date=2026-10-01&to_date=2026-10-17');
    });
    test('month', () {
      final m = MonthPeriod.of(_oct17);
      expect(m.query, 'month=10&year=2026');
      expect(m.previous.query, 'month=9&year=2026');
      expect(m.next.query, 'month=11&year=2026');
      expect(const MonthPeriod(2026, 12).next.query, 'month=1&year=2027');
      expect(const MonthPeriod(2026, 1).previous.query, 'month=12&year=2025');
      expect(m.label, 'Oct 2026');
    });
    test('financial year', () {
      final fy = FinancialYear.of(_oct17);
      expect(fy.query, 'financial_year=2026-27');
      expect(FinancialYear.of(DateTime(2027, 2, 3)).query, 'financial_year=2026-27');
      expect(FinancialYear.of(DateTime(2027, 4, 1)).query, 'financial_year=2027-28');
      expect(fy.previous.query, 'financial_year=2025-26');
      expect(fy.next.query, 'financial_year=2027-28');
      expect(const FinancialYear(2099).query, 'financial_year=2099-00');
    });
    test('as on', () {
      expect(asOnQuery(_oct17), 'as_on_date=2026-10-17');
    });
  });

  testWidgets('tiles read dotted keys; a missing key shows a dash', (t) async {
    final (s, _) = fakeSession((_) => _reply());
    await _pump(t, s, _spec());
    expect(find.text('Total sales'), findsOneWidget);
    expect(find.textContaining('1,234.5'), findsOneWidget);
    expect(find.text('Gone'), findsOneWidget);
    expect(find.text('—'), findsOneWidget);
    expect(find.text('Asha'), findsOneWidget);
    expect(find.text('Pune'), findsOneWidget);
  });

  testWidgets('each kind sends its own query and never business_id', (t) async {
    final today = DateTime.now();
    final cases = <ReportPeriodKind, void Function(Map<String, String>)>{
      ReportPeriodKind.none: (q) => expect(q, isEmpty),
      ReportPeriodKind.range: (q) {
        expect(q.containsKey('from_date'), isTrue);
        expect(q.containsKey('to_date'), isTrue);
      },
      ReportPeriodKind.month: (q) {
        expect(q['month'], '${today.month}');
        expect(q['year'], '${today.year}');
      },
      ReportPeriodKind.financialYear: (q) => expect(q['financial_year'], FinancialYear.of(today).code),
      ReportPeriodKind.asOn: (q) => expect(q['as_on_date'], ymdOf(today)),
    };
    for (final e in cases.entries) {
      final (s, sent) = fakeSession((_) => _reply());
      await t.pumpWidget(const SizedBox()); // fresh State for each kind
      await _pump(t, s, _spec(period: e.key));
      expect(sent.length, 1, reason: '${e.key}');
      e.value(sent.single.uri.queryParameters);
      expect(sent.single.uri.queryParameters.containsKey('business_id'), isFalse);
    }
  });

  testWidgets('a path with a query joins with & and extraQuery is appended', (t) async {
    final (s, sent) = fakeSession((_) => _reply());
    await _pump(t, s, _spec(period: ReportPeriodKind.month, path: '/api/reports/x?type=a', extraQuery: () => 'party=1'));
    final q = sent.single.uri.queryParameters;
    expect(q['type'], 'a');
    expect(q['party'], '1');
    expect(q['month'], '${DateTime.now().month}');
    expect(sent.single.uri.toString().contains('?type=a&'), isTrue);
  });

  testWidgets('an empty extraQuery adds nothing', (t) async {
    final (s, sent) = fakeSession((_) => _reply());
    await _pump(t, s, _spec(period: ReportPeriodKind.none, extraQuery: () => ''));
    expect(sent.single.uri.query, isEmpty);
  });

  testWidgets('changing the period sends a new request', (t) async {
    final (s, sent) = fakeSession((_) => _reply());
    await _pump(t, s, _spec());
    await t.tap(find.text('Last month'));
    await t.pumpAndSettle();
    expect(sent.length, 2);
    expect(sent.last.uri.queryParameters['from_date'], isNot(sent.first.uri.queryParameters['from_date']));
  });

  testWidgets('month mode steps back and forward', (t) async {
    final (s, sent) = fakeSession((_) => _reply());
    await _pump(t, s, _spec(period: ReportPeriodKind.month));
    await t.tap(find.bySemanticsLabel('Previous month'));
    await t.pumpAndSettle();
    final prev = MonthPeriod.of(DateTime.now()).previous;
    expect(sent.last.uri.queryParameters['month'], '${prev.month}');
    expect(sent.last.uri.queryParameters['year'], '${prev.year}');
    await t.tap(find.bySemanticsLabel('Next month'));
    await t.pumpAndSettle();
    expect(sent.last.uri.queryParameters['month'], '${DateTime.now().month}');
  });

  testWidgets('financial year mode steps back', (t) async {
    final (s, sent) = fakeSession((_) => _reply());
    await _pump(t, s, _spec(period: ReportPeriodKind.financialYear));
    await t.tap(find.bySemanticsLabel('Previous year'));
    await t.pumpAndSettle();
    expect(sent.last.uri.queryParameters['financial_year'], FinancialYear.of(DateTime.now()).previous.code);
  });

  testWidgets('a null name and an unparseable total draw dashes and do not throw', (t) async {
    final (s, _) = fakeSession((_) => {
          'data': {
            'rows': [
              {'name': null, 'total': 'abc', 'qty': null},
            ],
          },
        });
    await _pump(t, s, _spec(period: ReportPeriodKind.none));
    expect(t.takeException(), isNull);
    expect(find.text('—'), findsWidgets);
    await t.tap(find.byType(KListRow));
    await t.pumpAndSettle();
    expect(t.takeException(), isNull);
    expect(find.text('Total'), findsOneWidget);
  });

  testWidgets('tapping a row opens a sheet of its columns, formatted', (t) async {
    final (s, _) = fakeSession((_) => _reply());
    await _pump(t, s, _spec(period: ReportPeriodKind.none));
    await t.tap(find.text('Ravi'));
    await t.pumpAndSettle();
    expect(find.text('Qty'), findsOneWidget);
    expect(find.text('₹250.5'), findsWidgets);
    expect(find.text('4'), findsOneWidget);
  });

  testWidgets('onOpenRow replaces the sheet', (t) async {
    Map<String, dynamic>? opened;
    final (s, _) = fakeSession((_) => _reply());
    await _pump(t, s, _spec(period: ReportPeriodKind.none, onOpenRow: (_, r) => opened = r));
    await t.tap(find.text('Asha'));
    await t.pumpAndSettle();
    expect(opened?['name'], 'Asha');
    expect(find.text('Qty'), findsNothing);
  });

  testWidgets('search filters rows by title and subtitle', (t) async {
    final (s, _) = fakeSession((_) => _reply());
    await _pump(t, s, _spec(period: ReportPeriodKind.none));
    await t.enterText(find.byType(TextField), 'delhi');
    await t.pumpAndSettle();
    expect(find.text('Asha'), findsNothing);
    expect(find.text('Ravi'), findsOneWidget);
  });

  testWidgets('sections draw below the main table under their header', (t) async {
    final (s, _) = fakeSession((_) => _reply());
    await _pump(t, s, _spec(period: ReportPeriodKind.none, sections: const [('More rows', 'extra')]));
    expect(find.text('More rows'), findsOneWidget);
    expect(find.text('Extra row'), findsOneWidget);
  });

  testWidgets('no rows shows the empty state and keeps the tiles', (t) async {
    final (s, _) = fakeSession((_) => {'summary': {'total_sales': 5}, 'data': {'rows': []}});
    await _pump(t, s, _spec(period: ReportPeriodKind.none));
    expect(find.text('Nothing for this period'), findsOneWidget);
    expect(find.text('Total sales'), findsOneWidget);
  });

  testWidgets('403 shows no access without Try again', (t) async {
    final (s, _) = fakeSession((_) => {'error': 'Forbidden'}, status: 403);
    await _pump(t, s, _spec());
    expect(find.text('You do not have access to this'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
  });

  testWidgets('a plan error shows the lock state without Try again', (t) async {
    final (s, _) = fakeSession((_) => {'error': 'No', 'code': 'FEATURE_NOT_IN_PLAN'}, status: 403);
    await _pump(t, s, _spec());
    expect(find.text('Not included in your current plan'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
  });

  testWidgets('a server error offers Try again, which reloads', (t) async {
    final (s, sent) = fakeSession((_) => {'error': 'Boom'}, status: 400);
    await _pump(t, s, _spec());
    expect(find.text('Try again'), findsOneWidget);
    await t.tap(find.text('Try again'));
    await t.pumpAndSettle();
    expect(sent.length, 2);
  });

  testWidgets('a late older reply does not overwrite a newer one', (t) async {
    final first = Completer<Object?>();
    var n = 0;
    final sent = <RequestOptions>[];
    final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
      sent.add(o);
      final mine = n++;
      final data = mine == 0 ? await first.future : {'data': {'rows': [{'name': 'Newer', 'total': 1}]}};
      h.resolve(Response(requestOptions: o, statusCode: 200, data: data));
    }));
    final s = AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b'}});
    await t.pumpWidget(MaterialApp(home: TableReportScreen(session: s, spec: _spec())));
    await t.pump();
    await t.tap(find.text('Last month'));
    await t.pumpAndSettle();
    expect(find.text('Newer'), findsOneWidget);
    first.complete({'data': {'rows': [{'name': 'Older', 'total': 2}]}});
    await t.pumpAndSettle();
    expect(find.text('Older'), findsNothing);
    expect(find.text('Newer'), findsOneWidget);
  });

  testWidgets('a reply that lands after the screen is gone does not throw', (t) async {
    final gate = Completer<Object?>();
    final dio = Dio(BaseOptions(baseUrl: 'https://x.test'));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
      final data = await gate.future;
      h.resolve(Response(requestOptions: o, statusCode: 200, data: data));
    }));
    final s = AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b'}});
    await t.pumpWidget(MaterialApp(home: TableReportScreen(session: s, spec: _spec())));
    await t.pump();
    await t.pumpWidget(const MaterialApp(home: SizedBox()));
    gate.complete(_reply());
    await t.pumpAndSettle();
    expect(t.takeException(), isNull);
  });

  testWidgets('a count tile is a plain number; other tiles keep the rupee sign', (t) async {
    final (s, _) = fakeSession((_) => _reply());
    await _pump(t, s, _spec(period: ReportPeriodKind.none, countTiles: const {'summary.orders'}));
    expect(find.text('7'), findsOneWidget);
    expect(find.textContaining('₹7'), findsNothing);
    expect(find.textContaining('1,234.5'), findsOneWidget);
    expect(find.textContaining('₹'), findsWidgets);
  });

  test('a NaN cell draws a dash', () {
    expect(reportCellText('NaN', money: true), '—');
    expect(reportCellText('Infinity', qty: true), '—');
    expect(reportCellText(double.nan, money: true), '—');
  });

  testWidgets('empty main table with a filled section is not "Nothing for this period"', (t) async {
    final (s, _) = fakeSession((_) => {'data': {'rows': []}, 'extra': [{'name': 'Extra row', 'total': 9}]});
    await _pump(t, s, _spec(period: ReportPeriodKind.none, sections: const [('More rows', 'extra')]));
    expect(find.text('Nothing for this period'), findsNothing);
    expect(find.text('Extra row'), findsOneWidget);
    expect(find.text('More rows'), findsOneWidget);
  });

  testWidgets('everything empty, sections included, shows "Nothing for this period"', (t) async {
    final (s, _) = fakeSession((_) => {'data': {'rows': []}, 'extra': []});
    await _pump(t, s, _spec(period: ReportPeriodKind.none, sections: const [('More rows', 'extra')]));
    expect(find.text('Nothing for this period'), findsOneWidget);
  });

  testWidgets('a failed pull to refresh keeps the report and toasts the message', (t) async {
    var fail = false;
    final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      h.resolve(Response(requestOptions: o, statusCode: fail ? 400 : 200, data: fail ? {'error': 'Boom'} : _reply()));
    }));
    final s = AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b'}});
    await _pump(t, s, _spec(period: ReportPeriodKind.none));
    fail = true;
    await t.fling(find.text('Asha'), const Offset(0, 300), 1000);
    await t.pumpAndSettle();
    expect(find.text('Asha'), findsOneWidget);
    expect(find.text('Boom'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
    await t.pump(const Duration(seconds: 4));
  });
}

String ymdOf(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
