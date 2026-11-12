import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/payments/payment_reconciliation_screen.dart';
import 'package:khatario_phone/screens/sales/credit_approvals_logic.dart';
import 'package:khatario_phone/screens/sales/credit_approvals_screen.dart';
import 'package:khatario_phone/screens/sales/payment_reminders_screen.dart';
import 'package:khatario_phone/screens/sales/recurring_invoices_logic.dart';
import 'package:khatario_phone/screens/sales/recurring_invoices_screen.dart';
import 'package:khatario_phone/session.dart';

import 'support/finders.dart';
import 'support/recorded_session.dart';

// -------------------------------------------------------------------------------------------
// Credit approvals
// -------------------------------------------------------------------------------------------

Map<String, dynamic> _approval({String id = 'a1', String status = 'pending', String name = 'Asha', String number = 'INV-9'}) => {
      'id': id,
      'entity_type': 'customer',
      'entity_id': 'c1',
      'reference_type': 'invoice',
      'reference_id': 'i1',
      'status': status,
      'reason': 'Big order',
      'entity_name': name,
      'reference_number': number,
      'reference_amount': '12500.00',
      'requested_by_name': 'Ravi',
    };

// -------------------------------------------------------------------------------------------
// Recurring invoices
// -------------------------------------------------------------------------------------------

Map<String, dynamic> _rec({bool active = true, bool auto = false, String? error, int interval = 1, String? end}) => {
      'id': 'r1',
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'template_invoice_number': 'INV-3',
      'frequency': 'monthly',
      'interval_value': interval,
      'start_date': '2026-10-01',
      'end_date': end,
      'next_run_date': '2026-12-01',
      'last_run_date': '2026-11-01',
      'is_active': active,
      'auto_finalize': auto,
      'last_error': error,
      'invoices_raised': 2,
    };

