import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/capability.dart';
import 'package:khatario_phone/screens/hub/supply_orders_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/purchases/purchase_section.dart';
import 'package:khatario_phone/screens/reports/aging_report_screen.dart';
import 'package:khatario_phone/session.dart';

import 'fixtures/more_hrefs.dart';

void main() {
  final session = AppSession(KhatarioApi(Dio()), {'user': {'id': 'u'}, 'business': {'id': 'b'}});

  test('every More link opens a phone screen, a tab or the website by design', () {
    for (final href in moreHrefs) {
      final tier = routeTier(session, href);
      expect(tier, isIn([RouteTier.native, RouteTier.tab, RouteTier.website]), reason: href);
      if (tier == RouteTier.website) {
        expect(websiteByDesign.contains(href), isTrue, reason: '$href opens the website without being kept there by design');
      }
    }
  });

  test('a link with no screen and not kept by design still opens the website, never a list', () {
    expect(nativeScreenFor(session, '/reports/not-a-real-report'), isNull);
    expect(routeTier(session, '/reports/not-a-real-report'), RouteTier.website);
    expect(routeTier(session, '/purchases/something-new'), RouteTier.website);
  });

  testWidgets('a push or search link with no screen is not opened as a list', (t) async {
    late BuildContext ctx;
    await t.pumpWidget(MaterialApp(home: Builder(builder: (c) {
      ctx = c;
      return const SizedBox();
    })));
    expect(openKnownScreen(ctx, session, '/reports/not-a-real-report', 'Notification'), isFalse);
    expect(openKnownScreen(ctx, session, '/hr/some-old-page', 'Notification'), isFalse);
    await t.pump();
    expect(find.byType(Scaffold), findsNothing);
  });

  test('hub and purchase links keep their screens', () {
    expect(nativeScreenFor(session, '/supply-orders?role=vendor'), isA<SupplyOrdersScreen>());
    expect(nativeScreenFor(session, '/purchases'), isA<PurchaseSectionScreen>());
    expect(nativeScreenFor(session, '/reports/aging/payables'), isA<AgingReportScreen>());
    expect(routeTier(session, '/invoices'), RouteTier.tab);
    expect(routeTier(session, '/docs'), RouteTier.website);
  });

  testWidgets('a link opened from More carries the shell capabilities, so a plan lock shows', (t) async {
    late BuildContext ctx;
    await t.pumpWidget(MaterialApp(home: Builder(builder: (c) {
      ctx = c;
      return const SizedBox();
    })));
    const small = Capabilities(
      sessionIsPrimaryAdmin: true,
      sessionPermissions: {},
      snapshot: CapabilitySnapshot(permissions: {}, isPrimaryAdmin: true, enabledFeatures: ['sales_invoices']),
    );
    openAppHref(ctx, session, '/whatsapp/send-message', 'Send message', capabilities: small);
    await t.pump();
    await t.pump(const Duration(milliseconds: 400));
    expect(find.byIcon(LucideIcons.lock), findsWidgets);
  });
}
