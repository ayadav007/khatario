import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/lead_sources_screen.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

const _stages = {
  'stages': [
    {'id': 'st1', 'name': 'New', 'kind': 'open', 'position': 1},
    {'id': 'st2', 'name': 'Quoted', 'kind': 'open', 'position': 2},
  ],
};
const _users = {
  'users': [
    {'id': 'u1', 'name': 'Asha', 'can_receive': true},
  ],
};
const _labels = {
  'labels': [
    {'id': 'b1', 'name': 'VIP'},
    {'id': 'b2', 'name': 'Wholesale'},
  ],
};

Map<String, dynamic> _sources({bool indiaMart = true, bool enabled = true, bool direct = true}) => {
      'direct': {'enabled': direct},
      'sources': [
        if (indiaMart)
          {
            'id': 's1', 'kind': 'indiamart', 'name': 'IndiaMART', 'enabled': enabled, 'has_key': true, 'stage_id': 'st1', 'assign_to': null,
            'label_ids': ['b1'], 'last_run_at': '2026-11-10T05:00:00.000Z', 'last_result': {'fetched': 5, 'imported': 3}, 'last_error': null, 'leads': 40,
          },
        {'id': 's2', 'kind': 'webhook', 'name': 'JustDial via Zapier', 'enabled': true, 'token_hint': 'a1b2', 'leads': 2, 'last_run_at': null, 'last_error': null},
      ],
    };

const _links = {
  'base_url': 'https://khatario.com',
  'suggested_phone': '919876543210',
  'links': [
    {'id': 'k1', 'code': 'K7Q2MX', 'name': 'Diwali poster', 'phone': '919876543210', 'prefill_text': 'Hi', 'clicks': 10, 'qr_scans': 2, 'widget_clicks': 1, 'chats': 4, 'won': 1, 'archived': false},
  ],
};

Reply _ok(RequestOptions o, Map b, {Map<String, dynamic>? sources}) {
  final p = o.uri.path;
  if (p == '/api/whatsapp/lead-sources' && o.method == 'GET') return (200, sources ?? _sources());
  if (p == '/api/whatsapp/lead-sources/links' && o.method == 'GET') return (200, _links);
  if (p == '/api/whatsapp/pipeline/stages') return (200, _stages);
  if (p == '/api/whatsapp/users') return (200, _users);
  if (p == '/api/whatsapp/labels') return (200, _labels);
  return (200, <String, dynamic>{});
}

Finder _icon(String label) => find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == label);

Future<void> _tapText(WidgetTester t, String text, {bool last = false}) async {
  final f = last ? find.text(text).last : find.text(text).first;
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pumpAndSettle();
}

Future<void> _type(WidgetTester t, String label, String text) async {
  final f = find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first, matching: find.byType(TextField)).first;
  await t.ensureVisible(f);
  await t.enterText(f, text);
  await t.pump();
}

Future<void> _sheet(WidgetTester t, String text) async {
  await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text(text)));
  await t.pumpAndSettle();
}

