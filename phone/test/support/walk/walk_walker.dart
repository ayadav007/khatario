import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'walk_api.dart';
import 'walk_icons.dart';

/// One thing that went wrong, with the way the walker got there.
class WalkFailure {
  WalkFailure(this.kind, this.path, this.detail);

  final String kind;
  final String path;
  final String detail;

  String get key => '$kind|$path|${detail.split('\n').first}';

  @override
  String toString() => '[$kind] $path: ${detail.split('\n').first}';
}

/// Tracks the route stack, so the walker knows what a tap opened.
class WalkObserver extends NavigatorObserver {
  final stack = <Route<dynamic>>[];
  final events = <String>[];

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    stack.add(route);
    events.add(route is PageRoute ? 'page' : 'popup');
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    stack.remove(route);
    events.add('pop');
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    stack.remove(route);
    events.add('pop');
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    final i = oldRoute == null ? -1 : stack.indexOf(oldRoute);
    if (i >= 0 && newRoute != null) {
      stack[i] = newRoute;
    } else if (newRoute != null) {
      stack.add(newRoute);
    }
    events.add('replace');
  }
}

/// A tap target on the current page.
class WalkTarget {
  WalkTarget(this.kind, this.label, this.key, this.center, {this.mayStay = false});

  final String kind;
  final String label;
  final String key;
  final Offset center;

  /// A tab or chip that is already selected: a tap that changes nothing is right.
  final bool mayStay;
}

/// Words on a button that make a write. These are never tapped.
final _actionWords = RegExp(
  r'^(save|send|delete|pay|approve|reject|submit|convert|start|pause|resume|publish|unpublish|archive|mark|dismiss|cancel|'
  r'disconnect|sync|import|generate|restart|reopen|snooze|remove|confirm|apply|update|create|post|settle|refund|void|revoke|'
  r'reset|clear|sign out|log out|logout|deactivate|activate|finalize|finalise|restore|undo|'
  r'receive|dispatch|assign|schedule|reconcile|match|ignore|enroll|punch|check in|check out|mute|unmute|block|unblock|'
  r'upgrade|subscribe|buy|renew|add stock|adjust|reverse|deposit|withdraw|discard|retry|try again|record|collect|'
  r'open count|show linking|invite|add a rule|run |post production|check buyers|decline|accept|ask to connect|withdraw|'
  r'follow|unfollow|extend|escalate|assign|take over|hand over|resolve|reopen)\b',
  caseSensitive: false,
);

/// Device actions the test host has no plugin for. Their requests are listed as not walked.
final _deviceWords = RegExp(
  r'^(scan|camera|photo|gallery|upload|attach|share|print|download|export|pdf|call|dial|copy|location|'
  r'maps|qr|biometric|face|voice|open in browser|browser|choose file|pick|take |add photo|replace photo|csv|email)\b',
  caseSensitive: false,
);

/// Controls that write the moment they are tapped: a quantity stepper, an attendance status chip.
final _stepperOrStatus = RegExp(r'^(less|more|present|absent|half day|off|late)$', caseSensitive: false);

const _deviceScreens = {'PdfViewerScreen', 'PrintersScreen'};

/// A row that dials, mails or opens a map when tapped ("9876543210 Customer phone").
final _deviceSuffix = RegExp(r'(phone|mobile|e-?mail|address)$', caseSensitive: false);

final _errorText = RegExp(
  r'^(Could not (load|reach|find|open|read|fetch)|Unable to load|Something went wrong|Request failed|Failed to load|Error loading|'
  r'Server error)',
  caseSensitive: false,
);

class WalkStats {
  int rootsWalked = 0;
  int pagesOpened = 0;
  int pagesDescended = 0;
  int tapsMade = 0;
  int sheetsOpened = 0;
  int stateChanges = 0;
  int skippedAction = 0;
  int skippedDevice = 0;
  int skippedToggle = 0;
  List<String> deepest = const [];
  final skippedLabels = <String>{};
  final pageKeys = <String>[];
}

class Walker {
  Walker({
    required this.t,
    required this.api,
    required this.widgetNames,
    this.maxDepth = 4,
    this.pagesPerRoot = 70,
    this.targetsPerPage = 45,
  });

