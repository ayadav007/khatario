@Tags(['walk'])
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/shell/app_shell.dart';
import 'package:khatario_phone/theme.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

import 'fixtures/more_hrefs.dart';
import 'support/walk/walk_api.dart';
import 'support/walk/walk_fixtures.dart';
import 'support/walk/walk_report.dart';
import 'support/walk/walk_walker.dart';

/// Walks the phone app the way an owner does: every More link, every bottom tab, and from each page every row, tab
/// and card that leads on, down to depth 4. It never taps a button that writes; any write that still reaches the fake
/// server fails the walk. Run on its own with `flutter test test/walk_every_page_test.dart`.
///
/// `WALK_ONLY=reports,tds` (no leading slash: Git Bash rewrites those) limits the More links to those that start with one of the prefixes (for debugging).
void main() {
  // The real fonts, so a line wraps here where it wraps on a phone (the test font is far wider).
  setUpAll(() async {
    final inter = FontLoader('Inter');
    for (final w in [400, 500, 600, 700]) {
      inter.addFont(rootBundle.load('fonts/Inter-$w.ttf'));
    }
    await inter.load();
  });
  setUp(() => SharedPreferencesAsyncPlatform.instance = InMemorySharedPreferencesAsync.empty());

  Map<String, dynamic> ownerSession({List<String> middle = const ['invoices', 'items', 'parties']}) => {
        'user': {
          'id': 'u1',
          'name': 'Rakesh Sharma',
          'email': 'rakesh@example.com',
          'mobile_nav': {'slotCount': 5, 'middle': middle},
        },
        'business': {'id': 'b1', 'name': 'Sharma Textiles', 'gstin': '27AABCU9603R1ZM', 'state': 'Maharashtra'},
        'isPrimaryAdmin': true,
        'platform': {
          'enabledModules': ['billing', 'connect', 'hr'],
        },
        'branches': [
          {'id': 'br1', 'name': 'Main branch', 'is_active': true},
        ],
      };

  Future<void> mountHost(WidgetTester t, Walker w, AppSession session, {Widget? home, BuildContext? Function()? out}) async {
    w.observer = WalkObserver();
    await t.pumpWidget(MaterialApp(
      key: UniqueKey(),
      theme: khatarioTheme(),
      navigatorObservers: [w.observer],
      home: home ?? Builder(builder: (c) {
        _hostContext = c;
        return const Scaffold(body: SizedBox.shrink());
      }),
    ));
    await t.pump(const Duration(milliseconds: 100));
  }

  Future<void> unmount(WidgetTester t) async {
    await t.pumpWidget(const SizedBox.shrink());
    await t.pump(const Duration(seconds: 2));
  }

  /// Runs [body] with every Flutter error and stray async error written to [w].
  Future<void> guarded(Walker w, Future<void> Function() body) async {
    final old = FlutterError.onError;
    FlutterError.onError = w.recordFlutterError;
    final done = Completer<void>();
    runZonedGuarded(() async {
      try {
        await body();
      } finally {
        done.complete();
      }
    }, (e, s) => w.fail('exception', 'uncaught async error: $e'));
    await done.future;
    FlutterError.onError = old;
  }

  Future<void> walkAll(WidgetTester t, {required String name, required WalkFixtures fixtures, required bool deep}) async {
    t.view.physicalSize = const Size(420, 2400);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);

    final api = WalkApi(fixtures);
    final session = api.session(raw: ownerSession());
    final walker = Walker(
      t: t,
      api: api,
      widgetNames: khatarioWidgetNames(),
      maxDepth: deep ? 4 : 1,
      pagesPerRoot: deep ? 70 : 12,
    );
    final only = (Platform.environment['WALK_ONLY'] ?? '').split(',').where((s) => s.isNotEmpty).map((s) => s.startsWith('/') ? s : '/$s').toList();
    final onlyTabs = (Platform.environment['WALK_TABS'] ?? '').split(',').where((s) => s.isNotEmpty).toList();
    final started = DateTime.now();
    final labels = {for (final href in moreHrefs) href: walkLabelFor(href)};

    await guarded(walker, () async {
      // Bottom tabs: each in the shell the owner sees.
      if (only.isEmpty) {
        for (final (tab, middle) in const [
          ('Home', ['invoices', 'items', 'parties']),
          ('Invoices', ['invoices', 'items', 'parties']),
          ('Items', ['invoices', 'items', 'parties']),
          ('Parties', ['invoices', 'items', 'parties']),
          ('Chats', ['chats', 'contacts', 'team']),
          ('Contacts', ['chats', 'contacts', 'team']),
          ('Team', ['chats', 'contacts', 'team']),
          ('Attendance', ['attendance', 'invoices', 'items']),
        ]) {
          if (onlyTabs.isNotEmpty && !onlyTabs.contains(tab)) continue;
          final shellSession = api.session(raw: ownerSession(middle: middle));
          await mountHost(t, walker, shellSession, home: AppShell(session: shellSession, onSessionChanged: () async {}, onSignOut: () async {}));
          await walker.settle();
          if (tab != 'Home') {
            await t.tap(find.text(tab).last);
            await walker.settle();
          }
          await walker.openRoot(['$tab tab'], keyOverride: 'AppShell|$tab');
          await unmount(t);
        }
      }

      // Every More link, opened the way the app opens it.
      for (final href in moreHrefs) {
        if (onlyTabs.isNotEmpty || (only.isNotEmpty && !only.any(href.startsWith))) continue;
        final label = labels[href]!;
        await mountHost(t, walker, session);
        openAppHref(_hostContext!, session, href, label);
        await walker.openRoot(['More', label]);
        await unmount(t);
      }

      // Screens the phone has that the More menu does not list (reached from a push, a search or another screen).
      for (final href in extraNativeHrefs(session)) {
        if (onlyTabs.isNotEmpty || (only.isNotEmpty && !only.any(href.startsWith))) continue;
        await mountHost(t, walker, session);
        openAppHref(_hostContext!, session, href, walkLabelFor(href));
        await walker.openRoot(['Link', href]);
        await unmount(t);
      }

      // The More tab itself: every row opens its page.
      if (only.isEmpty && onlyTabs.isEmpty) {
        final shellSession = api.session(raw: ownerSession());
        await mountHost(t, walker, shellSession, home: AppShell(session: shellSession, onSessionChanged: () async {}, onSignOut: () async {}));
        await walker.settle();
        await t.tap(find.text('More').last);
        await walker.settle();
        await walker.openRoot(['More tab'], keyOverride: 'AppShell|More');
        await unmount(t);
      }
    });

    final report = WalkReport.build(
      name: name,
      walker: walker,
      api: api,
      fixtures: fixtures,
      elapsed: DateTime.now().difference(started),
      readOnlyPosts: _readOnlyPosts,
    );
    // ignore: avoid_print
    print(report.summary);
    report.write(name);
    expect(report.failureCount, 0, reason: report.summary);
  }

  testWidgets(
    'walk every page: owner with every plan feature on',
    (t) async {
      await walkAll(t, name: 'owner', fixtures: WalkFixtures(enabledFeatures: allFeatureIds()), deep: true);
    },
    timeout: const Timeout(Duration(minutes: 20)),
  );

  testWidgets(
    'walk every page: a small plan, locked pages open without errors',
    (t) async {
      final fixtures = WalkFixtures(enabledFeatures: const ['sales_invoices', 'customer_management', 'item_management'], restricted: true);
      await walkAll(t, name: 'restricted', fixtures: fixtures, deep: false);
    },
    timeout: const Timeout(Duration(minutes: 20)),
  );
}

