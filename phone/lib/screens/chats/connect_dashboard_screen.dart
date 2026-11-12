import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../hr/hr_manage_widgets.dart';
import '../hr/pay_widgets.dart';
import 'connect_dashboard_logic.dart';
import 'pipeline_screen.dart';

/// Website `/whatsapp/dashboard`: conversation status, pipeline, agents, campaigns and bot versus human.
/// Overview and agents must load; the pipeline and campaign widgets are optional there too.
class ConnectDashboardScreen extends StatefulWidget {
  const ConnectDashboardScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ConnectDashboardScreen> createState() => _ConnectDashboardScreenState();
}

class _ConnectDashboardScreenState extends State<ConnectDashboardScreen> with HrScreenState<ConnectDashboardScreen> {
  ConversationStatus _status = const ConversationStatus();
  BotVsHuman _bot = const BotVsHuman();
  List<AgentRow> _agents = const [];
  CampaignStats? _campaigns;
  PipelineSummary? _pipeline;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<Map<String, dynamic>?> _optional(String path) async {
    try {
      return await widget.session.api.getJson(path);
    } catch (_) {
      return null;
    }
  }

  Future<void> _load() => guardedLoad(() async {
        final api = widget.session.api;
        final results = await Future.wait([api.getJson(dashboardPaths[0]), api.getJson(dashboardPaths[1])]);
        final extras = await Future.wait([_optional(dashboardPaths[3]), _optional(dashboardPaths[2])]);
        if (!mounted) return;
        final overview = results[0];
        _status = ConversationStatus.fromJson(overview['status'] is Map ? Map<String, dynamic>.from(overview['status'] as Map) : null);
        _bot = BotVsHuman.fromJson(overview['botVsHuman'] is Map ? Map<String, dynamic>.from(overview['botVsHuman'] as Map) : null);
        _agents = agentRows(results[1]['agents']);
        final p = extras[0]?['pipeline'];
        _pipeline = p is Map ? PipelineSummary.fromJson(Map<String, dynamic>.from(p)) : null;
        final c = extras[1]?['campaigns'];
        _campaigns = c is Map ? CampaignStats.fromJson(Map<String, dynamic>.from(c)) : null;
      });

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'WhatsApp CRM dashboard',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'Nothing yet',
      emptyBody: '',
      emptyIcon: LucideIcons.layoutDashboard,
      rows: [
        ..._statusSection(),
        ..._pipelineSection(),
        ..._agentsSection(),
        ..._campaignSection(),
        ..._botSection(),
      ],
    );
  }

  List<Widget> _statusSection() => [
        const KSectionHeader('Conversation status'),
        HrTileGrid(tiles: [for (final (label, value) in _status.tiles) _StatTile(label: label, value: '$value')]),
      ];

  List<Widget> _pipelineSection() {
    final p = _pipeline;
    final header = Row(children: [
      const Expanded(child: KSectionHeader('Pipeline')),
      KTextButton(
        label: 'Open board',
        onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PipelineScreen(session: widget.session))),
      ),
    ]);
    if (p == null || p.onBoard == 0) {
      return [
        header,
        const KCard(
          child: KEmptyState(
            icon: LucideIcons.kanban,
            title: 'No chats on the pipeline yet',
            body: 'Set a stage from a chat\'s deal icon.',
          ),
        ),
      ];
    }
    return [
      header,
      HrTileGrid(tiles: [
        _StatTile(label: 'Open deals', value: '${p.openDeals}', sub: inr(p.openValue.round())),
        _StatTile(label: 'Won (${p.days} days)', value: '${p.wonCount}', sub: inr(p.wonValue.round())),
        _StatTile(label: 'Lost (${p.days} days)', value: '${p.lost}'),
        _StatTile(label: 'Win rate', value: p.winRateText, sub: 'of deals closed'),
      ]),
      KCard(
        child: KDivided(children: [
          for (final s in p.stages)
            KListRow(title: s.name, subtitle: s.totalValue > 0 ? inr(s.totalValue.round()) : null, trailing: Text('${s.count}', style: AppText.title)),
        ]),
      ),
      if (p.byAgent.isNotEmpty) ...[
        const KSectionHeader('Deals by agent'),
        KCard(
          child: KDivided(children: [
            for (final a in p.byAgent)
              KListRow(
                title: a.name,
                subtitle: '${a.open} open · ${inr(a.openValue.round())} in play',
                trailing: Text('${a.won} won · ${inr(a.wonValue.round())}', style: AppText.small),
              ),
          ]),
        ),
      ],
      if (p.bySource.isNotEmpty) ...[
        KSectionHeader('New chats by source (${p.days} days)'),
        KCard(
          child: KDivided(children: [
            for (final r in p.bySource)
              KListRow(
                title: r.label,
                subtitle: '${r.leads} chats · ${r.onBoard} on pipeline · ${r.won} won · ${inr(r.wonValue.round())}',
                trailing: Text(r.winPercent, style: AppText.title),
              ),
          ]),
        ),
      ],
      if (p.lostReasons.isNotEmpty) ...[
        const KSectionHeader('Top lost reasons'),
        Wrap(spacing: AppSpace.sm, runSpacing: AppSpace.sm, children: [
          for (final r in p.lostReasons) KPill(label: '${r.reason} · ${r.count}', tone: KTone.negative),
        ]),
      ],
    ];
  }

  List<Widget> _agentsSection() => [
        const KSectionHeader('Agent performance'),
        if (_agents.isEmpty)
          const KCard(child: KEmptyState(icon: LucideIcons.user, title: 'No agent performance data available', body: 'Chats assigned to your team show up here.'))
        else
          KCard(
            child: KDivided(children: [
              for (final a in _agents)
                KListRow(
                  title: a.name,
                  subtitle: '${a.total} total · ${a.open} open · ${a.closed} closed',
                  trailing: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text(a.responseText, style: AppText.title),
                    Text('Avg response', style: AppText.small),
                  ]),
                ),
            ]),
          ),
      ];

  List<Widget> _campaignSection() {
    final c = _campaigns;
    return [
      const KSectionHeader('Campaign performance'),
      if (c == null)
        const KCard(child: KEmptyState(icon: LucideIcons.megaphone, title: 'No campaign data available', body: 'Broadcasts you send show up here.'))
      else
        HrTileGrid(tiles: [
          _StatTile(label: 'Messages sent', value: '${c.sent}'),
          _StatTile(label: 'Delivered', value: c.deliveredText),
          _StatTile(label: 'Read', value: c.readText),
          _StatTile(label: 'Failed', value: '${c.failed}'),
          _StatTile(label: 'Responses', value: c.responsesText),
        ]),
    ];
  }

  List<Widget> _botSection() => [
        const KSectionHeader('Bot vs human'),
        HrTileGrid(tiles: [
          _StatTile(label: 'Bot handled', value: '${_bot.bot}', sub: '${_bot.botPercent}%'),
          _StatTile(label: 'Human handled', value: '${_bot.human}', sub: '${_bot.humanPercent}%'),
          _StatTile(label: 'Handoffs', value: '${_bot.handoffs}', sub: 'Bot to human'),
        ]),
      ];
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.label, required this.value, this.sub});

  final String label, value;
  final String? sub;

  @override
  Widget build(BuildContext context) {
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(label, style: AppText.caption),
        const SizedBox(height: 4),
        Text(value, style: AppText.title),
        if (sub != null) ...[const SizedBox(height: 4), Text(sub!, style: AppText.small)],
      ]),
    );
  }
}
