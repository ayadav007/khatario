import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';

void main() {
  test('more-menu sales routes resolve to their list APIs', () {
    expect(pageForHref('/estimates')?.path, '/api/estimates');
    expect(pageForHref('/credit-notes')?.listKey, 'creditNotes');
    expect(pageForHref('/payments/out')?.path, contains('payable'));
    expect(pageForHref('/reports/profit-loss')?.query, PageQuery.range);
    expect(pageForHref('/settings')?.href, '/settings');
    expect(pageForHref('/credit-notes/new')?.path, '/api/credit-notes');
    expect(pageForHref('/reports/gst/gstr2b')?.query, PageQuery.month);
    expect(pageForHref('/does-not-exist'), isNull);
    expect(sessionBusinessPath('/api/businesses/current', 'biz-1'), '/api/businesses/biz-1');
    expect(sessionBusinessPath('/api/subscriptions/current', 'biz-1'), '/api/subscriptions/current');
    expect(pageForHref('/settings/invoice')?.href, '/settings/templates');
    expect(pageForHref('/settings/gst-config')?.path, '/api/businesses/current');
    expect(pageForHref('/settings/number-series')?.path, '/api/settings/number-series');
    expect(pageForHref('/settings/whatsapp/templates')?.path, '/api/settings/whatsapp-templates');
    expect(pageForHref('/settings/offline-sync')?.path, '/api/offline-sync/history?limit=50');
    expect(pageForHref('/settings/backup')?.path, '/api/backup/history?limit=10');
    expect(pageForHref('/settings/export')?.href, '/settings/backup');
    expect(pageForHref('/settings/templates')?.path, '/api/template-assignments');
    expect(pageForHref('/settings/user-management')?.path, '/api/settings/user-management');
    expect(pageForHref('/settings/online-store')?.path, '/api/settings/online-store');
    expect(pageForHref('/settings/online-store/orders')?.path, '/api/settings/online-store/orders');
    expect(pageForHref('/settings/online-store/enquiries')?.path, '/api/settings/online-store/enquiries');
    expect(pageForHref('/settings/features')?.title, 'Appearance');
    expect(pageForHref('/settings/whatsapp')?.path, '/api/whatsapp/status');
    expect(pageForHref('/settings/whatsapp/ai-agent')?.path, '/api/ai-agent');
    expect(pageForHref('/settings/whatsapp/team')?.path, '/api/settings/users');
    expect(pageForHref('/settings/suppliers-directory')?.path, '/api/suppliers/hub/discovery');
    expect(pageForHref('/settings/commission-rules')?.path, '/api/commission-rules');
    expect(pageForHref('/settings/offer-letter')?.path, '/api/settings/offer-letter-template');
    expect(pageForHref('/settings/onboarding-templates')?.path, '/api/hr/onboarding-templates');
    expect(pageForHref('/settings/products')?.path, '/api/modules');
    expect(pageForHref('/settings/user-warehouses')?.path, '/api/user-warehouses');
    expect(pageForHref('/employees/org-chart')?.path, '/api/employees/org-chart');
    expect(pageForHref('/employees/leaves/calendar')?.path, '/api/employees/leave-calendar');
    expect(pageForHref('/whatsapp/group-extractor')?.path, '/api/tools/whatsapp-groups');
    expect(pageForHref('/bank/import')?.path, '/api/bank-accounts');
    expect(pageForHref('/employees/leaves')?.path, '/api/employees/leave-requests');
    expect(pageForHref('/employees/salary/payments')?.path, '/api/employees/salary/payments');
    expect(pageForHref('/credit-approvals')?.path, '/api/credit-approvals/pending');
    expect(pageForHref('/reports/gst/compliance')?.path, '/api/gst/compliance-alerts');
    for (final href in ['/pricing/party-item', '/hr/leaves/year-end', '/settings/automation', '/settings/help']) {
      expect(pageForHref(href)?.path, href, reason: 'website-only page');
    }
    for (final section in settingsSections) {
      for (final (href, _) in section.$2) {
        final page = pageForHref(href);
        expect(page, isNotNull, reason: href);
        final local = href == '/upgrade' || href.startsWith('/settings/help') || href == '/settings/bluetooth-printer' || href == '/settings/automation';
        if (!local) expect(page!.path.startsWith('/api/'), isTrue, reason: '$href -> ${page.path}');
      }
    }
    expect(settingsSections.map((s) => s.$1), containsAll(['Account', 'People', 'WhatsApp', 'Help']));
  });

  test('a list payload and a bare array both become rows', () {
    expect(recordsFromBody({'estimates': [{'invoice_number': 'EST-1'}]}, 'estimates').single, {'invoice_number': 'EST-1'});
    expect(recordTitle({'name': 'Ravi', 'id': '1'}), 'Ravi');
    expect(recordsFromBody([{'title': 'Call'}], null).single['title'], 'Call');
  });
}