BuildContext? _hostContext;

/// Links the phone answers with its own screen that the More menu list does not hold. Read from the route tables in lib/.
List<String> extraNativeHrefs(AppSession session) {
  final files = [
    'lib/screens/pages/native_routes.dart',
    'lib/screens/settings/settings_router.dart',
    ...Directory('lib/screens/reports').listSync().whereType<File>().map((f) => f.path.replaceAll(r'\', '/')),
  ];
  final found = <String>{};
  final literal = RegExp(r"'(/[a-z0-9][a-z0-9/\-]*)'");
  for (final path in files) {
    for (final m in literal.allMatches(File(path).readAsStringSync())) {
      found.add(m.group(1)!);
    }
  }
  return [
    for (final href in found.toList()..sort())
      if (!moreHrefs.contains(href) && !moreHrefs.contains('$href/') && nativeScreenFor(session, href) != null && href != '/') href,
  ];
}

/// Requests a tap may send without asking. Lookups sent by POST (the server offers no GET for them) and previews store
/// nothing; marking a notification read is the website's behaviour too.
final _readOnlyPosts = <RegExp>[
  // Opening a notification marks it read, as on the website: the one write a tap may make, and it only sets the read flag.
  RegExp(r'^PATCH /api/notifications/[^/]+/read'),
  RegExp(r'^POST /api/pricing/resolve'),
  RegExp(r'^POST /api/hr/leave/year-end .*"preview":true'),
];
