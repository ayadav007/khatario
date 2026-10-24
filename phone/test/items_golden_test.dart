import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/items/item_csv.dart';
import 'package:khatario_phone/screens/items/item_detail_screen.dart';
import 'package:khatario_phone/screens/items/items_screen.dart';
import 'package:khatario_phone/screens/more/more_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/shell/app_shell.dart';
import 'package:khatario_phone/theme.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

/// Items list, filters, adjust stock, settings sheet and item detail from staging responses
/// (khatario-ref/capture-items.cjs). Skipped when they are not on this machine.
const _themeDir = r'C:\Users\Abhishek\khatario-ref\theme\api';
const _itemsDir = r'C:\Users\Abhishek\khatario-ref\items\api';
const _moreDir = r'C:\Users\Abhishek\khatario-ref\more\api';
const _branch = 'd579383f-871d-4b91-a1d4-2bf6273c6666';

Map<String, dynamic> _read(String dir, String name) =>
    jsonDecode(File('$dir\\$name.json').readAsStringSync()) as Map<String, dynamic>;

class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());

  final gets = <String>[];
  final posts = <(String, Map<String, dynamic>)>[];
  final patches = <(String, Map<String, dynamic>)>[];
  final deletes = <String>[];
  Object? postError;

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    gets.add(path);
    final uri = Uri.parse(path);
    final p = uri.path;
    final detail = RegExp(r'^/api/items/([0-9a-f]{8})[0-9a-f-]{28}(/transactions|/history)?$').firstMatch(p);
    if (detail != null) {
      final kind = switch (detail[2]) { '/transactions' => 'item_transactions', '/history' => 'item_history', _ => 'item_detail' };
      final file = File('$_itemsDir\\${kind}_${detail[1]}.json');
      if (!file.existsSync()) throw ApiException('Item not found');
      return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    }
    if (p.startsWith('/api/employees/')) throw ApiException('Employee not found');
    return switch (p) {
      '/api/settings/permissions' => _read(_moreDir, 'settings_permissions'),
      '/api/suppliers/dashboard' => _read(_moreDir, 'suppliers_dashboard'),
      '/api/subscriptions/limit-plan' => _read(_moreDir, 'subscriptions_limit_plan'),
      '/api/items' => _read(_itemsDir, 'items'),
      '/api/categories' => _read(_itemsDir, 'categories'),
      '/api/settings/warehouses' => _read(_itemsDir, 'settings_warehouses'),
      '/api/locations' => throw ApiException('This feature is not available in your current plan.'),
      '/api/auth/session' => _read(_themeDir, 'session'),
      '/api/badges/counts' => _read(_themeDir, 'badges'),
      '/api/businesses/my' => _read(_themeDir, 'businesses'),
      '/api/notifications' => _read(_themeDir, 'notifications'),
      '/api/features/enabled' => _read(_themeDir, 'features'),
      '/api/promotions/active' => _read(_themeDir, path.contains('type=modal') ? 'promo_modal' : 'promo_banner'),
      '/api/subscriptions/current' => _read(_themeDir, 'subscription'),
      '/api/subscriptions/check-limit' => _read(_themeDir, 'limit_${uri.queryParameters['limit_type']}'),
      _ => throw ApiException('not faked: $path'),
    };
  }

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    posts.add((path, body));
    if (postError != null) throw postError!;
    return {'adjustment': {}};
  }

  @override
  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async {
    patches.add((path, body));
    return {'item': {}};
  }

  @override
  Future<Map<String, dynamic>> deleteJson(String path) async {
    deletes.add(path);
    return {'success': true};
  }
}

