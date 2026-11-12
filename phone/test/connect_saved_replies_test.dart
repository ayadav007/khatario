import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/audience_logic.dart' show savedRepliesPath;
import 'package:khatario_phone/screens/chats/chat_thread_screen.dart';
import 'package:khatario_phone/screens/chats/flows_logic.dart';
import 'package:khatario_phone/screens/settings/more_settings.dart';
import 'package:khatario_phone/screens/chats/saved_replies_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _reply(String id, String title, {String? shortcut, String message = 'Thanks, we got it.', String category = 'general'}) =>
    {'id': id, 'title': title, 'shortcut': shortcut, 'message': message, 'category': category};

final _replies = [
  _reply('r1', 'Payment received', shortcut: 'pay', message: 'Your payment is received. Thank you!', category: 'payments'),
  _reply('r2', 'Hello', shortcut: null, message: 'Namaste! How can we help?', category: 'greetings'),
  _reply('r3', 'Order packed', shortcut: 'packed', message: 'Your order is packed.', category: 'orders'),
];

Reply _handler(RequestOptions o, Map b) {
  if (o.uri.path == '/api/whatsapp/saved-replies' && o.method == 'GET') return (200, {'replies': _replies});
  return (200, <String, dynamic>{});
}

Finder _icon(String label) => find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == label);

Future<void> _type(WidgetTester t, String label, String text) async {
  final f = find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first, matching: find.byType(TextField)).first;
  await t.ensureVisible(f);
  await t.enterText(f, text);
  await t.pump();
}

