/// Connect leads for the phone: request paths and bodies, and readers for the website's
/// `/api/whatsapp/leads` replies. Business and user always come from the session, never from here.
library;

import '../../format.dart';
import 'pipeline_logic.dart';

int _int(dynamic v) => v is num ? v.toInt() : int.tryParse(v?.toString() ?? '') ?? 0;
num? _numOrNull(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '');
String? _str(dynamic v) {
  final s = v?.toString() ?? '';
  return s.isEmpty ? null : s;
}

List<Map<String, dynamic>> _maps(dynamic v) => v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : const [];

// ---------------------------------------------------------------- paths

const stagesPath = '/api/whatsapp/pipeline/stages';
const whatsappUsersPath = '/api/whatsapp/users';
const whatsappLabelsPath = '/api/whatsapp/labels';
const addLeadPath = '/api/whatsapp/leads';

/// `GET /api/whatsapp/leads?status=&type=&stage_id=&source=&owner=&search=&offset=`: only set filters are sent.
String leadsPath({String status = '', String type = '', String? stageId, String? source, String? ownerId, String search = '', int offset = 0}) {
  final q = <String, String>{
    if (type.isNotEmpty) 'type': type,
    if ((stageId ?? '').isNotEmpty) 'stage_id': stageId!,
    if ((source ?? '').isNotEmpty) 'source': source!,
    if ((ownerId ?? '').isNotEmpty) 'owner': ownerId!,
    if (search.trim().isNotEmpty) 'search': search.trim(),
    if (status.isNotEmpty) 'status': status,
    if (offset > 0) 'offset': '$offset',
  };
  return q.isEmpty ? '/api/whatsapp/leads' : Uri(path: '/api/whatsapp/leads', queryParameters: q).toString();
}

String leadPath(String id) => '/api/whatsapp/leads/${Uri.encodeComponent(id)}';
String leadNotesPath(String id) => '${leadPath(id)}/notes';
String leadNotePath(String id, String noteId) => '${leadNotesPath(id)}?note_id=${Uri.encodeQueryComponent(noteId)}';
String leadConvertPath(String id) => '${leadPath(id)}/convert';
String newEnquiryPath(String id) => '${leadPath(id)}/new-enquiry';

// ---------------------------------------------------------------- bodies

/// Source choices of the website's "Add lead" form ("manual" reads as "Other" there).
const manualSources = <(String, String)>[('call', 'Call'), ('walk_in', 'Walk-in'), ('manual', 'Other')];

/// The Leads page's source filter: every key it knows, then "Direct" (no source).
final leadSourceFilters = <(String, String)>[
  for (final k in const ['ctwa_ad', 'link', 'indiamart', 'lead_api', 'call', 'walk_in', 'manual']) (k, sourceLabels[k]!),
  ('direct', 'Direct'),
];

String? addLeadError(String name, String phone) {
  if (name.trim().isEmpty) return 'Enter a name';
  if (phone.replaceAll(RegExp(r'\D'), '').length < 10) return 'Enter a 10-digit mobile number, or one with its country code';
  return null;
}

Map<String, dynamic> addLeadBody({required String name, required String phone, required String source, String note = '', String? stageId, String? ownerId}) => {
      'name': name.trim(),
      'phone': phone.trim(),
      'source': source,
      if (note.trim().isNotEmpty) 'note': note.trim(),
      if ((stageId ?? '').isNotEmpty) 'stage_id': stageId,
      if ((ownerId ?? '').isNotEmpty) 'owner_id': ownerId,
    };

/// Moving a lead. A lost stage sends the reason with the move.
Map<String, dynamic> leadStageBody(String? stageId, {String? lostReason}) => {
      'stage_id': (stageId ?? '').isEmpty ? null : stageId,
      if ((lostReason ?? '').trim().isNotEmpty) 'lost_reason': lostReason!.trim(),
    };

