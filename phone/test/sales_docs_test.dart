import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/invoices/invoice_detail_screen.dart';
import 'package:khatario_phone/screens/sales/estimates_screen.dart';
import 'package:khatario_phone/screens/sales/quotation_convert.dart';
import 'package:khatario_phone/screens/sales/sales_logic.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/kit.dart';

Map<String, dynamic> _row(String id, String number, String status, {String? converted}) => {
      'id': id,
      'customer_name': 'Asha',
      'estimate_number': number,
      'estimate_date': '2026-11-01',
      'expiry_date': null,
      'status': status,
      'grand_total': '1180.50',
      'converted_invoice_id': converted,
    };

Map<String, dynamic> _invoice(String id, String number, {String type = 'proforma_invoice', String estimate = 'sent', String? converted}) => {
      'invoice': {
        'id': id,
        'invoice_number': number,
        'document_type': type,
        'status': 'final',
        'estimate_status': estimate,
        'converted_invoice_id': converted,
        'customer_id': 'c1',
        'customer_name': 'Asha',
        'invoice_date': '2026-11-01',
        'grand_total': 1180.5,
        'balance_amount': 1180.5,
        'paid_amount': 0,
        'items': [
          {'item_name': 'Widget', 'quantity': 1, 'unit_price': 1180.5, 'line_total': 1180.5, 'tax_amount': 0},
        ],
      },
    };

/// Replies by route; [convert] decides the convert reply (status, body), possibly after a delay.
(AppSession, List<RequestOptions>) _server({
  required List<Map<String, dynamic>> rows,
  Future<(int, Object?)> Function()? convert,
}) {
  final sent = <RequestOptions>[];
  final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
  dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
    sent.add(o);
    (int, Object?) r;
    final path = o.uri.path;
    if (path == '/api/estimates') {
      r = (200, {'estimates': rows, 'pagination': {'page': 1, 'limit': 50, 'total': rows.length, 'totalPages': 1}});
    } else if (path.endsWith('/convert-to-tax-invoice')) {
      r = await (convert ?? () async => (200, {'success': true, 'invoice_id': 'i9', 'invoice_number': 'INV-9'}))();
    } else if (path == '/api/invoices/i9') {
      r = (200, _invoice('i9', 'INV-9', type: 'tax_invoice'));
    } else if (path == '/api/invoices/q1') {
      r = (200, _invoice('q1', 'PI-1'));
    } else if (path == '/api/invoices/q2') {
      r = (200, _invoice('q2', 'PI-2', estimate: 'converted', converted: 'i5'));
    } else if (path == '/api/invoices/i5') {
      r = (200, _invoice('i5', 'INV-5', type: 'tax_invoice'));
    } else {
      r = (200, <String, dynamic>{});
    }
    h.resolve(Response(requestOptions: o, statusCode: r.$1, data: r.$2));
  }));
  return (AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b'}}), sent);
}

Future<void> _pump(WidgetTester t, AppSession s) async {
  await t.pumpWidget(MaterialApp(home: EstimatesScreen(session: s)));
  await t.pumpAndSettle();
}

int _posts(List<RequestOptions> sent) => sent.where((o) => o.method == 'POST').length;

