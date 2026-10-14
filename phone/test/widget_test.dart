import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/main.dart';

void main() {
  testWidgets('Sign in matches the website: phone first, then password', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const KhatarioApp(restoreSession: false));
    expect(find.text('Sign in to your business'), findsOneWidget);
    expect(find.text('Phone Number'), findsOneWidget);
    expect(find.text('Forgot password?'), findsOneWidget);
    expect(find.text('Continue'), findsOneWidget);

    await tester.tap(find.text('Continue'));
    await tester.pump();
    expect(find.text('Please enter your phone number'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '9876543210');
    await tester.tap(find.text('Continue'));
    await tester.pump();
    expect(find.text('Password'), findsOneWidget);
    expect(tester.widget<TextField>(find.byType(TextField)).keyboardType, TextInputType.visiblePassword);
    expect(tester.widget<EditableText>(find.byType(EditableText)).keyboardType, isNot(TextInputType.phone));
    expect(find.text('Change Number'), findsOneWidget);
    expect(find.text('Login'), findsOneWidget);

    await tester.tap(find.text('Forgot password?'));
    await tester.pump();
    expect(find.text('Reset your password'), findsOneWidget);
    expect(find.text('Send WhatsApp and email codes'), findsOneWidget);
  });
}
