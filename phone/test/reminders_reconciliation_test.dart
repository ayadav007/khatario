import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/payments/payment_reconciliation_logic.dart';
import 'package:khatario_phone/screens/payments/payment_reconciliation_screen.dart';
import 'package:khatario_phone/screens/sales/payment_reminders_logic.dart';
import 'package:khatario_phone/screens/sales/payment_reminders_screen.dart';
import 'package:khatario_phone/session.dart';

import 'support/finders.dart';
import 'support/recorded_session.dart';

// -------------------------------------------------------------------------------------------
// Reminders
// -------------------------------------------------------------------------------------------

Map<String, dynamic> _inv(String id, String number, String name, {String status = 'unpaid', double balance = 500}) => {
      'id': id,
      'invoice_number': number,
      'invoice_date': '2026-10-01',
      'due_date': '2026-10-15',
      'payment_status': status,
      'grand_total': 1000.0,
      'balance_amount': balance,
      'status': 'final',
      'customer': {'id': 'c-$id', 'name': name, 'phone': '9876543210', 'email': null},
    };

// -------------------------------------------------------------------------------------------
// Reconciliation
// -------------------------------------------------------------------------------------------

Map<String, dynamic> _tx({String id = 't1', String status = 'requires_review', String amount = '1180.00', String provider = 'razorpay'}) => {
      'id': id,
      'order_id': 'a1b2c3d4-0000-4000-8000-000000000001',
      'amount': amount,
      'currency': 'INR',
      'status': status,
      'method': 'upi',
      'provider': provider,
      'utr': 'UTR123',
      'provider_payment_id': null,
      'raw_payload': {
        'webhook_validation': {'ok': false, 'reason': 'amount_mismatch'},
        'gateway_note': 'hello-gateway',
      },
      'created_at': '2026-11-01T05:00:00.000Z',
      'updated_at': '2026-11-02T05:00:00.000Z',
      'order_payment_status': 'unpaid',
    };

