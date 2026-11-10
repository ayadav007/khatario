import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/accounting/journal_form_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/kit.dart';

/// A server that answers like the journal routes and records what was sent.
class _Api extends KhatarioApi {
  _Api({this.refuse, this.templateFails = 0, this.templateCode, this.templates, this.noLinesInList = false}) : super(Dio());

  final String? refuse, templateCode;
  int templateFails;
  final bool noLinesInList;
  final List<Map<String, dynamic>>? templates;
  final gets = <String>[];
  final posts = <(String, Map<String, dynamic>)>[];

  static final _tplLines = [
    {'account_id': 'a-rent', 'debit': 5000, 'credit': 0, 'narration': 'Rent for month'},
    {'account_id': 'a-cash', 'debit': 0, 'credit': '5000.00'},
  ];

  Map<String, dynamic> _reply(String path) {
    gets.add(path);
    final uri = Uri.parse(path);
    if (uri.path == '/api/accounts') {
      return {
        'accounts': [
          {'id': 'a-cash', 'account_code': '1001', 'account_name': 'Cash in hand'},
          {'id': 'a-rent', 'account_code': '5201', 'account_name': 'Rent expense'},
          {'id': 'a-cap', 'account_code': '3001', 'account_name': 'Capital'},
        ],
      };
    }
    if (uri.path.startsWith('/api/accounts/')) {
      final id = uri.path.split('/').last;
      final names = {'a-cash': 'Cash in hand', 'a-rent': 'Rent expense', 'a-cap': 'Capital'};
      return {
        'account': {'id': id, 'account_name': names[id]},
      };
    }
    if (uri.path == '/api/journal-entries/templates') {
      if (templateFails > 0) {
        templateFails--;
        throw ApiException(templateCode == null ? 'Server is down' : 'Not included', status: templateCode == null ? 500 : 403, code: templateCode);
      }
      return {
        'templates': templates ??
            [
              {'id': 't1', 'name': 'Monthly rent', 'description': 'Rent paid in cash', 'entry_date_offset': 0, if (!noLinesInList) 'lines': _tplLines},
              {
                'id': 't2',
                'name': 'Blank sides',
                'description': null,
                'entry_date_offset': 0,
                'lines': [
                  {'account_id': 'a-cap', 'debit': null, 'credit': null},
                  {'account_id': 'a-cash', 'debit': null, 'credit': 0},
                ],
              },
            ],
      };
    }
    if (uri.path == '/api/journal-entries/templates/t1') {
      return {
        'template': {'id': 't1', 'name': 'Monthly rent', 'entry_date_offset': 0, 'lines': _tplLines},
      };
    }
    return {};
  }

  @override
  Future<dynamic> getData(String path) async => _reply(path);

  @override
  Future<Map<String, dynamic>> getJson(String path) async => _reply(path);

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    await Future<void>.delayed(const Duration(milliseconds: 20));
    if (refuse != null) throw ApiException(refuse!, status: 403, code: 'PERIOD_LOCKED');
    posts.add((path, body));
    return {
      'entry': {'voucher_id': 'v1'},
    };
  }
}

AppSession _session(_Api api) => AppSession(api, {
      'user': {'id': 'u'},
      'business': {'id': 'b'},
      'branches': [
        {'id': 'br1', 'is_active': true},
      ],
    });

Future<void> _open(WidgetTester t, _Api api) async {
  t.view.physicalSize = const Size(800, 3600);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  await t.pumpWidget(MaterialApp(
    home: Builder(
      builder: (c) => TextButton(
        onPressed: () => Navigator.of(c).push(MaterialPageRoute(builder: (_) => JournalFormScreen(session: _session(api)))),
        child: const Text('go'),
      ),
    ),
  ));
  await t.tap(find.text('go'));
  await t.pumpAndSettle();
}

Finder _card(int i) => find.byKey(ValueKey('journal-line-$i'));

Finder _in(int i, Finder what) => find.descendant(of: _card(i), matching: what);

String _amountText(WidgetTester t, int i) => t.widget<TextField>(_in(i, find.byType(TextField)).first).controller!.text;

Future<void> _account(WidgetTester t, int i, String name) async {
  await t.tap(_in(i, find.byType(KAsyncPickField)));
  await t.pumpAndSettle();
  await t.tap(find.descendant(of: find.byType(KListRow), matching: find.text(name)));
  await t.pumpAndSettle();
}

Future<void> _amount(WidgetTester t, int i, String text) async {
  await t.enterText(_in(i, find.byType(TextField)).first, text);
  await t.pump();
}

Future<void> _credit(WidgetTester t, int i) async {
  await t.tap(_in(i, find.text('Credit')));
  await t.pump();
}

