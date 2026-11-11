import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/accounting/account_ledger_screen.dart';
import 'package:khatario_phone/screens/accounting/journal_entries_screen.dart';
import 'package:khatario_phone/screens/accounting/journal_form_screen.dart';
import 'package:khatario_phone/screens/accounting/journal_list_logic.dart';
import 'package:khatario_phone/screens/accounting/journal_logic.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/reports/report_period.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/finders.dart';
import 'support/recorded_session.dart';

Map<String, dynamic> _entry({bool locked = false, bool reversed = false, bool reversing = false, String? reverses, String date = '2026-11-03'}) => {
      'id': 'je1',
      'voucher_id': 'v1',
      'voucher_number': 'JV/2026/000007',
      'entry_date': date,
      'reference_number': 'R-1',
      'narration': 'Rent',
      'is_locked': locked,
      'is_reversed': reversed,
      'is_reversing': reversing,
      'reverses_entry_id': reverses,
    };

List<Map<String, dynamic>> _lines() => [
      {'account_id': 'a-rent', 'account_name': 'Rent', 'debit': '5000.00', 'credit': '0.00', 'narration': 'Nov rent', 'reference_number': 'REF-1'},
      {'account_id': 'a-cash', 'account_name': 'Cash', 'debit': '0.00', 'credit': '5000.00', 'narration': null},
    ];

/// A page with one button that opens [builder], so the screen under test can pop itself.
class _Host extends StatelessWidget {
  const _Host({required this.builder});

  final WidgetBuilder builder;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: TextButton(onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: builder)), child: const Text('open')),
      );
}

