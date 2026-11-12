import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/lead_profile_screen.dart';
import 'package:khatario_phone/screens/chats/pipeline_logic.dart';
import 'package:khatario_phone/screens/chats/pipeline_screen.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _card(String id, String name, {String stage = 's1', Map<String, dynamic> extra = const {}}) =>
    {'id': id, 'stage_id': stage, 'name': name, 'conversation_id': 'c-$id', 'last_message_text': 'hello', 'phone': '919876510004', ...extra};

Map<String, dynamic> _board({List<Map<String, dynamic>>? s1, int s1Count = 1, List<Map<String, dynamic>>? s2, int s2Count = 0, bool supervisor = false}) => {
      'is_supervisor': supervisor,
      'columns': [
        {'id': 's1', 'name': 'New', 'kind': 'open', 'count': s1Count, 'total_value': 0, 'cards': s1 ?? [_card('a', 'First Lead')]},
        {'id': 's2', 'name': 'Quoted', 'kind': 'open', 'count': s2Count, 'total_value': 0, 'cards': s2 ?? <Map<String, dynamic>>[]},
      ],
    };

const _labels = {
  'labels': [
    {'id': 'b1', 'name': 'VIP'},
  ],
};
const _users = {
  'users': [
    {'id': 'u1', 'name': 'Asha', 'can_receive': true},
  ],
};

Finder _icon(String label) => find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == label);

Future<void> _tapText(WidgetTester t, String text) async {
  final f = find.text(text).first;
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pumpAndSettle();
}

Future<void> _sheet(WidgetTester t, String text) async {
  await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text(text)));
  await t.pumpAndSettle();
}

Reply _ok(RequestOptions o, Map b, Map<String, dynamic> board) {
  final p = o.uri.path;
  if (p == '/api/whatsapp/pipeline') return (200, board);
  if (p == '/api/whatsapp/labels') return (200, _labels);
  if (p == '/api/whatsapp/users') return (200, _users);
  if (p == '/api/whatsapp/leads/a') return (200, {'lead': {'id': 'a', 'name': 'First Lead', 'phone': '919876510004', 'lead_type': 'new'}});
  return (200, <String, dynamic>{});
}

