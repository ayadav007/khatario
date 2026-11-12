import '../../format.dart';
import 'audience_logic.dart' show savedRepliesPath;

/// Flows (`/whatsapp/flows`) and saved replies (`/whatsapp/saved-replies`): paths, rows and bodies.
/// No screen code here, so tests can reach it. No body ever carries `business_id`, `user_id` or
/// `created_by`; the server takes them from the session.

const flowsPath = '/api/whatsapp/flows';
const flowsGeneratePath = '$flowsPath/generate';
const flowsImportPath = '$flowsPath/import-bot-rules';

String flowPath(String id) => '$flowsPath/${Uri.encodeComponent(id)}';
String flowPublishPath(String id) => '${flowPath(id)}/publish';
String flowUnpublishPath(String id) => '${flowPath(id)}/unpublish';

/// The visual editor is a website page; the phone opens it inside the app, signed in.
String flowEditorHref(String id) => '/whatsapp/flows/${Uri.encodeComponent(id)}';

/// One row of `GET /api/whatsapp/flows`.
class FlowItem {
  const FlowItem({required this.id, required this.name, required this.status, required this.version, this.updatedAt, this.triggers});

  final String id;
  final String name;

  /// `draft`, `published` or `inactive`.
  final String status;
  final int version;
  final DateTime? updatedAt;
  final String? triggers;

  bool get published => status == 'published';

  static FlowItem? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = json['id']?.toString();
    if (id == null || id.isEmpty) return null;
    final updated = json['updated_at']?.toString();
    final triggers = json['triggers'];
    return FlowItem(
      id: id,
      name: (json['name']?.toString().trim().isNotEmpty ?? false) ? json['name'].toString().trim() : 'Untitled flow',
      status: json['status']?.toString() ?? 'draft',
      version: toNum(json['version']).toInt(),
      updatedAt: updated == null ? null : DateTime.tryParse(updated)?.toLocal(),
      triggers: triggers is Map ? flowTriggerSummary(triggers) : null,
    );
  }
}

List<FlowItem> flowItems(dynamic body) {
  final list = body is Map ? body['flows'] : null;
  return list is List ? list.map(FlowItem.fromJson).whereType<FlowItem>().toList() : const [];
}

/// The website shows the raw status in capitals-first form.
String flowStatusLabel(String status) => status.isEmpty ? 'Draft' : '${status[0].toUpperCase()}${status.substring(1)}';

List<String> _strings(dynamic v) => v is List ? v.map((e) => e.toString().trim()).where((e) => e.isNotEmpty).toList() : const [];

/// What starts the flow: `Keywords: order, menu · First message`. Null when nothing is set yet
/// (the server refuses to publish such a flow).
String? flowTriggerSummary(Map triggers) {
  final parts = <String>[
    if (_strings(triggers['hardPhrases']).isNotEmpty) 'Keywords: ${_strings(triggers['hardPhrases']).join(', ')}',
    if (_strings(triggers['hardRegex']).isNotEmpty) 'Pattern',
    if (triggers['firstMessage'] == true) 'First message',
    if (_strings(triggers['softIntents']).isNotEmpty) 'Intent: ${_strings(triggers['softIntents']).join(', ')}',
  ];
  return parts.isEmpty ? null : parts.join(' · ');
}

String _hm(DateTime d) => '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

/// The website names a new flow by the time (`Untitled 09:05`, `Shop order 2026-11-12 09:05`).
/// The phone uses the phone's local time where the website uses UTC.
Map<String, dynamic> newFlowBody(DateTime now, {bool shopStarter = false}) => shopStarter
    ? {'name': 'Shop order ${ymd(now)} ${_hm(now)}', 'starter': 'shop_order'}
    : {'name': 'Untitled ${_hm(now)}'};

/// The server's own refusal, so the sheet can say it before posting.
String? generatePromptError(String prompt) =>
    prompt.trim().length < 8 ? 'Describe what the flow should do in a bit more detail.' : null;

Map<String, dynamic> generateFlowBody(String prompt) => {'prompt': prompt.trim()};

// ---------------------------------------------------------------- saved replies

String savedReplyPath(String id) => '$savedRepliesPath/${Uri.encodeComponent(id)}';

/// The website's choices for a reply's category (`SavedRepliesCard`).
const savedReplyCategories = ['general', 'orders', 'payments', 'delivery', 'support', 'greetings'];

String savedReplyCategoryLabel(String category) =>
    category.isEmpty ? 'General' : '${category[0].toUpperCase()}${category.substring(1)}';

/// One row of `GET /api/whatsapp/saved-replies`.
class SavedReply {
  const SavedReply({required this.id, required this.title, required this.message, required this.category, this.shortcut});

  final String id;
  final String title;
  final String message;
  final String category;
  final String? shortcut;

  static SavedReply? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = json['id']?.toString();
    if (id == null || id.isEmpty) return null;
    final shortcut = json['shortcut']?.toString().trim();
    final category = json['category']?.toString().trim();
    return SavedReply(
      id: id,
      title: json['title']?.toString() ?? '',
      message: json['message']?.toString() ?? '',
      category: (category == null || category.isEmpty) ? 'general' : category,
      shortcut: (shortcut == null || shortcut.isEmpty) ? null : shortcut,
    );
  }
}

List<SavedReply> savedReplies(dynamic body) {
  final list = body is Map ? body['replies'] : null;
  return list is List ? list.map(SavedReply.fromJson).whereType<SavedReply>().toList() : const [];
}

/// The website asks the server to search title, shortcut and message (case-insensitive) and to match the
/// category; the phone loads the list once and narrows it here, so typing never races a request.
List<SavedReply> filterSavedReplies(List<SavedReply> all, String search, String category) {
  final q = search.trim().toLowerCase();
  return [
    for (final r in all)
      if ((category.isEmpty || r.category == category) &&
          (q.isEmpty || r.title.toLowerCase().contains(q) || (r.shortcut?.toLowerCase().contains(q) ?? false) || r.message.toLowerCase().contains(q)))
        r,
  ];
}

/// Category sections in the order the server sends them (category, then title).
List<(String, List<SavedReply>)> groupSavedReplies(List<SavedReply> rows) {
  final groups = <String, List<SavedReply>>{};
  for (final r in rows) {
    groups.putIfAbsent(r.category, () => []).add(r);
  }
  return [for (final e in groups.entries) (e.key, e.value)];
}

String? savedReplyError(String title, String message) =>
    title.trim().isEmpty || message.trim().isEmpty ? 'Title and message are required.' : null;

/// The same four fields the website form sends, for a new reply and for an edit.
Map<String, dynamic> savedReplyBody({required String title, required String shortcut, required String message, required String category}) => {
      'title': title.trim(),
      'shortcut': shortcut.trim(),
      'message': message.trim(),
      'category': category,
    };
