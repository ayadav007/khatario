import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/invoices/invoice_form_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/theme.dart';

class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());

  final gets = <String>[];

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    gets.add(path);
    if (path.startsWith('/api/invoices/next-number')) return {'full_number': 'INV-036'};
    if (path.startsWith('/api/customers/c1')) {
      return {
        'customer': {'name': 'Akshat Yaduwanshi', 'phone': '72043 05078', 'current_balance': 1250, 'state': 'Maharashtra'},
      };
    }
    if (path.startsWith('/api/items')) {
      return {
        'items': [
          {'id': 'i1', 'name': 'Biryani rice', 'selling_price': 95, 'tax_rate': 5, 'unit': 'KGS', 'current_stock': 3.3},
          {'id': 'i2', 'name': 'Dal chana', 'selling_price': 74, 'tax_rate': 5, 'unit': 'KGS', 'current_stock': 12},
          {'id': 'i3', 'name': 'Everest tikhal 200g', 'selling_price': 104.29, 'tax_rate': 18, 'unit': 'PCS', 'current_stock': 0},
        ],
      };
    }
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

  testWidgets('new bill: short when empty, grows as items are added', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = _FakeApi();
    final session = AppSession(api, {
      'user': {'id': 'u', 'name': 'Shalini'},
      'business': {'id': 'b', 'name': 'Gupta Kirana', 'state': 'Maharashtra'},
      'branches': [
        {'id': 'br'},
      ],
    });
    await tester.pumpWidget(MaterialApp(
      theme: khatarioTheme(),
      debugShowCheckedModeBanner: false,
      home: InvoiceFormScreen(session: session),
    ));
    await tester.pumpAndSettle();

    // Empty bill: number, party, one Add items button, folded extras. No totals or payment yet.
    expect(find.text('Invoice INV-036'), findsOneWidget);
    expect(find.text('Add items'), findsOneWidget);
    expect(find.text('Payment'.toUpperCase()), findsNothing);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/80-new-bill-empty.png'));

    // Bill details sheet.
    await tester.tap(find.text('EDIT'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('15 days'));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/81-new-bill-details.png'));
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Due in 15 days'), findsOneWidget);

    // Add two rice and one dal from the picker.
    await tester.tap(find.text('Add items'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Biryani rice'));
    await tester.tap(find.text('Biryani rice'));
    await tester.tap(find.text('Dal chana'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Done'));
    await tester.pumpAndSettle();
    expect(find.text('ITEMS (2)'), findsOneWidget);
    expect(find.text('PAYMENT'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/82-new-bill-filled.png'));

    // A delivery charge goes under the items and into the total.
    expect(find.text('Scan'), findsOneWidget);
    await tester.ensureVisible(find.text('Add delivery, packing or other charges'));
    await tester.tap(find.text('Add delivery, packing or other charges'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delivery'));
    await tester.enterText(find.widgetWithText(TextField, 'Amount'), '40');
    await tester.tap(find.text('Add charge'));
    await tester.pumpAndSettle();
    expect(find.text('Delivery'), findsOneWidget);
    expect(find.text('ADDITIONAL CHARGES'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/83-new-bill-charge.png'));
  });
}
