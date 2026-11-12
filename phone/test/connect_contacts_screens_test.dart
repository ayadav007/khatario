import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/chat_thread_screen.dart';
import 'package:khatario_phone/screens/chats/contact_groups_screen.dart';
import 'package:khatario_phone/screens/chats/contacts_screen.dart';
import 'package:khatario_phone/screens/chats/unsubscribes_screen.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _contact({String id = 'c1', String name = 'Ravi Traders', String phone = '919876543210', Map<String, dynamic> extra = const {}}) => {
      'id': id,
      'phone': phone,
      'name': name,
      'email': 'ravi@shop.in',
      'tags': ['vip', 'diwali'],
      'notes': 'Likes silk',
      'source': 'manual',
      'created_at': '2026-11-01T05:00:00.000Z',
      'groups': [
        {'id': 'g1', 'name': 'VIP', 'color': '#25D366'},
      ],
      ...extra,
    };

const _groups = {
  'groups': [
    {'id': 'g1', 'name': 'VIP', 'description': 'Best customers', 'color': '#3B82F6', 'member_count': '2'},
    {'id': 'g2', 'name': 'Wholesale', 'color': '#25D366', 'member_count': 0},
  ],
};

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

Reply _contactsHandler(RequestOptions o, Map b, {int total = 1}) {
  final p = o.uri.path;
  if (p == '/api/whatsapp/contact-groups' && o.method == 'GET') return (200, _groups);
  if (p == '/api/whatsapp/contacts' && o.method == 'GET') {
    return (200, {'contacts': [_contact()], 'pagination': {'total': total, 'limit': 20, 'offset': 0, 'hasMore': total > 1}});
  }
  return (200, <String, dynamic>{});
}