Map<String, dynamic> leadOwnerBody(String? ownerId) => {'owner_id': (ownerId ?? '').isEmpty ? null : ownerId};
Map<String, dynamic> leadDealValueBody(num? value) => {'deal_value': value};
Map<String, dynamic> leadNoteBody(String text) => {'note_text': text.trim()};
Map<String, dynamic> convertBody(String customerId) => {'customer_id': customerId};
Map<String, dynamic> newEnquiryBody(bool confirmCloseOpen) => confirmCloseOpen ? {'confirm_close_open': true} : <String, dynamic>{};

/// `POST /api/customers` for a lead with no customer yet (the website's "Create and link").
Map<String, dynamic> newCustomerBody({required String name, required String phone, String gstin = '', String address = ''}) => {
      'name': name.trim(),
      'phone': phone.trim(),
      if (gstin.trim().isNotEmpty) 'gstin': gstin.trim().toUpperCase(),
      if (address.trim().isNotEmpty) 'address': address.trim(),
    };

// ---------------------------------------------------------------- readers

/// "+91 98765 10004" for a stored 919876510004; anything else as a plus and its digits.
String formatLeadPhone(String? phone) {
  final digits = (phone ?? '').replaceAll(RegExp(r'\D'), '');
  if (digits.length == 12 && digits.startsWith('91')) return '+91 ${digits.substring(2, 7)} ${digits.substring(7)}';
  return digits.isEmpty ? '' : '+$digits';
}

class OtherLead {
  const OtherLead({required this.id, required this.openedAt, this.closedAt, this.stageName});

  final String id;
  final DateTime openedAt;
  final DateTime? closedAt;
  final String? stageName;

  bool get isClosed => closedAt != null;
}

/// A lead as the list returns it, plus the detail fields when read from `GET /leads/:id`.
class Lead {
  const Lead({
    required this.id,
    required this.name,
    required this.phone,
    this.conversationId,
    this.messageCount,
    this.leadType = 'new',
    this.source,
    this.sourceDetail,
    this.stageId,
    this.stageName,
    this.stageKind,
    this.temperature,
    this.leadScore,
    this.ownerId,
    this.ownerName,
    this.customerId,
    this.openedAt,
    this.lastActivityAt,
    this.closedAt,
    this.dealValue,
    this.lostReason,
    this.note,
    this.summary,
    this.followups = const [],
    this.otherLeads = const [],
  });

  final String id, name, phone;
  final String? conversationId, source, stageId, stageName, stageKind, temperature, ownerId, ownerName, customerId, lostReason, note, summary;
  final int? messageCount, leadScore;
  final String leadType;
  final Map<String, dynamic>? sourceDetail;
  final DateTime? openedAt, lastActivityAt, closedAt;
  final num? dealValue;
  final List<Followup> followups;
  final List<OtherLead> otherLeads;

