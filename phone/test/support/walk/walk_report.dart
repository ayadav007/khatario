import 'dart:io';

import 'walk_api.dart';
import 'walk_fixtures.dart';
import 'walk_walker.dart';

/// The end-of-walk summary: roots, pages, deepest path, every failure.
class WalkReport {
  WalkReport._(this.summary, this.failureCount);

  final String summary;
  final int failureCount;

  static WalkReport build({
    required String name,
    required Walker walker,
    required WalkApi api,
    required WalkFixtures fixtures,
    required Duration elapsed,
    List<RegExp> readOnlyPosts = const [],
  }) {
    final s = walker.stats;
    final failures = [...walker.failures.values];
    var allowed = 0;
    for (final w in api.writes) {
      if (readOnlyPosts.any((r) => r.hasMatch('${w.method} ${w.path} ${w.body}'))) {
        allowed++;
        continue;
      }
      failures.add(WalkFailure('write during walk', w.where, '${w.method} ${w.path}'));
    }
    for (final e in api.missing.entries) {
      failures.add(WalkFailure('GET with no fixture', e.value, e.key));
    }
    final byKind = <String, List<WalkFailure>>{};
    for (final f in failures) {
      byKind.putIfAbsent(f.kind, () => []).add(f);
    }
    final b = StringBuffer()
      ..writeln('Walk "$name": ${s.rootsWalked} roots, ${s.pagesOpened} pages opened, ${s.pagesDescended} walked in full, '
          '${s.tapsMade} taps (${s.sheetsOpened} sheets, ${s.stateChanges} in-page changes).')
      ..writeln('Deepest path (${s.deepest.length} pages): ${s.deepest.join(' › ')}')
      ..writeln('Skipped: ${s.skippedAction} action buttons, ${s.skippedDevice} device actions, ${s.skippedToggle} toggle rows.')
      ..writeln('Requests: ${api.requests.where((r) => r.method == 'GET').length} GET, ${api.writes.length} non-GET ($allowed of them allowed: lookups sent by POST, and notifications marked read). '
          'GET paths answered: ${fixtures.patterns.length} fixtures. Run time: ${elapsed.inSeconds}s.')
      ..writeln('Failures: ${failures.length}');
    for (final e in byKind.entries) {
      b.writeln('\n${e.key} (${e.value.length})');
      for (final f in e.value) {
        b.writeln('  - ${f.path.isEmpty ? '(no path)' : f.path}: ${f.detail.split('\n').first}');
      }
    }
    final unhit = [...fixtures.patterns.where((p) => !fixtures.hits.contains(p))]..sort();
    final uncovered = [
      for (final p in staticGetPaths())
        if (fixtures.reply(Uri.parse(p)) == null) p,
    ];
    b
      ..writeln('')
      ..writeln('Fixtures: ${fixtures.patterns.length} registered, ${fixtures.hits.length} answered a request during the walk.')
      ..writeln('Registered but never asked for (${unhit.length}): ${unhit.join(' ')}')
      ..writeln('GET paths written in lib/ with no fixture (${uncovered.length}): ${uncovered.join(' ')}')
      ..writeln('')
      ..writeln('Pages walked (${s.pageKeys.length}): ${(s.pageKeys.toList()..sort()).join(' | ')}');
    if (s.skippedLabels.isNotEmpty) {
      b.writeln('\nSkipped labels: ${(s.skippedLabels.toList()..sort()).take(80).join(' | ')}');
    }
    return WalkReport._(b.toString(), failures.length);
  }

  /// Keeps the last run's summary beside the task report.
  void write(String name) {
    final dir = Directory(r'D:\MyApps\Khatario\.superpowers\sdd\2026-11-10-phone-app-parity');
    if (!dir.existsSync()) return;
    File('${dir.path}\\walk-run-$name.md').writeAsStringSync('```\n$summary```\n');
  }
}