void main() {
  group('credit approvals logic', () {
    test('reads the pending approvals', () {
      final rows = creditApprovals([_approval(), {'no': 'id'}, 'junk']);
      expect(rows, hasLength(1));
      final a = rows.single;
      expect(a.id, 'a1');
      expect(a.title, 'Asha - Invoice INV-9');
      expect(a.amount, 12500);
      expect(a.requestedBy, 'Ravi');
      expect(a.reason, 'Big order');
      expect(a.isPending, isTrue);
      expect(creditApprovals({'a': 1}), isEmpty);
    });

    test('a purchase approval is titled Purchase', () {
      final a = creditApprovals([
        {..._approval(), 'reference_type': 'purchase', 'entity_type': 'supplier', 'entity_name': 'Mehta Traders', 'reference_number': 'PB-4'}
      ]).single;
      expect(a.title, 'Mehta Traders - Purchase PB-4');
    });

    test('approve and reject bodies carry the approval and the reason, never a person', () {
      expect(approveBody('a1'), {'approval_id': 'a1'});
      expect(rejectBody('a1', '  Over the limit  '), {'approval_id': 'a1', 'rejection_reason': 'Over the limit'});
      expectNoIdentity(approveBody('a1'));
      expectNoIdentity(rejectBody('a1', 'x'));
    });

    test('a rejection needs a reason', () {
      expect(rejectReasonError(''), 'Please provide a rejection reason');
      expect(rejectReasonError('   '), 'Please provide a rejection reason');
      expect(rejectReasonError('Over the limit'), isNull);
    });
  });

  group('credit approvals screen', () {
    testWidgets('lists the pending requests', (t) async {
      final (s, sent) = recordedSession((o, b) => (200, {'approvals': [_approval()]}));
      await pumpScreen(t, CreditApprovalsScreen(session: s));
      expect(find.text('Asha - Invoice INV-9'), findsOneWidget);
      expect(find.textContaining('12,500'), findsWidgets);
      expect(find.textContaining('Ravi'), findsWidgets);
      expect(find.textContaining('Big order'), findsWidgets);
      expect(find.text('Approve'), findsOneWidget);
      expect(find.text('Reject'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/credit-approvals/pending'), 1);
      expect(sent.first.uri.query, isEmpty, reason: 'the server scopes the list to the session');
    });

    testWidgets('empty list says so', (t) async {
      final (s, _) = recordedSession((o, b) => (200, {'approvals': <Object>[]}));
      await pumpScreen(t, CreditApprovalsScreen(session: s));
      expect(find.text('No approvals waiting'), findsOneWidget);
    });

    testWidgets('a server error offers Try again', (t) async {
      var fail = true;
      final (s, sent) = recordedSession((o, b) => fail ? (400, {'error': 'Database is down'}) : (200, {'approvals': [_approval()]}));
      await pumpScreen(t, CreditApprovalsScreen(session: s));
      expect(find.text('Database is down'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Asha - Invoice INV-9'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/credit-approvals/pending'), 2);
    });

    testWidgets('a plan without the feature shows the plan message, no retry', (t) async {
      final (s, _) = recordedSession((o, b) => (403, {'error': 'Feature not available in your plan', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, CreditApprovalsScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('Approve asks first, posts once, then reloads', (t) async {
      var pending = true;
      final (s, sent) = recordedSession((o, b) {
        if (o.method == 'POST') {
          pending = false;
          return (200, {'approval': _approval(status: 'approved')});
        }
        return (200, {'approvals': pending ? [_approval()] : <Object>[]});
      });
      await pumpScreen(t, CreditApprovalsScreen(session: s));
      await t.tap(find.text('Approve'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/credit-approvals/approve'), 0, reason: 'nothing is posted before the answer');
      expect(inSheet('Approve this credit limit override?'), findsOneWidget);
      expect(find.textContaining('Asha - Invoice INV-9'), findsWidgets);
      // A double tap on the confirm button answers once.
      final confirm = find.text('Approve request');
      await t.tap(confirm);
      await t.tap(confirm, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/credit-approvals/approve'), 1);
      expect(lastBody(sent, 'POST', '/api/credit-approvals/approve'), {'approval_id': 'a1'});
      expect(requestCount(sent, 'GET', '/api/credit-approvals/pending'), 2);
      expect(find.text('Approval granted successfully!'), findsOneWidget);
      expect(find.text('No approvals waiting'), findsOneWidget);
    });

    testWidgets('Not now on the Approve question posts nothing', (t) async {
      final (s, sent) = recordedSession((o, b) => (200, {'approvals': [_approval()]}));
      await pumpScreen(t, CreditApprovalsScreen(session: s));
      await t.tap(find.text('Approve'));
      await t.pumpAndSettle();
      await t.tap(find.text('Not now'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/credit-approvals/approve'), 0);
    });

    testWidgets('Reject needs a reason, then posts it once', (t) async {
      var pending = true;
      final (s, sent) = recordedSession((o, b) {
        if (o.method == 'POST') {
          pending = false;
          return (200, {'approval': _approval(status: 'rejected')});
        }
        return (200, {'approvals': pending ? [_approval()] : <Object>[]});
      });
      await pumpScreen(t, CreditApprovalsScreen(session: s));
      await t.tap(find.text('Reject'));
      await t.pumpAndSettle();
      expect(inSheet('Reject Credit Approval'), findsOneWidget);
      // Blank: the sheet stays, shows the website's message, and nothing is posted.
      await t.tap(find.text('Reject request'));
      await t.pumpAndSettle();
      expect(find.text('Please provide a rejection reason'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/credit-approvals/reject'), 0);
      // Spaces only is still blank.
      await t.enterText(textFieldLabelled('Reason'), '   ');
      await t.tap(find.text('Reject request'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/credit-approvals/reject'), 0);
      // A reason goes through; a double tap posts once.
      await t.enterText(textFieldLabelled('Reason'), 'Over the limit');
      await t.tap(find.text('Reject request'));
      await t.tap(find.text('Reject request'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/credit-approvals/reject'), 1);
      final body = lastBody(sent, 'POST', '/api/credit-approvals/reject');
      expect(body, {'approval_id': 'a1', 'rejection_reason': 'Over the limit'});
      expectNoIdentity(body);
      expect(find.text('Approval rejected'), findsOneWidget);
      expect(find.text('No approvals waiting'), findsOneWidget);
    });

    testWidgets('a refused approval shows the server message and leaves the card', (t) async {
      final (s, sent) = recordedSession((o, b) {
        if (o.method == 'POST') return (400, {'error': 'Approval is already approved'});
        return (200, {'approvals': [_approval()]});
      });
      await pumpScreen(t, CreditApprovalsScreen(session: s));
      await t.tap(find.text('Approve'));
      await t.pumpAndSettle();
      await t.tap(find.text('Approve request'));
      await t.pumpAndSettle();
      expect(find.text('Approval is already approved'), findsOneWidget);
      expect(find.text('Asha - Invoice INV-9'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/credit-approvals/pending'), 1);
      // The button is usable again.
      expect(find.text('Approve'), findsOneWidget);
    });
  });

  group('recurring invoices logic', () {
    test('reads the schedules', () {
      final r = recurringInvoices([_rec(active: false, error: 'Customer deleted')]).single;
      expect(r.id, 'r1');
      expect(r.customerName, 'Asha');
      expect(r.templateNumber, 'INV-3');
      expect(r.isActive, isFalse);
      expect(r.lastError, 'Customer deleted');
      expect(r.invoicesRaised, 2);
      expect(recurringInvoices('nope'), isEmpty);
    });

    test('schedule, next run and mode read like the website', () {
      expect(recurringSchedule(recurringInvoices([_rec()]).single), 'Monthly');
      expect(recurringSchedule(recurringInvoices([_rec(interval: 3, end: '2027-03-01')]).single), 'Every 3 × Monthly until 2027-03-01');
      expect(recurringFrequencyLabel('half_yearly'), 'Half-yearly');
      expect(recurringFrequencyLabel('odd'), 'odd');
      expect(recurringNextRun(recurringInvoices([_rec()]).single), '01 Dec 2026');
      expect(recurringNextRun(recurringInvoices([_rec(active: false)]).single), 'Paused');
      expect(kRecurringFrequencies.map((f) => f.$1), ['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly']);
    });

    test('pause, resume, mode and run now bodies', () {
      expect(recurringActiveBody(false), {'is_active': false});
      expect(recurringActiveBody(true), {'is_active': true});
      expect(recurringModeBody(true), {'auto_finalize': true});
      expect(runNowBody(), {'action': 'run_now'});
      for (final b in [recurringActiveBody(false), recurringModeBody(true), runNowBody()]) {
        expectNoIdentity(b);
      }
    });

    test('create body copies the website and names no person', () {
      final body = recurringCreateBody(
        customerId: 'c1',
        templateInvoiceId: 'i3',
        frequency: 'monthly',
        interval: 2,
        start: DateTime(2026, 12, 1),
        end: null,
        autoFinalize: true,
        notes: '  Rent  ',
      );
      expect(body, {
        'customer_id': 'c1',
        'template_invoice_id': 'i3',
        'frequency': 'monthly',
        'interval_value': 2,
        'start_date': '2026-12-01',
        'end_date': null,
        'auto_finalize': true,
        'notes': 'Rent',
        'items': <Object>[],
      });
      expectNoIdentity(body);
      expect(recurringCreateBody(customerId: 'c', templateInvoiceId: 't', frequency: 'daily', interval: 1, start: DateTime(2026, 1, 2), end: DateTime(2026, 2, 3), autoFinalize: false, notes: '')['end_date'], '2026-02-03');
      expect(recurringCreateBody(customerId: 'c', templateInvoiceId: 't', frequency: 'daily', interval: 1, start: DateTime(2026, 1, 2), end: null, autoFinalize: false, notes: '')['notes'], isNull);
    });

    test('Every must be a whole number from 1 to 36', () {
      expect(recurringIntervalError('1'), isNull);
      expect(recurringIntervalError('36'), isNull);
      expect(recurringIntervalError('0'), isNotNull);
      expect(recurringIntervalError('37'), isNotNull);
      expect(recurringIntervalError('1.5'), isNotNull);
      expect(recurringIntervalError(''), isNotNull);
    });

    test('run now message', () {
      expect(runNowMessage({'created': [{'invoice_number': 'INV-10'}]}), 'Raised 1 invoice: INV-10');
      expect(runNowMessage({'created': [{'invoice_number': 'INV-10'}, {'invoice_number': 'INV-11'}]}), 'Raised 2 invoices: INV-10, INV-11');
      expect(runNowMessage({'message': 'Nothing due today', 'created': <Object>[]}), 'Nothing due today');
      expect(runNowMessage({}), 'Nothing due today');
    });

    test('run history rows', () {
      final h = runHistory([
        {'run_date': '2026-11-01', 'status': 'success', 'invoice_number': 'INV-10', 'error_message': null},
        {'run_date': '2026-10-01', 'status': 'failed', 'invoice_number': null, 'error_message': 'No stock'},
      ]);
      expect(h, hasLength(2));
      expect(h[0].invoiceNumber, 'INV-10');
      expect(h[1].error, 'No stock');
    });
  });

  group('recurring invoices screen', () {
    late List<Map<String, dynamic>> rows;
    late Map<String, dynamic> detail;
    late List<Map<String, dynamic>> history;
    Reply Function(RequestOptions o, Map b)? patch;
    Reply Function(RequestOptions o, Map b)? post;

    setUp(() {
      rows = [_rec()];
      detail = _rec();
      history = [
        {'run_date': '2026-11-01', 'status': 'success', 'error_message': null, 'invoice_id': 'i10', 'invoice_number': 'INV-10', 'invoice_status': 'draft'},
      ];
      patch = null;
      post = null;
    });

    (AppSession, List<RequestOptions>) server() => recordedSession((o, b) {
          final p = o.uri.path;
          if (p == '/api/recurring-invoices' && o.method == 'GET') return (200, {'recurringInvoices': rows});
          if (p == '/api/recurring-invoices' && o.method == 'POST') return (post ?? (o, b) => (201, {'recurringInvoice': {'id': 'rN'}}))(o, b);
          if (p == '/api/recurring-invoices/r1' && o.method == 'GET') return (200, {'recurringInvoice': detail, 'history': history});
          if (p == '/api/recurring-invoices/r1' && o.method == 'PATCH') {
            return (patch ??
                (o, b) {
                  rows = [
                    {...rows.first, ...b}
                  ];
                  detail = {...detail, ...b};
                  return (200, {'recurringInvoice': rows.first});
                })(o, b);
          }
          if (p == '/api/recurring-invoices/r1' && o.method == 'POST') {
            return (post ??
                (o, b) => (200, {'recurring_id': 'r1', 'created': [{'invoice_id': 'i10', 'invoice_number': 'INV-10'}]}))(o, b);
          }
          if (p == '/api/customers') return (200, {'customers': [{'id': 'c1', 'name': 'Asha', 'phone': '9876543210'}]});
          if (p == '/api/invoices') {
            return (200, {'invoices': [{'id': 'i3', 'invoice_number': 'INV-3', 'invoice_date': '2026-10-01', 'customer_id': 'c1', 'grand_total': 1180}]});
          }
          return (200, <String, dynamic>{});
        });

    testWidgets('lists the schedules with their state', (t) async {
      rows = [_rec(error: 'Customer inactive'), {..._rec(active: false), 'id': 'r2', 'customer_name': 'Bina'}];
      final (s, sent) = server();
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      expect(find.text('Asha'), findsOneWidget);
      expect(find.textContaining('INV-3'), findsWidgets);
      expect(find.text('Monthly'), findsWidgets);
      expect(find.textContaining('01 Dec 2026'), findsOneWidget);
      expect(find.textContaining('Paused'), findsOneWidget);
      expect(find.text('Customer inactive'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/recurring-invoices'), 1);
      expect(sent.first.uri.query, isEmpty);
    });

    testWidgets('empty, error and plan states', (t) async {
      rows = [];
      var (s, _) = server();
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      expect(find.text('No recurring invoices yet'), findsOneWidget);

      (s, _) = recordedSession((o, b) => (400, {'error': 'Failed to fetch recurring invoices'}));
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      expect(find.text('Failed to fetch recurring invoices'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);

      (s, _) = recordedSession((o, b) => (403, {'error': 'Not in plan', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('Pause sends is_active false once and reloads; Resume sends true', (t) async {
      final gate = Completer<void>();
      final (s, sent) = recordedSession((o, b) async {
        final p = o.uri.path;
        if (p == '/api/recurring-invoices/r1' && o.method == 'PATCH') {
          await gate.future;
          rows = [
            {...rows.first, ...b}
          ];
          return (200, {'recurringInvoice': rows.first});
        }
        return (200, {'recurringInvoices': rows});
      });
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      await t.tap(find.text('Pause'));
      await t.pump();
      await t.tap(find.text('Pause'), warnIfMissed: false);
      await t.pump();
      gate.complete();
      await t.pumpAndSettle();
      expect(requestCount(sent, 'PATCH', '/api/recurring-invoices/r1'), 1, reason: 'a double tap changes it once');
      final body = lastBody(sent, 'PATCH', '/api/recurring-invoices/r1');
      expect(body, {'is_active': false});
      expectNoIdentity(body);
      expect(requestCount(sent, 'GET', '/api/recurring-invoices'), 2);
      expect(find.text('Resume'), findsOneWidget);
      expect(find.textContaining('Paused'), findsOneWidget);

      await t.tap(find.text('Resume'));
      await t.pumpAndSettle();
      expect(lastBody(sent, 'PATCH', '/api/recurring-invoices/r1'), {'is_active': true});
      expect(find.text('Pause'), findsOneWidget);
    });

    testWidgets('a refused pause shows the server message and changes nothing', (t) async {
      patch = (o, b) => (403, {'error': 'You cannot change invoices'});
      final (s, sent) = server();
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      await t.tap(find.text('Pause'));
      await t.pumpAndSettle();
      expect(find.text('You cannot change invoices'), findsOneWidget);
      expect(find.text('Pause'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/recurring-invoices'), 1);
    });

    testWidgets('Run now asks, posts run_now once, names the invoices raised', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      await t.tap(find.text('Run now'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/recurring-invoices/r1'), 0);
      expect(inSheet('Raise invoices now?'), findsOneWidget);
      await t.tap(find.text('Raise invoices'));
      await t.tap(find.text('Raise invoices'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/recurring-invoices/r1'), 1);
      final body = lastBody(sent, 'POST', '/api/recurring-invoices/r1');
      expect(body, {'action': 'run_now'});
      expectNoIdentity(body);
      expect(find.text('Raised 1 invoice: INV-10'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/recurring-invoices'), 2);
    });

    testWidgets('Run now with nothing due says so; a paused schedule cannot run', (t) async {
      post = (o, b) => (200, {'message': 'Nothing due today', 'created': <Object>[]});
      final (s, _) = server();
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      await t.tap(find.text('Run now'));
      await t.pumpAndSettle();
      await t.tap(find.text('Raise invoices'));
      await t.pumpAndSettle();
      expect(find.text('Nothing due today'), findsOneWidget);

      rows = [_rec(active: false)];
      final (s2, sent2) = server();
      await pumpScreen(t, RecurringInvoicesScreen(session: s2));
      await t.tap(find.text('Run now'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent2, 'POST', '/api/recurring-invoices/r1'), 0);
    });

    testWidgets('a refused run shows the server message', (t) async {
      post = (o, b) => (400, {'error': 'Template invoice was deleted', 'created': <Object>[]});
      final (s, sent) = server();
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      await t.tap(find.text('Run now'));
      await t.pumpAndSettle();
      await t.tap(find.text('Raise invoices'));
      await t.pumpAndSettle();
      expect(find.text('Template invoice was deleted'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/recurring-invoices'), 1);
    });

    testWidgets('a row opens the detail with the run history and the same actions', (t) async {
      final (s, sent) = server();
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      await t.tap(find.text('Asha'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'GET', '/api/recurring-invoices/r1'), 1);
      expect(find.text('Run history'), findsOneWidget);
      expect(find.text('INV-10'), findsOneWidget);
      expect(find.text('Success'), findsOneWidget);
      // Mode toggle sends auto_finalize.
      await t.tap(find.text('Finalise automatically'));
      await t.pumpAndSettle();
      expect(lastBody(sent, 'PATCH', '/api/recurring-invoices/r1'), {'auto_finalize': true});
      // Pause from the detail.
      await t.tap(find.text('Pause'));
      await t.pumpAndSettle();
      expect(lastBody(sent, 'PATCH', '/api/recurring-invoices/r1'), {'is_active': false});
      expect(find.text('Resume'), findsOneWidget);
    });

    testWidgets('the new schedule form posts the website body without any person', (t) async {
      rows = [];
      final (s, sent) = server();
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      await t.tap(find.byIcon(LucideIcons.plus));
      await t.pumpAndSettle();
      expect(find.text('New recurring invoice'), findsOneWidget);
      // The invoice to copy waits for a customer.
      expect(find.text('Copy lines from invoice'), findsNothing);
      await t.tap(find.text('Select').first);
      await t.pumpAndSettle();
      await t.tap(find.text('Asha').last);
      await t.pumpAndSettle();
      expect(find.text('Copy lines from invoice'), findsOneWidget);
      await t.tap(find.text('Select').first);
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/invoices').last.uri.queryParameters['customer_id'], 'c1');
      expect(requestsOf(sent, 'GET', '/api/invoices').last.uri.queryParameters['status'], 'final');
      await t.tap(find.text('INV-3').last);
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Notes'), 'Shop rent');
      await t.tap(find.text('Finalise automatically'));
      await t.pumpAndSettle();
      await t.tap(find.text('Schedule'));
      await t.tap(find.text('Schedule'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/recurring-invoices'), 1);
      final body = lastBody(sent, 'POST', '/api/recurring-invoices');
      expect(body['customer_id'], 'c1');
      expect(body['template_invoice_id'], 'i3');
      expect(body['frequency'], 'monthly');
      expect(body['interval_value'], 1);
      expect(body['auto_finalize'], true);
      expect(body['notes'], 'Shop rent');
      expect(body['end_date'], isNull);
      expect(body['items'], isEmpty);
      expect((body['start_date'] as String), matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expectNoIdentity(body);
      expect(find.text('Recurring invoice scheduled'), findsOneWidget);
      expect(find.text('Schedule'), findsNothing, reason: 'the form closed');
    });

    testWidgets('Schedule waits for a customer and an invoice to copy', (t) async {
      rows = [];
      final (s, sent) = server();
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      await t.tap(find.byIcon(LucideIcons.plus));
      await t.pumpAndSettle();
      await t.tap(find.text('Schedule'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/recurring-invoices'), 0);
    });

    testWidgets('a refused schedule keeps the form and shows the server message', (t) async {
      rows = [];
      post = (o, b) => (403, {'error': 'Feature not available in your plan', 'code': 'FEATURE_NOT_IN_PLAN'});
      final (s, sent) = server();
      await pumpScreen(t, RecurringInvoicesScreen(session: s));
      await t.tap(find.byIcon(LucideIcons.plus));
      await t.pumpAndSettle();
      await t.tap(find.text('Select').first);
      await t.pumpAndSettle();
      await t.tap(find.text('Asha').last);
      await t.pumpAndSettle();
      await t.tap(find.text('Select').first);
      await t.pumpAndSettle();
      await t.tap(find.text('INV-3').last);
      await t.pumpAndSettle();
      await t.tap(find.text('Schedule'));
      await t.pumpAndSettle();
      expect(find.text('Feature not available in your plan'), findsOneWidget);
      expect(find.text('New recurring invoice'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/recurring-invoices'), 1);
    });
  });

  group('routes', () {
    final s = AppSession(KhatarioApi(Dio()), {'user': {'id': 'u'}, 'business': {'id': 'b'}});

    test('all six links open their own screens', () {
      expect(nativeScreenFor(s, '/credit-approvals'), isA<CreditApprovalsScreen>());
      expect(nativeScreenFor(s, '/recurring-invoices'), isA<RecurringInvoicesScreen>());
      expect(nativeScreenFor(s, '/invoices/recurring'), isA<RecurringInvoicesScreen>());
      expect(nativeScreenFor(s, '/payments/reminders'), isA<PaymentRemindersScreen>());
      expect(nativeScreenFor(s, '/whatsapp/reminders'), isA<PaymentRemindersScreen>());
      expect(nativeScreenFor(s, '/payments/reconciliation'), isA<PaymentReconciliationScreen>());
    });

    test('each one has a native screen', () {
      for (final h in ['/credit-approvals', '/recurring-invoices', '/invoices/recurring', '/payments/reminders', '/whatsapp/reminders', '/payments/reconciliation']) {
        expect(routeTier(s, h), RouteTier.native, reason: h);
      }
    });
  });
}
