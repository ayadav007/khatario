import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/capability.dart';
import 'package:khatario_phone/screens/chats/chats_inbox_screen.dart';
import 'package:khatario_phone/screens/chats/flows_logic.dart';
import 'package:khatario_phone/screens/chats/flows_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/website_page_screen.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _flow(String id, String name, String status, {Map<String, dynamic>? triggers}) => {
      'id': id,
      'name': name,
      'status': status,
      'version': 2,
      'updated_at': '2026-11-10T08:30:00.000Z',
      'triggers': triggers ?? {'hardPhrases': ['order'], 'hardRegex': [], 'firstMessage': false, 'softIntents': []},
    };

Reply _flowsHandler(RequestOptions o, Map b, {List<Map<String, dynamic>>? flows}) {
  if (o.uri.path == '/api/whatsapp/flows' && o.method == 'GET') {
    return (200, {'flows': flows ?? [_flow('f1', 'Shop order', 'published'), _flow('f2', 'Welcome', 'draft')]});
  }
  return (200, <String, dynamic>{});
}

Future<void> _tapText(WidgetTester t, String text) async {
  final f = find.text(text).first;
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pumpAndSettle();
}

Finder _icon(String label) => find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == label);

Future<void> _openActions(WidgetTester t, String flowName, String action) async {
  await _tapText(t, flowName);
  await t.tap(inSheet(action));
  await t.pumpAndSettle();
}

