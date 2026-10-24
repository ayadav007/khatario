import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/shell/app_shell.dart';
import 'package:khatario_phone/theme.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

/// Renders Home from saved staging responses (see khatario-ref/capture-api.cjs).
/// Skipped when the responses are not on this machine.
const _refDir = r'C:\Users\Abhishek\khatario-ref\api';

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
      _ => throw ApiException('not faked: $path'),
    };
  }
}

Future<void> _loadInter() async {
  final loader = FontLoader('Inter');
  for (final w in [400, 500, 600, 700]) {
    loader.addFont(rootBundle.load('fonts/Inter-$w.ttf'));
  }
  await loader.load();
  final lucide = FontLoader('packages/lucide_icons_flutter/Lucide');
  lucide.addFont(rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'));
  await lucide.load();
  for (final w in [500, 600]) {
    final l = FontLoader('packages/lucide_icons_flutter/Lucide$w');
    l.addFont(rootBundle.load('packages/lucide_icons_flutter/assets/build_font/LucideVariable-w$w.ttf'));
    await l.load();
  }
}

void main() {
  final haveRef = Directory(_refDir).existsSync();

  setUpAll(_loadInter);
  setUp(() => SharedPreferencesAsyncPlatform.instance = InMemorySharedPreferencesAsync.empty());

  testWidgets('home', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    debugDisableShadows = false;

    final api = _FakeApi();
    final session = AppSession(api, await tester.runAsync(() => api.getJson('/api/auth/session')) ?? {});
    await tester.pumpWidget(MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: khatarioTheme(),
      home: AppShell(session: session, onSessionChanged: () async {}, onSignOut: () async {}),
    ));
    for (var i = 0; i < 5; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
    }
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/10-home.png'));

    await tester.drag(find.byType(ListView).first, const Offset(0, -600));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/11-home-scrolled.png'));
    tester.view.physicalSize = const Size(390, 2400);
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView).first, const Offset(0, 2000));
    for (var i = 0; i < 5; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/12-home-full.png'));
    debugDisableShadows = true;
  }, skip: !haveRef);
}