void main() {
  group('contacts list', () {
    testWidgets('lists contacts with phone, tags and group, and sends no business id', (t) async {
      final (session, sent) = recordedSession(_contactsHandler);
      await pumpScreen(t, ContactsScreen(session: session));
      expect(find.text('Ravi Traders'), findsOneWidget);
      expect(find.textContaining('+91 98765 43210'), findsOneWidget);
      expect(find.textContaining('vip'), findsWidgets);
      expect(requestsOf(sent, 'GET', '/api/whatsapp/contacts').single.uri.queryParameters, {'limit': '20', 'offset': '0'});
      for (final o in sent) {
        expect(o.uri.query.contains('business_id'), isFalse);
      }
    });

    testWidgets('search and the source chips filter on the server', (t) async {
      final (session, sent) = recordedSession(_contactsHandler);
      await pumpScreen(t, ContactsScreen(session: session));
      await t.enterText(find.byType(TextField).first, 'ravi');
      await t.pump(const Duration(milliseconds: 400));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/whatsapp/contacts').last.uri.queryParameters['search'], 'ravi');
      await _tapText(t, 'CSV import');
      final q = requestsOf(sent, 'GET', '/api/whatsapp/contacts').last.uri.queryParameters;
      expect(q['source'], 'csv');
      expect(q['search'], 'ravi');
    });

    testWidgets('the group picker filters by group', (t) async {
      final (session, sent) = recordedSession(_contactsHandler);
      await pumpScreen(t, ContactsScreen(session: session));
      await _tapText(t, 'All groups');
      await _sheet(t, 'VIP');
      expect(requestsOf(sent, 'GET', '/api/whatsapp/contacts').last.uri.queryParameters['group_id'], 'g1');
    });

    testWidgets('Load more asks for the next page and appends it', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/contacts' && o.method == 'GET') {
          final offset = int.parse(o.uri.queryParameters['offset'] ?? '0');
          return (200, {'contacts': [offset == 0 ? _contact() : _contact(id: 'c2', name: 'Second One', phone: '919876543211')], 'pagination': {'total': 2}});
        }
        return _contactsHandler(o, b);
      });
      await pumpScreen(t, ContactsScreen(session: session));
      expect(find.text('Showing 1 of 2'), findsOneWidget);
      await _tapText(t, 'Load more');
      expect(find.text('Second One'), findsOneWidget);
      expect(find.text('Ravi Traders'), findsOneWidget);
      expect(requestsOf(sent, 'GET', '/api/whatsapp/contacts').last.uri.queryParameters['offset'], '1');
    });

    testWidgets('empty, filtered-empty, server error with Try again, and no plan', (t) async {
      final (empty, _) = recordedSession((o, b) => o.uri.path == '/api/whatsapp/contacts' ? (200, {'contacts': [], 'pagination': {'total': 0}}) : _contactsHandler(o, b));
      await pumpScreen(t, ContactsScreen(session: empty));
      expect(find.text('No contacts yet'), findsOneWidget);
      await _tapText(t, 'Manual');
      expect(find.text('No contacts match these filters'), findsOneWidget);

      var fail = true;
      final (session, sent) = recordedSession((o, b) => fail && o.uri.path == '/api/whatsapp/contacts' ? (400, {'error': 'Failed to fetch contacts'}) : _contactsHandler(o, b));
      await pumpScreen(t, ContactsScreen(session: session));
      expect(find.text('Failed to fetch contacts'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Ravi Traders'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/contacts'), 2);

      final (locked, _) = recordedSession((o, b) => (403, {'error': 'Not in plan', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, ContactsScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
      expect(_icon('Add contact'), findsNothing);
    });

    testWidgets('embedded in the Contacts tab it has no back bar', (t) async {
      final (session, _) = recordedSession(_contactsHandler);
      await pumpScreen(t, ContactsScreen(session: session, embedded: true));
      expect(find.text('Ravi Traders'), findsOneWidget);
      expect(_icon('Back'), findsNothing);
    });

    testWidgets('Groups and Unsubscribed open their screens; import stays on the website', (t) async {
      final (session, _) = recordedSession(_contactsHandler);
      await pumpScreen(t, ContactsScreen(session: session));
      expect(find.textContaining('Import'), findsOneWidget);
      await _tapText(t, 'Groups');
      expect(find.byType(ContactGroupsScreen), findsOneWidget);
    });
  });

  group('add and edit a contact', () {
    testWidgets('Add contact posts the form once, normalized, with no identity, then reloads', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/contacts' && o.method == 'POST') return (201, {'contact': _contact(id: 'c9')});
        return _contactsHandler(o, b);
      });
      await pumpScreen(t, ContactsScreen(session: session));
      await t.tap(_icon('Add contact'));
      await t.pumpAndSettle();
      await _type(t, 'Phone', '+91 98765 43299');
      await _type(t, 'Name', 'Asha');
      await _type(t, 'Tags', 'vip, new');
      await t.tap(find.text('Save contact'));
      await t.tap(find.text('Save contact'));
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/whatsapp/contacts').toList();
      expect(posts.length, 1);
      final body = posts.single.data as Map;
      expect(body, {'phone': '919876543299', 'name': 'Asha', 'tags': ['vip', 'new'], 'source': 'manual'});
      expectNoIdentity(body);
      expect(requestCount(sent, 'GET', '/api/whatsapp/contacts'), 2);
    });

    testWidgets('a bad number is refused before anything is sent; a duplicate shows the server reason', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/contacts' && o.method == 'POST') return (409, {'error': 'Contact already exists', 'skipped': true});
        return _contactsHandler(o, b);
      });
      await pumpScreen(t, ContactsScreen(session: session));
      await t.tap(_icon('Add contact'));
      await t.pumpAndSettle();
      await _type(t, 'Phone', '123');
      await t.tap(find.text('Save contact'));
      await t.pumpAndSettle();
      expect(find.text('Enter a valid phone number with country code'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/contacts'), 0);
      await _type(t, 'Phone', '919876543210');
      await t.tap(find.text('Save contact'));
      await t.pumpAndSettle();
      expect(find.text('Contact already exists'), findsOneWidget);
      expect(find.text('Save contact'), findsOneWidget);
    });

    testWidgets('Edit sends the contact id and the changed fields, never the phone', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/contacts' && o.method == 'PUT') return (200, {'contact': _contact()});
        return _contactsHandler(o, b);
      });
      await pumpScreen(t, ContactsScreen(session: session));
      await _tapText(t, 'Ravi Traders');
      await _tapText(t, 'Edit contact');
      await _type(t, 'Name', 'Ravi Silks');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      final body = requestsOf(sent, 'PUT', '/api/whatsapp/contacts').single.data as Map;
      expect(body['id'], 'c1');
      expect(body['name'], 'Ravi Silks');
      expect(body['email'], 'ravi@shop.in');
      expect(body['tags'], ['vip', 'diwali']);
      expect(body.containsKey('phone'), isFalse);
      expectNoIdentity(body);
    });
  });

  group('one contact', () {
    testWidgets('shows phone, email, tags, notes, groups and source', (t) async {
      final (session, _) = recordedSession(_contactsHandler);
      await pumpScreen(t, ContactsScreen(session: session));
      await _tapText(t, 'Ravi Traders');
      expect(find.text('ravi@shop.in'), findsOneWidget);
      expect(find.text('Likes silk'), findsOneWidget);
      expect(find.text('VIP'), findsWidgets);
      expect(find.textContaining('Manual'), findsWidgets);
    });

    testWidgets('Delete asks naming the contact, deletes once, then reloads the list', (t) async {
      final (session, sent) = recordedSession(_contactsHandler);
      await pumpScreen(t, ContactsScreen(session: session));
      await _tapText(t, 'Ravi Traders');
      await _tapText(t, 'Delete contact');
      expect(find.textContaining('Ravi Traders'), findsWidgets);
      expect(find.text('Keep it'), findsOneWidget);
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/contacts'), 0);
      await t.tap(find.text('Delete contact').last);
      await t.tap(find.text('Delete contact').last, warnIfMissed: false);
      await t.pumpAndSettle();
      final del = requestsOf(sent, 'DELETE', '/api/whatsapp/contacts').toList();
      expect(del.length, 1);
      expect(del.single.uri.queryParameters, {'id': 'c1'});
      expect(requestCount(sent, 'GET', '/api/whatsapp/contacts'), 2);
      expect(find.byType(ContactsScreen), findsOneWidget);
    });

    testWidgets('a refused delete says why and keeps the contact', (t) async {
      final (session, _) = recordedSession((o, b) => o.method == 'DELETE' ? (404, {'error': 'Contact not found or access denied'}) : _contactsHandler(o, b));
      await pumpScreen(t, ContactsScreen(session: session));
      await _tapText(t, 'Ravi Traders');
      await _tapText(t, 'Delete contact');
      await t.tap(find.text('Delete contact').last);
      await t.pumpAndSettle();
      expect(find.text('Contact not found or access denied'), findsOneWidget);
    });

    testWidgets('Open chat looks the chat up by number and opens it', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/contacts/919876543210') return (200, {'contact': {'conversation_id': 'conv1'}});
        return _contactsHandler(o, b);
      });
      await pumpScreen(t, ContactsScreen(session: session));
      await _tapText(t, 'Ravi Traders');
      await _tapText(t, 'Open chat');
      expect(find.byType(ChatThreadScreen), findsOneWidget);
      expect((t.widget(find.byType(ChatThreadScreen)) as ChatThreadScreen).conversationId, 'conv1');
      expect(requestCount(sent, 'GET', '/api/whatsapp/contacts/919876543210'), 1);
    });

    testWidgets('no chat with that number yet says so', (t) async {
      final (session, _) = recordedSession((o, b) => o.uri.path == '/api/whatsapp/contacts/919876543210' ? (404, {'error': 'Contact not found'}) : _contactsHandler(o, b));
      await pumpScreen(t, ContactsScreen(session: session));
      await _tapText(t, 'Ravi Traders');
      await _tapText(t, 'Open chat');
      expect(find.text('No chat with this number yet. Use Send message to start one.'), findsOneWidget);
      expect(find.byType(ChatThreadScreen), findsNothing);
    });
  });

  group('contact groups', () {
    Reply handler(RequestOptions o, Map b) {
      final p = o.uri.path;
      if (p == '/api/whatsapp/contact-groups' && o.method == 'GET') return (200, _groups);
      if (p == '/api/whatsapp/contact-groups/g1/members' && o.method == 'GET') {
        return (200, {'members': [_contact(), _contact(id: 'c2', name: 'Asha', phone: '919876543211')], 'total': 2});
      }
      if (p == '/api/whatsapp/contacts' && o.method == 'GET') {
        return (200, {'contacts': [_contact(), _contact(id: 'c2', name: 'Asha', phone: '919876543211'), _contact(id: 'c3', name: 'Meena', phone: '919876543212')], 'pagination': {'total': 3}});
      }
      return (200, <String, dynamic>{});
    }

    testWidgets('lists groups with member counts', (t) async {
      final (session, sent) = recordedSession(handler);
      await pumpScreen(t, ContactGroupsScreen(session: session));
      expect(find.text('VIP'), findsOneWidget);
      expect(find.textContaining('2 contacts'), findsOneWidget);
      expect(find.textContaining('0 contacts'), findsOneWidget);
      expect(find.text('Best customers'), findsOneWidget);
      expect(sent.where((o) => o.uri.query.contains('business_id')), isEmpty);
    });

    testWidgets('empty, error with Try again, and no plan', (t) async {
      final (empty, _) = recordedSession((o, b) => (200, {'groups': []}));
      await pumpScreen(t, ContactGroupsScreen(session: empty));
      expect(find.text('No groups yet'), findsOneWidget);
      var fail = true;
      final (session, _) = recordedSession((o, b) => fail ? (400, {'error': 'Failed to fetch contact groups'}) : handler(o, b));
      await pumpScreen(t, ContactGroupsScreen(session: session));
      expect(find.text('Failed to fetch contact groups'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('VIP'), findsOneWidget);
      final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, ContactGroupsScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('Add group posts name, description and colour once; a taken name shows the server reason', (t) async {
      var taken = false;
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/contact-groups' && o.method == 'POST') {
          return taken ? (409, {'error': 'A group with this name already exists'}) : (201, {'group': {'id': 'g9'}});
        }
        return handler(o, b);
      });
      await pumpScreen(t, ContactGroupsScreen(session: session));
      await _tapText(t, 'New group');
      await _type(t, 'Name', 'Festival');
      await _type(t, 'Description', 'Diwali list');
      await _tapText(t, 'Green');
      await _sheet(t, 'Blue');
      taken = true;
      await t.tap(find.text('Save group'));
      await t.pumpAndSettle();
      expect(find.text('A group with this name already exists'), findsOneWidget);
      taken = false;
      await t.tap(find.text('Save group'));
      await t.tap(find.text('Save group'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/whatsapp/contact-groups').toList();
      expect(posts.length, 2);
      final body = posts.last.data as Map;
      expect(body, {'name': 'Festival', 'description': 'Diwali list', 'color': '#3B82F6'});
      expectNoIdentity(body);
    });

    testWidgets('a group shows its members; Remove asks then deletes only that contact from the group', (t) async {
      final (session, sent) = recordedSession(handler);
      await pumpScreen(t, ContactGroupsScreen(session: session));
      await _tapText(t, 'VIP');
      expect(find.text('Ravi Traders'), findsOneWidget);
      expect(find.text('Asha'), findsOneWidget);
      await t.tap(find.text('Remove').first);
      await t.pumpAndSettle();
      expect(find.textContaining('Ravi Traders'), findsWidgets);
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/contact-groups/g1/members'), 0);
      await t.tap(find.text('Remove from group').last);
      await t.tap(find.text('Remove from group').last, warnIfMissed: false);
      await t.pumpAndSettle();
      final del = requestsOf(sent, 'DELETE', '/api/whatsapp/contact-groups/g1/members').toList();
      expect(del.length, 1);
      expect(del.single.uri.queryParameters, {'contact_ids': 'c1'});
      expect(requestCount(sent, 'GET', '/api/whatsapp/contact-groups/g1/members'), 2);
    });

    testWidgets('Add contacts picks from the contact list and posts their ids once', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/contact-groups/g1/members' && o.method == 'POST') return (200, {'added': 1, 'skipped': 0, 'total': 1});
        return handler(o, b);
      });
      await pumpScreen(t, ContactGroupsScreen(session: session));
      await _tapText(t, 'VIP');
      await _tapText(t, 'Add contacts');
      expect(find.text('Meena'), findsOneWidget);
      await _tapText(t, 'Meena');
      expect(find.text('Add 1 contact'), findsOneWidget);
      await t.tap(find.text('Add 1 contact'));
      await t.tap(find.text('Add 1 contact'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/whatsapp/contact-groups/g1/members').toList();
      expect(posts.length, 1);
      expect(posts.single.data, {'contact_ids': ['c3']});
      expect(find.text('1 added'), findsOneWidget);
    });

    testWidgets('Delete group asks naming it, deletes once and returns to the list', (t) async {
      final (session, sent) = recordedSession(handler);
      await pumpScreen(t, ContactGroupsScreen(session: session));
      await _tapText(t, 'VIP');
      await t.tap(_icon('Delete group'));
      await t.pumpAndSettle();
      expect(find.textContaining('VIP'), findsWidgets);
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/contact-groups'), 0);
      await t.tap(find.text('Delete group').last);
      await t.tap(find.text('Delete group').last, warnIfMissed: false);
      await t.pumpAndSettle();
      final del = requestsOf(sent, 'DELETE', '/api/whatsapp/contact-groups').toList();
      expect(del.length, 1);
      expect(del.single.uri.queryParameters, {'id': 'g1'});
      expect(find.byType(ContactGroupsScreen), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/contact-groups'), 2);
    });

    testWidgets('Edit group sends its id with the new name', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/contact-groups' && o.method == 'PUT') return (200, {'group': {'id': 'g1'}});
        return handler(o, b);
      });
      await pumpScreen(t, ContactGroupsScreen(session: session));
      await _tapText(t, 'VIP');
      await t.tap(_icon('Edit group'));
      await t.pumpAndSettle();
      await _type(t, 'Name', 'VIP Gold');
      await t.tap(find.text('Save group'));
      await t.pumpAndSettle();
      final body = requestsOf(sent, 'PUT', '/api/whatsapp/contact-groups').single.data as Map;
      expect(body, {'id': 'g1', 'name': 'VIP Gold', 'description': 'Best customers', 'color': '#3B82F6'});
      expectNoIdentity(body);
    });
  });

  group('unsubscribes', () {
    Reply handler(RequestOptions o, Map b) {
      if (o.uri.path == '/api/whatsapp/unsubscribes' && o.method == 'GET') {
        return (200, {
          'unsubscribes': [
            {'id': 'u1', 'phone': '919876543210', 'unsubscribed_at': '2026-11-02T05:00:00.000Z'},
            {'id': 'u2', 'phone': '911111111111', 'unsubscribed_at': '2026-11-03T05:00:00.000Z'},
          ],
          'total': 2,
        });
      }
      return (200, <String, dynamic>{});
    }

    testWidgets('lists opted-out numbers with the count and filters them by search', (t) async {
      final (session, sent) = recordedSession(handler);
      await pumpScreen(t, UnsubscribesScreen(session: session));
      expect(find.text('+91 98765 43210'), findsOneWidget);
      expect(find.text('+91 11111 11111'), findsOneWidget);
      expect(find.text('2 total'), findsOneWidget);
      await t.enterText(find.byType(TextField).first, '98765');
      await t.pumpAndSettle();
      expect(find.text('+91 11111 11111'), findsNothing);
      expect(sent.where((o) => o.uri.query.contains('business_id')), isEmpty);
    });

    testWidgets('empty, error with Try again, no plan', (t) async {
      final (empty, _) = recordedSession((o, b) => (200, {'unsubscribes': []}));
      await pumpScreen(t, UnsubscribesScreen(session: empty));
      expect(find.text('No unsubscribed contacts'), findsOneWidget);
      var fail = true;
      final (session, _) = recordedSession((o, b) => fail ? (400, {'error': 'Failed to fetch unsubscribes'}) : handler(o, b));
      await pumpScreen(t, UnsubscribesScreen(session: session));
      expect(find.text('Failed to fetch unsubscribes'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('+91 98765 43210'), findsOneWidget);
      final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, UnsubscribesScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('Add posts the normalized number once, with no identity, and reloads', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.method == 'POST') return (200, {'message': 'Added 1 phone(s) to unsubscribe list, 0 already unsubscribed', 'added': 1, 'skipped': 0});
        return handler(o, b);
      });
      await pumpScreen(t, UnsubscribesScreen(session: session));
      await t.tap(_icon('Add number'));
      await t.pumpAndSettle();
      await _type(t, 'Phone number', '12');
      await t.tap(find.text('Add to list'));
      await t.pumpAndSettle();
      expect(find.text('Please enter a valid phone number'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/unsubscribes'), 0);
      await _type(t, 'Phone number', '+91 98765 43299');
      await t.tap(find.text('Add to list'));
      await t.tap(find.text('Add to list'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/whatsapp/unsubscribes').toList();
      expect(posts.length, 1);
      expect(posts.single.data, {'phone': '919876543299'});
      expectNoIdentity(posts.single.data as Map);
      expect(requestCount(sent, 'GET', '/api/whatsapp/unsubscribes'), 2);
    });

    testWidgets('Resubscribe asks naming the number, deletes once, reloads; a refusal shows its reason', (t) async {
      var refuse = false;
      final (session, sent) = recordedSession((o, b) {
        if (o.method == 'DELETE') return refuse ? (400, {'error': 'Business ID and phone(s) are required'}) : (200, {'removed': 1});
        return handler(o, b);
      });
      await pumpScreen(t, UnsubscribesScreen(session: session));
      await t.tap(find.text('Resubscribe').first);
      await t.pumpAndSettle();
      expect(find.textContaining('+91 98765 43210'), findsWidgets);
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/unsubscribes'), 0);
      await t.tap(find.text('Resubscribe').last);
      await t.tap(find.text('Resubscribe').last, warnIfMissed: false);
      await t.pumpAndSettle();
      final del = requestsOf(sent, 'DELETE', '/api/whatsapp/unsubscribes').toList();
      expect(del.length, 1);
      expect(del.single.uri.queryParameters, {'phone': '919876543210'});
      expect(requestCount(sent, 'GET', '/api/whatsapp/unsubscribes'), 2);

      refuse = true;
      await t.tap(find.text('Resubscribe').first);
      await t.pumpAndSettle();
      await t.tap(find.text('Resubscribe').last);
      await t.pumpAndSettle();
      expect(find.text('Business ID and phone(s) are required'), findsOneWidget);
    });
  });
}
