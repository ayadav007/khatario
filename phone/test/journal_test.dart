import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/accounting/journal_logic.dart';

JournalLine _l(String account, bool debit, String amount, {String narration = ''}) =>
    JournalLine(accountId: account, accountLabel: account, debit: debit, amount: amount, narration: narration);

void main() {
  group('journal logic', () {
    test('paise reads typed money exactly', () {
      expect(journalPaise('10'), 1000);
      expect(journalPaise('10.5'), 1050);
      expect(journalPaise('0.07'), 7);
      expect(journalPaise(''), isNull);
      expect(journalPaise('abc'), isNull);
    });

    test('0.1 + 0.2 balances against 0.3', () {
      final lines = [_l('a', true, '0.1'), _l('b', true, '0.2'), _l('c', false, '0.3')];
      expect(journalTotals(lines), (debit: 30, credit: 30));
      expect(journalBalanced(lines), isTrue);
    });

    test('equal debit and credit on two lines balances', () {
      expect(journalBalanced([_l('a', true, '100'), _l('b', false, '100')]), isTrue);
    });

    test('a difference of one paisa does not balance', () {
      expect(journalBalanced([_l('a', true, '100.01'), _l('b', false, '100')]), isFalse);
    });

    test('needs at least two lines with an account and an amount', () {
      expect(journalBalanced([_l('a', true, '100')]), isFalse);
      expect(journalBalanced([_l('a', true, '100'), _l('', false, '100')]), isFalse);
      expect(journalBalanced([_l('a', true, '100'), _l('b', false, '')]), isFalse);
      expect(journalBalanced([_l('a', true, ''), _l('b', false, '')]), isFalse, reason: 'both totals are zero');
    });

    test('a blank extra line is ignored', () {
      expect(journalBalanced([_l('a', true, '5'), _l('b', false, '5'), _l('', true, '')]), isTrue);
    });

    test('body keeps the other side at 0 and drops blank lines', () {
      final body = journalBody(
        date: DateTime(2026, 11, 3),
        reference: ' R1 ',
        narration: ' Rent ',
        branchId: 'br1',
        templateId: null,
        lines: [_l('a', true, '100.5', narration: ' x '), _l('b', false, '100.50'), _l('', true, '')],
      );
      expect(body, {
        'branch_id': 'br1',
        'entry_date': '2026-11-03',
        'reference_number': 'R1',
        'narration': 'Rent',
        'lines': [
          {'account_id': 'a', 'debit': 100.5, 'credit': 0, 'narration': 'x'},
          {'account_id': 'b', 'debit': 0, 'credit': 100.5, 'narration': null},
        ],
      });
    });

    test('body sends nulls for empty reference and narration, and the template id when used', () {
      final body = journalBody(
        date: DateTime(2026, 1, 9),
        reference: '',
        narration: '',
        branchId: null,
        templateId: 't1',
        lines: [_l('a', true, '2'), _l('b', false, '2')],
      );
      expect(body['reference_number'], isNull);
      expect(body['narration'], isNull);
      expect(body['template_id'], 't1');
      expect((body['lines'] as List).first['debit'], 2);
      expect(body.containsKey('business_id') || body.containsKey('created_by') || body.containsKey('user_id'), isFalse);
    });

    test('a template fills lines; blank amounts stay blank', () {
      final lines = journalLinesFromTemplate([
        {'account_id': 'a1', 'debit': 500, 'credit': 0, 'narration': 'Rent'},
        {'account_id': 'a2', 'debit': 0, 'credit': '500.00'},
        {'account_id': 'a3', 'debit': null, 'credit': ''},
        {'account_id': 'a4', 'debit': '', 'credit': null},
        {'debit': 1},
      ]);
      expect(lines.length, 4, reason: 'a line with no account is skipped');
      expect((lines[0].accountId, lines[0].debit, lines[0].amount, lines[0].narration), ('a1', true, '500', 'Rent'));
      expect((lines[1].accountId, lines[1].debit, lines[1].amount), ('a2', false, '500'));
      expect((lines[2].debit, lines[2].amount), (true, ''));
      expect((lines[3].debit, lines[3].amount), (true, ''));
    });

    test('template date offset moves today', () {
      expect(journalTemplateDate(DateTime(2026, 11, 10), {'entry_date_offset': -1}), DateTime(2026, 11, 9));
      expect(journalTemplateDate(DateTime(2026, 11, 10), {}), DateTime(2026, 11, 10));
    });
  });

  group('back-dating', () {
    final today = DateTime(2026, 11, 10, 15, 30);
    test('days back count from local midnights', () {
      expect(journalDaysBack(today, DateTime(2026, 11, 10)), 0);
      expect(journalDaysBack(today, DateTime(2026, 11, 9, 23, 59)), 1);
      expect(journalDaysBack(today, DateTime(2026, 11, 11)), -1);
      expect(journalDaysBack(today, DateTime(2026, 10, 11)), 30);
      expect(journalDaysBack(today, DateTime(2026, 10, 10)), 31);
    });

    test('a reason is needed from 31 days back, not at 30', () {
      expect(journalNeedsBackdateReason(today, DateTime(2026, 10, 11)), isFalse);
      expect(journalNeedsBackdateReason(today, DateTime(2026, 10, 10)), isTrue);
      expect(journalNeedsBackdateReason(today, DateTime(2026, 11, 12)), isFalse);
    });

    test('body carries backdate_reason only when given', () {
      Map<String, dynamic> b(String? r) => journalBody(
            date: DateTime(2026, 9, 1),
            reference: '',
            narration: '',
            branchId: null,
            templateId: null,
            backdateReason: r,
            lines: [_l('a', true, '2'), _l('b', false, '2')],
          );
      expect(b(' Missed entry ')['backdate_reason'], 'Missed entry');
      expect(b(null).containsKey('backdate_reason'), isFalse);
      expect(b('  ').containsKey('backdate_reason'), isFalse);
    });
  });
}
