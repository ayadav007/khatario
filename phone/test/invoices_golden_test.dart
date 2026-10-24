import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/format.dart';
import 'package:khatario_phone/screens/invoices/invoice_detail_screen.dart';
import 'package:khatario_phone/screens/invoices/invoices_screen.dart';
import 'package:khatario_phone/screens/invoices/record_payment_dialog.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/shell/app_shell.dart';
import 'package:khatario_phone/theme.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

/// Invoices list, detail, Record Payment, share and settings sheets from staging responses
/// (khatario-ref/capture-theme-api.cjs + capture-invoices-api.cjs). Skipped when they are not on this machine.
const _themeDir = r'C:\Users\Abhishek\khatario-ref\theme\api';
const _invDir = r'C:\Users\Abhishek\khatario-ref\invoices\api';

Map<String, dynamic> _read(String dir, String name) =>
    jsonDecode(File('$dir\\$name.json').readAsStringSync()) as Map<String, dynamic>;

class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());

  final gets = <String>[];
  final patches = <(String, Map<String, dynamic>)>[];
  Object? patchError;

  late final List<Map<String, dynamic>> _all =
      (_read(_invDir, 'list_all')['invoices'] as List).cast<Map<String, dynamic>>();

  String? _number(String id) => _all.where((i) => i['id'] == id).map((i) => i['invoice_number'] as String).firstOrNull;

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    gets.add(path);
    final uri = Uri.parse(path);
    final p = uri.path;
    final detail = RegExp(r'^/api/invoices/([0-9a-f-]{36})(/history)?$').firstMatch(p);
    if (detail != null) {
      final num = _number(detail[1]!);
      final file = File('$_invDir\\detail_$num${detail[2] == null ? '' : '_history'}.json');
      if (num == null || !file.existsSync()) throw ApiException('Invoice not found');
      return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    }
    return switch (p) {
      '/api/invoices' => _read(
          _invDir,
          uri.queryParameters['channel'] == 'counter'
              ? 'list_counter'
              : 'list_${uri.queryParameters['status'] ?? 'all'}',
        ),
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
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async => {};

  @override
  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async {
    patches.add((path, body));
    if (patchError != null) throw patchError!;
    return {'invoice': {}};
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
  // "system" preset: desktop Chrome on Windows (where the web reference is captured) uses Segoe UI.
  final system = FontLoader('Roboto');
  for (final f in ['segoeui.ttf', 'seguisb.ttf', 'segoeuib.ttf']) {
    final file = File('C:\\Windows\\Fonts\\$f');
    if (file.existsSync()) system.addFont(file.readAsBytes().then((b) => ByteData.sublistView(b)));
  }
  await system.load();
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
    await tester.pump();
  }
  await tester.pumpAndSettle();
}

