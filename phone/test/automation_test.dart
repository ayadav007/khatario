import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/settings/more_settings.dart';

import 'support/recorded_session.dart';

void main() {
  test('Workflow automation stays on the website: a small phone screen explains it and opens the website', () {
    final (session, _) = recordedSession((o, b) => (200, <String, dynamic>{}));
    expect(nativeScreenFor(session, '/settings/automation'), isNotNull);
  });

  testWidgets('the restore row says why it opens the website', (t) async {
    final (session, _) = recordedSession((o, b) => (200, <String, dynamic>{}));
    await pumpScreen(t, PlanDataSettingsScreen(session: session));
    await t.ensureVisible(find.text('Restore from a backup'));
    expect(find.text('Restore from a backup'), findsOneWidget);
    expect(
      find.text(
        'Restoring a backup replaces your data, so it is done on the website.',
      ),
      findsOneWidget,
    );
    expect(find.text('Open'), findsOneWidget);
  });
}
