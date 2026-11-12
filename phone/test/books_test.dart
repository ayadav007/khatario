import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/accounting/account_form_screen.dart';
import 'package:khatario_phone/screens/accounting/account_ledger_screen.dart';
import 'package:khatario_phone/screens/accounting/accounts_screen.dart';
import 'package:khatario_phone/screens/accounting/books_logic.dart';
import 'package:khatario_phone/screens/accounting/ledger_screen.dart';
import 'package:khatario_phone/screens/invoices/invoice_detail_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/reports/report_period.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/finders.dart';
import 'support/recorded_session.dart';

const rupee = '₹';

Finder _icon(String label) => find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == label);

void main() {
  group('books logic', () {
    test('next account code follows the website: the next free number in the type range', () {
      expect(suggestNextAccountCode(['1001', '1002', '4001'], 'asset'), '1003');
      expect(suggestNextAccountCode([], 'expense'), '5001');
      expect(suggestNextAccountCode(['2005', 'abc'], 'liability'), '2006');
      expect(suggestNextAccountCode(['3001'], 'capital'), '3002');
      expect(suggestNextAccountCode(['4010'], 'income'), '4011');
    });

    test('nature follows the type', () {
      expect(natureForAccountType('asset'), 'debit');
      expect(natureForAccountType('expense'), 'debit');
      expect(natureForAccountType('liability'), 'credit');
      expect(natureForAccountType('income'), 'credit');
      expect(natureForAccountType('capital'), 'credit');
      expect(natureForAccountType('weird'), isNull);
    });

    test('create body is the website one and carries no identity', () {
      final body = accountCreateBody(
        code: '',
        suggestedCode: '5004',
        name: '  Electricity  ',
        type: 'expense',
        groupId: 'g1',
        parentId: null,
        openingText: '1500.50',
        openingType: 'debit',
      );
      expect(body, {
        'account_code': '5004',
        'account_name': 'Electricity',
        'account_type': 'expense',
        'account_group_id': 'g1',
        'nature': 'debit',
        'opening_balance': 1500.5,
        'opening_balance_type': 'debit',
        'parent_account_id': null,
        'description': null,
        'sort_order': 0,
        'pl_section': null,
      });
      expect(accountCreateBody(code: ' 7000 ', suggestedCode: '5004', name: 'x', type: 'asset', groupId: 'g', parentId: 'p', openingText: '', openingType: 'credit')['account_code'], '7000');
      expect(accountCreateBody(code: '', suggestedCode: '1', name: 'x', type: 'asset', groupId: 'g', parentId: 'p', openingText: '', openingType: 'credit')['parent_account_id'], 'p');
      for (final k in forbiddenIdentityKeys) {
        expect(body.containsKey(k), isFalse);
      }
    });

    test('create check names the first problem, as the website does', () {
      String? check({String name = 'A', String group = 'g', String code = '1', String opening = '0', bool sub = false, String parent = ''}) =>
          accountCreateProblem(name: name, groupId: group, code: code, openingText: opening, subAccount: sub, parentId: parent);
      expect(check(), isNull);
      expect(check(name: ' '), 'Account name is required');
      expect(check(group: ''), 'Choose an account type');
      expect(check(code: ''), isNotNull);
      expect(check(sub: true), 'Choose the parent account');
      expect(check(opening: '-5'), 'Opening balance must be zero or a positive amount.');
      expect(check(opening: 'abc'), 'Opening balance must be zero or a positive amount.');
    });

    test('edit sends only what changed; opening amount and side go together', () {
      final old = {
        'id': 'a1',
        'account_code': '5001',
        'account_name': 'Rent',
        'parent_account_id': null,
        'description': 'Shop rent',
        'is_active': true,
        'opening_balance': '1000.00',
        'opening_balance_type': 'debit',
      };
      Map<String, dynamic> changes({String code = '5001', String name = 'Rent', String parent = '', String opening = '1000', String side = 'debit', String description = 'Shop rent', bool active = true}) =>
          accountEditChanges(old, code: code, name: name, parentId: parent, openingText: opening, openingType: side, description: description, active: active);
      expect(changes(), isEmpty);
      expect(changes(name: ' Office rent '), {'account_name': 'Office rent'});
      expect(changes(parent: 'p9', description: '', active: false), {'parent_account_id': 'p9', 'description': null, 'is_active': false});
      expect(changes(opening: '1200'), {'opening_balance': 1200, 'opening_balance_type': 'debit'});
      expect(changes(side: 'credit'), {'opening_balance': 1000, 'opening_balance_type': 'credit'});
    });

    test('system accounts are those the server marks is_system; they get no edit or deactivate', () {
      expect(accountIsSystem({'is_system': true}), isTrue);
      expect(accountIsSystem({'is_system': false}), isFalse);
      expect(accountIsSystem({}), isFalse);
      expect(accountCanEdit({'is_system': true, 'is_active': true}), isFalse);
      expect(accountCanEdit({'is_system': false}), isTrue);
      expect(accountCanDeactivate({'is_system': false, 'is_active': true}), isTrue);
      expect(accountCanDeactivate({'is_system': false, 'is_active': false}), isFalse);
      expect(accountCanDeactivate({'is_system': true, 'is_active': true}), isFalse);
    });

    test('accounts group under their account group in group-code order, filtered by type and words', () {
      final groups = [
        {'id': 'g2', 'group_code': '1200', 'group_name': 'Bank'},
        {'id': 'g1', 'group_code': '1100', 'group_name': 'Cash'},
        {'id': 'g3', 'group_code': '5100', 'group_name': 'Rates'},
      ];
      final accounts = [
        {'id': 'a1', 'account_code': '1001', 'account_name': 'Till', 'account_type': 'asset', 'account_group_id': 'g1'},
        {'id': 'a2', 'account_code': '1002', 'account_name': 'HDFC', 'account_type': 'asset', 'account_group_id': 'g2'},
        {'id': 'a3', 'account_code': '5001', 'account_name': 'Rent', 'account_type': 'expense', 'account_group_id': 'g3'},
        {'id': 'a4', 'account_code': '5002', 'account_name': 'Lost', 'account_type': 'expense', 'account_group_id': 'gX', 'account_group_name': 'Other'},
      ];
      final all = accountSections(accounts, groups);
      expect(all.map((s) => s.name), ['Cash', 'Bank', 'Rates', 'Other']);
      expect(all.first.rows.single['id'], 'a1');
      expect(accountSections(accounts, groups, type: 'expense').map((s) => s.name), ['Rates', 'Other']);
      expect(accountSections(accounts, groups, query: 'hdfc').single.rows.single['id'], 'a2');
      expect(accountSections(accounts, groups, query: 'cash').single.rows.single['id'], 'a1', reason: 'the group name matches too');
      expect(accountSections(accounts, groups, query: '5002').single.rows.single['id'], 'a4');
    });

    test('balances come from the server rows and are never added up', () {
      final b = accountBalances({
        'accounts': [
          {'id': 'a1', 'closing': 1200.5, 'balance_side': 'Dr', 'has_activity': true},
          {'id': 'a2', 'closing': '300', 'balance_side': 'Cr', 'has_activity': true},
          {'id': 'a3', 'closing': 0, 'balance_side': null, 'has_activity': false},
        ],
      });
      expect(sidedBalance(b['a1']), 'Dr ${rupee}1,200.50');
      expect(sidedBalance(b['a2']), 'Cr ${rupee}300.00');
      expect(sidedBalance(b['a3']), '${rupee}0.00');
      expect(sidedBalance(null), '');
    });

    test('a ledger figure is shown on the side the account nature gives it', () {
      expect(natureSidedAmount(1200, 'debit'), 'Dr ${rupee}1,200.00');
      expect(natureSidedAmount(-50, 'debit'), 'Cr ${rupee}50.00');
      expect(natureSidedAmount(75, 'credit'), 'Cr ${rupee}75.00');
      expect(natureSidedAmount(-75, 'credit'), 'Dr ${rupee}75.00');
      expect(natureSidedAmount(0, 'credit'), '${rupee}0.00');
    });

    test('the ledger routes read from_date and to_date (and not from/to)', () {
      final p = ReportPeriod('custom', DateTime(2026, 4, 1), DateTime(2026, 11, 10));
      expect(accountLedgerPath('a1', p), '/api/ledger/account/a1?from_date=2026-04-01&to_date=2026-11-10');
      expect(accountStatementPdfPath('a1', p), '/api/ledger/account/a1/statement/pdf?from_date=2026-04-01&to_date=2026-11-10');
      expect(ledgerPath(p, page: 1), '/api/ledger?from_date=2026-04-01&to_date=2026-11-10&page=1');
      expect(ledgerPath(p, accountId: 'a1', voucherType: 'invoice', page: 2), '/api/ledger?from_date=2026-04-01&to_date=2026-11-10&account_id=a1&voucher_type=invoice&page=2');
    });

    test('which source screen a ledger row opens', () {
      expect(ledgerSourceOf({'voucher_type': 'invoice', 'voucher_id': 'i1'}), LedgerSource.invoice);
      expect(ledgerSourceOf({'voucher_type': 'purchase', 'voucher_id': 'p1'}), LedgerSource.purchase);
      expect(ledgerSourceOf({'voucher_type': 'payment', 'voucher_id': 'y1'}), LedgerSource.payment);
      expect(ledgerSourceOf({'voucher_type': 'journal', 'voucher_id': 'j1'}), LedgerSource.journal);
      expect(ledgerSourceOf({'voucher_type': 'expense', 'voucher_id': 'e1'}), LedgerSource.none);
      expect(ledgerSourceOf({'voucher_type': 'invoice', 'voucher_id': ''}), LedgerSource.none);
      expect(ledgerSourceOf({'voucher_type': 'invoice'}), LedgerSource.none);
    });

    test('voucher words are the website ones', () {
      expect(voucherLabel('opening_balance'), 'Opening balance');
      expect(voucherLabel('gst_setoff'), 'GST set-off');
      expect(voucherLabel('some_new_kind'), 'some new kind');
      expect(voucherLabel(null), '');
    });
  });

  group('chart of accounts', () {
    testWidgets('accounts load grouped, with the server balances and no arithmetic', (t) async {
      final (_, sent) = await _open(t, _Srv(), (s) => AccountsScreen(session: s));
      expect(find.text('Cash'), findsOneWidget);
      expect(find.text('Direct Expenses'), findsOneWidget);
      expect(find.text('Cash in hand'), findsOneWidget);
      expect(find.text('Petty cash'), findsOneWidget);
      expect(find.text('Dr ${rupee}12,500.50'), findsOneWidget);
      expect(find.text('Dr ${rupee}4,000.00'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/accounts'), 1);
      expect(requestCount(sent, 'GET', '/api/accounts/groups'), 1);
      final list = requestsOf(sent, 'GET', '/api/accounts').single;
      expect(list.uri.queryParameters.containsKey('page'), isFalse, reason: 'no paging parameters: the route then returns every account');
      expect(list.uri.queryParameters.containsKey('limit'), isFalse);
      for (final o in sent) {
        for (final k in forbiddenIdentityKeys) {
          expect(o.uri.queryParameters.containsKey(k), isFalse);
        }
      }
    });

    testWidgets('a failing balances route leaves the accounts without balances', (t) async {
      final srv = _Srv()..balancesReply = (500, {'error': 'boom'});
      await _open(t, srv, (s) => AccountsScreen(session: s));
      expect(find.text('Rent'), findsOneWidget);
      expect(find.textContaining('Dr $rupee'), findsNothing);
    });

    testWidgets('search and type filter narrow the list', (t) async {
      await _open(t, _Srv(), (s) => AccountsScreen(session: s));
      await t.enterText(find.byType(TextField).first, 'rent');
      await t.pumpAndSettle();
      expect(find.text('Rent'), findsOneWidget);
      expect(find.text('Petty cash'), findsNothing);
      await t.enterText(find.byType(TextField).first, '');
      await t.tap(find.text('Assets'));
      await t.pumpAndSettle();
      expect(find.text('Rent'), findsNothing);
      expect(find.text('Petty cash'), findsOneWidget);
    });

    testWidgets('system accounts offer no actions; the others do', (t) async {
      await _open(t, _Srv(), (s) => AccountsScreen(session: s));
      expect(_icon('Actions for Cash in hand'), findsNothing);
      expect(_icon('Actions for Petty cash'), findsOneWidget);
      expect(_icon('Actions for Rent'), findsOneWidget);
      expect(find.text('System'), findsOneWidget);
    });

    testWidgets('deactivate asks first; cancelling sends nothing, confirming sends is_active false once', (t) async {
      final srv = _Srv();
      final (_, sent) = await _open(t, srv, (s) => AccountsScreen(session: s));
      await t.tap(_icon('Actions for Rent'));
      await _sheetUp(t);
      await t.tap(inSheet('Deactivate'));
      await _sheetUp(t);
      expect(find.text('This account will be deactivated. Existing transactions will remain intact.'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/accounts/a3'), 0);
      await t.tap(find.widgetWithText(KButton, 'Cancel'));
      await _sheetUp(t);
      expect(requestCount(sent, 'PATCH', '/api/accounts/a3'), 0);

      await t.tap(_icon('Actions for Rent'));
      await _sheetUp(t);
      await t.tap(inSheet('Deactivate'));
      await _sheetUp(t);
      await t.tap(find.widgetWithText(KButton, 'Deactivate'));
      await t.tap(find.widgetWithText(KButton, 'Deactivate'), warnIfMissed: false);
      await t.pumpAndSettle();
      final patches = requestsOf(sent, 'PATCH', '/api/accounts/a3').toList();
      expect(patches, hasLength(1));
      expect(patches.single.data, {'is_active': false});
      expect(requestCount(sent, 'GET', '/api/accounts'), 2, reason: 'the list reloads after a deactivation');
    });

    testWidgets("a refused deactivation shows the server's words and leaves the list", (t) async {
      final srv = _Srv()..patchReply = (400, {'error': 'Customers post to this account, so it cannot be deactivated.'});
      await _open(t, srv, (s) => AccountsScreen(session: s));
      await t.tap(_icon('Actions for Rent'));
      await _sheetUp(t);
      await t.tap(inSheet('Deactivate'));
      await _sheetUp(t);
      await t.tap(find.widgetWithText(KButton, 'Deactivate'));
      await t.pumpAndSettle();
      expect(find.text('Customers post to this account, so it cannot be deactivated.'), findsOneWidget);
      expect(find.text('Rent'), findsOneWidget);
    });

    testWidgets('empty, error with Try again, and plan refusal are each handled', (t) async {
      await _open(t, _Srv()..accounts = [], (s) => AccountsScreen(session: s));
      expect(find.text('No accounts yet'), findsOneWidget);

      final bad = _Srv()..listReply = (500, {'error': 'Server is down'});
      final (_, sent) = await _open(t, bad, (s) => AccountsScreen(session: s));
      expect(find.text('Server is down'), findsOneWidget);
      bad.listReply = null;
      await t.tap(find.widgetWithText(KButton, 'Try again'));
      await t.pumpAndSettle();
      expect(find.text('Rent'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/accounts'), 2);

      final gated = _Srv()..listReply = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'});
      await _open(t, gated, (s) => AccountsScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('tapping an account opens its ledger', (t) async {
      final srv = _Srv();
      final (_, sent) = await _open(t, srv, (s) => AccountsScreen(session: s));
      await t.tap(find.text('Petty cash'));
      await t.pumpAndSettle();
      expect(find.byType(AccountLedgerScreen), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/ledger/account/a2'), 1);
    });
  });

  group('account form', () {
    Future<(AppSession, List<RequestOptions>)> add(WidgetTester t, _Srv srv) => _launch(t, srv, (s) => AccountFormScreen(session: s));

    testWidgets('the website checks come first and send nothing', (t) async {
      final (_, sent) = await add(t, _Srv());
      await t.tap(find.widgetWithText(KButton, 'Save'));
      await t.pumpAndSettle();
      expect(find.text('Account name is required'), findsOneWidget);
      await t.enterText(textFieldLabelled('Account name'), 'Electricity');
      await t.tap(find.widgetWithText(KButton, 'Save'));
      await t.pumpAndSettle();
      expect(find.text('Choose an account type'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/accounts'), 0);
    });

    testWidgets('add posts the website body once; a refusal keeps the form and a retry posts again', (t) async {
      final srv = _Srv()..postReply = (409, {'error': 'Account code already exists'});
      final (_, sent) = await add(t, srv);
      await _chooseGroup(t, '5100 Direct Expenses');
      expect(find.textContaining('Suggested 5002'), findsWidgets, reason: 'the next free expense code after 5001');
      await t.enterText(textFieldLabelled('Account name'), 'Electricity');
      await t.enterText(find.descendant(of: find.ancestor(of: find.text('Opening balance'), matching: find.byType(KAmountField)), matching: find.byType(TextField)), '250.5');
      await t.tap(find.widgetWithText(KButton, 'Save'));
      await t.tap(find.widgetWithText(KButton, 'Save'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/accounts'), 1);
      final body = lastBody(sent, 'POST', '/api/accounts');
      expect(body['account_code'], '5002');
      expect(body['account_name'], 'Electricity');
      expect(body['account_type'], 'expense');
      expect(body['account_group_id'], 'g2');
      expect(body['nature'], 'debit');
      expect(body['opening_balance'], 250.5);
      expect(body['opening_balance_type'], 'debit');
      expect(body['parent_account_id'], isNull);
      expectNoIdentity(body);
      expect(find.text('Account code already exists'), findsOneWidget);
      expect(find.byType(AccountFormScreen), findsOneWidget, reason: 'the form stays open');
      expect(find.text('Electricity'), findsOneWidget, reason: 'and stays filled');

      srv.postReply = null;
      await t.tap(find.widgetWithText(KButton, 'Save'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/accounts'), 2);
    });

    testWidgets('a sub-account needs its parent and sends it', (t) async {
      final (_, sent) = await add(t, _Srv());
      await _chooseGroup(t, '5100 Direct Expenses');
      await t.enterText(textFieldLabelled('Account name'), 'Shop rent');
      await t.tap(find.text('Make this a sub-account'));
      await t.pumpAndSettle();
      await t.tap(find.widgetWithText(KButton, 'Save'));
      await t.pumpAndSettle();
      expect(find.text('Choose the parent account'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/accounts'), 0);
      await t.tap(find.byWidgetPredicate((w) => w is KPickField && w.label == 'Parent account'));
      await _sheetUp(t);
      expect(inSheet('5001 Rent'), findsOneWidget);
      expect(inSheet('1002 Petty cash'), findsNothing, reason: 'only accounts of the same type');
      await t.tap(inSheet('5001 Rent'));
      await t.pumpAndSettle();
      await t.tap(find.widgetWithText(KButton, 'Save'));
      await t.pumpAndSettle();
      expect(lastBody(sent, 'POST', '/api/accounts')['parent_account_id'], 'a3');
    });

    testWidgets('a saved account closes the form with true', (t) async {
      final srv = _Srv();
      final (s, sent) = srv.build();
      Object? result = 'unset';
      await pumpScreen(
        t,
        Builder(builder: (ctx) => Center(child: KButton(label: 'Open', onPressed: () async => result = await Navigator.of(ctx).push(MaterialPageRoute<bool>(builder: (_) => AccountFormScreen(session: s)))))),
      );
      await t.tap(find.text('Open'));
      await t.pumpAndSettle();
      await _chooseGroup(t, '5100 Direct Expenses');
      await t.enterText(textFieldLabelled('Account name'), 'Tea');
      await t.tap(find.widgetWithText(KButton, 'Save'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/accounts'), 1);
      expect(result, true);
    });

    testWidgets('edit sends only the changed field; nothing changed sends nothing', (t) async {
      final srv = _Srv();
      final (_, sent) = await _launch(t, srv, (s) => AccountFormScreen(session: s, accountId: 'a3'));
      expect(requestCount(sent, 'GET', '/api/accounts/a3'), 1);
      expect(find.text('Edit account'), findsOneWidget);
      expect(find.text('Rent'), findsWidgets);
      await t.enterText(textFieldLabelled('Account name'), 'Office rent');
      await t.tap(find.widgetWithText(KButton, 'Save changes'));
      await t.pumpAndSettle();
      final patches = requestsOf(sent, 'PATCH', '/api/accounts/a3').toList();
      expect(patches, hasLength(1));
      expect(patches.single.data, {'account_name': 'Office rent'});

      final (_, sent2) = await _launch(t, _Srv(), (s) => AccountFormScreen(session: s, accountId: 'a3'));
      await t.tap(find.widgetWithText(KButton, 'Save changes'));
      await t.pumpAndSettle();
      expect(requestCount(sent2, 'PATCH', '/api/accounts/a3'), 0);
    });

    testWidgets('a refused edit keeps the form filled', (t) async {
      final srv = _Srv()..patchReply = (400, {'error': 'Cannot change account code for account with transactions'});
      await _open(t, srv, (s) => AccountFormScreen(session: s, accountId: 'a3'));
      await t.enterText(textFieldLabelled('Account code'), '5009');
      await t.tap(find.widgetWithText(KButton, 'Save changes'));
      await t.pumpAndSettle();
      expect(find.text('Cannot change account code for account with transactions'), findsOneWidget);
      expect(find.text('5009'), findsOneWidget);
    });

    testWidgets('a failing load says so and retries', (t) async {
      final srv = _Srv()..oneReply = (500, {'error': 'Could not read it'});
      final (_, sent) = await _open(t, srv, (s) => AccountFormScreen(session: s, accountId: 'a3'));
      expect(find.text('Could not read it'), findsOneWidget);
      srv.oneReply = null;
      await t.tap(find.widgetWithText(KButton, 'Try again'));
      await t.pumpAndSettle();
      expect(find.text('Edit account'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/accounts/a3'), 2);
    });
  });

  group('account ledger', () {
    Future<(AppSession, List<RequestOptions>)> open(WidgetTester t, _Srv srv, {PdfOpener? openPdf}) =>
        _open(t, srv, (s) => AccountLedgerScreen(session: s, accountId: 'a2', accountName: 'Petty cash', openPdf: openPdf));

    testWidgets('sends from_date and to_date and shows the server opening, closing and running balances', (t) async {
      final (_, sent) = await open(t, _Srv());
      final o = requestsOf(sent, 'GET', '/api/ledger/account/a2').single;
      final fy = ReportPeriod.of('this_fy');
      expect(o.uri.queryParameters['from_date'], fy.fromIso);
      expect(o.uri.queryParameters['to_date'], fy.toIso);
      expect(o.uri.queryParameters.containsKey('from'), isFalse);
      expect(o.uri.queryParameters.containsKey('business_id'), isFalse);
      expect(find.text('Opening balance'), findsOneWidget);
      expect(find.text('Closing balance'), findsOneWidget);
      expect(find.text('Dr ${rupee}1,000.00'), findsOneWidget);
      expect(find.text('Dr ${rupee}1,250.00'), findsOneWidget, reason: 'closing tile; row balances are separate');
      expect(find.text('Balance Dr ${rupee}1,500.00'), findsOneWidget);
      expect(find.text('Balance Dr ${rupee}1,250.00'), findsOneWidget);
      expect(find.text('${rupee}500.00'), findsOneWidget);
      expect(find.text('${rupee}250.00'), findsOneWidget);
      expect(find.text('Sale INV-7'), findsOneWidget);
      expect(find.text('INV-7 · Invoice'), findsOneWidget);
    });

    testWidgets('without a running balance from the server none is shown or worked out', (t) async {
      final srv = _Srv()
        ..ledger = {
          'account': _petty,
          'opening_balance': 1000,
          'closing_balance': 1250,
          'entries': [
            {'id': 'e1', 'entry_date': '2026-11-02T00:00:00.000Z', 'voucher_type': 'invoice', 'voucher_id': 'inv1', 'reference_number': 'INV-7', 'debit': '500.00', 'credit': '0.00', 'narration': 'Sale INV-7'},
          ],
        };
      await open(t, srv);
      expect(find.text('Sale INV-7'), findsOneWidget);
      expect(find.textContaining('Balance Dr'), findsNothing);
      expect(find.text('Dr ${rupee}1,000.00'), findsOneWidget);
    });

    testWidgets('another period asks again with its dates', (t) async {
      final (_, sent) = await open(t, _Srv());
      await t.tap(find.text('Last month'));
      await t.pumpAndSettle();
      final calls = requestsOf(sent, 'GET', '/api/ledger/account/a2').toList();
      expect(calls, hasLength(2));
      final last = ReportPeriod.of('last_month');
      expect(calls.last.uri.queryParameters['from_date'], last.fromIso);
      expect(calls.last.uri.queryParameters['to_date'], last.toIso);
    });

    testWidgets('a row opens its invoice; a row with no phone screen does nothing', (t) async {
      await open(t, _Srv());
      await t.tap(find.text('Tea'));
      await t.pumpAndSettle();
      expect(find.byType(InvoiceDetailScreen), findsNothing);
      expect(find.byType(AccountLedgerScreen), findsOneWidget);
      await t.tap(find.text('Sale INV-7'));
      await t.pumpAndSettle();
      expect(find.byType(InvoiceDetailScreen), findsOneWidget);
    });

    testWidgets('the PDF is the statement route with the same period, handed to the viewer', (t) async {
      List<int>? shown;
      String? shownTitle;
      final (_, sent) = await open(t, _Srv(), openPdf: (ctx, bytes, title) async {
        shown = bytes;
        shownTitle = title;
      });
      await t.tap(_icon('Statement PDF'));
      await t.pumpAndSettle();
      final o = requestsOf(sent, 'GET', '/api/ledger/account/a2/statement/pdf').single;
      final fy = ReportPeriod.of('this_fy');
      expect(o.uri.queryParameters['from_date'], fy.fromIso);
      expect(o.uri.queryParameters['to_date'], fy.toIso);
      expect(shown, [37, 80, 68, 70]);
      expect(shownTitle, 'Petty cash');
    });

    testWidgets('a refused PDF toasts the server words', (t) async {
      final srv = _Srv()..pdfReply = (500, utf8.encode(jsonEncode({'error': 'Could not make the PDF'})));
      await open(t, srv, openPdf: (ctx, bytes, title) async => fail('no viewer for an error'));
      await t.tap(_icon('Statement PDF'));
      await t.pumpAndSettle();
      expect(find.text('Could not make the PDF'), findsOneWidget);
    });

    testWidgets('empty period, error with Try again, plan refusal', (t) async {
      final empty = _Srv()..ledger = {'account': _petty, 'opening_balance': 0, 'closing_balance': 0, 'entries': []};
      await open(t, empty);
      expect(find.text('No transactions in this period'), findsOneWidget);

      final bad = _Srv()..ledgerReply = (500, {'error': 'Ledger is down'});
      final (_, sent) = await open(t, bad);
      expect(find.text('Ledger is down'), findsOneWidget);
      bad.ledgerReply = null;
      await t.tap(find.widgetWithText(KButton, 'Try again'));
      await t.pumpAndSettle();
      expect(find.text('Sale INV-7'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/ledger/account/a2'), 2);

      final gated = _Srv()..ledgerReply = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'});
      await open(t, gated);
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });

  group('ledger', () {
    testWidgets('lists the server rows for the period, figures as the server gave them', (t) async {
      final (_, sent) = await _open(t, _Srv(), (s) => LedgerScreen(session: s));
      final o = requestsOf(sent, 'GET', '/api/ledger').single;
      final fy = ReportPeriod.of('this_fy');
      expect(o.uri.queryParameters['from_date'], fy.fromIso);
      expect(o.uri.queryParameters['to_date'], fy.toIso);
      expect(o.uri.queryParameters['page'], '1');
      expect(o.uri.queryParameters.containsKey('account_id'), isFalse);
      expect(find.text('Petty cash'), findsOneWidget);
      expect(find.text('Dr ${rupee}500.00'), findsOneWidget);
      expect(find.text('Opening Dr ${rupee}1,000.00'), findsOneWidget);
      expect(find.text('Balance Dr ${rupee}1,500.00'), findsOneWidget);
      expect(find.text('Sale INV-7'), findsOneWidget);
    });

    testWidgets('the account filter sends account_id and clears again', (t) async {
      final (_, sent) = await _open(t, _Srv(), (s) => LedgerScreen(session: s));
      await t.tap(find.byWidgetPredicate((w) => w is KAsyncPickField && w.label == 'Account'));
      await _sheetUp(t);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Petty cash')));
      await t.pumpAndSettle();
      final calls = requestsOf(sent, 'GET', '/api/ledger').toList();
      expect(calls.last.uri.queryParameters['account_id'], 'a2');
      expect(calls.last.uri.queryParameters['page'], '1');
      await t.tap(find.text('Clear account'));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/ledger').last.uri.queryParameters.containsKey('account_id'), isFalse);
    });

    testWidgets('Show more asks for the next page and adds its rows', (t) async {
      final srv = _Srv()
        ..ledgerPages = {
          1: {
            'entries': [_row('l1', 'Petty cash')],
            'pagination': {'page': 1, 'limit': 50, 'total': 2, 'totalPages': 2},
          },
          2: {
            'entries': [_row('l2', 'Rent')],
            'pagination': {'page': 2, 'limit': 50, 'total': 2, 'totalPages': 2},
          },
        };
      final (_, sent) = await _open(t, srv, (s) => LedgerScreen(session: s));
      expect(find.text('Rent'), findsNothing);
      await t.tap(find.widgetWithText(KButton, 'Show more'));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/ledger').last.uri.queryParameters['page'], '2');
      expect(find.text('Petty cash'), findsOneWidget);
      expect(find.text('Rent'), findsOneWidget);
      expect(find.widgetWithText(KButton, 'Show more'), findsNothing);
    });

    testWidgets('a row opens that account ledger', (t) async {
      final (_, sent) = await _open(t, _Srv(), (s) => LedgerScreen(session: s));
      await t.tap(find.text('Petty cash'));
      await t.pumpAndSettle();
      expect(find.byType(AccountLedgerScreen), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/ledger/account/a2'), 1);
    });

    testWidgets('empty, error with Try again, and plan refusal are each handled', (t) async {
      await _open(t, _Srv()..ledgerPages = {1: {'entries': [], 'pagination': {'page': 1, 'limit': 50, 'total': 0, 'totalPages': 0}}}, (s) => LedgerScreen(session: s));
      expect(find.text('No ledger entries found'), findsOneWidget);

      final bad = _Srv()..allLedgerReply = (500, {'error': 'Day book is down'});
      final (_, sent) = await _open(t, bad, (s) => LedgerScreen(session: s));
      expect(find.text('Day book is down'), findsOneWidget);
      bad.allLedgerReply = null;
      await t.tap(find.widgetWithText(KButton, 'Try again'));
      await t.pumpAndSettle();
      expect(find.text('Petty cash'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/ledger'), 2);

      final gated = _Srv()..allLedgerReply = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'});
      await _open(t, gated, (s) => LedgerScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });

  group('routes', () {
    testWidgets('Chart of Accounts, new account and Ledger open their own screens', (t) async {
      final (s, _) = _Srv().build();
      expect(nativeScreenFor(s, '/accounts'), isA<AccountsScreen>());
      expect(nativeScreenFor(s, '/accounts/new'), isA<AccountFormScreen>());
      expect(nativeScreenFor(s, '/ledger'), isA<LedgerScreen>());
      expect(stillGeneric.contains('/accounts'), isFalse);
      expect(stillGeneric.contains('/ledger'), isFalse);
    });
  });
}

// ---------------------------------------------------------------------------------------------

const _petty = {'id': 'a2', 'account_code': '1002', 'account_name': 'Petty cash', 'account_type': 'asset', 'account_group_name': 'Cash', 'nature': 'debit'};

Map<String, dynamic> _row(String id, String name) => {
      'id': id,
      'entry_date': '2026-11-03T00:00:00.000Z',
      'account_id': 'a2',
      'account_code': '1002',
      'account_name': name,
      'voucher_number': 'INV-7',
      'voucher_type': 'invoice',
      'voucher_types': ['invoice'],
      'reference_number': 'INV-7',
      'narration': 'Sale INV-7',
      'debit': 500,
      'credit': 0,
      'opening': 1000,
      'opening_side': 'Dr',
      'closing': 1500,
      'balance_side': 'Dr',
    };

class _Srv {
  List<Map<String, dynamic>> accounts = [
    {'id': 'a1', 'account_code': '1001', 'account_name': 'Cash in hand', 'account_type': 'asset', 'account_group_id': 'g1', 'account_group_name': 'Cash', 'nature': 'debit', 'is_system': true, 'is_active': true},
    {'id': 'a2', 'account_code': '1002', 'account_name': 'Petty cash', 'account_type': 'asset', 'account_group_id': 'g1', 'account_group_name': 'Cash', 'nature': 'debit', 'is_system': false, 'is_active': true},
    {'id': 'a3', 'account_code': '5001', 'account_name': 'Rent', 'account_type': 'expense', 'account_group_id': 'g2', 'account_group_name': 'Direct Expenses', 'nature': 'debit', 'is_system': false, 'is_active': true},
  ];
  final groups = [
    {'id': 'g1', 'group_code': '1100', 'group_name': 'Cash', 'group_type': 'asset'},
    {'id': 'g2', 'group_code': '5100', 'group_name': 'Direct Expenses', 'group_type': 'expense'},
  ];
  Reply? listReply, balancesReply, patchReply, postReply, oneReply, ledgerReply, allLedgerReply, pdfReply;
  Map<String, dynamic>? ledger;
  Map<int, Map<String, dynamic>>? ledgerPages;

  (AppSession, List<RequestOptions>) build() => recordedSession((o, body) {
        final p = o.uri.path;
        if (o.method == 'GET') {
          if (p == '/api/accounts') return listReply ?? (200, {'accounts': accounts, 'pagination': {'page': 1, 'limit': accounts.length, 'total': accounts.length, 'totalPages': 1}});
          if (p == '/api/accounts/groups') return (200, {'groups': groups});
          if (p == '/api/accounts/my-accounts') {
            return balancesReply ??
                (200, {
                  'accounts': [
                    {'id': 'a1', 'closing': 12500.5, 'balance_side': 'Dr', 'has_activity': true},
                    {'id': 'a3', 'closing': 4000, 'balance_side': 'Dr', 'has_activity': true},
                  ],
                  'groups': [],
                  'manual_account_ids': [],
                });
          }
          final one = RegExp(r'^/api/accounts/([^/]+)$').firstMatch(p);
          if (one != null) {
            final row = accounts.where((a) => a['id'] == one.group(1)).toList();
            return oneReply ??
                (200, {
                  'account': {
                    ...row.first,
                    'opening_balance': '1000.00',
                    'opening_balance_type': 'debit',
                    'description': 'Shop rent',
                    'parent_account_id': null,
                  },
                });
          }
          if (p == '/api/ledger/account/a2/statement/pdf') return pdfReply ?? (200, <int>[37, 80, 68, 70]);
          if (p == '/api/ledger/account/a2') {
            return ledgerReply ??
                (200, ledger ?? {
                  'account': _petty,
                  'opening_balance': 1000,
                  'closing_balance': 1250,
                  'entries': [
                    {'id': 'e1', 'entry_date': '2026-11-02T00:00:00.000Z', 'voucher_type': 'invoice', 'voucher_id': 'inv1', 'reference_number': 'INV-7', 'debit': '500.00', 'credit': '0.00', 'narration': 'Sale INV-7', 'running_balance': 1500},
                    {'id': 'e2', 'entry_date': '2026-11-05T00:00:00.000Z', 'voucher_type': 'expense', 'voucher_id': 'exp1', 'reference_number': null, 'debit': '0.00', 'credit': '250.00', 'narration': 'Tea', 'running_balance': 1250},
                  ],
                });
          }
          if (p == '/api/ledger') {
            if (allLedgerReply != null) return allLedgerReply!;
            final page = int.tryParse(o.uri.queryParameters['page'] ?? '1') ?? 1;
            return (200, ledgerPages?[page] ?? {'entries': [_row('l1', 'Petty cash')], 'pagination': {'page': 1, 'limit': 50, 'total': 1, 'totalPages': 1}});
          }
          return (404, {'error': 'not faked: GET $p'});
        }
        if (o.method == 'POST' && p == '/api/accounts') return postReply ?? (201, {'account': {'id': 'a9', ...body}});
        if (o.method == 'PATCH' && RegExp(r'^/api/accounts/[^/]+$').hasMatch(p)) return patchReply ?? (200, {'account': {'id': p.split('/').last, ...body}});
        return (404, {'error': 'not faked: ${o.method} $p'});
      });
}

Future<(AppSession, List<RequestOptions>)> _open(WidgetTester t, _Srv srv, Widget Function(AppSession) screen) async {
  final (s, sent) = srv.build();
  await pumpScreen(t, screen(s));
  return (s, sent);
}

/// Opens [screen] as a pushed page, so it can pop itself when it saves.
Future<(AppSession, List<RequestOptions>)> _launch(WidgetTester t, _Srv srv, Widget Function(AppSession) screen) async {
  final (s, sent) = srv.build();
  await pumpScreen(
    t,
    Builder(builder: (ctx) => Center(child: KButton(label: 'Open', onPressed: () => Navigator.of(ctx).push(MaterialPageRoute<bool>(builder: (_) => screen(s)))))),
  );
  await t.tap(find.text('Open'));
  await t.pumpAndSettle();
  return (s, sent);
}

Future<void> _sheetUp(WidgetTester t) async {
  await t.pump();
  await t.pump(const Duration(seconds: 1));
}

/// Picks a group in the add form's "Account type" field.
Future<void> _chooseGroup(WidgetTester t, String label) async {
  await t.tap(find.byWidgetPredicate((w) => w is KPickField && w.label == 'Account type'));
  await _sheetUp(t);
  await t.tap(inSheet(label));
  await t.pumpAndSettle();
}
