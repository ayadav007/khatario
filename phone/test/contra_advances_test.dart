import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/accounting/advances_logic.dart';
import 'package:khatario_phone/screens/accounting/advances_screen.dart';
import 'package:khatario_phone/screens/accounting/contra_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/ui/form_kit.dart';

import 'support/finders.dart';
import 'support/recorded_session.dart';

const _cash = {'id': 'c1', 'code': '1101', 'name': 'Cash in hand', 'kind': 'cash'};
const _cash2 = {'id': 'c2', 'code': '1103', 'name': 'Petty cash', 'kind': 'cash'};
const _bankA = {'id': 'b1', 'code': '1102', 'name': 'HDFC Current', 'kind': 'bank'};
const _bankB = {'id': 'b2', 'code': '1105', 'name': 'SBI Savings', 'kind': 'bank'};

void main() {
  group('contra logic', () {
    test('accounts read as the server sent them and are labelled as the website labels them', () {
      final rows = contraAccounts({
        'accounts': [_cash, _bankA, {'id': '', 'name': 'no id'}],
      });
      expect(rows.length, 2);
      expect(contraAccountLabel(_cash), '1101 · Cash in hand (Cash)');
      expect(contraAccountLabel(_bankA), '1102 · HDFC Current (Bank)');
    });

    test('the kind line follows the website: deposit, withdrawal, bank transfer, cash to cash refused', () {
      expect(contraKindLabel(null, _bankA), '');
      expect(contraKindLabel(_cash, _bankA), 'Cash deposit into bank');
      expect(contraKindLabel(_bankA, _cash), 'Cash withdrawal from bank');
      expect(contraKindLabel(_bankA, _bankB), 'Bank-to-bank transfer');
      expect(contraKindLabel(_cash, _cash2), 'Cash-to-cash is not a contra entry');
    });

    test('the To list leaves out the From account', () {
      final all = [_cash, _bankA, _bankB];
      expect([for (final a in contraToChoices(all, 'b1')) a['id']], ['c1', 'b2']);
      expect(contraToChoices(all, '').length, 3);
    });

    test('posting needs two different accounts, not both cash, and an amount above zero', () {
      String? p({Map<String, dynamic>? from = _cash, Map<String, dynamic>? to = _bankA, String amount = '500'}) => contraProblem(from: from, to: to, amountText: amount);
      expect(p(), isNull);
      expect(p(from: null), isNotNull);
      expect(p(to: null), isNotNull);
      expect(p(to: _cash), isNotNull);
      expect(p(from: _cash, to: _cash2), 'Cash-to-cash is not a contra entry');
      expect(p(amount: ''), isNotNull);
      expect(p(amount: '0'), isNotNull);
      expect(p(amount: '-5'), isNotNull);
    });

    test('the body is the website one, with no identity', () {
      final body = contraBody(date: DateTime(2026, 11, 9), fromId: 'c1', toId: 'b1', amountText: '1250.50', reference: ' UTR1 ', narration: '');
      expect(body, {'entry_date': '2026-11-09', 'from_account_id': 'c1', 'to_account_id': 'b1', 'amount': 1250.5, 'reference_number': 'UTR1'});
      expectNoIdentity(body);
      expect(contraBody(date: DateTime(2026, 1, 2), fromId: 'a', toId: 'b', amountText: '10', reference: '', narration: 'Deposit')['narration'], 'Deposit');
    });

    test('a row shows the voucher, from and to, and the server amount', () {
      final v = {'voucher_number': 'CTR/2026/000001', 'from_account': 'Cash in hand', 'to_account': 'HDFC Current', 'reference_number': 'UTR1', 'amount': '1250.50'};
      expect(contraRowTitle(v), 'CTR/2026/000001');
      expect(contraRowSubtitle(v), 'Cash in hand → HDFC Current · UTR1');
      expect(contraRowTitle({}), 'Contra entry');
    });
  });

  group('advances logic', () {
    test('the list asks for one side', () {
      expect(advancesPath(AdvanceSide.received), '/api/advances?type=received');
      expect(advancesPath(AdvanceSide.paid), '/api/advances?type=paid');
    });

    test('Adjust and Refund appear only while the server says something is unadjusted', () {
      expect(advanceIsOpen({'remaining': '1180.00'}), isTrue);
      expect(advanceIsOpen({'remaining': '0.00'}), isFalse);
      expect(advanceIsOpen({'remaining': '0.004'}), isFalse);
      expect(advanceIsOpen({}), isFalse);
    });

    test('rows read the party, the voucher, the date and the status', () {
      final a = {'party_name': 'Asha Traders', 'voucher_number': 'RV/2026-27/0001', 'payment_date': '2026-11-03', 'amount': '1180.00', 'remaining': '500.00', 'status': 'partially_adjusted'};
      expect(advanceRowTitle(a), 'Asha Traders');
      expect(advanceRowSubtitle(a), 'RV/2026-27/0001 · 03 Nov 2026');
    });

    test('new advance from a customer: services carry the rate, goods carry none', () {
      final services = advanceBody(side: AdvanceSide.received, partyId: 'cu1', amountText: '1180', date: DateTime(2026, 11, 3), supplyType: 'services', taxRate: 18, accountId: 'b1', reference: ' UTR9 ', notes: '');
      expect(services, {
        'type': 'received',
        'customer_id': 'cu1',
        'amount': 1180,
        'payment_date': '2026-11-03',
        'supply_type': 'services',
        'tax_rate': 18,
        'payment_account_id': 'b1',
        'reference_number': 'UTR9',
        'notes': null,
      });
      final goods = advanceBody(side: AdvanceSide.received, partyId: 'cu1', amountText: '500', date: DateTime(2026, 11, 3), supplyType: 'goods', taxRate: 18, accountId: 'c1', reference: '', notes: 'Order 4');
      expect(goods['supply_type'], 'goods');
      expect(goods['tax_rate'], 18, reason: 'the website sends the selected rate for goods too');
      expect(goods['notes'], 'Order 4');
      expectNoIdentity(services);
    });

    test('an advance paid to a supplier names the supplier and sends the website defaults', () {
      final paid = advanceBody(side: AdvanceSide.paid, partyId: 's1', amountText: '2000.75', date: DateTime(2026, 11, 3), supplyType: 'services', taxRate: 18, accountId: 'b1', reference: '', notes: '');
      expect(paid['type'], 'paid');
      expect(paid['supplier_id'], 's1');
      expect(paid.containsKey('customer_id'), isFalse);
      expect(paid['amount'], 2000.75);
      expect(paid['supply_type'], 'services');
      expect(paid['tax_rate'], 18);
    });

    test('the new advance names the first thing missing', () {
      String? p({String party = 'p', String amount = '10', String account = 'a', AdvanceSide side = AdvanceSide.received}) => advanceProblem(side: side, partyId: party, amountText: amount, accountId: account);
      expect(p(), isNull);
      expect(p(party: ''), 'Choose a customer');
      expect(p(party: '', side: AdvanceSide.paid), 'Choose a supplier');
      expect(p(amount: '0'), 'Enter an amount above zero');
      expect(p(account: ''), 'Choose the account the money moves through');
    });

    test('adjust names the invoice for a customer advance and the bill for a supplier one', () {
      final inv = adjustBody(side: AdvanceSide.received, documentId: 'i1', amountText: '300.5', date: DateTime(2026, 11, 4));
      expect(inv, {'invoice_id': 'i1', 'amount': 300.5, 'adjustment_date': '2026-11-04'});
      final bill = adjustBody(side: AdvanceSide.paid, documentId: 'p1', amountText: '300', date: DateTime(2026, 11, 4));
      expect(bill, {'purchase_id': 'p1', 'amount': 300, 'adjustment_date': '2026-11-04'});
      expectNoIdentity(inv);
    });

    test('refund names the amount, the date and the account', () {
      final b = refundBody(amountText: '200', date: DateTime(2026, 11, 5), accountId: 'b1');
      expect(b, {'amount': 200, 'refund_date': '2026-11-05', 'payment_account_id': 'b1'});
      expectNoIdentity(b);
    });

    test('open documents become pick options with the server balance, and the amount defaults as on the website', () {
      final docs = [
        {'id': 'i1', 'number': 'INV-1', 'date': '2026-10-01', 'balance_amount': '700.00'},
        {'id': 'i2', 'number': 'INV-2', 'date': '2026-10-09', 'balance_amount': '90.50'},
      ];
      expect(advanceDocOptions(docs), [('i1', 'INV-1 · 2026-10-01 · due ₹700.00'), ('i2', 'INV-2 · 2026-10-09 · due ₹90.50')]);
      expect(adjustDefaultAmount({'remaining': '500.00'}, docs[0]), '500');
      expect(adjustDefaultAmount({'remaining': '500.00'}, docs[1]), '90.5');
      expect(adjustDefaultAmount({'remaining': '500.00'}, null), '500');
    });

    test('an adjustment line reads as the website does: against what, when, and whether it was reversed', () {
      expect(advanceAdjustmentTitle({'kind': 'invoice', 'invoice_number': 'INV-1'}), 'Adjusted against INV-1');
      expect(advanceAdjustmentTitle({'kind': 'purchase', 'bill_number': 'B-7'}), 'Adjusted against B-7');
      expect(advanceAdjustmentTitle({'kind': 'refund'}), 'Refund');
      expect(advanceAdjustmentSubtitle({'adjustment_date': '2026-11-04', 'voucher_number': 'ADJ/1', 'reversed_at': null}), '04 Nov 2026 · ADJ/1');
      expect(advanceAdjustmentSubtitle({'adjustment_date': '2026-11-04', 'reversed_at': '2026-11-05T00:00:00Z'}), '04 Nov 2026 · Reversed');
    });
  });

  group('contra screens', () {
    var listFails = 0;
    String? failCode;
    var empty = false;
    String? postRefuse;

    setUp(() {
      listFails = 0;
      failCode = null;
      empty = false;
      postRefuse = null;
    });

    Reply server(RequestOptions o, Map body) {
      if (o.method == 'GET' && o.uri.path == '/api/contra') {
        if (listFails > 0) {
          listFails--;
          return (failCode == null ? 500 : 403, {'error': 'Server is down', 'code': ?failCode});
        }
        return (
          200,
          {
            'vouchers': empty
                ? []
                : [
                    {'voucher_id': 'k1', 'voucher_number': 'CTR/2026/000001', 'entry_date': '2026-11-03', 'reference_number': 'UTR1', 'from_account': 'Cash in hand', 'to_account': 'HDFC Current', 'amount': '1250.50'},
                  ],
            'accounts': [_cash, _bankA, _bankB],
          },
        );
      }
      if (o.method == 'POST' && o.uri.path == '/api/contra') {
        if (postRefuse != null) return (400, {'error': postRefuse, 'code': 'CASH_TO_CASH'});
        return (201, {'voucher_id': 'k2', 'voucher_number': 'CTR/2026/000002', 'kind': 'cash_deposit'});
      }
      return (404, {'error': 'not found'});
    }

    Future<List<RequestOptions>> openList(WidgetTester t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ContraScreen(session: session));
      return sent;
    }

    Future<void> pick(WidgetTester t, String label, String option) async {
      await t.tap(find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first, matching: find.byType(InkWell)).first);
      await t.pumpAndSettle();
      await t.tap(find.text(option).last);
      await t.pumpAndSettle();
    }

    testWidgets('the list shows each contra with from, to and the server amount; nothing identifies the business', (t) async {
      final sent = await openList(t);
      final req = requestsOf(sent, 'GET', '/api/contra').single;
      expect(req.uri.queryParameters.containsKey('business_id'), isFalse);
      expect(find.text('CTR/2026/000001'), findsOneWidget);
      expect(find.text('Cash in hand → HDFC Current · UTR1'), findsOneWidget);
      expect(find.text('₹1,250.50'), findsOneWidget);
    });

    testWidgets('empty, server error with Try again, and plan refusal', (t) async {
      empty = true;
      await openList(t);
      expect(find.text('No contra entries yet'), findsOneWidget);

      empty = false;
      listFails = 1;
      await openList(t);
      expect(find.text('Could not load contra entries'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('CTR/2026/000001'), findsOneWidget);

      listFails = 9;
      failCode = 'FEATURE_NOT_IN_PLAN';
      await openList(t);
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('the form offers only the cash and bank accounts the server sent, and To leaves out From', (t) async {
      await openList(t);
      await t.tap(find.text('New contra'));
      await t.pumpAndSettle();
      expect(find.text('New contra entry'), findsOneWidget);
      // Open the From list.
      await t.tap(find.descendant(of: find.ancestor(of: find.text('From (money leaves)'), matching: find.byType(Column)).first, matching: find.byType(InkWell)).first);
      await t.pumpAndSettle();
      expect(inSheet('1101 · Cash in hand (Cash)'), findsOneWidget);
      expect(inSheet('1102 · HDFC Current (Bank)'), findsOneWidget);
      expect(inSheet('1105 · SBI Savings (Bank)'), findsOneWidget);
      await t.tap(find.text('1102 · HDFC Current (Bank)').last);
      await t.pumpAndSettle();
      await t.tap(find.descendant(of: find.ancestor(of: find.text('To (money arrives)'), matching: find.byType(Column)).first, matching: find.byType(InkWell)).first);
      await t.pumpAndSettle();
      expect(inSheet('1102 · HDFC Current (Bank)'), findsNothing);
      expect(inSheet('1101 · Cash in hand (Cash)'), findsOneWidget);
    });

    testWidgets('cash to cash is refused on the form, as the website refuses it', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ContraFormScreen(session: session, accounts: const [_cash, _cash2, _bankA]));
      await pick(t, 'From (money leaves)', '1101 · Cash in hand (Cash)');
      await pick(t, 'To (money arrives)', '1103 · Petty cash (Cash)');
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '500');
      await t.pumpAndSettle();
      expect(find.text('Cash-to-cash is not a contra entry'), findsOneWidget);
      await t.tap(find.text('Post contra'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/contra'), 0);
    });

    testWidgets('posting sends the website body once, then the list reloads and says so', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ContraScreen(session: session));
      await t.tap(find.text('New contra'));
      await t.pumpAndSettle();
      await pick(t, 'From (money leaves)', '1101 · Cash in hand (Cash)');
      await pick(t, 'To (money arrives)', '1102 · HDFC Current (Bank)');
      expect(find.text('Cash deposit into bank'), findsOneWidget);
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '1250.50');
      await t.enterText(textFieldLabelled('Reference (cheque / UTR)'), 'UTR2');
      await t.enterText(textFieldLabelled('Narration'), 'Day takings');
      await t.pumpAndSettle();
      final save = find.text('Post contra');
      await t.tap(save);
      await t.tap(save, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/contra'), 1);
      final body = lastBody(sent, 'POST', '/api/contra');
      expect(body['from_account_id'], 'c1');
      expect(body['to_account_id'], 'b1');
      expect(body['amount'], 1250.5);
      expect(body['reference_number'], 'UTR2');
      expect(body['narration'], 'Day takings');
      expect(body['entry_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expectNoIdentity(body);
      expect(find.byType(ContraFormScreen), findsNothing);
      expect(requestCount(sent, 'GET', '/api/contra'), 2, reason: 'reloaded');
      expect(find.text('Contra CTR/2026/000002 posted'), findsOneWidget);
    });

    testWidgets('a refused post shows the server message and keeps the form filled', (t) async {
      postRefuse = 'This accounting period is locked.';
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ContraFormScreen(session: session, accounts: const [_cash, _bankA]));
      await pick(t, 'From (money leaves)', '1101 · Cash in hand (Cash)');
      await pick(t, 'To (money arrives)', '1102 · HDFC Current (Bank)');
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '40');
      await t.pumpAndSettle();
      await t.tap(find.text('Post contra'));
      await t.pumpAndSettle();
      expect(find.text('This accounting period is locked.'), findsOneWidget);
      expect(find.text('Post contra'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/contra'), 1);
      expect(find.text('1101 · Cash in hand (Cash)'), findsOneWidget);
    });

    testWidgets('the route table opens the contra list', (t) async {
      final (session, _) = recordedSession(server);
      expect(nativeScreenFor(session, '/contra'), isA<ContraScreen>());
    });
  });

  group('advances screens', () {
    var remaining = '500.00';
    var listFails = 0;
    String? failCode;
    var empty = false;
    String? actionRefuse;
    var detailFails = 0;

    setUp(() {
      remaining = '500.00';
      listFails = 0;
      failCode = null;
      empty = false;
      actionRefuse = null;
      detailFails = 0;
    });

    Map<String, dynamic> adv({String type = 'received'}) => {
          'id': 'a1',
          'type': type,
          'voucher_number': type == 'received' ? 'RV/2026-27/0001' : 'ADVP/2026-27/0001',
          'payment_date': '2026-11-03',
          'party_name': type == 'received' ? 'Asha Traders' : 'Mohan Supplies',
          'amount': '1180.00',
          'taxable_value': '1000.00',
          'cgst': '90.00',
          'sgst': '90.00',
          'igst': '0.00',
          'cess': '0.00',
          'tax_rate': '18',
          'supply_type': 'services',
          'adjusted_amount': '680.00',
          'refunded_amount': '0.00',
          'status': 'partially_adjusted',
          'reference_number': 'UTR9',
          'notes': 'Order 4',
          'customer_id': 'cu1',
          'remaining': remaining,
        };

    Reply server(RequestOptions o, Map body) {
      final path = o.uri.path;
      if (o.method == 'GET' && path == '/api/advances') {
        if (listFails > 0) {
          listFails--;
          return (failCode == null ? 500 : 403, {'error': 'Server is down', 'code': ?failCode});
        }
        final type = o.uri.queryParameters['type'] ?? 'received';
        return (200, {'advances': empty ? [] : [adv(type: type)], 'accounts': [_cash, _bankA]});
      }
      if (o.method == 'GET' && path == '/api/advances/a1') {
        if (detailFails > 0) {
          detailFails--;
          return (500, {'error': 'Server is down'});
        }
        return (
          200,
          {
            'advance': adv(),
            'adjustments': [
              {'id': 'x1', 'kind': 'invoice', 'adjustment_date': '2026-11-04', 'amount': '680.00', 'voucher_number': 'ADJ/1', 'reversed_at': null, 'invoice_number': 'INV-7'},
            ],
            'open_documents': [
              {'id': 'i1', 'number': 'INV-1', 'date': '2026-10-01', 'grand_total': '900.00', 'balance_amount': '700.00'},
              {'id': 'i2', 'number': 'INV-2', 'date': '2026-10-09', 'grand_total': '100.00', 'balance_amount': '90.50'},
            ],
          },
        );
      }
      if (o.method == 'POST' && (path == '/api/advances/a1/adjust' || path == '/api/advances/a1/refund')) {
        if (actionRefuse != null) return (400, {'error': actionRefuse, 'code': 'EXCEEDS_ADVANCE'});
        remaining = '0.00';
        return (201, {'id': 'x2', 'voucher_number': path.endsWith('adjust') ? 'ADJ/2' : 'RF/1'});
      }
      if (o.method == 'POST' && path == '/api/advances') {
        if (actionRefuse != null) return (400, {'error': actionRefuse, 'code': 'INVALID_GST_RATE'});
        return (201, {'id': 'a2', 'voucher_number': 'RV/2026-27/0002'});
      }
      if (o.method == 'GET' && path == '/api/customers') {
        return (200, {'customers': [{'id': 'cu1', 'name': 'Asha Traders', 'phone': '9000000001'}]});
      }
      if (o.method == 'GET' && path == '/api/suppliers') {
        return (200, {'suppliers': [{'id': 's1', 'name': 'Mohan Supplies', 'phone': '9000000002'}]});
      }
      return (404, {'error': 'not found ${o.method} $path'});
    }

    Future<void> settle(WidgetTester t) async {
      await t.pump();
      await t.pump(const Duration(milliseconds: 600));
    }

    Future<List<RequestOptions>> openList(WidgetTester t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, AdvancesScreen(session: session));
      return sent;
    }

    Future<List<RequestOptions>> openDetail(WidgetTester t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, AdvancesScreen(session: session));
      await t.tap(find.text('Asha Traders'));
      await t.pumpAndSettle();
      return sent;
    }

    Future<void> pick(WidgetTester t, String label, String option) async {
      await t.tap(find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first, matching: find.byType(InkWell)).first);
      await t.pumpAndSettle();
      await t.tap(find.text(option).last);
      await t.pumpAndSettle();
    }

    testWidgets('the list shows the server figures for customer advances and asks for that side only', (t) async {
      final sent = await openList(t);
      final req = requestsOf(sent, 'GET', '/api/advances').single;
      expect(req.uri.queryParameters, {'type': 'received'});
      expect(find.text('Asha Traders'), findsOneWidget);
      expect(find.text('RV/2026-27/0001 · 03 Nov 2026'), findsOneWidget);
      expect(find.text('₹1,180'), findsOneWidget);
      expect(find.textContaining('Unadjusted ₹500'), findsOneWidget);
      expect(find.text('Partially adjusted'), findsOneWidget);
    });

    testWidgets('the other chip asks for supplier advances', (t) async {
      final sent = await openList(t);
      await t.tap(find.text('To suppliers'));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/advances').last.uri.queryParameters, {'type': 'paid'});
      expect(find.text('Mohan Supplies'), findsOneWidget);
    });

    testWidgets('empty, server error with Try again, and plan refusal', (t) async {
      empty = true;
      await openList(t);
      expect(find.text('No advances yet'), findsOneWidget);

      empty = false;
      listFails = 1;
      await openList(t);
      expect(find.text('Could not load advances'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Asha Traders'), findsOneWidget);

      listFails = 9;
      failCode = 'FEATURE_NOT_IN_PLAN';
      await openList(t);
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('a row opens the detail with the server figures, its adjustments, Adjust and Refund', (t) async {
      await openDetail(t);
      expect(find.text('RV/2026-27/0001'), findsOneWidget);
      expect(find.text('Asha Traders'), findsOneWidget);
      expect(find.text('Adjusted against INV-7'), findsOneWidget);
      expect(find.text('04 Nov 2026 · ADJ/1'), findsOneWidget);
      expect(find.text('Unadjusted'), findsOneWidget);
      expect(find.text('₹500'), findsWidgets);
      expect(find.text('Adjust'), findsOneWidget);
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      expect(inSheet('Refund'), findsOneWidget);
    });

    testWidgets('a fully used advance offers neither Adjust nor Refund', (t) async {
      remaining = '0.00';
      await openDetail(t);
      expect(find.text('Adjust'), findsNothing);
      expect(find.byTooltip('More'), findsNothing);
    });

    testWidgets('a detail that fails to load offers Try again', (t) async {
      detailFails = 1;
      await openDetail(t);
      expect(find.text('Try again'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Adjust'), findsOneWidget);
    });

    testWidgets('adjust picks from the invoices the server lists, fills the amount, posts once and reloads', (t) async {
      final sent = await openDetail(t);
      await t.tap(find.text('Adjust'));
      await settle(t);
      await t.pumpAndSettle();
      expect(find.text('Adjust advance RV/2026-27/0001'), findsOneWidget);
      expect(find.text('Unadjusted: ₹500.00'), findsOneWidget);
      await pick(t, 'Invoice', 'INV-2 · 2026-10-09 · due ₹90.50');
      expect(t.widget<TextField>(textFieldLabelled('Amount', within: KAmountField)).controller!.text, '90.5');
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '90');
      final save = find.widgetWithText(InkWell, 'Adjust').last;
      await t.tap(save);
      await t.tap(save, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/advances/a1/adjust'), 1);
      final body = lastBody(sent, 'POST', '/api/advances/a1/adjust');
      expect(body['invoice_id'], 'i2');
      expect(body['amount'], 90);
      expect(body['adjustment_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expectNoIdentity(body);
      expect(find.byType(AdvanceActionScreen), findsNothing);
      expect(requestCount(sent, 'GET', '/api/advances/a1'), 2, reason: 'detail reloaded');
      expect(find.text('Adjusted ADJ/2'), findsOneWidget);
    });

    testWidgets('adjust with no invoice chosen sends nothing', (t) async {
      final sent = await openDetail(t);
      await t.tap(find.text('Adjust'));
      await settle(t);
      await t.pumpAndSettle();
      await t.tap(find.widgetWithText(InkWell, 'Adjust').last, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/advances/a1/adjust'), 0);
    });

    testWidgets('a refused adjust shows the server message and keeps the form filled', (t) async {
      actionRefuse = 'Only ₹10.00 of this advance is unadjusted';
      final sent = await openDetail(t);
      await t.tap(find.text('Adjust'));
      await settle(t);
      await t.pumpAndSettle();
      await pick(t, 'Invoice', 'INV-1 · 2026-10-01 · due ₹700.00');
      await t.tap(find.widgetWithText(InkWell, 'Adjust').last);
      await t.pumpAndSettle();
      expect(find.text('Only ₹10.00 of this advance is unadjusted'), findsOneWidget);
      expect(find.byType(AdvanceActionScreen), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/advances/a1/adjust'), 1);
      expect(find.text('INV-1 · 2026-10-01 · due ₹700.00'), findsOneWidget);
    });

    testWidgets('refund asks first, naming the amount and the account, then posts once', (t) async {
      final sent = await openDetail(t);
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Refund'));
      await settle(t);
      await t.pumpAndSettle();
      expect(find.text('Refund advance RV/2026-27/0001'), findsOneWidget);
      await pick(t, 'Refund paid from', '1102 · HDFC Current');
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '200');
      await t.pumpAndSettle();
      await t.tap(find.text('Issue refund voucher'));
      await settle(t);
      expect(requestCount(sent, 'POST', '/api/advances/a1/refund'), 0, reason: 'asks first');
      expect(inSheet('Issue refund?'), findsOneWidget);
      expect(find.textContaining('₹200.00'), findsWidgets);
      expect(find.textContaining('1102 · HDFC Current'), findsWidgets);
      // Keeping it sends nothing.
      await t.tap(find.text('Keep it'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/advances/a1/refund'), 0);
      await t.tap(find.text('Issue refund voucher'));
      await settle(t);
      final confirm = find.descendant(of: find.byType(BottomSheet), matching: find.widgetWithText(InkWell, 'Issue refund voucher'));
      await t.tap(confirm);
      await t.tap(confirm, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/advances/a1/refund'), 1);
      final body = lastBody(sent, 'POST', '/api/advances/a1/refund');
      expect(body['amount'], 200);
      expect(body['payment_account_id'], 'b1');
      expect(body['refund_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expectNoIdentity(body);
      expect(find.byType(AdvanceActionScreen), findsNothing);
      expect(find.text('Refund voucher RF/1'), findsOneWidget);
    });

    testWidgets('a refund without an account is not sent', (t) async {
      final sent = await openDetail(t);
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Refund'));
      await settle(t);
      await t.pumpAndSettle();
      await t.tap(find.text('Issue refund voucher'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);
      expect(requestCount(sent, 'POST', '/api/advances/a1/refund'), 0);
    });

    testWidgets('a new customer advance posts the website body once and the list reloads', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, AdvancesScreen(session: session));
      await t.tap(find.text('New advance'));
      await t.pumpAndSettle();
      expect(find.text('New advance'), findsWidgets);
      // Customer from the search.
      await t.tap(find.descendant(of: find.ancestor(of: find.text('Customer'), matching: find.byType(Column)).first, matching: find.byType(InkWell)).first);
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/customers').isNotEmpty, isTrue);
      await t.tap(find.text('Asha Traders').last);
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Amount (incl. GST)', within: KAmountField), '1180');
      await pick(t, 'Received into', '1102 · HDFC Current');
      await t.enterText(textFieldLabelled('Reference (UTR / cheque)'), 'UTR9');
      final save = find.text('Issue receipt voucher');
      await t.tap(save);
      await t.tap(save, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/advances'), 1);
      final body = lastBody(sent, 'POST', '/api/advances');
      expect(body['type'], 'received');
      expect(body['customer_id'], 'cu1');
      expect(body['amount'], 1180);
      expect(body['supply_type'], 'services');
      expect(body['tax_rate'], 18);
      expect(body['payment_account_id'], 'b1');
      expect(body['reference_number'], 'UTR9');
      expectNoIdentity(body);
      expect(find.byType(AdvanceFormScreen), findsNothing);
      expect(requestCount(sent, 'GET', '/api/advances'), 2, reason: 'reloaded');
      expect(find.text('Receipt voucher RV/2026-27/0002 recorded'), findsOneWidget);
    });

    testWidgets('a supplier advance searches suppliers and names the supplier', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, AdvancesScreen(session: session));
      await t.tap(find.text('To suppliers'));
      await t.pumpAndSettle();
      await t.tap(find.text('New advance'));
      await t.pumpAndSettle();
      await t.tap(find.descendant(of: find.ancestor(of: find.text('Supplier'), matching: find.byType(Column)).first, matching: find.byType(InkWell)).first);
      await t.pumpAndSettle();
      await t.tap(find.text('Mohan Supplies').last);
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Amount (incl. GST)', within: KAmountField), '2000');
      await pick(t, 'Paid from', '1101 · Cash in hand');
      expect(find.text('Against supply of'), findsNothing, reason: 'a supplier advance has no GST boxes');
      await t.tap(find.text('Record advance paid'));
      await t.pumpAndSettle();
      final body = lastBody(sent, 'POST', '/api/advances');
      expect(body['type'], 'paid');
      expect(body['supplier_id'], 's1');
      expect(body.containsKey('customer_id'), isFalse);
      expect(body['payment_account_id'], 'c1');
    });

    testWidgets('a refused new advance shows the server message and keeps the form filled', (t) async {
      actionRefuse = 'GST rate 18% is not a notified rate';
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, AdvancesScreen(session: session));
      await t.tap(find.text('New advance'));
      await t.pumpAndSettle();
      await t.tap(find.descendant(of: find.ancestor(of: find.text('Customer'), matching: find.byType(Column)).first, matching: find.byType(InkWell)).first);
      await t.pumpAndSettle();
      await t.tap(find.text('Asha Traders').last);
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Amount (incl. GST)', within: KAmountField), '1180');
      await pick(t, 'Received into', '1102 · HDFC Current');
      await t.tap(find.text('Issue receipt voucher'));
      await t.pumpAndSettle();
      expect(find.text('GST rate 18% is not a notified rate'), findsOneWidget);
      expect(find.byType(AdvanceFormScreen), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/advances'), 1);
      expect(find.text('1102 · HDFC Current'), findsOneWidget);
    });

    testWidgets('a new advance missing its party or account names what is missing and sends nothing', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, AdvancesScreen(session: session));
      await t.tap(find.text('New advance'));
      await t.pumpAndSettle();
      await t.tap(find.text('Issue receipt voucher'));
      await t.pumpAndSettle();
      expect(find.text('Choose a customer'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/advances'), 0);
    });

    testWidgets('the route table opens the advances list', (t) async {
      final (session, _) = recordedSession(server);
      expect(nativeScreenFor(session, '/advances'), isA<AdvancesScreen>());
    });
  });
}
