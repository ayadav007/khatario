import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/main.dart';

/// Renders screens at 390x844 so they can be compared with the website at the same width.
/// Run with `flutter test --update-goldens test/screens_golden_test.dart`.
Future<void> _loadInter() async {
  final loader = FontLoader('Inter');
  for (final w in [400, 500, 600, 700]) {
    loader.addFont(rootBundle.load('fonts/Inter-$w.ttf'));
  }
  await loader.load();
}

void main() {
  setUpAll(_loadInter);

  testWidgets('login screens', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const KhatarioApp(restoreSession: false));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/01-login-phone.png'));

    await tester.enterText(find.byType(TextField), '9876543210');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/02-login-password.png'));

    await tester.tap(find.text('Forgot password?'));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/03-forgot.png'));
  });
}
