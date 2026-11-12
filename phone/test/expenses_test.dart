import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/expenses/expense_categories_screen.dart';
import 'package:khatario_phone/screens/expenses/expense_form_screen.dart';
import 'package:khatario_phone/screens/expenses/expense_logic.dart';
import 'package:khatario_phone/screens/expenses/expenses_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/session.dart';

/// A server that answers like the expense routes and records what was sent.
class _Api extends KhatarioApi {
  _Api({
    this.bill = const {'amount': 1180, 'cgst': 90, 'sgst': 90, 'igst': 0, 'intra_state': true},
    this.previewFails = false,
    this.refuse,
    this.refuseDelete,
    this.failRefs = 0,
    this.failList = 0,
    this.failCategories = 0,
    this.failAccounts = 0,
    this.failCode,
    this.noCategories = false,
    List<Map<String, dynamic>>? rows,
  })  : rows = rows ?? _rows,
        super(Dio());

  final Map<String, dynamic> bill;
  final bool previewFails;
  final String? refuse, refuseDelete, failCode;
  final bool noCategories;
  final List<Map<String, dynamic>> rows;

  /// How many reads of the form data / the list / the categories fail before one works.
  int failRefs, failList, failCategories, failAccounts;

  final gets = <String>[];
  final posts = <(String, Map<String, dynamic>)>[];
  final puts = <String, Map<String, dynamic>>{};
  final patches = <String, Map<String, dynamic>>{};
  final deletes = <String>[];
  final previews = <Map<String, dynamic>>[];

  Map<String, dynamic> _reply(String path) {
    gets.add(path);
    final uri = Uri.parse(path);
    switch (uri.path) {
      case '/api/expense-categories':
        if (failCategories > 0) {
          failCategories--;
          throw ApiException('Server is down', status: 500, code: failCode);
        }
        if (failRefs > 0) {
          failRefs--;
          throw ApiException('Server is down', status: 500, code: failCode);
        }
        return {
          'categories': noCategories ? [] : _categories,
        };
      case '/api/expense-items':
        return {
          'items': [
            {'id': 'i1', 'name': 'Office rent', 'item_type': 'service', 'tax_rate': 18.0},
          ],
        };
      case '/api/accounting/settlement-accounts':
        if (failAccounts > 0) {
          failAccounts--;
          throw ApiException('Server is down', status: 500);
        }
        return {
          'mode_class': uri.queryParameters['payment_mode'] == 'on_account' ? 'on_account' : 'cash',
          'accounts': [
            {'id': 'a1', 'account_code': '1001', 'account_name': 'Cash in hand', 'kind': 'cash'},
          ],
          'default_account_id': 'a1',
          'selection_required': false,
        };
      case '/api/accounts':
        return {
          'accounts': [
            {'id': 'ac1', 'account_code': '5101', 'account_name': 'Salaries'},
            {'id': 'ac2', 'account_code': '5201', 'account_name': 'Rent expense'},
          ],
        };
      case '/api/expenses':
        if (failList > 0) {
          failList--;
          throw ApiException('Server is down', status: 500, code: failCode);
        }
        return {'expenses': rows};
      case '/api/expenses/e1':
        return {'expense': _saved};
      case '/api/suppliers':
        return {'suppliers': []};
    }
    return {};
  }

  @override
  Future<dynamic> getData(String path) async => _reply(path);

  @override
  Future<Map<String, dynamic>> getJson(String path) async => _reply(path);

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    if (path == '/api/expenses/preview') {
      previews.add(body);
      if (previewFails) throw ApiException('Could not preview this expense', status: 400);
      return {'bill': bill, 'lines': []};
    }
    if (refuse != null) throw ApiException(refuse!, status: 403, code: 'PERIOD_LOCKED');
    posts.add((path, body));
    return switch (path) {
      '/api/expense-categories' => {
          'category': {'id': 'c9', 'name': body['name'], 'account_id': body['account_id']},
        },
      '/api/expense-items' => {
          'item': {'id': 'i9', 'name': body['name'], 'item_type': body['item_type'], 'tax_rate': body['tax_rate']},
        },
      _ => {
          'expense': {'id': 'e9'},
        },
    };
  }

  @override
  Future<Map<String, dynamic>> putJson(String path, Map<String, dynamic> body) async {
    if (refuse != null) throw ApiException(refuse!, status: 403, code: 'PERIOD_LOCKED');
    puts[path] = body;
    return {'expense': _saved};
  }

  @override
  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async {
    if (refuse != null) throw ApiException(refuse!, status: 409);
    patches[path] = body;
    return {
      'category': {'id': 'c1', ...body},
    };
  }

  @override
  Future<Map<String, dynamic>> deleteJson(String path, {Map<String, dynamic>? body}) async {
    if (refuseDelete != null) throw ApiException(refuseDelete!, status: 403, code: 'PERIOD_LOCKED');
    deletes.add(path);
    return {'success': true};
  }
}