void main() {
  group('journal list logic', () {
    test('the list asks for this calendar year to today, 50 a page, as the website does', () {
      final p = journalDefaultPeriod(DateTime(2026, 11, 11, 15));
      expect(p.fromIso, '2026-01-01');
      expect(p.toIso, '2026-11-11');
      expect(journalListPath(p), '/api/journal-entries?from_date=2026-01-01&to_date=2026-11-11&limit=50');
    });

    test('rows show the voucher, reference, lines, and reversed or locked status', () {
      final row = {..._entry(), 'line_count': 3, 'total_debit': '5000.00'};
      expect(journalRowTitle(row), 'JV/2026/000007');
      expect(journalRowSubtitle(row), 'R-1 · 3 lines');
      expect(journalRowSubtitle({'line_count': 1}), '1 line');
      expect(journalRowStatus(_entry()), isNull);
      expect(journalRowStatus(_entry(locked: true)), 'locked');
      expect(journalRowStatus(_entry(locked: true, reversed: true)), 'reversed');
    });

    test('reverse is offered unless the entry is locked or reversed; edit unless reversed', () {
      expect(journalCanReverse(_entry()), isTrue);
      expect(journalCanReverse(_entry(locked: true)), isFalse);
      expect(journalCanReverse(_entry(reversed: true)), isFalse);
      expect(journalCanEdit(_entry()), isTrue);
      expect(journalCanEdit(_entry(locked: true)), isTrue);
      expect(journalCanEdit(_entry(reversed: true)), isFalse);
    });

    test('bodies: reverse carries the trimmed reason, lock the optional reason, ', () {
      expect(journalReverseBody('  Entered twice '), {'reason': 'Entered twice'});
      expect(journalLockBody('  '), <String, dynamic>{});
      expect(journalLockBody(' month end '), {'lock_reason': 'month end'});
      for (final b in [journalReverseBody('x'), journalLockBody('x')]) {
        expectNoIdentity(b);
      }
    });

    test('refusal messages are the website ones; period and GST refusals keep the server text', () {
      expect(journalActionMessage('JOURNAL_LOCKED', 'Journal entry is locked', verb: 'reversed'), 'This journal entry is locked. Unlock it before it can be reversed.');
      expect(journalActionMessage('JOURNAL_LOCKED', 'x', verb: 'edited'), 'This journal entry is locked. Unlock it before it can be edited.');
      expect(journalActionMessage('JOURNAL_ALREADY_REVERSED', 'x'), 'This journal entry has already been reversed.');
      expect(journalActionMessage('JOURNAL_REVERSED', 'x'), 'This journal entry has been reversed and can no longer be edited.');
      expect(journalActionMessage('PERIOD_LOCKED', 'Cannot edit: the period containing 2026-03-01 is locked.'), 'Cannot edit: the period containing 2026-03-01 is locked.');
      expect(journalActionMessage('GST_PERIOD_FILED', 'GST filed for March'), 'GST filed for March');
      expect(journalActionMessage(null, 'Boom'), 'Boom');
    });
  });

  group('journal edit logic', () {
    test('an entry the phone can hold has no refusal', () {
      expect(journalEditRefusal(_entry(), _lines()), isNull);
    });

    test('locked, reversed, reversing and odd entries are refused with a reason', () {
      expect(journalEditRefusal(_entry(locked: true), _lines()), 'This journal entry is locked. Unlock it before it can be edited.');
      expect(journalEditRefusal(_entry(reversed: true), _lines()), 'This journal entry has been reversed and can no longer be edited.');
      expect(journalEditRefusal(_entry(reversing: true), _lines()), contains('automatic reversing entry'));
      expect(journalEditRefusal(_entry(reverses: 'x1'), _lines()), contains('automatic reversing entry'));
      expect(journalEditRefusal(_entry(), const []), contains('cannot show'));
      expect(journalEditRefusal(_entry(), [_lines().first]), contains('cannot show'));
      final both = _lines()..[1] = {'account_id': 'a', 'debit': '5.00', 'credit': '5.00'};
      expect(journalEditRefusal(_entry(), both), contains('cannot show'));
      final noAccount = _lines()..[0] = {'account_id': null, 'debit': '5000', 'credit': '0'};
      expect(journalEditRefusal(_entry(), noAccount), contains('cannot show'));
    });

    test('saved lines come back as form lines with the side and the amount text', () {
      final lines = journalLinesFromEntry(_lines());
      expect(lines.length, 2);
      expect(lines[0].accountId, 'a-rent');
      expect(lines[0].accountLabel, 'Rent');
      expect(lines[0].debit, isTrue);
      expect(lines[0].amount, '5000');
      expect(lines[0].narration, 'Nov rent');
      expect(lines[0].reference, 'REF-1');
      expect(lines[1].reference, '');
      expect(lines[1].debit, isFalse);
      expect(lines[1].amount, '5000');
      expect(lines[1].narration, '');
    });

    Map<String, dynamic> changes({DateTime? date, String ref = 'R-1', String narration = 'Rent', List<JournalLine>? lines}) => journalEditChanges(
          oldEntry: _entry(),
          oldLines: _lines(),
          date: date ?? DateTime(2026, 11, 3),
          reference: ref,
          narration: narration,
          lines: lines ?? journalLinesFromEntry(_lines()),
        );

    test('an untouched edit sends nothing', () {
      expect(changes(), isEmpty);
    });

    test('a header change sends only that field and no lines (the server keeps the amounts)', () {
      expect(changes(narration: ' Office rent '), {'narration': 'Office rent'});
      expect(changes(ref: ''), {'reference_number': null});
      expect(changes(date: DateTime(2026, 11, 5)), {'entry_date': '2026-11-05'});
    });

    test('a line change sends every line, because the route replaces them all', () {
      final edited = [
        const JournalLine(accountId: 'a-rent', accountLabel: 'Rent', debit: true, amount: '5000.5', narration: 'Nov rent', reference: 'REF-1'),
        const JournalLine(accountId: 'a-cash', accountLabel: 'Cash', debit: false, amount: '5000.5'),
      ];
      final c = changes(lines: edited);
      expect(c.keys, ['lines']);
      expect(c['lines'], [
        {'account_id': 'a-rent', 'debit': 5000.5, 'credit': 0, 'narration': 'Nov rent', 'reference_number': 'REF-1'},
        {'account_id': 'a-cash', 'debit': 0, 'credit': 5000.5, 'narration': null},
      ]);
      expectNoIdentity(c);
    });

    test('moving an account or a side counts as a line change', () {
      final moved = journalLinesFromEntry(_lines());
      final swapped = [
        JournalLine(accountId: moved[0].accountId, accountLabel: 'Rent', debit: false, amount: '5000', narration: 'Nov rent'),
        JournalLine(accountId: moved[1].accountId, accountLabel: 'Cash', debit: true, amount: '5000'),
      ];
      expect(changes(lines: swapped).containsKey('lines'), isTrue);
    });

    test('a period bar value is the website default, custom from 1 January', () {
      final p = journalDefaultPeriod(DateTime(2027, 2, 9));
      expect(p, isA<ReportPeriod>());
      expect(p.preset, 'custom');
    });
  });

  group('journal screens', () {
    // ---- a server that answers like the journal routes -------------------------------------
    var entryLocked = false;
    var entryReversed = false;
    var detailFails = 0;
    var listFails = 0;
    String? listFailCode;
    var totalPages = 1;
    int? reverseStatus;
    String reverseCode = 'JOURNAL_LOCKED';
    String? patchRefuse;

    setUp(() {
      entryLocked = false;
      entryReversed = false;
      detailFails = 0;
      listFails = 0;
      listFailCode = null;
      totalPages = 1;
      reverseStatus = null;
      reverseCode = 'JOURNAL_LOCKED';
      patchRefuse = null;
    });

    Map<String, dynamic> row(String id, {String number = 'JV/2026/000007', bool locked = false, bool reversed = false}) => {
          'voucher_id': id,
          'voucher_number': number,
          'entry_date': '2026-11-03',
          'reference_number': 'R-1',
          'is_locked': locked,
          'is_reversed': reversed,
          'line_count': 2,
          'total_debit': '5000.00',
          'total_credit': '5000.00',
        };

    Reply server(RequestOptions o, Map body) {
      final path = o.uri.path;
      final m = o.method;
      if (m == 'GET' && path == '/api/journal-entries') {
        if (listFails > 0) {
          listFails--;
          return (listFailCode == null ? 500 : 403, {'error': 'Server is down', 'code': ?listFailCode});
        }
        final page = int.tryParse(o.uri.queryParameters['page'] ?? '1') ?? 1;
        return (
          200,
          {
            'entries': page == 1
                ? [row('v1'), row('v2', number: 'JV/2026/000008', locked: true), row('v3', number: 'JV/2026/000009', reversed: true)]
                : [row('v4', number: 'JV/2026/000010')],
            'pagination': {'page': page, 'limit': 50, 'total': 4, 'totalPages': totalPages},
          },
        );
      }
      if (m == 'GET' && path == '/api/journal-entries/v1') {
        if (detailFails > 0) {
          detailFails--;
          return (500, {'error': 'Server is down'});
        }
        return (
          200,
          {
            'entry': {
              ...row('v1', locked: entryLocked, reversed: entryReversed),
              'id': 'je1',
              'narration': 'Rent for November',
              'lock_reason': entryLocked ? 'Month closed' : null,
              'locked_by_name': entryLocked ? 'Asha' : null,
              'locked_at': entryLocked ? '2026-11-05T10:00:00.000Z' : null,
              'line_count': 2,
              'total_debit': 5000,
              'total_credit': 5000,
            },
            'lines': [
              {'id': 'l1', 'account_id': 'a-rent', 'account_name': 'Rent expense', 'account_code': '5201', 'debit': '5000.00', 'credit': '0.00', 'narration': 'Nov rent', 'reference_number': 'REF-1'},
              {'id': 'l2', 'account_id': 'a-cash', 'account_name': 'Cash in hand', 'account_code': '1101', 'debit': '0.00', 'credit': '5000.00', 'narration': null},
            ],
            'reversal': entryReversed
                ? {
                    'reason': 'Entered twice',
                    'reversed_at': '2026-11-06T10:00:00.000Z',
                    'reversed_by_name': 'Asha',
                    'lines': [
                      {'id': 'r1', 'account_id': 'a-rent', 'account_name': 'Rent expense', 'account_code': '5201', 'debit': '0.00', 'credit': '5000.00'},
                      {'id': 'r2', 'account_id': 'a-cash', 'account_name': 'Cash in hand', 'account_code': '1101', 'debit': '5000.00', 'credit': '0.00'},
                    ],
                  }
                : null,
          },
        );
      }
      if (m == 'GET' && path == '/api/accounts') {
        return (
          200,
          {
            'accounts': [
              {'id': 'a-rent', 'account_code': '5201', 'account_name': 'Rent expense'},
              {'id': 'a-cash', 'account_code': '1101', 'account_name': 'Cash in hand'},
            ],
          },
        );
      }
      if (m == 'POST' && path == '/api/journal-entries/v1/reverse') {
        if (reverseStatus != null) {
          if (reverseCode == 'JOURNAL_ALREADY_REVERSED') entryReversed = true;
          return (reverseStatus!, {'error': 'server words', 'code': reverseCode});
        }
        entryReversed = true;
        return (200, {'message': 'Journal entry reversed', 'reversed': true});
      }
      if (m == 'POST' && path == '/api/journal-entries/v1/lock') {
        entryLocked = true;
        return (200, {'message': 'Journal entry locked successfully', 'is_locked': true});
      }
      if (m == 'DELETE' && path == '/api/journal-entries/v1/lock') {
        entryLocked = false;
        return (200, {'message': 'Journal entry unlocked successfully', 'is_locked': false});
      }
      if (m == 'PATCH' && path == '/api/journal-entries/v1') {
        if (patchRefuse != null) return (403, {'error': patchRefuse, 'code': 'PERIOD_LOCKED'});
        return (200, {'message': 'Journal entry updated successfully'});
      }
      return (404, {'error': 'not found ${o.method} $path'});
    }

    Future<List<RequestOptions>> openList(WidgetTester t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, JournalEntriesScreen(session: session));
      return sent;
    }

    Future<List<RequestOptions>> openDetail(WidgetTester t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, _Host(builder: (_) => JournalDetailScreen(session: session, voucherId: 'v1')));
      await t.tap(find.text('open'));
      await t.pumpAndSettle();
      return sent;
    }

    final closeButton = find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == 'Close');

    Finder sheetButton(String label) => find.descendant(of: find.byType(BottomSheet), matching: find.widgetWithText(InkWell, label));

    /// The detail page keeps a spinner on its button while an action waits on a sheet, so it never "settles".
    Future<void> settle(WidgetTester t) async {
      await t.pump();
      await t.pump(const Duration(milliseconds: 600));
    }

    Future<void> more(WidgetTester t, String action) async {
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text(action));
      await settle(t);
    }

    testWidgets('the list loads the year to date, 50 a page, with no identity sent', (t) async {
      final sent = await openList(t);
      final req = requestsOf(sent, 'GET', '/api/journal-entries').first;
      expect(req.uri.queryParameters['limit'], '50');
      expect(req.uri.queryParameters['from_date'], '${DateTime.now().year}-01-01');
      expect(req.uri.queryParameters.containsKey('business_id'), isFalse);
      expect(req.uri.queryParameters.containsKey('user_id'), isFalse);
      expect(find.text('JV/2026/000007'), findsOneWidget);
      expect(find.text('R-1 · 2 lines'), findsNWidgets(3));
      expect(find.text('Locked'), findsOneWidget);
      expect(find.text('Reversed'), findsOneWidget);
      expect(find.textContaining('5,000'), findsNWidgets(3));
    });

    testWidgets('search finds an entry by voucher number', (t) async {
      await openList(t);
      await t.enterText(find.byType(TextField).first, '000008');
      await t.pumpAndSettle();
      expect(find.text('JV/2026/000008'), findsOneWidget);
      expect(find.text('JV/2026/000007'), findsNothing);
    });

    testWidgets('Show more asks for the next page', (t) async {
      totalPages = 2;
      final sent = await openList(t);
      expect(find.text('Show more'), findsOneWidget);
      await t.tap(find.text('Show more'));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/journal-entries').last.uri.queryParameters['page'], '2');
      expect(find.text('JV/2026/000010'), findsOneWidget);
      expect(find.text('Show more'), findsNothing);
    });

    testWidgets('a server error offers Try again and a plan refusal says so', (t) async {
      listFails = 1;
      await openList(t);
      expect(find.text('Could not load journal entries'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('JV/2026/000007'), findsOneWidget);

      listFails = 9;
      listFailCode = 'FEATURE_NOT_IN_PLAN';
      await openList(t);
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('a row opens the detail with lines and totals as the server sent them', (t) async {
      await openList(t);
      await t.tap(find.text('JV/2026/000007'));
      await t.pumpAndSettle();
      expect(find.byType(JournalDetailScreen), findsOneWidget);
      expect(find.text('Rent expense'), findsOneWidget);
      expect(find.text('Cash in hand'), findsOneWidget);
      expect(find.text('Rent for November'), findsOneWidget);
      expect(find.text('Total debit'), findsOneWidget);
      expect(find.text('Edit entry'), findsOneWidget);
    });

    testWidgets('a reversed entry shows its reversal lines and offers no action', (t) async {
      entryReversed = true;
      await openDetail(t);
      expect(find.text('Reversed'), findsWidgets);
      expect(find.textContaining('Entered twice'), findsOneWidget);
      expect(find.textContaining('Reversal'), findsWidgets);
      expect(find.text('Edit entry'), findsNothing);
      expect(find.byTooltip('More'), findsNothing);
    });

    testWidgets('a detail that fails to load offers Try again and no actions', (t) async {
      detailFails = 1;
      final (session, _) = recordedSession(server);
      await pumpScreen(t, _Host(builder: (_) => JournalDetailScreen(session: session, voucherId: 'v1')));
      await t.tap(find.text('open'));
      await t.pumpAndSettle();
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Edit entry'), findsNothing);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Rent expense'), findsOneWidget);
    });

    testWidgets('reverse names the entry and amount, needs a reason, posts once, then reloads', (t) async {
      final sent = await openDetail(t);
      await more(t, 'Reverse entry');
      expect(inSheet('Reverse journal entry'), findsOneWidget);
      expect(find.textContaining('JV/2026/000007'), findsWidgets);
      expect(find.textContaining('₹5,000'), findsWidgets);
      expect(requestCount(sent, 'POST', '/api/journal-entries/v1/reverse'), 0);

      await t.tap(sheetButton('Reverse entry'));
      await settle(t);
      expect(find.text('Add a reason'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/journal-entries/v1/reverse'), 0);

      await t.enterText(textFieldLabelled('Reason for reversal'), '  Entered twice ');
      await t.tap(sheetButton('Reverse entry'));
      await t.tap(sheetButton('Reverse entry'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/journal-entries/v1/reverse'), 1);
      expect(lastBody(sent, 'POST', '/api/journal-entries/v1/reverse'), {'reason': 'Entered twice'});
      expect(requestCount(sent, 'GET', '/api/journal-entries/v1'), 2, reason: 'reloaded after the change');
      expect(find.text('Entry reversed successfully.'), findsOneWidget);
      expect(find.byTooltip('More'), findsNothing);
    });

    testWidgets('keeping the entry sends nothing', (t) async {
      final sent = await openDetail(t);
      await more(t, 'Reverse entry');
      await t.tap(find.text('Keep it'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/journal-entries/v1/reverse'), 0);
    });

    testWidgets('a locked entry refused on reverse shows the website words', (t) async {
      reverseStatus = 403;
      final sent = await openDetail(t);
      await more(t, 'Reverse entry');
      await t.enterText(textFieldLabelled('Reason for reversal'), 'Wrong');
      await t.tap(sheetButton('Reverse entry'));
      await t.pumpAndSettle();
      expect(find.text('This journal entry is locked. Unlock it before it can be reversed.'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/journal-entries/v1/reverse'), 1);
      expect(find.byType(JournalDetailScreen), findsOneWidget);
    });

    testWidgets('an entry already reversed elsewhere reloads with a neutral message', (t) async {
      reverseStatus = 409;
      reverseCode = 'JOURNAL_ALREADY_REVERSED';
      final sent = await openDetail(t);
      await more(t, 'Reverse entry');
      await t.enterText(textFieldLabelled('Reason for reversal'), 'Wrong');
      await t.tap(sheetButton('Reverse entry'));
      await t.pumpAndSettle();
      expect(find.text('This journal entry has already been reversed.'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/journal-entries/v1'), 2);
      expect(find.byTooltip('More'), findsNothing);
    });

    testWidgets('no Delete action is offered on the detail: only Reverse keeps the audit trail', (t) async {
      await openDetail(t);
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      expect(inSheet('Reverse entry'), findsOneWidget);
      expect(find.textContaining('Delete'), findsNothing);
    });

    testWidgets('the list long press has no Delete either', (t) async {
      await openList(t);
      await t.longPress(find.text('JV/2026/000007'));
      await t.pumpAndSettle();
      expect(inSheet('Reverse entry'), findsOneWidget);
      expect(find.textContaining('Delete'), findsNothing);
    });

    testWidgets('lock sends the optional reason and the page then offers Unlock', (t) async {
      final sent = await openDetail(t);
      await more(t, 'Lock entry');
      await t.enterText(textFieldLabelled('Reason for locking (optional)'), 'month end');
      await t.tap(sheetButton('Lock entry'));
      await t.pumpAndSettle();
      expect(lastBody(sent, 'POST', '/api/journal-entries/v1/lock'), {'lock_reason': 'month end'});
      expect(find.text('Unlock entry'), findsOneWidget);
      expect(find.text('Edit entry'), findsNothing);
    });

    testWidgets('unlock asks first, then sends DELETE on the lock route', (t) async {
      entryLocked = true;
      final sent = await openDetail(t);
      expect(find.textContaining('Month closed'), findsOneWidget);
      await t.tap(find.text('Unlock entry'));
      await settle(t);
      expect(requestCount(sent, 'DELETE', '/api/journal-entries/v1/lock'), 0);
      expect(find.text('Are you sure you want to unlock this entry?'), findsOneWidget);
      await t.tap(sheetButton('Unlock entry'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'DELETE', '/api/journal-entries/v1/lock'), 1);
      expect(find.text('Lock entry'), findsNothing);
      expect(find.text('Edit entry'), findsOneWidget);
    });

    testWidgets('a long press on a list row offers reverse only when the website would', (t) async {
      await openList(t);
      await t.longPress(find.text('JV/2026/000007'));
      await t.pumpAndSettle();
      expect(inSheet('Reverse entry'), findsOneWidget);
      expect(inSheet('Edit entry'), findsOneWidget);
      await t.tap(closeButton);
      await t.pumpAndSettle();
      await t.longPress(find.text('JV/2026/000008'));
      await t.pumpAndSettle();
      expect(inSheet('Reverse entry'), findsNothing);
      await t.tap(closeButton);
      await t.pumpAndSettle();
      await t.longPress(find.text('JV/2026/000009'));
      await t.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing, reason: 'a reversed entry has no actions');
    });

    // ---- edit -------------------------------------------------------------------------------
    Future<List<RequestOptions>> openEdit(WidgetTester t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, _Host(builder: (_) => JournalFormScreen(session: session, entryId: 'v1')));
      await t.tap(find.text('open'));
      await t.pumpAndSettle();
      return sent;
    }

    testWidgets('edit waits for the entry: no form and no Save until it has loaded', (t) async {
      final (session, _) = recordedSession(server);
      await t.pumpWidget(MaterialApp(home: JournalFormScreen(session: session, entryId: 'v1')));
      await t.pump();
      expect(find.text('Save changes'), findsNothing);
      expect(find.byType(KSpinner), findsOneWidget);
      await t.pumpAndSettle();
      expect(find.text('Save changes'), findsOneWidget);
      expect(find.text('Edit journal entry'), findsOneWidget);
    });

    testWidgets('an entry that fails to load shows Try again, no form and no Save', (t) async {
      detailFails = 1;
      await openEdit(t);
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Save changes'), findsNothing);
      expect(find.text('Entry details'), findsNothing);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Save changes'), findsOneWidget);
    });

    testWidgets('a locked entry is refused with a reason and Open on website', (t) async {
      entryLocked = true;
      await openEdit(t);
      expect(find.text('This journal entry is locked. Unlock it before it can be edited.'), findsOneWidget);
      expect(find.text('Open on website'), findsOneWidget);
      expect(find.text('Save changes'), findsNothing);
    });

    testWidgets('a reversed entry is refused the same way', (t) async {
      entryReversed = true;
      await openEdit(t);
      expect(find.text('This journal entry has been reversed and can no longer be edited.'), findsOneWidget);
      expect(find.text('Open on website'), findsOneWidget);
      expect(find.text('Save changes'), findsNothing);
    });

    testWidgets('the form opens filled in and an untouched save sends nothing', (t) async {
      final sent = await openEdit(t);
      expect(find.text('Rent expense'), findsOneWidget);
      expect(find.text('Cash in hand'), findsOneWidget);
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'PATCH', '/api/journal-entries/v1'), 0);
    });

    testWidgets('a narration edit sends only the narration', (t) async {
      final sent = await openEdit(t);
      await t.enterText(textFieldLabelled('Narration'), 'Office rent');
      await t.pumpAndSettle();
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'PATCH', '/api/journal-entries/v1'), 1);
      expect(lastBody(sent, 'PATCH', '/api/journal-entries/v1'), {'narration': 'Office rent'});
      expectNoIdentity(lastBody(sent, 'PATCH', '/api/journal-entries/v1'));
    });

    testWidgets('an amount edit sends every line (the route replaces them all)', (t) async {
      final sent = await openEdit(t);
      final amounts = find.byType(KAmountField);
      await t.enterText(find.descendant(of: amounts.at(0), matching: find.byType(TextField)), '6000');
      await t.pumpAndSettle();
      // Debit 6000 against credit 5000 does not balance: Save waits.
      await t.tap(find.text('Save changes'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'PATCH', '/api/journal-entries/v1'), 0);
      await t.enterText(find.descendant(of: amounts.at(1), matching: find.byType(TextField)), '6000');
      await t.pumpAndSettle();
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      final body = lastBody(sent, 'PATCH', '/api/journal-entries/v1');
      expect(body.keys, ['lines']);
      expect((body['lines'] as List).map((l) => [(l as Map)['account_id'], l['debit'], l['credit']]).toList(), [
        ['a-rent', 6000, 0],
        ['a-cash', 0, 6000],
      ]);
      final lines = body['lines'] as List;
      expect((lines[0] as Map)['reference_number'], 'REF-1', reason: 'an edited entry keeps its line reference');
      expect((lines[1] as Map).containsKey('reference_number'), isFalse);
    });

    testWidgets('a refused save shows the server message and keeps the form filled', (t) async {
      patchRefuse = 'Cannot edit this journal entry: the period containing 2026-11-03 is locked.';
      final sent = await openEdit(t);
      await t.enterText(textFieldLabelled('Narration'), 'Office rent');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(find.text('Cannot edit this journal entry: the period containing 2026-11-03 is locked.'), findsOneWidget);
      expect(find.text('Save changes'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/journal-entries/v1'), 1);
      expect(find.text('Office rent'), findsOneWidget);
    });

    testWidgets('Edit entry on the detail opens the form and returns to a reloaded detail', (t) async {
      final sent = await openDetail(t);
      await t.tap(find.text('Edit entry'));
      await t.pumpAndSettle();
      expect(find.byType(JournalFormScreen), findsOneWidget);
      await t.enterText(textFieldLabelled('Narration'), 'Office rent');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(find.byType(JournalFormScreen), findsNothing);
      expect(find.byType(JournalDetailScreen), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/journal-entries/v1'), 3, reason: 'detail, form, detail again');
    });

    // ---- routes and the ledger -------------------------------------------------------------
    testWidgets('the route table opens the journal list and stillGeneric no longer holds it', (t) async {
      final (session, _) = recordedSession(server);
      expect(nativeScreenFor(session, '/journal-entries'), isA<JournalEntriesScreen>());
      expect(stillGeneric.contains('/journal-entries'), isFalse);
    });

    testWidgets('a journal row in an account ledger opens the phone journal, not the website', (t) async {
      final (session, _) = recordedSession((o, b) {
        if (o.uri.path == '/api/ledger/account/a-cash') {
          return (
            200,
            {
              'account': {'account_name': 'Cash in hand', 'account_code': '1101', 'nature': 'debit'},
              'opening_balance': 0,
              'closing_balance': 5000,
              'entries': [
                {'entry_date': '2026-11-03', 'voucher_id': 'v1', 'voucher_type': 'journal', 'debit': 5000, 'credit': 0, 'running_balance': 5000},
              ],
            },
          );
        }
        return server(o, b);
      });
      await pumpScreen(t, AccountLedgerScreen(session: session, accountId: 'a-cash'));
      await t.tap(find.text('Journal'));
      await t.pumpAndSettle();
      expect(find.byType(JournalDetailScreen), findsOneWidget);
      expect(find.text('Rent expense'), findsOneWidget);
    });
  });
}
