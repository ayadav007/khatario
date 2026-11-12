import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/reports/eway_bills_screen.dart';
import 'package:khatario_phone/screens/reports/gst_cash_ledger_screen.dart';
import 'package:khatario_phone/screens/reports/gst_logic.dart';
import 'package:khatario_phone/screens/reports/gst_reports.dart';
import 'package:khatario_phone/screens/reports/gstr1_screen.dart';
import 'package:khatario_phone/screens/reports/gstr2b_screen.dart';
import 'package:khatario_phone/screens/reports/gstr3b_screen.dart';
import 'package:khatario_phone/screens/reports/report_period.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/gst_server.dart';

/// Every reply is written from the route (see the report): the keys, the period names and the bodies.
const _gstr1 = '/api/reports/gst/gstr1';
const _filings = '/api/reports/gst/gstr1/filings';
const _markFiled = '/api/reports/gst/gstr1/f1111111-0000-4000-8000-000000000001/mark-filed';
const _excel = '/api/reports/gst/gstr1/export/excel';
const _readiness = '/api/gst/return-readiness';

void _bigScreen(WidgetTester t) {
  t.view.physicalSize = const Size(800, 6000);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
}

Future<void> _open(WidgetTester t, Widget screen) async {
  _bigScreen(t);
  await t.pumpWidget(MaterialApp(home: screen));
  await t.pumpAndSettle();
}

String _two(int n) => n.toString().padLeft(2, '0');

