import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/capability.dart';
import 'package:khatario_phone/screens/chats/audience_logic.dart';
import 'package:khatario_phone/screens/chats/campaigns_logic.dart';
import 'package:khatario_phone/screens/chats/contacts_screen.dart';
import 'package:khatario_phone/screens/chats/send_message_screen.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _contact({String id = 'c1', String name = 'Ravi Traders', String phone = '919876543210'}) =>
    {'id': id, 'phone': phone, 'name': name, 'tags': <String>[], 'source': 'manual', 'groups': <Map<String, dynamic>>[]};

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

Reply _handler(RequestOptions o, Map b, {String status = 'connected', Map<String, dynamic>? sendReply, Map<String, dynamic>? campaignReply}) {
  final p = o.uri.path;
  if (p == '/api/whatsapp/status') return (200, {'status': status});
  if (p == '/api/whatsapp/send' && o.method == 'POST') return (200, sendReply ?? {'success': true});
  if (p == '/api/whatsapp/campaigns' && o.method == 'POST') {
    return (200, campaignReply ?? {'success': true, 'campaign_id': 'k1', 'total_recipients': 2, 'unsubscribed_count': 0, 'status': 'running', 'auto_started': true});
  }
  if (p == '/api/whatsapp/contacts' && o.method == 'GET') {
    return (200, {'contacts': [_contact(), _contact(id: 'c2', name: 'Asha', phone: '919876543211')], 'pagination': {'total': 2}});
  }
  if (p == '/api/whatsapp/contact-groups' && o.method == 'GET') {
    return (200, {'groups': [{'id': 'g1', 'name': 'VIP', 'color': '#25D366', 'member_count': '2'}, {'id': 'g2', 'name': 'Wholesale', 'color': '#25D366', 'member_count': '1'}]});
  }
  if (p == '/api/whatsapp/contact-groups/g1/members') {
    return (200, {'members': [_contact(), _contact(id: 'c2', name: 'Asha', phone: '919876543211')], 'total': 2});
  }
  if (p == '/api/whatsapp/contact-groups/g2/members') {
    return (200, {'members': [_contact(id: 'c2', name: 'Asha', phone: '919876543211'), _contact(id: 'c3', name: 'Meena', phone: '919876543212')], 'total': 2});
  }
  if (p == '/api/whatsapp/unsubscribes') return (200, {'unsubscribed': ['919876543210'], 'counts': {'total': 1, 'unsubscribed': 1, 'subscribed': 0}});
  return (200, <String, dynamic>{});
}