void main() {
  group('saved reply logic', () {
    test('rows, labels and the grouped list follow the website', () {
      final rows = savedReplies({'replies': _replies});
      expect(rows.map((r) => r.title), ['Payment received', 'Hello', 'Order packed']);
      expect(rows.first.shortcut, 'pay');
      expect(rows[1].shortcut, isNull);
      expect(savedReplies({'replies': [{'title': 'no id'}]}), isEmpty);
      expect(savedReplyCategoryLabel('payments'), 'Payments');
      expect(savedReplyCategories, ['general', 'orders', 'payments', 'delivery', 'support', 'greetings']);
      final groups = groupSavedReplies(rows);
      expect(groups.map((g) => g.$1), ['payments', 'greetings', 'orders']);
      expect(groups.first.$2.single.title, 'Payment received');
    });

    test('search looks in title, shortcut and message; the category narrows it', () {
      final rows = savedReplies({'replies': _replies});
      expect(filterSavedReplies(rows, 'PACKED', '').map((r) => r.id), ['r3']);
      expect(filterSavedReplies(rows, 'namaste', '').map((r) => r.id), ['r2']);
      expect(filterSavedReplies(rows, 'pay', '').map((r) => r.id), ['r1']);
      expect(filterSavedReplies(rows, '', 'orders').map((r) => r.id), ['r3']);
      expect(filterSavedReplies(rows, 'pay', 'orders'), isEmpty);
      expect(filterSavedReplies(rows, '  ', '').length, 3);
    });

    test('the form needs a title and a message; the body has no owner id', () {
      expect(savedReplyError('', 'x'), 'Title and message are required.');
      expect(savedReplyError('x', '  '), 'Title and message are required.');
      expect(savedReplyError('x', 'y'), isNull);
      expect(
        savedReplyBody(title: ' Hi ', shortcut: ' hi ', message: ' Hello ', category: 'greetings'),
        {'title': 'Hi', 'shortcut': 'hi', 'message': 'Hello', 'category': 'greetings'},
      );
      expect(savedReplyPath('a b'), '/api/whatsapp/saved-replies/a%20b');
      expect(savedRepliesPath, '/api/whatsapp/saved-replies');
    });
  });

  group('saved replies screen', () {
    testWidgets('lists the replies grouped by category and sends no identity', (t) async {
      final (session, sent) = recordedSession(_handler);
      await pumpScreen(t, SavedRepliesScreen(session: session));
      expect(find.text('Payment received'), findsOneWidget);
      expect(find.text('/pay'), findsOneWidget);
      expect(find.text('PAYMENTS (1)'), findsOneWidget);
      expect(find.text('GREETINGS (1)'), findsOneWidget);
      for (final o in sent) {
        expect(o.uri.query.contains('business_id'), isFalse);
      }
    });

    testWidgets('search and the category chips narrow the list without another request', (t) async {
      final (session, sent) = recordedSession(_handler);
      await pumpScreen(t, SavedRepliesScreen(session: session));
      await t.enterText(find.byType(TextField).first, 'packed');
      await t.pumpAndSettle();
      expect(find.text('Order packed'), findsOneWidget);
      expect(find.text('Hello'), findsNothing);
      await t.enterText(find.byType(TextField).first, 'zzz');
      await t.pumpAndSettle();
      expect(find.text('No results.'), findsOneWidget);
      await t.enterText(find.byType(TextField).first, '');
      await t.pumpAndSettle();
      await t.ensureVisible(find.text('Greetings'));
      await t.tap(find.text('Greetings'));
      await t.pumpAndSettle();
      expect(find.text('Hello'), findsOneWidget);
      expect(find.text('Order packed'), findsNothing);
      expect(requestCount(sent, 'GET', '/api/whatsapp/saved-replies'), 1);
    });

    testWidgets('empty, server error with Try again, and not in the plan', (t) async {
      final (empty, _) = recordedSession((o, b) => (200, {'replies': []}));
      await pumpScreen(t, SavedRepliesScreen(session: empty));
      expect(find.text('No saved replies yet'), findsOneWidget);

      var fail = true;
      final (flaky, sent) = recordedSession((o, b) => fail ? (500, {'error': 'Boom'}) : _handler(o, b));
      await pumpScreen(t, SavedRepliesScreen(session: flaky));
      expect(find.text('Could not load saved replies'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Hello'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/saved-replies'), 2);

      final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, SavedRepliesScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(_icon('New reply'), findsNothing);
    });

    testWidgets('New reply checks the fields, then posts title, shortcut, message and category once', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.method == 'POST') return (201, {'reply': _reply('n1', 'Thanks')});
        return _handler(o, b);
      });
      await pumpScreen(t, SavedRepliesScreen(session: session));
      await t.tap(_icon('New reply'));
      await t.pumpAndSettle();
      await t.tap(find.text('Save reply'));
      await t.pumpAndSettle();
      expect(find.text('Title and message are required.'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/saved-replies'), 0);

      await _type(t, 'Title', 'Thanks');
      await _type(t, 'Shortcut (optional)', 'thx');
      await _type(t, 'Message', 'Thank you for shopping');
      await t.tap(find.text('Save reply'));
      await t.tap(find.text('Save reply'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/whatsapp/saved-replies'), 1);
      final body = lastBody(sent, 'POST', '/api/whatsapp/saved-replies');
      expect(body, {'title': 'Thanks', 'shortcut': 'thx', 'message': 'Thank you for shopping', 'category': 'general'});
      expectNoIdentity(body);
      expect(requestCount(sent, 'GET', '/api/whatsapp/saved-replies'), 2);
    });

    testWidgets('a taken title shows the server reason and stays on the form', (t) async {
      final (session, _) = recordedSession((o, b) {
        if (o.method == 'POST') return (409, {'error': 'A saved reply with that title already exists.'});
        return _handler(o, b);
      });
      await pumpScreen(t, SavedRepliesScreen(session: session));
      await t.tap(_icon('New reply'));
      await t.pumpAndSettle();
      await _type(t, 'Title', 'Hello');
      await _type(t, 'Message', 'Hi');
      await t.tap(find.text('Save reply'));
      await t.pumpAndSettle();
      expect(find.text('A saved reply with that title already exists.'), findsOneWidget);
      expect(find.text('Save reply'), findsOneWidget);
    });

    testWidgets('Edit fills the form and patches that reply', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.method == 'PATCH') return (200, {'reply': _reply('r3', 'Order packed!')});
        return _handler(o, b);
      });
      await pumpScreen(t, SavedRepliesScreen(session: session));
      await t.tap(find.text('Order packed'));
      await t.pumpAndSettle();
      expect(find.text('Edit reply'), findsOneWidget);
      expect(find.text('Your order is packed.'), findsOneWidget);
      await _type(t, 'Title', 'Order packed!');
      await t.tap(find.text('Save reply'));
      await t.pumpAndSettle();
      final body = lastBody(sent, 'PATCH', '/api/whatsapp/saved-replies/r3');
      expect(body, {'title': 'Order packed!', 'shortcut': 'packed', 'message': 'Your order is packed.', 'category': 'orders'});
      expectNoIdentity(body);
    });

    testWidgets('Delete asks naming the reply, deletes once, then reloads', (t) async {
      final (session, sent) = recordedSession(_handler);
      await pumpScreen(t, SavedRepliesScreen(session: session));
      await t.tap(_icon('Delete reply').first);
      await t.pumpAndSettle();
      expect(find.textContaining('Payment received'), findsWidgets);
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/saved-replies/r1'), 0);
      await t.tap(inSheet('Delete reply'));
      await t.tap(inSheet('Delete reply'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/saved-replies/r1'), 1);
      expect(requestCount(sent, 'GET', '/api/whatsapp/saved-replies'), 2);
    });

    testWidgets('a refused delete says why', (t) async {
      final (session, _) = recordedSession((o, b) => o.method == 'DELETE' ? (403, {'error': 'No permission to manage WhatsApp'}) : _handler(o, b));
      await pumpScreen(t, SavedRepliesScreen(session: session));
      await t.tap(_icon('Delete reply').first);
      await t.pumpAndSettle();
      await t.tap(inSheet('Delete reply'));
      await t.pumpAndSettle();
      expect(find.text('No permission to manage WhatsApp'), findsOneWidget);
    });
  });


  group('ways in', () {
    testWidgets('Settings > WhatsApp has a Saved replies row next to Inbox & team that opens the screen', (t) async {
      final (session, _) = recordedSession(_handler);
      await pumpScreen(t, MessagingSettingsScreen(session: session));
      expect(find.text('Inbox & team'), findsOneWidget);
      await t.ensureVisible(find.text('Saved replies'));
      await t.tap(find.text('Saved replies'));
      await t.pumpAndSettle();
      expect(find.byType(SavedRepliesScreen), findsOneWidget);
    });

    testWidgets('the chat composer sheet has a Manage link that opens Saved replies', (t) async {
      final (session, _) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/conversations/c1/messages') {
          return (200, {
            'messages': [
              {'id': '1', 'message_id': 'm1', 'message_text': 'Hi', 'direction': 'incoming', 'created_at': '2026-10-14T01:00:00Z'},
            ],
            'ownership': {'can_reply': true, 'can_intervene': false},
            'window': {'open': true},
          });
        }
        return _handler(o, b);
      });
      await pumpScreen(t, ChatThreadScreen(session: session, conversationId: 'c1', title: 'Ravi'));
      expect(find.byTooltip('Send'), findsOneWidget, reason: 'the send arrow has a label for screen readers');
      await t.tap(find.byTooltip('Saved replies'));
      await t.pumpAndSettle();
      await t.tap(inSheet('Manage'));
      await t.pumpAndSettle();
      expect(find.byType(SavedRepliesScreen), findsOneWidget);
    });
  });

  test('the saved replies link has its screen', () {
    final (session, _) = recordedSession((o, b) => (200, <String, dynamic>{}));
    expect(nativeScreenFor(session, '/whatsapp/saved-replies'), isA<SavedRepliesScreen>());
  });
}