  final WidgetTester t;
  final WalkApi api;
  final Set<String> widgetNames;
  final int maxDepth;
  final int pagesPerRoot;
  final int targetsPerPage;

  final failures = <String, WalkFailure>{};
  final stats = WalkStats();
  final walked = <String>{};
  WalkObserver observer = WalkObserver();
  int _pagesThisRoot = 0;
  List<String> _path = const [];

  void fail(String kind, String detail, {List<String>? path}) {
    final f = WalkFailure(kind, (path ?? _path).join(' › '), detail);
    failures.putIfAbsent(f.key, () => f);
  }

  // ---- errors ------------------------------------------------------------

  void recordFlutterError(FlutterErrorDetails d) {
    final text = d.exceptionAsString();
    final kind = text.contains('overflowed') ? 'layout overflow' : 'exception';
    if (Platform.environment['WALK_DEBUG'] != null) {
      // ignore: avoid_print
      print('ERR ${_path.join(' > ')}');
      // ignore: avoid_print
      print(d.toString(minLevel: DiagnosticLevel.info).split(_nl).take(40).join(_nl));
    }
    fail(kind, text.split('\n').take(2).join(' '));
  }

  // ---- waiting -----------------------------------------------------------

  /// Spinners and bars that run without a value: the page is waiting. A bar with a value is a gauge (paid so far).
  Iterable<Element> _waiting() => find
      .byWidgetPredicate((w) => w is ProgressIndicator && w.value == null)
      .evaluate();

  bool hasLoading() => _waiting().isNotEmpty;

  /// Which of the app's own widgets holds the spinner that will not go ("InvoiceDetailScreen > _Header").
  String loadingOwner() {
    final spinner = _waiting().firstOrNull;
    if (spinner == null) return '';
    final names = <String>[];
    spinner.visitAncestorElements((a) {
      final n = _typeName(a.widget);
      if (widgetNames.contains(n) && names.length < 3) names.add(n);
      return true;
    });
    return names.join(' < ');
  }

  /// Pumps fake time until the page stops loading. True when it did.
  Future<bool> settle({int minPumps = 6, int maxPumps = 50}) async {
    await t.pump();
    for (var i = 0; i < maxPumps; i++) {
      await t.pump(const Duration(milliseconds: 100));
      if (i + 1 >= minPumps && !hasLoading()) return true;
    }
    return !hasLoading();
  }

  List<String> visibleTexts() {
    final out = <String>[];
    for (final e in find.byType(Text).evaluate()) {
      final w = e.widget as Text;
      final s = w.data ?? w.textSpan?.toPlainText();
      if (s != null && s.trim().isNotEmpty) out.add(s.trim());
    }
    return out;
  }

  /// The words that show the page is in its failed state while the fake server answered 200.
  String? errorTextOnScreen() {
    for (final s in visibleTexts()) {
      if (_errorText.hasMatch(s)) return s;
    }
    return null;
  }

  // ---- reading the page --------------------------------------------------

  Element? get _topContent {
    for (final r in observer.stack.reversed) {
      final c = r is ModalRoute ? r.subtreeContext : null;
      if (c is Element) return c;
    }
    return null;
  }

  Element? _topPageContent() {
    for (final r in observer.stack.reversed) {
      final c = r is PageRoute ? r.subtreeContext : null;
      if (c is Element) return c;
    }
    return null;
  }

  String _typeName(Widget w) => w.runtimeType.toString().replaceAll(RegExp(r'<.*'), '');

  /// Screen type and title of the page on top, used to remember pages already walked.
  String pageKey() {
    final root = _topPageContent();
    if (root == null) return 'none|';
    String? type;
    var title = '';
    void visit(Element e) {
      if (type != null && title.isNotEmpty) return;
      final w = e.widget;
      if (type == null && widgetNames.contains(_typeName(w))) type = _typeName(w);
      if (title.isEmpty) {
        if (w is KBackBar) {
          title = w.title;
        } else if (w is KPageTitle) {
          title = w.title;
        } else if (w is AppBar && w.title is Text) {
          title = ((w.title! as Text).data) ?? '';
        }
      }
      e.visitChildren(visit);
    }

    root.visitChildren(visit);
    return '${type ?? 'page'}|$title';
  }

