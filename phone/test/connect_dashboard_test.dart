import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/connect_dashboard_screen.dart';
import 'package:khatario_phone/screens/chats/connect_dashboard_logic.dart';

import 'support/recorded_session.dart';

const _overview = {
  'status': {'total': 12, 'open': 5, 'pending': 3, 'closed': 4, 'unread': 2},
  'botVsHuman': {'bot_handled': 6, 'human_handled': 2, 'handoff_count': 1, 'total_events': 20},
};

const _agents = {
  'agents': [
    {'agent_id': 'a1', 'agent_name': 'Meena', 'total_assigned': 9, 'open': 4, 'closed': 5, 'avg_response_seconds': 125.4},
    {'agent_id': 'a2', 'agent_name': 'Ravi', 'total_assigned': 3, 'open': 1, 'closed': 2, 'avg_response_seconds': null},
  ],
};

const _campaigns = {
  'campaigns': {'messages_sent': 200, 'delivered': 180, 'read': 90, 'failed': 4, 'responses_received': 10},
};

const _pipeline = {
  'pipeline': {
    'days': 30,
    'stages': [
      {'id': 's1', 'name': 'New', 'kind': 'open', 'count': 4, 'total_value': 12000},
      {'id': 's2', 'name': 'Quoted', 'kind': 'open', 'count': 2, 'total_value': 30500.5},
      {'id': 's3', 'name': 'Won', 'kind': 'won', 'count': 1, 'total_value': 5000},
      {'id': 's4', 'name': 'Lost', 'kind': 'lost', 'count': 3, 'total_value': 0},
    ],
    'won': {'count': 1, 'value': 5000},
    'lost': 3,
    'win_rate': 0.25,
    'by_agent': [
      {'agent_id': 'a1', 'agent_name': 'Meena', 'open': 3, 'open_value': 20000, 'won': 1, 'won_value': 5000},
    ],
    'lost_reasons': [
      {'reason': 'price too high', 'count': 2},
    ],
    'by_source': [
      {'source': 'indiamart', 'leads': 8, 'on_board': 6, 'won': 2, 'won_value': 9000},
      {'source': 'direct', 'leads': 0, 'on_board': 0, 'won': 0, 'won_value': 0},
    ],
  },
};

