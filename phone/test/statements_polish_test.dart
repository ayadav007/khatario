import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pdf/pdf.dart' show PdfPageFormat;
import 'package:printing/printing.dart';
import 'package:khatario_phone/screens/accounting/journal_entries_screen.dart';
import 'package:khatario_phone/screens/invoices/invoice_detail_screen.dart';
import 'package:khatario_phone/screens/reports/cash_flow_screen.dart';
import 'package:khatario_phone/screens/reports/financial_statements_screens.dart';
import 'package:khatario_phone/screens/reports/pl_drilldown_screen.dart';
import 'package:khatario_phone/screens/reports/report_period.dart';
import 'package:khatario_phone/screens/reports/statement_pdf.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

const rupee = '₹';

Finder _share() => find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == 'Share PDF');

const _pdfBytes = <int>[37, 80, 68, 70];

Map<String, dynamic> _pl() => {
      'sections': [
        {
          'key': 'operating_income',
          'label': 'Operating income',
          'total': 1500,
          'accounts': [
            {
              'id': 'acc-sales',
              'account_name': 'Sales',
              'total': 1500,
              'amount': 1000,
              'children': [
                {'id': 'acc-sales-web', 'account_name': 'Web sales', 'total': 500, 'amount': 500, 'children': []},
              ],
            },
          ],
        },
        {
          'key': 'cost_of_goods_sold',
          'label': 'Cost of goods sold',
          'total': 800,
          'accounts': [
            {'id': 'acc-dc', 'account_name': 'Direct costs', 'total': 50, 'amount': 50, 'children': []},
          ],
        },
        {
          'key': 'operating_expense',
          'label': 'Operating expense',
          'total': 300,
          'accounts': [
            {'id': 'acc-rent', 'account_name': 'Rent', 'total': 300, 'amount': 300, 'children': []},
          ],
        },
      ],
      'period': {'from_date': '2026-04-01', 'to_date': '2026-11-10', 'financial_year': '2026-2027'},
      'periodic_cogs': {'opening_stock': 200, 'purchases': 700, 'closing_stock': 100, 'cost_of_goods_sold': 800},
      'elimination': {'applied': false, 'net': 0},
      'gross_profit': 700,
      'operating_profit': 400,
      'net_profit': 400,
    };

Map<String, dynamic> _drill() => {
      'kind': 'vouchers',
      'title': '4001 Sales',
      'total': 1500,
      'count': 3,
      'truncated': false,
      'rows': [
        {'voucher_id': 'inv1', 'voucher_type': 'invoice', 'entry_date': '2026-05-03', 'document_number': 'INV-9', 'party_name': 'Asha Traders', 'narration': null, 'amount': 1000.0, 'source_missing': false, 'link': '/invoices/inv1'},
        {'voucher_id': 'j1', 'voucher_type': 'journal', 'entry_date': '2026-06-01', 'document_number': 'JV-2', 'party_name': null, 'narration': 'Adjust sales', 'amount': 500.0, 'source_missing': false, 'link': '/journal-entries/j1'},
        {'voucher_id': 'x1', 'voucher_type': 'opening_balance', 'entry_date': '2026-04-01', 'document_number': null, 'party_name': null, 'narration': 'Opening', 'amount': 0.0, 'source_missing': false, 'link': null},
      ],
    };

(int, Object?) _reply(RequestOptions o, {Map<String, Object?> pdfError = const {}}) {
  final p = o.uri.path;
  if (p.endsWith('/pdf')) {
    if (pdfError.isNotEmpty) return (500, utf8.encode(jsonEncode(pdfError)));
    return (200, _pdfBytes);
  }
  if (p == '/api/reports/profit-loss/drilldown' && (o.uri.queryParameters['line'] ?? '').endsWith('_stock')) {
    return (200, {'kind': 'items', 'title': 'Opening Stock', 'total': 200, 'count': 1, 'truncated': false, 'rows': [
      {'item_id': 'i1', 'item_name': 'Basmati rice', 'quantity': 4, 'unit_cost': 50, 'total_value': 200.0, 'link': '/items/i1'},
    ]});
  }
  return switch (p) {
    '/api/reports/profit-loss' => (200, _pl()),
    '/api/reports/profit-loss/drilldown' => (200, _drill()),
    '/api/reports/balance-sheet' => (200, {'assets': {}, 'liabilities': {}, 'equity': {}}),
    '/api/reports/trial-balance' => (200, {'accounts': [], 'totals': {}}),
    '/api/reports/cash-flow' => (200, {'operating_activities': {}, 'investing_activities': {}, 'financing_activities': {}}),
    _ => (404, {'error': 'no route $p'}),
  };
}

