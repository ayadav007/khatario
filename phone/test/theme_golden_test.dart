import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/shell/app_shell.dart';
import 'package:khatario_phone/theme.dart';

/// Renders Home for a business with a portal theme (khatario-ref/capture-theme-api.cjs).
/// Skipped when the responses are not on this machine.
const _refDir = r'C:\Users\Abhishek\khatario-ref\theme\api';

class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());

  Map<String, dynamic> _load(String name) =>
      jsonDecode(File('$_refDir\\$name.json').readAsStringSync()) as Map<String, dynamic>;

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    final p = path.split('?').first;
    return switch (p) {
      '/api/auth/session' => _load('session'),
      '/api/dashboard/overview' => _load('overview'),
      '/api/dashboard/sales-trend' => _load('sales_trend'),
      '/api/dashboard/recent-transactions' => _load('recent'),
      '/api/badges/counts' => _load('badges'),
      '/api/businesses/my' => _load('businesses'),
      '/api/notifications' => _load('notifications'),
      '/api/features/enabled' => _load('features'),
      '/api/dashboard/cash-flow' => _load('cash_flow'),
      '/api/dashboard/charts' => _load('charts'),
      '/api/dashboard/widgets' => _load('widgets'),
      '/api/dashboard/top-customers' => _load('w_top_customers'),
      '/api/dashboard/low-stock' => _load('w_low_stock'),
      '/api/promotions/active' => _load(path.contains('type=modal') ? 'promo_modal' : 'promo_banner'),
      '/api/subscriptions/current' => _load('subscription'),
      '/api/subscriptions/check-limit' => _load('limit_${RegExp(r'limit_type=(\w+)').firstMatch(path)![1]}'),
      _ => throw ApiException('not faked: $path'),
    };
  }

  final posts = <(String, Map<String, dynamic>)>[];

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    posts.add((path, body));
    return {};
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

void main() {
  final haveRef = Directory(_refDir).existsSync();

  setUpAll(_loadFonts);
  setUp(() => SharedPreferencesAsyncPlatform.instance = InMemorySharedPreferencesAsync.empty());

  test('portal theme scale matches lib/portal-theme.ts', () {
    final t = PortalTheme.fromJson({'primary_hex': '#E11D48', 'accent_hex': 'bfe8e4', 'font_preset': 'system'});
    String hex(Color c) => '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';
    // Values computed by the website in staging (getComputedStyle on --color-primary-*).
    expect(t.primary.map(hex).toList(), [
      '#fdeff2', '#fbdde4', '#f5b7c4', '#ef89a0', '#e95878', '#e11d48', '#e11d48', '#a21534', '#83112a', '#650d20',
    ]);
    expect(t.accent.map(hex).toList(), [
      '#fbfdfd', '#f5fcfb', '#ebf8f6', '#def3f1', '#d0eeeb', '#bfe8e4', '#a4c8c4', '#8aa7a4', '#6f8784', '#566867',
    ]);
    expect(t.fontFamily, isNull);
    expect(PortalTheme.fromJson(null).primary.map(hex).toList(), [
      '#edf0f0', '#d9dfde', '#aebbb9', '#7c918d', '#45625c', '#032b23', '#032b23', '#021f19', '#021914', '#011310',
    ]);
    expect(PortalTheme.fromJson({'primary_hex': 'nope'}).signature, PortalTheme.defaults.signature);
    expect(PortalTheme.fromJson({'primary_hex': '#123', 'font_preset': 'comic'}).fontFamily, 'Inter');
  });

  testWidgets('home with portal theme', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    debugDisableShadows = false;

    final api = _FakeApi();
    final raw = await tester.runAsync(() => api.getJson('/api/auth/session')) ?? {};
    KhatarioColors.applyPortalTheme(raw['portalTheme']);
    final session = AppSession(api, raw);
    expect(bottomNavItems(session).map((i) => i.$2), ['Home', 'Invoices', 'Chats', 'Parties', 'More']);

    await tester.pumpWidget(MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: khatarioTheme(),
      home: AppShell(session: session, onSessionChanged: () async {}, onSignOut: () async {}),
    ));
    for (var i = 0; i < 5; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
    }
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/30-theme-home.png'));
    expect(find.text('Upgrade to professional'), findsOneWidget);
    expect(find.text('Bring your whole team on board'), findsOneWidget);
    expect(api.posts.where((p) => p.$1 == '/api/promotions/track' && p.$2['action'] == 'view'), hasLength(1));

    tester.view.physicalSize = const Size(390, 2400);
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView).first, const Offset(0, 2000));
    for (var i = 0; i < 5; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/31-theme-home-full.png'));
    debugDisableShadows = true;
    KhatarioColors.applyPortalTheme(null);
  }, skip: !haveRef);

  test('bottom nav layouts follow BottomNav.tsx', () {
    List<String> labels(Map<String, dynamic> raw) => bottomNavItems(AppSession(KhatarioApi(Dio()), raw)).map((i) => i.$2).toList();
    Map<String, dynamic> s(List<String> modules, {String seat = 'billing', bool admin = false, bool invoices = false, Map<String, dynamic>? nav}) => {
          'isPrimaryAdmin': admin,
          'user': {'seat_type': seat, if (nav != null) 'mobile_nav': nav},
          'platform': {'enabledModules': modules},
          'permissions': {
            'invoices': {'can_view': invoices},
          },
        };
    expect(labels(s(['billing'])), ['Home', 'Invoices', 'Items', 'Parties', 'More']);
    expect(labels(s([])), ['Home', 'Invoices', 'Items', 'Parties', 'More']);
    expect(labels(s(['billing', 'connect', 'hr'])), ['Home', 'Invoices', 'Chats', 'Parties', 'More']);
    expect(labels(s(['connect'])), ['Home', 'Chats', 'Contacts', 'More']);
    expect(labels(s(['hr'])), ['Home', 'Team', 'Attendance', 'More']);
    expect(labels(s(['hr', 'connect'])), ['Home', 'Team', 'Attendance', 'More']);
    expect(labels(s(['billing', 'connect'], seat: 'connect')), ['Chats', 'Contacts', 'Parties', 'More']);
    expect(labels(s(['billing', 'connect'], seat: 'connect', invoices: true)), ['Chats', 'Contacts', 'Orders', 'More']);
    expect(labels(s(['billing'], nav: {'slotCount': 4, 'middle': ['items', 'parties']})), ['Home', 'Items', 'Parties', 'More']);
    expect(
      labels(s(['billing'], nav: {'slotCount': 5, 'middle': ['parties', 'invoices', 'items']})),
      ['Home', 'Parties', 'Invoices', 'Items', 'More'],
    );
  });
}