void _widgetTests() {
  testWidgets('the list pages by 50, shows the website chips and sends a chip as status', (t) async {
    final (s, sent) = _server(rows: [_row('q1', 'PI-1', 'draft'), _row('q2', 'PI-2', 'converted', converted: 'i5')]);
    await _pump(t, s);
    expect(sent.first.uri.queryParameters['limit'], '50');
    expect(find.text('PI-1'), findsOneWidget);
    for (final c in ['All', 'Sent', 'Accepted', 'Rejected', 'Expired']) {
      expect(find.text(c), findsOneWidget, reason: c);
    }
    await t.tap(find.text('Sent'));
    await t.pumpAndSettle();
    expect(sent.last.uri.queryParameters['status'], 'sent');
    expect(sent.every((o) => !o.uri.queryParameters.containsKey('business_id')), isTrue);
  });

  testWidgets('a row opens the quotation without payment actions', (t) async {
    final (s, sent) = _server(rows: [_row('q1', 'PI-1', 'sent')]);
    await _pump(t, s);
    await t.tap(find.text('PI-1'));
    await t.pumpAndSettle();
    expect(find.byType(InvoiceDetailScreen), findsOneWidget);
    expect(sent.any((o) => o.uri.path == '/api/invoices/q1'), isTrue);
    expect(find.text('Convert to invoice'), findsOneWidget);
    expect(find.textContaining('Collect'), findsNothing);
    expect(find.text('Payments'), findsNothing);
    expect(find.textContaining('due'), findsNothing);
  });

  testWidgets('Convert asks first, posts once and opens the invoice from the reply', (t) async {
    final gate = Completer<(int, Object?)>();
    final (s, sent) = _server(rows: [_row('q1', 'PI-1', 'sent')], convert: () => gate.future);
    await _pump(t, s);
    await t.longPress(find.text('PI-1'));
    await t.pumpAndSettle();
    await t.tap(find.text('Convert to invoice'));
    await t.pumpAndSettle();
    // Asked first: nothing sent yet, and the sheet names the quotation and amount.
    expect(_posts(sent), 0);
    expect(find.textContaining('PI-1'), findsWidgets);
    expect(find.textContaining('1,180.5'), findsWidgets);
    await t.tap(find.text('Convert'));
    await t.tap(find.text('Convert'), warnIfMissed: false);
    await t.pumpAndSettle();
    expect(find.text('Convert'), findsNothing);
    await t.pump(const Duration(milliseconds: 100));
    expect(_posts(sent), 1);
    expect(sent.firstWhere((o) => o.method == 'POST').uri.path, '/api/invoices/q1/convert-to-tax-invoice');
    gate.complete((200, {'success': true, 'invoice_id': 'i9', 'invoice_number': 'INV-9'}));
    await t.pumpAndSettle();
    expect(_posts(sent), 1);
    expect(sent.any((o) => o.uri.path == '/api/invoices/i9'), isTrue);
    expect(find.byType(InvoiceDetailScreen), findsOneWidget);
  });

  testWidgets('a converted row offers Open invoice, not Convert', (t) async {
    final (s, sent) = _server(rows: [_row('q2', 'PI-2', 'converted', converted: 'i5')]);
    await _pump(t, s);
    await t.longPress(find.text('PI-2'));
    await t.pumpAndSettle();
    expect(find.text('Convert to invoice'), findsNothing);
    await t.tap(find.text('Open invoice'));
    await t.pumpAndSettle();
    expect(sent.any((o) => o.uri.path == '/api/invoices/i5'), isTrue);
    expect(_posts(sent), 0);
  });

  testWidgets('a refused convert shows the server message and leaves the list', (t) async {
    final (s, sent) = _server(
      rows: [_row('q1', 'PI-1', 'sent')],
      convert: () async => (409, {'error': 'This proforma has already been converted to a tax invoice.', 'code': 'PROFORMA_ALREADY_CONVERTED'}),
    );
    await _pump(t, s);
    await t.longPress(find.text('PI-1'));
    await t.pumpAndSettle();
    await t.tap(find.text('Convert to invoice'));
    await t.pumpAndSettle();
    await t.tap(find.text('Convert'));
    await t.pumpAndSettle();
    expect(find.text('This proforma has already been converted to a tax invoice.'), findsOneWidget);
    expect(find.byType(InvoiceDetailScreen), findsNothing);
    expect(find.text('PI-1'), findsOneWidget);
    expect(_posts(sent), 1);
  });

  testWidgets('a converted quotation detail offers Open invoice', (t) async {
    final (s, sent) = _server(rows: [_row('q2', 'PI-2', 'converted', converted: 'i5')]);
    await _pump(t, s);
    await t.tap(find.text('PI-2'));
    await t.pumpAndSettle();
    expect(find.text('Convert to invoice'), findsNothing);
    await t.tap(find.text('Open invoice'));
    await t.pumpAndSettle();
    expect(sent.any((o) => o.uri.path == '/api/invoices/i5'), isTrue);
  });

  int listLoads(List<RequestOptions> sent) => sent.where((o) => o.uri.path == '/api/estimates').length;

  testWidgets('fix1: convert from the detail then Back reloads the list and the row offers Open invoice', (t) async {
    final rows = [_row('q1', 'PI-1', 'sent')];
    final (s, sent) = _server(rows: rows, convert: () async {
      rows[0] = _row('q1', 'PI-1', 'converted', converted: 'i9');
      return (200, {'success': true, 'invoice_id': 'i9', 'invoice_number': 'INV-9'});
    });
    await _pump(t, s);
    await t.tap(find.text('PI-1'));
    await t.pumpAndSettle();
    await t.tap(find.text('Convert to invoice'));
    await t.pumpAndSettle();
    await t.tap(find.text('Convert'));
    await t.pumpAndSettle();
    expect(sent.any((o) => o.uri.path == '/api/invoices/i9'), isTrue);
    Navigator.of(t.element(find.byType(InvoiceDetailScreen))).pop();
    await t.pumpAndSettle();
    expect(listLoads(sent), greaterThanOrEqualTo(2));
    await t.longPress(find.text('PI-1'));
    await t.pumpAndSettle();
    expect(find.text('Open invoice'), findsOneWidget);
    expect(find.text('Convert to invoice'), findsNothing);
  });

  testWidgets('fix1: a convert reply without an id still reloads the list', (t) async {
    final rows = [_row('q1', 'PI-1', 'sent')];
    final (s, sent) = _server(rows: rows, convert: () async {
      rows[0] = _row('q1', 'PI-1', 'converted', converted: 'i9');
      return (200, {'success': true});
    });
    await _pump(t, s);
    await t.longPress(find.text('PI-1'));
    await t.pumpAndSettle();
    await t.tap(find.text('Convert to invoice'));
    await t.pumpAndSettle();
    await t.tap(find.text('Convert'));
    await t.pumpAndSettle();
    expect(listLoads(sent), 2);
    expect(find.byType(InvoiceDetailScreen), findsNothing);
  });

  testWidgets('fix1: 409 already converted opens that invoice and reloads the list', (t) async {
    final (s, sent) = _server(
      rows: [_row('q1', 'PI-1', 'sent')],
      convert: () async => (409, {'error': 'This proforma has already been converted to a tax invoice.', 'code': 'PROFORMA_ALREADY_CONVERTED', 'invoice_id': 'i7'}),
    );
    await _pump(t, s);
    await t.longPress(find.text('PI-1'));
    await t.pumpAndSettle();
    await t.tap(find.text('Convert to invoice'));
    await t.pumpAndSettle();
    await t.tap(find.text('Convert'));
    await t.pumpAndSettle();
    expect(sent.any((o) => o.uri.path == '/api/invoices/i7'), isTrue);
    // The list is under the opened invoice and reloads when it closes.
    Navigator.of(t.element(find.byType(InvoiceDetailScreen))).pop();
    await t.pumpAndSettle();
    expect(listLoads(sent), 2);
  });

  testWidgets('fix2: two asks for the same quotation open one confirm sheet', (t) async {
    final (s, _) = _server(rows: []);
    await t.pumpWidget(MaterialApp(
      home: Builder(
        builder: (ctx) => GestureDetector(
          onTap: () {
            convertQuotation(ctx, s.api, id: 'q1', number: 'PI-1', amount: 5);
            convertQuotation(ctx, s.api, id: 'q1', number: 'PI-1', amount: 5);
          },
          child: const Text('go'),
        ),
      ),
    ));
    await t.tap(find.text('go'));
    await t.pumpAndSettle();
    expect(find.text('Convert to invoice?'), findsOneWidget);
    await t.tap(find.text('Cancel'));
    await t.pumpAndSettle();
    // Cancel frees the quotation: it can be asked again.
    await t.tap(find.text('go'));
    await t.pumpAndSettle();
    expect(find.text('Convert to invoice?'), findsOneWidget);
    await t.tap(find.text('Cancel'));
    await t.pumpAndSettle();
  });

  test('fix4: a detail row with invoice status final and no estimate status reads Draft', () {
    expect(quotationStatus({'status': 'final', 'estimate_status': null}), 'draft');
    expect(quotationStatus({'status': 'final', 'estimate_status': 'accepted'}), 'accepted');
    expect(quotationStatus({'status': 'sent'}), 'sent');
  });

  testWidgets('a normal invoice detail keeps its payment actions', (t) async {
    final (s, _) = _server(rows: []);
    await t.pumpWidget(MaterialApp(home: InvoiceDetailScreen(api: s.api, invoiceId: 'i9', session: s)));
    await t.pumpAndSettle();
    expect(find.textContaining('Collect'), findsOneWidget);
    expect(find.text('Payments'), findsOneWidget);
  });
}

