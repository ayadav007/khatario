import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Screens and the shell are built from the kit (lib/ui/kit.dart, lib/ui/form_kit.dart), not from
/// plain Material AppBar, FilledButton, DropdownButtonFormField, ListTile or labelled InputDecoration.
///
/// Files that may keep a raw widget go in [allowed], each with a one-line reason. It is empty now.
///
/// Not scanned, on purpose:
/// - lib/ui/kit.dart and lib/ui/form_kit.dart: the kit wraps Material by design.
/// - lib/staff/**: the separate staff attendance app is out of scope.
/// SwitchListTile and CheckboxListTile are not matched (the pattern needs a word boundary before ListTile).
const allowed = <String>{};

final _patterns = <RegExp>[
  RegExp(r'(?<![\w])AppBar\('),
  RegExp(r'(?<![\w])FilledButton(\.\w+)?\('),
  RegExp(r'DropdownButtonFormField'),
  RegExp(r'(?<![\w])ListTile\('),
  RegExp(r'labelText\s*:'),
];

void main() {
  test('screens and shell use the kit, not raw Material widgets', () {
    final offenders = <String>[];
    for (final root in ['lib/screens', 'lib/shell']) {
      for (final f in Directory(root).listSync(recursive: true).whereType<File>()) {
        if (!f.path.endsWith('.dart')) continue;
        final path = f.path.replaceAll(r'\', '/');
        if (allowed.contains(path)) continue;
        final text = f.readAsLinesSync().where((l) => !l.trimLeft().startsWith('//')).join('\n');
        for (final p in _patterns) {
          if (p.hasMatch(text)) offenders.add('$path: ${p.pattern}');
        }
      }
    }
    expect(offenders, isEmpty, reason: 'Use the kit (KBackBar, KButton, KPickField, KListRow, form_kit fields):\n${offenders.join('\n')}');
  });
}