Future<void> _loadFonts() async {
  final lucide = FontLoader('packages/lucide_icons_flutter/Lucide');
  lucide.addFont(rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'));
  await lucide.load();
  for (final w in [500, 600]) {
    final l = FontLoader('packages/lucide_icons_flutter/Lucide$w');
    l.addFont(rootBundle.load('packages/lucide_icons_flutter/assets/build_font/LucideVariable-w$w.ttf'));
    await l.load();
  }
  // "system" preset: desktop Chrome on Windows (where the web reference is captured) uses Segoe UI,
  // and Tailwind `font-mono` resolves to Consolas.
  Future<void> load(String family, List<String> files) async {
    final loader = FontLoader(family);
    for (final f in files) {
      final file = File('C:\\Windows\\Fonts\\$f');
      if (file.existsSync()) loader.addFont(file.readAsBytes().then((b) => ByteData.sublistView(b)));
    }
    await loader.load();
  }

  await load('Roboto', ['segoeui.ttf', 'seguisb.ttf', 'segoeuib.ttf', 'segoeuii.ttf']);
  await load('monospace', ['consola.ttf']);
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
    await tester.pump();
  }
  await tester.pumpAndSettle();
}

/// The staging business has no Items tab: Items is reached from More > Inventory.
Future<void> _openItemsFromMore(WidgetTester tester) async {
  await tester.tap(find.text('More').last);
  await _settle(tester);
  await tester.scrollUntilVisible(find.text('Items'), 300, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
  await tester.tap(find.text('Items'));
  await _settle(tester);
}

Future<(_FakeApi, AppSession)> _pumpShell(WidgetTester tester, {Future<void> Function()? onSignOut}) async {
  final api = _FakeApi();
  final raw = await tester.runAsync(() => api.getJson('/api/auth/session')) ?? {};
  KhatarioColors.applyPortalTheme(raw['portalTheme']);
  final session = AppSession(api, raw);
  await tester.pumpWidget(MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: khatarioTheme(),
    home: AppShell(session: session, onSessionChanged: () async {}, onSignOut: onSignOut ?? () async {}),
  ));
  await _settle(tester);
  return (api, session);
}