void main() {
  group('flow rows', () {
    test('read the list the website reads, newest first as the server sends it', () {
      final rows = flowItems({
        'flows': [
          {
            'id': 'f1',
            'name': 'Shop order',
            'status': 'published',
            'version': 3,
            'updated_at': '2026-11-10T08:30:00.000Z',
            'triggers': {'hardPhrases': ['order', 'menu'], 'hardRegex': [], 'firstMessage': false, 'softIntents': []},
          },
          {'id': 'f2', 'name': 'Untitled 09:15', 'status': 'draft', 'version': 1, 'updated_at': 'bad'},
          {'name': 'no id'},
        ],
      });
      expect(rows.map((r) => r.id), ['f1', 'f2']);
      expect(rows.first.status, 'published');
      expect(rows.first.version, 3);
      expect(rows.first.updatedAt, isNotNull);
      expect(rows.last.updatedAt, isNull);
      expect(flowItems(null), isEmpty);
    });

    test('status labels follow the website (draft, published, inactive)', () {
      expect(flowStatusLabel('draft'), 'Draft');
      expect(flowStatusLabel('published'), 'Published');
      expect(flowStatusLabel('inactive'), 'Inactive');
      expect(flowStatusLabel('weird'), 'Weird');
    });

    test('trigger summary names the keywords, first message, regex and intents', () {
      expect(flowTriggerSummary(const {}), isNull);
      expect(flowTriggerSummary({'hardPhrases': ['order', 'menu']}), 'Keywords: order, menu');
      expect(flowTriggerSummary({'firstMessage': true}), 'First message');
      expect(
        flowTriggerSummary({'hardPhrases': ['hi'], 'hardRegex': ['^o'], 'firstMessage': true, 'softIntents': ['buy']}),
        'Keywords: hi · Pattern · First message · Intent: buy',
      );
    });
  });

  group('paths and bodies', () {
    test('only names and the starter are sent, never an owner id', () {
      final now = DateTime(2026, 11, 12, 9, 5);
      expect(newFlowBody(now), {'name': 'Untitled 09:05'});
      expect(newFlowBody(now, shopStarter: true), {'name': 'Shop order 2026-11-12 09:05', 'starter': 'shop_order'});
      expect(flowPublishPath('a b'), '/api/whatsapp/flows/a%20b/publish');
      expect(flowUnpublishPath('f1'), '/api/whatsapp/flows/f1/unpublish');
      expect(flowPath('f1'), '/api/whatsapp/flows/f1');
      expect(flowEditorHref('f1'), '/whatsapp/flows/f1');
      expect(flowsImportPath, '/api/whatsapp/flows/import-bot-rules');
    });

    test('the AI prompt needs 8 characters, as the server says', () {
      expect(generatePromptError('short'), 'Describe what the flow should do in a bit more detail.');
      expect(generatePromptError('   a b c  '), isNotNull);
      expect(generatePromptError('When a customer says order, show buttons'), isNull);
      expect(generateFlowBody('  When a customer says order  '), {'prompt': 'When a customer says order'});
    });
  });

  group('flows screen', () {
    testWidgets('lists name, status and what starts each flow, and sends no identity', (t) async {
      final (session, sent) = recordedSession(_flowsHandler);
      await pumpScreen(t, FlowsScreen(session: session));
      expect(find.text('Shop order'), findsOneWidget);
      expect(find.text('Published'), findsOneWidget);
      expect(find.text('Draft'), findsOneWidget);
      expect(find.textContaining('Keywords: order'), findsWidgets);
      expect(requestCount(sent, 'GET', '/api/whatsapp/flows'), 1);
      for (final o in sent) {
        expect(o.uri.query.contains('business_id'), isFalse);
      }
    });

    testWidgets('empty, server error with Try again, and not in the plan', (t) async {
      final (empty, _) = recordedSession((o, b) => _flowsHandler(o, b, flows: []));
      await pumpScreen(t, FlowsScreen(session: empty));
      expect(find.text('No flows yet'), findsOneWidget);

      var fail = true;
      final (flaky, sent) = recordedSession((o, b) => fail ? (500, {'error': 'Boom'}) : _flowsHandler(o, b));
      await pumpScreen(t, FlowsScreen(session: flaky));
      expect(find.text('Could not load flows'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Shop order'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/flows'), 2);

      final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, FlowsScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('Publish asks naming the flow and posts once; the refusal reason shows', (t) async {
      var refuse = false;
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/flows/f2/publish') {
          return refuse ? (400, {'error': 'Connect Start to the first step.'}) : (200, {'flow': _flow('f2', 'Welcome', 'published')});
        }
        return _flowsHandler(o, b);
      });
      await pumpScreen(t, FlowsScreen(session: session));
      await _openActions(t, 'Welcome', 'Publish');
      expect(find.textContaining('Welcome'), findsWidgets);
      expect(requestCount(sent, 'POST', '/api/whatsapp/flows/f2/publish'), 0);
      await t.tap(inSheet('Publish flow'));
      await t.tap(inSheet('Publish flow'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/whatsapp/flows/f2/publish'), 1);
      expect(requestsOf(sent, 'POST', '/api/whatsapp/flows/f2/publish').single.data, anyOf(isNull, isEmpty));
      expect(requestCount(sent, 'GET', '/api/whatsapp/flows'), 2);

      refuse = true;
      await _openActions(t, 'Welcome', 'Publish');
      await t.tap(inSheet('Publish flow'));
      await t.pumpAndSettle();
      expect(find.text('Connect Start to the first step.'), findsOneWidget);
    });

    testWidgets('Unpublish asks, then posts once', (t) async {
      final (session, sent) = recordedSession(_flowsHandler);
      await pumpScreen(t, FlowsScreen(session: session));
      await _openActions(t, 'Shop order', 'Unpublish');
      expect(requestCount(sent, 'POST', '/api/whatsapp/flows/f1/unpublish'), 0);
      await t.tap(inSheet('Unpublish flow'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/whatsapp/flows/f1/unpublish'), 1);
    });

    testWidgets('Delete asks naming the flow, deletes once, then reloads', (t) async {
      final (session, sent) = recordedSession(_flowsHandler);
      await pumpScreen(t, FlowsScreen(session: session));
      await _openActions(t, 'Welcome', 'Delete');
      expect(find.textContaining('Welcome'), findsWidgets);
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/flows/f2'), 0);
      await t.tap(inSheet('Delete flow'));
      await t.tap(inSheet('Delete flow'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/flows/f2'), 1);
      expect(requestCount(sent, 'GET', '/api/whatsapp/flows'), 2);
    });

    testWidgets('a refused delete says why', (t) async {
      final (session, _) = recordedSession((o, b) => o.method == 'DELETE' ? (404, {'error': 'Flow not found'}) : _flowsHandler(o, b));
      await pumpScreen(t, FlowsScreen(session: session));
      await _openActions(t, 'Welcome', 'Delete');
      await t.tap(inSheet('Delete flow'));
      await t.pumpAndSettle();
      expect(find.text('Flow not found'), findsOneWidget);
    });

    testWidgets('Edit on website opens the editor page of that flow inside the app', (t) async {
      final (session, _) = recordedSession(_flowsHandler);
      await pumpScreen(t, FlowsScreen(session: session));
      await _openActions(t, 'Shop order', 'Edit on website');
      expect(t.widget<WebsitePageScreen>(find.byType(WebsitePageScreen)).href, '/whatsapp/flows/f1');
    });

    testWidgets('New flow: shop starter posts a name and the starter, then opens the editor', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.method == 'POST' && o.uri.path == '/api/whatsapp/flows') return (201, {'flow': _flow('new1', 'x', 'draft')});
        return _flowsHandler(o, b);
      });
      await pumpScreen(t, FlowsScreen(session: session));
      await t.tap(_icon('New flow'));
      await t.pumpAndSettle();
      await t.tap(inSheet('Shop starter'));
      await t.pumpAndSettle();
      final body = lastBody(sent, 'POST', '/api/whatsapp/flows');
      expect(body['starter'], 'shop_order');
      expect((body['name'] as String).startsWith('Shop order '), isTrue);
      expectNoIdentity(body);
      expect(t.widget<WebsitePageScreen>(find.byType(WebsitePageScreen)).href, '/whatsapp/flows/new1');
    });

    testWidgets('Generate with AI needs a real prompt, then posts only the prompt', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/flows/generate') return (201, {'flow': _flow('g1', 'Generated', 'draft')});
        return _flowsHandler(o, b);
      });
      await pumpScreen(t, FlowsScreen(session: session));
      await t.tap(_icon('New flow'));
      await t.pumpAndSettle();
      await t.tap(inSheet('Generate with AI'));
      await t.pumpAndSettle();
      await t.enterText(find.byType(TextField).first, 'short');
      await t.tap(find.text('Generate'));
      await t.pumpAndSettle();
      expect(find.text('Describe what the flow should do in a bit more detail.'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/flows/generate'), 0);
      await t.enterText(find.byType(TextField).first, 'When a customer says order show Browse shop');
      await t.tap(find.text('Generate'));
      await t.pumpAndSettle();
      expect(lastBody(sent, 'POST', '/api/whatsapp/flows/generate'), {'prompt': 'When a customer says order show Browse shop'});
      expect(t.widget<WebsitePageScreen>(find.byType(WebsitePageScreen)).href, '/whatsapp/flows/g1');
    });

    testWidgets('coming from bot rules shows the note and imports the rules as drafts, then reloads', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/flows/import-bot-rules') {
          return (200, {'flows': [{'id': 'i1', 'name': 'Imported: Hello'}]});
        }
        return _flowsHandler(o, b);
      });
      await pumpScreen(t, FlowsScreen(session: session, fromBotRules: true));
      expect(find.textContaining('Keyword auto-replies still run until you import and publish them as Flows.'), findsOneWidget);
      await t.tap(find.text('Import existing rules as drafts'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/whatsapp/flows/import-bot-rules'), 1);
      expect(requestCount(sent, 'GET', '/api/whatsapp/flows'), 2);
      expect(find.text('Imported 1 flow as a draft'), findsOneWidget);

      await pumpScreen(t, FlowsScreen(session: session));
      expect(find.textContaining('Keyword auto-replies still run'), findsNothing);
    });

    testWidgets('a refused import (no active rules) shows the server reason', (t) async {
      final (session, _) = recordedSession((o, b) => o.method == 'POST' ? (400, {'error': 'No active keyword rules to import.'}) : _flowsHandler(o, b));
      await pumpScreen(t, FlowsScreen(session: session, fromBotRules: true));
      await t.tap(find.text('Import existing rules as drafts'));
      await t.pumpAndSettle();
      expect(find.text('No active keyword rules to import.'), findsOneWidget);
    });


    testWidgets('while a new flow is being made, a second New flow tap does nothing', (t) async {
      final gate = Completer<void>();
      final (session, sent) = recordedSession((o, b) async {
        if (o.method == 'POST' && o.uri.path == '/api/whatsapp/flows') {
          await gate.future;
          return (201, {'flow': _flow('new1', 'x', 'draft')});
        }
        return _flowsHandler(o, b);
      });
      await pumpScreen(t, FlowsScreen(session: session));
      await t.tap(_icon('New flow'));
      await t.pumpAndSettle();
      await t.tap(inSheet('Blank flow'));
      await t.pump();
      await t.tap(_icon('New flow'));
      await t.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);
      expect(requestCount(sent, 'POST', '/api/whatsapp/flows'), 1);
      gate.complete();
      await t.pumpAndSettle();
    });

    testWidgets('capabilities passed to the screen are used (lock when the plan lacks Connect)', (t) async {
      final (session, _) = recordedSession(_flowsHandler);
      const caps = Capabilities(
        sessionIsPrimaryAdmin: true,
        sessionPermissions: {},
        snapshot: CapabilitySnapshot(permissions: {}, isPrimaryAdmin: true, enabledFeatures: ['invoices']),
      );
      expect((nativeScreenFor(session, '/whatsapp/flows', capabilities: caps) as FlowsScreen).capabilities, caps);
      expect((nativeScreenFor(session, '/whatsapp/flows?from=bot-rules', capabilities: caps) as FlowsScreen).capabilities, caps);
      expect((nativeScreenFor(session, '/whatsapp/conversations', capabilities: caps) as Scaffold).body, isA<ChatsInboxScreen>());
      expect(((nativeScreenFor(session, '/whatsapp/conversations', capabilities: caps) as Scaffold).body as ChatsInboxScreen).capabilities, caps);
    });

    testWidgets('a plan without Connect shows the lock and no actions', (t) async {
      final (session, sent) = recordedSession(_flowsHandler);
      const caps = Capabilities(
        sessionIsPrimaryAdmin: true,
        sessionPermissions: {},
        snapshot: CapabilitySnapshot(permissions: {}, isPrimaryAdmin: true, enabledFeatures: ['invoices']),
      );
      await pumpScreen(t, FlowsScreen(session: session, capabilities: caps));
      expect(find.text('Flows need Connect'), findsOneWidget);
      expect(_icon('New flow'), findsNothing);
      expect(requestCount(sent, 'GET', '/api/whatsapp/flows'), 0);
    });
  });

  group('routes', () {
    final (session, _) = recordedSession((o, b) => (200, <String, dynamic>{}));

    test('flows, bot rules and a flow editor have their screens', () {
      expect(nativeScreenFor(session, '/whatsapp/flows'), isA<FlowsScreen>());
      expect((nativeScreenFor(session, '/whatsapp/flows?from=bot-rules') as FlowsScreen).fromBotRules, isTrue);
      expect((nativeScreenFor(session, '/whatsapp/flows?new=1') as FlowsScreen).openNew, isTrue);
      expect((nativeScreenFor(session, '/whatsapp/bot-rules') as FlowsScreen).fromBotRules, isTrue);
      final editor = nativeScreenFor(session, '/whatsapp/flows/abc') as WebsitePageScreen;
      expect(editor.href, '/whatsapp/flows/abc');
    });
  });
}