void main() {
  group('pipeline logic', () {
    test('the board path carries only the filters that are set', () {
      expect(pipelinePath(const PipelineFilters()), '/api/whatsapp/pipeline?closed_days=90');
      expect(
        pipelinePath(const PipelineFilters(search: ' ravi ', owner: 'u1', labelId: 'b1', source: 'direct', closedDays: 30)),
        '/api/whatsapp/pipeline?search=ravi&owner=u1&label_id=b1&source=direct&closed_days=30',
      );
      expect(pipelineMorePath('s1', 2, const PipelineFilters(source: 'indiamart', closedDays: 365)),
          '/api/whatsapp/pipeline?source=indiamart&closed_days=365&stage_id=s1&offset=2');
      expect(pipelineMorePath('s1', 2), '/api/whatsapp/pipeline?closed_days=90&stage_id=s1&offset=2');
    });

    test('cards carry the extras and the remainder never goes below zero', () {
      final stage = parseBoard(_board(s1: [_card('a', 'A', extra: {'is_customer': true, 'temperature': 'hot'}), _card('b', 'B')], s1Count: 1)).first;
      expect(stage.cards.first.isCustomer, isTrue);
      expect(stage.cards.first.temperature, 'hot');
      expect(stage.cards.first.phone, '919876510004');
      expect(stage.remaining, 0);
      expect(parseBoard(_board(s1Count: 4)).first.remaining, 3);
    });

    test('stage bodies and paths', () {
      expect(stagesPath, '/api/whatsapp/pipeline/stages');
      expect(stagePath('s 1'), '/api/whatsapp/pipeline/stages/s%201');
      expect(stageDeletePath('s1', 's2'), '/api/whatsapp/pipeline/stages/s1?move_to=s2');
      expect(stageDeletePath('s1', ''), '/api/whatsapp/pipeline/stages/s1');
      expect(stageCreateBody(' Quoted ', 'open'), {'name': 'Quoted', 'kind': 'open'});
      expect(stageOrderBody(['b', 'a']), {'order': ['b', 'a']});
      expect(stageColors.map((c) => c.$1), ['slate', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'violet']);
      expect(stageColors.first.$2, 'Grey');
      expect(stageKinds, [('open', 'Open'), ('won', 'Won'), ('lost', 'Lost')]);
      for (final b in [stageCreateBody('x', 'open'), stageOrderBody(['a'])]) {
        expectNoIdentity(b);
      }
    });

    test('stage definitions read the stages reply', () {
      final s = stageDefs({
        'stages': [
          {'id': 's1', 'name': 'New', 'color': 'blue', 'kind': 'open', 'position': 1},
          {'id': 's2', 'name': 'Won', 'color': 'green', 'kind': 'won', 'position': 2},
        ],
      });
      expect(s.map((x) => (x.id, x.name, x.color, x.kind)), [('s1', 'New', 'blue', 'open'), ('s2', 'Won', 'green', 'won')]);
    });
  });

  group('pipeline screen', () {
    testWidgets('searching, the source, label and window pickers reload the board with those filters', (t) async {
      final (s, sent) = recordedSession((o, b) => _ok(o, b, _board()));
      await pumpScreen(t, PipelineScreen(session: s));
      expect(find.text('Handled by'), findsNothing);
      await t.enterText(find.byType(TextField).first, 'ravi');
      await t.pump(const Duration(milliseconds: 400));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/whatsapp/pipeline').last.uri.queryParameters, {'search': 'ravi', 'closed_days': '90'});
      await _tapText(t, 'All sources');
      await _sheet(t, 'IndiaMART');
      await _tapText(t, 'All labels');
      await _sheet(t, 'VIP');
      await _tapText(t, 'Won/lost: last 90 days');
      await _sheet(t, 'Won/lost: last 30 days');
      expect(requestsOf(sent, 'GET', '/api/whatsapp/pipeline').last.uri.queryParameters,
          {'search': 'ravi', 'label_id': 'b1', 'source': 'indiamart', 'closed_days': '30'});
      for (final o in sent) {
        expect(o.uri.query.contains('business_id'), isFalse);
      }
    });

    testWidgets('a supervisor also gets the Handled by filter', (t) async {
      final (s, sent) = recordedSession((o, b) => _ok(o, b, _board(supervisor: true)));
      await pumpScreen(t, PipelineScreen(session: s));
      await _tapText(t, 'Everyone');
      await _sheet(t, 'Asha');
      expect(requestsOf(sent, 'GET', '/api/whatsapp/pipeline').last.uri.queryParameters, {'owner': 'u1', 'closed_days': '90'});
    });

    testWidgets('a card shows the phone, Existing customer and the temperature', (t) async {
      final (s, _) = recordedSession((o, b) => _ok(o, b, _board(s1: [_card('a', 'First Lead', extra: {'is_customer': true, 'temperature': 'hot'})])));
      await pumpScreen(t, PipelineScreen(session: s));
      expect(find.textContaining('+91 98765 10004'), findsOneWidget);
      expect(find.textContaining('Existing customer'), findsOneWidget);
      expect(find.textContaining('Hot'), findsOneWidget);
    });

    testWidgets('tapping a card opens the lead profile, not the chat', (t) async {
      final (s, sent) = recordedSession((o, b) => _ok(o, b, _board()));
      await pumpScreen(t, PipelineScreen(session: s));
      await t.tap(find.text('First Lead'));
      await t.pumpAndSettle();
      expect(find.byType(LeadProfileScreen), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/leads/a'), 1);
    });

    testWidgets('an error offers Try again; a plan without Connect shows the plan message and no stage button', (t) async {
      var fail = true;
      final (s, sent) = recordedSession((o, b) => fail && o.uri.path == '/api/whatsapp/pipeline' ? (400, {'error': 'Could not load the pipeline'}) : _ok(o, b, _board()));
      await pumpScreen(t, PipelineScreen(session: s));
      expect(find.text('Could not load the pipeline'), findsWidgets);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('First Lead'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/pipeline'), 2);

      final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, PipelineScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
      expect(_icon('Stages'), findsNothing);
    });

    testWidgets('Show more is busy for its own stage only', (t) async {
      final gate = Completer<void>();
      final (s, sent) = recordedSession((o, b) async {
        if (o.uri.queryParameters['offset'] == '1') {
          await gate.future;
          return (200, _board(s1: [_card('c', 'Third Lead')], s1Count: 3));
        }
        return _ok(o, b, _board(s1Count: 3, s2: [_card('z', 'Quoted Lead', stage: 's2')], s2Count: 2));
      });
      await pumpScreen(t, PipelineScreen(session: s));
      await t.tap(find.text('Show more (2)'));
      await t.pump();
      expect(find.text('Loading…'), findsOneWidget);
      await t.tap(find.text('Quoted 2'));
      await t.pump();
      expect(find.text('Show more (1)'), findsOneWidget);
      expect(find.text('Loading…'), findsNothing);
      gate.complete();
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/whatsapp/pipeline').where((o) => o.uri.queryParameters['offset'] == '1').length, 1);
    });

    testWidgets('a stage whose count has dropped below the cards shown offers no Show more', (t) async {
      final (s, _) = recordedSession((o, b) => _ok(o, b, _board(s1: [_card('a', 'A'), _card('b', 'B')], s1Count: 1)));
      await pumpScreen(t, PipelineScreen(session: s));
      expect(find.textContaining('Show more'), findsNothing);
    });

    testWidgets('each card has a visible Move action that opens the same move sheet', (t) async {
      final (s, sent) = recordedSession((o, b) => _ok(o, b, _board()));
      await pumpScreen(t, PipelineScreen(session: s));
      await t.tap(find.text('Move'));
      await t.pumpAndSettle();
      expect(find.text('Move First Lead'), findsOneWidget);
      await _sheet(t, 'Quoted');
      expect(requestsOf(sent, 'PATCH', '/api/whatsapp/leads/a').single.data, {'stage_id': 's2'});
    });

    testWidgets('moving a card reloads the board so the counts are right', (t) async {
      final (s, sent) = recordedSession((o, b) => _ok(o, b, _board()));
      await pumpScreen(t, PipelineScreen(session: s));
      await t.longPress(find.text('First Lead'));
      await t.pumpAndSettle();
      await _sheet(t, 'Quoted');
      expect(requestsOf(sent, 'PATCH', '/api/whatsapp/leads/a').single.data, {'stage_id': 's2'});
      expect(requestCount(sent, 'GET', '/api/whatsapp/pipeline'), 2);
    });
  });
}