void main() {
  group('statement pdf paths', () {
    test('send the period names each pdf route reads', () {
      final p = ReportPeriod.of('this_fy');
      expect(profitLossPdfPath(p), '/api/reports/profit-loss/pdf?from_date=${p.fromIso}&to_date=${p.toIso}');
      expect(cashFlowPdfPath(p), '/api/reports/cash-flow/pdf?from_date=${p.fromIso}&to_date=${p.toIso}');
      expect(balanceSheetPdfPath(DateTime(2026, 3, 31)), '/api/reports/balance-sheet/pdf?as_on_date=2026-03-31');
      expect(trialBalancePdfPath(DateTime(2026, 3, 31)), '/api/reports/trial-balance/pdf?as_on_date=2026-03-31');
    });

    test('drill-down path names the account line, ids and section', () {
      final p = ReportPeriod.of('this_fy');
      expect(
        plDrillPath(p, ['a', 'b'], 'operating_income'),
        '/api/reports/profit-loss/drilldown?from_date=${p.fromIso}&to_date=${p.toIso}&line=account&account_ids=a%2Cb&section=operating_income',
      );
    });

    test('an account and its sub-accounts are all drilled together', () {
      expect(plAccountSubtreeIds({'id': 'a', 'children': [{'id': 'b', 'children': [{'id': 'c'}]}, {'id': 'd'}]}), ['a', 'b', 'c', 'd']);
    });
  });

  group('shared pdf viewer', () {
    testWidgets('openPdfViewer shows the title and a PdfPreview named after the file', (t) async {
      await pumpScreen(t, Builder(builder: (context) => Scaffold(body: KButton.secondary(label: 'Open', onPressed: () => openPdfViewer(context, _pdfBytes, title: 'Profit & loss', fileName: 'Profit_loss.pdf')))));
      await t.tap(find.text('Open'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(find.text('Profit & loss'), findsOneWidget);
      final preview = t.widget<PdfPreview>(find.byType(PdfPreview));
      expect(preview.pdfFileName, 'Profit_loss.pdf');
      expect(await preview.build(PdfPageFormat.a4), Uint8List.fromList(_pdfBytes));
    });

    test('statement file names are made safe', () {
      expect(statementPdfFileName('Profit & loss'), 'Profit_loss.pdf');
      expect(statementPdfFileName(''), 'Statement.pdf');
    });
  });

  group('share pdf', () {
    Future<(AppSession, List<RequestOptions>, List<(List<int>, String)>)> open(
      WidgetTester t,
      Widget Function(AppSession, PdfOpener) build, {
      Map<String, Object?> pdfError = const {},
    }) async {
      final opened = <(List<int>, String)>[];
      final (s, sent) = recordedSession((o, _) => _reply(o, pdfError: pdfError));
      await pumpScreen(t, build(s, (ctx, bytes, title) async => opened.add((bytes, title))));
      return (s, sent, opened);
    }

    final fy = ReportPeriod.of('this_fy');
    final cases = <(String, String, Widget Function(AppSession, PdfOpener), Map<String, String>)>[
      ('Profit & loss', '/api/reports/profit-loss/pdf', (s, o) => ProfitLossScreen(session: s, openPdf: o), {'from_date': fy.fromIso, 'to_date': fy.toIso}),
      ('Cash flow', '/api/reports/cash-flow/pdf', (s, o) => CashFlowScreen(session: s, openPdf: o), {'from_date': fy.fromIso, 'to_date': fy.toIso}),
      ('Balance sheet', '/api/reports/balance-sheet/pdf', (s, o) => BalanceSheetScreen(session: s, openPdf: o), {}),
      ('Trial balance', '/api/reports/trial-balance/pdf', (s, o) => TrialBalanceScreen(session: s, openPdf: o), {}),
    ];

    for (final (name, path, build, expected) in cases) {
      testWidgets('$name: Share PDF downloads the pdf route with the screen period and opens it', (t) async {
        final (_, sent, opened) = await open(t, build);
        await t.tap(_share());
        await t.pumpAndSettle();
        final o = requestsOf(sent, 'GET', path).single;
        for (final e in expected.entries) {
          expect(o.uri.queryParameters[e.key], e.value);
        }
        if (expected.isEmpty) expect(o.uri.queryParameters['as_on_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
        for (final k in forbiddenIdentityKeys) {
          expect(o.uri.queryParameters.containsKey(k), isFalse);
        }
        expect(opened, hasLength(1));
        expect(opened.single.$1, _pdfBytes);
        expect(opened.single.$2, name);
      });

      testWidgets('$name: a failed download shows the server message and opens nothing', (t) async {
        final (_, _, opened) = await open(t, build, pdfError: {'error': 'Could not make the PDF'});
        await t.tap(_share());
        await t.pumpAndSettle();
        expect(find.text('Could not make the PDF'), findsOneWidget);
        expect(opened, isEmpty);
      });
    }

    testWidgets('Profit & loss: another period is the one the pdf asks for', (t) async {
      final (_, sent, _) = await open(t, (s, o) => ProfitLossScreen(session: s, openPdf: o));
      await t.tap(find.text('Last month'));
      await t.pumpAndSettle();
      await t.tap(_share());
      await t.pumpAndSettle();
      final last = ReportPeriod.of('last_month');
      final o = requestsOf(sent, 'GET', '/api/reports/profit-loss/pdf').single;
      expect(o.uri.queryParameters['from_date'], last.fromIso);
      expect(o.uri.queryParameters['to_date'], last.toIso);
    });
  });

  group('profit and loss drill-down', () {
    PlDrilldownScreen drill(AppSession s, {String? section = 'operating_income'}) =>
        PlDrilldownScreen(session: s, title: 'Sales', period: ReportPeriod.of('this_fy'), accountIds: const ['acc-sales'], section: section);

    testWidgets('tapping an account sends its id and sub-accounts, the section and the period', (t) async {
      final (s, sent) = recordedSession((o, _) => _reply(o));
      await pumpScreen(t, ProfitLossScreen(session: s, openPdf: (c, b, ti) async {}));
      await t.tap(find.text('Sales'));
      await t.pumpAndSettle();
      final o = requestsOf(sent, 'GET', '/api/reports/profit-loss/drilldown').single;
      final fy = ReportPeriod.of('this_fy');
      expect(o.uri.queryParameters, {
        'from_date': fy.fromIso,
        'to_date': fy.toIso,
        'line': 'account',
        'financial_year': '2026-2027',
        'account_ids': 'acc-sales,acc-sales-web',
        'section': 'operating_income',
      });
      expect(find.byType(PlDrilldownScreen), findsOneWidget);
    });

    testWidgets('an account in the section sends the financial year the statement named', (t) async {
      final (s, sent) = recordedSession((o, _) => _reply(o));
      await pumpScreen(t, ProfitLossScreen(session: s, openPdf: (c, b, ti) async {}));
      await t.tap(find.text('Rent'));
      await t.pumpAndSettle();
      final o = requestsOf(sent, 'GET', '/api/reports/profit-loss/drilldown').single;
      expect(o.uri.queryParameters['financial_year'], '2026-2027');
      expect(o.uri.queryParameters['account_ids'], 'acc-rent');
    });

    for (final (label, line, shown) in [
      ('Opening stock', 'opening_stock', 'Basmati rice'),
      ('Add: Purchases (net of returns)', 'purchases', 'INV-9'),
      ('Less: Closing stock', 'closing_stock', 'Basmati rice'),
    ]) {
      testWidgets('the $label row sends line=$line with the period and financial year, and shows the server rows', (t) async {
        final (s, sent) = recordedSession((o, _) => _reply(o));
        await pumpScreen(t, ProfitLossScreen(session: s, openPdf: (c, b, ti) async {}));
        await t.tap(find.text(label));
        await t.pumpAndSettle();
        final fy = ReportPeriod.of('this_fy');
        final o = requestsOf(sent, 'GET', '/api/reports/profit-loss/drilldown').single;
        expect(o.uri.queryParameters, {'from_date': fy.fromIso, 'to_date': fy.toIso, 'line': line, 'financial_year': '2026-2027'});
        expect(find.text(shown), findsOneWidget);
      });
    }

    testWidgets('an items drill-down shows quantity, unit cost and value from the server', (t) async {
      final (s, _) = recordedSession((o, _) => _reply(o));
      await pumpScreen(t, ProfitLossScreen(session: s, openPdf: (c, b, ti) async {}));
      await t.tap(find.text('Opening stock'));
      await t.pumpAndSettle();
      expect(find.text('Basmati rice'), findsOneWidget);
      expect(find.text('4 × ${rupee}50.00'), findsOneWidget);
      expect(find.text('${rupee}200.00'), findsWidgets);
    });

    testWidgets('a section total opens what makes it up, and a part opens its entries', (t) async {
      final (s, sent) = recordedSession((o, _) => _reply(o));
      await pumpScreen(t, ProfitLossScreen(session: s, openPdf: (c, b, ti) async {}));
      await t.tap(find.text('Total cost of goods sold'));
      await t.pumpAndSettle();
      expect(find.byType(PlBreakdownScreen), findsOneWidget);
      expect(requestsOf(sent, 'GET', '/api/reports/profit-loss/drilldown'), isEmpty);
      for (final l in ['Opening Stock', 'Purchases (net of returns)', 'Closing Stock', 'Direct costs']) {
        expect(find.text(l), findsOneWidget);
      }
      expect(find.text('+'), findsNWidgets(3));
      expect(find.text('−'), findsOneWidget);
      await t.tap(find.text('Purchases (net of returns)'));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/reports/profit-loss/drilldown').single.uri.queryParameters['line'], 'purchases');
    });

    testWidgets('gross profit opens income less cost of goods sold, and income opens its accounts', (t) async {
      final (s, sent) = recordedSession((o, _) => _reply(o));
      await pumpScreen(t, ProfitLossScreen(session: s, openPdf: (c, b, ti) async {}));
      await t.tap(find.widgetWithText(InkWell, 'Gross profit'));
      await t.pumpAndSettle();
      expect(find.text('Operating income'), findsOneWidget);
      expect(find.text('Cost of goods sold'), findsOneWidget);
      await t.tap(find.text('Operating income'));
      await t.pumpAndSettle();
      expect(find.byType(PlBreakdownScreen), findsOneWidget);
      await t.tap(find.text('Sales'));
      await t.pumpAndSettle();
      final o = requestsOf(sent, 'GET', '/api/reports/profit-loss/drilldown').single;
      expect(o.uri.queryParameters['account_ids'], 'acc-sales,acc-sales-web');
      expect(o.uri.queryParameters['section'], 'operating_income');
    });

    testWidgets('operating and net profit open their parts', (t) async {
      final (s, _) = recordedSession((o, _) => _reply(o));
      await pumpScreen(t, ProfitLossScreen(session: s, openPdf: (c, b, ti) async {}));
      await t.tap(find.widgetWithText(InkWell, 'Operating profit'));
      await t.pumpAndSettle();
      expect(find.text('Gross profit'), findsOneWidget);
      expect(find.text('Operating expense'), findsOneWidget);
      Navigator.of(t.element(find.byType(PlBreakdownScreen))).pop();
      await t.pumpAndSettle();
      await t.tap(find.widgetWithText(InkWell, 'Net profit'));
      await t.pumpAndSettle();
      expect(find.text('Operating profit'), findsOneWidget);
    });

    testWidgets('shows the server rows and totals without adding anything up', (t) async {
      final (s, _) = recordedSession((o, _) => _reply(o));
      await pumpScreen(t, drill(s));
      expect(find.text('4001 Sales'), findsWidgets);
      expect(find.text('INV-9'), findsOneWidget);
      expect(find.text('Asha Traders'), findsOneWidget);
      expect(find.text('${rupee}1,000.00'), findsOneWidget);
      expect(find.text('${rupee}1,500.00'), findsWidgets);
      expect(find.text('Adjust sales'), findsOneWidget);
    });

    testWidgets('a row opens its invoice or journal, and a row without a source does nothing', (t) async {
      final (s, _) = recordedSession((o, _) => _reply(o));
      await pumpScreen(t, drill(s));
      await t.tap(find.text('Opening'));
      await t.pumpAndSettle();
      expect(find.byType(PlDrilldownScreen), findsOneWidget);
      expect(find.byType(InvoiceDetailScreen), findsNothing);
      await t.tap(find.text('INV-9'));
      await t.pumpAndSettle();
      expect(find.byType(InvoiceDetailScreen), findsOneWidget);
      Navigator.of(t.element(find.byType(InvoiceDetailScreen))).pop();
      await t.pumpAndSettle();
      await t.tap(find.text('JV-2'));
      await t.pumpAndSettle();
      expect(find.byType(JournalDetailScreen), findsOneWidget);
    });

    testWidgets('a failed load shows the server message and retries', (t) async {
      var fail = true;
      final (s, sent) = recordedSession((o, _) => fail && o.uri.path.endsWith('/drilldown') ? (400, {'error': 'account_ids is required'}) : _reply(o));
      await pumpScreen(t, drill(s, section: null));
      expect(find.text('account_ids is required'), findsOneWidget);
      fail = false;
      await t.tap(find.widgetWithText(KButton, 'Try again'));
      await t.pumpAndSettle();
      expect(find.text('INV-9'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/reports/profit-loss/drilldown'), 2);
    });

    testWidgets('a truncated list says so', (t) async {
      final (s, _) = recordedSession((o, _) => o.uri.path.endsWith('/drilldown') ? (200, {..._drill(), 'truncated': true, 'count': 900}) : _reply(o));
      await pumpScreen(t, drill(s, section: null));
      expect(find.textContaining('first 500'), findsOneWidget);
    });
  });
}