  factory Lead.fromJson(Map<String, dynamic> j) => Lead(
        id: j['id']?.toString() ?? '',
        name: j['name']?.toString() ?? '',
        phone: j['phone']?.toString() ?? '',
        conversationId: _str(j['conversation_id']),
        messageCount: j['message_count'] == null ? null : _int(j['message_count']),
        leadType: j['lead_type']?.toString() == 'existing' ? 'existing' : 'new',
        source: _str(j['source']),
        sourceDetail: j['source_detail'] is Map ? Map<String, dynamic>.from(j['source_detail'] as Map) : null,
        stageId: _str(j['stage_id']),
        stageName: _str(j['stage_name']),
        stageKind: _str(j['stage_kind']),
        temperature: _str(j['temperature']),
        leadScore: j['lead_score'] == null ? null : _int(j['lead_score']),
        ownerId: _str(j['owner_id']),
        ownerName: _str(j['owner_name']),
        customerId: _str(j['customer_id']),
        openedAt: DateTime.tryParse(j['opened_at']?.toString() ?? '')?.toLocal(),
        lastActivityAt: DateTime.tryParse(j['last_activity_at']?.toString() ?? '')?.toLocal(),
        closedAt: DateTime.tryParse(j['closed_at']?.toString() ?? '')?.toLocal(),
        dealValue: _numOrNull(j['deal_value']),
        lostReason: _str(j['lost_reason']),
        note: _str(j['note']),
        summary: _str(j['summary']),
        followups: [for (final f in _maps(j['followups'])) Followup.fromJson(f)],
        otherLeads: [
          for (final o in _maps(j['other_leads']))
            OtherLead(
              id: o['id']?.toString() ?? '',
              openedAt: DateTime.tryParse(o['opened_at']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
              closedAt: DateTime.tryParse(o['closed_at']?.toString() ?? '')?.toLocal(),
              stageName: _str(o['stage_name']),
            ),
        ],
      );

  bool get hasChat => conversationId != null;
  bool get isClosed => closedAt != null;
  bool get isExisting => leadType == 'existing';
  bool get isLost => stageKind == 'lost';

  /// "IndiaMART", or with the headline / product / link name when the lead has one.
  String get sourceText => describeSource(source, sourceDetail);

  /// "Hot · 82", "40" or ''.
  String get temperatureText {
    final t = temperature == null ? '' : '${temperature![0].toUpperCase()}${temperature!.substring(1)}';
    if (t.isNotEmpty) return leadScore == null ? t : '$t · $leadScore';
    return leadScore == null ? '' : '$leadScore';
  }

  String get messagesText => messageCount == null ? 'No chat yet' : '$messageCount messages';

  /// The row's second line: source, stage and owner.
  String get summaryLine => [
        sourceText,
        ?stageName,
        ?ownerName,
      ].join(' · ');

  String get openedText => openedAt == null ? '' : ddMMMyyyy(openedAt!);
}

class LeadsPage {
  const LeadsPage(this.rows, this.total, this.isSupervisor);

  final List<Lead> rows;
  final int total;
  final bool isSupervisor;
}

LeadsPage leadsFrom(Map<String, dynamic> body) => LeadsPage(
      [for (final r in _maps(body['rows'])) Lead.fromJson(r)],
      _int(body['total']),
      body['is_supervisor'] == true,
    );

class LeadNote {
  const LeadNote({required this.id, required this.text, required this.author, this.authorId, this.createdAt});

  final String id, text, author;
  final String? authorId;
  final DateTime? createdAt;
}

List<LeadNote> leadNotes(Map<String, dynamic> body) => [
      for (final n in _maps(body['notes']))
        LeadNote(
          id: n['id']?.toString() ?? '',
          text: n['note_text']?.toString() ?? '',
          author: _str(n['user_name']) ?? _str(n['user_email']) ?? 'Someone',
          authorId: _str(n['user_id']),
          createdAt: DateTime.tryParse(n['created_at']?.toString() ?? '')?.toLocal(),
        ),
    ];

class StageOption {
  const StageOption(this.id, this.name, this.kind);

  final String id, name, kind;

  bool get isLost => kind == 'lost';
}

List<StageOption> stageOptions(Map<String, dynamic> body) =>
    [for (final s in _maps(body['stages'])) StageOption(s['id']?.toString() ?? '', s['name']?.toString() ?? 'Stage', s['kind']?.toString() ?? 'open')];

/// A team member or a label to pick: id and name.
class PickOption {
  const PickOption(this.id, this.name);

  final String id, name;
}

/// Team members who can take WhatsApp chats (`can_receive` is not false), as the website filters them.
List<PickOption> personOptions(Map<String, dynamic> body) =>
    [for (final u in _maps(body['users'])) if (u['can_receive'] != false) PickOption(u['id']?.toString() ?? '', u['name']?.toString() ?? '')];

List<PickOption> labelOptions(Map<String, dynamic> body) =>
    [for (final l in _maps(body['labels'])) PickOption(l['id']?.toString() ?? '', l['name']?.toString() ?? '')];
