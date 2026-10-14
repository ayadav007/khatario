import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/settings/business_settings.dart';
import 'package:khatario_phone/screens/settings/invoice_settings.dart';
import 'package:khatario_phone/screens/settings/items_orders_settings.dart';
import 'package:khatario_phone/screens/settings/settings_hub_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/theme.dart';

class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());

  final writes = <(String, String, Map<String, dynamic>)>[];

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    if (path.startsWith('/api/businesses/')) {
      return {
        'business': {
          'id': 'b',
          'name': 'Sharma Textiles',
          'phone': '9822041567',
          'email': 'accounts@sharmatextiles.in',
          'address_line1': 'Shop 14, Laxmi Road',
          'city': 'Pune',
          'state': 'Maharashtra',
          'pincode': '411002',
          'gstin': '27AAKFS4821M1Z3',
          'pan': 'AAKFS4821M',
          'gst_registration_type': 'regular',
          'aggregate_turnover_above_5cr': false,
          'logo_url': null,
          'signature_url': null,
        },
      };
    }
    if (path == '/api/branches') return {'branches': [{'id': 'br', 'name': 'Pune (main)', 'is_active': true}]};
    if (path == '/api/warehouses') return {'warehouses': []};
    if (path == '/api/payment-methods') return {'methods': []};
    if (path == '/api/settings/invoice-defaults') {
      return {
        'defaults': {'dueDays': 15, 'pricesIncludeGst': true, 'roundOff': true, 'quantityDecimals': 2, 'notes': 'Thank you!', 'terms': '', 'lowStockAlert': 5},
      };
    }
    if (path == '/api/settings/product-variants') return {'product_variants_enabled': true};
    if (path == '/api/settings/document-language') return {'document_language': 'en', 'can_change': false};
    if (path == '/api/settings/number-series') {
      return {
        'branches': [
          {'id': 'br', 'is_default': true, 'invoice_prefix': 'INV-', 'next_numbers': {'tax_invoice': 248, 'bill_of_supply': 1, 'proforma_invoice': 31}},
        ],
        'branchPrefixes': {},
      };
    }
    if (path == '/api/orders/settings') {
      return {
        'settings': {
          'notify': {'confirmed': true, 'packed': false, 'ready_for_pickup': true, 'shipped': true, 'out_for_delivery': true, 'delivered': true, 'delivery_failed': true, 'cancelled': true},
          'dispatchSlaHours': 24,
          'merchantDispatchAlert': false,
          'autoTrackShippedBills': true,
          'stuckNoticeDays': 3,
        },
      };
    }
    if (path == '/api/settings/online-store') {
      return {
        'store_subdomain': 'sharmatextiles',
        'store_enabled': true,
        'store_min_order_amount': 499,
        'store_allow_cod': true,
        'store_delivery_provider': 'shiprocket',
        'store_return_window_days': 7,
        'shiprocket_configured': true,
        'shiprocket_webhook_configured': true,
      };
    }
    return {};
  }

  @override
  Future<Map<String, dynamic>> putJson(String path, Map<String, dynamic> body) async {
    writes.add(('PUT', path, body));
    return {};
  }

  @override
  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async {
    writes.add(('PATCH', path, body));
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

AppSession _session(KhatarioApi api) => AppSession(api, {
      'user': {'id': 'u', 'name': 'Rakesh'},
      'business': {'id': 'b', 'name': 'Sharma Textiles'},
    });

Future<void> _pump(WidgetTester tester, Widget home, {double height = 1800}) async {
  tester.view.physicalSize = Size(390, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: khatarioTheme(), debugShowCheckedModeBanner: false, home: home));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(_loadFonts);

  testWidgets('hub: setup progress with what is missing, and the task groups', (tester) async {
    await _pump(tester, SettingsHubScreen(session: _session(_FakeApi())), height: 1300);
    expect(find.text('Logo →'), findsOneWidget);
    expect(find.text('Signature →'), findsOneWidget);
    expect(find.text('UPI ID →'), findsOneWidget);
    expect(find.text('Orders & delivery'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/100-settings-hub.png'));

    await tester.enterText(find.byType(TextField), 'upi');
    await tester.pumpAndSettle();
    expect(find.text('Payments'), findsOneWidget);
    expect(find.text('People'), findsNothing);
  });

  testWidgets('business: fields load, an edit shows the save bar, a GST switch saves at once', (tester) async {
    final api = _FakeApi();
    await _pump(tester, BusinessSettingsScreen(session: _session(api)), height: 2300);
    expect(find.text('27AAKFS4821M1Z3'), findsOneWidget);
    expect(find.text('Needed on invoices'), findsNWidgets(2), reason: 'logo and signature are missing');
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/101-settings-business.png'));

    await tester.enterText(find.widgetWithText(TextField, 'Pune'), 'Pune City');
    await tester.pumpAndSettle();
    expect(find.text('1 unsaved change'), findsOneWidget);

    await tester.tap(find.text('Turnover above ₹5 crore last year'));
    await tester.pumpAndSettle();
    expect(api.writes.last.$3, {'aggregate_turnover_above_5cr': true});
    expect(find.text('Undo'), findsOneWidget);
  });

  testWidgets('invoices: defaults, numbering and a locked print language', (tester) async {
    final api = _FakeApi();
    await _pump(tester, InvoiceSettingsScreen(session: _session(api)), height: 2100);
    expect(find.text('15 days'), findsOneWidget);
    expect(find.text('INV-00248 next'), findsOneWidget);
    expect(find.text('Business plan'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/102-settings-invoices.png'));

    await tester.tap(find.text('Round off the total'));
    await tester.pumpAndSettle();
    expect(api.writes.last.$2, '/api/settings/invoice-defaults');
    expect(api.writes.last.$3, {'defaults': {'roundOff': false}});
  });

  testWidgets('orders & delivery: store, buyer updates and dispatch rules in one place', (tester) async {
    final api = _FakeApi();
    await _pump(tester, OrdersSettingsScreen(session: _session(api)), height: 2900);
    expect(find.text('sharmatextiles.khatario.com'), findsOneWidget);
    expect(find.text('Connected · tracking on'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/103-settings-orders.png'));

    await tester.tap(find.text('Packed'));
    await tester.pumpAndSettle();
    final w = api.writes.last;
    expect(w.$2, '/api/orders/settings');
    expect((w.$3['settings'] as Map)['notify'], containsPair('packed', true));
  });
}
