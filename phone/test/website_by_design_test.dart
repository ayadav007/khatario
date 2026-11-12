import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/more/more_screen.dart';
import 'package:khatario_phone/shell/shell_banners.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/reports/reports_home_screen.dart';
import 'package:khatario_phone/screens/settings/more_settings.dart';
import 'package:khatario_phone/screens/settings/settings_kit.dart';
import 'package:khatario_phone/screens/tools/tools_hub_screen.dart';
import 'package:khatario_phone/ui/kit.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

import 'support/fake_session.dart';

const _caption = 'Opens the website';

Object? _menuReply(RequestOptions o) {
  if (o.uri.path == '/api/navigation/more') {
    return {
      'sections': [
        {
          'title': 'Reports',
          'items': [
            {'href': '/reports/gst/gstr9', 'label': 'GSTR-9', 'locked': false},
            {
              'href': '/reports/profit-loss',
              'label': 'Profit & Loss',
              'locked': false,
            },
          ],
        },
      ],
    };
  }
  return {
    'summary': {'total_sales': 1, 'total_amount': 1},
    'totals': {'total_amount': 1},
    'net_profit': 1,
  };
}

Future<void> _show(WidgetTester t, Widget screen) async {
  t.view.physicalSize = const Size(800, 3000);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  await t.pumpWidget(MaterialApp(home: screen));
  await t.pumpAndSettle();
}

void main() {
  rowHintTests();
  setUp(
    () => SharedPreferencesAsyncPlatform.instance =
        InMemorySharedPreferencesAsync.empty(),
  );

  group('websiteByDesign', () {
    final (session, _) = fakeSession((_) => {});
    for (final href in websiteByDesign) {
      test('$href is a website route', () {
        expect(routeTier(session, href), RouteTier.website);
        expect(opensWebsiteByDesign(href), isTrue);
      });
    }

    test('a native or unknown link is not marked', () {
      expect(opensWebsiteByDesign('/invoices'), isFalse);
      expect(opensWebsiteByDesign('/reports/profit-loss'), isFalse);
      expect(opensWebsiteByDesign('/settings/business'), isFalse);
    });

    test('a link with a query or fragment is still found', () {
      expect(opensWebsiteByDesign('/reports/gst/gstr9?year=2025'), isTrue);
      expect(
        opensWebsiteByDesign('/settings/online-store/studio#theme'),
        isTrue,
      );
    });
  });

  group('globe hint', () {
    testWidgets('KListRow shows the globe and the words only when asked', (
      t,
    ) async {
      await _show(
        t,
        const Scaffold(
          body: Column(
            children: [
              KListRow(title: 'GSTR-9', opensWebsite: true),
              KListRow(title: 'Profit & Loss'),
            ],
          ),
        ),
      );
      expect(find.text(_caption), findsOneWidget);
      expect(find.byIcon(LucideIcons.globe), findsOneWidget);
    });

    testWidgets('More menu row', (t) async {
      await _show(
        t,
        Scaffold(
          body: Column(
            children: [
              MobileListRow(
                label: 'Image Reducer',
                icon: LucideIcons.wrench,
                opensWebsite: true,
                onTap: () {},
              ),
              MobileListRow(
                label: 'Invoices',
                icon: LucideIcons.fileText,
                onTap: () {},
              ),
            ],
          ),
        ),
      );
      expect(find.text(_caption), findsOneWidget);
      expect(find.byIcon(LucideIcons.globe), findsOneWidget);
    });

    testWidgets('settings: Help rows open native screens, so no hint', (
      t,
    ) async {
      final (s, _) = fakeSession((_) => {});
      await _show(t, HelpSettingsScreen(session: s));
      expect(find.text(_caption), findsNothing);
      expect(find.text('Printer diagnostics'), findsOneWidget);
      expect(find.byIcon(LucideIcons.globe), findsNothing);
    });

    testWidgets('NavSetting with a native href has no hint', (t) async {
      await _show(
        t,
        Scaffold(
          body: NavSetting(
            label: 'Branches',
            opensWebsite: false,
            onTap: () {},
          ),
        ),
      );
      expect(find.text(_caption), findsNothing);
    });

    testWidgets('reports home: GSTR-9 is marked, Profit & Loss is not', (
      t,
    ) async {
      final (s, _) = fakeSession(_menuReply);
      await _show(t, ReportsHomeScreen(session: s));
      expect(find.text('GSTR-9'), findsOneWidget);
      expect(find.text(_caption), findsNWidgets(1));
    });

    testWidgets(
      'tools hub: the image tools and group extractor are marked, calculators are not',
      (t) async {
        final (s, _) = fakeSession((_) => {});
        await _show(t, ToolsHubScreen(session: s));
        expect(find.text('Image Reducer'), findsOneWidget);
        expect(find.text('BG Remover'), findsOneWidget);
        expect(find.text('WhatsApp Group Extractor'), findsOneWidget);
        expect(find.text('EMI Calculator'), findsOneWidget);
        expect(find.text(_caption), findsNWidgets(3));
      },
    );

    testWidgets('More screen marks the website pages the server lists', (
      t,
    ) async {
      final (s, _) = fakeSession(_menuReply);
      await _show(
        t,
        Scaffold(
          body: MoreScreen(
            session: s,
            banners: ShellBannersController(s),
            onNavigate: (_, _) {},
            onOpen: (_) {},
            onSignOut: () async {},
            onEditNav: () {},
          ),
        ),
      );
      expect(find.text('GSTR-9'), findsOneWidget);
      expect(find.text(_caption), findsOneWidget);
    });
  });
}

void rowHintTests() {
  group('row hint follows where the tap goes', () {
    final (session, _) = fakeSession((_) => {});
    for (final href in const [
      '/settings/help/how-to',
      '/docs',
      '/settings/help',
      '/support',
      '/privacy',
      '/settings/online-store/studio',
      '/hr/leaves/year-end',
      '/hr/leaves/import-balances',
    ]) {
      test('$href has a native screen, so no hint', () {
        expect(rowOpensWebsite(session, href), isFalse);
      });
    }
    test('GSTR-9 really opens the website, so it has the hint', () {
      expect(rowOpensWebsite(session, '/reports/gst/gstr9'), isTrue);
    });
    testWidgets('a hinted link is never answered by the automatic list', (t) async {
      late BuildContext ctx;
      await t.pumpWidget(MaterialApp(home: Builder(builder: (c) {
        ctx = c;
        return const SizedBox();
      })));
      for (final h in websiteByDesign.where((h) => rowOpensWebsite(session, h))) {
        expect(openKnownScreen(ctx, session, h, 'x'), isFalse, reason: h);
      }
    });
    test('a native link not in websiteByDesign has no hint', () {
      expect(rowOpensWebsite(session, '/invoices'), isFalse);
    });
    test('hints for every websiteByDesign href', () {
      final hinted = [
        for (final h in websiteByDesign)
          if (rowOpensWebsite(session, h)) h,
      ]..sort();
      expect(hinted, [
        '/bank/import',
        '/opening-balances/setup',
        '/reports/builder',
        '/reports/gst/gstr9',
        '/reports/profit-loss/schedule-iii',
        '/reports/profit-loss/validation',
        '/settings/label-templates/new',
        '/tools/image-background-remover',
        '/tools/image-size-reducer',
        '/tools/whatsapp-group-extractor',
        '/whatsapp/group-extractor',
      ]);
    });
  });
}