final _categories = <Map<String, dynamic>>[
  {'id': 'c1', 'name': 'Rent', 'description': null, 'account_id': 'ac2', 'ledger_account_code': '5201', 'ledger_account_name': 'Rent expense'},
  {'id': 'c2', 'name': 'Travel', 'description': null, 'account_id': null, 'ledger_account_code': null, 'ledger_account_name': null},
];

final _saved = <String, dynamic>{
  'id': 'e1',
  'category_id': 'c1',
  'amount': '1180.00',
  'description': 'Rent',
  'expense_date': '2026-11-03',
  'payment_mode': 'cash',
  'settlement_account_id': 'a1',
  'reference_number': null,
  'supplier_id': null,
  'prices_include_gst': true,
  'cgst_amount': '90.00',
  'sgst_amount': '90.00',
  'igst_amount': '0.00',
  'updated_at': '2026-11-03 10:00:00.123456',
  'lines': [
    {'line_no': 1, 'expense_item_id': 'i1', 'item_name': 'Office rent', 'quantity': 1.0, 'unit_price': 1180.0, 'tax_rate': 18.0, 'line_total': 1180.0},
  ],
};

final _rows = <Map<String, dynamic>>[
  {
    'id': 'e1',
    'category_id': 'c1',
    'category_name': 'Rent',
    'amount': 1180,
    'description': 'Office rent for November',
    'expense_date': '2026-11-03T06:30:00.000Z',
    'created_at': '2026-11-09T08:00:00.000Z',
    'payment_mode': 'cash',
  },
  {
    'id': 'e2',
    'category_id': 'c2',
    'category_name': 'Travel',
    'amount': 300,
    'description': '',
    'expense_date': '2026-10-20T06:30:00.000Z',
    'created_at': '2026-11-09T08:05:00.000Z',
    'payment_mode': 'on_account',
  },
];

AppSession _session(_Api api) => AppSession(api, {
      'user': {'id': 'u'},
      'business': {'id': 'b'},
    });

Future<void> _tall(WidgetTester t) async {
  t.view.physicalSize = const Size(800, 3200);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
}

Future<void> _openForm(WidgetTester t, AppSession s, {Map<String, dynamic>? expense}) async {
  await _tall(t);
  await t.pumpWidget(MaterialApp(
    home: Builder(
      builder: (c) => TextButton(
        onPressed: () => Navigator.of(c).push(MaterialPageRoute(builder: (_) => ExpenseFormScreen(session: s, expense: expense))),
        child: const Text('go'),
      ),
    ),
  ));
  await t.tap(find.text('go'));
  await t.pumpAndSettle();
}

Future<void> _openDetail(WidgetTester t, _Api api) async {
  await _tall(t);
  await t.pumpWidget(MaterialApp(home: ExpensesScreen(session: _session(api))));
  await t.pumpAndSettle();
  await t.tap(find.text('Office rent for November'));
  await t.pumpAndSettle();
}

/// The text box under the label [label].
Finder _field(String label) => find.descendant(
      of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first,
      matching: find.byType(TextField),
    );

String _text(WidgetTester t, String label) => t.widget<TextField>(_field(label)).controller!.text;

/// The detail page keeps a spinner on its button while an action runs, so it never "settles".
Future<void> _settle(WidgetTester t) async {
  await t.pump();
  await t.pump(const Duration(milliseconds: 600));
}

/// Opens the pick field [label] and taps [option] in its sheet.
Future<void> _pickFrom(WidgetTester t, String label, String option) async {
  await t.tap(find.descendant(
    of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first,
    matching: find.byType(InkWell),
  ).first);
  await t.pumpAndSettle();
  await t.tap(find.text(option).last);
  await t.pumpAndSettle();
}

