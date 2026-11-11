import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/format.dart';
import 'package:khatario_phone/screens/accounting/assets_tds_logic.dart';
import 'package:khatario_phone/screens/accounting/tds_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/ui/form_kit.dart';

import 'support/finders.dart';
import 'support/recorded_session.dart';

/// Pump while a bottom sheet is open over a saving form: the save button's spinner never settles.
Future<void> settle(WidgetTester t) async {
  await t.pump();
  await t.pump(const Duration(milliseconds: 100));
  await t.pump(const Duration(seconds: 1));
}

void main() {
  group('TDS logic', () {
    test('the year list is five long financial years, newest first, as the server stores them', () {
      expect(tdsYears(DateTime(2026, 11, 10)), ['2026-2027', '2025-2026', '2024-2025', '2023-2024', '2022-2023']);
      expect(tdsYears(DateTime(2027, 2, 1)).first, '2026-2027');
    });

    test('the quarter follows the server: Apr-Jun Q1, Jul-Sep Q2, Oct-Dec Q3, Jan-Mar Q4', () {
      expect(tdsQuarterOf(DateTime(2026, 4, 1)), 'Q1');
      expect(tdsQuarterOf(DateTime(2026, 9, 30)), 'Q2');
      expect(tdsQuarterOf(DateTime(2026, 11, 10)), 'Q3');
      expect(tdsQuarterOf(DateTime(2027, 3, 31)), 'Q4');
    });

    test('list paths carry the filters that are set', () {
      expect(tdsListPath('/api/tds/transactions', fy: '2026-2027', quarter: 'Q3', deposited: null), '/api/tds/transactions?financial_year=2026-2027&quarter=Q3');
      expect(tdsListPath('/api/tds/transactions', fy: '2026-2027', quarter: '', deposited: false), '/api/tds/transactions?financial_year=2026-2027&is_deposited=false');
      expect(tdsListPath('/api/tds/payments', fy: '', quarter: '', deposited: null), '/api/tds/payments');
      expect(tdsSummaryPath('2026-2027', 'Q3'), '/api/tds/reports/summary?financial_year=2026-2027&quarter=Q3');
    });

    test('summary tiles are the server figures, and none when the server sent no row', () {
      final tiles = tdsSummaryTiles({
        'summary': {'transaction_count': '4', 'total_tds_amount': '5000.00', 'deposited_amount': '3000.00', 'pending_amount': '2000.00'},
      });
      expect(tiles, [('Transactions', '4'), ('Total TDS', '₹5,000.00'), ('Deposited', '₹3,000.00'), ('Pending', '₹2,000.00')]);
      expect(tdsSummaryTiles({'summary': []}), isEmpty);
      expect(tdsSummaryTiles({}), isEmpty);
    });

    test('a transaction row reads supplier, section, date, the server TDS and the deposit status', () {
      final t = {'supplier_name': 'Asha Traders', 'section_name': '194C', 'transaction_date': '2026-11-03', 'amount': '50000', 'tds_amount': '500', 'financial_year': '2026-2027', 'quarter': 'Q3', 'is_deposited': true};
      expect(tdsTransactionTitle(t), 'Asha Traders');
      expect(tdsTransactionTitle({}), 'N/A');
      expect(tdsTransactionSubtitle(t), '03 Nov 2026 · 194C · 2026-2027 Q3');
      expect(tdsTransactionDeposited(t), isTrue);
      expect(tdsTransactionDeposited({'is_deposited': false}), isFalse);
    });

    test('a payment needs the website required fields', () {
      String? p({String fy = '2026-2027', String q = 'Q3', String challan = 'CH1', DateTime? challanDate, DateTime? deposit, String amount = '500'}) => tdsPaymentProblem(
            financialYear: fy,
            quarter: q,
            challan: challan,
            challanDate: challanDate ?? DateTime(2026, 11, 7),
            depositDate: deposit ?? DateTime(2026, 11, 7),
            amountText: amount,
          );
      expect(p(), isNull);
      expect(p(fy: ''), 'Choose the financial year');
      expect(p(q: ''), 'Choose the quarter');
      expect(p(challan: ' '), 'Enter the challan number');
      expect(p(amount: '0'), 'Enter the TDS amount above zero');
      expect(p(amount: 'x'), 'Enter the TDS amount above zero');
    });

    test('the payment body is the website one, with no identity and no created_by', () {
      final b = tdsPaymentBody(
        financialYear: '2026-2027',
        quarter: 'Q3',
        challan: ' CH123 ',
        challanDate: DateTime(2026, 11, 7),
        depositDate: DateTime(2026, 11, 8),
        amountText: '1,500.50',
        bank: ' HDFC ',
        mode: '',
        reference: 'UTR9',
        notes: '',
      );
      expect(b, {
        'financial_year': '2026-2027',
        'quarter': 'Q3',
        'challan_number': 'CH123',
        'challan_date': '2026-11-07',
        'deposit_date': '2026-11-08',
        'total_tds_amount': 1500.5,
        'bank_name': 'HDFC',
        'payment_mode': null,
        'payment_reference': 'UTR9',
        'notes': null,
      });
      expectNoIdentity(b);
    });

    test('the payment confirmation names the amount, the challan and the period, and the server pending figure when known', () {
      expect(
        tdsPaymentAsk(amountText: '1500.5', challan: 'CH123', financialYear: '2026-2027', quarter: 'Q3', serverPending: 1500.5),
        'Record a TDS payment of ₹1,500.50 against challan CH123 for 2026-2027 Q3? All pending TDS for that quarter is marked deposited. The server shows ₹1,500.50 pending for it.',
      );
      expect(
        tdsPaymentAsk(amountText: '1500', challan: 'CH123', financialYear: '2026-2027', quarter: 'Q3', serverPending: null),
        'Record a TDS payment of ₹1,500.00 against challan CH123 for 2026-2027 Q3? All pending TDS for that quarter is marked deposited.',
      );
    });

    test('the certificate needs supplier, year, quarter and issue date, and posts the website body', () {
      expect(tdsCertificateProblem(supplierId: '', financialYear: '2026-2027', quarter: 'Q3'), 'Choose a supplier');
      expect(tdsCertificateProblem(supplierId: 's1', financialYear: '', quarter: 'Q3'), 'Choose the financial year');
      expect(tdsCertificateProblem(supplierId: 's1', financialYear: '2026-2027', quarter: ''), 'Choose the quarter');
      expect(tdsCertificateProblem(supplierId: 's1', financialYear: '2026-2027', quarter: 'Q3'), isNull);
      final b = tdsCertificateBody(supplierId: 's1', financialYear: '2026-2027', quarter: 'Q3', issueDate: DateTime(2026, 11, 9));
      expect(b, {'supplier_id': 's1', 'financial_year': '2026-2027', 'quarter': 'Q3', 'issue_date': '2026-11-09'});
      expectNoIdentity(b);
    });

    test('a certificate row reads number, supplier, date, the server TDS and the issued status', () {
      final c = {'certificate_number': 'TDS/2026-2027/Q3/ABCD1234', 'supplier_name': 'Asha Traders', 'issue_date': '2026-11-09', 'financial_year': '2026-2027', 'quarter': 'Q3', 'is_issued': true, 'total_tds_amount': '500'};
      expect(tdsCertificateTitle(c), 'TDS/2026-2027/Q3/ABCD1234');
      expect(tdsCertificateSubtitle(c), 'Asha Traders · 09 Nov 2026 · 2026-2027 Q3');
      expect(tdsCertificateStatus(c), 'Issued');
      expect(tdsCertificateStatus({'is_issued': false}), 'Draft');
      expect(tdsCertificatePdfPath('c1'), '/api/tds/certificates/c1/pdf');
    });

    test('a category needs a section, a name and a rate, and posts the website body', () {
      expect(tdsCategoryProblem(code: '', name: 'n', rateText: '1'), 'Section code, section name, and rate are required');
      expect(tdsCategoryProblem(code: 'c', name: ' ', rateText: '1'), 'Section code, section name, and rate are required');
      expect(tdsCategoryProblem(code: 'c', name: 'n', rateText: ''), 'Section code, section name, and rate are required');
      expect(tdsCategoryProblem(code: 'c', name: 'n', rateText: 'x'), 'Enter the rate as a number');
      expect(tdsCategoryProblem(code: 'c', name: 'n', rateText: '1', thresholdText: '-5'), 'Threshold cannot be negative');
      expect(tdsCategoryProblem(code: '194C', name: 'Contractors', rateText: '1'), isNull);
      final b = tdsCategoryBody(code: ' 194C ', name: ' Contractors ', description: '', rateText: '1.5', thresholdText: '30,000');
      expect(b, {'section_code': '194C', 'section_name': 'Contractors', 'description': null, 'rate': 1.5, 'threshold_amount': 30000});
      expectNoIdentity(b);
      expect(tdsCategoryBody(code: 'a', name: 'b', description: 'Notes', rateText: '2', thresholdText: '')['threshold_amount'], 0);
    });

    test('a category row reads the section, the name, the rate and the threshold', () {
      final c = {'section_code': '194C', 'section_name': 'Contractors', 'rate': '1.00', 'threshold_amount': '30000.00'};
      expect(tdsCategoryTitle(c), '194C · Contractors');
      expect(tdsCategorySubtitle(c), 'Rate 1% · Threshold ₹30,000.00');
      expect(tdsCategorySubtitle({'section_code': 'x', 'rate': '10', 'threshold_amount': '0'}), 'Rate 10%');
    });
  });

  group('TDS screen', () {
    var failCode = '';
    var listFails = 0;
    String? postRefuse;
    String? deleteRefuse;
    var summaryEmpty = false;
    var pdfFails = false;

    setUp(() {
      failCode = '';
      listFails = 0;
      postRefuse = null;
      deleteRefuse = null;
      summaryEmpty = false;
      pdfFails = false;
    });

    Reply server(RequestOptions o, Map body) {
      final path = o.uri.path;
      if (o.method == 'GET' && path.startsWith('/api/tds/') && listFails > 0 && path != '/api/tds/reports/summary') {
        listFails--;
        return (failCode.isEmpty ? 500 : 403, {'error': 'Server is down', if (failCode.isNotEmpty) 'code': failCode});
      }
      if (o.method == 'GET' && path == '/api/tds/reports/summary') {
        if (failCode.isNotEmpty) return (403, {'error': 'Not in plan', 'code': failCode});
        return (200, {
          'summary': summaryEmpty ? [] : {'transaction_count': '4', 'total_tds_amount': '5000.00', 'deposited_amount': '3000.00', 'pending_amount': '2000.00'},
          'section_breakdown': [],
        });
      }
      if (o.method == 'GET' && path == '/api/tds/transactions') {
        if (failCode.isNotEmpty) return (403, {'error': 'Not in plan', 'code': failCode});
        return (200, {
          'transactions': [
            {'id': 't1', 'supplier_name': 'Asha Traders', 'section_name': '194C', 'transaction_date': '2026-11-03', 'amount': '50000', 'tds_amount': '500.00', 'financial_year': '2026-2027', 'quarter': 'Q3', 'is_deposited': false},
          ],
        });
      }
      if (o.method == 'GET' && path == '/api/tds/payments') {
        return (200, {
          'payments': [
            {'id': 'p1', 'challan_number': 'CH100', 'challan_date': '2026-10-07', 'deposit_date': '2026-10-08', 'total_tds_amount': '1500.00', 'financial_year': '2026-2027', 'quarter': 'Q2', 'bank_name': 'HDFC', 'status': 'deposited'},
          ],
        });
      }
      if (o.method == 'POST' && path == '/api/tds/payments') {
        if (postRefuse != null) return (409, {'error': postRefuse});
        return (201, {'payment': {'id': 'p2'}, 'message': 'TDS payment recorded successfully'});
      }
      if (o.method == 'GET' && path == '/api/tds/certificates') {
        return (200, {
          'certificates': [
            {'id': 'c1', 'certificate_number': 'TDS/2026-2027/Q2/ABCD1234', 'supplier_name': 'Asha Traders', 'issue_date': '2026-10-20', 'financial_year': '2026-2027', 'quarter': 'Q2', 'is_issued': true, 'total_tds_amount': '800.00'},
          ],
        });
      }
      if (o.method == 'GET' && path == '/api/suppliers') {
        return (200, {
          'suppliers': [
            {'id': 's1', 'name': 'Asha Traders', 'phone': '9000000001'},
          ],
        });
      }
      if (o.method == 'POST' && path == '/api/tds/certificates') {
        if (postRefuse != null) return (400, {'error': postRefuse});
        return (201, {'certificate': {'id': 'c2'}, 'message': 'TDS certificate generated successfully'});
      }
      if (o.method == 'GET' && path == '/api/tds/certificates/c1/pdf') {
        if (pdfFails) return (500, {'error': 'column tc.party_id does not exist'});
        return (200, 'PDF');
      }
      if (o.method == 'GET' && path == '/api/tds/categories') {
        return (200, {
          'categories': [
            {'id': 'k1', 'section_code': '194C', 'section_name': 'Contractors', 'rate': '1.00', 'threshold_amount': '30000.00', 'description': 'Contract payments'},
          ],
        });
      }
      if (o.method == 'POST' && path == '/api/tds/categories') {
        if (postRefuse != null) return (409, {'error': postRefuse});
        return (201, {'category': {'id': 'k2'}});
      }
      if (o.method == 'PUT' && path == '/api/tds/categories/k1') return (200, {'category': {'id': 'k1'}});
      if (o.method == 'DELETE' && path == '/api/tds/categories/k1') {
        if (deleteRefuse != null) return (400, {'error': deleteRefuse});
        return (200, {'message': 'TDS category deleted successfully'});
      }
      return (404, {'error': 'not found ${o.method} $path'});
    }

    Future<(List<RequestOptions>, List<(String, int)>)> open(WidgetTester t, {TdsTab tab = TdsTab.transactions}) async {
      final opened = <(String, int)>[];
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/tds/certificates/c1/pdf') {
          final r = server(o, b);
          return (r.$1, r.$1 == 200 ? [37, 80, 68, 70] : utf8.encode(jsonEncode(r.$2)));
        }
        return server(o, b);
      });
      await pumpScreen(
        t,
        TdsScreen(
          session: session,
          initialTab: tab,
          openPdf: (ctx, bytes, title) async => opened.add((title, bytes.length)),
        ),
      );
      return (sent, opened);
    }

    testWidgets('Transactions loads with the server summary tiles and rows, for the year and quarter shown; nothing identifies the business', (t) async {
      final (sent, _) = await open(t);
      final list = requestsOf(sent, 'GET', '/api/tds/transactions').single;
      expect(list.uri.queryParameters['financial_year'], matches(RegExp(r'^\d{4}-\d{4}$')));
      expect(list.uri.queryParameters['quarter'], matches(RegExp(r'^Q[1-4]$')));
      expect(list.uri.queryParameters.containsKey('business_id'), isFalse);
      final sum = requestsOf(sent, 'GET', '/api/tds/reports/summary').single;
      expect(sum.uri.queryParameters['financial_year'], list.uri.queryParameters['financial_year']);
      expect(sum.uri.queryParameters['quarter'], list.uri.queryParameters['quarter']);
      expect(find.text('₹5,000.00'), findsOneWidget);
      expect(find.text('₹3,000.00'), findsOneWidget);
      expect(find.text('₹2,000.00'), findsOneWidget);
      expect(find.text('Asha Traders'), findsOneWidget);
      expect(find.text('₹500.00'), findsOneWidget);
      expect(find.text('Pending'), findsWidgets);
    });

    testWidgets('all four tabs are there, and choosing All quarters hides the tiles (the summary is one quarter at a time)', (t) async {
      final (sent, _) = await open(t);
      for (final tab in ['Transactions', 'Payments', 'Certificates', 'Categories']) {
        expect(find.text(tab), findsWidgets);
      }
      await t.tap(find.text('All quarters'));
      await t.pumpAndSettle();
      expect(find.text('₹5,000.00'), findsNothing);
      expect(find.text('Choose a quarter to see the TDS summary'), findsOneWidget);
      expect(requestsOf(sent, 'GET', '/api/tds/transactions').last.uri.queryParameters.containsKey('quarter'), isFalse);
    });

    testWidgets('empty summary draws no tiles, and a server error shows Try again', (t) async {
      summaryEmpty = true;
      await open(t);
      expect(find.text('Total TDS'), findsNothing);
      expect(find.text('Asha Traders'), findsOneWidget);

      summaryEmpty = false;
      listFails = 1;
      await open(t);
      expect(find.text('Could not load TDS transactions'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Asha Traders'), findsOneWidget);
    });

    testWidgets('a plan without TDS shows the plan message', (t) async {
      failCode = 'FEATURE_NOT_IN_PLAN';
      await open(t);
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('Payments lists the server rows; recording one asks first with the amount, then posts once and reloads', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, TdsScreen(session: session, initialTab: TdsTab.payments));
      expect(find.text('CH100'), findsOneWidget);
      expect(find.text('₹1,500.00'), findsOneWidget);
      await t.tap(find.text('Record payment'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Challan number'), 'CH200');
      await t.enterText(textFieldLabelled('Total TDS amount', within: KAmountField), '2000');
      await t.enterText(textFieldLabelled('Bank name'), 'HDFC');
      await t.pumpAndSettle();
      await t.tap(find.text('Record payment').last);
      await settle(t);
      expect(requestCount(sent, 'POST', '/api/tds/payments'), 0, reason: 'asks first');
      expect(find.textContaining('₹2,000.00 against challan CH200'), findsOneWidget);
      expect(find.textContaining('The server shows ₹2,000.00 pending'), findsOneWidget, reason: 'the server pending figure for that quarter');
      final go = inSheet('Record payment');
      await t.tap(go);
      await t.tap(go, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/tds/payments'), 1);
      final body = lastBody(sent, 'POST', '/api/tds/payments');
      expect(body['challan_number'], 'CH200');
      expect(body['total_tds_amount'], 2000);
      expect(body['bank_name'], 'HDFC');
      expect(body['financial_year'], matches(RegExp(r'^\d{4}-\d{4}$')));
      expect(body['quarter'], matches(RegExp(r'^Q[1-4]$')));
      expectNoIdentity(body);
      expect(find.text('TDS payment recorded successfully'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/tds/payments'), 2, reason: 'reloaded');
    });

    testWidgets('a refused payment shows the server message and keeps the form filled', (t) async {
      postRefuse = 'Challan number already exists';
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, TdsScreen(session: session, initialTab: TdsTab.payments));
      await t.tap(find.text('Record payment'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Challan number'), 'CH100');
      await t.enterText(textFieldLabelled('Total TDS amount', within: KAmountField), '10');
      await t.tap(find.text('Record payment').last);
      await settle(t);
      await t.tap(inSheet('Record payment'));
      await t.pumpAndSettle();
      expect(find.text('Challan number already exists'), findsOneWidget);
      expect(find.text('CH100'), findsWidgets);
      expect(requestCount(sent, 'POST', '/api/tds/payments'), 1);
    });

    testWidgets('Certificates: generating posts the website body once; a refusal shows the server message', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, TdsScreen(session: session, initialTab: TdsTab.certificates));
      expect(find.text('TDS/2026-2027/Q2/ABCD1234'), findsOneWidget);
      expect(find.text('Asha Traders · 20 Oct 2026 · 2026-2027 Q2'), findsOneWidget);
      expect(find.text('Issued'), findsOneWidget);
      await t.tap(find.text('Generate certificate'));
      await t.pumpAndSettle();
      await t.tap(find.byWidgetPredicate((w) => w is KAsyncPickField && w.label == 'Supplier'));
      await t.pumpAndSettle();
      await t.tap(find.text('Asha Traders').last);
      await t.pumpAndSettle();
      final save = find.text('Generate certificate').last;
      await t.tap(save);
      await t.tap(save, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/tds/certificates'), 1);
      final body = lastBody(sent, 'POST', '/api/tds/certificates');
      expect(body['supplier_id'], 's1');
      expect(body['financial_year'], matches(RegExp(r'^\d{4}-\d{4}$')));
      expect(body['quarter'], matches(RegExp(r'^Q[1-4]$')));
      expect(body['issue_date'], ymd(DateTime.now()));
      expectNoIdentity(body);
      expect(find.text('TDS certificate generated successfully'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/tds/certificates'), 2, reason: 'reloaded');

      postRefuse = 'No TDS transactions found for this supplier in the specified period';
      await t.tap(find.text('Generate certificate'));
      await t.pumpAndSettle();
      await t.tap(find.byWidgetPredicate((w) => w is KAsyncPickField && w.label == 'Supplier'));
      await t.pumpAndSettle();
      await t.tap(find.text('Asha Traders').last);
      await t.pumpAndSettle();
      await t.tap(find.text('Generate certificate').last);
      await t.pumpAndSettle();
      expect(find.text(postRefuse!), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/tds/certificates'), 2);
    });

    testWidgets('a certificate opens its PDF in the viewer; a server failure shows its message', (t) async {
      final (sent, opened) = await open(t, tab: TdsTab.certificates);
      await t.tap(find.text('TDS/2026-2027/Q2/ABCD1234'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'GET', '/api/tds/certificates/c1/pdf'), 1);
      expect(opened, [('TDS/2026-2027/Q2/ABCD1234', 4)]);

      pdfFails = true;
      await t.tap(find.text('TDS/2026-2027/Q2/ABCD1234'));
      await t.pumpAndSettle();
      expect(find.text('column tc.party_id does not exist'), findsOneWidget);
      expect(opened.length, 1);
    });

    testWidgets('Categories: add, edit and delete use the website bodies', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, TdsScreen(session: session, initialTab: TdsTab.categories));
      expect(find.text('194C · Contractors'), findsOneWidget);
      expect(find.text('Rate 1% · Threshold ₹30,000.00'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/tds/reports/summary'), 0, reason: 'categories have no summary');

      await t.tap(find.text('Add category'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Section code'), '194J');
      await t.enterText(textFieldLabelled('Section name'), 'Professional fees');
      await t.enterText(textFieldLabelled('Rate (%)', within: KAmountField), '10');
      final save = find.text('Add category').last;
      await t.tap(save);
      await t.tap(save, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/tds/categories'), 1);
      final add = lastBody(sent, 'POST', '/api/tds/categories');
      expect(add, {'section_code': '194J', 'section_name': 'Professional fees', 'description': null, 'rate': 10, 'threshold_amount': 0});
      expect(find.text('Category added successfully'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/tds/categories'), 2, reason: 'reloaded');

      await t.tap(find.text('194C · Contractors'));
      await t.pumpAndSettle();
      await t.tap(find.text('Edit category'));
      await t.pumpAndSettle();
      expect(find.text('Contract payments'), findsOneWidget, reason: 'the form starts from the server values');
      await t.enterText(textFieldLabelled('Rate (%)', within: KAmountField), '2');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'PUT', '/api/tds/categories/k1'), 1);
      expect(lastBody(sent, 'PUT', '/api/tds/categories/k1')['rate'], 2);
      expect(find.text('Category updated successfully'), findsOneWidget);
    });

    testWidgets('Deleting a category asks first; the server refusal when it is in use is shown as sent', (t) async {
      deleteRefuse = 'Cannot delete category that is used in TDS transactions';
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, TdsScreen(session: session, initialTab: TdsTab.categories));
      await t.tap(find.text('194C · Contractors'));
      await t.pumpAndSettle();
      await t.tap(find.text('Delete category'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'DELETE', '/api/tds/categories/k1'), 0, reason: 'asks first');
      final go = inSheet('Delete category');
      await t.tap(go);
      await t.tap(go, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'DELETE', '/api/tds/categories/k1'), 1);
      expect(find.text(deleteRefuse!), findsOneWidget);
      expect(find.text('194C · Contractors'), findsOneWidget, reason: 'still listed');

      deleteRefuse = null;
      await t.tap(find.text('194C · Contractors'));
      await t.pumpAndSettle();
      await t.tap(find.text('Delete category'));
      await t.pumpAndSettle();
      await t.tap(inSheet('Delete category'));
      await t.pumpAndSettle();
      expect(find.text('Category deleted successfully'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/tds/categories'), 2, reason: 'reloaded');
    });

    testWidgets('the route table opens the TDS screen, each sub-page on its own tab', (t) async {
      final (session, _) = recordedSession(server);
      for (final (href, tab) in [
        ('/tds', TdsTab.transactions),
        ('/tds/transactions', TdsTab.transactions),
        ('/tds/payments', TdsTab.payments),
        ('/tds/certificates', TdsTab.certificates),
        ('/tds/categories', TdsTab.categories),
      ]) {
        final w = nativeScreenFor(session, href);
        expect(w, isA<TdsScreen>(), reason: href);
        expect((w! as TdsScreen).initialTab, tab, reason: href);
      }
      expect(stillGeneric.contains('/tds'), isFalse);
    });
  });
}
