import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/accounting/bank_recon_logic.dart';
import 'package:khatario_phone/screens/accounting/bank_reconciliation_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

const _debitLine = {
  'id': 'l1',
  'transaction_date': '2026-10-05',
  'description': 'ATM CHARGES 5001234567890',
  'debit_amount': '118.00',
  'credit_amount': '0.00',
  'match_status': 'unmatched',
  'matched_ledger_ids': [],
  'age_days': 40,
  'is_duplicate': false,
  'extracted_references': {'long_numeric_refs': ['5001234567890'], 'cheque_refs': []},
};
const _creditLine = {
  'id': 'l2',
  'transaction_date': '2026-10-31',
  'description': 'INT PAID',
  'debit_amount': '0.00',
  'credit_amount': '45.50',
  'match_status': 'unmatched',
  'matched_ledger_ids': [],
  'age_days': 5,
  'is_duplicate': true,
};
const _ledger = {
  'id': 'e1',
  'entry_date': '2026-10-05',
  'debit': '0.00',
  'credit': '118.00',
  'narration': 'ATM charges',
  'reference_number': 'JV-1',
};

void main() {
  group('bank reconciliation logic', () {
    test('only accounts linked to a ledger account are offered, labelled as the website labels them', () {
      final rows = reconBankAccounts({
        'accounts': [
          {'id': 'a1', 'bank_name': 'HDFC', 'account_name': 'Current', 'ledger_account_id': 'g1', 'ledger_account_name': 'HDFC Bank'},
          {'id': 'a2', 'bank_name': 'SBI', 'account_name': 'Savings', 'ledger_account_id': null},
        ],
      });
      expect(rows.length, 1);
      expect(reconBankAccountLabel(rows.first), 'HDFC — Current');
    });

    test('requests: statements of an account, then one statement', () {
      expect(reconStatementsPath('a1'), '/api/bank/reconciliation?bank_account_id=a1');
      expect(reconStatementPath('s1'), '/api/bank/reconciliation?bank_statement_id=s1');
    });

    test('a statement reads its period and whether it is done', () {
      expect(reconStatementLabel({'statement_period_start': '2026-10-01', 'statement_period_end': '2026-10-31', 'reconciliation_status': 'in_progress'}), '01 Oct 2026 → 31 Oct 2026');
      expect(reconStatementLabel({'statement_period_start': '2026-10-01', 'statement_period_end': '2026-10-31', 'reconciliation_status': 'completed'}), '01 Oct 2026 → 31 Oct 2026 (done)');
      expect(reconIsCompleted({'statement': {'reconciliation_status': 'completed'}}), isTrue);
      expect(reconIsCompleted({'statement': {'reconciliation_status': 'in_progress'}}), isFalse);
      expect(reconIsCompleted({}), isFalse);
    });

    test('bodies are the website ones with no identity', () {
      final bodies = [
        reconMatchBody(statementId: 's1', lineId: 'l1', ledgerIds: ['e1', 'e2']),
        reconIgnoreBody(statementId: 's1', lineId: 'l1'),
        reconUndoBody(statementId: 's1', lineId: 'l1'),
        reconCreateEntryBody(statementId: 's1', lineId: 'l1', type: 'bank_charge', accountId: 'x1'),
        reconAutoMatchBody('s1'),
        reconCompleteBody(statementId: 's1', force: true),
      ];
      expect(bodies[0], {'bank_statement_id': 's1', 'statement_line_id': 'l1', 'ledger_line_ids': ['e1', 'e2']});
      expect(bodies[1], {'bank_statement_id': 's1', 'statement_line_id': 'l1'});
      expect(bodies[2], {'bank_statement_id': 's1', 'statement_line_id': 'l1'});
      expect(bodies[3], {'bank_statement_id': 's1', 'statement_line_id': 'l1', 'type': 'bank_charge', 'account_id': 'x1'});
      expect(bodies[4], {'bank_statement_id': 's1'});
      expect(bodies[5], {'bank_statement_id': 's1', 'force': true});
      expect(reconCompleteBody(statementId: 's1', force: false)['force'], false);
      for (final b in bodies) {
        expectNoIdentity(b);
      }
    });

    test('a line is money in or out as the statement says; the entry type follows the side', () {
      expect(reconLineAmountText(_debitLine), 'Dr ₹118.00');
      expect(reconLineAmountText(_creditLine), 'Cr ₹45.50');
      expect(reconCreateType(_debitLine), 'bank_charge');
      expect(reconCreateType(_creditLine), 'interest');
      expect(reconCreateType({'debit_amount': '0', 'credit_amount': '0'}), isNull);
      expect(reconOffsetAccountType('bank_charge'), 'expense');
      expect(reconOffsetAccountType('interest'), 'income');
    });

    test('status words and the done check', () {
      expect(reconStatusLabel('unmatched'), 'Unmatched');
      expect(reconStatusLabel('matched'), 'Matched');
      expect(reconStatusLabel('partial'), 'Partial');
      expect(reconStatusLabel('ignored'), 'Ignored');
    });

    test('the filters follow the website: unmatched, partial, over 30 days, duplicates, search', () {
      final partial = {..._debitLine, 'id': 'l3', 'match_status': 'partial', 'age_days': null};
      final lines = [_debitLine, _creditLine, partial];
      List<String> ids(ReconFilter f, [String q = '']) => [for (final l in reconFilterLines(lines, f, q)) l['id'] as String];
      expect(ids(ReconFilter.all), ['l1', 'l2', 'l3']);
      expect(ids(ReconFilter.unmatched), ['l1', 'l2']);
      expect(ids(ReconFilter.partial), ['l3']);
      expect(ids(ReconFilter.over30), ['l1']);
      expect(ids(ReconFilter.duplicates), ['l2']);
      expect(ids(ReconFilter.all, 'int paid'), ['l2']);
      expect(ids(ReconFilter.all, '2026-10-31'), ['l2']);
    });

    test('a suggestion reads as the website words it, with the entry it points at', () {
      final byId = {'e1': _ledger};
      final exact = {'bankLineId': 'l1', 'ledgerLineIds': ['e1'], 'tier': 'exact', 'confidence': 'high'};
      expect(reconSuggestionFor({'suggestions': [exact]}, 'l1'), exact);
      expect(reconSuggestionFor({'suggestions': [exact]}, 'zz'), isNull);
      expect(reconSuggestionHeadline(exact, _debitLine, byId), 'Exact match (₹118.00, date matched)');
      final far = {..._ledger, 'entry_date': '2026-10-09'};
      expect(reconSuggestionHeadline(exact, _debitLine, {'e1': far}), 'Exact match (₹118.00, 4d apart)');
      final ref = {'bankLineId': 'l1', 'ledgerLineIds': ['e1'], 'tier': 'reference', 'confidence': 'high'};
      expect(reconSuggestionHeadline(ref, _debitLine, {'e1': {..._ledger, 'narration': 'paid 5001234567890'}}), 'Reference match (UTR found)');
      expect(reconSuggestionHeadline(ref, _debitLine, byId), 'Reference match (text / reference similarity)');
      final fuzzy = {'bankLineId': 'l1', 'ledgerLineIds': ['e1'], 'tier': 'fuzzy', 'confidence': 'low'};
      expect(reconSuggestionHeadline(fuzzy, _debitLine, {'e1': {..._ledger, 'credit': '118.60'}}), 'Fuzzy match (₹118.00 ≈ ₹118.60)');
    });

    test('a ledger entry is described by date, narration, reference and the bank-side amount', () {
      expect(reconLedgerLabel(_ledger), '05 Oct 2026 · ATM charges #JV-1 · ₹118.00');
      expect(reconLedgerLabel({'id': 'q', 'entry_date': '2026-10-05', 'debit': '300.00', 'credit': '0.00'}), '05 Oct 2026 · Ledger entry · ₹300.00');
    });

    test('the summary shows only what the server sent', () {
      final rows = reconSummaryRows({
        'opening_balance': 1000,
        'closing_balance': 5000.5,
        'ledger_book_balance': 4800,
        'reconciliation_difference': 200.5,
        'matched_count': 8,
        'unmatched_count': 2,
        'ignored_count': 1,
        'total_lines': 11,
      });
      expect(rows, [
        ('Opening balance', '₹1,000.00'),
        ('Statement closing balance', '₹5,000.50'),
        ('Book balance', '₹4,800.00'),
        ('Difference', '₹200.50'),
        ('Matched', '8'),
        ('Unmatched', '2'),
        ('Ignored', '1'),
      ]);
    });

    test('the questions name the amount, date and accounts, and the server count is reported', () {
      expect(
        reconCreateQuestion(line: _debitLine, type: 'bank_charge', accountName: 'Bank charges', bankName: 'HDFC Bank'),
        'Post a bank charge of ₹118.00 dated 05 Oct 2026: debit Bank charges, credit HDFC Bank. This statement line is then matched to it.',
      );
      expect(
        reconCreateQuestion(line: _creditLine, type: 'interest', accountName: 'Interest income', bankName: 'HDFC Bank'),
        'Post interest of ₹45.50 dated 31 Oct 2026: debit HDFC Bank, credit Interest income. This statement line is then matched to it.',
      );
      expect(reconCompleteQuestion(0), 'Mark this statement as reconciled?');
      expect(reconCompleteQuestion(3), 'There are 3 unmatched line(s). Mark this statement as reconciled anyway?');
      expect(reconAutoMatchToast({'matched_count': 4, 'skipped_count': 1}), 'Auto-matched 4, skipped 1');
      expect(reconAutoMatchToast({'matched_count': 0}), 'Auto-matched 0, skipped 0');
    });
  });

  const matchedLine = {
    'id': 'l3',
    'transaction_date': '2026-10-12',
    'description': 'NEFT FROM ASHA TRADERS',
    'debit_amount': '0.00',
    'credit_amount': '900.00',
    'match_status': 'matched',
    'matched_ledger_ids': ['e9'],
    'age_days': 20,
    'is_duplicate': false,
  };
  const hdfc = {'id': 'a1', 'bank_name': 'HDFC', 'account_name': 'Current', 'ledger_account_id': 'g1', 'ledger_account_name': 'HDFC Bank'};
  const sbi = {'id': 'a2', 'bank_name': 'SBI', 'account_name': 'Savings', 'ledger_account_id': 'g2', 'ledger_account_name': 'SBI Bank'};
  Map<String, dynamic> openStatement() => {'id': 's1', 'statement_period_start': '2026-10-01', 'statement_period_end': '2026-10-31', 'reconciliation_status': 'in_progress'};

  group('bank reconciliation screen', () {
    var accounts = <Map<String, dynamic>>[hdfc];
    var statements = <Map<String, dynamic>>[openStatement()];
    var completed = false;
    var loadFails = 0;
    String? failCode;
    String? refuse;
    var refuseStatus = 400;
    var crash = false;

    setUp(() {
      accounts = [hdfc];
      statements = [openStatement()];
      completed = false;
      loadFails = 0;
      failCode = null;
      refuse = null;
      refuseStatus = 400;
      crash = false;
    });

    Map<String, dynamic> payload() => {
          'statement': {
            'id': 's1',
            'bank_account_id': 'a1',
            'statement_period_start': '2026-10-01',
            'statement_period_end': '2026-10-31',
            'opening_balance': '1000.00',
            'closing_balance': '5000.50',
            'reconciliation_status': completed ? 'completed' : 'in_progress',
          },
          'lines': [_debitLine, _creditLine, matchedLine],
          'ledger_lines': [_ledger, {'id': 'e2', 'entry_date': '2026-10-06', 'debit': '0.00', 'credit': '50.00', 'narration': 'Bank fee', 'reference_number': null}],
          'suggestions': [
            {'bankLineId': 'l1', 'ledgerLineIds': ['e1'], 'tier': 'exact', 'confidence': 'high'},
          ],
          'summary': {
            'opening_balance': 1000,
            'closing_balance': 5000.5,
            'difference': 4000.5,
            'reconciliation_difference': 200.5,
            'ledger_book_balance': 4800,
            'matched_count': 1,
            'unmatched_count': 2,
            'ignored_count': 0,
            'total_lines': 3,
          },
        };

    Reply server(RequestOptions o, Map body) {
      final path = o.uri.path;
      if (o.method == 'GET' && loadFails > 0) {
        loadFails--;
        return (failCode == null ? 500 : 403, {'error': 'Server is down', 'code': ?failCode});
      }
      if (o.method == 'GET' && path == '/api/bank-accounts') return (200, {'accounts': accounts});
      if (o.method == 'GET' && path == '/api/bank/reconciliation') {
        if (o.uri.queryParameters.containsKey('bank_account_id')) return (200, {'statements': statements});
        return (200, payload());
      }
      if (o.method == 'GET' && path == '/api/accounts') {
        return (200, {
          'accounts': [
            {'id': 'x1', 'account_name': 'Bank charges', 'account_code': '5301', 'account_type': 'expense'},
            {'id': 'x2', 'account_name': 'Interest income', 'account_code': '4301', 'account_type': 'income'},
            {'id': 'x3', 'account_name': 'Cash in hand', 'account_code': '1101', 'account_type': 'asset'},
          ],
        });
      }
      if (o.method == 'POST' && path.startsWith('/api/bank/reconciliation/')) {
        if (crash) throw StateError('boom');
        if (refuse != null) return (refuseStatus, {'error': refuse});
        if (path.endsWith('/auto-match')) return (200, {'matched_count': 4, 'skipped_count': 1, 'suggestions_total': 5});
        if (path.endsWith('/create-entry')) return (200, {'ok': true, 'voucher_number': 'JV-9'});
        if (path.endsWith('/complete')) {
          completed = true;
          return (200, {'ok': true, 'reconciliation_status': 'completed'});
        }
        return (200, {'ok': true});
      }
      return (404, {'error': 'not found'});
    }

    Future<List<RequestOptions>> open(WidgetTester t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, BankReconciliationScreen(session: session));
      return sent;
    }

    Future<void> pick(WidgetTester t, String label, String option) async {
      await t.tap(find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first, matching: find.byType(InkWell)).first);
      await t.pumpAndSettle();
      await t.tap(find.text(option).last);
      await t.pumpAndSettle();
    }

    Future<void> openLine(WidgetTester t, String description) async {
      await t.tap(find.text(description));
      await t.pumpAndSettle();
    }

    testWidgets('one account loads its latest statement, the server balances and each line with its suggestion', (t) async {
      final sent = await open(t);
      expect(requestsOf(sent, 'GET', '/api/bank/reconciliation').map((o) => o.uri.queryParameters).toList(), [
        {'bank_account_id': 'a1'},
        {'bank_statement_id': 's1'},
      ]);
      expect(find.text('HDFC — Current'), findsOneWidget);
      expect(find.text('01 Oct 2026 → 31 Oct 2026'), findsOneWidget);
      expect(find.text('₹4,800.00'), findsOneWidget);
      expect(find.text('₹200.50'), findsOneWidget);
      expect(find.text('₹5,000.50'), findsOneWidget);
      expect(find.text('ATM CHARGES 5001234567890'), findsOneWidget);
      expect(find.text('Dr ₹118.00'), findsOneWidget);
      expect(find.text('Cr ₹900.00'), findsOneWidget);
      expect(find.text('Exact match (₹118.00, date matched)'), findsOneWidget);
      for (final o in sent) {
        expect(o.uri.queryParameters.containsKey('business_id'), isFalse);
        expect(o.uri.queryParameters.containsKey('user_id'), isFalse);
      }
    });

    testWidgets('with two accounts nothing loads until one is picked', (t) async {
      accounts = [hdfc, sbi];
      final sent = await open(t);
      expect(requestCount(sent, 'GET', '/api/bank/reconciliation'), 0);
      await pick(t, 'Bank account', 'SBI — Savings');
      expect(requestsOf(sent, 'GET', '/api/bank/reconciliation').first.uri.queryParameters, {'bank_account_id': 'a2'});
      expect(find.text('ATM CHARGES 5001234567890'), findsOneWidget);
    });

    testWidgets('the filter chips and search narrow the lines', (t) async {
      await open(t);
      await t.tap(find.text('Duplicates'));
      await t.pumpAndSettle();
      expect(find.text('INT PAID'), findsOneWidget);
      expect(find.text('ATM CHARGES 5001234567890'), findsNothing);
      await t.tap(find.text('All'));
      await t.pumpAndSettle();
      await t.enterText(find.descendant(of: find.byType(KSearchField), matching: find.byType(TextField)), 'asha');
      await t.pumpAndSettle();
      expect(find.text('NEFT FROM ASHA TRADERS'), findsOneWidget);
      expect(find.text('INT PAID'), findsNothing);
    });

    testWidgets('Match to the suggested entry posts once with the suggested ids, then reloads', (t) async {
      final sent = await open(t);
      await openLine(t, 'ATM CHARGES 5001234567890');
      expect(find.text('05 Oct 2026 · ATM charges #JV-1 · ₹118.00'), findsOneWidget);
      final match = find.text('Match to suggested entry');
      await t.tap(match);
      await t.tap(match, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/bank/reconciliation/match'), 1);
      final body = lastBody(sent, 'POST', '/api/bank/reconciliation/match');
      expect(body, {'bank_statement_id': 's1', 'statement_line_id': 'l1', 'ledger_line_ids': ['e1']});
      expectNoIdentity(body);
      expect(requestCount(sent, 'GET', '/api/bank/reconciliation'), 3, reason: 'statements, statement, reload');
      expect(find.text('Line matched'), findsOneWidget);
    });

    testWidgets('a line with no suggestion offers no Match', (t) async {
      await open(t);
      await openLine(t, 'INT PAID');
      expect(find.text('Match to suggested entry'), findsNothing);
      expect(find.text('Create entry'), findsOneWidget);
      expect(find.text('Ignore this line'), findsOneWidget);
    });

    testWidgets('Ignore posts once; Undo on a matched line posts once', (t) async {
      final sent = await open(t);
      await openLine(t, 'INT PAID');
      await t.tap(find.text('Ignore this line'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/bank/reconciliation/ignore'), 1);
      expect(lastBody(sent, 'POST', '/api/bank/reconciliation/ignore'), {'bank_statement_id': 's1', 'statement_line_id': 'l2'});
      await openLine(t, 'NEFT FROM ASHA TRADERS');
      expect(find.text('Match to suggested entry'), findsNothing);
      await t.tap(find.text('Undo'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/bank/reconciliation/undo'), 1);
      expect(lastBody(sent, 'POST', '/api/bank/reconciliation/undo'), {'bank_statement_id': 's1', 'statement_line_id': 'l3'});
    });

    testWidgets('Create entry offers expense accounts for a debit, asks naming amount, date and accounts, and posts once', (t) async {
      final sent = await open(t);
      await openLine(t, 'ATM CHARGES 5001234567890');
      await t.tap(find.text('Create entry'));
      await t.pumpAndSettle();
      await t.tap(inSheet('Select'));
      await t.pumpAndSettle();
      expect(find.text('Bank charges'), findsOneWidget);
      expect(find.text('Interest income'), findsNothing, reason: 'a debit line is a bank charge: expense accounts only');
      expect(find.text('Cash in hand'), findsNothing);
      await t.tap(find.text('Bank charges'));
      await t.pumpAndSettle();
      await t.tap(find.text('Review and post'));
      await t.pumpAndSettle();
      expect(find.text('Post a bank charge of ₹118.00 dated 05 Oct 2026: debit Bank charges, credit HDFC Bank. This statement line is then matched to it.'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/bank/reconciliation/create-entry'), 0, reason: 'asked first');
      final go = find.text('Post and match');
      await t.tap(go);
      await t.tap(go, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/bank/reconciliation/create-entry'), 1);
      final body = lastBody(sent, 'POST', '/api/bank/reconciliation/create-entry');
      expect(body, {'bank_statement_id': 's1', 'statement_line_id': 'l1', 'type': 'bank_charge', 'account_id': 'x1'});
      expectNoIdentity(body);
      expect(find.text('Posted journal JV-9'), findsOneWidget);
    });

    testWidgets('declining the Create entry question posts nothing', (t) async {
      final sent = await open(t);
      await openLine(t, 'INT PAID');
      await t.tap(find.text('Create entry'));
      await t.pumpAndSettle();
      await t.tap(inSheet('Select'));
      await t.pumpAndSettle();
      expect(find.text('Interest income'), findsOneWidget, reason: 'a credit line is interest: income accounts');
      expect(find.text('Bank charges'), findsNothing);
      await t.tap(find.text('Interest income'));
      await t.pumpAndSettle();
      await t.tap(find.text('Review and post'));
      await t.pumpAndSettle();
      await t.tap(find.text('Not now'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/bank/reconciliation/create-entry'), 0);
    });

    testWidgets('Match automatically asks, posts once and shows the server count', (t) async {
      final sent = await open(t);
      await t.tap(find.text('Match automatically'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/bank/reconciliation/auto-match'), 0);
      await t.tap(find.text('Match now'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/bank/reconciliation/auto-match'), 1);
      expect(lastBody(sent, 'POST', '/api/bank/reconciliation/auto-match'), {'bank_statement_id': 's1'});
      expect(find.text('Auto-matched 4, skipped 1'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/bank/reconciliation'), 3);
    });

    testWidgets('Mark as reconciled names the unmatched lines, sends force, and the screen shows it done', (t) async {
      final sent = await open(t);
      await t.tap(find.text('Mark as reconciled'));
      await t.pumpAndSettle();
      expect(find.text('There are 2 unmatched line(s). Mark this statement as reconciled anyway?'), findsOneWidget);
      await t.tap(find.text('Mark reconciled'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/bank/reconciliation/complete'), 1);
      expect(lastBody(sent, 'POST', '/api/bank/reconciliation/complete'), {'bank_statement_id': 's1', 'force': true});
      expect(find.text('Marked as reconciled'), findsOneWidget);
      expect(find.text('Reconciled'), findsOneWidget);
      expect(find.text('Match automatically'), findsNothing);
      expect(find.text('Mark as reconciled'), findsNothing);
      await openLine(t, 'NEFT FROM ASHA TRADERS');
      expect(find.text('Undo'), findsOneWidget, reason: 'undo is how a reconciled statement is reopened');
      await t.tap(find.text('Undo'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/bank/reconciliation/undo'), 1);
    });

    testWidgets('an account with no statements offers the website import', (t) async {
      statements = [];
      await open(t);
      expect(find.text('No statements for this account'), findsOneWidget);
      expect(find.text('Import a statement on the website'), findsOneWidget);
    });

    testWidgets('a line with no suggestion can be matched to entries picked by hand, once, with every picked id', (t) async {
      final sent = await open(t);
      await openLine(t, 'INT PAID');
      await t.tap(find.text('Match to other entries'));
      await t.pumpAndSettle();
      expect(find.text('05 Oct 2026 · ATM charges #JV-1 · ₹118.00'), findsOneWidget);
      expect(find.text('06 Oct 2026 · Bank fee · ₹50.00'), findsOneWidget);
      KButton matchButton() => t.widget<KButton>(find.widgetWithText(KButton, 'Match selected'));
      expect(matchButton().onPressed, isNull, reason: 'nothing ticked yet');
      await t.tap(find.text('05 Oct 2026 · ATM charges #JV-1 · ₹118.00'));
      await t.tap(find.text('06 Oct 2026 · Bank fee · ₹50.00'));
      await t.pumpAndSettle();
      expect(matchButton().onPressed, isNotNull);
      final go = find.text('Match selected');
      await t.tap(go);
      await t.tap(go, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/bank/reconciliation/match'), 1);
      final body = lastBody(sent, 'POST', '/api/bank/reconciliation/match');
      expect(body, {'bank_statement_id': 's1', 'statement_line_id': 'l2', 'ledger_line_ids': ['e1', 'e2']});
      expectNoIdentity(body);
      expect(requestCount(sent, 'GET', '/api/bank/reconciliation'), 3);
    });

    testWidgets('a wrong suggestion can be replaced: the suggested entry starts ticked and can be unticked', (t) async {
      final sent = await open(t);
      await openLine(t, 'ATM CHARGES 5001234567890');
      await t.tap(find.text('Match to other entries'));
      await t.pumpAndSettle();
      await t.tap(find.text('05 Oct 2026 · ATM charges #JV-1 · ₹118.00'));
      await t.tap(find.text('06 Oct 2026 · Bank fee · ₹50.00'));
      await t.pumpAndSettle();
      await t.tap(find.text('Match selected'));
      await t.pumpAndSettle();
      expect(lastBody(sent, 'POST', '/api/bank/reconciliation/match')['ledger_line_ids'], ['e2']);
    });

    testWidgets('any refused action reloads, not only a 409', (t) async {
      refuse = 'This accounting period is locked.';
      final sent = await open(t);
      await openLine(t, 'ATM CHARGES 5001234567890');
      await t.tap(find.text('Match to suggested entry'));
      await t.pumpAndSettle();
      expect(find.text('This accounting period is locked.'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/bank/reconciliation'), 3, reason: 'statements, statement, reload after the refusal');
    });

    testWidgets('an unexpected failure says something went wrong, not that the server is unreachable', (t) async {
      crash = true;
      await open(t);
      await openLine(t, 'ATM CHARGES 5001234567890');
      await t.tap(find.text('Match to suggested entry'));
      await t.pumpAndSettle();
      expect(find.text('Something went wrong. Try again.'), findsOneWidget);
      expect(find.text('Could not reach the server.'), findsNothing);
    });

    testWidgets('a refused action shows the server message and leaves the screen as it was', (t) async {
      refuse = 'Statement is marked reconciled; undo a match first to edit.';
      refuseStatus = 409;
      final sent = await open(t);
      await openLine(t, 'ATM CHARGES 5001234567890');
      await t.tap(find.text('Match to suggested entry'));
      await t.pumpAndSettle();
      expect(find.text('Statement is marked reconciled; undo a match first to edit.'), findsOneWidget);
      expect(find.text('ATM CHARGES 5001234567890'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/bank/reconciliation/match'), 1);
    });

    testWidgets('a server error offers Try again; a plan refusal says so', (t) async {
      loadFails = 1;
      await open(t);
      expect(find.text('Could not load bank reconciliation'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('ATM CHARGES 5001234567890'), findsOneWidget);

      loadFails = 9;
      failCode = 'FEATURE_NOT_IN_PLAN';
      await open(t);
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('no bank account linked to the books says so', (t) async {
      accounts = [
        {'id': 'a9', 'bank_name': 'X', 'account_name': 'Y', 'ledger_account_id': null},
      ];
      await open(t);
      expect(find.text('No bank account is linked to your books yet'), findsOneWidget);
    });

    testWidgets('the route table opens the screen and the link is no longer generic', (t) async {
      final (session, _) = recordedSession(server);
      expect(nativeScreenFor(session, '/bank/reconciliation'), isA<BankReconciliationScreen>());
      expect(websiteByDesign.contains('/bank/import'), isTrue);
    });
  });
}
