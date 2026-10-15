import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/shell/app_shell.dart';
import 'package:khatario_phone/theme.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

class _QuietApi extends KhatarioApi {
  _QuietApi() : super(Dio());

  @override
  Future<Map<String, dynamic>> getJson(String path) async => {};
}

void main() {
  setUp(() => SharedPreferencesAsyncPlatform.instance = InMemorySharedPreferencesAsync.empty());

  testWidgets('back returns to home, and the next back leaves the app', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final session = AppSession(_QuietApi(), {
      'user': {'id': 'u', 'name': 'Rakesh'},
      'business': {'id': 'b', 'name': 'Sharma Textiles'},
      'isPrimaryAdmin': true,
      'platform': {'enabledModules': ['billing']},
    });
    await tester.pumpWidget(MaterialApp(
      theme: khatarioTheme(),
      home: AppShell(session: session, onSessionChanged: () async {}, onSignOut: () async {}),
    ));
    await tester.pump();

    await tester.tap(find.text('More'));
    await tester.pump();
    expect(_onMore(), isTrue);

    final shellContext = tester.element(find.byType(AppShell));
    Navigator.of(shellContext).push(MaterialPageRoute(builder: (_) => const Scaffold(body: Text('Detail'))));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Detail'), findsOneWidget);

    expect(await Navigator.of(shellContext).maybePop(), isTrue);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('Detail'), findsNothing);
    expect(_onMore(), isTrue);

    // Back on More is absorbed and returns to Home. Flutter reports that as handled.
    expect(await Navigator.of(shellContext).maybePop(), isTrue);
    await tester.pump();
    expect(_onMore(), isFalse);
    expect(find.byType(AppShell), findsOneWidget);

    // Home is the root. This back is handed to Android, which closes the app.
    expect(await Navigator.of(shellContext).maybePop(), isFalse);
  });
}

bool _onMore() =>
    find.text('Loading menu…').evaluate().isNotEmpty || find.text('Log out').evaluate().isNotEmpty;
