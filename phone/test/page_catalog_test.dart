import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';

void main() {
  test('a menu label finds its website link, whatever the case or spacing', () {
    expect(hrefForMenuTitle('Quotations'), '/estimates');
    expect(hrefForMenuTitle('  profit & loss '), '/reports/profit-loss');
    expect(hrefForMenuTitle('Settings'), '/settings');
    expect(hrefForMenuTitle('No such page'), isNull);
  });

  test('a link kept on the website ignores its query and fragment', () {
    expect(opensWebsiteByDesign('/reports/gst/gstr9?year=2025'), isTrue);
    expect(opensWebsiteByDesign('/settings/online-store/studio#theme'), isTrue);
    expect(opensWebsiteByDesign('/invoices'), isFalse);
  });
}
