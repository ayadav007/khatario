/// The More menu. The server builds it from the website's list (`lib/more-navigation.ts`) with this
/// user's plan and role, so the phone keeps no copy of its own: see GET /api/navigation/more.
class MoreNavItem {
  const MoreNavItem(this.href, this.label, {this.isLocked = false});

  final String href;
  final String label;
  final bool isLocked;
}

typedef MoreNavSection = ({String title, List<MoreNavItem> items});

/// `{ sections: [{ title, items: [{ href, label, locked }] }] }` from GET /api/navigation/more.
/// Returns null when the reply is not a menu.
List<MoreNavSection>? parseMoreMenu(Map<String, dynamic> json) {
  final sections = json['sections'];
  if (sections is! List) return null;
  final out = <MoreNavSection>[];
  for (final section in sections) {
    if (section is! Map) continue;
    final title = section['title'];
    final items = section['items'];
    if (title is! String || items is! List) continue;
    final parsed = [
      for (final item in items)
        if (item is Map && item['href'] is String && item['label'] is String)
          MoreNavItem(item['href'] as String, item['label'] as String, isLocked: item['locked'] == true),
    ];
    if (parsed.isNotEmpty) out.add((title: title, items: parsed));
  }
  return out;
}

/// `toggleMoreSection`: sections start open; one tap closes an open section.
Map<String, bool> toggleMoreSection(Map<String, bool> prev, String title) =>
    {...prev, title: prev[title] == false};
