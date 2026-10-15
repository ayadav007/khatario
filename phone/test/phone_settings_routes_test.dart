import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/settings/settings_router.dart';
import 'package:khatario_phone/session.dart';

void main() {
  test('former website settings open a phone screen', () {
    final session = AppSession(KhatarioApi(Dio()), {
      'user': {'id': 'u', 'name': 'Rakesh'},
      'business': {'id': 'b', 'name': 'Sharma Textiles'},
    });
    const hrefs = [
      '/settings/branches',
      '/settings/warehouses',
      '/settings/business#bp-payments',
      '/settings/payments',
      '/settings/financial-years',
      '/settings/period-locks',
      '/settings/account-mappings',
      '/settings/users',
      '/employees',
      '/settings/roles',
      '/settings/whatsapp/team',
      '/settings/activity',
      '/settings/whatsapp',
      '/settings/whatsapp/templates',
      '/settings/whatsapp/inbox',
      '/settings/whatsapp/ai-agent',
      '/settings/whatsapp/notifications',
      '/settings/whatsapp/shop',
      '/settings/email',
      '/settings/integrations?category=sms',
      '/settings/shifts',
      '/settings/weekly-off',
      '/settings/holiday-lists',
      '/settings/attendance-policy',
      '/settings/ot-policy',
      '/settings/attendance-regularization',
      '/settings/leave-plan',
      '/settings/hr-approval',
      '/settings/payroll',
      '/settings/salary-components',
      '/settings/commission-rules',
      '/settings/offer-letter',
      '/settings/onboarding-templates',
      '/settings/employee-portal',
      '/settings/hr-employee',
      '/settings/products',
      '/settings/backup',
      '/settings/help/how-to',
      '/docs',
      '/settings/help',
      '/support',
      '/privacy',
      '/settings/offline-sync',
      '/settings/bluetooth-printer',
      '/settings/bluetooth-printer/diagnostics',
      '/settings/automation',
      '/items/categories',
      '/settings/label-templates',
      '/settings/online-store',
      '/settings/online-store/studio',
      '/pricing/party-item',
      '/tools',
      '/whatsapp/send-message',
      '/hr/leaves/year-end',
      '/hr/leaves/import-balances',
      '/settings/subscription',
    ];
    for (final href in hrefs) {
      expect(phoneSettingPage(session, href), isNotNull, reason: href);
    }
  });
}
