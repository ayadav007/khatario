import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/settings/plan_picker_logic.dart';

void main() {
  test('yearly prices show a monthly equivalent and the discount', () {
    final growth = {
      'name': 'growth',
      'display_name': 'Growth',
      'price_monthly': 399,
      'price_yearly': 399 * 12 * 0.8,
      'description': 'For a growing shop',
      'features': {
        'limits': {'max_invoices_per_month': -1, 'max_users': 3},
        'features': {'invoice_creation': true, 'reports_gst': false},
      },
    };
    expect(yearlySavePercent(399, 399 * 12), isNull);
    expect(yearlySavePercent(399, 399 * 12 * 0.8), 20);
    expect(bestYearlySave([growth, {'price_monthly': 0, 'price_yearly': 0}]), 20);
    expect(planCardPrice(growth, yearly: true), '₹319/mo');
    expect(planStruckMonthly(growth, yearly: true), '₹399/mo');
    expect(planBilledYearly(growth, yearly: true), contains('billed yearly'));
    expect(planCardPrice({'price_monthly': 0, 'price_yearly': 0}, yearly: false), 'Free');
    expect(planIsPopular(growth), isTrue);
    expect(planIncludedLines(growth), containsAll(['Unlimited invoices a month', '3 console seats', 'Invoice creation']));
  });
}
