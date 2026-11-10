import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/hub/supply_orders_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/purchases/purchase_section.dart';
import 'package:khatario_phone/screens/reports/aging_report_screen.dart';
import 'package:khatario_phone/session.dart';

import 'fixtures/more_hrefs.dart';

void main() {
  final session = AppSession(KhatarioApi(Dio()), {'user': {'id': 'u'}, 'business': {'id': 'b'}});

  test('every More link has a decided home', () {
    for (final href in moreHrefs) {
      final tier = routeTier(session, href);
      expect(tier, isNot(RouteTier.none), reason: href);
      if (tier == RouteTier.generic) expect(stillGeneric, contains(href), reason: '$href fell back to the automatic list');
      if (tier == RouteTier.website) {
        expect(websiteByDesign.contains(href) || websiteForNow.contains(href), isTrue, reason: '$href opens the website without being listed');
      }
    }
  });

  test('stillGeneric holds no link that already has a screen', () {
    for (final href in stillGeneric) {
      expect(nativeScreenFor(session, href), isNull, reason: href);
    }
  });

  test('hub and purchase links keep their screens', () {
    expect(nativeScreenFor(session, '/supply-orders?role=vendor'), isA<SupplyOrdersScreen>());
    expect(nativeScreenFor(session, '/purchases'), isA<PurchaseSectionScreen>());
    expect(nativeScreenFor(session, '/reports/aging/payables'), isA<AgingReportScreen>());
    expect(routeTier(session, '/invoices'), RouteTier.tab);
    expect(routeTier(session, '/docs'), RouteTier.website);
  });
}
