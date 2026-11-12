import 'dart:convert';
import 'dart:io';

Map<int, String>? _names;

/// Lucide icon names by code point, read from the package source, so a path says "bell" and not "icon-e059".
Map<int, String> lucideNames() {
  final cached = _names;
  if (cached != null) return cached;
  final names = <int, String>{};
  try {
    final config = jsonDecode(File('.dart_tool/package_config.json').readAsStringSync()) as Map;
    final pkg = (config['packages'] as List).cast<Map>().firstWhere((p) => p['name'] == 'lucide_icons_flutter');
    final root = Uri.parse(pkg['rootUri'] as String).toFilePath();
    final src = File('$root/lib/lucide_icons.dart').readAsStringSync();
    final re = RegExp(r'static const IconData (\w+) = const IconData\((\d+),');
    for (final m in re.allMatches(src)) {
      final name = m.group(1)!;
      if (RegExp(r'(\d{3}|Dir)$').hasMatch(name)) continue;
      names.putIfAbsent(int.parse(m.group(2)!), () => name);
    }
  } catch (_) {}
  return _names = names;
}
