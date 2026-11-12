/// Lead sources (`/whatsapp/lead-sources`): paths, bodies and readers for the website's
/// `/api/whatsapp/lead-sources*` routes. Business and user come from the session, never from here.
library;

import '../../format.dart';

const leadSourcesPath = '/api/whatsapp/lead-sources';
const entryLinksPath = '/api/whatsapp/lead-sources/links';
const indiaMartSyncPath = '/api/whatsapp/lead-sources/indiamart/sync';
String entryLinkPath(String id) => '$entryLinksPath/${Uri.encodeComponent(id)}';
String leadSourcePath(String id) => '$leadSourcesPath/${Uri.encodeComponent(id)}';

int _int(dynamic v) => v is num ? v.toInt() : int.tryParse(v?.toString() ?? '') ?? 0;
String? _str(dynamic v) {
  final s = v?.toString() ?? '';
  return s.isEmpty ? null : s;
}

List<Map<String, dynamic>> _maps(dynamic v) => v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : const [];

/// Where a source's leads go: a stage (null = the first open stage), a team member (null = nobody) and labels.
class SourceRouting {
  const SourceRouting({this.stageId, this.assignTo, this.labelIds = const []});

  final String? stageId, assignTo;
  final List<String> labelIds;

  SourceRouting copyWith({Object? stageId = _keep, Object? assignTo = _keep, List<String>? labelIds}) => SourceRouting(
        stageId: identical(stageId, _keep) ? this.stageId : stageId as String?,
        assignTo: identical(assignTo, _keep) ? this.assignTo : assignTo as String?,
        labelIds: labelIds ?? this.labelIds,
      );

  Map<String, dynamic> toBody() => {
        'stage_id': (stageId ?? '').isEmpty ? null : stageId,
        'assign_to': (assignTo ?? '').isEmpty ? null : assignTo,
        'label_ids': labelIds,
      };
}

const Object _keep = Object();

Map<String, dynamic> directBody(bool enabled) => {'kind': 'direct', 'enabled': enabled};

Map<String, dynamic> indiaMartBody({required String key, required SourceRouting routing}) => {
      'kind': 'indiamart',
      if (key.trim().isNotEmpty) 'key': key.trim(),
      ...routing.toBody(),
    };

Map<String, dynamic> webhookBody({required String name, required SourceRouting routing}) => {
      'kind': 'webhook',
      if (name.trim().isNotEmpty) 'name': name.trim(),
      ...routing.toBody(),
    };

Map<String, dynamic> entryLinkBody({required String name, required String phone, required String prefillText, required SourceRouting routing}) => {
      'name': name.trim(),
      'phone': phone.trim(),
      'prefill_text': prefillText.trim(),
      ...routing.toBody(),
    };

const archiveBody = <String, dynamic>{'archived': true};
Map<String, dynamic> enabledBody(bool enabled) => {'enabled': enabled};

class LeadSource {
  const LeadSource({
    required this.id,
    required this.kind,
    required this.name,
    required this.enabled,
    this.tokenHint,
    this.routing = const SourceRouting(),
    this.lastRunAt,
    this.lastFetched,
    this.lastImported,
    this.lastError,
    this.leads = 0,
  });

  final String id, kind, name;
  final bool enabled;
  final String? tokenHint, lastError;
  final SourceRouting routing;
  final DateTime? lastRunAt;
  final int? lastFetched, lastImported;
  final int leads;

  factory LeadSource.fromJson(Map<String, dynamic> j) {
    final result = j['last_result'] is Map ? Map<String, dynamic>.from(j['last_result'] as Map) : const <String, dynamic>{};
    return LeadSource(
      id: j['id']?.toString() ?? '',
      kind: j['kind']?.toString() ?? '',
      name: j['name']?.toString() ?? '',
      enabled: j['enabled'] != false,
      tokenHint: _str(j['token_hint']),
      routing: SourceRouting(
        stageId: _str(j['stage_id']),
        assignTo: _str(j['assign_to']),
        labelIds: [for (final l in (j['label_ids'] is List ? j['label_ids'] as List : const [])) l.toString()],
      ),
      lastRunAt: DateTime.tryParse(j['last_run_at']?.toString() ?? '')?.toLocal(),
      lastFetched: result['fetched'] == null ? null : _int(result['fetched']),
      lastImported: result['imported'] == null ? null : _int(result['imported']),
      lastError: _str(j['last_error']),
      leads: _int(j['leads']),
    );
  }

  /// "Last checked 10 Nov 2026, 10:30 · 3 new", or '' before the first check.
  String get lastChecked {
    if (lastRunAt == null) return '';
    final base = 'Last checked ${ddMMMyyyyHm(lastRunAt!)}';
    return lastFetched == null ? base : '$base · ${lastImported ?? 0} new';
  }
}

class LeadSourcesPage {
  const LeadSourcesPage({required this.directEnabled, required this.sources});

  final bool directEnabled;
  final List<LeadSource> sources;

  LeadSource? get indiaMart => sources.where((s) => s.kind == 'indiamart').firstOrNull;
  List<LeadSource> get webhooks => sources.where((s) => s.kind == 'webhook').toList();
}

LeadSourcesPage leadSourcesFrom(Map<String, dynamic> body) {
  final direct = body['direct'];
  return LeadSourcesPage(
    directEnabled: direct is Map ? direct['enabled'] != false : true,
    sources: [for (final s in _maps(body['sources'])) LeadSource.fromJson(s)],
  );
}

class EntryLink {
  const EntryLink({
    required this.id,
    required this.code,
    required this.name,
    this.phone = '',
    this.clicks = 0,
    this.qrScans = 0,
    this.widgetClicks = 0,
    this.chats = 0,
    this.won = 0,
  });

  final String id, code, name, phone;
  final int clicks, qrScans, widgetClicks, chats, won;

  factory EntryLink.fromJson(Map<String, dynamic> j) => EntryLink(
        id: j['id']?.toString() ?? '',
        code: j['code']?.toString() ?? '',
        name: j['name']?.toString() ?? '',
        phone: j['phone']?.toString() ?? '',
        clicks: _int(j['clicks']),
        qrScans: _int(j['qr_scans']),
        widgetClicks: _int(j['widget_clicks']),
        chats: _int(j['chats']),
        won: _int(j['won']),
      );

  String url(String baseUrl) => '$baseUrl/w/$code';
  String websiteSnippet(String baseUrl) => '<script src="$baseUrl/api/public/wa-widget/$code" async></script>';
  String get statsText => '$clicks clicks · $qrScans QR scans · $widgetClicks website taps · $chats chats · $won won';
}

class EntryLinksPage {
  const EntryLinksPage({required this.links, required this.baseUrl, this.suggestedPhone});

  final List<EntryLink> links;
  final String baseUrl;
  final String? suggestedPhone;
}

EntryLinksPage entryLinksFrom(Map<String, dynamic> body) => EntryLinksPage(
      links: [for (final l in _maps(body['links'])) EntryLink.fromJson(l)],
      baseUrl: body['base_url']?.toString() ?? '',
      suggestedPhone: _str(body['suggested_phone']),
    );

String syncDoneText(Map<String, dynamic> body) {
  final run = body['run'];
  final n = run is Map ? _int(run['imported']) : 0;
  return 'Checked IndiaMART: $n new lead${n == 1 ? '' : 's'}';
}

/// The webhook URL, which the server shows only once.
String? webhookUrlFrom(Map<String, dynamic> body) => _str(body['url']);