void main() {
  final haveRef = Directory(_invDir).existsSync() && Directory(_themeDir).existsSync();

  setUpAll(_loadFonts);
  setUp(() => SharedPreferencesAsyncPlatform.instance = InMemorySharedPreferencesAsync.empty());

  group('filterInvoices follows app/(app)/invoices/page.tsx', () {
    final all = [
      {'invoice_number': 'INV-1', 'customer_name': 'Akshat', 'status': 'final', 'payment_status': 'paid', 'channel': 'manual'},
      {'invoice_number': 'INV-2', 'customer_name': null, 'status': 'draft', 'payment_status': 'unpaid', 'channel': null},
      {'invoice_number': 'INV-3', 'customer_name': 'Ravi', 'status': 'cancelled', 'payment_status': 'unpaid'},
      {'invoice_number': 'PI-4', 'customer_name': 'Ravi', 'status': 'final', 'document_type': 'proforma_invoice'},
      {'invoice_number': 'INV-5', 'customer_name': 'Ravi', 'status': 'final', 'payment_status': 'unpaid', 'channel': 'counter'},
    ];
    List<String> run({String search = '', String status = 'all', String channel = 'all'}) =>
        filterInvoices(all, search: search, status: status, channel: channel).map((i) => i['invoice_number'] as String).toList();

    test('drops cancelled and proforma', () => expect(run(), ['INV-1', 'INV-2', 'INV-5']));
    test('search matches number or customer, case-insensitive', () {
      expect(run(search: 'ravi'), ['INV-5']);
      expect(run(search: ' inv-2 '), ['INV-2']);
    });
    test('status chips use status for draft/final and payment_status for paid/unpaid', () {
      expect(run(status: 'draft'), ['INV-2']);
      expect(run(status: 'final'), ['INV-1', 'INV-5']);
      expect(run(status: 'unpaid'), ['INV-2', 'INV-5']);
    });
    test('missing channel counts as manual', () {
      expect(run(channel: 'manual'), ['INV-1', 'INV-2']);
      expect(run(channel: 'counter'), ['INV-5']);
    });
  });

  test('payment status and amounts match the website', () {
    expect(deriveInvoicePaymentStatus('74.00', '0.00', '74.00'), 'unpaid');
    expect(deriveInvoicePaymentStatus('100', '40', '60'), 'partially_paid');
    expect(deriveInvoicePaymentStatus('100', '100', null), 'paid');
    expect(deriveInvoicePaymentStatus('1180', '0', '0'), 'paid');
    expect(formatInvoiceInr('1156.02'), '₹ 1,156.02');
    expect(formatInvoiceInr('283.5200'), '₹ 283.52');
    expect(jsNumberString(74.0), '74');
    expect(jsNumberString(1156.02), '1156.02');
  });

  testWidgets('invoices list, sheets and detail', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    debugDisableShadows = false;

    final api = _FakeApi();
    final raw = await tester.runAsync(() => api.getJson('/api/auth/session')) ?? {};
    KhatarioColors.applyPortalTheme(raw['portalTheme']);
    final session = AppSession(api, raw);
    expect(session.defaultBranchId, 'd579383f-871d-4b91-a1d4-2bf6273c6666');

    await tester.pumpWidget(MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: khatarioTheme(),
      home: AppShell(session: session, onSessionChanged: () async {}, onSignOut: () async {}),
    ));
    await _settle(tester);
    await tester.tap(find.text('Invoices').last);
    await _settle(tester);

    expect(api.gets, contains('/api/invoices?limit=100&branch_id=d579383f-871d-4b91-a1d4-2bf6273c6666'));
    expect(api.gets.where((g) => g.contains('user_id') || g.startsWith('/api/invoices?') && g.contains('business_id')), isEmpty);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/50-invoices.png'));

    tester.view.physicalSize = const Size(390, 2200);
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/51-invoices-full.png'));
    expect(find.text('36 bills'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Show more (11 left)'), 500, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Show more (11 left)'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Show more'), findsNothing);
    tester.view.physicalSize = const Size(390, 844);
    await tester.pumpAndSettle();

    // Draft chip sends status=draft and resets to page 1.
    await tester.drag(find.byType(ListView).first, const Offset(0, 3000));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Draft').first);
    await _settle(tester);
    expect(api.gets.last, '/api/invoices?limit=100&branch_id=d579383f-871d-4b91-a1d4-2bf6273c6666&status=draft');
    expect(find.byType(InvoiceListRow), findsOneWidget);
    await tester.tap(find.text('All').first);
    await _settle(tester);

    // Search filters in memory.
    await tester.enterText(find.byType(TextField).first, 'akshat yadu');
    await tester.pumpAndSettle();
    expect(find.text('INV-034'), findsNothing);
    expect(find.text('INV-035'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, '');
    await tester.pumpAndSettle();

    // Invoice & print settings sheet.
    await tester.tap(find.byIcon(LucideIcons.layoutTemplate));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/52-invoice-settings-sheet.png'));
    await tester.tap(find.text('Number series'));
    await tester.pumpAndSettle();
    // Number series now lives on the phone's Invoices & documents settings page.
    expect(find.text('Invoices & documents'), findsOneWidget);
    Navigator.of(tester.element(find.text('Invoices & documents'))).pop();
    await tester.pumpAndSettle();

    // Share sheet, from the row's long-press menu.
    await tester.longPress(find.byType(InvoiceListRow).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Share'));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/53-share-sheet.png'));
    expect(find.text('Share as PDF'), findsOneWidget);
    await tester.tap(find.byIcon(LucideIcons.x).last);
    await tester.pumpAndSettle();

    // Record payment: client-side validation, then the exact PATCH body the website sends.
    Future<void> submitPayment() async {
      await tester.ensureVisible(find.text('Record Payment').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Record Payment').last);
      await tester.pumpAndSettle();
    }

    await tester.longPress(find.byType(InvoiceListRow).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Record payment'));
    await tester.pumpAndSettle();
    expect(find.text('Invoice: INV-035', findRichText: true), findsOneWidget);
    final amountField = find.byType(TextField).at(1);
    expect(tester.widget<TextField>(amountField).controller!.text, '74');
    await tester.enterText(amountField, '80');
    await submitPayment();
    expect(find.text('Amount received plus TDS cannot exceed balance of ₹74'), findsOneWidget);
    expect(api.patches, isEmpty);

    await tester.enterText(amountField, '74');
    await tester.enterText(find.byType(TextField).at(2), '4');
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(amountField).controller!.text, '70');
    api.patchError = ApiException('Accounting period is locked for this date');
    await submitPayment();
    expect(find.text('Accounting period is locked for this date'), findsOneWidget);
    api.patchError = null;
    await submitPayment();
    final inv035 = api._all.firstWhere((i) => i['invoice_number'] == 'INV-035');
    expect(api.patches.last.$1, '/api/invoices/${inv035['id']}/payments');
    final body = api.patches.last.$2;
    expect(body['amount'], 70);
    expect(body['tds_amount'], 4);
    expect(body['tds_section'], '194C');
    expect(body['payment_mode'], 'cash');
    expect(body['reference'], isNull);
    expect(body['payment_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    expect(body.keys, isNot(contains('business_id')));
    expect(body.keys, isNot(contains('user_id')));
    expect(find.text('Record Payment'), findsNothing);
    expect(api.gets.where((g) => g == '/api/badges/counts').length, greaterThanOrEqualTo(2));

    // Detail: unpaid INV-035 overview, then INV-033 payments, history and More menu.
    await tester.tap(find.text('INV-035'));
    await _settle(tester);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/54-invoice-detail.png'));
    await tester.tap(find.byIcon(LucideIcons.arrowLeft));
    await tester.pumpAndSettle();

    await tester.tap(find.text('INV-033'));
    await _settle(tester);
    await tester.tap(find.text('Payments'));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/55-invoice-detail-payments.png'));
    await tester.tap(find.text('History'));
    await _settle(tester);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/56-invoice-detail-history.png'));
    expect(find.text('Shalini • 10 Oct 2026, 07:31'), findsOneWidget);
    await tester.tap(find.byTooltip('More'));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/57-invoice-detail-more.png'));
    expect(find.byIcon(LucideIcons.pencil), findsNothing);

    debugDisableShadows = true;
    KhatarioColors.applyPortalTheme(null);
  }, skip: !haveRef);

  testWidgets('record payment dialog', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    debugDisableShadows = false;
    final raw = haveRef ? _read(_themeDir, 'session') : <String, dynamic>{};
    KhatarioColors.applyPortalTheme(raw['portalTheme']);

    await tester.pumpWidget(MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: khatarioTheme(),
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => showRecordPaymentDialog(
                context,
                api: _FakeApi(),
                invoiceId: 'i1',
                invoiceNumber: 'INV-035',
                grandTotal: 74,
                paidAmount: 0,
                balanceAmount: 74,
                today: DateTime(2026, 10, 13),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/58-record-payment.png'));
    debugDisableShadows = true;
    KhatarioColors.applyPortalTheme(null);
  });
}
