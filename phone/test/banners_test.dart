import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/shell/shell_banners.dart';
import 'package:khatario_phone/theme.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

class _FakeApi extends KhatarioApi {
  _FakeApi() : super(Dio());
  final posts = <Map<String, dynamic>>[];

  @override
  Future<Map<String, dynamic>> getJson(String path) async => throw ApiException('not faked: $path');

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    posts.add({'path': path, ...body});
    return {};
  }
}

Future<void> _loadFonts() async {
  final inter = FontLoader('Inter');
  for (final w in [400, 500, 600, 700, 900]) {
    inter.addFont(rootBundle.load('fonts/Inter-$w.ttf'));
  }
  await inter.load();
  final lucide = FontLoader('packages/lucide_icons_flutter/Lucide');
  lucide.addFont(rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'));
  await lucide.load();
}

void main() {
  setUpAll(_loadFonts);
  setUp(() => SharedPreferencesAsyncPlatform.instance = InMemorySharedPreferencesAsync.empty());

  group('SubscriptionBanner.state follows SubscriptionBanner.tsx', () {
    final now = DateTime(2026, 10, 13, 15);
    String? type(Map<String, dynamic> s) => SubscriptionBanner.state(s, now)?.$1;
    int? days(Map<String, dynamic> s) => SubscriptionBanner.state(s, now)?.$2;

    test('no banner for an active free plan without trial or grace', () {
      expect(type({'plan_id': 'free', 'status': 'active', 'downgraded_from': 'enterprise'}), isNull);
    });
    test('trial ending counts local calendar days', () {
      expect(type({'trial_end_date': '2026-10-13'}), 'trial_ending');
      expect(days({'trial_end_date': '2026-10-13'}), 0);
      expect(days({'trial_end_date': '2026-10-20T00:00:00.000Z'}), 7);
      expect(type({'trial_end_date': '2026-10-21'}), isNull);
      expect(type({'trial_end_date': '2026-10-12'}), 'trial_expired');
    });
    test('cancelled wins, extension modal suppresses the rest', () {
      final s = SubscriptionBanner.state({'cancel_at_period_end': true, 'end_date': '2026-11-05T10:00:00Z'}, now);
      expect(s?.$1, 'cancelled');
      expect(s?.$3, '5 Nov 2026');
      expect(type({'show_trial_extension_modal': true, 'trial_end_date': '2026-10-12'}), isNull);
    });
    test('grace period', () {
      expect(type({'grace_period_end': '2026-10-15T15:00:00'}), 'grace_expiring');
      expect(days({'grace_period_end': '2026-10-15T15:00:00'}), 2);
      expect(type({'grace_period_end': '2026-10-01', 'plan_id': 'free', 'downgraded_from': 'pro'}), 'grace_expired');
      expect(type({'grace_period_end': '2026-10-01', 'plan_id': 'free'}), isNull);
    });
  });

  test('usage nudge thresholds match usage-labels.ts', () {
    expect(usagePercent(2, 1), 100);
    expect(usagePercent(5, -1), 0);
    expect(shouldShowUsageNudge(79, 100), isFalse);
    expect(shouldShowUsageNudge(80, 100), isTrue);
    expect(shouldShowUsageNudge(16, -1), isFalse);
    expect(shouldShowUsageNudge(1, 0), isTrue);
  });

  testWidgets('banner styles and promotion modal', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    debugDisableShadows = false;

    final now = DateTime(2026, 10, 13, 12);
    final api = _FakeApi();
    final controller = ShellBannersController(AppSession(api, {
      'business': {'id': 'b1'},
    }));
    Widget sub(Map<String, dynamic> s, {bool compact = false}) =>
        SubscriptionBanner(subscription: s, compact: compact, now: now, onUpgrade: () {}, onDismiss: () {});
    await tester.pumpWidget(MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: khatarioTheme(),
      home: Scaffold(
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            sub({'trial_end_date': '2026-10-16'}),
            sub({'trial_end_date': '2026-10-16'}, compact: true),
            sub({'trial_end_date': '2026-10-01'}),
            sub({'grace_period_end': '2026-10-15T12:00:00'}),
            sub({'grace_period_end': '2026-10-01', 'plan_id': 'free', 'downgraded_from': 'pro'}),
            sub({'cancel_at_period_end': true, 'end_date': '2026-11-05T10:00:00Z'}),
            const SizedBox(height: 8),
            PromotionBanner(
              promo: const {
                'id': 'p1',
                'title': 'Upgrade to professional',
                'button_text': 'Learn More',
                'button_action': 'upgrade_modal',
                'background_color': '#3ad4df',
                'text_color': '#ffffff',
                'dismissible': true,
              },
              onTap: () {},
              onDismiss: () {},
            ),
          ],
        ),
      ),
    ));
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/40-banners.png'));

    final ctx = tester.element(find.byType(Scaffold));
    showPromotionModal(
      ctx,
      promo: const {
        'id': 'm1',
        'title': 'Diwali offer: 20% off yearly plans',
        'description': 'Upgrade before 31 October and save on any yearly plan.',
        'button_text': 'See plans',
        'button_action': 'upgrade_modal',
        'background_color': '#063F35',
        'text_color': '#ffffff',
        'show_once_per_business': false,
      },
      controller: controller,
      onOpen: (_) {},
    );
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/41-promotion-modal.png'));

    await tester.tap(find.text('Maybe later'));
    await tester.pumpAndSettle();
    expect(find.text('Maybe later'), findsNothing);
    expect(api.posts.single, {'path': '/api/promotions/track', 'promotion_id': 'm1', 'business_id': 'b1', 'action': 'dismiss'});
    controller.dispose();
    debugDisableShadows = true;
  });
}