void main() {
  group('single message', () {
    testWidgets('asks with the number and the words, posts once, shows the result and clears', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b));
      await pumpScreen(t, SendMessageScreen(session: session));
      await _type(t, 'Phone number (with country code)', '+91 98765-43210');
      await _type(t, 'Message', 'Hello there');
      await _tapText(t, 'Send message');
      expect(inSheet('Send message?'), findsOneWidget);
      expect(find.textContaining('+91 98765 43210'), findsWidgets);
      expect(find.textContaining('Hello there'), findsWidgets);
      expect(requestCount(sent, 'POST', '/api/whatsapp/send'), 0);
      await t.tap(inSheet('Send'));
      await t.tap(inSheet('Send'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/whatsapp/send').toList();
      expect(posts.length, 1);
      expect(posts.single.data, {'to': '919876543210', 'message': 'Hello there', 'message_type': 'text'});
      expectNoIdentity(posts.single.data as Map);
      expect(find.text('Message sent successfully!'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Hello there'), findsNothing);
    });

    testWidgets('a missing number or message is refused before asking or posting', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b));
      await pumpScreen(t, SendMessageScreen(session: session));
      await _tapText(t, 'Send message');
      expect(find.text('Please enter a phone number'), findsOneWidget);
      await _type(t, 'Phone number (with country code)', '919876543210');
      await _tapText(t, 'Send message');
      expect(find.text('Please enter a message'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/send'), 0);
      expect(find.byType(BottomSheet), findsNothing);
    });

    testWidgets('a refusal from the server shows its words and keeps what was typed', (t) async {
      final (session, sent) = recordedSession((o, b) => o.uri.path == '/api/whatsapp/send' ? (409, {'error': 'This customer has not written in the last 24 hours. Start the chat with an approved template.', 'code': 'WINDOW_CLOSED'}) : _handler(o, b));
      await pumpScreen(t, SendMessageScreen(session: session));
      await _type(t, 'Phone number (with country code)', '919876543210');
      await _type(t, 'Message', 'Hello there');
      await _tapText(t, 'Send message');
      await t.tap(inSheet('Send'));
      await t.pumpAndSettle();
      expect(find.textContaining('has not written in the last 24 hours'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Hello there'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/send'), 1);
    });

    testWidgets('Buttons adds quick replies and call-to-action buttons to the body', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b));
      await pumpScreen(t, SendMessageScreen(session: session));
      await _tapText(t, 'Buttons');
      await _type(t, 'Phone number (with country code)', '919876543210');
      await _type(t, 'Message', 'Do you want it?');
      await _tapText(t, 'Add quick reply');
      await _type(t, 'Quick reply 1', 'Yes');
      await _type(t, 'Call button title', 'Call us');
      await _type(t, 'Call button number', '919800000000');
      await _type(t, 'Footer (optional)', 'Thanks');
      await _tapText(t, 'Send message');
      await t.tap(inSheet('Send'));
      await t.pumpAndSettle();
      final body = requestsOf(sent, 'POST', '/api/whatsapp/send').single.data as Map;
      expect(body['message_type'], 'button');
      expect(body['footer'], 'Thanks');
      expect((body['buttons'] as Map)['quickReplies'], ['Yes']);
      expect((body['buttons'] as Map)['callToActions'], {'phone': {'title': 'Call us', 'phone': '919800000000'}});
    });

    testWidgets('Buttons without any button is refused in the website words', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b));
      await pumpScreen(t, SendMessageScreen(session: session));
      await _tapText(t, 'Buttons');
      await _type(t, 'Phone number (with country code)', '919876543210');
      await _type(t, 'Message', 'Hi');
      await _tapText(t, 'Send message');
      expect(find.text('Please add at least one Quick Reply or Call to Action button'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/send'), 0);
    });

    testWidgets('Image is one of the three message types', (t) async {
      final (session, _) = recordedSession((o, b) => _handler(o, b));
      await pumpScreen(t, SendMessageScreen(session: session));
      expect(find.text('Image'), findsOneWidget);
    });

    testWidgets('a number handed in from a contact is filled in', (t) async {
      final (session, _) = recordedSession((o, b) => _handler(o, b));
      await pumpScreen(t, SendMessageScreen(session: session, phone: '919876543210'));
      expect(find.widgetWithText(TextField, '919876543210'), findsOneWidget);
    });

    testWidgets('a plan without Send message shows the locked card and no form', (t) async {
      final (session, _) = recordedSession((o, b) => _handler(o, b));
      const caps = Capabilities(
        sessionIsPrimaryAdmin: true,
        sessionPermissions: {},
        snapshot: CapabilitySnapshot(permissions: {}, isPrimaryAdmin: true, enabledFeatures: []),
      );
      await pumpScreen(t, SendMessageScreen(session: session, capabilities: caps));
      expect(find.text('Send message is locked'), findsOneWidget);
      expect(find.text('Phone number (with country code)'), findsNothing);
    });
  });

  group('bulk campaign', () {
    Future<void> open(WidgetTester t, RecordedHandler handler, {SendDraft? draft, DateTime? clock}) async {
      final (session, sent) = recordedSession(handler);
      _sent = sent;
      await pumpScreen(t, SendMessageScreen(session: session, draft: draft, clock: clock));
      if (draft == null) await _tapText(t, 'Bulk campaign');
    }

    testWidgets('asks with the recipient count and message, posts once, and reports the result', (t) async {
      await open(t, (o, b) => _handler(o, b));
      await _type(t, 'Campaign name', 'Diwali offer');
      await _type(t, 'Message', 'Happy Diwali!');
      await _type(t, 'Phone numbers (one per line)', '+919876543210\n9876543211, Asha\nbad');
      expect(find.text('2 recipients'), findsOneWidget);
      await _tapText(t, 'Create campaign');
      expect(inSheet('Start campaign?'), findsOneWidget);
      expect(find.textContaining('2 people'), findsWidgets);
      expect(find.textContaining('Happy Diwali!'), findsWidgets);
      expect(requestCount(_sent, 'POST', '/api/whatsapp/campaigns'), 0);
      await t.tap(inSheet('Start campaign'));
      await t.tap(inSheet('Start campaign'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(_sent, 'POST', '/api/whatsapp/campaigns').toList();
      expect(posts.length, 1);
      final body = posts.single.data as Map;
      expect(body['name'], 'Diwali offer');
      expect(body['message_type'], 'text');
      expect(body['recipients'], [
        {'phone': '919876543210'},
        {'phone': '9876543211', 'name': 'Asha'},
      ]);
      expect(body['delay_between_messages'], 2);
      expect(body['scheduled_at'], isNull);
      expectNoIdentity(body);
      expect(find.text('Campaign started. 2 people will get it.'), findsOneWidget);
    });

    testWidgets('a missing name, message or recipient is refused first, in the website words', (t) async {
      await open(t, (o, b) => _handler(o, b));
      await _tapText(t, 'Create campaign');
      expect(find.text('Campaign name is required'), findsOneWidget);
      await _type(t, 'Campaign name', 'n');
      await _tapText(t, 'Create campaign');
      expect(find.text('Message text is required'), findsOneWidget);
      await _type(t, 'Message', 'm');
      await _tapText(t, 'Create campaign');
      expect(find.text('Please add at least one recipient'), findsOneWidget);
      expect(requestCount(_sent, 'POST', '/api/whatsapp/campaigns'), 0);
      expect(find.byType(BottomSheet), findsNothing);
    });

    testWidgets('opted-out numbers left out by the server are reported; a refusal keeps the form', (t) async {
      await open(t, (o, b) => _handler(o, b, campaignReply: {'total_recipients': 1, 'unsubscribed_count': 1, 'status': 'running', 'auto_started': true}));
      await _type(t, 'Campaign name', 'n');
      await _type(t, 'Message', 'm');
      await _type(t, 'Phone numbers (one per line)', '919876543210\n919876543211');
      await _tapText(t, 'Create campaign');
      await t.tap(inSheet('Start campaign'));
      await t.pumpAndSettle();
      expect(find.text('Campaign started. 1 person will get it. 1 who opted out was left out.'), findsOneWidget);

      await open(t, (o, b) => o.uri.path == '/api/whatsapp/campaigns' && o.method == 'POST' ? (400, {'error': 'All recipients have unsubscribed'}) : _handler(o, b));
      await _type(t, 'Campaign name', 'n');
      await _type(t, 'Message', 'm');
      await _type(t, 'Phone numbers (one per line)', '919876543210');
      await _tapText(t, 'Create campaign');
      await t.tap(inSheet('Start campaign'));
      await t.pumpAndSettle();
      expect(find.text('All recipients have unsubscribed'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'n'), findsOneWidget);
    });

    testWidgets('Add from contacts fills the recipients and warns about opted-out numbers', (t) async {
      await open(t, (o, b) => _handler(o, b));
      await _tapText(t, 'Add from contacts');
      await _tapText(t, 'Ravi Traders');
      await _tapText(t, 'Asha');
      await t.tap(find.text('Use 2 contacts'));
      await t.pumpAndSettle();
      expect(find.text('2 recipients'), findsOneWidget);
      final check = requestsOf(_sent, 'GET', '/api/whatsapp/unsubscribes').single;
      expect(check.uri.queryParameters['check_phones'], '919876543210,919876543211');
      expect(find.textContaining('1 of these numbers opted out'), findsOneWidget);
    });

    testWidgets('Add from groups loads each group once and merges the numbers', (t) async {
      await open(t, (o, b) => _handler(o, b));
      await _tapText(t, 'Add from groups');
      await _tapText(t, 'VIP');
      await _tapText(t, 'Wholesale');
      await t.tap(find.text('Use 2 groups'));
      await t.pumpAndSettle();
      expect(requestCount(_sent, 'GET', '/api/whatsapp/contact-groups/g1/members'), 1);
      expect(requestCount(_sent, 'GET', '/api/whatsapp/contact-groups/g2/members'), 1);
      expect(find.text('3 recipients'), findsOneWidget);
    });

    testWidgets('Buttons in a campaign become a buttons list with ids', (t) async {
      await open(t, (o, b) => _handler(o, b));
      await _tapText(t, 'Buttons', last: false);
      await _type(t, 'Campaign name', 'n');
      await _type(t, 'Message', 'm');
      await _tapText(t, 'Add quick reply');
      await _type(t, 'Quick reply 1', 'Yes please');
      await _type(t, 'Phone numbers (one per line)', '919876543210');
      await _tapText(t, 'Create campaign');
      await t.tap(inSheet('Start campaign'));
      await t.pumpAndSettle();
      final body = requestsOf(_sent, 'POST', '/api/whatsapp/campaigns').single.data as Map;
      expect(body['message_type'], 'button');
      expect(body['buttons'], [
        {'type': 'quick_reply', 'id': 'yes_please', 'title': 'Yes please'},
      ]);
    });

    testWidgets('a campaign button without any button is refused', (t) async {
      await open(t, (o, b) => _handler(o, b));
      await _tapText(t, 'Buttons');
      await _type(t, 'Campaign name', 'n');
      await _type(t, 'Message', 'm');
      await _type(t, 'Phone numbers (one per line)', '919876543210');
      await _tapText(t, 'Create campaign');
      expect(find.text('Please add at least one quick reply or call-to-action'), findsOneWidget);
    });

    testWidgets('sending speed shows the website defaults and an estimate; a bad value is refused', (t) async {
      await open(t, (o, b) => _handler(o, b));
      expect(find.widgetWithText(TextField, '2'), findsWidgets);
      expect(find.widgetWithText(TextField, '120'), findsOneWidget);
      await _type(t, 'Phone numbers (one per line)', '919876543210');
      expect(find.textContaining('Estimated sending time'), findsOneWidget);
      await _type(t, 'Campaign name', 'n');
      await _type(t, 'Message', 'm');
      await _type(t, 'Batch size (messages per batch)', '0');
      await _tapText(t, 'Create campaign');
      expect(find.text('Batch size must be at least 1'), findsOneWidget);
      expect(requestCount(_sent, 'POST', '/api/whatsapp/campaigns'), 0);
    });

    testWidgets('Schedule asks for a date and a time, then says when it goes', (t) async {
      // A clock far in the past makes "tomorrow" true at any hour of the real day.
      await open(t, (o, b) => _handler(o, b, campaignReply: {'total_recipients': 1, 'unsubscribed_count': 0, 'status': 'draft', 'auto_started': false}), clock: DateTime(2020, 1, 1));
      await _type(t, 'Campaign name', 'n');
      await _type(t, 'Message', 'm');
      await _type(t, 'Phone numbers (one per line)', '919876543210');
      await _tapText(t, 'Schedule for later');
      expect(find.text('Schedule campaign'), findsOneWidget);
      await _tapText(t, 'Schedule campaign');
      expect(find.text('Choose a date and time'), findsOneWidget);
      await _tapText(t, 'Select date');
      await t.tap(find.text('OK'));
      await t.pumpAndSettle();
      await _tapText(t, 'Select');
      final slot = find.descendant(of: find.byType(BottomSheet), matching: find.text('11:30 PM'));
      await t.ensureVisible(slot);
      await t.tap(slot);
      await t.pumpAndSettle();
      await _tapText(t, 'Schedule campaign');
      expect(inSheet('Schedule campaign?'), findsOneWidget);
      await t.tap(inSheet('Schedule'));
      await t.pumpAndSettle();
      final body = requestsOf(_sent, 'POST', '/api/whatsapp/campaigns').single.data as Map;
      expect((body['scheduled_at'] as String).endsWith('Z'), isTrue);
      expect(find.text('Campaign scheduled for 1 person.'), findsOneWidget);
    });

    testWidgets('a draft from Who to message opens the campaign tab filled in', (t) async {
      await open(
        t,
        (o, b) => _handler(o, b),
        draft: const SendDraft(recipients: [Recipient(phone: '919876543210', name: 'Ravi'), Recipient(phone: '919876543211')], text: 'Hello', campaignName: 'Top buyers'),
      );
      expect(find.widgetWithText(TextField, 'Top buyers'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Hello'), findsOneWidget);
      expect(find.text('2 recipients'), findsOneWidget);
    });

    testWidgets('WhatsApp not connected is said up front; the campaign can still be created', (t) async {
      await open(t, (o, b) => _handler(o, b, status: 'disconnected'));
      expect(find.text('WhatsApp is not connected'), findsOneWidget);
      expect(find.textContaining('cannot be started until WhatsApp is connected'), findsOneWidget);
    });

    testWidgets('the contact detail Send message opens this screen with the number', (t) async {
      final (session, _) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/contacts' && o.method == 'GET') return (200, {'contacts': [_contact()], 'pagination': {'total': 1}});
        return _handler(o, b);
      });
      await pumpScreen(t, ContactsScreen(session: session));
      await _tapText(t, 'Ravi Traders');
      await _tapText(t, 'Send message');
      expect(find.byType(SendMessageScreen), findsOneWidget);
      expect(find.widgetWithText(TextField, '919876543210'), findsOneWidget);
    });
  });
}

typedef RecordedHandler = Reply Function(RequestOptions o, Map body);
List<RequestOptions> _sent = [];
