import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/send_message_screen.dart';
import 'package:khatario_phone/screens/chats/who_to_message_screen.dart';

import 'support/recorded_session.dart';

const _people = {
  'condition': 'quiet',
  'people': [
    {'phone': '919876543210', 'name': 'Ravi Traders', 'reason': 'Last bill 3 Oct 2026'},
    {'phone': '919876543211', 'name': 'Asha Stores', 'reason': 'Last bill 9 Oct 2026'},
    {'phone': '919876543212', 'name': 'Meena', 'reason': 'Last bill 12 Oct 2026'},
  ],
};

const _replies = {
  'replies': [
    {'id': 'r1', 'title': 'Diwali offer', 'message': 'Happy Diwali, 10% off this week.'},
  ],
};

Reply _handler(RequestOptions o, Map b) {
  if (o.uri.path == '/api/whatsapp/who-to-message') return (200, _people);
  if (o.uri.path == '/api/whatsapp/saved-replies') return (200, _replies);
  if (o.uri.path == '/api/whatsapp/status') return (200, {'status': 'connected'});
  return (200, <String, dynamic>{});
}

Future<void> _tapText(WidgetTester t, String text, {bool last = false}) async {
  final f = last ? find.text(text).last : find.text(text).first;
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pumpAndSettle();
}

Map<String, String> _lastWho(List<RequestOptions> sent) => requestsOf(sent, 'GET', '/api/whatsapp/who-to-message').last.uri.queryParameters;

void main() {
  testWidgets('opens on the quiet list, asks for exactly what that list uses, lists people with the reason', (t) async {
    final (session, sent) = recordedSession(_handler);
    await pumpScreen(t, WhoToMessageScreen(session: session));
    expect(_lastWho(sent), {'condition': 'quiet', 'days': '30'});
    expect(find.text('Ravi Traders'), findsOneWidget);
    expect(find.textContaining('Last bill 3 Oct 2026'), findsOneWidget);
    expect(find.text('Bought before, then went quiet'), findsOneWidget);
    for (final o in sent) {
      expect(o.uri.query.contains('business_id'), isFalse);
    }
  });

  testWidgets('another list and another number of days reload the people', (t) async {
    final (session, sent) = recordedSession(_handler);
    await pumpScreen(t, WhoToMessageScreen(session: session));
    await _tapText(t, '60 days');
    expect(_lastWho(sent), {'condition': 'quiet', 'days': '60'});
    await _tapText(t, 'Top buyers');
    expect(_lastWho(sent), {'condition': 'top', 'period_days': '30', 'limit': '10'});
    await _tapText(t, '90d');
    expect(_lastWho(sent), {'condition': 'top', 'period_days': '90', 'limit': '10'});
    await _tapText(t, 'Bought only once');
    expect(_lastWho(sent), {'condition': 'once'});
  });

  testWidgets('a day count outside 1 to 365 is refused before asking', (t) async {
    final (session, sent) = recordedSession(_handler);
    await pumpScreen(t, WhoToMessageScreen(session: session));
    final before = requestCount(sent, 'GET', '/api/whatsapp/who-to-message');
    await t.enterText(find.widgetWithText(TextField, '30'), '0');
    await t.pump(const Duration(milliseconds: 700));
    await t.pumpAndSettle();
    expect(find.text('Days must be a whole number from 1 to 365'), findsOneWidget);
    expect(requestCount(sent, 'GET', '/api/whatsapp/who-to-message'), before);
    await t.enterText(find.widgetWithText(TextField, '0'), '45');
    await t.pump(const Duration(milliseconds: 700));
    await t.pumpAndSettle();
    expect(_lastWho(sent), {'condition': 'quiet', 'days': '45'});
  });

  testWidgets('tick people, pick a saved reply, Continue opens the campaign tab with them', (t) async {
    final (session, sent) = recordedSession(_handler);
    await pumpScreen(t, WhoToMessageScreen(session: session));
    expect(find.text('Continue with 0 people'), findsNothing);
    await _tapText(t, 'Ravi Traders');
    await _tapText(t, 'Meena');
    expect(find.text('Continue with 2 people'), findsOneWidget);
    await _tapText(t, 'Write the message on the next screen');
    await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Diwali offer')));
    await t.pumpAndSettle();
    await t.tap(find.text('Continue with 2 people'));
    await t.pumpAndSettle();
    final screen = t.widget(find.byType(SendMessageScreen)) as SendMessageScreen;
    expect(screen.draft!.recipients.map((r) => r.phone), ['919876543210', '919876543212']);
    expect(screen.draft!.recipients.first.name, 'Ravi Traders');
    expect(screen.draft!.text, 'Happy Diwali, 10% off this week.');
    expect(screen.draft!.campaignName, 'Has not bought in a while');
    expect(find.widgetWithText(TextField, 'Has not bought in a while'), findsOneWidget);
    expect(find.text('2 recipients'), findsOneWidget);
    expect(requestsOf(sent, 'POST', '/api/whatsapp/campaigns'), isEmpty);
  });

  testWidgets('Select everyone ticks and clears the whole list', (t) async {
    final (session, _) = recordedSession(_handler);
    await pumpScreen(t, WhoToMessageScreen(session: session));
    await _tapText(t, 'Select everyone');
    expect(find.text('Continue with 3 people'), findsOneWidget);
    await _tapText(t, 'Clear selection');
    expect(find.text('Continue with 3 people'), findsNothing);
  });

  testWidgets('changing the list clears the ticks', (t) async {
    final (session, _) = recordedSession(_handler);
    await pumpScreen(t, WhoToMessageScreen(session: session));
    await _tapText(t, 'Ravi Traders');
    expect(find.text('Continue with 1 person'), findsOneWidget);
    await _tapText(t, 'Bought only once');
    expect(find.text('Continue with 1 person'), findsNothing);
  });

  testWidgets('empty list, server error with Try again, and a plan without Connect', (t) async {
    final (empty, _) = recordedSession((o, b) => o.uri.path == '/api/whatsapp/who-to-message' ? (200, {'condition': 'quiet', 'people': []}) : _handler(o, b));
    await pumpScreen(t, WhoToMessageScreen(session: empty));
    expect(find.textContaining('No one matches'), findsOneWidget);

    var fail = true;
    final (session, sent) = recordedSession((o, b) => fail && o.uri.path == '/api/whatsapp/who-to-message' ? (400, {'error': 'Unknown list'}) : _handler(o, b));
    await pumpScreen(t, WhoToMessageScreen(session: session));
    expect(find.text('Unknown list'), findsOneWidget);
    fail = false;
    await t.tap(find.text('Try again'));
    await t.pumpAndSettle();
    expect(find.text('Ravi Traders'), findsOneWidget);
    expect(requestCount(sent, 'GET', '/api/whatsapp/who-to-message'), 2);

    final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
    await pumpScreen(t, WhoToMessageScreen(session: locked));
    expect(find.text('Not included in your current plan'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
  });

  testWidgets('saved replies that cannot load leave the choice at writing it on the next screen', (t) async {
    final (session, _) = recordedSession((o, b) => o.uri.path == '/api/whatsapp/saved-replies' ? (400, {'error': 'nope'}) : _handler(o, b));
    await pumpScreen(t, WhoToMessageScreen(session: session));
    expect(find.text('Ravi Traders'), findsOneWidget);
    expect(find.text('Write the message on the next screen'), findsOneWidget);
  });
}
