import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/tools/calculator_logic.dart';
import 'package:khatario_phone/screens/tools/calculators_screen.dart';
import 'package:khatario_phone/screens/tools/lookup_tools_screens.dart';
import 'package:khatario_phone/screens/tools/tools_hub_screen.dart';
import 'package:khatario_phone/session.dart';

import 'support/fake_session.dart';

void main() {
  group('EMI', () {
    test('100000 at 12% for 12 months is 8884.88', () {
      expect(round2(emi(100000, 12, 12)), 8884.88);
    });

    test('totals are the instalment times the months', () {
      final s = emiSummary(100000, 12, 12);
      expect(round2(s.totalAmount), 106618.55);
      expect(round2(s.totalInterest), 6618.55);
    });

    test('first month splits into 1000 interest and the rest principal', () {
      final rows = emiBreakdown(100000, 12, 12);
      expect(rows, hasLength(12));
      expect(round2(rows.first.interest), 1000);
      expect(round2(rows.first.principal), 7884.88);
      expect(round2(rows.first.balance), 92115.12);
      expect(round2(rows.last.balance), 0);
    });

    test('the breakdown stops at 12 months for a long loan', () {
      expect(emiBreakdown(500000, 10, 60), hasLength(12));
      expect(emiBreakdown(500000, 10, 6), hasLength(6));
    });

    test('a zero rate divides the loan evenly', () {
      expect(emi(12000, 0, 12), 1000);
    });
  });

  group('Discount', () {
    test('percentage', () {
      final r = discountResult(2000, 10, percent: true);
      expect(r.discountAmount, 200);
      expect(r.finalPrice, 1800);
    });

    test('fixed amount reports the percentage off', () {
      final r = discountResult(2000, 250, percent: false);
      expect(r.discountAmount, 250);
      expect(r.finalPrice, 1750);
      expect(r.savingsPercent, 12.5);
    });
  });

  group('Interest', () {
    test('simple: P x R x T / 100', () {
      final r = interestResult(10000, 8, 3, compound: false);
      expect(r.interest, 2400);
      expect(r.total, 12400);
    });

    test('compound: yearly compounding', () {
      final r = interestResult(10000, 10, 2, compound: true);
      expect(round2(r.total), 12100);
      expect(round2(r.interest), 2100);
    });
  });

  group('Price and margin', () {
    test('margin is on the selling price, markup on the cost', () {
      final r = priceMargin(MarginMode.margin, cost: 80, selling: 100)!;
      expect(r.profit, 20);
      expect(r.margin, 20);
      expect(r.markup, 25);
    });

    test('cost to price from a margin', () {
      final r = priceMargin(MarginMode.costToPrice, cost: 100, marginPct: 20)!;
      expect(round2(r.selling), 125);
      expect(round2(r.profit), 25);
      expect(round2(r.markup), 25);
    });

    test('cost to price from a markup', () {
      final r = priceMargin(MarginMode.costToPrice, cost: 100, markupPct: 50)!;
      expect(round2(r.selling), 150);
      expect(round2(r.margin), 33.33);
    });

    test('price to cost from a margin and from a markup', () {
      final a = priceMargin(MarginMode.priceToCost, selling: 150, marginPct: 20)!;
      expect(round2(a.cost), 120);
      final b = priceMargin(MarginMode.priceToCost, selling: 150, markupPct: 50)!;
      expect(round2(b.cost), 100);
      expect(round2(b.margin), 33.33);
    });

    test('nothing to show without the inputs, or at a 100 percent margin', () {
      expect(priceMargin(MarginMode.costToPrice, cost: 100), isNull);
      expect(priceMargin(MarginMode.costToPrice, cost: 100, marginPct: 100), isNull);
      expect(priceMargin(MarginMode.margin, cost: 100), isNull);
    });
  });

  group('TDS', () {
    test('sections are the website list, custom last', () {
      expect(tdsSections, hasLength(11));
      expect(tdsSections.first.label, '194A - Interest (Bank FD)');
      expect(tdsSections.first.rate, 10);
      expect(tdsSections.last.isCustom, isTrue);
    });

    test('2 percent on a contractor payment', () {
      final r = tdsResult(50000, 2);
      expect(r.tds, 1000);
      expect(r.net, 49000);
    });

    test('0.1 percent on a purchase of goods', () {
      expect(round2(tdsResult(1000000, 0.1).tds), 1000);
    });
  });

  group('Currency', () {
    test('rupees per unit, both ways', () {
      expect(exchangeRate('USD', 'INR'), 83);
      expect(exchangeRate('INR', 'USD'), closeTo(1 / 83, 1e-12));
      expect(exchangeRate('EUR', 'USD'), closeTo(90 / 83, 1e-12));
      expect(exchangeRate('INR', 'INR'), 1);
    });

    test('convert', () {
      expect(convertCurrency(100, 83), 8300);
    });
  });

  group('Invoice numbers', () {
    test('prefix, year, month, padded number, suffix', () {
      final list = invoiceNumbers(
        prefix: 'INV',
        suffix: '',
        start: 1,
        padding: 5,
        count: 3,
        year: '2025',
        month: '01',
        includeYear: true,
        includeMonth: true,
      );
      expect(list, ['INV20250100001', 'INV20250100002', 'INV20250100003']);
    });

    test('simple sequence with a suffix', () {
      final list = invoiceNumbers(prefix: 'BILL', suffix: '/A', start: 9, padding: 3, count: 2, year: '2025', month: '01', includeYear: false, includeMonth: false);
      expect(list, ['BILL009/A', 'BILL010/A']);
    });

    test('padding is limited to 1 to 10 and the count to 100', () {
      expect(invoiceNumbers(prefix: '', suffix: '', start: 1, padding: 99, count: 1, year: '', month: '', includeYear: false, includeMonth: false).single, '0000000001');
      expect(invoiceNumbers(prefix: 'A', suffix: '', start: 1, padding: 1, count: 500, year: '', month: '', includeYear: false, includeMonth: false), hasLength(100));
    });
  });

  group('GST', () {
    test('exclusive adds the GST', () {
      final r = gstSplit(100, 18, inclusive: false);
      expect(r.base, 100);
      expect(r.gst, 18);
      expect(r.total, 118);
      expect(r.cgst, 9);
      expect(r.sgst, 9);
      expect(r.igst, 18);
    });

    test('inclusive 118 at 18 percent splits into 100 and 18', () {
      final r = gstSplit(118, 18, inclusive: true);
      expect(round2(r.base), 100);
      expect(round2(r.gst), 18);
      expect(r.total, 118);
    });
  });

  group('GSTIN', () {
    test('a real checksum passes and names the state and PAN', () {
      final r = checkGstin('27AAPFU0939F1ZV');
      expect(r.valid, isTrue);
      expect(r.details, contains(('State', 'Maharashtra')));
      expect(r.details, contains(('PAN', 'AAPFU0939F')));
    });

    test('a wrong last character fails on the checksum', () {
      final r = checkGstin('27AAPFU0939F1ZW');
      expect(r.valid, isFalse);
      expect(r.message, contains('checksum'));
    });

    test('wrong length, wrong shape and an unknown state each say why', () {
      expect(checkGstin('27AAPFU0939F1Z').message, contains('15'));
      expect(checkGstin('27AAPFU0939F1AV').message, contains('format'));
      expect(checkGstin('00AAPFU0939F1ZV').message, contains('state code'));
      expect(checkGstin('').message, contains('Enter'));
    });
  });

  group('PAN', () {
    test('the fourth letter gives the holder type', () {
      final person = checkPan('ABCPE1234F');
      expect(person.valid, isTrue);
      expect(person.details, contains(('Type', 'Individual')));
      expect(person.details, contains(('Entity type', 'Individual')));
      expect(checkPan('abcpe1234f').valid, isTrue);
      final company = checkPan('AAACR5055K');
      expect(company.valid, isTrue);
      expect(company.details, contains(('Type', 'Company')));
      expect(checkPan('AAAHR5055K').details, contains(('Type', 'HUF (Hindu Undivided Family)')));
      expect(checkPan('AAATR5055K').details, contains(('Type', 'Trust')));
    });

    test('a fourth letter that is not a holder type is invalid', () {
      final r = checkPan('ABCXE1234F');
      expect(r.valid, isFalse);
      expect(r.title, 'Invalid PAN');
      expect(r.message, contains('4th'));
    });

    test('wrong shapes are rejected with the format hint', () {
      final r = checkPan('ABCDE12345');
      expect(r.valid, isFalse);
      expect(r.message, contains('ABCDE1234F'));
      expect(checkPan('').valid, isFalse);
    });
  });

  group('Parsing', () {
    test('HSN rows keep code, description, rate and condition', () {
      final hits = parseHsnResults({
        'results': [
          {'code': '6109', 'description': 'T-shirts', 'gst_rate': 5, 'rate_condition': 'Up to 1000', 'is_service': false},
          {'code': '9983', 'description': 'Professional services', 'gst_rate': null, 'is_service': true},
        ],
      });
      expect(hits, hasLength(2));
      expect(hits.first.rateLabel, '5%');
      expect(hits.last.rateLabel, isNull);
    });

    test('lead rows tolerate missing fields', () {
      final leads = parseLeads({
        'leads': [
          {'business_name': 'Shree Interiors', 'phone': '98450 00000', 'address': 'MG Road', 'rating': 4.5, 'reviews': 120},
          {'business_name': 'No details'},
        ],
      });
      expect(leads, hasLength(2));
      expect(leads.first.rating, 4.5);
      expect(leads.last.phone, '');
    });
  });

  group('Rate text', () {
    test('small rates keep their digits and whole ones lose the zeros', () {
      expect(formatRate(1 / 83), '0.012048');
      expect(formatRate(83), '83');
      expect(formatRate(0.56), '0.56');
      expect(formatRate(90 / 83), '1.084337');
    });
  });

  group('Money text', () {
    test('two decimals with Indian grouping', () {
      expect(formatMoney(8884.878), '₹8,884.88');
      expect(formatMoney(1234567.5), '₹12,34,567.50');
      expect(formatMoney(0), '₹0.00');
      expect(formatMoney(-12.3), '-₹12.30');
    });
  });

  group('Screens', () {
    Future<void> show(WidgetTester tester, Widget child) async {
      tester.view.physicalSize = const Size(900, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(home: child));
      await tester.pump();
    }

    testWidgets('EMI result follows the fields as they are typed', (tester) async {
      await show(tester, const EmiCalculatorScreen());
      expect(find.text('Loan amount'), findsOneWidget);
      expect(find.text('Annual interest rate (%)'), findsOneWidget);
      expect(find.text('Monthly EMI'), findsNothing);

      await tester.enterText(find.byType(TextField).at(0), '100000');
      await tester.enterText(find.byType(TextField).at(1), '12');
      await tester.pump();

      expect(find.text('Monthly EMI'), findsOneWidget);
      expect(find.text('₹8,884.88'), findsWidgets);

      await tester.enterText(find.byType(TextField).at(2), '24');
      await tester.pump();
      expect(find.text('₹8,884.88'), findsNothing);
    });

    testWidgets('GST screen splits an inclusive amount', (tester) async {
      await show(tester, const GstCalculatorScreen());
      await tester.tap(find.text('GST inclusive'));
      await tester.pump();
      await tester.enterText(find.byType(TextField).at(0), '118');
      await tester.pump();
      expect(find.text('₹100.00'), findsWidgets);
      expect(find.text('₹18.00'), findsWidgets);
    });

    testWidgets('GSTIN validator says valid and invalid with the reason', (tester) async {
      await show(tester, const GstinValidatorScreen());
      await tester.enterText(find.byType(TextField).first, '27AAPFU0939F1ZV');
      await tester.pump();
      expect(find.text('Valid GSTIN'), findsOneWidget);
      expect(find.text('Maharashtra'), findsOneWidget);

      await tester.enterText(find.byType(TextField).first, '27aapfu0939f1zw');
      await tester.pump();
      expect(find.text('Invalid GSTIN'), findsOneWidget);
      expect(find.textContaining('checksum'), findsOneWidget);
    });

    testWidgets('PAN validator', (tester) async {
      await show(tester, const PanValidatorScreen());
      await tester.enterText(find.byType(TextField).first, 'ABCPE1234F');
      await tester.pump();
      expect(find.text('Valid PAN'), findsOneWidget);
      await tester.enterText(find.byType(TextField).first, 'ABCPE12345');
      await tester.pump();
      expect(find.text('Invalid PAN'), findsOneWidget);
    });

    testWidgets('discount calculator shows the final price', (tester) async {
      await show(tester, const DiscountCalculatorScreen());
      await tester.enterText(find.byType(TextField).at(0), '2000');
      await tester.enterText(find.byType(TextField).at(1), '10');
      await tester.pump();
      expect(find.text('₹1,800.00'), findsWidgets);
      expect(find.text('Final price'), findsOneWidget);
    });

    testWidgets('a discount larger than the price is an error, not a negative price', (tester) async {
      await show(tester, const DiscountCalculatorScreen());
      await tester.enterText(find.byType(TextField).at(0), '100');
      await tester.enterText(find.byType(TextField).at(1), '150');
      await tester.pump();
      expect(find.text('Discount cannot be more than the price'), findsOneWidget);
      expect(find.text('Final price'), findsNothing);
      await tester.tap(find.text('Fixed amount (₹)'));
      await tester.pump();
      expect(find.text('Discount cannot be more than the price'), findsOneWidget);
      await tester.enterText(find.byType(TextField).at(1), '100');
      await tester.pump();
      expect(find.text('Discount cannot be more than the price'), findsNothing);
      expect(find.text('Final price'), findsOneWidget);
    });

    testWidgets('clearing the HSN search drops a reply still on its way', (tester) async {
      final gate = Completer<void>();
      final dio = Dio(BaseOptions(baseUrl: 'https://x.test'));
      dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
        await gate.future;
        h.resolve(Response(requestOptions: o, statusCode: 200, data: {
          'results': [
            {'code': '6109', 'description': 'Late answer', 'gst_rate': 5, 'is_service': false},
          ],
        }));
      }));
      final session = AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b'}});
      await show(tester, HsnFinderScreen(session: session));
      await tester.enterText(find.byType(TextField).first, 'shirt');
      await tester.pump();
      await tester.tap(find.text('Search'));
      await tester.pump();
      await tester.enterText(find.byType(TextField).first, '');
      await tester.pump();
      gate.complete();
      await tester.pumpAndSettle();
      expect(find.text('Late answer'), findsNothing);
    });

    testWidgets('HSN finder calls the lookup route and lists the codes', (tester) async {
      final (session, sent) = fakeSession((o) => {
            'results': [
              {'code': '6109', 'description': 'T-shirts, singlets and other vests', 'gst_rate': 5, 'is_service': false, 'rate_condition': null},
            ],
          });
      await show(tester, HsnFinderScreen(session: session));
      await tester.enterText(find.byType(TextField).first, 'shirt');
      await tester.pump();
      await tester.tap(find.text('Search'));
      await tester.pumpAndSettle();

      expect(sent.single.method, 'GET');
      final uri = sent.single.uri;
      expect(uri.path, '/api/hsn/lookup');
      expect(uri.queryParameters['q'], 'shirt');
      expect(find.text('T-shirts, singlets and other vests'), findsOneWidget);
      expect(find.text('5%'), findsOneWidget);
    });

    testWidgets('lead extractor posts the keyword and place and never a business id', (tester) async {
      final (session, sent) = fakeSession((o) => {
            'leads': [
              {'business_name': 'Shree Interiors', 'phone': '98450 00000', 'address': 'MG Road', 'rating': 4.5, 'reviews': 12},
            ],
          });
      await show(tester, LeadExtractorScreen(session: session));
      await tester.enterText(find.byType(TextField).at(0), 'Interior designers');
      await tester.enterText(find.byType(TextField).at(1), 'Bangalore');
      await tester.tap(find.text('Find leads'));
      await tester.pumpAndSettle();

      expect(sent.single.method, 'POST');
      expect(sent.single.path, '/api/tools/google-leads/search');
      final body = Map<String, dynamic>.from(sent.single.data as Map);
      expect(body['keyword'], 'Interior designers');
      expect(body['location'], 'Bangalore');
      expect(body['radius'], 5000);
      expect(body['useFreeAPI'], true);
      expect(body.keys, isNot(contains('business_id')));
      expect(find.text('Shree Interiors'), findsOneWidget);
    });

    testWidgets('the hub opens a tool', (tester) async {
      final (session, _) = fakeSession((o) => {});
      await show(tester, ToolsHubScreen(session: session));
      expect(find.text('EMI Calculator'), findsOneWidget);
      await tester.tap(find.text('EMI Calculator'));
      await tester.pumpAndSettle();
      expect(find.byType(EmiCalculatorScreen), findsOneWidget);
    });

    testWidgets('invoice number generator lists the numbers', (tester) async {
      await show(tester, const InvoiceNumberScreen());
      await tester.tap(find.text('Generate'));
      await tester.pump();
      expect(find.text('Generated 10 numbers'), findsOneWidget);
      expect(find.text('INV${DateTime.now().year}00010'), findsOneWidget);
    });

    testWidgets('every tool fits a 360 wide phone without overflow', (tester) async {
      final (session, _) = fakeSession((o) => {});
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      for (final screen in <Widget>[
        ToolsHubScreen(session: session),
        const EmiCalculatorScreen(),
        const DiscountCalculatorScreen(),
        const InterestCalculatorScreen(),
        const PriceMarginCalculatorScreen(),
        const TdsCalculatorScreen(),
        const CurrencyConverterScreen(),
        const InvoiceNumberScreen(),
        const GstCalculatorScreen(),
        const GstinValidatorScreen(),
        const PanValidatorScreen(),
        HsnFinderScreen(session: session),
        LeadExtractorScreen(session: session),
      ]) {
        await tester.pumpWidget(MaterialApp(home: screen));
        await tester.pump();
        expect(tester.takeException(), isNull, reason: screen.runtimeType.toString());
      }
    });

    testWidgets('results also fit a 360 wide phone', (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(const MaterialApp(home: EmiCalculatorScreen()));
      await tester.enterText(find.byType(TextField).at(0), '100000000');
      await tester.enterText(find.byType(TextField).at(1), '12');
      await tester.pump();
      expect(find.text('Monthly EMI'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const MaterialApp(home: PriceMarginCalculatorScreen()));
      await tester.enterText(find.byType(TextField).at(0), '80');
      await tester.enterText(find.byType(TextField).at(1), '20');
      await tester.pump();
      expect(tester.takeException(), isNull);
    });

    test('every tool route has a native screen, and /tools is the hub', () {
      final (session, _) = fakeSession((o) => {});
      for (final href in [
        '/tools/emi-calculator',
        '/tools/discount-calculator',
        '/tools/interest-calculator',
        '/tools/price-margin-calculator',
        '/tools/tds-calculator',
        '/tools/currency-converter',
        '/tools/invoice-number-generator',
        '/tools/gst-calculator',
        '/tools/gstin-validator',
        '/tools/pan-validator',
        '/tools/hsn-finder',
        '/tools/google-lead-extractor',
      ]) {
        expect(nativeScreenFor(session, href), isNotNull, reason: href);
      }
      expect(nativeScreenFor(session, '/tools'), isA<ToolsHubScreen>());
      expect(nativeScreenFor(session, '/tools/todo'), isNull);
      expect(nativeScreenFor(session, '/tools/image-size-reducer'), isNull);
    });
  });
}
