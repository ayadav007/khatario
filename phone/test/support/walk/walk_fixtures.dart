import 'dart:io';

import '../../fixtures/more_hrefs.dart';
import 'walk_fixtures_data.dart';

typedef _Reply = Object? Function(Uri uri);

class _Route {
  _Route(this.pattern, this.reply) : segments = pattern.split('/').where((s) => s.isNotEmpty).toList();

  final String pattern;
  final _Reply reply;
  final List<String> segments;

  /// How many literal segments matched, or -1 for no match.
  int score(List<String> path) {
    if (path.length != segments.length) return -1;
    var literal = 0;
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].startsWith(':')) continue;
      if (segments[i] != path[i]) return -1;
      literal++;
    }
    return literal;
  }
}

/// Sample replies for every GET the phone makes. Each is shaped like the real route's reply, with one or two rows
/// and every field the phone reads. Paths match by pattern (`:id` is any one segment); the query may vary.
class WalkFixtures {
  WalkFixtures({required this.enabledFeatures, this.owner = true, this.restricted = false}) {
    registerWalkFixtures(this);
    get('/api/features/enabled', (_) => {'enabledIds': enabledFeatures});
    get('/api/settings/permissions', (_) => {'permissions': <String, dynamic>{}, 'isPrimaryAdmin': owner});
    get('/api/navigation/more', (_) => {'sections': moreMenu()});
  }

  final List<String> enabledFeatures;
  final bool owner;

  /// A small plan: the More menu marks everything but billing basics as locked.
  final bool restricted;
  final _routes = <_Route>[];

  /// Patterns that answered at least one request.
  final hits = <String>{};

  /// Registers a GET reply: a JSON-like value, or a function of the request.
  void get(String pattern, Object? reply) {
    _routes.removeWhere((r) => r.pattern == pattern);
    _routes.add(_Route(pattern, reply is Function ? (reply as _Reply) : (_) => reply));
  }

  /// The reply for [uri], or null when no fixture matches (the walk lists that as a gap).
  Object? reply(Uri uri) {
    final path = uri.path.split('/').where((s) => s.isNotEmpty).toList();
    _Route? best;
    var bestScore = -1;
    for (final r in _routes) {
      final s = r.score(path);
      if (s > bestScore) {
        best = r;
        bestScore = s;
      }
    }
    if (best == null) return null;
    hits.add(best.pattern);
    return best.reply(uri);
  }

  List<String> get patterns => [for (final r in _routes) r.pattern];

  /// The More menu with every link the website can show, grouped like the website.
  List<Map<String, dynamic>> moreMenu() {
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final href in moreHrefs) {
      final first = href.split('?').first.split('/').where((s) => s.isNotEmpty).firstOrNull ?? 'home';
      final basic = href.startsWith('/invoices') || href.startsWith('/customers') || href.startsWith('/items') || href == '/search';
      groups.putIfAbsent(first, () => []).add({'href': href, 'label': walkLabelFor(href), 'locked': restricted && !basic});
    }
    return [
      for (final e in groups.entries) {'title': walkTitleCase(e.key), 'items': e.value},
    ];
  }
}

String walkTitleCase(String s) => s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1).replaceAll('-', ' ')}';

/// A readable label for a link: the last path segment in words.
String walkLabelFor(String href) {
  final path = href.split('?').first;
  final parts = path.split('/').where((s) => s.isNotEmpty).toList();
  final tail = parts.isEmpty ? 'Home' : parts.last.replaceAll('-', ' ');
  final base = walkTitleCase(tail);
  return href.contains('?') ? '$base (${href.split('?').last})' : (parts.length > 1 ? '${walkTitleCase(parts[parts.length - 2])} $tail' : base);
}

/// Feature ids the phone knows (`_featureRegistryIds` in lib/capability.dart): a plan with everything on.
List<String> allFeatureIds() {
  final src = File('lib/capability.dart').readAsStringSync();
  final block = RegExp(r'_featureRegistryIds = \{(.*?)\};', dotAll: true).firstMatch(src)!.group(1)!;
  return RegExp(r"'([a-z0-9_]+)'").allMatches(block).map((m) => m.group(1)!).toList();
}

/// GET paths written out in lib/ (a literal after getJson, getData, getBytes or dio.get), with `$id` as one segment.
/// Paths built by helper functions are not here; the walk itself finds those.
List<String> staticGetPaths() {
  final out = <String>{};
  final call = RegExp(r"(getJson|getData|getBytes|dio\.get)(<[^>]*>)?\(");
  final literal = RegExp(r"'(/api/[^'?]*)");
  for (final f in Directory('lib').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart'))) {
    for (final line in f.readAsLinesSync()) {
      final c = call.firstMatch(line);
      if (c == null) continue;
      final m = literal.firstMatch(line.substring(c.end));
      if (m == null) continue;
      var path = m.group(1)!;
      path = path.replaceAll(RegExp(r'\$\{[^}]*\}'), 'x').replaceAll(RegExp(r'\$\w+(\.\w+)*'), 'x');
      out.add(path);
    }
  }
  return out.toList()..sort();
}
