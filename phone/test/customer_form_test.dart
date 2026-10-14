import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/capability.dart';
import 'package:khatario_phone/screens/parties/customer_form_logic.dart';
import 'package:khatario_phone/screens/parties/customer_form_screen.dart';
import 'package:khatario_phone/screens/parties/customer_statement_screen.dart';
import 'package:khatario_phone/session.dart';

void main() {
  test('shipping address matches the website', () {
    expect(buildShippingAddress('Shop 1', 'Pune', 'Maharashtra', '411001'), 'Shop 1\nPune, Maharashtra - 411001');
    expect(buildShippingAddress('', 'Pune', 'Maharashtra', ''), 'Pune, Maharashtra');
  });

  test('GSTIN checksum and state code', () {
    expect(isValidGstin('27AAPFU0939F1ZV'), isTrue);
    expect(isValidGstin('27AAPFU0939F1Z1'), isFalse);
    expect(stateCode('Karnataka'), '29');
  });

  test('create body does not send an actor or business id', () {
    final body = customerCreateBody(
      name: 'Ravi',
      companyName: '',
      phone: '999',
      email: '',
      gstin: '',
      billingAddress: 'Lane',
      shippingAddress: '',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '',
      country: 'India',
      openingBalance: '',
      openingBalanceType: 'debit',
      creditLimit: '10',
      creditDays: '',
    );
    expect(body.containsKey('created_by'), isFalse);
    expect(body.containsKey('user_id'), isFalse);
    expect(body.containsKey('business_id'), isFalse);
    expect(body['state_code'], '27');
    expect(body.containsKey('credit_days'), isFalse);
    expect(body['opening_balance'], 0);
  });

  test('statement csv escapes commas and labels vouchers', () {
    final csv = buildStatementCsv(
      businessName: 'Shop, Inc',
      partyName: 'Ravi',
      fromDate: '2026-04-01',
      toDate: '2026-10-13',
      openingBalance: 0,
      closingBalance: 10,
      transactions: [
        {
          'transaction_date': '2026-10-01',
          'transaction_type': 'invoice',
          'reference_number': 'INV-1',
          'description': 'Tax invoice',
          'debit': 10,
          'credit': 0,
          'running_balance': 10,
        },
      ],
    );
    expect(csv.startsWith('\uFEFF'), isTrue);
    expect(csv, contains('"Shop, Inc"'));
    expect(csv, contains('Sales invoice'));
    expect(csv, contains('01/10/2026'));
  });

  testWidgets('save customer posts the form and a duplicate stays open', (tester) async {
    final api = _FakeApi();
    await tester.pumpWidget(MaterialApp(home: CustomerFormScreen(session: _session(api), capabilities: _admin())));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Customer name *'), 'Ravi');
    await tester.scrollUntilVisible(find.text('Save customer'), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Save customer'));
    await tester.pumpAndSettle();
    expect(api.posts.single.$1, '/api/customers');
    expect(api.posts.single.$2['name'], 'Ravi');
    expect(api.posts.single.$2.containsKey('created_by'), isFalse);
    expect(find.text('Save customer'), findsOneWidget);
    expect(find.text('A customer named Ravi already uses this phone number.'), findsWidgets);
  });

  testWidgets('edit customer sends a put without user_id', (tester) async {
    final api = _FakeApi();
    await tester.pumpWidget(MaterialApp(
      home: CustomerFormScreen(session: _session(api), capabilities: _admin(), customerId: 'c1'),
    ));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(TextField, 'Customer name *'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Update customer'), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Update customer'));
    await tester.pumpAndSettle();
    expect(api.puts.single.$1, '/api/customers/c1');
    expect(api.puts.single.$2.containsKey('user_id'), isFalse);
    expect(api.puts.single.$2['name'], 'Ravi Traders');
  });

  testWidgets('statement shows the financial-year party statement', (tester) async {
    final api = _FakeApi();
    await tester.pumpWidget(MaterialApp(home: CustomerStatementScreen(session: _session(api), customerId: 'c1')));
    await tester.pumpAndSettle();
    expect(find.text('Party statement'), findsOneWidget);
    expect(find.text('Sales invoice'), findsOneWidget);
    expect(find.text('Amount due (net)'), findsOneWidget);
    expect(api.gets.single, contains('/api/reports/party/statement?'));
    expect(api.gets.single, contains('from_date='));
    expect(api.gets.single, isNot(contains('statement/pdf')));
  });
}

Capabilities _admin() => const Capabilities(
      sessionIsPrimaryAdmin: true,
      sessionPermissions: {},
      snapshot: CapabilitySnapshot(permissions: {}, isPrimaryAdmin: true, enabledFeatures: []),
    );

AppSession _session(_FakeApi api) => AppSession(api, {
      'user': {'id': 'user-1', 'name': 'Owner'},
      'business': {'id': 'biz-1', 'name': 'Shop'},
      'isPrimaryAdmin': true,
    });

class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());

  final gets = <String>[];
  final posts = <(String, Map<String, dynamic>)>[];
  final puts = <(String, Map<String, dynamic>)>[];

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    gets.add(path);
    final p = Uri.parse(path).path;
    if (p == '/api/subscriptions/check-limit') return {'allowed': true, 'current': 1, 'limit': 50};
    if (p == '/api/customers/c1') {
      return {
        'customer': {
          'id': 'c1',
          'name': 'Ravi Traders',
          'phone': '999',
          'billing_address': 'Lane',
          'shipping_address': 'Lane',
          'city': 'Pune',
          'state': 'Maharashtra',
          'pincode': '411001',
          'country': 'India',
          'opening_balance': 0,
          'opening_balance_type': 'debit',
          'credit_limit': 0,
        },
      };
    }
    if (p == '/api/reports/party/statement') {
      return {
        'business': {'name': 'Shop'},
        'party': {'name': 'Ravi Traders', 'phone': '999'},
        'from_date': '2026-04-01',
        'to_date': '2026-10-13',
        'opening_balance': 0,
        'closing_balance': 10,
        'transactions': [
          {
            'transaction_date': '2026-10-01',
            'transaction_type': 'invoice',
            'reference_number': 'INV-1',
            'description': 'Tax invoice',
            'debit': 10,
            'credit': 0,
            'running_balance': 10,
          },
        ],
      };
    }
    throw ApiException('not faked: $path');
  }

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    posts.add((path, body));
    return {
      'customer': {'id': 'c1', 'name': 'Ravi'},
      'deduplicated': true,
      'code': 'DUPLICATE_PHONE',
      'error': 'A customer named Ravi already uses this phone number.',
    };
  }

  @override
  Future<Map<String, dynamic>> putJson(String path, Map<String, dynamic> body) async {
    puts.add((path, body));
    return {'customer': {'id': 'c1'}};
  }
}