Future<void> _balanced(WidgetTester t) async {
  await _account(t, 0, 'Rent expense');
  await _amount(t, 0, '1500');
  await _account(t, 1, 'Cash in hand');
  await _credit(t, 1);
  await _amount(t, 1, '1500');
}

final _removeButtons = find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == 'Remove line');

KButton _save(WidgetTester t) => t.widget<KButton>(find.widgetWithText(KButton, 'Post entry'));

Future<void> _useTemplate(WidgetTester t, String name) async {
  await t.tap(find.text('Use a template'));
  await t.pumpAndSettle();
  await t.tap(find.descendant(of: find.byType(KListRow), matching: find.text(name)));
  await t.pumpAndSettle();
}

void main() {
  group('journal form', () {
    testWidgets('Save stays disabled until debit equals credit', (t) async {
      await _open(t, _Api());
      expect(_save(t).onPressed, isNull);
      await _account(t, 0, 'Rent expense');
      await _amount(t, 0, '1500');
      await _account(t, 1, 'Cash in hand');
      await _credit(t, 1);
      await _amount(t, 1, '1400');
      expect(_save(t).onPressed, isNull);
      expect(find.text('Difference'), findsOneWidget);
      await _amount(t, 1, '1500');
      expect(_save(t).onPressed, isNotNull);
    });

    testWidgets('the footer shows total debit, total credit and difference', (t) async {
      await _open(t, _Api());
      await _account(t, 0, 'Rent expense');
      await _amount(t, 0, '1500');
      await _account(t, 1, 'Cash in hand');
      await _credit(t, 1);
      await _amount(t, 1, '1000');
      expect(find.text('Total debit'), findsOneWidget);
      expect(find.text('Total credit'), findsOneWidget);
      expect(find.text('₹1,500'), findsOneWidget);
      expect(find.text('₹1,000'), findsOneWidget);
      expect(find.text('₹500'), findsOneWidget, reason: 'the difference');
    });

    testWidgets('a balanced entry posts the right body once', (t) async {
      final api = _Api();
      await _open(t, api);
      await _balanced(t);
      await t.tap(find.text('Post entry'));
      await t.tap(find.text('Post entry'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(api.posts.length, 1);
      final (path, body) = api.posts.single;
      expect(path, '/api/journal-entries');
      expect(body.keys.toSet(), {'branch_id', 'entry_date', 'reference_number', 'narration', 'lines'});
      expect(body['branch_id'], 'br1');
      expect(body['lines'], [
        {'account_id': 'a-rent', 'debit': 1500, 'credit': 0, 'narration': null},
        {'account_id': 'a-cash', 'debit': 0, 'credit': 1500, 'narration': null},
      ]);
      expect(find.byType(JournalFormScreen), findsNothing, reason: 'the form closes after posting');
    });

    testWidgets('a refused save shows the server message and keeps the lines', (t) async {
      final api = _Api(refuse: 'This period is locked. Ask the owner to reopen it.');
      await _open(t, api);
      await _balanced(t);
      await t.tap(find.text('Post entry'));
      await t.pumpAndSettle();
      expect(find.text('This period is locked. Ask the owner to reopen it.'), findsOneWidget);
      expect(find.byType(JournalFormScreen), findsOneWidget);
      expect(find.text('Rent expense'), findsOneWidget);
      expect(find.text('Cash in hand'), findsOneWidget);
      expect(_amountText(t, 0), '1500');
    });

    testWidgets('a date more than 30 days back asks for a reason before posting', (t) async {
      final api = _Api();
      await _open(t, api);
      await _balanced(t);
      expect(find.text('Reason for back-dating'), findsNothing);
      final back = DateTime.now().subtract(const Duration(days: 40));
      await t.tap(find.byType(KDateField));
      await t.pumpAndSettle();
      await t.tap(find.byIcon(Icons.edit_outlined));
      await t.pumpAndSettle();
      final mm = back.month.toString().padLeft(2, '0');
      final dd = back.day.toString().padLeft(2, '0');
      await t.enterText(find.byType(TextField).last, '$mm/$dd/${back.year}');
      await t.tap(find.text('OK'));
      await t.pumpAndSettle();
      expect(find.text('Reason for back-dating'), findsOneWidget);
      await t.tap(find.text('Post entry'));
      await t.pumpAndSettle();
      expect(find.text('Enter a reason for back-dating this entry'), findsOneWidget);
      expect(api.posts, isEmpty);
      await t.enterText(find.descendant(of: find.widgetWithText(Column, 'Reason for back-dating').first, matching: find.byType(TextField)).first, 'Missed entry');
      await t.pump();
      await t.tap(find.text('Post entry'));
      await t.pumpAndSettle();
      expect(api.posts.single.$2['backdate_reason'], 'Missed entry');
    });

    testWidgets('a template account name is read by id, not from a capped search', (t) async {
      final api = _Api();
      await _open(t, api);
      await _useTemplate(t, 'Monthly rent');
      expect(api.gets, containsAll(['/api/accounts/a-rent', '/api/accounts/a-cash']));
      expect(api.gets.where((g) => g.startsWith('/api/accounts?')), isEmpty);
      expect(find.text('Rent expense'), findsOneWidget);
    });

    testWidgets('Remove line is disabled with two lines and removes a third', (t) async {
      await _open(t, _Api());
      expect(_card(2), findsNothing);
      await t.tap(find.text('Add line'));
      await t.pumpAndSettle();
      expect(_card(2), findsOneWidget);
      await _account(t, 2, 'Capital');
      expect(_removeButtons, findsNWidgets(3));
      await t.tap(_removeButtons.last);
      await t.pumpAndSettle();
      expect(_card(2), findsNothing);
      expect(find.text('Capital'), findsNothing);
      // Two lines left: the controls are disabled and a tap removes nothing.
      await t.tap(_removeButtons.first, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(_card(0), findsOneWidget);
      expect(_card(1), findsOneWidget);
      expect(_removeButtons, findsNWidgets(2));
      expect(find.ancestor(of: _removeButtons.first, matching: find.byWidgetPredicate((w) => w is IgnorePointer && w.ignoring)), findsOneWidget);
    });

    testWidgets('Use a template fills the lines with names, sides and amounts', (t) async {
      final api = _Api();
      await _open(t, api);
      await _useTemplate(t, 'Monthly rent');
      expect(find.text('Rent expense'), findsOneWidget);
      expect(find.text('Cash in hand'), findsOneWidget);
      expect(_amountText(t, 0), '5000');
      expect(_amountText(t, 1), '5000');
      expect(t.widget<TextField>(_in(0, find.byType(TextField)).last).controller!.text, 'Rent for month');
      expect(_save(t).onPressed, isNotNull);
      await t.tap(find.text('Post entry'));
      await t.pumpAndSettle();
      final body = api.posts.single.$2;
      expect(body['template_id'], 't1');
      expect((body['lines'] as List).map((l) => (l['debit'], l['credit'])).toList(), [(5000, 0), (0, 5000)]);
    });

    testWidgets('template amounts left blank stay blank', (t) async {
      await _open(t, _Api());
      await _useTemplate(t, 'Blank sides');
      expect(find.text('Capital'), findsOneWidget);
      expect(_amountText(t, 0), '');
      expect(_amountText(t, 1), '');
      expect(_save(t).onPressed, isNull);
    });

    testWidgets('a template with no lines in the list is read from its own page', (t) async {
      final api = _Api(noLinesInList: true);
      await _open(t, api);
      await _useTemplate(t, 'Monthly rent');
      expect(api.gets, contains('/api/journal-entries/templates/t1'));
      expect(find.text('Rent expense'), findsOneWidget);
    });

    testWidgets('a template asks before replacing lines, and Keep leaves them', (t) async {
      await _open(t, _Api());
      await _account(t, 0, 'Capital');
      await _amount(t, 0, '10');
      await _useTemplate(t, 'Monthly rent');
      expect(find.text('Replace the current lines?'), findsOneWidget);
      await t.tap(find.text('Keep my lines'));
      await t.pumpAndSettle();
      expect(find.text('Capital'), findsOneWidget);
      expect(find.text('Rent expense'), findsNothing);

      await _useTemplate(t, 'Monthly rent');
      await t.tap(find.text('Replace'));
      await t.pumpAndSettle();
      expect(find.text('Capital'), findsNothing);
      expect(find.text('Rent expense'), findsOneWidget);
    });

    testWidgets('template list failure offers Try again', (t) async {
      await _open(t, _Api(templateFails: 1));
      await t.tap(find.text('Use a template'));
      await t.pumpAndSettle();
      expect(find.text('Server is down'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Monthly rent'), findsOneWidget);
    });

    testWidgets('a plan without templates says so in the sheet', (t) async {
      await _open(t, _Api(templateFails: 1, templateCode: 'FEATURE_NOT_IN_PLAN'));
      await t.tap(find.text('Use a template'));
      await t.pumpAndSettle();
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('no saved templates shows an empty message', (t) async {
      await _open(t, _Api(templates: []));
      await t.tap(find.text('Use a template'));
      await t.pumpAndSettle();
      expect(find.text('No templates yet'), findsOneWidget);
    });
  });
}