  String pageType() => pageKey().split('|').first;

  String _textOf(Element e) {
    final parts = <String>[];
    String? icon;
    void visit(Element x) {
      final w = x.widget;
      if (w is Text) {
        final s = w.data ?? w.textSpan?.toPlainText();
        if (s != null && s.trim().isNotEmpty) parts.add(s.trim());
      } else if (w is Tooltip && w.message != null) {
        parts.add(w.message!);
      } else if (w is Icon && w.icon != null) {
        final lucide = (w.icon!.fontFamily ?? '').contains('Lucide');
        // Material's send arrow has no label in the composer; name it so the walker never taps it.
        final material = w.icon!.codePoint == 0xe571 ? 'send' : null;
        icon ??= (lucide ? lucideNames()[w.icon!.codePoint] : material) ?? 'icon-${w.icon!.codePoint.toRadixString(16)}';
      }
      x.visitChildren(visit);
    }

    visit(e);
    if (parts.isNotEmpty) return parts.join(' ').trim();
    return icon == null ? '' : '[$icon]';
  }

  bool _containsToggle(Element e) {
    var found = false;
    void visit(Element x) {
      if (found) return;
      final w = x.widget;
      if (w is Switch || w is Checkbox || w is Radio || w is Slider || w is TextField || w is EditableText) {
        found = true;
        return;
      }
      x.visitChildren(visit);
    }

    visit(e);
    return found;
  }

  /// Every tap target on the page on top: kit rows, chips, segments, tiles, icon buttons.
  List<WalkTarget> collectTargets() {
    final root = _topContent;
    if (root == null) return const [];
    final size = t.view.physicalSize / t.view.devicePixelRatio;
    final screen = Offset.zero & size;
    final out = <WalkTarget>[];
    final used = <String, int>{};
    final centers = <String>{};

    void visit(Element e, List<Widget> ancestors) {
      final w = e.widget;
      if (w is Offstage && w.offstage) return;
      if (w is TextField || w is EditableText) return;
      var onTap = false;
      if (w is InkResponse && w.onTap != null) onTap = true;
      if (w is GestureDetector && w.onTap != null) onTap = true;
      if (onTap) {
        final target = _asTarget(e, ancestors, screen, used, centers);
        if (target != null) out.add(target);
      }
      final next = [...ancestors, w];
      e.visitChildren((c) => visit(c, next));
    }

    root.visitChildren((c) => visit(c, const []));
    return out;
  }

