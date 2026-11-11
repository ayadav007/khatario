import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/upgrade/upgrade_copy.dart';

const growth = RecommendedPlan(planId: 'billing_growth', planLabel: 'Growth', priceMonthly: 499);
const starter = RecommendedPlan(planId: 'billing_starter', planLabel: 'Starter', priceMonthly: 299, planLimit: -1);

void main() {
  group('UpgradeRequest.fromApi', () {
    test('plan denial on a write is a feature request', () {
      final e = ApiException('no', status: 403, code: 'FEATURE_NOT_IN_PLAN', body: const {'feature': 'eway_bill'});
      final req = UpgradeRequest.fromApi('POST', e)!;
      expect(req.variant, UpgradeVariant.feature);
      expect(req.featureKey, 'eway_bill');
    });

    test('WhatsApp inbox goes to the Connect add-on', () {
      final e = ApiException('no', status: 403, code: 'FEATURE_NOT_IN_PLAN', body: const {'feature': 'integration_whatsapp_bot'});
      expect(UpgradeRequest.fromApi('POST', e)!.variant, UpgradeVariant.addon);
    });

    test('limit reply keeps its numbers', () {
      final e = ApiException('no', status: 403, code: 'SUBSCRIPTION_LIMIT_EXCEEDED', body: const {'limit_type': 'users', 'limit': 1, 'current': 1});
      final req = UpgradeRequest.fromApi('PUT', e)!;
      expect(req.variant, UpgradeVariant.limit);
      expect(req.limitType, 'users');
      expect(req.limit, 1);
      expect(req.current, 1);
    });

    test('reads and other errors are ignored', () {
      expect(UpgradeRequest.fromApi('GET', ApiException('no', status: 403, code: 'FEATURE_NOT_IN_PLAN')), isNull);
      expect(UpgradeRequest.fromApi('POST', ApiException('no', status: 403, code: 'PERMISSION_DENIED')), isNull);
      expect(UpgradeRequest.fromApi('POST', ApiException('no', status: 400, code: 'FEATURE_NOT_IN_PLAN')), isNull);
    });
  });

  group('buildUpgradeCopy', () {
    test('feature names the feature and plan', () {
      final c = buildUpgradeCopy(const UpgradeRequest(UpgradeVariant.feature, featureKey: 'profit_reports_basic'), growth);
      expect(c.title, "Sorry, Profit by invoice isn't in your plan");
      expect(c.ctaLabel, 'Upgrade to Growth');
      expect(c.tag, 'Not in your plan');
    });

    test('feature without key reads well', () {
      expect(buildUpgradeCopy(const UpgradeRequest(UpgradeVariant.feature), null).title, "Sorry, this feature isn't in your plan");
    });

    test('limit counts with the period', () {
      final c = buildUpgradeCopy(const UpgradeRequest(UpgradeVariant.limit, limitType: 'estimates', limit: 20, current: 20), starter);
      expect(c.title, "Sorry, you've used all 20 estimates this month");
    });

    test('users read as room for people', () {
      expect(buildUpgradeCopy(const UpgradeRequest(UpgradeVariant.limit, limitType: 'users', limit: 1, current: 1), null).title,
          'Sorry, your plan has room for 1 user');
    });

    test('limit without a type falls back', () {
      expect(buildUpgradeCopy(const UpgradeRequest(UpgradeVariant.limit), null).title, "Sorry, you've reached your plan's limit");
    });

    test('addon points to Connect', () {
      final c = buildUpgradeCopy(const UpgradeRequest(UpgradeVariant.addon, featureKey: 'integration_whatsapp_bot'), null);
      expect(c.title, 'Sorry, WhatsApp inbox needs Khatario Connect');
      expect(c.ctaLabel, 'Add Khatario Connect');
    });

    test('trial counts down', () {
      expect(buildUpgradeCopy(const UpgradeRequest(UpgradeVariant.trial, trialDaysLeft: 3), starter).title, 'Your free trial ends in 3 days');
      expect(buildUpgradeCopy(const UpgradeRequest(UpgradeVariant.trial, trialDaysLeft: 0), starter).title, 'Your free trial ends today');
      expect(buildUpgradeCopy(const UpgradeRequest(UpgradeVariant.trial, trialDaysLeft: -1), starter).title, 'Your free trial has ended');
    });
  });

  test('snooze lasts until the end of the day', () {
    final snooze = UpgradeSnooze();
    const req = UpgradeRequest(UpgradeVariant.limit, limitType: 'users');
    snooze.snooze(req, DateTime(2026, 11, 2, 9));
    expect(snooze.isSnoozed(req, DateTime(2026, 11, 2, 23, 59)), isTrue);
    expect(snooze.isSnoozed(req, DateTime(2026, 11, 3, 0, 1)), isFalse);
  });
}
