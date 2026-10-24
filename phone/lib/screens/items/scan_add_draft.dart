import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'scan_add_logic.dart';

/// Scan & Add draft on this phone, same rules as `lib/items/scan-add-draft.ts` on the website:
/// one draft per business and user, so switching business never shows another business's draft.
/// It holds what was typed and the retry keys only: no photos, no session cookie, no provider data.
/// Rows with an itemId are confirmed by the server; failed rows and the current product are not.
class ScanAddDraft {
  const ScanAddDraft({required this.entries, this.current});

  final List<ScanAddEntry> entries;
  final ScanAddDraftProduct? current;
}

const scanAddDraftVersion = 1;
const scanAddDraftMaxAge = Duration(days: 30);

String scanAddDraftKey(String businessId, String userId) => 'scan_add_draft:$businessId:$userId';

/// Reads, writes and clears the draft. The store is injectable for tests.
class ScanAddDraftStore {
  ScanAddDraftStore({required this.businessId, required this.userId, SharedPreferencesAsync? prefs}) : _prefs = prefs ?? SharedPreferencesAsync();

  final String businessId;
  final String userId;
  final SharedPreferencesAsync _prefs;

  String get _key => scanAddDraftKey(businessId, userId);

  /// Null when there is none, or it is for another business or user, damaged, an old format or expired.
  Future<ScanAddDraft?> load({DateTime? now}) async {
    String? raw;
    try {
      raw = await _prefs.getString(_key);
    } catch (_) {
      return null;
    }
    if (raw == null) return null;
    Object? parsed;
    try {
      parsed = jsonDecode(raw);
    } catch (_) {
      await clear();
      return null;
    }
    final savedAt = parsed is Map ? parsed['savedAt'] : null;
    final ok =
        parsed is Map &&
        parsed['version'] == scanAddDraftVersion &&
        parsed['businessId'] == businessId &&
        parsed['userId'] == userId &&
        savedAt is int &&
        (now ?? DateTime.now()).difference(DateTime.fromMillisecondsSinceEpoch(savedAt)) <= scanAddDraftMaxAge &&
        parsed['entries'] is List;
    if (!ok) {
      await clear();
      return null;
    }
    final entries = (parsed['entries'] as List).map(scanAddEntryFromJson).whereType<ScanAddEntry>().toList();
    final current = ScanAddDraftProduct.fromJson(parsed['current']);
    return ScanAddDraft(entries: entries, current: current != null && current.worthKeeping ? current : null);
  }

  /// Removes the draft when nothing is left to keep.
  Future<void> save(List<ScanAddEntry> entries, ScanAddDraftProduct? current, {DateTime? now}) async {
    final keep = current != null && current.worthKeeping ? current : null;
    if (entries.isEmpty && keep == null) return clear();
    try {
      await _prefs.setString(
        _key,
        jsonEncode({
          'version': scanAddDraftVersion,
          'businessId': businessId,
          'userId': userId,
          'savedAt': (now ?? DateTime.now()).millisecondsSinceEpoch,
          'entries': entries.map(scanAddEntryToJson).toList(),
          'current': keep?.toJson(),
        }),
      );
    } catch (_) {
      // Storage unavailable: Scan & Add still works, only without a draft.
    }
  }

  Future<void> clear() async {
    try {
      await _prefs.remove(_key);
    } catch (_) {}
  }
}