void main() {
  group('payment reminders logic', () {
    test('reads the invoices', () {
      final rows = reminderInvoices([_inv('i1', 'INV-1', 'Asha', status: 'partially_paid', balance: 250.5), 'junk']);
      expect(rows, hasLength(1));
      final r = rows.single;
      expect(r.id, 'i1');
      expect(r.number, 'INV-1');
      expect(r.customerName, 'Asha');
      expect(r.balance, 250.5);
      expect(r.total, 1000);
      expect(r.paymentStatus, 'partially_paid');
      expect(r.statusLabel, 'Partially paid');
      expect(r.dueDate, isNotNull);
    });

    test('the body lists the ticked invoice ids only, in list order', () {
      final all = reminderInvoices([_inv('i1', 'INV-1', 'A'), _inv('i2', 'INV-2', 'B'), _inv('i3', 'INV-3', 'C')]);
      final body = reminderBody(invoices: all, ticked: {'i3', 'i1'}, template: 'Hi {customer_name}', includePdf: false);
      expect(body, {
        'invoice_ids': ['i1', 'i3'],
        'message_template': 'Hi {customer_name}',
        'include_pdf': false,
      });
      expectNoIdentity(body);
    });

    test('an id that is no longer in the list is never sent', () {
      final all = reminderInvoices([_inv('i1', 'INV-1', 'A')]);
      final body = reminderBody(invoices: all, ticked: {'i1', 'gone'}, template: 't', includePdf: true);
      expect(body['invoice_ids'], ['i1']);
    });

    test('the default template is the website one', () {
      expect(kDefaultReminderTemplate, startsWith('Hi {customer_name},'));
      expect(kDefaultReminderTemplate, contains('{invoice_no}'));
      expect(kDefaultReminderTemplate, endsWith('{business_name}'));
    });

    test('WhatsApp is linked when connected, or cloud-ready with the Connect module', () {
      expect(whatsAppLinked({'status': 'connected'}, hasConnect: false), isTrue);
      expect(whatsAppLinked({'status': 'disconnected', 'cloudReady': true}, hasConnect: true), isTrue);
      expect(whatsAppLinked({'status': 'disconnected', 'cloudReady': true}, hasConnect: false), isFalse);
      expect(whatsAppLinked({'status': 'disconnected', 'cloudReady': false}, hasConnect: true), isFalse);
      expect(whatsAppLinked({}, hasConnect: true), isFalse);
    });

    test('result text', () {
      expect(reminderResultText({'success_count': 2, 'failed_count': 1}), 'Reminders sent! Success: 2, Failed: 1');
      expect(reminderResultText({}), 'Reminders sent! Success: 0, Failed: 0');
    });
  });

  group('payment reminders screen', () {
    late List<Map<String, dynamic>> invoices;
    late Map<String, dynamic> status;
    late Reply Function(RequestOptions o, Map b)? sendReply;
    late Completer<void>? sendGate;

    setUp(() {
      invoices = [_inv('i1', 'INV-1', 'Asha'), _inv('i2', 'INV-2', 'Bina', status: 'partially_paid'), _inv('i3', 'INV-3', 'Chitra')];
      status = {'status': 'connected', 'cloudReady': false};
      sendReply = null;
      sendGate = null;
    });

    (AppSession, List<RequestOptions>) server() => recordedSession((o, b) async {
          final p = o.uri.path;
          if (p == '/api/invoices/for-reminders') return (200, {'invoices': invoices});
          if (p == '/api/whatsapp/status') return (200, status);
          if (p == '/api/whatsapp/send-bulk-reminders') {
            if (sendGate != null) await sendGate!.future;
            return (sendReply ?? (o, b) => (200, {'success': true, 'success_count': (b['invoice_ids'] as List).length, 'failed_count': 0, 'results': <Object>[]}))(o, b);
          }
          return (200, <String, dynamic>{});
        });

    testWidgets('lists the unpaid invoices with nothing ticked', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      expect(find.text('Asha'), findsOneWidget);
      expect(find.text('Bina'), findsOneWidget);
      expect(find.textContaining('INV-1'), findsWidgets);
      expect(find.textContaining('500'), findsWidgets);
      expect(find.text('Send reminders'), findsOneWidget);
      expect(find.text('WhatsApp is not connected'), findsNothing);
      expect(requestCount(sent, 'GET', '/api/invoices/for-reminders'), 1);
      expect(requestCount(sent, 'GET', '/api/whatsapp/status'), 1);
      expect(sent.first.uri.query, contains('payment_status=both'));
      expect(sent.first.uri.query, isNot(contains('business_id')));
      expect(sent.first.uri.query, isNot(contains('user_id')));
    });

    testWidgets('empty, error and plan states', (t) async {
      invoices = [];
      var (s, _) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      expect(find.text('No invoices found'), findsOneWidget);

      (s, _) = recordedSession((o, b) => (400, {'error': 'Failed to fetch invoices'}));
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      expect(find.text('Failed to fetch invoices'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);

      (s, _) = recordedSession((o, b) => (403, {'error': 'Not in plan', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('Send is off until something is ticked, and its label counts the ticks', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      await t.tap(find.text('Send reminders'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);
      await t.tap(find.text('Asha'));
      await t.tap(find.text('Chitra'));
      await t.pumpAndSettle();
      expect(find.text('Send reminder to 2 invoice(s)'), findsOneWidget);
      await t.tap(find.text('Asha'));
      await t.pumpAndSettle();
      expect(find.text('Send reminder to 1 invoice(s)'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/send-bulk-reminders'), 0);
    });

    testWidgets('confirms who gets a message and how many, then sends the ticked ones once', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      await t.tap(find.text('Asha'));
      await t.tap(find.text('Chitra'));
      await t.pumpAndSettle();
      await t.tap(find.text('Send reminder to 2 invoice(s)'));
      await t.pumpAndSettle();
      // The status is read again right before asking.
      expect(requestCount(sent, 'GET', '/api/whatsapp/status'), 2);
      expect(inSheet('Send reminders'), findsOneWidget);
      expect(find.textContaining('2 invoice'), findsWidgets);
      expect(inSheet('Asha'), findsOneWidget);
      expect(inSheet('Chitra'), findsOneWidget);
      expect(inSheet('Bina'), findsNothing, reason: 'only ticked invoices are named');
      expect(requestCount(sent, 'POST', '/api/whatsapp/send-bulk-reminders'), 0, reason: 'nothing goes before the answer');

      sendGate = Completer<void>();
      await t.tap(find.text('Send 2 reminders'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 600));
      expect(find.byType(BottomSheet), findsNothing);
      sendGate!.complete();
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/whatsapp/send-bulk-reminders'), 1);
      final body = lastBody(sent, 'POST', '/api/whatsapp/send-bulk-reminders');
      expect(body['invoice_ids'], ['i1', 'i3']);
      expect(body['message_template'], kDefaultReminderTemplate);
      expect(body['include_pdf'], true);
      expectNoIdentity(body);
      expect(find.text('Reminders sent! Success: 2, Failed: 0'), findsOneWidget);
      // The list reloads and the ticks are cleared.
      expect(requestCount(sent, 'GET', '/api/invoices/for-reminders'), 2);
      expect(find.text('Send reminders'), findsOneWidget);
    });

    testWidgets('a double tap on Send in the confirm sheet sends once', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      await t.tap(find.text('Asha'));
      await t.pumpAndSettle();
      await t.tap(find.text('Send reminder to 1 invoice(s)'));
      await t.pumpAndSettle();
      await t.tap(find.text('Send 1 reminder'));
      await t.tap(find.text('Send 1 reminder'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/whatsapp/send-bulk-reminders'), 1);
    });

    testWidgets('Cancel on the confirm sheet sends nothing', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      await t.tap(find.text('Asha'));
      await t.pumpAndSettle();
      await t.tap(find.text('Send reminder to 1 invoice(s)'));
      await t.pumpAndSettle();
      await t.tap(find.text('Cancel'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/whatsapp/send-bulk-reminders'), 0);
      expect(find.text('Send reminder to 1 invoice(s)'), findsOneWidget, reason: 'the ticks stay');
    });

    testWidgets('the message and the PDF choice go into the body', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      await t.tap(find.text('Asha'));
      await t.enterText(textFieldLabelled('Message template'), 'Please pay {invoice_no}');
      await t.tap(find.text('Include PDF attachment'));
      await t.pumpAndSettle();
      await t.tap(find.text('Send reminder to 1 invoice(s)'));
      await t.pumpAndSettle();
      await t.tap(find.text('Send 1 reminder'));
      await t.pumpAndSettle();
      final body = lastBody(sent, 'POST', '/api/whatsapp/send-bulk-reminders');
      expect(body['message_template'], 'Please pay {invoice_no}');
      expect(body['include_pdf'], false);
    });

    testWidgets('a blank message is refused before anything is asked or sent', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      await t.tap(find.text('Asha'));
      await t.enterText(textFieldLabelled('Message template'), '   ');
      await t.pumpAndSettle();
      await t.tap(find.text('Send reminder to 1 invoice(s)'));
      await t.pumpAndSettle();
      expect(find.text('Please enter a message template'), findsOneWidget);
      expect(find.byType(BottomSheet), findsNothing);
      expect(requestCount(sent, 'POST', '/api/whatsapp/send-bulk-reminders'), 0);
    });

    testWidgets('WhatsApp not linked: the banner replaces Send and nothing can be sent', (t) async {
      status = {'status': 'disconnected', 'cloudReady': false};
      final (s, sent) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      expect(find.text('WhatsApp is not connected'), findsOneWidget);
      expect(find.textContaining('scan a QR code'), findsOneWidget);
      expect(find.text('Connect WhatsApp'), findsOneWidget);
      await t.tap(find.text('Asha'));
      await t.pumpAndSettle();
      expect(find.textContaining('Send reminder'), findsNothing, reason: 'no Send button while WhatsApp is not linked');
      expect(find.text('Send reminders'), findsNothing);
      expect(requestCount(sent, 'POST', '/api/whatsapp/send-bulk-reminders'), 0);
      // The way out is the WhatsApp settings screen.
      await t.tap(find.text('Connect WhatsApp'));
      await t.pumpAndSettle();
      expect(find.text('The number invoices and reminders are sent from.'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/send-bulk-reminders'), 0);
    });

    testWidgets('a status that cannot be read counts as not linked', (t) async {
      final (s, sent) = recordedSession((o, b) {
        final p = o.uri.path;
        if (p == '/api/invoices/for-reminders') return (200, {'invoices': invoices});
        if (p == '/api/whatsapp/status') return (403, {'error': 'Not available'});
        return (200, <String, dynamic>{});
      });
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      expect(find.text('WhatsApp is not connected'), findsOneWidget);
      expect(find.textContaining('Send reminder'), findsNothing);
      expect(requestCount(sent, 'POST', '/api/whatsapp/send-bulk-reminders'), 0);
    });

    testWidgets('WhatsApp dropped since the page opened: asks nothing and sends nothing', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      await t.tap(find.text('Asha'));
      await t.pumpAndSettle();
      status = {'status': 'disconnected', 'cloudReady': false};
      await t.tap(find.text('Send reminder to 1 invoice(s)'));
      await t.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);
      expect(find.text('WhatsApp is not connected'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/send-bulk-reminders'), 0);
    });

    testWidgets('the server saying not connected shows the banner', (t) async {
      sendReply = (o, b) => (409, {'error': 'WhatsApp is not connected.', 'code': 'WHATSAPP_NOT_CONNECTED'});
      final (s, sent) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      await t.tap(find.text('Asha'));
      await t.pumpAndSettle();
      await t.tap(find.text('Send reminder to 1 invoice(s)'));
      await t.pumpAndSettle();
      await t.tap(find.text('Send 1 reminder'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/whatsapp/send-bulk-reminders'), 1);
      expect(find.text('WhatsApp is not connected'), findsOneWidget);
      expect(find.textContaining('Send reminder'), findsNothing);
    });

    testWidgets('a refused send shows the server message and keeps the ticks', (t) async {
      sendReply = (o, b) => (400, {'error': 'Select up to 20 invoices at a time', 'code': 'BATCH_TOO_LARGE'});
      final (s, sent) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      await t.tap(find.text('Asha'));
      await t.pumpAndSettle();
      await t.tap(find.text('Send reminder to 1 invoice(s)'));
      await t.pumpAndSettle();
      await t.tap(find.text('Send 1 reminder'));
      await t.pumpAndSettle();
      expect(find.textContaining('Select up to 20 invoices at a time'), findsOneWidget);
      expect(find.text('Send reminder to 1 invoice(s)'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/invoices/for-reminders'), 1);
    });

    testWidgets('the status chips reload from the server', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      await t.tap(find.text('Partially paid').first);
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/invoices/for-reminders').last.uri.queryParameters['payment_status'], 'partially_paid');
    });

    testWidgets('Select all ticks everything on screen', (t) async {
      final (s, _) = server();
      await pumpScreen(t, PaymentRemindersScreen(session: s));
      await t.tap(find.text('Select all'));
      await t.pumpAndSettle();
      expect(find.text('Send reminder to 3 invoice(s)'), findsOneWidget);
    });
  });

  group('payment reconciliation logic', () {
    test('reads the transactions', () {
      final tx = paymentTransactions([_tx(), 'x']).single;
      expect(tx.id, 't1');
      expect(tx.amount, 1180);
      expect(tx.amountText, '₹1,180');
      expect(tx.shortOrderId, 'a1b2c3d4');
      expect(tx.reference, 'UTR123');
      expect(tx.statusLabel, 'Requires review');
      expect(tx.rawPayload['gateway_note'], 'hello-gateway');
    });

    test('the amount keeps paise', () {
      expect(paymentTransactions([_tx(amount: '99.50')]).single.amountText, '₹99.5');
    });

    test('actions per status follow the website', () {
      expect(reconActions('requires_review'), [ReconAction.markPaid, ReconAction.markFailed]);
      expect(reconActions('pending'), [ReconAction.retryVerification]);
      expect(reconActions('success'), isEmpty);
      expect(reconActions('failed'), isEmpty);
    });

    test('the body names the transaction and the action, nothing else', () {
      expect(manualActionBody('t1', ReconAction.markPaid), {'transaction_id': 't1', 'action': 'mark_paid'});
      expect(manualActionBody('t1', ReconAction.markFailed), {'transaction_id': 't1', 'action': 'mark_failed'});
      expect(manualActionBody('t1', ReconAction.retryVerification), {'transaction_id': 't1', 'action': 'retry_verification'});
      expectNoIdentity(manualActionBody('t1', ReconAction.markPaid));
    });

    test('the question names the amount and the order', () {
      final tx = paymentTransactions([_tx()]).single;
      expect(reconConfirmText(ReconAction.markPaid, tx), contains('₹1,180'));
      expect(reconConfirmText(ReconAction.markPaid, tx), contains('a1b2c3d4'));
      expect(reconConfirmText(ReconAction.markFailed, tx), contains('₹1,180'));
      expect(reconConfirmText(ReconAction.retryVerification, tx), contains('₹1,180'));
    });

    test('the validation shown is the website pick', () {
      final tx = paymentTransactions([_tx()]).single;
      expect(tx.validation, {'ok': false, 'reason': 'amount_mismatch'});
      final manual = paymentTransactions([
        {..._tx(), 'raw_payload': {'manual_validation': {'ok': true}}}
      ]).single;
      expect(manual.validation, {'ok': true});
    });
  });

  group('payment reconciliation screen', () {
    late List<Map<String, dynamic>> txs;
    late Reply Function(RequestOptions o, Map b)? action;

    setUp(() {
      txs = [_tx(), _tx(id: 't2', status: 'pending', amount: '500.00', provider: 'cashfree')];
      action = null;
    });

    (AppSession, List<RequestOptions>) server() => recordedSession((o, b) {
          final p = o.uri.path;
          if (p == '/api/payments' && o.method == 'GET') return (200, {'payment_transactions': txs});
          if (p == '/api/payments/manual-action') {
            return (action ??
                (o, b) {
                  txs = [for (final x in txs) if (x['id'] != b['transaction_id']) x];
                  return (200, {'ok': true});
                })(o, b);
          }
          return (200, <String, dynamic>{});
        });

    testWidgets('lists what needs review, asking the server for exactly that', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentReconciliationScreen(session: s));
      final q = sent.first.uri.queryParameters;
      expect(q['reconciliation'], '1');
      expect(q['status'], 'requires_review');
      expect(q.containsKey('business_id'), isFalse);
      expect(q.containsKey('user_id'), isFalse);
      expect(find.textContaining('1,180'), findsWidgets);
      expect(find.textContaining('UTR123'), findsWidgets);
      expect(find.text('Mark as paid'), findsOneWidget);
      expect(find.text('Mark as failed'), findsOneWidget);
      expect(find.text('Retry verification'), findsOneWidget, reason: 'only the pending row');
    });

    testWidgets('empty, error and plan states', (t) async {
      txs = [];
      var (s, _) = server();
      await pumpScreen(t, PaymentReconciliationScreen(session: s));
      expect(find.text('No transactions found.'), findsOneWidget);

      (s, _) = recordedSession((o, b) => (403, {'error': 'Forbidden'}));
      await pumpScreen(t, PaymentReconciliationScreen(session: s));
      expect(find.text('Forbidden'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);

      (s, _) = recordedSession((o, b) => (403, {'error': 'Not in plan', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, PaymentReconciliationScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('the status chips and the search reload from the server', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentReconciliationScreen(session: s));
      await t.tap(find.text('Pending').first);
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/payments').last.uri.queryParameters['status'], 'pending');
      await t.tap(find.text('All'));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/payments').last.uri.queryParameters.containsKey('status'), isFalse);
    });

    testWidgets('Mark as paid names the payment and amount, posts once, reloads', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentReconciliationScreen(session: s));
      await t.tap(find.text('Mark as paid'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/payments/manual-action'), 0, reason: 'nothing is posted before the answer');
      expect(inSheet('Mark as paid?'), findsOneWidget);
      expect(find.textContaining('₹1,180'), findsWidgets);
      expect(find.textContaining('a1b2c3d4'), findsWidgets);
      final confirm = find.descendant(of: find.byType(BottomSheet), matching: find.text('Mark as paid'));
      await t.tap(confirm);
      await t.tap(confirm, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/payments/manual-action'), 1);
      final body = lastBody(sent, 'POST', '/api/payments/manual-action');
      expect(body, {'transaction_id': 't1', 'action': 'mark_paid'});
      expectNoIdentity(body);
      expect(requestCount(sent, 'GET', '/api/payments'), 2);
      expect(find.text('Updated'), findsOneWidget);
    });

    testWidgets('Mark as failed and Retry verification post their own action', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentReconciliationScreen(session: s));
      await t.tap(find.text('Retry verification'));
      await t.pumpAndSettle();
      expect(inSheet('Retry verification?'), findsOneWidget);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Retry verification')));
      await t.pumpAndSettle();
      expect(lastBody(sent, 'POST', '/api/payments/manual-action'), {'transaction_id': 't2', 'action': 'retry_verification'});

      await t.tap(find.text('Mark as failed'));
      await t.pumpAndSettle();
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Mark as failed')));
      await t.pumpAndSettle();
      expect(lastBody(sent, 'POST', '/api/payments/manual-action'), {'transaction_id': 't1', 'action': 'mark_failed'});
    });

    testWidgets('Not now posts nothing', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentReconciliationScreen(session: s));
      await t.tap(find.text('Mark as paid'));
      await t.pumpAndSettle();
      await t.tap(find.text('Not now'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/payments/manual-action'), 0);
    });

    testWidgets('a refused action shows the server message and leaves the screen as it was', (t) async {
      action = (o, b) => (422, {'error': 'Amount does not match remaining balance (within EPS). Kept as requires_review.'});
      final (s, sent) = server();
      await pumpScreen(t, PaymentReconciliationScreen(session: s));
      await t.tap(find.text('Mark as paid'));
      await t.pumpAndSettle();
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Mark as paid')));
      await t.pumpAndSettle();
      expect(find.textContaining('Amount does not match remaining balance'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/payments'), 1);
      expect(find.text('Mark as paid'), findsOneWidget);
    });

    testWidgets('a row opens the details with the validation and raw payload', (t) async {
      final (s, _) = server();
      await pumpScreen(t, PaymentReconciliationScreen(session: s));
      await t.tap(find.textContaining('UTR123').first);
      await t.pumpAndSettle();
      expect(find.text('Raw payload'), findsOneWidget);
      expect(find.text('Validation'), findsOneWidget);
      expect(find.textContaining('hello-gateway'), findsOneWidget);
      expect(find.textContaining('amount_mismatch'), findsWidgets);
    });

    testWidgets('actions from the details sheet confirm first too', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, PaymentReconciliationScreen(session: s));
      await t.tap(find.textContaining('UTR123').first);
      await t.pumpAndSettle();
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Mark as paid')));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/payments/manual-action'), 0);
      expect(inSheet('Mark as paid?'), findsOneWidget);
    });
  });
}
