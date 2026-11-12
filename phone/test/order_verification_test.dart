import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/whatsapp/order_verification_logic.dart';
import 'package:khatario_phone/ui/authed_image.dart';
import 'package:khatario_phone/screens/whatsapp/order_verification_screen.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _order(String id, String number, {String name = 'Mehta Stores', Map<String, dynamic> extra = const {}}) => {
      'id': id,
      'order_number': number,
      'customer_name': name,
      'whatsapp_phone': '919812345678',
      'grand_total': '1180.50',
      'created_at': '2026-11-10T09:00:00.000Z',
      'items': [
        {'item_name': 'Rice 5kg', 'qty': '2.000', 'line_total': '1000.00'},
        {'item_name': 'Oil 1L', 'qty': '1.000', 'line_total': '180.50'},
      ],
      ...extra,
    };

Reply _handler(RequestOptions o, Map b, {List<Map<String, dynamic>>? orders}) {
  if (o.uri.path == '/api/whatsapp/orders' && o.method == 'GET') {
    return (200, {'orders': orders ?? [_order('o1', 'SO-1'), _order('o2', 'SO-2', name: 'Shah Traders')]});
  }
  return (200, <String, dynamic>{});
}

Finder _icon(String label) => find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == label);

void main() {
  group('order rows', () {
    test('read qty and line_total, which is what the server sends', () {
      final row = whatsAppOrderRows([_order('o1', 'SO-1')]).single;
      expect(row.items.map((i) => (i.name, i.qty, i.total)), [('Rice 5kg', 2, 1000), ('Oil 1L', 1, 180.5)]);
      expect(row.lines, ['2 × Rice 5kg', '1 × Oil 1L']);
      expect(row.placedAt, isNotNull);
    });

    test('placed time reads 12-hour like the website', () {
      expect(orderPlacedText(DateTime(2026, 11, 10, 14, 30)), '10 Nov 2026, 02:30 PM');
      expect(orderPlacedText(DateTime(2026, 11, 3, 0, 5)), '03 Nov 2026, 12:05 AM');
    });

    test('a provider payment shows the online panel; a screenshot shows the proof; else the empty note', () {
      OrderProof of(Map<String, dynamic> extra) => whatsAppOrderRows([_order('o', 'S', extra: extra)]).single.proof;
      expect(of({'payment_status': 'paid'}), OrderProof.online);
      expect(of({'payment_status': 'Partial_Paid'}), OrderProof.online);
      expect(of({'payment_status': 'partial'}), OrderProof.online);
      expect(of({'payment_status': 'paid', 'payment_screenshot_url': 'https://x/y.png'}), OrderProof.online);
      expect(of({'payment_status': 'unpaid', 'payment_screenshot_url': 'https://x/y.png'}), OrderProof.screenshot);
      expect(of({}), OrderProof.none);
      expect(onlinePaymentTitle('paid'), 'Payment received (online)');
      expect(onlinePaymentTitle('partial_paid'), 'Partial payment received');
    });

    test('the AI check reads like the website card', () {
      final row = whatsAppOrderRows([
        _order('o', 'S', extra: {
          'payment_screenshot_url': 'https://x/y.png',
          'ocr_status': 'requires_review',
          'ocr_data': {
            'verification_source': 'ocr_gemini',
            'extractedAmount': 1180.5,
            'confidenceScore': 70,
            'effective_confidence': 85,
            'extractedUPIId': 'shop@upi',
            'validation_summary': 'Amount matches',
            'reason': 'Blurry',
          },
        }),
      ]).single;
      final ocr = row.ocr!;
      expect(ocrProofPresentation(row.ocrStatus).$1, 'Review needed');
      expect(ocr.source, 'ocr gemini');
      expect(ocr.amountText, '₹1,180.5');
      expect(ocr.confidenceText, '85% (model 70%)');
      expect(ocr.confident, isTrue);
      expect(ocr.upi, 'shop@upi');
      expect(ocr.summary, 'Amount matches');
      expect(ocr.note, 'Blurry');
      final bare = OrderOcr.fromJson({'extractedAmount': null});
      expect(bare.amountText, 'N/A');
      expect(bare.confidenceText, '—');
      expect(bare.confident, isFalse);
      expect(ocrProofPresentation('verified').$1, 'Verified');
      expect(ocrProofPresentation('rejected').$1, 'Rejected');
      expect(ocrProofPresentation('awaiting_psp').$1, 'Awaiting payment provider');
      expect(ocrProofPresentation(null).$1, 'Pending');
      expect(ocrProofPresentation('some_status').$1, 'some status');
    });

    test('20 orders a page', () {
      expect(orderPageCount(0), 1);
      expect(orderPageCount(20), 1);
      expect(orderPageCount(21), 2);
      final rows = List.generate(45, (i) => i);
      expect(orderPage(rows, 3), [40, 41, 42, 43, 44]);
      expect(orderPage(rows, 9), [40, 41, 42, 43, 44]);
    });
  });

  group('order verification screen', () {
    testWidgets('lists each order with items and amounts, no website globe, and sends no identity', (t) async {
      final (session, sent) = recordedSession(_handler);
      await pumpScreen(t, OrderVerificationScreen(session: session));
      expect(find.text('Mehta Stores'), findsOneWidget);
      expect(find.text('Shah Traders'), findsOneWidget);
      expect(find.textContaining('SO-1'), findsOneWidget);
      expect(find.textContaining('Rice 5kg'), findsWidgets);
      expect(find.textContaining('No payment proof uploaded yet'), findsWidgets);
      expect(_icon('Open on website'), findsNothing);
      expect(requestsOf(sent, 'GET', '/api/whatsapp/orders').single.uri.queryParameters, {'status': 'draft'});
      for (final o in sent) {
        expect(o.uri.query.contains('business_id'), isFalse);
      }
    });

    testWidgets('empty, server error with Try again, and not in the plan', (t) async {
      final (empty, _) = recordedSession((o, b) => _handler(o, b, orders: []));
      await pumpScreen(t, OrderVerificationScreen(session: empty));
      expect(find.text('No pending orders'), findsOneWidget);

      var fail = true;
      final (flaky, sent) = recordedSession((o, b) => fail ? (500, {'error': 'Boom'}) : _handler(o, b));
      await pumpScreen(t, OrderVerificationScreen(session: flaky));
      expect(find.text('Could not load orders'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Mehta Stores'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/orders'), 2);

      final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, OrderVerificationScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('an online payment shows the received panel with reference and method', (t) async {
      final (session, _) = recordedSession((o, b) => _handler(o, b, orders: [
            _order('o1', 'SO-1', extra: {
              'payment_status': 'paid',
              'payment_reference': 'UTR123',
              'payment_method': 'upi_collect',
              'ocr_data': {'verification_source': 'payment_gateway'},
            }),
          ]));
      await pumpScreen(t, OrderVerificationScreen(session: session));
      expect(find.text('Payment received (online)'), findsOneWidget);
      expect(find.text('UTR123'), findsOneWidget);
      expect(find.text('upi collect'), findsOneWidget);
      expect(find.text('payment gateway'), findsOneWidget);
    });

    testWidgets('a screenshot shows the AI check: status, amount, confidence, UPI and notes', (t) async {
      final (session, _) = recordedSession((o, b) => _handler(o, b, orders: [
            _order('o1', 'SO-1', extra: {
              'payment_screenshot_url': 'https://x.test/proof.png',
              'ocr_status': 'verified',
              'ocr_data': {'extractedAmount': 1180.5, 'confidenceScore': 92, 'extractedUPIId': 'shop@upi', 'validation_summary': 'Amount matches', 'reason': 'Clear'},
            }),
          ]));
      await pumpScreen(t, OrderVerificationScreen(session: session));
      expect(find.text('Payment proof: Verified'), findsOneWidget);
      expect(find.text('₹1,180.5'), findsOneWidget);
      expect(find.text('92%'), findsOneWidget);
      expect(find.text('shop@upi'), findsOneWidget);
      expect(find.textContaining('Amount matches'), findsOneWidget);
      expect(find.textContaining('Clear'), findsOneWidget);
    });

    testWidgets('pages of 20 with Previous and Next, as on the website', (t) async {
      final many = [for (var i = 1; i <= 25; i++) _order('o$i', 'SO-$i', name: 'Customer $i')];
      final (session, _) = recordedSession((o, b) => _handler(o, b, orders: many));
      await pumpScreen(t, OrderVerificationScreen(session: session));
      expect(find.text('Customer 1'), findsOneWidget);
      await t.scrollUntilVisible(find.text('Page 1 of 2'), 600, scrollable: find.byType(Scrollable).first);
      expect(find.text('Customer 21'), findsNothing);
      await t.tap(find.text('Next'));
      await t.pumpAndSettle();
      await t.scrollUntilVisible(find.text('Page 2 of 2'), 600, scrollable: find.byType(Scrollable).first);
      expect(find.text('Page 2 of 2'), findsOneWidget);
      await t.drag(find.byType(Scrollable).first, const Offset(0, 100000));
      await t.pumpAndSettle();
      expect(find.text('Customer 21'), findsOneWidget);
      expect(find.text('Customer 1'), findsNothing);
    });

    testWidgets('Approve asks first, posts once with no body identity, shows the invoice number and reloads', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/orders/o1/approve') return (200, {'success': true, 'invoice_id': 'i1', 'invoice_number': 'INV-9'});
        return _handler(o, b);
      });
      await pumpScreen(t, OrderVerificationScreen(session: session));
      await t.tap(find.text('Verify & Create Invoice').first);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/whatsapp/orders/o1/approve'), 0);
      await t.tap(inSheet('Approve'));
      await t.tap(inSheet('Approve'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/whatsapp/orders/o1/approve'), 1);
      expectNoIdentity(lastBody(sent, 'POST', '/api/whatsapp/orders/o1/approve'));
      expect(find.textContaining('INV-9'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/orders'), 2);
    });

    testWidgets('a refused approve (total mismatch) shows the reason and reloads', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/orders/o1/approve') {
          return (409, {'error': 'Order total differs from the GST-computed invoice total. Edit the order before approving.', 'code': 'ORDER_TOTAL_MISMATCH'});
        }
        return _handler(o, b);
      });
      await pumpScreen(t, OrderVerificationScreen(session: session));
      await t.tap(find.text('Verify & Create Invoice').first);
      await t.pumpAndSettle();
      await t.tap(inSheet('Approve'));
      await t.pumpAndSettle();
      expect(find.textContaining('Edit the order before approving.'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/orders'), 2);
    });

    testWidgets('Reject asks for a reason, posts it once with no identity, then reloads', (t) async {
      final (session, sent) = recordedSession(_handler);
      await pumpScreen(t, OrderVerificationScreen(session: session));
      await t.tap(find.text('Reject').first);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/whatsapp/orders/o1/reject'), 0);
      await t.enterText(find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)), 'Wrong amount');
      await t.tap(inSheet('Reject Order'));
      await t.tap(inSheet('Reject Order'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/whatsapp/orders/o1/reject'), 1);
      final body = lastBody(sent, 'POST', '/api/whatsapp/orders/o1/reject');
      expect(body, {'reason': 'Wrong amount'});
      expectNoIdentity(body);
      expect(requestCount(sent, 'GET', '/api/whatsapp/orders'), 2);
    });

    testWidgets('a refused reject (already decided) shows the server reason and reloads', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/orders/o1/reject') return (409, {'error': 'This order is no longer waiting for verification'});
        return _handler(o, b);
      });
      await pumpScreen(t, OrderVerificationScreen(session: session));
      await t.tap(find.text('Reject').first);
      await t.pumpAndSettle();
      await t.tap(inSheet('Reject Order'));
      await t.pumpAndSettle();
      expect(find.text('This order is no longer waiting for verification'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/orders'), 2);
    });


    testWidgets('a relative screenshot path is fetched with the signed-in session, in the card and in the zoom view', (t) async {
      final png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/media/proof.png') return (200, png);
        return _handler(o, b, orders: [_order('o1', 'SO-1', extra: {'payment_screenshot_url': '/api/whatsapp/media/proof.png', 'ocr_status': 'verified'})]);
      });
      await pumpScreen(t, OrderVerificationScreen(session: session));
      expect(requestCount(sent, 'GET', '/api/whatsapp/media/proof.png'), 1);
      expect(find.byType(AuthedImage), findsOneWidget);
      expect(find.byType(Image), findsOneWidget);
      expect(find.byWidgetPredicate((w) => w is Image && w.image is NetworkImage), findsNothing);
      await t.ensureVisible(find.byType(AuthedImage));
      await t.tap(find.byType(AuthedImage));
      await t.pumpAndSettle();
      expect(find.byType(AuthedImage), findsNWidgets(2));
      expect(requestCount(sent, 'GET', '/api/whatsapp/media/proof.png'), 2);
    });

    testWidgets('website wording: Verify & Create Invoice, Approve Order?, Anonymous Customer', (t) async {
      final (session, _) = recordedSession((o, b) => _handler(o, b, orders: [
            {'id': 'o9', 'order_number': 'SO-9', 'grand_total': '10', 'items': []},
          ]));
      await pumpScreen(t, OrderVerificationScreen(session: session));
      expect(find.text('Anonymous Customer'), findsOneWidget);
      await t.tap(find.text('Verify & Create Invoice'));
      await t.pumpAndSettle();
      expect(inSheet('Approve Order?'), findsOneWidget);
      await t.tap(inSheet('Approve'));
      await t.pumpAndSettle();
      await t.tap(find.text('Reject'));
      await t.pumpAndSettle();
      expect(inSheet('Reject Order?'), findsOneWidget);
    });

    testWidgets('Refresh reloads the list', (t) async {
      final (session, sent) = recordedSession(_handler);
      await pumpScreen(t, OrderVerificationScreen(session: session));
      await t.tap(_icon('Refresh'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'GET', '/api/whatsapp/orders'), 2);
    });
  });
}