void main() {
  testWidgets('shows the switch, links, IndiaMART and webhooks, and sends no business id', (t) async {
    final (session, sent) = recordedSession((o, b) => _ok(o, b));
    await pumpScreen(t, LeadSourcesScreen(session: session));
    expect(find.text('Add every new number to the pipeline'), findsOneWidget);
    expect(find.text('Diwali poster'), findsOneWidget);
    expect(find.text('https://khatario.com/w/K7Q2MX'), findsOneWidget);
    expect(find.text('10 clicks · 2 QR scans · 1 website taps · 4 chats · 1 won'), findsOneWidget);
    expect(find.text('Connected'), findsOneWidget);
    expect(find.text('40 leads imported'), findsOneWidget);
    expect(find.text('JustDial via Zapier'), findsOneWidget);
    expect(find.textContaining('…a1b2'), findsOneWidget);
    expect(sent.map((o) => o.method).toSet(), {'GET'});
    for (final o in sent) {
      expect(o.uri.query.contains('business_id'), isFalse);
    }
  });

  testWidgets('a server error offers Try again; a plan without Connect does not', (t) async {
    var fail = true;
    final (session, sent) = recordedSession((o, b) => fail && o.uri.path == '/api/whatsapp/lead-sources' ? (400, {'error': 'No setup permission'}) : _ok(o, b));
    await pumpScreen(t, LeadSourcesScreen(session: session));
    expect(find.text('No setup permission'), findsOneWidget);
    fail = false;
    await t.tap(find.text('Try again'));
    await t.pumpAndSettle();
    expect(find.text('Diwali poster'), findsOneWidget);
    expect(requestCount(sent, 'GET', '/api/whatsapp/lead-sources'), 2);

    final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
    await pumpScreen(t, LeadSourcesScreen(session: locked));
    expect(find.text('Not included in your current plan'), findsOneWidget);
  });

  testWidgets('the new-numbers switch posts the kind and the new value, and a refusal puts it back', (t) async {
    var refuse = false;
    final (session, sent) = recordedSession((o, b) {
      if (o.method == 'POST' && o.uri.path == '/api/whatsapp/lead-sources') return refuse ? (403, {'error': 'You need the WhatsApp setup permission'}) : (200, {'direct': {'enabled': false}});
      return _ok(o, b);
    });
    await pumpScreen(t, LeadSourcesScreen(session: session));
    await _tapText(t, 'Add every new number to the pipeline');
    expect(requestsOf(sent, 'POST', '/api/whatsapp/lead-sources').single.data, {'kind': 'direct', 'enabled': false});
    refuse = true;
    await _tapText(t, 'Add every new number to the pipeline');
    expect(find.text('You need the WhatsApp setup permission'), findsOneWidget);
    expect(requestCount(sent, 'POST', '/api/whatsapp/lead-sources'), 2);
  });

  group('IndiaMART', () {
    testWidgets('pausing asks first, naming the source; resuming does not ask', (t) async {
      var enabled = true;
      final (session, sent) = recordedSession((o, b) {
        if (o.method == 'PATCH' && o.uri.path == '/api/whatsapp/lead-sources/s1') {
          enabled = b['enabled'] == true;
          return (200, {'source': {'id': 's1'}});
        }
        return _ok(o, b, sources: _sources(enabled: enabled));
      });
      await pumpScreen(t, LeadSourcesScreen(session: session));
      await _tapText(t, 'Pause');
      expect(find.text('Pause IndiaMART?'), findsOneWidget);
      await _sheet(t, 'Not now');
      expect(requestCount(sent, 'PATCH', '/api/whatsapp/lead-sources/s1'), 0);
      await _tapText(t, 'Pause');
      await _sheet(t, 'Pause IndiaMART');
      expect(requestsOf(sent, 'PATCH', '/api/whatsapp/lead-sources/s1').single.data, {'enabled': false});
      expect(find.text('Paused'), findsOneWidget);
      await _tapText(t, 'Resume');
      expect(find.byType(BottomSheet), findsNothing);
      expect(requestsOf(sent, 'PATCH', '/api/whatsapp/lead-sources/s1').last.data, {'enabled': true});
      expect(find.text('Connected'), findsOneWidget);
    });

    testWidgets('a refused pause shows the server text', (t) async {
      final (session, _) = recordedSession((o, b) => o.method == 'PATCH' ? (404, {'error': 'Lead source not found', 'code': 'NOT_FOUND'}) : _ok(o, b));
      await pumpScreen(t, LeadSourcesScreen(session: session));
      await _tapText(t, 'Pause');
      await _sheet(t, 'Pause IndiaMART');
      expect(find.text('Lead source not found'), findsOneWidget);
    });

    testWidgets('Sync now posts once even on a double tap and says how many leads came', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.method == 'POST' && o.uri.path == '/api/whatsapp/lead-sources/indiamart/sync') return (200, {'run': {'imported': 3}});
        return _ok(o, b);
      });
      await pumpScreen(t, LeadSourcesScreen(session: session));
      await t.ensureVisible(find.text('Sync now'));
      await t.tap(find.text('Sync now'));
      await t.tap(find.text('Sync now'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'POST', '/api/whatsapp/lead-sources/indiamart/sync').length, 1);
      expect(find.text('Checked IndiaMART: 3 new leads'), findsOneWidget);
    });

    testWidgets('a failed sync shows what IndiaMART said', (t) async {
      final (session, _) = recordedSession((o, b) => o.method == 'POST' ? (502, {'error': 'IndiaMART: too many requests'}) : _ok(o, b));
      await pumpScreen(t, LeadSourcesScreen(session: session));
      await _tapText(t, 'Sync now');
      // The server answers 502 with IndiaMART's own words; they are shown as they are.
      expect(find.text('IndiaMART: too many requests'), findsOneWidget);
    });

    testWidgets('Disconnect asks first, then deletes the source', (t) async {
      final (session, sent) = recordedSession((o, b) => _ok(o, b));
      await pumpScreen(t, LeadSourcesScreen(session: session));
      await _tapText(t, 'Disconnect');
      expect(find.text('Disconnect IndiaMART?'), findsOneWidget);
      await _sheet(t, 'Not now');
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/lead-sources/s1'), 0);
      await _tapText(t, 'Disconnect');
      await _sheet(t, 'Disconnect IndiaMART');
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/lead-sources/s1'), 1);
    });

    testWidgets('connecting sends the key and where leads go, never an identity', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.method == 'POST' && o.uri.path == '/api/whatsapp/lead-sources') return (200, {'source': {'id': 's1'}});
        return _ok(o, b, sources: _sources(indiaMart: false));
      });
      await pumpScreen(t, LeadSourcesScreen(session: session));
      await _tapText(t, 'Connect IndiaMART');
      await _tapText(t, 'Save IndiaMART');
      expect(find.text('Paste your IndiaMART CRM key'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/lead-sources'), 0);
      await _type(t, 'IndiaMART CRM key', ' K-123 ');
      await _tapText(t, 'First open stage');
      await _sheet(t, 'Quoted');
      await _tapText(t, 'VIP');
      await _tapText(t, 'Save IndiaMART');
      final body = requestsOf(sent, 'POST', '/api/whatsapp/lead-sources').single.data as Map;
      expect(body, {'kind': 'indiamart', 'key': 'K-123', 'stage_id': 'st2', 'assign_to': null, 'label_ids': ['b1']});
      expectNoIdentity(body);
    });
  });

  group('tracked links', () {
    testWidgets('Create link starts from the suggested number and posts the form', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.method == 'POST' && o.uri.path == '/api/whatsapp/lead-sources/links') return (201, {'link': {'id': 'k2'}});
        return _ok(o, b);
      });
      await pumpScreen(t, LeadSourcesScreen(session: session));
      await _tapText(t, 'Add link');
      await _tapText(t, 'Create link');
      expect(find.text('Enter a name for the link'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/lead-sources/links'), 0);
      await _type(t, 'Name', ' Shop window ');
      await _type(t, 'Message they send', 'Hello');
      await _tapText(t, 'Create link');
      final body = requestsOf(sent, 'POST', '/api/whatsapp/lead-sources/links').single.data as Map;
      expect(body, {'name': 'Shop window', 'phone': '919876543210', 'prefill_text': 'Hello', 'stage_id': null, 'assign_to': null, 'label_ids': <String>[]});
      expectNoIdentity(body);
      expect(requestCount(sent, 'GET', '/api/whatsapp/lead-sources/links'), 2);
    });

    testWidgets('Archive asks first, then archives only that link', (t) async {
      final (session, sent) = recordedSession((o, b) => _ok(o, b));
      await pumpScreen(t, LeadSourcesScreen(session: session));
      await _tapText(t, 'Archive');
      expect(find.text('Archive Diwali poster?'), findsOneWidget);
      await _sheet(t, 'Not now');
      expect(requestCount(sent, 'PATCH', '/api/whatsapp/lead-sources/links/k1'), 0);
      await _tapText(t, 'Archive');
      await _sheet(t, 'Archive link');
      expect(requestsOf(sent, 'PATCH', '/api/whatsapp/lead-sources/links/k1').single.data, {'archived': true});
    });

    testWidgets('Copy link and Copy website button put the right text on the clipboard', (t) async {
      final copied = <String>[];
      t.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') copied.add((call.arguments as Map)['text'] as String);
        return null;
      });
      addTearDown(() => t.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      final (session, _) = recordedSession((o, b) => _ok(o, b));
      await pumpScreen(t, LeadSourcesScreen(session: session));
      await _tapText(t, 'Copy link');
      await _tapText(t, 'Copy website button');
      expect(copied, ['https://khatario.com/w/K7Q2MX', '<script src="https://khatario.com/api/public/wa-widget/K7Q2MX" async></script>']);
    });
  });

  group('webhooks', () {
    testWidgets('creating one shows its URL once, and nothing sends an identity', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.method == 'POST' && o.uri.path == '/api/whatsapp/lead-sources') return (201, {'source': {'id': 's3'}, 'url': 'https://khatario.com/api/webhooks/leads/tok123'});
        return _ok(o, b);
      });
      await pumpScreen(t, LeadSourcesScreen(session: session));
      await _tapText(t, 'Add webhook');
      await _type(t, 'Name', ' Website form ');
      await _tapText(t, 'Create webhook URL');
      final body = requestsOf(sent, 'POST', '/api/whatsapp/lead-sources').single.data as Map;
      expect(body, {'kind': 'webhook', 'name': 'Website form', 'stage_id': null, 'assign_to': null, 'label_ids': <String>[]});
      expectNoIdentity(body);
      expect(find.text('Copy this URL now'), findsOneWidget);
      expect(find.text('https://khatario.com/api/webhooks/leads/tok123'), findsOneWidget);
    });

    testWidgets('Delete asks first, naming the webhook, then deletes only it', (t) async {
      final (session, sent) = recordedSession((o, b) => _ok(o, b));
      await pumpScreen(t, LeadSourcesScreen(session: session));
      await t.ensureVisible(_icon('Delete webhook'));
      await t.tap(_icon('Delete webhook'));
      await t.pumpAndSettle();
      expect(find.text('Delete JustDial via Zapier?'), findsOneWidget);
      await _sheet(t, 'Not now');
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/lead-sources/s2'), 0);
      await t.tap(_icon('Delete webhook'));
      await t.pumpAndSettle();
      await _sheet(t, 'Delete webhook');
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/lead-sources/s2'), 1);
    });
  });
}