void main() {
  _widgetTests();
  group('quotation logic', () {
    test('status follows the website: estimate status, draft when empty, converted when an invoice exists', () {
      expect(quotationStatus({'status': 'sent'}), 'sent');
      expect(quotationStatus({'estimate_status': 'accepted'}), 'accepted');
      expect(quotationStatus({}), 'draft');
      expect(quotationStatus({'status': 'sent', 'converted_invoice_id': 'i1'}), 'converted');
    });

    test('labels and tones', () {
      expect(quotationStatusStyle('draft').$2, 'Draft');
      expect(quotationStatusStyle('accepted'), (KTone.positive, 'Accepted'));
      expect(quotationStatusStyle('rejected').$1, KTone.negative);
      expect(quotationStatusStyle('expired').$2, 'Expired');
      expect(quotationStatusStyle('converted').$2, 'Converted');
    });

    test('the filter chips are the website chips', () {
      expect([for (final f in kQuotationFilters) f.$2], ['All', 'Draft', 'Sent', 'Accepted', 'Rejected', 'Expired', 'Converted']);
      expect(kQuotationFilters.first.$1, '');
    });

    test('only draft, sent and accepted can be converted', () {
      for (final s in ['draft', 'sent', 'accepted']) {
        expect(canConvertQuotation({'status': s}), isTrue, reason: s);
      }
      for (final s in ['rejected', 'expired', 'converted']) {
        expect(canConvertQuotation({'status': s}), isFalse, reason: s);
      }
      expect(canConvertQuotation({'status': 'sent', 'converted_invoice_id': 'i1'}), isFalse);
    });

    test('row actions: converted rows open the invoice, others convert', () {
      expect(quotationActions({'status': 'sent'}), [QuotationAction.convert, QuotationAction.share]);
      expect(quotationActions({'status': 'converted', 'converted_invoice_id': 'i1'}), [QuotationAction.openInvoice, QuotationAction.share]);
      expect(quotationActions({'status': 'expired'}), [QuotationAction.share]);
      // Converted but the row gave no invoice id: nothing to open.
      expect(quotationActions({'status': 'converted'}), [QuotationAction.share]);
    });

    test('convert sends no identity and the new invoice id is read from the reply', () {
      expect(quotationConvertBody(), isEmpty);
      expect(convertedInvoiceIdOf({'success': true, 'invoice_id': 'i9', 'invoice_number': 'INV-9'}), 'i9');
      expect(convertedInvoiceIdOf({'invoice_id': ''}), isNull);
      expect(convertedInvoiceIdOf({}), isNull);
    });

    test('title, subtitle and confirm text', () {
      final row = {'estimate_number': 'PI-7', 'customer_name': 'Asha', 'estimate_date': '2026-11-01', 'expiry_date': '2026-11-15', 'grand_total': '1180.5'};
      expect(quotationTitle(row), 'PI-7');
      expect(quotationSubtitle(row), 'Asha · 01 Nov 2026 · Expires 15 Nov 2026');
      expect(quotationSubtitle({'estimate_number': 'PI-8'}), 'No customer');
      expect(quotationConfirmText('PI-7', 1180.5), contains('PI-7'));
      expect(quotationConfirmText('PI-7', 1180.5), contains('1,180.5'));
    });
  });
}

