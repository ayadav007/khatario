import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The server takes the business from the session and never trusts a client-sent business_id,
/// so the settings screens must not send one.
void main() {
  test('settings requests do not send business_id', () {
    final source = File('lib/screens/settings/settings_router.dart').readAsStringSync();
    expect(source.contains("'business_id'"), isFalse);
  });
}
