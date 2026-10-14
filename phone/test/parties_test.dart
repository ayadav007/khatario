import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/capability.dart';
import 'package:khatario_phone/screens/parties/parties_screen.dart';
import 'package:khatario_phone/screens/parties/party_logic.dart';
import 'package:khatario_phone/session.dart';

void main() {
  group('party list rules', () {
    final rows = <Map<String, dynamic>>[
      {'name': 'Ravi Traders', 'company_name': 'Acme', 'phone': '999', 'current_balance': '1250'},
      {'name': 'Settled Shop', 'phone': '888', 'current_balance': 0},
      {'name': 'Gone', 'is_active': false, 'current_balance': 10},
      {'name': 'Credit', 'phone': '', 'current_balance': -40},
    ];

    test('hides inactive and matches name, company or phone', () {
      expect(
        filterParties(rows, kind: PartyKind.customers, search: 'acme', balanceFilter: 'all').map((r) => r['name']),
        ['Ravi Traders'],
      );
      expect(
        filterParties(rows, kind: PartyKind.customers, search: '888', balanceFilter: 'all').map((r) => r['name']),
        ['Settled Shop'],
      );
    });

    test('balance filter treats near-zero as settled', () {
      final withBalance = filterParties(rows, kind: PartyKind.customers, search: '', balanceFilter: 'with-balance');
      expect(withBalance.map((r) => r['name']), ['Ravi Traders', 'Credit']);
      expect(
        filterParties([
          {'name': 'Dust', 'current_balance': 0.001},
        ], kind: PartyKind.customers, search: '', balanceFilter: 'zero-balance').map((r) => r['name']),
        ['Dust'],
      );
    });

    test('supplier search does not use company name', () {
      expect(
        filterParties([
          {'name': 'Grain', 'company_name': 'Acme', 'phone': '1'},
        ], kind: PartyKind.suppliers, search: 'acme', balanceFilter: 'all'),
        isEmpty,
      );
    });

    test('hints', () {
      expect(customerBalanceHint(10), 'Due');
      expect(customerBalanceHint(-10), 'Credit');
      expect(customerBalanceHint(0), 'Settled');
      expect(supplierBalanceHint(-10), 'Prepaid');
    });

    test('reminder sends the signed-in business, matching the website', () {
      expect(reminderRequestBody('biz-1'), {'business_id': 'biz-1'});
      expect(reminderRequestBody('  '), isEmpty);
    });

    test('reminder outcome matches the website', () {
      expect(reminderOutcome(ok: true, data: {'success': true, 'sent': 2, 'failed': 0}).message, 'Reminders sent! 2 invoice(s) notified.');
      expect(
        reminderOutcome(ok: true, data: {'success': true, 'sent': 0, 'failed': 1, 'errors': ['INV-1: down']}).message,
        'INV-1: down',
      );
      expect(reminderOutcome(ok: false, data: {'error': 'nope'}).message, 'nope');
    });

    test('financial year starts on 1 April', () {
      expect(indianFinancialYearStart(DateTime(2026, 10, 13)), DateTime(2026, 4, 1));
      expect(indianFinancialYearStart(DateTime(2026, 2, 1)), DateTime(2025, 4, 1));
      expect(ledgerRange('all', DateTime(2026, 10, 13)).fromDate, isNull);
      expect(ledgerRange('current_month', DateTime(2026, 10, 13)).fromDate, '2026-10-01');
    });
  });

  testWidgets('parties list, reminder and customer detail', (tester) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = _FakeApi();
    final session = AppSession(api, {
      'user': {'id': 'user-1', 'name': 'Owner'},
      'business': {'id': 'biz-1', 'name': 'Shop'},
      'isPrimaryAdmin': true,
    });
    final opened = <String>[];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: PartiesScreen(
          session: session,
          capabilities: Capabilities(
            sessionIsPrimaryAdmin: true,
            sessionPermissions: const {},
            snapshot: const CapabilitySnapshot(permissions: {}, isPrimaryAdmin: true, enabledFeatures: []),
          ),
          onOpen: opened.add,
        ),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Ravi Traders'), findsOneWidget);
    expect(find.text('Gone'), findsNothing);
    // The row and the To collect summary tile (the only customer who owes money).
    expect(find.text('₹1,250'), findsNWidgets(2));
    expect(find.text('Clear'), findsOneWidget);
    expect(api.gets, containsAll(['/api/customers', '/api/suppliers?limit=500']));

    await tester.tap(find.byTooltip('Remind Ravi Traders'));
    await tester.pumpAndSettle();
    expect(api.posts.single.$1, '/api/customers/c1/send-reminder');
    expect(api.posts.single.$2, {'business_id': 'biz-1'});
    expect(find.text('Reminders sent! 1 invoice(s) notified.'), findsOneWidget);

    await tester.tap(find.text('Suppliers'));
    await tester.pumpAndSettle();
    expect(find.text('Grain Co'), findsOneWidget);
    expect(find.text('₹80'), findsOneWidget);

    await tester.tap(find.text('Customers'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Filters'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Zero Balance'));
    await tester.pumpAndSettle();
    expect(find.text('Settled Shop'), findsOneWidget);
    expect(find.text('Ravi Traders'), findsNothing);

    await tester.tap(find.byTooltip('Filters'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('All Customers'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ravi Traders'));
    await tester.pumpAndSettle();

    expect(find.text('Primary Details'), findsOneWidget);
    expect(find.text('Customer portal'), findsOneWidget);
    expect(find.text('https://portal.example/shop'), findsOneWidget);
    expect(api.gets, contains('/api/settings/customer-surface'));

    await tester.tap(find.text('Transactions'));
    await tester.pumpAndSettle();
    expect(find.text('INV-9'), findsOneWidget);

    await tester.tap(find.text('Ledger'));
    await tester.pumpAndSettle();
    expect(find.text('Sales invoice'), findsOneWidget);
    expect(api.gets.any((p) => p.startsWith('/api/reports/party/ledger')), isTrue);

    await tester.tap(find.text('History'));
    await tester.pumpAndSettle();
    expect(find.text('Created the customer'), findsOneWidget);

    await tester.tap(find.byTooltip('Edit'));
    await tester.pumpAndSettle();
    expect(find.text('Edit customer'), findsOneWidget);
    expect(find.text('Ravi Traders'), findsWidgets);
    expect(opened, isEmpty);
  });

  testWidgets('customers read denial blocks the parties page', (tester) async {
    final api = _FakeApi();
    final session = AppSession(api, {
      'user': {'id': 'user-1'},
      'business': {'id': 'biz-1', 'name': 'Shop'},
    });
    await tester.pumpWidget(MaterialApp(
      home: PartiesScreen(
        session: session,
        capabilities: const Capabilities(
          sessionIsPrimaryAdmin: false,
          sessionPermissions: {},
          snapshot: CapabilitySnapshot(permissions: {}, isPrimaryAdmin: false, enabledFeatures: []),
        ),
        onOpen: (_) {},
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Access to Customers is restricted'), findsOneWidget);
    expect(api.gets, isEmpty);
  });
}

class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());

  final gets = <String>[];
  final posts = <(String, Map<String, dynamic>)>[];

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    gets.add(path);
    final p = Uri.parse(path).path;
    if (p == '/api/customers') {
      return {
        'customers': [
          {'id': 'c1', 'name': 'Ravi Traders', 'company_name': 'Acme', 'phone': '999', 'current_balance': 1250, 'opening_balance_type': 'debit'},
          {'id': 'c2', 'name': 'Settled Shop', 'phone': '888', 'current_balance': 0, 'opening_balance_type': 'debit'},
          {'id': 'c3', 'name': 'Gone', 'is_active': false, 'current_balance': 10},
          {'id': 'c4', 'name': 'Credit', 'phone': '', 'current_balance': -20, 'opening_balance_type': 'credit'},
        ],
      };
    }
    if (p == '/api/suppliers') {
      return {
        'suppliers': [
          {'id': 's1', 'name': 'Grain Co', 'phone': '777', 'current_balance': -80, 'opening_balance_type': 'credit'},
        ],
      };
    }
    if (p == '/api/customers/c1') {
      return {
        'customer': {
          'id': 'c1',
          'name': 'Ravi Traders',
          'company_name': 'Acme',
          'phone': '999',
          'email': 'ravi@example.com',
          'current_balance': 1250,
          'opening_balance': 0,
          'opening_balance_type': 'debit',
          'portal_enabled': false,
        },
        'transactions': [
          {'type': 'invoice', 'id': 'inv-9', 'ref_no': 'INV-9', 'date': '2026-10-01', 'amount': 1250, 'balance_amount': 1250, 'status': 'final', 'payment_status': 'unpaid'},
        ],
        'totalReceivable': 1250,
      };
    }
    if (p == '/api/customers/c1/history') {
      return {
        'history': [
          {'id': 'h1', 'description': 'Created the customer', 'created_at': '2026-10-01T10:00:00.000Z', 'user_name': 'Owner'},
        ],
      };
    }
    if (p == '/api/settings/customer-surface') return {'portal_url': 'https://portal.example/shop'};
    if (p == '/api/reports/party/ledger') {
      return {
        'opening_balance': 0,
        'closing_balance': 1250,
        'transactions': [
          {
            'reference_number': 'INV-9',
            'transaction_date': '2026-10-01',
            'transaction_type': 'invoice',
            'description': 'Tax invoice',
            'debit': 1250,
            'credit': 0,
          },
        ],
      };
    }
    throw ApiException('not faked: $path');
  }

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    posts.add((path, body));
    return {'success': true, 'sent': 1, 'failed': 0};
  }
}
