import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/settings/more_settings.dart';

import 'support/recorded_session.dart';

void main() {
  test('Workflow automation stays on the website: its page loads no list and has no server route to save to', () {
    expect(isWebsiteOnlyHref('/settings/automation'), isTrue);
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
