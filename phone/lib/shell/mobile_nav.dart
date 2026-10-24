import '../session.dart';

/// Per-user mobile bottom navigation. Keep in step with `lib/mobile-bottom-nav.ts`.
const middleIds = ['invoices', 'items', 'parties', 'chats', 'contacts', 'orders', 'team', 'attendance'];

const middleLabels = {
  'invoices': 'Invoices',
  'items': 'Items',
  'parties': 'Parties',
  'chats': 'Chats',
  'contacts': 'Contacts',
  'orders': 'Orders',
  'team': 'Team',
  'attendance': 'Attendance',
};

String middleLabel(String id) => middleLabels[id] ?? id;

class MobileNavPrefs {
  const MobileNavPrefs({required this.slotCount, required this.middle});

  final int slotCount;
  final List<String> middle;
}

({bool hasHr, bool hasConnect, bool hasBilling}) _flags(List<String> modules) {
  final hasHr = modules.contains('hr');
  final hasConnect = modules.contains('connect');
  final hasBilling = modules.contains('billing') || (!hasHr && !hasConnect);
  return (hasHr: hasHr, hasConnect: hasConnect, hasBilling: hasBilling);
}

bool _isMiddle(String id) => middleIds.contains(id);

List<String> allowedMiddleIds(AppSession session) {
  if (session.isConnectAgent) {
    return ['contacts', if (session.canView('invoices')) 'orders', 'parties'];
  }
  final flags = _flags(session.enabledModules);
  return [
    if (flags.hasBilling) ...['invoices', 'items', 'parties'],
    if (flags.hasHr) ...['team', 'attendance'],
    if (flags.hasConnect) ...['chats', 'contacts'],
  ];
}

List<String> defaultMiddleIds(AppSession session) {
  if (session.isConnectAgent) {
    return session.canView('invoices') ? ['contacts', 'orders'] : ['contacts', 'parties'];
  }
  final flags = _flags(session.enabledModules);
  if (flags.hasHr && !flags.hasBilling) return ['team', 'attendance'];
  if (flags.hasConnect && !flags.hasBilling) return ['chats', 'contacts'];
  if (flags.hasConnect && flags.hasBilling) return ['invoices', 'chats', 'parties'];
  return ['invoices', 'items', 'parties'];
}

MobileNavPrefs? parseMobileNavPrefs(dynamic raw) {
  if (raw is! Map) return null;
  final slotCount = raw['slotCount'];
  final middle = raw['middle'];
  if (slotCount != 4 && slotCount != 5) return null;
  if (middle is! List) return null;
  final ids = middle.map((e) => e.toString()).toList();
  if (ids.any((id) => !_isMiddle(id))) return null;
  return MobileNavPrefs(slotCount: slotCount as int, middle: ids);
}

List<String> _fill(int need, List<String> allowed, List<String> preferred, List<String> defaults) {
  final picked = <String>[];
  void push(String id) {
    if (picked.length >= need) return;
    if (!allowed.contains(id) || picked.contains(id)) return;
    picked.add(id);
  }

  for (final id in preferred) {
    push(id);
  }
  for (final id in defaults) {
    push(id);
  }
  for (final id in allowed) {
    push(id);
  }
  return picked;
}

/// Shortcuts between the pinned ends. Unknown or unavailable ids are dropped.
List<String> displayedMiddle(AppSession session) {
  final allowed = allowedMiddleIds(session);
  final defaults = defaultMiddleIds(session).where(allowed.contains).toList();
  final parsed = parseMobileNavPrefs(session.user['mobile_nav']);
  if (parsed == null || allowed.isEmpty) return defaults.take(3).toList();
  final need = (parsed.slotCount == 4 ? 2 : 3).clamp(0, allowed.length);
  return _fill(need, allowed, parsed.middle, defaults);
}

String? validateMobileNav(AppSession session, {required int slotCount, required List<String> middle}) {
  if (slotCount != 4 && slotCount != 5) return 'Choose 4 or 5 tabs.';
  final need = slotCount - 2;
  final allowed = allowedMiddleIds(session);
  if (need > allowed.length) return 'This account can use ${allowed.length + 2} tabs. Choose 4.';
  if (middle.length != need) return slotCount == 4 ? 'Pick 2 shortcuts.' : 'Pick 3 shortcuts.';
  final seen = <String>{};
  for (final id in middle) {
    if (!_isMiddle(id) || !allowed.contains(id) || !seen.add(id)) {
      return 'One of those shortcuts is not available on this account.';
    }
  }
  return null;
}

bool pinnedChats(AppSession session) => session.isConnectAgent;