void main() {
  final now = DateTime.now();

  group('routing', () {
    test('every GST href has a native screen', () {
      final (s, _) = gstSession((_) => {});
      expect(gstReportHrefs, hasLength(7));
      for (final href in gstReportHrefs) {
        expect(gstReportScreen(s, href), isNotNull, reason: href);
        expect(nativeScreenFor(s, href), isNotNull, reason: href);
        expect(routeTier(s, href), RouteTier.native, reason: href);
      }
      expect(nativeScreenFor(s, '/reports/gst/gstr1'), isA<Gstr1Screen>());
      expect(nativeScreenFor(s, '/reports/gst/gstr3b'), isA<Gstr3bScreen>());
      expect(nativeScreenFor(s, '/reports/gst/gstr2b'), isA<Gstr2bScreen>());
      expect(gstReportScreen(s, '/reports/gst/gstr9'), isNull);
    });

    testWidgets('the reports home and the More menu open the new GST screens', (t) async {
      final (s, _) = gstSession((_) => <String, dynamic>{});
      late BuildContext ctx;
      await t.pumpWidget(MaterialApp(home: Builder(builder: (c) {
        ctx = c;
        return const SizedBox();
      })));
      for (final (href, type) in [
        ('/reports/gst/gstr1', Gstr1Screen),
        ('/reports/gst/gstr3b', Gstr3bScreen),
        ('/reports/gst/gstr2b', Gstr2bScreen),
        ('/reports/gst/gstr2b-reconciliation', Gstr2bReconciliationScreen),
        ('/reports/gst/reconciliation', Gstr13bReconciliationScreen),
        ('/reports/gst/compliance', GstAlertsScreen),
        ('/reports/gst/cash-ledger', GstCashLedgerScreen),
        ('/eway-bills', EwayBillsScreen),
      ]) {
        openAppHref(ctx, s, href, 'x');
        await t.pumpAndSettle();
        expect(find.byType(type), findsOneWidget, reason: href);
        Navigator.of(ctx).pop();
        await t.pumpAndSettle();
      }
    });

    test('GSTR-9 stays on the website and E-way bills are native', () {
      final (s, _) = gstSession((_) => {});
      expect(routeTier(s, '/reports/gst/gstr9'), RouteTier.website);
      expect(websiteByDesign.contains('/reports/gst/gstr9'), isTrue);
      expect(nativeScreenFor(s, '/eway-bills'), isNotNull);
      expect(routeTier(s, '/eway-bills'), RouteTier.native);
    });
  });

  group('period names the routes read', () {
    test('month and year for GSTR-1, 3B and 2B; filing_period for 2B reconciliation; period for 1 vs 3B', () {
      final m = MonthPeriod(2026, 9);
      expect(gstr1Path(m, 'all'), '/api/reports/gst/gstr1?month=9&year=2026&customer_type=all');
      expect(gstr1Path(m, 'b2b'), '/api/reports/gst/gstr1?month=9&year=2026&customer_type=b2b');
      expect(gstr3bPath(m), '/api/reports/gst/gstr3b?month=9&year=2026');
      expect(gstr2bPath(m), '/api/reports/gst/gstr2b?month=9&year=2026');
      expect(gstPeriodKey(m), '2026-09');
      expect(gstr2bReconcilePath(m), '/api/gst/gstr2b/reconcile?filing_period=2026-09');
      expect(gstReconciliationPath(m, 'live_vs_live'), '/api/reports/gst/reconciliation?period=2026-09&mode=live_vs_live');
      expect(gstMonthEnd(m), '2026-09-30');
      expect(gstMonthEnd(MonthPeriod(2028, 2)), '2028-02-29');
    });
  });

  group('GSTR-1', () {
    Object? server(RequestOptions o, {Object? filings, Map<String, GstReply>? override}) {
      final hit = override?[o.uri.path];
      if (hit != null) return hit;
      return switch (o.uri.path) {
        _gstr1 => gstFixture('gstr1'),
        _filings => filings ?? gstFixture('gstr1_filings'),
        _ => <String, dynamic>{},
      };
    }

    testWidgets('loads the month the route reads, with the server totals and section tiles', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, Gstr1Screen(session: s));
      final first = gstCalls(sent, 'GET', _gstr1).single.uri.queryParameters;
      expect(first.keys.toSet(), {'month', 'year', 'customer_type'});
      expect(first['month'], '${now.month}');
      expect(first['year'], '${now.year}');
      expect(first['customer_type'], 'all');
      for (final k in ['business_id', 'user_id', 'created_by']) {
        expect(first.containsKey(k), isFalse, reason: k);
      }
      expect(find.text('₹1,25,000'), findsOneWidget);
      expect(find.text('₹22,500'), findsOneWidget);
      expect(find.text('Total taxable value'), findsOneWidget);
      expect(find.text('Total tax'), findsOneWidget);
      for (final title in ['B2B invoices', 'B2C large', 'B2C small', 'Exports', 'Credit and debit notes', 'Nil rated', 'HSN summary']) {
        expect(find.text(title), findsWidgets, reason: title);
      }
      expect(find.text('SEZ'), findsNothing, reason: 'an empty SEZ section is not drawn, as on the website');
      expect(gstCalls(sent, 'GET', _filings), hasLength(1));
    });

    testWidgets('a section tile opens its rows and a row its figures', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, Gstr1Screen(session: s));
      await t.tap(find.text('B2B invoices'));
      await t.pumpAndSettle();
      expect(find.text('INV-2026-0042'), findsOneWidget);
      expect(find.text('INV-2026-0043'), findsOneWidget);
      await t.tap(find.text('INV-2026-0042'));
      await t.pumpAndSettle();
      expect(find.text('27AAAPL1234C1ZV'), findsOneWidget);
      expect(find.text('₹11,800'), findsWidgets);
      expect(find.text('₹900'), findsWidgets);
    });

    testWidgets('credit notes and HSN rows show the route keys', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, Gstr1Screen(session: s));
      await t.tap(find.text('Credit and debit notes'));
      await t.pumpAndSettle();
      expect(find.text('CN-2026-0007'), findsOneWidget);
      await t.tap(find.bySemanticsLabel('Back'));
      await t.pumpAndSettle();
      await t.tap(find.text('HSN summary'));
      await t.pumpAndSettle();
      expect(find.text('1006'), findsOneWidget);
      expect(find.text('₹13,440'), findsOneWidget);
    });

    testWidgets('the customer type chip reloads with customer_type', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, Gstr1Screen(session: s));
      await t.tap(find.text('B2B only'));
      await t.pumpAndSettle();
      final calls = gstCalls(sent, 'GET', _gstr1);
      expect(calls, hasLength(2));
      expect(calls.last.uri.queryParameters['customer_type'], 'b2b');
    });

    testWidgets('stepping to the last month sends that month', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, Gstr1Screen(session: s));
      await t.tap(find.bySemanticsLabel('Previous month'));
      await t.pumpAndSettle();
      final prev = MonthPeriod.of(now).previous;
      final q = gstCalls(sent, 'GET', _gstr1).last.uri.queryParameters;
      expect(q['month'], '${prev.month}');
      expect(q['year'], '${prev.year}');
    });

    testWidgets('a draft filing shows Draft, its period and invoices, and Mark as filed', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, Gstr1Screen(session: s));
      expect(find.text('Draft'), findsOneWidget);
      expect(find.textContaining('2026-11'), findsWidgets);
      expect(find.textContaining('8 invoices'), findsWidgets);
      expect(find.text('Mark as filed'), findsOneWidget);
    });

    testWidgets('a filed filing shows Filed and no Mark as filed', (t) async {
      final filed = {
        'filings': [
          {...(gstFixture('gstr1_filings')['filings'] as List).first as Map<String, dynamic>, 'status': 'filed'},
        ],
      };
      final (s, _) = gstSession((o) => server(o, filings: filed));
      await _open(t, Gstr1Screen(session: s));
      expect(find.text('Filed'), findsOneWidget);
      expect(find.text('Mark as filed'), findsNothing);
    });

    testWidgets('Mark as filed asks first, names the period and invoices, posts once with an empty body and reloads', (t) async {
      final (s, sent) = gstSession((o) => o.method == 'POST' ? {'success': true, 'message': 'GSTR-1 marked as filed', 'locked_invoices_count': 8, 'filing_period': '2026-11'} : server(o));
      await _open(t, Gstr1Screen(session: s));
      await t.tap(find.text('Mark as filed'));
      await t.pumpAndSettle();
      expect(find.text('Mark GSTR-1 as filed?'), findsOneWidget);
      expect(find.textContaining('GSTR-1 for 2026-11'), findsOneWidget);
      expect(find.textContaining('8 invoices'), findsWidgets);
      expect(find.textContaining('cannot be undone'), findsOneWidget);
      expect(gstCalls(sent, 'POST', _markFiled), isEmpty, reason: 'nothing is posted before the answer');
      await t.tap(find.text('Yes, mark as filed'));
      await t.pumpAndSettle();
      final posts = gstCalls(sent, 'POST', _markFiled);
      expect(posts, hasLength(1));
      expect(posts.single.data, isEmpty, reason: 'no filed_by, user_id or business_id: the server knows who is signed in');
      expect(gstCalls(sent, 'GET', _gstr1), hasLength(2), reason: 'the report loads again');
      expect(gstCalls(sent, 'GET', _filings), hasLength(2));
    });

    testWidgets('Not now posts nothing', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, Gstr1Screen(session: s));
      await t.tap(find.text('Mark as filed'));
      await t.pumpAndSettle();
      await t.tap(find.text('Not now'));
      await t.pumpAndSettle();
      expect(gstCalls(sent, 'POST', _markFiled), isEmpty);
    });

    testWidgets('a refused Mark as filed shows the server message and leaves the screen as it was', (t) async {
      final (s, sent) = gstSession((o) => o.method == 'POST' ? const GstReply({'error': 'Filing is already marked as filed'}, status: 400) : server(o));
      await _open(t, Gstr1Screen(session: s));
      await t.tap(find.text('Mark as filed'));
      await t.pumpAndSettle();
      await t.tap(find.text('Yes, mark as filed'));
      await t.pumpAndSettle();
      expect(find.text('Filing is already marked as filed'), findsOneWidget);
      expect(find.text('Draft'), findsOneWidget);
      expect(find.text('Mark as filed'), findsOneWidget);
      expect(gstCalls(sent, 'POST', _markFiled), hasLength(1));
      expect(gstCalls(sent, 'GET', _gstr1), hasLength(1), reason: 'a refusal does not reload');
    });

    testWidgets('Download Excel checks readiness, fetches the workbook for the month and shares it', (t) async {
      final shared = <(List<int>, String)>[];
      final (s, sent) = gstSession((o) {
        if (o.uri.path == _readiness) return {'blocked': false, 'needsAcknowledgement': [], 'snapshotId': 'x'};
        if (o.uri.path == _excel) return <int>[80, 75, 3, 4];
        return server(o);
      });
      await _open(t, Gstr1Screen(session: s, shareFile: (bytes, name) async => shared.add((bytes, name))));
      await t.tap(find.text('Download Excel'));
      await t.pumpAndSettle();
      final ready = gstCalls(sent, 'GET', _readiness).single.uri.queryParameters;
      expect(ready, {'kind': 'gstr1', 'period': '${now.year}-${_two(now.month)}'});
      final excel = gstCalls(sent, 'GET', _excel).single.uri.queryParameters;
      expect(excel, {'month': '${now.month}', 'year': '${now.year}'});
      expect(shared, hasLength(1));
      expect(shared.single.$1, [80, 75, 3, 4]);
      expect(shared.single.$2, 'GSTR1_${_two(now.month)}_${now.year}.xlsx');
    });

    testWidgets('a blocked readiness check stops the download and says why', (t) async {
      final shared = <String>[];
      final (s, sent) = gstSession((o) {
        if (o.uri.path == _readiness) return {'blocked': true, 'needsAcknowledgement': []};
        return server(o);
      });
      await _open(t, Gstr1Screen(session: s, shareFile: (bytes, name) async => shared.add(name)));
      await t.tap(find.text('Download Excel'));
      await t.pumpAndSettle();
      expect(find.textContaining('Download is stopped'), findsOneWidget);
      expect(gstCalls(sent, 'GET', _excel), isEmpty);
      expect(shared, isEmpty);
    });

    testWidgets('issues to review send the user to the website, no file is built', (t) async {
      final (s, sent) = gstSession((o) {
        if (o.uri.path == _readiness) {
          return {'blocked': false, 'needsAcknowledgement': [{'key': 'k'}], 'snapshotId': 'x'};
        }
        return server(o);
      });
      await _open(t, Gstr1Screen(session: s, shareFile: (bytes, name) async {}));
      await t.tap(find.text('Download Excel'));
      await t.pumpAndSettle();
      expect(find.textContaining('review'), findsWidgets);
      expect(gstCalls(sent, 'GET', _excel), isEmpty);
    });

    testWidgets('a refused export shows the server message', (t) async {
      final (s, _) = gstSession((o) {
        if (o.uri.path == _readiness) return {'blocked': false, 'needsAcknowledgement': []};
        if (o.uri.path == _excel) return GstReply(utf8.encode('{"error":"Business GSTIN is required for GSTR-1 Excel export"}'), status: 400);
        return server(o);
      });
      await _open(t, Gstr1Screen(session: s, shareFile: (bytes, name) async {}));
      await t.tap(find.text('Download Excel'));
      await t.pumpAndSettle();
      expect(find.text('Business GSTIN is required for GSTR-1 Excel export'), findsOneWidget);
    });

    testWidgets('a failed filings call still shows the report, without the filing card', (t) async {
      final (s, _) = gstSession((o) => server(o, override: {_filings: const GstReply({'error': 'nope'}, status: 500)}));
      await _open(t, Gstr1Screen(session: s));
      expect(find.text('₹1,25,000'), findsOneWidget);
      expect(find.text('Mark as filed'), findsNothing);
    });
  });

  group('GSTR-3B', () {
    const cash = '/api/gst/cash-ledger';
    Object? server(RequestOptions o) => switch (o.uri.path) {
          '/api/reports/gst/gstr3b' => gstFixture('gstr3b'),
          cash => gstFixture('gst_cash_ledger'),
          _ => <String, dynamic>{},
        };

    testWidgets('loads the month and the cash balances at its end; shows the server totals', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, Gstr3bScreen(session: s));
      final q = gstCalls(sent, 'GET', '/api/reports/gst/gstr3b').single.uri.queryParameters;
      expect(q, {'month': '${now.month}', 'year': '${now.year}'});
      final c = gstCalls(sent, 'GET', cash).single.uri.queryParameters;
      expect(c.keys.toSet(), {'as_on_date'});
      expect(c['as_on_date'], gstMonthEnd(MonthPeriod.of(now)));
      expect(find.text('₹18,000.00'), findsWidgets);
      expect(find.text('₹5,580.00'), findsWidgets);
      expect(find.text('₹12,420.00'), findsWidgets);
    });

    testWidgets('draws tables 3.1, 3.2, 4 and 5 with the website labels', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, Gstr3bScreen(session: s));
      expect(find.textContaining('3.1 - Details of Outward Supplies'), findsOneWidget);
      expect(find.textContaining('(a)(i) Inter-state outward taxable supplies'), findsOneWidget);
      expect(find.textContaining('(a)(ii) Intra-state outward taxable supplies'), findsOneWidget);
      expect(find.textContaining('(b) Outward taxable supplies (zero rated)'), findsOneWidget);
      expect(find.textContaining('3.2 - Inter-state supplies to unregistered persons'), findsOneWidget);
      expect(find.text('29-Karnataka'), findsOneWidget);
      expect(find.textContaining('4 - Eligible ITC'), findsOneWidget);
      expect(find.textContaining('(C) Net ITC Available'), findsOneWidget);
      expect(find.textContaining('5 - Tax Liability'), findsOneWidget);
    });

    testWidgets('shows the ledger difference, the warning and the cash ledger', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, Gstr3bScreen(session: s));
      expect(find.textContaining('Mismatch'), findsWidgets);
      expect(find.text('₹250.50'), findsOneWidget);
      expect(find.text('Two purchase bills have no GSTR-2B match yet.'), findsOneWidget);
      expect(find.text('Electronic cash ledger'), findsOneWidget);
      expect(find.text('₹5,000.00'), findsWidgets);
    });

    testWidgets('a cash ledger that fails to load does not hide the return', (t) async {
      final (s, _) = gstSession((o) => o.uri.path == cash ? const GstReply({'error': 'x'}, status: 403) : server(o));
      await _open(t, Gstr3bScreen(session: s));
      expect(find.text('₹12,420.00'), findsWidgets);
      expect(find.text('Electronic cash ledger'), findsNothing);
    });
  });

  group('GSTR-2B', () {
    testWidgets('loads the month; shows the server summary and the purchases', (t) async {
      final (s, sent) = gstSession((o) => o.uri.path == '/api/reports/gst/gstr2b' ? gstFixture('gstr2b') : {});
      await _open(t, Gstr2bScreen(session: s));
      final q = gstCalls(sent, 'GET', '/api/reports/gst/gstr2b').single.uri.queryParameters;
      expect(q, {'month': '${now.month}', 'year': '${now.year}'});
      expect(find.text('₹84,000'), findsOneWidget);
      expect(find.text('₹9,500'), findsOneWidget);
      expect(find.text('₹8,800'), findsOneWidget);
      expect(find.text('BILL-2026-0018'), findsWidgets);
      expect(find.text('BOE-7781'), findsOneWidget);
      expect(find.text('PR-2026-0003'), findsOneWidget);
      expect(find.text('ITC available - all other ITC'), findsOneWidget);
    });

    testWidgets('the 2B file import and the reconciliation open on the website', (t) async {
      final (s, _) = gstSession((o) => o.uri.path == '/api/reports/gst/gstr2b' ? gstFixture('gstr2b') : {});
      await _open(t, Gstr2bScreen(session: s));
      expect(find.text('Import 2B file on the website'), findsOneWidget);
      expect(find.text('Reconcile with books'), findsOneWidget);
    });
  });

  group('every GST report handles its states', () {
    for (final href in gstReportHrefs) {
      testWidgets('$href: a server error offers Try again, then loads', (t) async {
        var calls = 0;
        final (s, _) = gstSession((o) {
          if (o.uri.path.startsWith('/api/reports/gst/gstr1/filings')) return <String, dynamic>{'filings': []};
          calls++;
          return calls == 1 ? const GstReply({'error': 'Database is busy'}, status: 500) : _emptyReplyFor(href);
        });
        await _open(t, gstReportScreen(s, href)!);
        expect(find.text('Database is busy'), findsOneWidget);
        await t.tap(find.text('Try again'));
        await t.pumpAndSettle();
        expect(find.text('Database is busy'), findsNothing);
        expect(find.text('Try again'), findsNothing);
      });

      testWidgets('$href: FEATURE_NOT_IN_PLAN says so', (t) async {
        final (s, _) = gstSession((o) => const GstReply({'error': 'Not in plan', 'code': 'FEATURE_NOT_IN_PLAN'}, status: 403));
        await _open(t, gstReportScreen(s, href)!);
        expect(find.text('Not included in your current plan'), findsOneWidget);
        expect(find.text('Try again'), findsNothing);
      });

      testWidgets('$href: nothing in the period shows an empty state, not an error', (t) async {
        final (s, _) = gstSession((o) => _emptyReplyFor(href));
        await _open(t, gstReportScreen(s, href)!);
        expect(find.byType(KSpinner), findsNothing);
        expect(find.text('Try again'), findsNothing);
      });
    }

    testWidgets('a slow load shows the spinner', (t) async {
      _bigScreen(t);
      final (s, _) = gstSession((_) => {});
      await t.pumpWidget(MaterialApp(home: Gstr3bScreen(session: s)));
      expect(find.byType(KSpinner), findsOneWidget);
      await t.pumpAndSettle();
    });
  });
}

Object? _emptyReplyFor(String href) => switch (href) {
      '/reports/gst/cash-ledger' => {
          'as_on_date': '2026-11-11',
          'igst': {'cash_balance': 0, 'output_liability': 0},
          'cgst': {'cash_balance': 0, 'output_liability': 0},
          'sgst': {'cash_balance': 0, 'output_liability': 0},
          'cess': {'cash_balance': 0, 'output_liability': 0},
          'pooled_rcm': {'liability_account': '2155', 'liability': 0, 'cash_account_when_unspecified': '1130'},
          'statement': [],
        },
      '/reports/gst/compliance' => {'alerts': [], 'dismissed': [], 'resolved': [], 'checked_at': null, 'skipped': null},
      '/reports/gst/gstr2b-reconciliation' => {'filing_period': '2026-11', 'summary': {}, 'missing_references': [], 'invoices': []},
      '/reports/gst/gstr2b' => {'summary': {}, 'b2b': [], 'imports': [], 'cdnr': [], 'itc_summary': []},
      _ => <String, dynamic>{},
    };