void main() {
  final haveRef = Directory(_itemsDir).existsSync() && Directory(_themeDir).existsSync();

  setUpAll(_loadFonts);
  setUp(() => SharedPreferencesAsyncPlatform.instance = InMemorySharedPreferencesAsync.empty());
  tearDown(() => debugDisableShadows = true);

  group('filterItems follows app/(app)/items/page.tsx', () {
    final all = <Map<String, dynamic>>[
      {'name': 'Dal Chana', 'code': 'DC1', 'item_type': 'goods', 'current_stock': '-5.4', 'min_stock': '0.00', 'category_id': 'g', 'show_in_store': true},
      {'name': 'Rice', 'code': null, 'item_type': 'goods', 'current_stock': '3', 'min_stock': '5', 'featured_in_store': true},
      {'name': 'Hair Oil', 'item_type': 'goods', 'current_stock': '44.000', 'min_stock': '0'},
      {'name': 'Consulting', 'item_type': 'service', 'current_stock': '0'},
      {'name': 'Old', 'item_type': 'goods', 'is_active': false, 'current_stock': '0'},
    ];
    List<String> run(ItemFilters f) => filterItems(all, f).map((i) => i['name'] as String).toList();

    test('hides inactive items', () => expect(run(const ItemFilters()), ['Dal Chana', 'Rice', 'Hair Oil', 'Consulting']));
    test('search matches name or code only', () {
      expect(run(const ItemFilters(search: ' dc1 ')), ['Dal Chana']);
      expect(run(const ItemFilters(search: 'oil')), ['Hair Oil']);
    });
    test('stock filters skip services', () {
      expect(run(const ItemFilters(stock: 'out')), ['Dal Chana']);
      expect(run(const ItemFilters(stock: 'low')), ['Dal Chana', 'Rice']);
    });
    test('type, category, store and featured', () {
      expect(run(const ItemFilters(type: 'service')), ['Consulting']);
      expect(run(const ItemFilters(category: 'g')), ['Dal Chana']);
      expect(run(const ItemFilters(store: 'in')), ['Dal Chana']);
      expect(run(const ItemFilters(store: 'out')), ['Rice', 'Hair Oil', 'Consulting']);
      expect(run(const ItemFilters(featured: 'featured')), ['Rice']);
    });
  });

  test('row money and stock text match ItemMobileCard', () {
    expect(ItemListRow.formatMoney('104.29'), '₹104.29');
    expect(ItemListRow.formatMoney('1250.00'), '₹1,250');
    expect(ItemListRow.formatMoney(null), '—');
    expect(ItemListRow.formatStock(3.328, 'KGS'), '3.328 KGS');
    expect(ItemListRow.formatStock(-7, ''), '-7 PCS');
    expect(ItemListRow.formatStock(12345.5, 'PCS'), '12,345.5 PCS');
    expect(formatItemInr('411.16'), '₹ 411.16');
    expect(formatItemInr(957.9000000000001), '₹ 957.9');
  });

  group('parseItemImportCsv copies the website parser', () {
    test('the bundled template', () {
      final rows = parseItemImportCsv(File(r'D:\MyApps\Khatario\public\item-import-template.csv').readAsStringSync());
      expect(rows, hasLength(3));
      expect(rows[0], {
        'name': 'Sample Item 1',
        'code': 'ITEM001',
        'barcode': 'BARCODE001',
        'unit': 'PCS',
        'item_type': 'goods',
        'category_name': 'Electronics',
        'selling_price': 100,
        'purchase_price': 80,
        'mrp': 120,
        'tax_rate': 18,
        'hsn_sac': '1001',
        'opening_stock': 10,
        'min_stock': 2,
        'description': 'Example item',
        'image_url': 'https://example.com/image1.jpg',
        'is_active': true,
      });
      expect(rows[1]['description'], 'Another sample item');
      expect(rows[1]['image_url'], isNull);
      expect(rows[2]['barcode'], isNull);
      expect(rows[2]['item_type'], 'service');
    });
    test('defaults, NaN and is_active quirks', () {
      final rows = parseItemImportCsv('name,selling_price,tax_rate,mrp,is_active\r\nA,,,,\r\n\r\nB,abc,0,0,true\nC');
      expect(rows[0]['selling_price'], 0);
      expect(rows[0]['tax_rate'], 18);
      expect(rows[0]['mrp'], isNull);
      expect(rows[0]['unit'], 'PCS');
      expect(rows[0]['is_active'], false, reason: 'an empty is_active cell is not "true"');
      expect(rows[1]['selling_price'], isNull, reason: 'Number("abc") is NaN, sent as null');
      expect(rows[1]['tax_rate'], 0);
      expect(rows[1]['mrp'], 0);
      expect(rows[1]['is_active'], true);
      expect(rows[2]['is_active'], true, reason: 'a missing cell is undefined');
      expect(parseItemImportCsv('code\nX').single.containsKey('name'), false);
    });
    test('needs a data row', () {
      expect(() => parseItemImportCsv('name,code\n\n'), throwsA(isA<FormatException>().having((e) => e.message, 'message', 'CSV has no data rows')));
    });
  });

  test('auto table layout', () {
    expect(autoTableColumnWidths([(10, 20), (10, 40)], 120), [40, 80]);
    expect(autoTableColumnWidths([(50, 80), (60, 90)], 100), [50, 60]);
    expect(autoTableColumnWidths([(10, 30), (10, 50)], 50), [20, 30]);
  });

  testWidgets('More menu matches staging, collapses, opens Items and returns on Back', (tester) async {
    tester.view.physicalSize = const Size(390, 4445);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    debugDisableShadows = false;
    var signedOut = false;
    final (api, _) = await _pumpShell(tester, onSignOut: () async => signedOut = true);
    await tester.tap(find.text('More').last);
    await _settle(tester);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/74-more-full.png'));

    const expected = {
      'Sales': ['Customers', 'All Invoices', 'Orders & Delivery', 'Quotations', 'Sales Orders', 'Delivery Challans',
          'Work Orders', 'Credit Notes', 'Debit Notes'],
      'Purchases': ['Suppliers', 'Suppliers Hub', 'All Purchases', 'Requests', 'Purchase Orders', 'Purchase Returns',
          'Expenses'],
      'Inventory': ['Items', 'Party Pricing', 'Adjustments', 'Stock Summary', 'Closing Stock'],
      'Accounting': ['Chart of Accounts', 'Journal Entries', 'Ledger', 'Payments In', 'Payments Out', 'Provisions',
          'TDS/TCS'],
      'Reports': ['Overview', 'Custom Report Builder', 'Profit & Loss', 'Balance Sheet', 'Cash Flow', 'Trial Balance',
          'Receivables Aging', 'Payables Aging', 'GST Returns (GSTR-1)', 'GST Cash Ledger', 'Sales — Summary',
          'Purchase — Summary'],
      'Staff': ['All Employees', 'Add Employee', 'Attendance', 'Salary Payments', 'Salary Advances', 'Employee Expenses',
          'Commissions'],
      'Connect': ['Dashboard', 'Conversations', 'Payment Reminders', 'Order Verification', 'Flows', 'Send Message',
          'Campaigns', 'Contacts', 'Contact Groups', 'Group Extractor', 'Unsubscribes', 'WhatsApp Settings'],
      'Tools': ['Search', 'All Tools', 'To Do List', 'HSN/SAC Finder', 'GST Calculator', 'Lead Extractor'],
      'Settings & data': ['Settings'],
      'Support': ['Documentation', 'Contact Support', 'Privacy Policy'],
    };
    final rows = tester.widgetList<MobileListRow>(find.byType(MobileListRow)).toList();
    expect(rows.map((r) => r.label).toList(), expected.values.expand((l) => l).toList());
    expect(rows.where((r) => r.locked).map((r) => r.label), ['Delivery Challans', 'Work Orders']);
    for (final title in expected.keys) {
      expect(find.text(title), findsOneWidget);
    }
    expect(find.text('Primary Admin'), findsOneWidget);
    expect(find.text('My employee profile'), findsNothing, reason: '/api/employees/{id} is 404 on staging');
    expect(find.textContaining('limit reached', findRichText: true), findsOneWidget);
    expect(api.gets.where((g) => g.startsWith('/api/settings/permissions')).single, '/api/settings/permissions');

    // One tap collapses a section (the website needed two before the fix).
    tester.view.physicalSize = const Size(390, 844);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sales'));
    await tester.pumpAndSettle();
    expect(find.text('Customers'), findsNothing);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/75-more-sales-collapsed.png'));
    await tester.tap(find.text('Sales'));
    await tester.pumpAndSettle();
    expect(find.text('Customers'), findsOneWidget);

    // Rows without a phone screen yet say so.
    await tester.ensureVisible(find.text('Quotations'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Quotations'));
    await tester.pumpAndSettle();
    expect(find.text('Quotations is not copied to the phone app yet.'), findsOneWidget);

    // Items opens from More and Back returns to More.
    await tester.scrollUntilVisible(find.text('Items'), 300, scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Items'));
    await _settle(tester);
    expect(find.byType(ItemsScreen), findsOneWidget);
    await tester.binding.handlePopRoute();
    await _settle(tester);
    expect(find.byType(ItemsScreen), findsNothing);
    expect(find.text('Inventory'), findsOneWidget, reason: 'More keeps its scroll position');

    await tester.scrollUntilVisible(find.text('Log out'), 400, scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Log out'));
    await tester.pumpAndSettle();
    expect(signedOut, isTrue);

    debugDisableShadows = true;
    KhatarioColors.applyPortalTheme(null);
  }, skip: !haveRef);

  testWidgets('items list, sheets and detail', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    debugDisableShadows = false;

    final api = _FakeApi();
    final raw = await tester.runAsync(() => api.getJson('/api/auth/session')) ?? {};
    KhatarioColors.applyPortalTheme(raw['portalTheme']);
    final session = AppSession(api, raw);
    expect(session.canDelete('items'), isTrue);

    await tester.pumpWidget(MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: khatarioTheme(),
      home: AppShell(session: session, onSessionChanged: () async {}, onSignOut: () async {}),
    ));
    await _settle(tester);
    await _openItemsFromMore(tester);

    expect(api.gets, contains('/api/items?branch_id=$_branch'));
    expect(
      api.gets.where((g) =>
          (g.startsWith('/api/items') || g.startsWith('/api/categories')) &&
          (g.contains('user_id') || g.contains('business_id='))),
      isEmpty,
    );
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/60-items.png'));

    // Header search toggle.
    await tester.tap(find.byIcon(LucideIcons.search).first);
    await _settle(tester);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/61-items-search.png'));
    await tester.enterText(find.byType(TextField).first, 'dal');
    await tester.pumpAndSettle();
    expect(find.byType(ItemListRow), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Clear search'));
    await tester.pumpAndSettle();
    expect(find.byType(ItemListRow), findsNWidgets(15));
    await tester.tap(find.bySemanticsLabel('Close search'));
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsNothing);

    // Low Stock pill: stock <= min (0) for goods only.
    await tester.tap(find.textContaining('Low Stock').first);
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/62-items-low.png'));
    await tester.tap(find.textContaining('Low Stock').first);
    await tester.pumpAndSettle();

    // Filter sheet: choosing services hides Stock Level; filters apply immediately.
    await tester.tap(find.text('Filter By'));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/63-items-filter-sheet.png'));
    await tester.tap(find.text('Services Only'));
    await tester.pumpAndSettle();
    expect(find.text('Stock Level'), findsNothing);
    await tester.tap(find.text('All Types'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Apply Filters'));
    await tester.tap(find.text('Apply Filters'));
    await tester.pumpAndSettle();
    expect(find.byType(ItemListRow), findsNWidgets(15));

    // Item settings sheet hides plan-gated entries.
    await tester.tap(find.byIcon(LucideIcons.tags));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/64-items-settings-sheet.png'));
    expect(find.text('Label templates'), findsNothing);
    expect(find.text('Print & devices'), findsNothing);
    await tester.tap(find.byIcon(LucideIcons.x).last);
    await tester.pumpAndSettle();

    // Store switch on EVEREST TIKHAL (long-press menu): flags-only PATCH, no identity fields.
    await tester.longPress(find.byType(ItemListRow).at(2));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(ItemFlagSwitch).first);
    await _settle(tester);
    await tester.tap(find.bySemanticsLabel('Close').last);
    await tester.pumpAndSettle();
    expect(api.patches.single.$1, startsWith('/api/items/9f29782e'));
    expect(api.patches.single.$2, {'show_in_store': true});

    // Bundle -> the inventory adjustments page.
    await tester.tap(find.byIcon(LucideIcons.arrowUpDown).first);
    await tester.pumpAndSettle();
    expect(find.text('Adjustments'), findsWidgets);
    Navigator.of(tester.element(find.text('Adjustments').first)).pop();
    await tester.pumpAndSettle();

    // Adjust stock on DAL CHANA (-5.434 KGS).
    await tester.tap(find.byIcon(LucideIcons.arrowUpDown).at(1));
    await _settle(tester);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/65-adjust-stock.png'));
    expect(find.text('Current stock: -5.434 KGS', findRichText: true), findsOneWidget);
    await tester.tap(find.text('Save adjustment'));
    await tester.pumpAndSettle();
    expect(find.text('Enter a quantity greater than zero'), findsOneWidget);
    Future<void> hideSheetToast() async {
      ScaffoldMessenger.of(tester.element(find.text('Adjust stock'))).clearSnackBars();
      await tester.pumpAndSettle();
    }
    await hideSheetToast();
    await tester.tap(find.text('Reduce stock'));
    await tester.enterText(find.byType(TextField).first, '2');
    await tester.pumpAndSettle();
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/66-adjust-stock-reduce.png'));
    expect(find.text('New stock: -7.434 KGS', findRichText: true), findsOneWidget);
    await tester.tap(find.text('Save adjustment'));
    await tester.pumpAndSettle();
    expect(find.text('Stock cannot go below zero'), findsOneWidget);
    expect(api.posts.where((p) => p.$1 == '/api/inventory-adjustments'), isEmpty);
    await hideSheetToast();

    await tester.tap(find.text('Add stock'));
    await tester.tap(find.text('Stock take'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Damage').last);
    await tester.pumpAndSettle();
    expect(find.text('What was damaged'), findsOneWidget);
    await tester.tap(find.text('Save damage'));
    await tester.pumpAndSettle();
    expect(find.text('Stock cannot go below zero'), findsOneWidget, reason: 'adding 2 to -5.434 is still negative');
    await hideSheetToast();
    await tester.enterText(find.byType(TextField).first, '6');
    await tester.pumpAndSettle();
    expect(find.text('New stock: 0.566 KGS', findRichText: true), findsOneWidget);
    await tester.tap(find.text('Save damage'));
    await tester.pumpAndSettle();
    expect(find.text('Say what was damaged'), findsOneWidget);
    await hideSheetToast();
    await tester.enterText(find.byType(TextField).last, 'Crushed packets');
    api.postError = ApiException('Growth plan required');
    await tester.tap(find.text('Save damage'));
    await _settle(tester);
    expect(find.text('Growth plan required'), findsOneWidget);
    await hideSheetToast();
    api.postError = null;
    api.posts.clear();
    await tester.tap(find.text('Save damage'));
    await _settle(tester);
    final (postPath, body) = api.posts.where((p) => p.$1 != '/api/promotions/track').single;
    expect(postPath, '/api/inventory-adjustments');
    expect(body['adjustment_type'], 'QUANTITY');
    expect(body['direction'], 'INCREASE');
    expect(body['quantity'], 6);
    expect(body['reason_code'], 'DAMAGE');
    expect(body['reason_notes'], 'Crushed packets');
    expect(body['branch_id'], _branch);
    expect(body['item_id'], startsWith('d84364ac'));
    expect(body['adjustment_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    for (final k in ['business_id', 'created_by', 'user_id', 'location_id']) {
      expect(body.keys, isNot(contains(k)));
    }
    expect(find.text('Save damage'), findsNothing);
    expect(find.text('Stock updated'), findsOneWidget);
    ScaffoldMessenger.of(tester.element(find.byType(ItemsScreen))).hideCurrentSnackBar();
    await tester.pumpAndSettle();

    // Detail: BIRYANI RICE overview, transactions, history and More.
    await tester.tap(find.text('BIRYANI RICE'));
    await _settle(tester);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/67-item-detail.png'));
    expect(find.byIcon(LucideIcons.pencil), findsOneWidget);
    tester.view.physicalSize = const Size(390, 900);
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/68-item-detail-full.png'));
    tester.view.physicalSize = const Size(390, 844);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Transactions'));
    await _settle(tester);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/69-item-detail-transactions.png'));
    expect(find.text('₹ 475 • 5 invoice(s)'), findsOneWidget);
    expect(find.text('4.33 KGS'), findsOneWidget);
    await tester.tap(find.text('History'));
    await _settle(tester);
    expect(find.text('No activity recorded yet.'), findsOneWidget);
    await tester.tap(find.byTooltip('More'));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/70-item-detail-more.png'));

    // Remove from catalog: DeleteAction modal, soft-delete DELETE, list refresh.
    await tester.tap(find.text('Remove from catalog'));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/71-item-delete-confirm.png'));
    expect(find.textContaining('Remove "BIRYANI RICE" from your catalog?'), findsOneWidget);
    final listLoads = api.gets.where((g) => g.startsWith('/api/items?')).length;
    await tester.tap(find.text('Delete'));
    await _settle(tester);
    expect(api.deletes.single, startsWith('/api/items/23a71606'));
    expect(find.byType(ItemDetailScreen), findsNothing);
    expect(find.text('Item deleted successfully'), findsOneWidget);
    expect(api.gets.where((g) => g.startsWith('/api/items?')).length, listLoads + 1);

    debugDisableShadows = true;
    KhatarioColors.applyPortalTheme(null);
  }, skip: !haveRef);

  testWidgets('item detail transactions table for DAL CHANA', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = _FakeApi();
    final raw = _read(_themeDir, 'session');
    KhatarioColors.applyPortalTheme(raw['portalTheme']);
    final id = (_read(_itemsDir, 'items')['items'] as List).cast<Map>()[1]['id'] as String;
    await tester.pumpWidget(MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: khatarioTheme(),
      home: ItemDetailScreen(session: AppSession(api, raw), itemId: id, onOpen: (_) {}),
    ));
    await _settle(tester);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/72-item-detail-dal.png'));
    await tester.tap(find.text('Transactions'));
    await _settle(tester);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/73-item-detail-dal-transactions.png'));
    KhatarioColors.applyPortalTheme(null);
  }, skip: !haveRef);
}