  WalkTarget? _asTarget(Element e, List<Widget> ancestors, Rect screen, Map<String, int> used, Set<String> centers) {
    final ro = e.renderObject;
    if (ro is! RenderBox || !ro.attached || !ro.hasSize) return null;
    final rect = ro.localToGlobal(Offset.zero) & ro.size;
    if (rect.width < 6 || rect.height < 6) return null;
    final center = rect.center;
    if (!screen.contains(center)) return null;
    // Only what a finger can reach: the target must be under its own centre.
    final hit = HitTestResult();
    WidgetsBinding.instance.hitTestInView(hit, center, t.view.viewId);
    if (!hit.path.any((h) => h.target == ro)) return null;
    final dedupe = '${center.dx.round()},${center.dy.round()}';
    if (!centers.add(dedupe)) return null;

    var label = _textOf(e);
    for (final a in ancestors.reversed) {
      if (a is Semantics && a.properties.button == true && (a.properties.label ?? '').isNotEmpty) {
        label = '[${a.properties.label}]';
        break;
      }
      if (a is Tooltip && a.message != null && label.startsWith('[') && !label.contains(' ')) {
        label = '[${a.message}]';
        break;
      }
    }
    final names = ancestors.map(_typeName).toList();
    if (names.contains('_BottomNav')) return null;
    final plain = label.replaceAll(RegExp(r'[\[\]]'), '').trim();
    if (names.contains('KBackBar') || RegExp(r'^(back|close|go back|navigate up)(\s|$)', caseSensitive: false).hasMatch(plain)) return null;
    if (_containsToggle(e) || names.contains('SegmentSetting')) {
      stats.skippedToggle++;
      return null;
    }
    var kind = 'tap';
    var mayStay = false;
    for (final a in ancestors) {
      if (a is KButton && (a.kind == KButtonKind.primary || a.kind == KButtonKind.danger)) {
        stats.skippedAction++;
        stats.skippedLabels.add(label);
        return null;
      }
      if (a is KChip) {
        kind = 'chip';
        mayStay = a.selected;
      } else if (a is KListRow) {
        kind = 'row';
      } else if (a is KIconButton) {
        kind = 'icon';
      } else if (_typeName(a) == 'KSegmented') {
        kind = 'segment';
        try {
          final dyn = a as dynamic;
          for (final o in dyn.options as List) {
            final (v, l) = o as (dynamic, String);
            if (l == label && v == dyn.value) mayStay = true;
          }
        } catch (_) {}
      }
    }
    if (label.isEmpty) return null;
    // A kit row opens a record, so its words are data ("Cash deposit"), not a button. Buttons are short.
    final words = label.replaceAllMapped(RegExp(r'([a-z])([A-Z])'), (m) => '${m[1]} ${m[2]}').replaceAll(RegExp(r'[\[\]]'), '');
    final isButton = kind != 'row' && words.split(' ').length <= 5;
    // A row starts with data, so only its first word can be a verb ("Mark 1 not marked as present").
    if (_actionWords.hasMatch(words) || _stepperOrStatus.hasMatch(words)) {
      stats.skippedAction++;
      stats.skippedLabels.add(label);
      return null;
    }
    if (isButton && _deviceWords.hasMatch(words) || _deviceSuffix.hasMatch(words)) {
      stats.skippedDevice++;
      stats.skippedLabels.add(label);
      return null;
    }
    final base = '$kind|${label.length > 60 ? label.substring(0, 60) : label}';
    final n = used.update(base, (v) => v + 1, ifAbsent: () => 0);
    return WalkTarget(kind, label, '$base#$n', center, mayStay: mayStay);
  }

  // ---- the walk ----------------------------------------------------------

  Future<void> _pop() async {
    final nav = observer.stack.isEmpty ? null : observer.stack.last.navigator;
    if (nav == null) return;
    nav.pop();
    await settle(minPumps: 6, maxPumps: 10);
  }

  /// Walks the page on top. [path] says how it was reached.
  Future<void> walkPage(List<String> path, int depth, {String? keyOverride}) async {
    _path = path;
    api.where = path.join(' › ');
    _pagesThisRoot++;
    stats.pagesOpened++;
    final loaded = await settle();
    final type = pageType();
    if (type == 'WebsitePageScreen' && keyOverride == null) {
      stats.pageKeys.add('${pageKey()} (website)');
      return;
    }
    // Screens that need a phone plugin (a PDF renderer, Bluetooth): they open, but the test host cannot finish them.
    if (_deviceScreens.contains(type) || type.contains('Pdf') || type.contains('Camera')) {
      stats.pageKeys.add('${pageKey()} (device screen)');
      return;
    }
    if (!loaded) fail('stuck loading', 'still showing a spinner after 5s of fake time (in ${loadingOwner()})');
    final err = errorTextOnScreen();
    if (err != null) fail('server-error state', '"$err" shown though the fake server answered 200');
    if (depth + 1 > stats.deepest.length) stats.deepest = path;
    final key = keyOverride ?? pageKey();
    if (Platform.environment['WALK_DEBUG'] != null) {
      // ignore: avoid_print
      print('PAGE ${path.join(' > ')} key=$key stack=${observer.stack.map((r) => r.runtimeType).toList()} targets=${collectTargets().map((x) => x.label).take(6).toList()}');
    }
    if (!walked.add(key)) return;
    stats.pagesDescended++;
    stats.pageKeys.add(key);
    if (depth >= maxDepth) return;

    final seen = <String>{};
    for (var i = 0; i < targetsPerPage; i++) {
      if (_pagesThisRoot >= pagesPerRoot) return;
      // Rows, tiles and buttons first; tabs and chips last, so a filter that hides the rows cannot hide them before they are walked.
      final targets = collectTargets();
      final fresh = targets.where((x) => !seen.contains(x.key)).toList();
      final next = fresh.where((x) => x.kind != 'chip' && x.kind != 'segment').firstOrNull ?? fresh.firstOrNull;
      if (next == null) break;
      seen.add(next.key);
      await _tap(next, path, depth);
      _path = path;
      api.where = path.join(' › ');
    }
  }

