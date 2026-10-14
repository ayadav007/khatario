import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/parties/customer_detail_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/theme.dart';

class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    if (path.startsWith('/api/customers/c1/history')) return {'history': []};
    if (path.startsWith('/api/customers/c1')) {
      return {
        'customer': {
          'id': 'c1',
          'name': 'Ravi Traders',
          'phone': '98765 43210',
          'current_balance': 1250,
          'opening_balance': 0,
          'opening_balance_type': 'debit',
        },
        'transactions': [],
        'totalReceivable': 1250,
      };
    }
    if (path.startsWith('/api/reports/party/ledger')) {
      return {
        'opening_balance': 500,
        'closing_balance': 1250,
        'transactions': [
          {
            'reference_number': 'INV-9',
            'transaction_date': '2026-10-03',
            'transaction_type': 'invoice',
            'description': 'Sale',
            'debit': 1500,
            'credit': 0,
            'running_balance': 2000,
          },
          {
            'reference_number': 'PAY-12',
            'transaction_date': '2026-10-08',
            'transaction_type': 'payment',
            'description': 'UPI received',
            'debit': 0,
            'credit': 750,
            'running_balance': 1250,
          },
        ],
      };
    }
    if (path.startsWith('/api/settings/customer-surface')) return {};
    return {};
  }
}

Future<void> _loadFonts() async {
  final inter = FontLoader('Inter');
  for (final w in [400, 500, 600, 700]) {
    inter.addFont(rootBundle.load('fonts/Inter-$w.ttf'));
  }
  await inter.load();
  final lucide = FontLoader('packages/lucide_icons_flutter/Lucide');
  lucide.addFont(rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'));
  await lucide.load();
}

void main() {
  setUpAll(_loadFonts);

  testWidgets('customer ledger: net balance, debit / credit columns and grand total', (tester) async {
    tester.view.physicalSize = const Size(390, 1500);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final session = AppSession(_FakeApi(), {
      'user': {'id': 'u', 'name': 'Shalini'},
      'business': {'id': 'b', 'name': 'Shop'},
    });
    await tester.pumpWidget(MaterialApp(
      theme: khatarioTheme(),
      debugShowCheckedModeBanner: false,
      home: CustomerDetailScreen(session: session, customerId: 'c1', onOpen: (_) {}),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ledger'));
    await tester.pumpAndSettle();

    expect(find.text('Net Balance'), findsOneWidget);
    expect(find.text('₹ 1,250 Dr'), findsOneWidget);
    expect(find.text('Grand Total'), findsOneWidget);
    expect(find.text('Opening balance'), findsOneWidget);
    expect(find.text('INV-9 • Sale'), findsOneWidget);
    expect(find.text('₹ 1,500'), findsNWidgets(3), reason: 'row debit, total debit box and grand total');
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/90-customer-ledger.png'));
  });
}
