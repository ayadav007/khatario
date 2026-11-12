/// The Connect (WhatsApp CRM) dashboard: paths and readers for the four website widgets.
/// Numbers are worked out the way `components/whatsapp/dashboard/*` does.
library;

import 'pipeline_logic.dart';

/// Overview and agents are needed; the pipeline and campaign widgets are optional on the website too.
const dashboardPaths = <String>[
  '/api/whatsapp/dashboard/overview',
  '/api/whatsapp/dashboard/agents',
  '/api/whatsapp/dashboard/campaigns',
  '/api/whatsapp/dashboard/pipeline',
];

int _int(dynamic v) => v is num ? v.toInt() : int.tryParse(v?.toString() ?? '') ?? 0;
num _num(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
Map<String, dynamic> _map(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
List<Map<String, dynamic>> _maps(dynamic v) => v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : const [];

String _percent1(int part, int whole) => whole > 0 ? (part / whole * 100).toStringAsFixed(1) : '0.0';
String _percent0(int part, int whole) => whole > 0 ? '${(part / whole * 100).round()}%' : '—';

class ConversationStatus {
  const ConversationStatus({this.total = 0, this.open = 0, this.pending = 0, this.closed = 0, this.unread = 0});

  final int total, open, pending, closed, unread;

  factory ConversationStatus.fromJson(Map<String, dynamic>? j) => ConversationStatus(
        total: _int(j?['total']),
        open: _int(j?['open']),
        pending: _int(j?['pending']),
        closed: _int(j?['closed']),
        unread: _int(j?['unread']),
      );

  List<(String, int)> get tiles => [('Total', total), ('Open', open), ('Pending', pending), ('Closed', closed), ('Unread', unread)];
}

class BotVsHuman {
  const BotVsHuman({this.bot = 0, this.human = 0, this.handoffs = 0});

  final int bot, human, handoffs;

  factory BotVsHuman.fromJson(Map<String, dynamic>? j) =>
      BotVsHuman(bot: _int(j?['bot_handled']), human: _int(j?['human_handled']), handoffs: _int(j?['handoff_count']));

  String get botPercent => _percent1(bot, bot + human);
  String get humanPercent => _percent1(human, bot + human);
}

class CampaignStats {
  const CampaignStats({this.sent = 0, this.delivered = 0, this.read = 0, this.failed = 0, this.responses = 0});

  final int sent, delivered, read, failed, responses;

  factory CampaignStats.fromJson(Map<String, dynamic>? j) => CampaignStats(
        sent: _int(j?['messages_sent']),
        delivered: _int(j?['delivered']),
        read: _int(j?['read']),
        failed: _int(j?['failed']),
        responses: _int(j?['responses_received']),
      );

  String get deliveredText => '$delivered (${_percent1(delivered, sent)}%)';
  String get readText => '$read (${_percent1(read, delivered)}%)';
  String get responsesText => '$responses (${_percent1(responses, sent)}%)';
}

/// "45s", "2m", "3h", or "N/A" when nobody has replied yet.
String responseTime(num? seconds) {
  if (seconds == null) return 'N/A';
  if (seconds < 60) return '${seconds.round()}s';
  if (seconds < 3600) return '${(seconds / 60).round()}m';
  return '${(seconds / 3600).round()}h';
}

class AgentRow {
  const AgentRow({required this.name, this.total = 0, this.open = 0, this.closed = 0, this.avgSeconds});

  final String name;
  final int total, open, closed;
  final num? avgSeconds;

  String get responseText => responseTime(avgSeconds);
}

List<AgentRow> agentRows(dynamic raw) => [
      for (final a in _maps(raw))
        AgentRow(
          name: a['agent_name']?.toString() ?? '',
          total: _int(a['total_assigned']),
          open: _int(a['open']),
          closed: _int(a['closed']),
          avgSeconds: a['avg_response_seconds'] is num ? a['avg_response_seconds'] as num : null,
        ),
    ];

class StageTotal {
  const StageTotal({required this.id, required this.name, required this.kind, this.count = 0, this.totalValue = 0});

  final String id, name, kind;
  final int count;
  final num totalValue;
}

class AgentDeals {
  const AgentDeals({required this.name, this.open = 0, this.openValue = 0, this.won = 0, this.wonValue = 0});

  final String name;
  final int open, won;
  final num openValue, wonValue;
}

class SourceRow {
  const SourceRow({required this.source, this.leads = 0, this.onBoard = 0, this.won = 0, this.wonValue = 0});

  final String source;
  final int leads, onBoard, won;
  final num wonValue;

  String get label => sourceLabels[source] ?? (source == 'direct' ? 'Direct' : source);
  String get winPercent => _percent0(won, leads);
}

class LostReason {
  const LostReason(this.reason, this.count);

  final String reason;
  final int count;
}

/// `GET /api/whatsapp/dashboard/pipeline` → `{ pipeline }`.
class PipelineSummary {
  const PipelineSummary({
    this.days = 30,
    this.stages = const [],
    this.wonCount = 0,
    this.wonValue = 0,
    this.lost = 0,
    this.winRate,
    this.byAgent = const [],
    this.lostReasons = const [],
    this.bySource = const [],
  });

  final int days;
  final List<StageTotal> stages;
  final int wonCount, lost;
  final num wonValue;
  final double? winRate;
  final List<AgentDeals> byAgent;
  final List<LostReason> lostReasons;
  final List<SourceRow> bySource;

  factory PipelineSummary.fromJson(Map<String, dynamic>? j) {
    final won = _map(j?['won']);
    return PipelineSummary(
      days: j?['days'] == null ? 30 : _int(j?['days']),
      stages: [
        for (final s in _maps(j?['stages']))
          StageTotal(
            id: s['id']?.toString() ?? '',
            name: s['name']?.toString() ?? 'Stage',
            kind: s['kind']?.toString() ?? 'open',
            count: _int(s['count']),
            totalValue: _num(s['total_value']),
          ),
      ],
      wonCount: _int(won['count']),
      wonValue: _num(won['value']),
      lost: _int(j?['lost']),
      winRate: j?['win_rate'] is num ? (j!['win_rate'] as num).toDouble() : null,
      byAgent: [
        for (final a in _maps(j?['by_agent']))
          AgentDeals(
            name: a['agent_name']?.toString() ?? '',
            open: _int(a['open']),
            openValue: _num(a['open_value']),
            won: _int(a['won']),
            wonValue: _num(a['won_value']),
          ),
      ],
      lostReasons: [for (final r in _maps(j?['lost_reasons'])) LostReason(r['reason']?.toString() ?? '', _int(r['count']))],
      bySource: [
        for (final r in _maps(j?['by_source']))
          SourceRow(
            source: r['source']?.toString() ?? 'direct',
            leads: _int(r['leads']),
            onBoard: _int(r['on_board']),
            won: _int(r['won']),
            wonValue: _num(r['won_value']),
          ),
      ],
    );
  }

  int get onBoard => stages.fold(0, (n, s) => n + s.count);
  Iterable<StageTotal> get _open => stages.where((s) => s.kind == 'open');
  int get openDeals => _open.fold(0, (n, s) => n + s.count);
  num get openValue => _open.fold<num>(0, (n, s) => n + s.totalValue);
  String get winRateText => winRate == null ? '—' : '${(winRate! * 100).round()}%';
}
