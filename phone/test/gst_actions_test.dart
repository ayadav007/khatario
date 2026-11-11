import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/reports/gst_cash_ledger_screen.dart';
import 'package:khatario_phone/screens/reports/gst_reports.dart';
import 'package:khatario_phone/screens/reports/gstr2b_screen.dart';
import 'package:khatario_phone/screens/reports/report_period.dart';
import 'package:khatario_phone/ui/form_kit.dart';

import 'support/finders.dart';
import 'support/gst_server.dart';

const _cash = '/api/gst/cash-ledger';
const _alerts = '/api/gst/compliance-alerts';
const _reconcile = '/api/gst/gstr2b/reconcile';
const _recon13 = '/api/reports/gst/reconciliation';

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
  final today = '${now.year}-${_two(now.month)}-${_two(now.day)}';

  group('GST cash ledger', () {
    Object? server(RequestOptions o, {Map<String, GstReply>? post}) {
      if (o.method == 'POST') return post?[o.uri.path] ?? {'success': true};
      return o.uri.path == _cash ? gstFixture('gst_cash_ledger') : <String, dynamic>{};
    }

    testWidgets('loads as_on_date with consolidated when there is no branch, never a business id', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstCashLedgerScreen(session: s));
      final q = gstCalls(sent, 'GET', _cash).single.uri.queryParameters;
      expect(q, {'as_on_date': today, 'consolidated': '1'});
    });

    testWidgets('a user with one branch loads that branch', (t) async {
      final (s, sent) = gstSession(server, raw: {
        'user': {'id': 'u'},
        'business': {'id': 'b'},
        'branches': [
          {'id': 'br-1', 'is_active': true},
        ],
      });
      await _open(t, GstCashLedgerScreen(session: s));
      final q = gstCalls(sent, 'GET', _cash).single.uri.queryParameters;
      expect(q, {'as_on_date': today, 'branch_id': 'br-1'});
    });

    testWidgets('shows each head balance, its liability, pooled RCM and the statement from the server', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, GstCashLedgerScreen(session: s));
      expect(find.text('IGST cash'), findsOneWidget);
      expect(find.text('₹5,000'), findsWidgets);
      expect(find.text('Output liability 2150: ₹3,600'), findsOneWidget);
      expect(find.text('RCM 2157: ₹180'), findsOneWidget);
      expect(find.textContaining('Pooled RCM liability 2155: ₹0'), findsOneWidget);
      expect(find.text('Statement'), findsOneWidget);
      expect(find.textContaining('CH-778'), findsOneWidget);
      expect(find.text('Cash utilisation'), findsOneWidget);
    });

    testWidgets('an empty statement says so', (t) async {
      final (s, _) = gstSession((o) => {...gstFixture('gst_cash_ledger'), 'statement': []});
      await _open(t, GstCashLedgerScreen(session: s));
      expect(find.text('No cash ledger lines up to this date.'), findsOneWidget);
    });

    testWidgets('Deposit asks first with the amount, head and date, posts once, then loads again', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.text('Deposit'));
      await t.pumpAndSettle();
      expect(find.text('Deposit to cash ledger'), findsOneWidget);
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '1500');
      await t.pump();
      await t.enterText(textFieldLabelled('Challan number'), 'CH-901');
      await t.pump();
      await t.tap(find.text('Review deposit'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('Deposit ₹1,500 to the IGST cash ledger'), findsOneWidget);
      expect(find.textContaining('does not reduce'), findsOneWidget);
      expect(gstCalls(sent, 'POST', '$_cash/deposit'), isEmpty);
      await t.tap(find.text('Deposit now'));
      await t.pumpAndSettle();
      final posts = gstCalls(sent, 'POST', '$_cash/deposit');
      expect(posts, hasLength(1));
      expect(posts.single.data, {'payment_date': today, 'tax_head': 'IGST', 'amount': 1500, 'challan_number': 'CH-901'});
      expect(gstCalls(sent, 'GET', _cash), hasLength(2));
      expect(find.text('Deposit to cash ledger'), findsNothing);
    });

    testWidgets('a branch user posts into the branch the ledger shows', (t) async {
      final (s, sent) = gstSession(server, raw: {
        'user': {'id': 'u'},
        'business': {'id': 'b'},
        'branches': [
          {'id': 'br-1', 'is_active': true},
        ],
      });
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.text('Deposit'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '10');
      await t.pump();
      await t.tap(find.text('Review deposit'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Deposit now'));
      await t.pumpAndSettle();
      expect(gstCalls(sent, 'POST', '$_cash/deposit').single.data, {'payment_date': today, 'tax_head': 'IGST', 'amount': 10, 'branch_id': 'br-1'});
    });

    testWidgets('Not now on the question posts nothing and keeps the form', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.text('Deposit'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '1500');
      await t.pump();
      await t.tap(find.text('Review deposit'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Not now'));
      await t.pumpAndSettle();
      expect(gstCalls(sent, 'POST', '$_cash/deposit'), isEmpty);
      expect(find.text('Deposit to cash ledger'), findsOneWidget);
    });

    testWidgets('a deposit needs an amount', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.text('Deposit'));
      await t.pumpAndSettle();
      await t.tap(find.text('Review deposit'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(gstCalls(sent, 'POST', '$_cash/deposit'), isEmpty);
      expect(find.text('Deposit now'), findsNothing);
    });

    testWidgets('a refused deposit shows the server message and keeps the form with its fields', (t) async {
      final (s, sent) = gstSession((o) => server(o, post: {'$_cash/deposit': const GstReply({'error': 'The period is locked for GST filing'}, status: 400)}));
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.text('Deposit'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '1500');
      await t.pump();
      await t.tap(find.text('Review deposit'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Deposit now'));
      await t.pumpAndSettle();
      expect(find.text('The period is locked for GST filing'), findsOneWidget);
      expect(find.text('Deposit to cash ledger'), findsOneWidget);
      expect(t.widget<TextField>(textFieldLabelled('Amount', within: KAmountField)).controller!.text, '1500');
      expect(gstCalls(sent, 'GET', _cash), hasLength(1));
    });

    testWidgets('Utilise posts the head and amount after asking', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.text('Utilise'));
      await t.pumpAndSettle();
      expect(find.text('Utilise cash ledger'), findsOneWidget);
      expect(find.textContaining('Available ₹5,000'), findsOneWidget);
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '1000');
      await t.pump();
      await t.tap(find.text('Review utilisation'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('Utilise ₹1,000 from the IGST cash ledger against IGST liability'), findsOneWidget);
      await t.tap(find.text('Utilise now'));
      await t.pumpAndSettle();
      final posts = gstCalls(sent, 'POST', '$_cash/utilize');
      expect(posts, hasLength(1));
      expect(posts.single.data, {'payment_date': today, 'tax_head': 'IGST', 'amount': 1000});
      expect(gstCalls(sent, 'GET', _cash), hasLength(2));
    });

    testWidgets('an amount over the available cash blocks the utilisation', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.text('Utilise'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '9000');
      await t.pump();
      await t.pump();
      expect(find.text('Amount is greater than the available cash balance'), findsOneWidget);
      await t.tap(find.text('Review utilisation'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(find.text('Utilise now'), findsNothing);
      expect(gstCalls(sent, 'POST', '$_cash/utilize'), isEmpty);
    });

    testWidgets('a refused utilisation shows the server message', (t) async {
      final (s, _) = gstSession((o) => server(o, post: {'$_cash/utilize': const GstReply({'error': 'Amount exceeds the cash balance'}, status: 400)}));
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.text('Utilise'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '1000');
      await t.pump();
      await t.tap(find.text('Review utilisation'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Utilise now'));
      await t.pumpAndSettle();
      expect(find.text('Amount exceeds the cash balance'), findsOneWidget);
      expect(find.text('Utilise cash ledger'), findsOneWidget);
    });

    testWidgets('a deposit that is not yet reversed can be reversed with a reason, once', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.textContaining('CH-778'));
      await t.pumpAndSettle();
      await t.tap(find.text('Reverse entry'));
      await t.pumpAndSettle();
      expect(find.textContaining('Reverse the deposit of ₹5,000'), findsOneWidget);
      await t.enterText(find.byType(TextField), 'Wrong challan');
      await t.pump();
      await t.tap(find.text('Reverse'));
      await t.pumpAndSettle();
      final posts = gstCalls(sent, 'POST', '$_cash/reverse');
      expect(posts, hasLength(1));
      expect(posts.single.data, {
        'voucher_id': 'a0000000-0000-4000-8000-000000000001',
        'voucher_type': 'gst_cash_deposit',
        'reason': 'Wrong challan',
        'entry_date': today,
      });
      expect(gstCalls(sent, 'GET', _cash), hasLength(2));
    });

    testWidgets('a reversal needs a reason', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.textContaining('CH-778'));
      await t.pumpAndSettle();
      await t.tap(find.text('Reverse entry'));
      await t.pumpAndSettle();
      await t.tap(find.text('Reverse'));
      await t.pumpAndSettle();
      expect(find.text('Give a reason for the reversal'), findsOneWidget);
      expect(gstCalls(sent, 'POST', '$_cash/reverse'), isEmpty);
    });

    testWidgets('an entry that was already reversed offers no reversal', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.textContaining('Reversal: wrong head'));
      await t.pumpAndSettle();
      expect(find.text('Reverse entry'), findsNothing);
      expect(gstCalls(sent, 'POST', '$_cash/reverse'), isEmpty);
    });

    final multi = {
      'user': {'id': 'u'},
      'business': {'id': 'b'},
      'isPrimaryAdmin': true,
      'branches': [
        {'id': 'br-1', 'name': 'Pune', 'is_active': true},
        {'id': 'br-2', 'name': 'Mumbai', 'is_active': true},
      ],
    };

    testWidgets('an owner with several branches sees every branch first and cannot post until one is chosen, as on the website', (t) async {
      final (s, sent) = gstSession(server, raw: multi);
      await _open(t, GstCashLedgerScreen(session: s));
      expect(gstCalls(sent, 'GET', _cash).single.uri.queryParameters, {'as_on_date': today, 'consolidated': '1'});
      expect(find.text('All branches'), findsOneWidget);
      expect(find.text('Showing every branch. Select one branch to deposit or utilise.'), findsOneWidget);
      await t.tap(find.text('Deposit'));
      await t.pumpAndSettle();
      expect(find.text('Select a branch before posting'), findsOneWidget);
      expect(find.text('Deposit to cash ledger'), findsNothing);
      expect(sent.where((o) => o.method != 'GET'), isEmpty);
    });

    testWidgets('choosing a branch reloads that branch and posts into it', (t) async {
      final (s, sent) = gstSession(server, raw: multi);
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.text('All branches'));
      await t.pumpAndSettle();
      await t.tap(find.text('Pune'));
      await t.pumpAndSettle();
      expect(gstCalls(sent, 'GET', _cash).last.uri.queryParameters, {'as_on_date': today, 'branch_id': 'br-1'});
      await t.tap(find.text('Deposit'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '25');
      await t.pump();
      await t.tap(find.text('Review deposit'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Deposit now'));
      await t.pumpAndSettle();
      expect(gstCalls(sent, 'POST', '$_cash/deposit').single.data, {'payment_date': today, 'tax_head': 'IGST', 'amount': 25, 'branch_id': 'br-1'});
    });

    testWidgets('a reversal while every branch shows is blocked with the same message', (t) async {
      final (s, sent) = gstSession(server, raw: multi);
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.textContaining('CH-778'));
      await t.pumpAndSettle();
      await t.tap(find.text('Reverse entry'));
      await t.pumpAndSettle();
      expect(find.text('Select a branch before posting'), findsOneWidget);
      expect(gstCalls(sent, 'POST', '$_cash/reverse'), isEmpty);
    });

    testWidgets('a default branch that is not in the branch list falls back to every branch', (t) async {
      final (s, sent) = gstSession(server, raw: {
        'user': {'id': 'u'},
        'business': {'id': 'b'},
        'branches': [
          {'id': '', 'name': 'Ghost', 'is_active': true},
          {'id': 'br-2', 'name': 'Mumbai', 'is_active': true},
          {'id': 'br-3', 'name': 'Delhi', 'is_active': true},
        ],
      });
      await _open(t, GstCashLedgerScreen(session: s));
      expect(find.text('All branches'), findsOneWidget);
      expect(gstCalls(sent, 'GET', _cash).single.uri.queryParameters, {'as_on_date': today, 'consolidated': '1'});
      await t.tap(find.text('Deposit'));
      await t.pumpAndSettle();
      expect(find.text('Select a branch before posting'), findsOneWidget);
    });

    testWidgets('a user with one branch has no branch picker', (t) async {
      final (s, _) = gstSession(server, raw: {
        'user': {'id': 'u'},
        'business': {'id': 'b'},
        'branches': [
          {'id': 'br-1', 'name': 'Pune', 'is_active': true},
        ],
      });
      await _open(t, GstCashLedgerScreen(session: s));
      expect(find.text('Branch'), findsNothing);
    });

    testWidgets('a refused reversal shows the server message', (t) async {
      final (s, _) = gstSession((o) => server(o, post: {'$_cash/reverse': const GstReply({'error': 'Reversing this deposit would make the cash ledger negative'}, status: 400)}));
      await _open(t, GstCashLedgerScreen(session: s));
      await t.tap(find.textContaining('CH-778'));
      await t.pumpAndSettle();
      await t.tap(find.text('Reverse entry'));
      await t.pumpAndSettle();
      await t.enterText(find.byType(TextField), 'Oops');
      await t.pump();
      await t.tap(find.text('Reverse'));
      await t.pumpAndSettle();
      expect(find.text('Reversing this deposit would make the cash ledger negative'), findsOneWidget);
    });
  });

  group('GST alerts', () {
    Object? server(RequestOptions o, {Map<String, GstReply>? post}) {
      if (o.method == 'POST') return post?[o.uri.path] ?? {'success': true};
      return o.uri.path == _alerts ? gstFixture('gst_compliance_alerts') : <String, dynamic>{};
    }

    testWidgets('loads once with no query and shows the counts and active alerts', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstAlertsScreen(session: s));
      expect(gstCalls(sent, 'GET', _alerts).single.uri.query, isEmpty);
      expect(find.text('Act now'), findsOneWidget);
      expect(find.text('Due soon'), findsOneWidget);
      expect(find.text('3 supplier bills unpaid for over 180 days'), findsOneWidget);
      expect(find.text('₹8,200'), findsWidgets);
      expect(find.text('Active (2)'), findsOneWidget);
      expect(find.text('Resolved this FY (1)'), findsOneWidget);
      expect(find.text('Dismissed (1)'), findsOneWidget);
    });

    testWidgets('the Dismissed and Resolved tabs list their alerts', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, GstAlertsScreen(session: s));
      await t.tap(find.text('Dismissed (1)'));
      await t.pumpAndSettle();
      expect(find.text('E-invoicing may apply from next year'), findsOneWidget);
      await t.tap(find.text('Resolved this FY (1)'));
      await t.pumpAndSettle();
      expect(find.text('One invoice over 50,000 has no e-way bill'), findsOneWidget);
    });

    testWidgets('an alert opens its rule, message and the action link', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, GstAlertsScreen(session: s));
      await t.tap(find.text('3 supplier bills unpaid for over 180 days'));
      await t.pumpAndSettle();
      expect(find.text('ITC on these bills must be reversed under Rule 37.'), findsOneWidget);
      expect(find.text('Rule 37 of the CGST Rules'), findsOneWidget);
      expect(find.text('Open GSTR-3B'), findsOneWidget);
      expect(find.text('Dismiss alert'), findsOneWidget);
    });

    testWidgets('Dismiss asks for a reason naming the alert, posts once, then loads again', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstAlertsScreen(session: s));
      await t.tap(find.text('3 supplier bills unpaid for over 180 days'));
      await t.pumpAndSettle();
      await t.tap(find.text('Dismiss alert'));
      await t.pumpAndSettle();
      expect(find.textContaining('Dismiss "3 supplier bills unpaid'), findsOneWidget);
      expect(gstCalls(sent, 'POST', _alerts), isEmpty);
      await t.enterText(find.byType(TextField), 'CA will reverse it');
      await t.pump();
      await t.tap(find.text('Dismiss').last);
      await t.pumpAndSettle();
      final posts = gstCalls(sent, 'POST', _alerts);
      expect(posts, hasLength(1));
      expect(posts.single.data, {'alert_id': '11111111-1111-4111-8111-111111111111', 'action': 'dismiss', 'reason': 'CA will reverse it'});
      expect(gstCalls(sent, 'GET', _alerts), hasLength(2));
    });

    testWidgets('a reason under three characters posts nothing', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstAlertsScreen(session: s));
      await t.tap(find.text('3 supplier bills unpaid for over 180 days'));
      await t.pumpAndSettle();
      await t.tap(find.text('Dismiss alert'));
      await t.pumpAndSettle();
      await t.enterText(find.byType(TextField), 'ok');
      await t.pump();
      await t.tap(find.text('Dismiss').last);
      await t.pumpAndSettle();
      expect(find.text('Give a reason for dismissing this alert (3 to 300 characters)'), findsOneWidget);
      expect(gstCalls(sent, 'POST', _alerts), isEmpty);
    });

    testWidgets('a refused dismissal shows the server message and leaves the list', (t) async {
      final (s, sent) = gstSession((o) => server(o, post: {_alerts: const GstReply({'error': 'Alert not found'}, status: 404)}));
      await _open(t, GstAlertsScreen(session: s));
      await t.tap(find.text('3 supplier bills unpaid for over 180 days'));
      await t.pumpAndSettle();
      await t.tap(find.text('Dismiss alert'));
      await t.pumpAndSettle();
      await t.enterText(find.byType(TextField), 'CA will reverse it');
      await t.pump();
      await t.tap(find.text('Dismiss').last);
      await t.pumpAndSettle();
      expect(find.text('Alert not found'), findsOneWidget);
      expect(find.text('3 supplier bills unpaid for over 180 days'), findsOneWidget);
      expect(gstCalls(sent, 'GET', _alerts), hasLength(1));
    });

    testWidgets('Restore asks first and posts the alert id with restore', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, GstAlertsScreen(session: s));
      await t.tap(find.text('Dismissed (1)'));
      await t.pumpAndSettle();
      await t.tap(find.text('E-invoicing may apply from next year'));
      await t.pumpAndSettle();
      expect(find.text('CA is handling it'), findsOneWidget);
      await t.tap(find.text('Restore alert'));
      await t.pumpAndSettle();
      expect(find.textContaining('Show "E-invoicing may apply from next year" in the active list again?'), findsOneWidget);
      expect(gstCalls(sent, 'POST', _alerts), isEmpty);
      await t.tap(find.text('Yes, restore'));
      await t.pumpAndSettle();
      final posts = gstCalls(sent, 'POST', _alerts);
      expect(posts, hasLength(1));
      expect(posts.single.data, {'alert_id': '33333333-3333-4333-8333-333333333333', 'action': 'restore'});
    });

    testWidgets('a business with no GSTIN is told why there are no checks', (t) async {
      final (s, _) = gstSession((o) => {'alerts': [], 'dismissed': [], 'resolved': [], 'checked_at': null, 'skipped': 'no_gstin'});
      await _open(t, GstAlertsScreen(session: s));
      expect(find.textContaining('registered under GST'), findsOneWidget);
    });
  });

  group('GSTR-2B reconciliation', () {
    Object? server(RequestOptions o) => o.uri.path == _reconcile ? gstFixture('gstr2b_reconcile') : <String, dynamic>{};

    testWidgets('sends filing_period only: the business is the session', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, Gstr2bReconciliationScreen(session: s));
      final q = gstCalls(sent, 'GET', _reconcile).single.uri.queryParameters;
      expect(q, {'filing_period': '${now.year}-${_two(now.month)}'});
    });

    testWidgets('the 2B file import stays on the website and nothing posts on open', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, Gstr2bReconciliationScreen(session: s));
      expect(find.text('Import 2B file on the website'), findsOneWidget);
      expect(find.text('Run reconciliation on the website'), findsNothing);
      expect(sent.where((o) => o.method != 'GET'), isEmpty);
    });

    final period = '${now.year}-${_two(now.month)}';

    testWidgets('Run reconciliation asks with the period, posts only filing_period once, then loads again', (t) async {
      final (s, sent) = gstSession((o) => o.method == 'POST' ? {'success': true, 'total_invoices': 4, 'missing_references': []} : server(o));
      await _open(t, Gstr2bReconciliationScreen(session: s));
      await t.tap(find.text('Run reconciliation'));
      await t.pumpAndSettle();
      expect(find.text('Run reconciliation?'), findsOneWidget);
      expect(find.textContaining('for $period'), findsOneWidget);
      expect(gstCalls(sent, 'POST', _reconcile), isEmpty);
      await t.tap(find.text('Run now'));
      await t.pumpAndSettle();
      final posts = gstCalls(sent, 'POST', _reconcile);
      expect(posts, hasLength(1));
      expect(posts.single.data, {'filing_period': period});
      expect(gstCalls(sent, 'GET', _reconcile), hasLength(2));
      expect(find.textContaining('4 invoices processed'), findsOneWidget);
    });

    testWidgets('Not now on Run reconciliation posts nothing', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, Gstr2bReconciliationScreen(session: s));
      await t.tap(find.text('Run reconciliation'));
      await t.pumpAndSettle();
      await t.tap(find.text('Not now'));
      await t.pumpAndSettle();
      expect(gstCalls(sent, 'POST', _reconcile), isEmpty);
    });

    testWidgets('a refused run shows the server message and does not reload', (t) async {
      final (s, sent) = gstSession((o) => o.method == 'POST' ? const GstReply({'error': 'Failed to run reconciliation'}, status: 400) : server(o));
      await _open(t, Gstr2bReconciliationScreen(session: s));
      await t.tap(find.text('Run reconciliation'));
      await t.pumpAndSettle();
      await t.tap(find.text('Run now'));
      await t.pumpAndSettle();
      expect(find.text('Failed to run reconciliation'), findsOneWidget);
      expect(gstCalls(sent, 'GET', _reconcile), hasLength(1));
    });

    Future<void> openDecision(WidgetTester t, String invoice, String button) async {
      await t.tap(find.text(invoice));
      await t.pumpAndSettle();
      await t.tap(find.text(button));
      await t.pumpAndSettle();
    }

    testWidgets('an eligible decision asks naming the line and amount, posts the website fields once and reloads', (t) async {
      final (s, sent) = gstSession((o) => o.method == 'POST' ? {'success': true} : server(o));
      await _open(t, Gstr2bReconciliationScreen(session: s));
      await openDecision(t, 'BILL-2026-0020', 'Record decision');
      expect(find.text('Record ITC decision'), findsOneWidget);
      await t.tap(find.text('Pending Supplier Correction'));
      await t.pumpAndSettle();
      await t.tap(find.text('ITC Eligible This Period'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Eligible ITC amount', within: KAmountField), '450');
      await t.pump();
      await t.enterText(textFieldLabelled('Remarks'), 'Supplier confirmed');
      await t.pump();
      await t.tap(find.text('Review decision'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('ITC Eligible This Period'), findsWidgets);
      expect(find.textContaining('BILL-2026-0020'), findsWidgets);
      expect(find.textContaining('₹450'), findsWidgets);
      expect(find.textContaining(period), findsWidgets);
      expect(gstCalls(sent, 'POST', '/api/gst/gstr2b/decision'), isEmpty);
      await t.tap(find.text('Yes, record it'));
      await t.pumpAndSettle();
      final posts = gstCalls(sent, 'POST', '/api/gst/gstr2b/decision');
      expect(posts, hasLength(1));
      expect(posts.single.data, {
        'reconciliation_id': 'c0000000-0000-4000-8000-000000000003',
        'decision': 'ITC_ELIGIBLE_THIS_PERIOD',
        'remarks': 'Supplier confirmed',
        'eligible_itc_amount': 450,
      });
      expect(gstCalls(sent, 'GET', _reconcile), hasLength(2));
    });

    testWidgets('a deferred decision sends the period it is deferred to', (t) async {
      final (s, sent) = gstSession((o) => o.method == 'POST' ? {'success': true} : server(o));
      await _open(t, Gstr2bReconciliationScreen(session: s));
      await openDecision(t, 'BILL-2026-0020', 'Record decision');
      await t.tap(find.text('Pending Supplier Correction'));
      await t.pumpAndSettle();
      await t.tap(find.text('ITC Deferred to Future'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Defer to period (YYYY-MM)'), '2026-12');
      await t.pump();
      await t.tap(find.text('Review decision'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Yes, record it'));
      await t.pumpAndSettle();
      expect(gstCalls(sent, 'POST', '/api/gst/gstr2b/decision').single.data, {
        'reconciliation_id': 'c0000000-0000-4000-8000-000000000003',
        'decision': 'ITC_DEFERRED_TO_FUTURE',
        'deferred_to_period': '2026-12',
      });
    });

    testWidgets('a deferral period that is not YYYY-MM cannot be reviewed', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, Gstr2bReconciliationScreen(session: s));
      await openDecision(t, 'BILL-2026-0020', 'Record decision');
      await t.tap(find.text('Pending Supplier Correction'));
      await t.pumpAndSettle();
      await t.tap(find.text('ITC Deferred to Future'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Defer to period (YYYY-MM)'), 'December');
      await t.pump();
      await t.tap(find.text('Review decision'));
      await t.pumpAndSettle();
      expect(find.text('Yes, record it'), findsNothing);
      expect(gstCalls(sent, 'POST', '/api/gst/gstr2b/decision'), isEmpty);
    });

    testWidgets('the decision form asks before discarding edits and not when nothing changed', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, Gstr2bReconciliationScreen(session: s));
      await openDecision(t, 'BILL-2026-0020', 'Record decision');
      await t.tap(find.bySemanticsLabel('Back'));
      await t.pumpAndSettle();
      expect(find.text('Record ITC decision'), findsNothing);
      await t.tap(find.text('BILL-2026-0020'));
      await t.pumpAndSettle();
      await t.tap(find.text('Record decision'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Remarks'), 'changed');
      await t.pump();
      await t.tap(find.bySemanticsLabel('Back'));
      await t.pumpAndSettle();
      expect(find.text('Discard changes?'), findsOneWidget);
      await t.tap(find.text('Keep editing'));
      await t.pumpAndSettle();
      expect(find.text('Record ITC decision'), findsOneWidget);
    });

    testWidgets('no invoices says to import on the website, then run reconciliation', (t) async {
      final (s, _) = gstSession((o) => {'filing_period': '2026-11', 'summary': {}, 'missing_references': [], 'invoices': []});
      await _open(t, Gstr2bReconciliationScreen(session: s));
      expect(find.text('Import GSTR-2B data on the website, then run reconciliation.'), findsOneWidget);
    });

    testWidgets('an existing decision opens filled in and a refusal keeps the form', (t) async {
      final (s, sent) = gstSession((o) => o.method == 'POST' ? const GstReply({'error': 'Failed to record decision'}, status: 500) : server(o));
      await _open(t, Gstr2bReconciliationScreen(session: s));
      await openDecision(t, 'SUP-554', 'Update decision');
      expect(find.text('ITC Deferred to Future'), findsOneWidget);
      expect(t.widget<TextField>(textFieldLabelled('Defer to period (YYYY-MM)')).controller!.text, '2026-12');
      await t.tap(find.text('Review decision'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Yes, record it'));
      await t.pumpAndSettle();
      expect(find.text('Failed to record decision'), findsOneWidget);
      expect(find.text('Record ITC decision'), findsOneWidget);
      expect(gstCalls(sent, 'POST', '/api/gst/gstr2b/decision'), hasLength(1));
      expect(gstCalls(sent, 'GET', _reconcile), hasLength(1));
    });

    testWidgets('shows the server counts and ITC per status', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, Gstr2bReconciliationScreen(session: s));
      expect(find.text('Matched'), findsWidgets);
      expect(find.text('3'), findsWidgets);
      expect(find.text('ITC ₹1,620'), findsOneWidget);
      expect(find.text('Missing in 2B'), findsWidgets);
      expect(find.text('ITC ₹270'), findsOneWidget);
      expect(find.text('1 document left out of matching'), findsOneWidget);
    });

    testWidgets('lists every invoice, a status chip filters them', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, Gstr2bReconciliationScreen(session: s));
      for (final n in ['BILL-2026-0018', 'SUP-554', 'BILL-2026-0020', 'GJ-77']) {
        expect(find.text(n), findsOneWidget, reason: n);
      }
      await t.ensureVisible(find.text('Only in 2B (1)'));
      await t.pumpAndSettle();
      await t.tap(find.text('Only in 2B (1)'));
      await t.pumpAndSettle();
      expect(find.text('GJ-77'), findsOneWidget);
      expect(find.text('SUP-554'), findsNothing);
    });

    testWidgets('an invoice opens the books and 2B figures, the server differences and its decision', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, Gstr2bReconciliationScreen(session: s));
      await t.tap(find.text('SUP-554'));
      await t.pumpAndSettle();
      expect(find.text('29AABCU9603R1ZM'), findsOneWidget);
      expect(find.textContaining('ITC deferred to future'), findsWidgets);
      expect(find.text('Supplier will correct'), findsOneWidget);
      expect(find.text('Update decision'), findsOneWidget);
      expect(find.text('₹900'), findsWidgets);
      expect(find.text('₹810'), findsWidgets);
      expect(find.text('₹90'), findsWidgets);
    });

    testWidgets('the month bar reloads the filing period', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, Gstr2bReconciliationScreen(session: s));
      await t.tap(find.bySemanticsLabel('Previous month'));
      await t.pumpAndSettle();
      final prev = MonthPeriod.of(now).previous;
      expect(gstCalls(sent, 'GET', _reconcile).last.uri.queryParameters['filing_period'], '${prev.year}-${_two(prev.month)}');
    });
  });

  group('GSTR-1 vs 3B', () {
    Object? server(RequestOptions o) => o.uri.path == _recon13 ? gstFixture('gst_reconciliation') : <String, dynamic>{};

    testWidgets('sends period as YYYY-MM and the comparison mode', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, Gstr13bReconciliationScreen(session: s));
      final q = gstCalls(sent, 'GET', _recon13).single.uri.queryParameters;
      expect(q, {'period': '${now.year}-${_two(now.month)}', 'mode': 'live_vs_live'});
    });

    testWidgets('shows the status, totals, head-wise figures, counts, exceptions and warnings from the server', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, Gstr13bReconciliationScreen(session: s));
      expect(find.text('Mismatch'), findsWidgets);
      expect(find.text('₹18,000'), findsWidgets);
      expect(find.text('₹17,600'), findsWidgets);
      expect(find.text('₹400'), findsWidgets);
      expect(find.text('CGST'), findsWidgets);
      expect(find.text('₹7,000'), findsWidgets);
      expect(find.text('Vouchers compared'), findsOneWidget);
      expect(find.text('9'), findsOneWidget);
      expect(find.text('INV-2026-0042: GSTR-1 tax 1800 against ledger 1600'), findsOneWidget);
      expect(find.text('Tax mismatch'), findsOneWidget);
      expect(find.text('Missing invoice'), findsOneWidget);
      expect(find.text('Filed GSTR-1 snapshot is older than the books.'), findsOneWidget);
      expect(find.text('3B nets credit notes inside 3.1(a).'), findsOneWidget);
    });

    testWidgets('a comparison mode chip reloads with that mode', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, Gstr13bReconciliationScreen(session: s));
      await t.tap(find.text('Filed vs Live'));
      await t.pumpAndSettle();
      final calls = gstCalls(sent, 'GET', _recon13);
      expect(calls, hasLength(2));
      expect(calls.last.uri.queryParameters['mode'], 'filed_vs_live');
    });
  });
}