  /// What the page shows: its words, which chips and segments are selected, and how many routes are open.
  String _signature() {
    final selection = <String>[];
    for (final e in find.byType(KChip).evaluate()) {
      final c = e.widget as KChip;
      selection.add('${c.label}:${c.selected}');
    }
    for (final e in find.byWidgetPredicate((w) => _typeName(w) == 'KSegmented').evaluate()) {
      try {
        selection.add('seg:${(e.widget as dynamic).value}');
      } catch (_) {}
    }
    return '${visibleTexts().join('|')}#${selection.join(',')}#${observer.stack.length}';
  }

  Future<void> _tap(WalkTarget target, List<String> path, int depth) async {
    final before = _signature();
    final stackBefore = observer.stack.length;
    final requestsBefore = api.requests.length;
    observer.events.clear();
    final label = target.label.length > 40 ? '${target.label.substring(0, 40)}…' : target.label;
    final there = [...path, label];
    _path = there;
    api.where = there.join(' › ');
    stats.tapsMade++;
    try {
      await t.tapAt(target.center);
    } catch (e) {
      fail('exception', 'tap on "$label" threw $e', path: there);
      return;
    }
    await settle(minPumps: 6, maxPumps: 12);
    if (Platform.environment['WALK_DEBUG'] != null) {
      // ignore: avoid_print
      print('TAP ${there.join(' > ')} [${target.kind}] events=${observer.events}');
    }
    final pushedPage = observer.events.contains('page') || observer.events.contains('replace');
    final pushedPopup = observer.events.contains('popup');
    if (pushedPage) {
      await walkPage(there, depth + 1);
      _path = path;
      var guard = 0;
      while (observer.stack.length > stackBefore && guard++ < 12) {
        await _pop();
      }
      if (observer.stack.length < stackBefore) fail('navigation', 'back from "$label" left more than the page', path: there);
      return;
    }
    if (pushedPopup) {
      stats.sheetsOpened++;
      final err = errorTextOnScreen();
      if (err != null) fail('server-error state', '"$err" shown in the sheet of "$label"', path: there);
      var guard = 0;
      while (observer.stack.length > stackBefore && guard++ < 6) {
        await _pop();
      }
      return;
    }
    // Same page: a tab, a chip or a section changed what it shows.
    final err = errorTextOnScreen();
    if (err != null) fail('server-error state', '"$err" shown after tapping "$label"', path: there);
    if (hasLoading()) {
      final ok = await settle();
      if (!ok) fail('stuck loading', 'spinner stays after tapping "$label" (in ${loadingOwner()})', path: there);
    }
    final after = _signature();
    if (after != before || api.requests.length != requestsBefore) {
      stats.stateChanges++;
      return;
    }
    if (!target.mayStay) {
      fail('tap does nothing', 'tapping ${target.kind} "$label" changed nothing: no page, no sheet, no new text, no request', path: there);
    }
  }

  /// Walks the page that is already on top as a root.
  Future<void> openRoot(List<String> path, {String? keyOverride}) async {
    _pagesThisRoot = 0;
    stats.rootsWalked++;
    await walkPage(path, 0, keyOverride: keyOverride);
  }
}

Set<String> khatarioWidgetNames() {
  final names = <String>{};
  final re = RegExp(r'class\s+(\w+)(?:<[^>{]*>)?\s+extends\s+(?:StatefulWidget|StatelessWidget)');
  for (final f in Directory('lib').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart'))) {
    for (final m in re.allMatches(f.readAsStringSync())) {
      names.add(m.group(1)!);
    }
  }
  return names;
}

final _nl = String.fromCharCode(10);
