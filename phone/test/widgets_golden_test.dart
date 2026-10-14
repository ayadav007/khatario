import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/dashboard_widgets.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/theme.dart';

/// Renders "My Dashboard" from saved staging responses (see khatario-ref/capture-customize.cjs).
const _refDir = r'C:\Users\Abhishek\khatario-ref\api-b2';

class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());

  Map<String, dynamic> _load(String name) =>
      jsonDecode(File('$_refDir\\$name.json').readAsStringSync()) as Map<String, dynamic>;

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    return switch (path.split('?').first) {
      '/api/dashboard/widgets' => _load('widgets'),
      '/api/dashboard/top-customers' => _load('w_top_customers'),
      '/api/dashboard/low-stock' => _load('w_low_stock'),
      _ => throw ApiException('not faked: $path'),
    };
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

  testWidgets('my dashboard', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    debugDisableShadows = false;

    final api = _FakeApi();
    await tester.pumpWidget(MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: khatarioTheme(),
      home: Scaffold(
        body: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          children: [
            CustomizableDashboard(session: AppSession(api, const {}), enabledFeatures: const [], onOpen: (_) {}),
          ],
        ),
      ),
    ));
    for (var i = 0; i < 4; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
    }
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/20-widgets-view.png'));

    await tester.tap(find.text('Edit'));
    await tester.pump();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/21-widgets-edit.png'));

    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/22-widgets-add.png'));
    debugDisableShadows = true;
  }, skip: !Directory(_refDir).existsSync());
}
