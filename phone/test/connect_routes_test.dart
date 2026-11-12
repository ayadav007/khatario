import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/campaigns_screen.dart';
import 'package:khatario_phone/screens/chats/chat_outreach_screens.dart';
import 'package:khatario_phone/screens/chats/chat_thread_screen.dart';
import 'package:khatario_phone/screens/chats/chats_inbox_screen.dart';
import 'package:khatario_phone/screens/chats/connect_dashboard_screen.dart';
import 'package:khatario_phone/screens/chats/lead_profile_screen.dart';
import 'package:khatario_phone/screens/chats/lead_sources_screen.dart';
import 'package:khatario_phone/screens/chats/leads_screen.dart';
import 'package:khatario_phone/screens/chats/pipeline_logic.dart';
import 'package:khatario_phone/screens/chats/pipeline_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _card(String id, String name) => {'id': id, 'stage_id': 's1', 'name': name, 'conversation_id': 'c-$id', 'last_message_text': 'hello'};

Map<String, dynamic> _board(List<Map<String, dynamic>> cards, {int count = 3}) => {
      'columns': [
        {'id': 's1', 'name': 'New', 'kind': 'open', 'count': count, 'total_value': 0, 'cards': cards},
        {'id': 's2', 'name': 'Quoted', 'kind': 'open', 'count': 0, 'total_value': 0, 'cards': <Map<String, dynamic>>[]},
      ],
    };

void main() {
  final (session, _) = recordedSession((o, b) => (200, <String, dynamic>{}));

  group('Connect links open their phone screens', () {
    test('every Connect href of this task has a screen', () {
      expect(nativeScreenFor(session, '/whatsapp/dashboard'), isA<ConnectDashboardScreen>());
      expect(nativeScreenFor(session, '/whatsapp/leads'), isA<LeadsScreen>());
      expect(nativeScreenFor(session, '/whatsapp/lead-sources'), isA<LeadSourcesScreen>());
      expect(nativeScreenFor(session, '/whatsapp/pipeline'), isA<PipelineScreen>());
      expect(nativeScreenFor(session, '/whatsapp/campaigns'), isA<CampaignsScreen>());
      expect(nativeScreenFor(session, '/whatsapp/bot-rules'), isA<BotRepliesScreen>());
    });

    test('the inbox gets a page of its own, as the Chats tab gives it', () {
      final s = nativeScreenFor(session, '/whatsapp/conversations');
      expect(s, isA<Scaffold>());
      expect(((s! as Scaffold).body), isA<ChatsInboxScreen>());
    });

    test('sub-links open the lead or the chat they name', () {
      final lead = nativeScreenFor(session, '/whatsapp/leads?lead=abc') as LeadProfileScreen;
      expect(lead.leadId, 'abc');
      final chat = nativeScreenFor(session, '/whatsapp/conversations?c=xyz') as ChatThreadScreen;
      expect(chat.conversationId, 'xyz');
      expect(nativeScreenFor(session, '/whatsapp/leads?status=open'), isA<LeadsScreen>());
    });

    test('none of them falls back to the automatic list, and the rest of Connect stays listed', () {
      for (final href in [
        '/whatsapp/dashboard', '/whatsapp/conversations', '/whatsapp/leads', '/whatsapp/pipeline', '/whatsapp/lead-sources',
        '/whatsapp/campaigns', '/whatsapp/bot-rules',
      ]) {
        expect(stillGeneric.contains(href), isFalse, reason: href);
        expect(routeTier(session, href), RouteTier.native, reason: href);
      }
      expect(stillGeneric.where((h) => h.startsWith('/whatsapp')).toSet(), {
        '/whatsapp/flows',
      });
    });
  });

  group('pipeline Show more', () {
    test('the next page of one stage, and the merge', () {
      expect(pipelineMorePath('s1', 2), '/api/whatsapp/pipeline?closed_days=90&stage_id=s1&offset=2');
      final stage = parseBoard(_board([_card('a', 'A'), _card('b', 'B')])).first;
      final merged = stage.withMoreCards(parseBoard(_board([_card('b', 'B'), _card('c', 'C')])).first.cards);
      expect(merged.cards.map((c) => c.id), ['a', 'b', 'c']);
      expect(merged.count, 3);
    });

    testWidgets('shows the remaining count, loads the next page of that stage and drops the website line', (t) async {
      final (s, sent) = recordedSession((o, b) {
        if (o.uri.queryParameters['offset'] == '2') return (200, _board([_card('c', 'Third Lead')]));
        return (200, _board([_card('a', 'First Lead'), _card('b', 'Second Lead')]));
      });
      await pumpScreen(t, PipelineScreen(session: s));
      expect(find.text('Show more (1)'), findsOneWidget);
      expect(find.textContaining('See all on the website'), findsNothing);
      await t.ensureVisible(find.text('Show more (1)'));
      await t.tap(find.text('Show more (1)'));
      await t.tap(find.text('Show more (1)'), warnIfMissed: false);
      await t.pumpAndSettle();
      final more = sent.where((o) => o.uri.queryParameters['offset'] == '2').toList();
      expect(more.length, 1);
      expect(more.single.uri.queryParameters, {'closed_days': '90', 'stage_id': 's1', 'offset': '2'});
      expect(find.text('Third Lead'), findsOneWidget);
      expect(find.text('First Lead'), findsOneWidget);
      expect(find.textContaining('Show more'), findsNothing);
    });

    testWidgets('a refused Show more keeps the list and says why', (t) async {
      final (s, _) = recordedSession((o, b) {
        if (o.uri.queryParameters['offset'] == '2') return (400, {'error': 'Could not load more'});
        return (200, _board([_card('a', 'First Lead'), _card('b', 'Second Lead')]));
      });
      await pumpScreen(t, PipelineScreen(session: s));
      await t.ensureVisible(find.text('Show more (1)'));
      await t.tap(find.text('Show more (1)'));
      await t.pumpAndSettle();
      expect(find.text('Could not load more'), findsOneWidget);
      expect(find.text('First Lead'), findsOneWidget);
      expect(find.text('Show more (1)'), findsOneWidget);
    });
  });
}