void main() {
  test('dashboard paths are the website ones and carry no business id', () {
    expect(dashboardPaths, [
      '/api/whatsapp/dashboard/overview',
      '/api/whatsapp/dashboard/agents',
      '/api/whatsapp/dashboard/campaigns',
      '/api/whatsapp/dashboard/pipeline',
    ]);
    for (final p in dashboardPaths) {
      expect(p.contains('business_id'), isFalse);
    }
  });

  test('conversation status tiles and the open/pending/closed split', () {
    final s = ConversationStatus.fromJson(_overview['status'] as Map<String, dynamic>);
    expect([s.total, s.open, s.pending, s.closed, s.unread], [12, 5, 3, 4, 2]);
    expect(s.tiles.map((t) => t.$1), ['Total', 'Open', 'Pending', 'Closed', 'Unread']);
    expect(s.tiles.map((t) => t.$2), [12, 5, 3, 4, 2]);
    expect(ConversationStatus.fromJson(null).total, 0);
  });

  test('bot versus human shares', () {
    final b = BotVsHuman.fromJson(_overview['botVsHuman'] as Map<String, dynamic>);
    expect((b.bot, b.human, b.handoffs), (6, 2, 1));
    expect(b.botPercent, '75.0');
    expect(b.humanPercent, '25.0');
    expect(BotVsHuman.fromJson({}).botPercent, '0.0');
  });

  test('campaign performance rates', () {
    final c = CampaignStats.fromJson(_campaigns['campaigns'] as Map<String, dynamic>);
    expect(c.sent, 200);
    expect(c.deliveredText, '180 (90.0%)');
    expect(c.readText, '90 (50.0%)');
    expect(c.responsesText, '10 (5.0%)');
    expect(c.failed, 4);
    expect(CampaignStats.fromJson({}).deliveredText, '0 (0.0%)');
  });

  test('agent rows and response time', () {
    final rows = agentRows(_agents['agents']);
    expect(rows.map((r) => r.name), ['Meena', 'Ravi']);
    expect(rows.first.total, 9);
    expect(rows.first.responseText, '2m');
    expect(rows.last.responseText, 'N/A');
    expect(responseTime(30), '30s');
    expect(responseTime(5400), '2h');
  });

  test('pipeline summary', () {
    final p = PipelineSummary.fromJson(_pipeline['pipeline'] as Map<String, dynamic>);
    expect(p.onBoard, 10);
    expect(p.openDeals, 6);
    expect(p.openValue, 42500.5);
    expect(p.wonCount, 1);
    expect(p.wonValue, 5000);
    expect(p.lost, 3);
    expect(p.winRateText, '25%');
    expect(p.lostReasons.single.reason, 'price too high');
    expect(p.byAgent.single.name, 'Meena');
    expect(p.bySource.first.label, 'IndiaMART');
    expect(p.bySource.first.winPercent, '25%');
    expect(p.bySource.last.label, 'Direct');
    expect(p.bySource.last.winPercent, '—');
    expect(PipelineSummary.fromJson({'win_rate': null, 'stages': []}).winRateText, '—');
    expect(PipelineSummary.fromJson({'stages': []}).onBoard, 0);
  });

  group('dashboard screen', () {
    Reply ok(RequestOptions o, Map b) {
      final p = o.uri.path;
      if (p.endsWith('/overview')) return (200, _overview);
      if (p.endsWith('/agents')) return (200, _agents);
      if (p.endsWith('/campaigns')) return (200, _campaigns);
      if (p.endsWith('/pipeline')) return (200, _pipeline);
      return (404, <String, dynamic>{});
    }

    testWidgets('shows status, pipeline, agents, campaigns and bot tiles; sends no business id', (t) async {
      final (session, sent) = recordedSession((o, b) => ok(o, b));
      await pumpScreen(t, ConnectDashboardScreen(session: session));
      expect(find.text('WhatsApp CRM dashboard'), findsOneWidget);
      expect(find.text('Conversation status'), findsOneWidget);
      expect(find.text('Unread'), findsOneWidget);
      expect(find.text('Open deals'), findsOneWidget);
      expect(find.text('25%'), findsWidgets);
      expect(find.text('Meena'), findsWidgets);
      expect(find.text('2m'), findsOneWidget);
      expect(find.text('N/A'), findsOneWidget);
      expect(find.text('180 (90.0%)'), findsOneWidget);
      expect(find.text('Bot handled'), findsOneWidget);
      expect(find.text('price too high · 2'), findsOneWidget);
      expect(find.text('IndiaMART'), findsOneWidget);
      expect(sent.map((o) => o.method).toSet(), {'GET'});
      expect(sent.map((o) => o.uri.path).toSet(), dashboardPaths.toSet());
      for (final o in sent) {
        expect(o.uri.query.contains('business_id'), isFalse);
      }
    });

    testWidgets('an empty pipeline says so; a failing optional widget does not break the page', (t) async {
      final (session, _) = recordedSession((o, b) {
        if (o.uri.path.endsWith('/pipeline')) return (200, {'pipeline': {'stages': []}});
        if (o.uri.path.endsWith('/campaigns')) return (500, <String, dynamic>{});
        return ok(o, b);
      });
      await pumpScreen(t, ConnectDashboardScreen(session: session));
      expect(find.textContaining('No chats on the pipeline yet'), findsOneWidget);
      expect(find.text('Conversation status'), findsOneWidget);
      expect(find.text('No campaign data available'), findsOneWidget);
    });

    testWidgets('no agents and nothing handled show the website empty texts', (t) async {
      final (session, _) = recordedSession((o, b) {
        if (o.uri.path.endsWith('/agents')) return (200, {'agents': []});
        return ok(o, b);
      });
      await pumpScreen(t, ConnectDashboardScreen(session: session));
      expect(find.text('No agent performance data available'), findsOneWidget);
    });

    testWidgets('a server error offers Try again, which reloads', (t) async {
      var fail = true;
      final (session, sent) = recordedSession((o, b) => fail ? (400, {'error': 'Could not load'}) : ok(o, b));
      await pumpScreen(t, ConnectDashboardScreen(session: session));
      expect(find.text('Try again'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Conversation status'), findsOneWidget);
      expect(sent.where((o) => o.uri.path.endsWith('/overview')).length, 2);
    });

    testWidgets('a plan without Connect shows the plan message and no retry', (t) async {
      final (session, _) = recordedSession((o, b) => (403, {'error': 'Not in your plan', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, ConnectDashboardScreen(session: session));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });
  });
}
