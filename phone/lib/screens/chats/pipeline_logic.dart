/// Connect pipeline and follow-ups for the phone app (same API as the website board).
library;

import '../../format.dart';

const sourceLabels = <String, String>{
  'ctwa_ad': 'WhatsApp ad',
  'link': 'Link / QR',
  'indiamart': 'IndiaMART',
  'lead_api': 'Lead webhook',
  'call': 'Call',
  'walk_in': 'Walk-in',
  'manual': 'Manual',
};

/// "WhatsApp ad · Diwali sale", "IndiaMART · Cartons", or "Direct".
String describeSource(String? source, Map<String, dynamic>? detail) {
  if (source == null || source.isEmpty) return 'Direct';
  final d = detail ?? const <String, dynamic>{};
  String? pick(List<String> keys) {
    for (final k in keys) {
      final v = d[k];
      if (v is String && v.trim().isNotEmpty) return v.trim();
    }
    return null;
  }

  final extra = switch (source) {
    'ctwa_ad' => pick(['headline']) ?? (d['ad_id'] != null ? 'ad ${d['ad_id']}' : null),
    'link' => pick(['name']),
    _ => pick(['product', 'subject', 'name']),
  };
  final label = sourceLabels[source] ?? source;
  return extra == null ? label : '$label · $extra';
}

class PipelineStage {
  const PipelineStage({required this.id, required this.name, required this.kind, this.count = 0, this.totalValue = 0, this.cards = const []});

  final String id;
  final String name;

  /// open, won or lost.
  final String kind;
  final int count;
  final num totalValue;
  final List<DealCard> cards;

  factory PipelineStage.fromJson(Map<String, dynamic> j) => PipelineStage(
        id: j['id']?.toString() ?? '',
        name: j['name']?.toString() ?? 'Stage',
        kind: j['kind']?.toString() ?? 'open',
        count: _int(j['count']),
        totalValue: _num(j['total_value']) ?? 0,
        cards: (j['cards'] is List ? j['cards'] as List : const [])
            .whereType<Map>()
            .map((c) => DealCard.fromJson(Map<String, dynamic>.from(c)))
            .toList(),
      );
}

/// One lead on the board. [id] is the lead's id; [conversationId] is its chat, null when it has none yet.
class DealCard {
  const DealCard({
    required this.id,
    required this.stageId,
    required this.name,
    this.conversationId,
    this.lastMessage,
    this.dealValue,
    this.ownerName,
    this.source,
    this.nextFollowupAt,
  });

  final String id;
  final String stageId;
  final String name;
  final String? conversationId;
  final String? lastMessage;
  final num? dealValue;
  final String? ownerName;
  final String? source;
  final DateTime? nextFollowupAt;

  factory DealCard.fromJson(Map<String, dynamic> j) => DealCard(
        id: j['id']?.toString() ?? '',
        stageId: j['stage_id']?.toString() ?? '',
        name: j['name']?.toString() ?? '',
        conversationId: (j['conversation_id']?.toString() ?? '').isEmpty ? null : j['conversation_id'].toString(),
        lastMessage: j['last_message_text']?.toString(),
        dealValue: _num(j['deal_value']),
        ownerName: j['owner_name']?.toString(),
        source: j['source']?.toString(),
        nextFollowupAt: DateTime.tryParse(j['next_followup_at']?.toString() ?? '')?.toLocal(),
      );

  /// Second line on the card: value, owner and follow-up.
  String meta(DateTime now) {
    final parts = <String>[
      if (dealValue != null) inr(dealValue!),
      if (source != null && sourceLabels[source] != null) sourceLabels[source]!,
      if (ownerName != null && ownerName!.isNotEmpty) ownerName!,
      if (nextFollowupAt != null) nextFollowupAt!.isBefore(now) ? 'Follow-up overdue' : 'Follow-up ${dMMM(nextFollowupAt!)}',
    ];
    return parts.join(' · ');
  }
}

List<PipelineStage> parseBoard(Map<String, dynamic> body) =>
    (body['columns'] is List ? body['columns'] as List : const [])
        .whereType<Map>()
        .map((c) => PipelineStage.fromJson(Map<String, dynamic>.from(c)))
        .toList();

class Deal {
  const Deal({this.stageId, this.dealValue, this.lostReason, this.source, this.sourceDetail});

  final String? stageId;
  final num? dealValue;
  final String? lostReason;
  final String? source;
  final Map<String, dynamic>? sourceDetail;

  factory Deal.fromJson(Map<String, dynamic>? j) => Deal(
        stageId: j?['stage_id']?.toString(),
        dealValue: _num(j?['deal_value']),
        lostReason: j?['lost_reason']?.toString(),
        source: j?['source']?.toString(),
        sourceDetail: j?['source_detail'] is Map ? Map<String, dynamic>.from(j!['source_detail'] as Map) : null,
      );
}

class Followup {
  const Followup({required this.id, required this.dueAt, this.note, this.assignedName});

  final String id;
  final DateTime dueAt;
  final String? note;
  final String? assignedName;

  factory Followup.fromJson(Map<String, dynamic> j) => Followup(
        id: j['id']?.toString() ?? '',
        dueAt: (DateTime.tryParse(j['due_at']?.toString() ?? '') ?? DateTime.now()).toLocal(),
        note: j['note']?.toString(),
        assignedName: j['assigned_name']?.toString(),
      );
}

List<Followup> parseFollowups(Map<String, dynamic> body) =>
    (body['followups'] is List ? body['followups'] as List : const [])
        .whereType<Map>()
        .map((f) => Followup.fromJson(Map<String, dynamic>.from(f)))
        .toList();

/// Overdue plus due later today, for the inbox chip.
int dueFollowupCount(Map<String, dynamic> body) {
  final c = body['counts'];
  if (c is! Map) return 0;
  return _int(c['overdue']) + _int(c['today']);
}

enum RemindPreset { hour, evening, tomorrow, monday }

const remindPresetLabels = <RemindPreset, String>{
  RemindPreset.hour: 'In 1 hour',
  RemindPreset.evening: 'This evening',
  RemindPreset.tomorrow: 'Tomorrow 10 am',
  RemindPreset.monday: 'Next Monday',
};

/// Same times as the website's "Remind me" buttons, in the phone's own clock.
DateTime remindAt(RemindPreset preset, DateTime now) {
  switch (preset) {
    case RemindPreset.hour:
      return now.add(const Duration(hours: 1));
    case RemindPreset.evening:
      final today = DateTime(now.year, now.month, now.day, 18);
      return today.isAfter(now) ? today : today.add(const Duration(days: 1));
    case RemindPreset.tomorrow:
      return DateTime(now.year, now.month, now.day + 1, 10);
    case RemindPreset.monday:
      final add = ((8 - now.weekday) % 7 == 0) ? 7 : (8 - now.weekday) % 7;
      return DateTime(now.year, now.month, now.day + add, 10);
  }
}

/// End of the phone's today, so "due today" follows its clock.
DateTime endOfToday(DateTime now) => DateTime(now.year, now.month, now.day, 23, 59, 59, 999);

int _int(dynamic v) => v is num ? v.toInt() : int.tryParse(v?.toString() ?? '') ?? 0;
num? _num(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '');
