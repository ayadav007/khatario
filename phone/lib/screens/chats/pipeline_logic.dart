/// Connect pipeline and follow-ups for the phone app (same API as the website board).
library;

import '../../format.dart';
import 'leads_logic.dart' show formatLeadPhone, stagesPath;
export 'leads_logic.dart' show stagesPath;

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

  /// Cards still to load; never below zero (a card moved away leaves the count under what is shown).
  int get remaining => count > cards.length ? count - cards.length : 0;

  /// This stage with the next page of cards added (a card already shown is not added twice).
  PipelineStage withMoreCards(List<DealCard> more) => PipelineStage(
        id: id,
        name: name,
        kind: kind,
        count: count,
        totalValue: totalValue,
        cards: [...cards, ...more.where((m) => !cards.any((c) => c.id == m.id))],
      );

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
    this.phone,
    this.isCustomer = false,
    this.temperature,
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
  final String? phone;
  final bool isCustomer;

  /// hot, warm or cold, from the chat's AI profile.
  final String? temperature;

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
        phone: (j['phone']?.toString() ?? '').isEmpty ? null : j['phone'].toString(),
        isCustomer: j['is_customer'] == true,
        temperature: (j['temperature']?.toString() ?? '').isEmpty ? null : j['temperature'].toString(),
      );

  /// "+91 98765 10004 · Existing customer · Hot".
  String get contactLine => [
        if (phone != null) formatLeadPhone(phone),
        if (isCustomer) 'Existing customer',
        if (temperature != null) '${temperature![0].toUpperCase()}${temperature!.substring(1)}',
      ].join(' · ');

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

/// What the board is filtered by; the same keys as the website board's query.
class PipelineFilters {
  const PipelineFilters({this.search = '', this.owner = '', this.labelId = '', this.source = '', this.closedDays = 90});

  final String search, owner, labelId, source;

  /// Won and lost columns show deals closed in this many days.
  final int closedDays;

  PipelineFilters copyWith({String? search, String? owner, String? labelId, String? source, int? closedDays}) => PipelineFilters(
        search: search ?? this.search,
        owner: owner ?? this.owner,
        labelId: labelId ?? this.labelId,
        source: source ?? this.source,
        closedDays: closedDays ?? this.closedDays,
      );

  bool get any => search.trim().isNotEmpty || owner.isNotEmpty || labelId.isNotEmpty || source.isNotEmpty;
}

String _q(String v) => Uri.encodeQueryComponent(v);

String _boardQuery(PipelineFilters f, [Map<String, String> extra = const {}]) => [
      if (f.search.trim().isNotEmpty) 'search=${_q(f.search.trim())}',
      if (f.owner.isNotEmpty) 'owner=${_q(f.owner)}',
      if (f.labelId.isNotEmpty) 'label_id=${_q(f.labelId)}',
      if (f.source.isNotEmpty) 'source=${_q(f.source)}',
      'closed_days=${f.closedDays}',
      for (final e in extra.entries) '${e.key}=${_q(e.value)}',
    ].join('&');

String pipelinePath(PipelineFilters f) => '/api/whatsapp/pipeline?${_boardQuery(f)}';

/// The next page of one stage's cards (the board answers with just that stage).
String pipelineMorePath(String stageId, int offset, [PipelineFilters f = const PipelineFilters()]) =>
    '/api/whatsapp/pipeline?${_boardQuery(f, {'stage_id': stageId, 'offset': '$offset'})}';

// ---------------------------------------------------------------- stage manager

String stagePath(String id) => '$stagesPath/${Uri.encodeComponent(id)}';

/// Delete a stage; its chats move to [moveTo], or come off the board when that is empty.
String stageDeletePath(String id, String moveTo) => moveTo.isEmpty ? stagePath(id) : '${stagePath(id)}?move_to=${_q(moveTo)}';

Map<String, dynamic> stageCreateBody(String name, String kind) => {'name': name.trim(), 'kind': kind};
Map<String, dynamic> stageOrderBody(List<String> ids) => {'order': ids};

const stageColors = <(String, String)>[
  ('slate', 'Grey'),
  ('blue', 'Blue'),
  ('teal', 'Teal'),
  ('green', 'Green'),
  ('amber', 'Amber'),
  ('orange', 'Orange'),
  ('red', 'Red'),
  ('pink', 'Pink'),
  ('violet', 'Violet'),
];

const stageKinds = <(String, String)>[('open', 'Open'), ('won', 'Won'), ('lost', 'Lost')];

class StageDef {
  const StageDef({required this.id, required this.name, required this.color, required this.kind});

  final String id, name, color, kind;
}

List<StageDef> stageDefs(Map<String, dynamic> body) => [
      for (final s in (body['stages'] is List ? body['stages'] as List : const []).whereType<Map>())
        StageDef(id: s['id']?.toString() ?? '', name: s['name']?.toString() ?? 'Stage', color: s['color']?.toString() ?? 'slate', kind: s['kind']?.toString() ?? 'open'),
    ];

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
