import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/upgrade/upgrade_copy.dart';
import 'package:khatario_phone/upgrade/upgrade_sheet.dart';

class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());

  @override
  Future<Map<String, dynamic>> getJson(String path) async => {
        'recommendedPlan': {'planId': 'billing_starter', 'planDisplayName': 'Starter', 'priceMonthly': 299, 'planLimit': 3},
      };
}

void main() {
  testWidgets('limit sheet says sorry, shows the plan and opens the plans', (tester) async {
    var opened = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: UpgradeSheet(
          request: const UpgradeRequest(UpgradeVariant.limit, limitType: 'users', limit: 1, current: 1),
          api: _FakeApi(),
          onSeePlans: () => opened++,
        ),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Sorry, your plan has room for 1 user'), findsOneWidget);
    expect(find.text('1 of 1'), findsOneWidget);
    expect(find.text('Starter · ₹299/month'), findsOneWidget);
    await tester.ensureVisible(find.text('See plans'));
    await tester.tap(find.text('See plans'));
    await tester.pumpAndSettle();
    expect(opened, 1);
  });

  test('the header drawing escapes text and keeps the five objects distinct', () {
    final svg = upgradeIllustrationSvg(buildUpgradeCopy(const UpgradeRequest(UpgradeVariant.feature, featureName: 'P&L <beta>'), null));
    expect(svg, contains('P&amp;L &lt;beta'));
    expect(svg, isNot(contains('<beta>')));
  });
}