void main() {
  group('logic', () {
    test('inclusive-GST create body is one line at the typed amount, with the flag', () {
      final b = expenseBody(
        branchId: 'br1',
        categoryId: 'c1',
        itemId: 'i1',
        amount: '1180',
        rate: 18,
        includesGst: true,
        supplierId: '',
        mode: 'cash',
        accountId: 'a1',
        date: DateTime(2026, 11, 3),
        reference: ' B-77 ',
        description: ' Shop rent ',
        idempotencyKey: 'exp-abc12345',
      );
      expect(b, {
        'branch_id': 'br1',
        'category_id': 'c1',
        'expense_date': '2026-11-03',
        'reference_number': 'B-77',
        'description': 'Shop rent',
        'payment_mode': 'cash',
        'settlement_account_id': 'a1',
        'supplier_id': null,
        'prices_include_gst': true,
        'lines': [
          {'expense_item_id': 'i1', 'quantity': 1, 'unit_price': 1180, 'tax_rate': 18},
        ],
        'idempotency_key': 'exp-abc12345',
      });
      for (final k in ['business_id', 'user_id', 'created_by', 'amount', 'cgst_amount']) {
        expect(b.containsKey(k), isFalse, reason: k);
      }
    });

    test('blank optionals become null and an exclusive bill says so', () {
      final b = expenseBody(
        branchId: null,
        categoryId: 'c1',
        itemId: 'i1',
        amount: '250.50',
        rate: 5,
        includesGst: false,
        supplierId: 's1',
        mode: 'on_account',
        accountId: '',
        date: DateTime(2026, 1, 9),
        reference: '',
        description: '',
        idempotencyKey: 'exp-abc12345',
      );
      expect(b['reference_number'], isNull);
      expect(b['settlement_account_id'], isNull);
      expect(b['supplier_id'], 's1');
      expect(b['prices_include_gst'], false);
      expect(b.containsKey('branch_id'), isFalse);
      expect((b['lines'] as List).single['unit_price'], 250.5);
    });

    test('validation messages', () {
      ExpenseErrors v({String category = 'c', String? item = 'i', String amount = '10', bool accountRequired = false, String account = ''}) =>
          validateExpense(categoryId: category, itemId: item, amount: amount, accountRequired: accountRequired, accountId: account);
      expect(v(category: '').category, isNotNull);
      expect(v(item: '').item, isNotNull);
      expect(v(amount: '').amount, isNotNull);
      expect(v(amount: '0').amount, isNotNull);
      expect(v(amount: '.').amount, isNotNull);
      expect(v(accountRequired: true).account, isNotNull);
      expect(v(accountRequired: true, account: 'a').account, isNull);
      expect(v().ok, isTrue);
      // An expense saved as one amount has no item to choose.
      expect(validateExpense(categoryId: 'c', itemId: null, amount: '10').ok, isTrue);
    });

    final saved = {
      'id': 'e1',
      'category_id': 'c1',
      'amount': '1180.00',
      'description': 'Rent',
      'expense_date': '2026-11-03',
      'payment_mode': 'cash',
      'settlement_account_id': 'a1',
      'reference_number': null,
      'supplier_id': null,
      'prices_include_gst': true,
      'updated_at': '2026-11-03 10:00:00.123456',
      'lines': [
        {'expense_item_id': 'i1', 'item_name': 'Rent', 'quantity': 1.0, 'unit_price': 1180.0, 'tax_rate': 18.0, 'line_total': 1180.0},
      ],
    };

    Map<String, dynamic> edit(
      Map<String, dynamic> existing, {
      String category = 'c1',
      String? item = 'i1',
      String amount = '1180',
      num rate = 18,
      bool includes = true,
      String supplier = '',
      String mode = 'cash',
      String account = 'a1',
      DateTime? date,
      String reference = '',
      String description = 'Rent',
    }) =>
        expenseEditBody(
          existing: existing,
          categoryId: category,
          itemId: item,
          amount: amount,
          rate: rate,
          includesGst: includes,
          supplierId: supplier,
          mode: mode,
          accountId: account,
          date: date ?? DateTime(2026, 11, 3),
          reference: reference,
          description: description,
        );

    test('edit body is empty when nothing changed', () {
      expect(edit(saved), isEmpty);
    });

    test('edit body carries the changed key, the lines the server requires, and the version', () {
      final b = edit(saved, description: 'Rent for November');
      expect(b, {
        'description': 'Rent for November',
        'lines': [
          {'expense_item_id': 'i1', 'quantity': 1, 'unit_price': 1180, 'tax_rate': 18},
        ],
        'expected_updated_at': '2026-11-03 10:00:00.123456',
      });
    });

    test('edit body re-sends lines with the new amount and rate', () {
      final b = edit(saved, amount: '2000', rate: 5);
      expect((b['lines'] as List).single, {'expense_item_id': 'i1', 'quantity': 1, 'unit_price': 2000, 'tax_rate': 5});
      expect(b.keys.toSet(), {'lines', 'expected_updated_at'});
    });

    test('edit of an expense saved as one amount sends amount only when it changed', () {
      final header = {...saved, 'lines': <dynamic>[]};
      expect(edit(header, item: null), isEmpty);
      final b = edit(header, item: null, amount: '900', description: 'Rent');
      expect(b, {'amount': 900, 'expected_updated_at': '2026-11-03 10:00:00.123456'});
    });

    test('edit of a many-line bill keeps its lines as they were', () {
      final many = {
        ...saved,
        'lines': [
          {'expense_item_id': 'i1', 'quantity': 2.0, 'unit_price': 100.0, 'tax_rate': 18.0},
          {'expense_item_id': 'i2', 'quantity': 1.0, 'unit_price': 50.5, 'tax_rate': 0.0},
        ],
      };
      final b = edit(many, item: null, description: 'Changed');
      expect(b['lines'], [
        {'expense_item_id': 'i1', 'quantity': 2, 'unit_price': 100, 'tax_rate': 18},
        {'expense_item_id': 'i2', 'quantity': 1, 'unit_price': 50.5, 'tax_rate': 0},
      ]);
      expect(b['description'], 'Changed');
    });

    test('edit to on-account clears the cash account', () {
      final b = edit(saved, mode: 'on_account', account: '', supplier: 's1');
      expect(b['payment_mode'], 'on_account');
      expect(b['settlement_account_id'], isNull);
      expect(b['supplier_id'], 's1');
    });

    test('preview body is ready only with a category, an item and an amount', () {
      Map<String, dynamic>? p({String category = 'c1', String? item = 'i1', String amount = '100'}) => expensePreviewBody(
            categoryId: category,
            itemId: item,
            amount: amount,
            rate: 18,
            includesGst: false,
            supplierId: '',
            mode: 'cash',
            accountId: '',
            date: DateTime(2026, 11, 3),
            description: 'x',
          );
      expect(p(category: ''), isNull);
      expect(p(item: ''), isNull);
      expect(p(amount: ''), isNull);
      final b = p()!;
      expect(b['lines'], [
        {'expense_item_id': 'i1', 'quantity': 1, 'unit_price': 100, 'tax_rate': 18},
      ]);
      expect(b['supplier_id'], isNull);
      expect(b['settlement_account_id'], isNull);
    });

    test('bill reader returns the server numbers untouched, or null', () {
      final bill = readExpenseBill({
        'bill': {'amount': 1180, 'cgst': 90.0, 'sgst': '90', 'igst': 0, 'intra_state': true},
      })!;
      expect(bill.amount, 1180);
      expect(bill.cgst, 90);
      expect(bill.sgst, 90);
      expect(bill.intraState, isTrue);
      expect(readExpenseBill({'bill': null}), isNull);
      expect(readExpenseBill({}), isNull);
      expect(readExpenseBill('x'), isNull);
    });

    test('row text', () {
      expect(expenseTitle({'description': 'Tea', 'category_name': 'Food'}), 'Tea');
      expect(expenseTitle({'description': ' ', 'category_name': 'Food'}), 'Food');
      expect(expenseTitle({}), 'Expense');
      expect(expenseSubtitle({'category_name': 'Food', 'payment_mode': 'on_account', 'description': 'Tea'}), 'Food · On account (unpaid)');
      expect(expenseSubtitle({'category_name': 'Food', 'payment_mode': 'upi', 'description': ''}), 'UPI');
      expect(expenseModeLabel('bank_transfer'), 'Bank transfer');
      expect(expenseModeLabel(''), 'Cash');
    });
  });

  group('screens', () {
    testWidgets('create sends the right body once', (t) async {
      final api = _Api();
      await _openForm(t, _session(api));
      await _pickFrom(t, 'Category', 'Rent');
      await _pickFrom(t, 'Expense item', 'Office rent');
      expect(find.text('18%'), findsOneWidget, reason: 'the item brings its GST rate');
      await t.enterText(_field('Amount'), '1180');
      await t.tap(find.text('Amount includes GST'));
      await t.enterText(_field('Description'), 'November rent');
      await t.pump();
      await t.tap(find.text('Save expense'));
      await t.tap(find.text('Save expense'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(api.posts.where((p) => p.$1 == '/api/expenses'), hasLength(1));
      final body = api.posts.firstWhere((p) => p.$1 == '/api/expenses').$2;
      expect(body['category_id'], 'c1');
      expect(body['payment_mode'], 'cash');
      expect(body['settlement_account_id'], 'a1');
      expect(body['prices_include_gst'], true);
      expect(body['description'], 'November rent');
      expect(body['lines'], [
        {'expense_item_id': 'i1', 'quantity': 1, 'unit_price': 1180, 'tax_rate': 18},
      ]);
      expect(body['idempotency_key'], matches(RegExp(r'^[A-Za-z0-9_.:-]{8,128}$')));
      for (final k in ['business_id', 'user_id', 'created_by']) {
        expect(body.containsKey(k), isFalse);
      }
      expect(find.byType(ExpenseFormScreen), findsNothing);
    });

    testWidgets('preview totals are shown as the server sent them, after a pause', (t) async {
      // Figures that no sum of the typed amount could give.
      final api = _Api(bill: {'amount': 1234.56, 'cgst': 11.11, 'sgst': 22.22, 'igst': 0, 'intra_state': true});
      await _openForm(t, _session(api));
      expect(find.text('Bill total'), findsNothing);
      await _pickFrom(t, 'Category', 'Rent');
      await _pickFrom(t, 'Expense item', 'Office rent');
      await t.enterText(_field('Amount'), '1');
      await t.enterText(_field('Amount'), '12');
      await t.enterText(_field('Amount'), '123');
      await t.pump(const Duration(milliseconds: 200));
      expect(api.previews, isEmpty, reason: 'still inside the pause');
      await t.pump(const Duration(milliseconds: 300));
      await t.pumpAndSettle();
      expect(api.previews, hasLength(1));
      expect(api.previews.single['lines'], [
        {'expense_item_id': 'i1', 'quantity': 1, 'unit_price': 123, 'tax_rate': 18},
      ]);
      expect(find.text('Bill total'), findsOneWidget);
      expect(find.text('₹1,234.56'), findsOneWidget);
      expect(find.text('₹11.11'), findsOneWidget);
      expect(find.text('₹22.22'), findsOneWidget);
      // No amount, no totals.
      await t.enterText(_field('Amount'), '');
      await t.pumpAndSettle();
      expect(find.text('Bill total'), findsNothing);
    });

    testWidgets('nothing shows when the server has no totals', (t) async {
      final api = _Api(previewFails: true);
      await _openForm(t, _session(api));
      await _pickFrom(t, 'Category', 'Rent');
      await _pickFrom(t, 'Expense item', 'Office rent');
      await t.enterText(_field('Amount'), '100');
      await t.pump(const Duration(milliseconds: 500));
      await t.pumpAndSettle();
      expect(api.previews, hasLength(1));
      expect(find.text('Bill total'), findsNothing);
    });

    testWidgets('missing fields show errors and send nothing', (t) async {
      final api = _Api();
      await _openForm(t, _session(api));
      await t.tap(find.text('Save expense'));
      await t.pumpAndSettle();
      expect(find.text('Choose a category'), findsOneWidget);
      expect(find.text('Choose an expense item'), findsOneWidget);
      expect(find.text('Enter an amount greater than zero'), findsOneWidget);
      expect(api.posts, isEmpty);
    });

    testWidgets('a refused save shows the server message and keeps the form filled', (t) async {
      final api = _Api(refuse: 'This period is locked. Ask the owner to reopen it.');
      await _openForm(t, _session(api));
      await _pickFrom(t, 'Category', 'Rent');
      await _pickFrom(t, 'Expense item', 'Office rent');
      await t.enterText(_field('Amount'), '1180');
      await t.tap(find.text('Save expense'));
      await t.pumpAndSettle();
      expect(find.text('This period is locked. Ask the owner to reopen it.'), findsOneWidget);
      expect(find.byType(ExpenseFormScreen), findsOneWidget);
      expect(_text(t, 'Amount'), '1180');
      expect(find.text('Rent'), findsOneWidget);
    });

    testWidgets('a server error loading the form offers Try again', (t) async {
      final api = _Api(failRefs: 1);
      await _openForm(t, _session(api));
      expect(find.text('Could not load the expense form'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Save expense'), findsOneWidget);
    });

    testWidgets('a plan without expense tracking shows the plan message', (t) async {
      final api = _Api(failRefs: 1, failCode: 'FEATURE_NOT_IN_PLAN');
      await _openForm(t, _session(api));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('Add category posts the same body as the website and selects the new category', (t) async {
      final api = _Api();
      await _openForm(t, _session(api));
      await t.tap(find.text('Add category'));
      await t.pumpAndSettle();
      await t.enterText(_field('Category name'), ' Tea ');
      await t.tap(find.text('Save category'));
      await t.pumpAndSettle();
      final post = api.posts.firstWhere((p) => p.$1 == '/api/expense-categories').$2;
      expect(post, {'name': 'Tea', 'account_id': 'ac2'});
      expect(find.text('Tea'), findsOneWidget, reason: 'the new category is chosen');
    });

    testWidgets('Add expense item posts and selects it', (t) async {
      final api = _Api();
      await _openForm(t, _session(api));
      await t.tap(find.text('Add expense item'));
      await t.pumpAndSettle();
      await t.enterText(_field('Item name'), 'Courier');
      await t.tap(find.text('Save item'));
      await t.pumpAndSettle();
      final post = api.posts.firstWhere((p) => p.$1 == '/api/expense-items').$2;
      expect(post, {'name': 'Courier', 'item_type': 'service', 'tax_rate': 0});
      expect(find.text('Courier'), findsOneWidget);
    });

    testWidgets('edit is prefilled and sends only the changed keys, with lines and the version', (t) async {
      final api = _Api();
      await _openForm(t, _session(api), expense: _saved);
      expect(find.text('Edit expense'), findsOneWidget);
      expect(_text(t, 'Amount'), '1180');
      expect(_text(t, 'Description'), 'Rent');
      expect(find.text('Office rent'), findsOneWidget);
      await t.enterText(_field('Description'), 'Rent for November');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(api.puts.keys, ['/api/expenses/e1']);
      expect(api.puts['/api/expenses/e1'], {
        'description': 'Rent for November',
        'lines': [
          {'expense_item_id': 'i1', 'quantity': 1, 'unit_price': 1180, 'tax_rate': 18},
        ],
        'expected_updated_at': '2026-11-03 10:00:00.123456',
      });
      expect(api.posts.where((p) => p.$1 == '/api/expenses'), isEmpty);
    });

    testWidgets('an unchanged edit sends nothing', (t) async {
      final api = _Api();
      await _openForm(t, _session(api), expense: _saved);
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(api.puts, isEmpty);
      expect(find.byType(ExpenseFormScreen), findsNothing);
    });

    testWidgets('a bill of several lines keeps its lines and says to edit them on the website', (t) async {
      final api = _Api();
      final many = {
        ..._saved,
        'lines': [
          {'expense_item_id': 'i1', 'item_name': 'Office rent', 'quantity': 2.0, 'unit_price': 100.0, 'tax_rate': 18.0},
          {'expense_item_id': 'i2', 'item_name': 'Courier', 'quantity': 1.0, 'unit_price': 50.0, 'tax_rate': 0.0},
        ],
      };
      await _openForm(t, _session(api), expense: many);
      expect(find.textContaining('website'), findsOneWidget);
      await t.enterText(_field('Description'), 'x');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      final sent = api.puts['/api/expenses/e1']!;
      expect(sent['lines'] as List, hasLength(2));
      expect(sent.containsKey('amount'), isFalse);
    });

    testWidgets('the route table opens the new screens', (t) async {
      final s = _session(_Api());
      expect(nativeScreenFor(s, '/expenses'), isA<ExpensesScreen>());
      expect(nativeScreenFor(s, '/expenses/new'), isA<ExpenseFormScreen>());
      expect(nativeScreenFor(s, '/expenses/categories'), isA<ExpenseCategoriesScreen>());
    });
  });

  group('list and detail', () {
    testWidgets('the list shows each expense under its day and a chip per category', (t) async {
      final api = _Api();
      await _tall(t);
      await t.pumpWidget(MaterialApp(home: ExpensesScreen(key: UniqueKey(), session: _session(api))));
      await t.pumpAndSettle();
      expect(find.text('Office rent for November'), findsOneWidget);
      expect(find.text('₹1,180'), findsOneWidget);
      expect(find.text('Rent · Cash'), findsOneWidget);
      expect(find.text('Unpaid'), findsOneWidget, reason: 'an on-account bill is marked');
      expect(find.text('TUE, 3 NOV'), findsOneWidget, reason: 'grouped by the expense date');
      expect(find.text('All'), findsOneWidget);
      expect(find.text('Rent'), findsOneWidget);
      expect(find.textContaining('Total'), findsNothing, reason: 'no month total: the server sends none');
    });

    testWidgets('a category chip asks the server for that category', (t) async {
      final api = _Api();
      await _tall(t);
      await t.pumpWidget(MaterialApp(home: ExpensesScreen(key: UniqueKey(), session: _session(api))));
      await t.pumpAndSettle();
      await t.tap(find.text('Rent'));
      await t.pumpAndSettle();
      expect(api.gets, contains('/api/expenses?category_id=c1'));
    });

    testWidgets('an empty list, a server error and a plan refusal are handled', (t) async {
      await _tall(t);
      await t.pumpWidget(MaterialApp(home: ExpensesScreen(key: UniqueKey(), session: _session(_Api(rows: const [])))));
      await t.pumpAndSettle();
      expect(find.text('No expenses recorded yet'), findsOneWidget);

      await t.pumpWidget(MaterialApp(home: ExpensesScreen(key: UniqueKey(), session: _session(_Api(failList: 1)))));
      await t.pumpAndSettle();
      expect(find.text('Could not load expenses'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Office rent for November'), findsOneWidget);

      await t.pumpWidget(MaterialApp(home: ExpensesScreen(key: UniqueKey(), session: _session(_Api(failList: 9, failCode: 'FEATURE_NOT_IN_PLAN')))));
      await t.pumpAndSettle();
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('a row opens the detail with facts, lines and the GST split from the server', (t) async {
      final api = _Api();
      await _openDetail(t, api);
      expect(api.gets, contains('/api/expenses/e1'));
      expect(find.text('Office rent'), findsOneWidget);
      expect(find.text('CGST'), findsOneWidget);
      expect(find.text('SGST'), findsOneWidget);
      expect(find.text('Edit'), findsOneWidget);
    });

    testWidgets('delete asks first, naming the amount and date, and sends nothing until confirmed', (t) async {
      final api = _Api();
      await _openDetail(t, api);
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Delete expense'));
      await _settle(t);
      expect(find.text('Delete this expense?'), findsOneWidget);
      expect(find.textContaining('₹1,180 on 03 Nov 2026'), findsOneWidget);
      expect(api.deletes, isEmpty);
      // Keeping it sends nothing.
      await t.tap(find.text('Keep it'));
      await _settle(t);
      expect(api.deletes, isEmpty);
      // A reason is needed, as on the website.
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Delete expense'));
      await _settle(t);
      await t.tap(find.widgetWithText(InkWell, 'Delete expense').last);
      await _settle(t);
      expect(find.text('Add a reason'), findsOneWidget);
      expect(api.deletes, isEmpty);
      await t.enterText(_field('Reason for deleting'), 'Entered twice');
      await t.tap(find.widgetWithText(InkWell, 'Delete expense').last);
      await _settle(t);
      await t.pumpAndSettle();
      expect(api.deletes, ['/api/expenses/e1?reason=Entered+twice']);
      expect(find.byType(ExpenseDetailScreen), findsNothing, reason: 'the detail is closed');
    });

    testWidgets('a refused delete shows the server message and stays on the page', (t) async {
      final api = _Api(refuseDelete: 'This period is locked. Ask the owner to reopen it.');
      await _openDetail(t, api);
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Delete expense'));
      await _settle(t);
      await t.enterText(_field('Reason for deleting'), 'Wrong');
      await t.tap(find.widgetWithText(InkWell, 'Delete expense').last);
      await _settle(t);
      await t.pumpAndSettle();
      expect(find.text('This period is locked. Ask the owner to reopen it.'), findsOneWidget);
      expect(find.byType(ExpenseDetailScreen), findsOneWidget);
    });

    testWidgets('Edit opens the form filled in and a save returns to the detail', (t) async {
      final api = _Api();
      await _openDetail(t, api);
      await t.tap(find.text('Edit'));
      await t.pumpAndSettle();
      expect(find.text('Edit expense'), findsOneWidget);
      expect(_text(t, 'Amount'), '1180');
      await t.enterText(_field('Bill number'), 'B-9');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(api.puts['/api/expenses/e1']!['reference_number'], 'B-9');
      expect(find.text('Edit expense'), findsNothing);
      expect(find.byType(ExpenseDetailScreen), findsOneWidget);
    });
  });

  group('categories', () {
    Future<void> openCategories(WidgetTester t, _Api api) async {
      await _tall(t);
      await t.pumpWidget(MaterialApp(home: ExpenseCategoriesScreen(key: UniqueKey(), session: _session(api))));
      await t.pumpAndSettle();
    }

    testWidgets('lists the categories with their ledger account', (t) async {
      await openCategories(t, _Api());
      expect(find.text('Rent'), findsOneWidget);
      expect(find.text('5201 — Rent expense'), findsOneWidget);
      expect(find.text('Default generic expense account'), findsOneWidget);
    });

    testWidgets('add posts the name and the chosen account', (t) async {
      final api = _Api();
      await openCategories(t, api);
      await t.tap(find.text('Add category'));
      await t.pumpAndSettle();
      await t.enterText(_field('Category name'), 'Travel');
      await t.enterText(_field('Description'), 'Trips');
      await t.tap(find.text('Save category'));
      await t.pumpAndSettle();
      expect(api.posts.firstWhere((p) => p.$1 == '/api/expense-categories').$2, {'name': 'Travel', 'description': 'Trips', 'account_id': 'ac2'});
      expect(api.gets.where((g) => g == '/api/expense-categories').length, 2, reason: 'the list reloads');
    });

    testWidgets('add without a name shows an error and sends nothing', (t) async {
      final api = _Api();
      await openCategories(t, api);
      await t.tap(find.text('Add category'));
      await t.pumpAndSettle();
      await t.tap(find.text('Save category'));
      await t.pumpAndSettle();
      expect(find.text('Enter a category name'), findsOneWidget);
      expect(api.posts, isEmpty);
    });

    testWidgets('rename patches only the name', (t) async {
      final api = _Api();
      await openCategories(t, api);
      await t.tap(find.text('Rent'));
      await t.pumpAndSettle();
      expect(find.text('Edit category'), findsOneWidget);
      expect(_text(t, 'Category name'), 'Rent');
      await t.enterText(_field('Category name'), 'Office rent');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(api.patches, {
        '/api/expense-categories/c1': {'name': 'Office rent'},
      });
    });

    testWidgets('a refused add shows the message and keeps the sheet', (t) async {
      final api = _Api(refuse: 'A category with this name already exists');
      await openCategories(t, api);
      await t.tap(find.text('Add category'));
      await t.pumpAndSettle();
      await t.enterText(_field('Category name'), 'Rent');
      await t.tap(find.text('Save category'));
      await t.pumpAndSettle();
      expect(find.text('A category with this name already exists'), findsOneWidget);
      expect(_text(t, 'Category name'), 'Rent');
    });

    testWidgets('empty, error and plan states', (t) async {
      await openCategories(t, _Api(noCategories: true));
      expect(find.text('No expense categories yet'), findsOneWidget);
      await openCategories(t, _Api(failCategories: 1));
      expect(find.text('Could not load expense categories'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Rent'), findsOneWidget);
      await openCategories(t, _Api(failCategories: 9, failCode: 'FEATURE_NOT_IN_PLAN'));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });

  group('fix round 1', () {
    testWidgets('an untouched edit keeps a saved account that is not in the list: no request, pops false', (t) async {
      final api = _Api();
      bool? result;
      await _tall(t);
      await t.pumpWidget(MaterialApp(
        home: Builder(
          builder: (c) => TextButton(
            onPressed: () async => result = await Navigator.of(c).push<bool>(MaterialPageRoute(
                builder: (_) => ExpenseFormScreen(session: _session(api), expense: {..._saved, 'settlement_account_id': 'gone'}))),
            child: const Text('go'),
          ),
        ),
      ));
      await t.tap(find.text('go'));
      await t.pumpAndSettle();
      expect(find.text('Saved account'), findsOneWidget);
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(api.puts, isEmpty);
      expect(result, isFalse);
    });

    testWidgets('an untouched edit with no saved account sends nothing either', (t) async {
      final api = _Api();
      await _openForm(t, _session(api), expense: {..._saved, 'settlement_account_id': null});
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(api.puts, isEmpty);
    });

    testWidgets('changing the payment mode takes the new mode account', (t) async {
      final api = _Api();
      await _openForm(t, _session(api), expense: {..._saved, 'settlement_account_id': 'gone'});
      await _pickFrom(t, 'Payment', 'Paid — UPI');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      final sent = api.puts['/api/expenses/e1']!;
      expect(sent['payment_mode'], 'upi');
      expect(sent['settlement_account_id'], 'a1');
    });

    testWidgets('a legacy bank mode shows as Bank transfer and is not a change', (t) async {
      final api = _Api();
      await _openForm(t, _session(api), expense: {..._saved, 'payment_mode': 'bank'});
      expect(find.text('Paid — Bank transfer'), findsOneWidget);
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(api.puts, isEmpty);
    });

    testWidgets('accounts that fail to load show an error with retry and block Save', (t) async {
      final api = _Api(failAccounts: 1);
      await _openForm(t, _session(api));
      await _pickFrom(t, 'Category', 'Rent');
      await _pickFrom(t, 'Expense item', 'Office rent');
      await t.enterText(_field('Amount'), '100');
      expect(find.text('Could not load accounts'), findsOneWidget);
      await t.tap(find.text('Save expense'));
      await t.pumpAndSettle();
      expect(api.posts.where((p) => p.$1 == '/api/expenses'), isEmpty);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Could not load accounts'), findsNothing);
      await t.tap(find.text('Save expense'));
      await t.pumpAndSettle();
      final body = api.posts.firstWhere((p) => p.$1 == '/api/expenses').$2;
      expect(body['settlement_account_id'], 'a1');
    });

    testWidgets('a failed preview shows Totals unavailable', (t) async {
      final api = _Api(previewFails: true);
      await _openForm(t, _session(api));
      await _pickFrom(t, 'Category', 'Rent');
      await _pickFrom(t, 'Expense item', 'Office rent');
      await t.enterText(_field('Amount'), '100');
      await t.pump(const Duration(milliseconds: 500));
      await t.pumpAndSettle();
      expect(find.text('Totals unavailable'), findsOneWidget);
      expect(find.text('Bill total'), findsNothing);
    });

    testWidgets('a saved supplier shows its name when the expense carries one', (t) async {
      final api = _Api();
      await _openForm(t, _session(api), expense: {..._saved, 'supplier_id': 's1', 'supplier_name': 'Acme Traders'});
      expect(find.text('Acme Traders'), findsOneWidget);
    });
  });
}
