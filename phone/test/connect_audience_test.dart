import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/audience_logic.dart';

void main() {
  group('phone numbers', () {
    test('normalizePhone keeps 9 to 15 digits only, like the website', () {
      expect(normalizePhone('+91 98765-43210'), '919876543210');
      expect(normalizePhone('9876543210'), '9876543210');
      expect(normalizePhone('12345678'), '');
      expect(normalizePhone('1234567890123456'), '');
      expect(normalizePhone(''), '');
      expect(isValidPhone('+919876543210'), isTrue);
      expect(isValidPhone('abc'), isFalse);
    });

    test('a pasted line is a number, "number,name" or "name,number"', () {
      expect(parseRecipientLine('919876543210'), (phone: '919876543210', name: null));
      expect(parseRecipientLine('9876543210, John Doe'), (phone: '9876543210', name: 'John Doe'));
      expect(parseRecipientLine('John Doe, 9876543210'), (phone: '9876543210', name: 'John Doe'));
      expect(parseRecipientLine('hello'), isNull);
      expect(parseRecipientLine('  '), isNull);
    });

    test('parseRecipients drops invalid lines and repeated numbers', () {
      final list = parseRecipients('+919876543210\n919876543210\n9876543211, Asha\n\nnope\n');
      expect(list.map((r) => r.phone), ['919876543210', '9876543211']);
      expect(list[1].name, 'Asha');
      expect(list[0].toJson(), {'phone': '919876543210'});
      expect(list[1].toJson(), {'phone': '9876543211', 'name': 'Asha'});
    });
  });

  group('contacts', () {
    test('list path sends only the set filters, in the website order', () {
      expect(contactsListPath(), '/api/whatsapp/contacts?limit=20&offset=0');
      expect(
        contactsListPath(search: 'ra vi', source: 'csv', groupId: 'g1', offset: 40),
        '/api/whatsapp/contacts?limit=20&offset=40&search=ra+vi&source=csv&group_id=g1',
      );
    });

    test('add body: normalized phone, tags split on commas, source manual, no identity', () {
      final body = addContactBody(phone: '+91 98765 43210', name: ' Ravi ', email: '', tags: 'vip, ,lead', notes: '');
      expect(body, {'phone': '919876543210', 'name': 'Ravi', 'tags': ['vip', 'lead'], 'source': 'manual'});
      for (final k in ['business_id', 'user_id', 'created_by']) {
        expect(body.containsKey(k), isFalse);
      }
    });

    test('edit body names the contact and sends nulls for emptied fields', () {
      expect(
        editContactBody(id: 'c1', name: 'Ravi', email: '', tags: 'a,b', notes: ''),
        {'id': 'c1', 'name': 'Ravi', 'email': null, 'tags': ['a', 'b'], 'notes': null},
      );
    });

    test('phone error follows the website', () {
      expect(contactPhoneError(''), 'Enter a phone number');
      expect(contactPhoneError('123'), 'Enter a valid phone number with country code');
      expect(contactPhoneError('919876543210'), isNull);
    });

    test('delete and chat paths', () {
      expect(contactDeletePath('c 1'), '/api/whatsapp/contacts?id=c+1');
      expect(contactChatPath('+91 98765 43210'), '/api/whatsapp/contacts/919876543210');
    });

    test('reads a page of contacts with groups and the total', () {
      final page = contactsFrom({
        'contacts': [
          {
            'id': 'c1',
            'phone': '919876543210',
            'name': 'Ravi',
            'email': 'r@x.in',
            'tags': ['vip'],
            'notes': 'n',
            'source': 'group_extractor',
            'created_at': '2026-11-01T05:00:00.000Z',
            'groups': [
              {'id': 'g1', 'name': 'VIP', 'color': '#25D366'},
            ],
          },
          {'id': 'c2', 'phone': '919876543211', 'name': null, 'tags': null, 'source': 'manual'},
        ],
        'pagination': {'total': 41, 'limit': 20, 'offset': 0, 'hasMore': true},
      });
      expect(page.total, 41);
      expect(page.rows.length, 2);
      final c = page.rows[0];
      expect(c.title, 'Ravi');
      expect(c.tags, ['vip']);
      expect(c.groups.single.name, 'VIP');
      expect(c.sourceLabel, 'Group extractor');
      expect(page.rows[1].title, '+91 98765 43211');
      expect(page.rows[1].tags, isEmpty);
      expect(page.rows[1].sourceLabel, 'Manual');
    });

    test('chat id comes from the contact reply', () {
      expect(chatIdFrom({'contact': {'conversation_id': 'conv9'}}), 'conv9');
      expect(chatIdFrom({'contact': {}}), isNull);
      expect(chatIdFrom({}), isNull);
    });
  });

  group('groups', () {
    test('paths and bodies', () {
      expect(groupsPath, '/api/whatsapp/contact-groups');
      expect(groupDeletePath('g1'), '/api/whatsapp/contact-groups?id=g1');
      expect(groupMembersPath('g1'), '/api/whatsapp/contact-groups/g1/members');
      expect(groupMembersRemovePath('g1', ['c1', 'c2']), '/api/whatsapp/contact-groups/g1/members?contact_ids=c1%2Cc2');
      expect(addMembersBody(['c1', 'c2']), {'contact_ids': ['c1', 'c2']});
      expect(groupBody(name: ' VIP ', description: '', color: '#3B82F6'), {'name': 'VIP', 'color': '#3B82F6'});
      expect(groupBody(id: 'g1', name: 'VIP', description: 'Best', color: '#3B82F6'), {'id': 'g1', 'name': 'VIP', 'description': 'Best', 'color': '#3B82F6'});
    });

    test('the website offers eight colours, green first', () {
      expect(groupColors.length, 8);
      expect(groupColors.first.$2, 'Green');
    });

    test('reads groups with their member counts', () {
      final groups = groupsFrom({
        'groups': [
          {'id': 'g1', 'name': 'VIP', 'description': 'Best', 'color': '#3B82F6', 'member_count': '12'},
          {'id': 'g2', 'name': 'Empty', 'member_count': 0},
        ],
      });
      expect(groups[0].memberCount, 12);
      expect(groups[0].description, 'Best');
      expect(groups[1].memberCount, 0);
      expect(groups[1].color, '#25D366');
    });

    test('members are contacts', () {
      final members = membersFrom({
        'members': [
          {'id': 'c1', 'phone': '919876543210', 'name': 'Ravi', 'source': 'manual'},
        ],
        'total': 1,
      });
      expect(members.single.title, 'Ravi');
    });

    test('added counts read from the reply', () {
      expect(addedMessage({'added': 2, 'skipped': 1}), '2 added, 1 already in the group or not found');
      expect(addedMessage({'added': 3, 'skipped': 0}), '3 added');
    });
  });

  group('unsubscribes', () {
    test('paths and body', () {
      expect(unsubscribesPath, '/api/whatsapp/unsubscribes');
      expect(unsubscribeRemovePath('+91 98765 43210'), '/api/whatsapp/unsubscribes?phone=919876543210');
      expect(unsubscribeBody('+91 98765 43210'), {'phone': '919876543210'});
      expect(unsubscribeError('12'), 'Please enter a valid phone number');
      expect(unsubscribeError('919876543210'), isNull);
      expect(checkUnsubscribesPath(['919876543210', '919876543211']), '/api/whatsapp/unsubscribes?check_phones=919876543210%2C919876543211');
    });

    test('reads the list and filters it by the digits typed', () {
      final rows = unsubscribesFrom({
        'unsubscribes': [
          {'id': 'u1', 'phone': '919876543210', 'unsubscribed_at': '2026-11-02T05:00:00.000Z'},
          {'id': 'u2', 'phone': '911111111111', 'unsubscribed_at': null},
        ],
      });
      expect(rows.length, 2);
      expect(filterUnsubscribes(rows, '98765').map((r) => r.id), ['u1']);
      expect(filterUnsubscribes(rows, '').length, 2);
      expect(rows[0].phoneText, '+91 98765 43210');
    });
  });

  group('who to message', () {
    test('the five lists carry the website names', () {
      expect(whoConditions.map((c) => c.id), ['quiet', 'top', 'once', 'enquiry', 'whatsapp']);
      expect(whoConditions.first.label, 'Has not bought in a while');
      expect(whoConditions[1].label, 'Top buyers');
    });

    test('request path sets only the parameters the list uses', () {
      expect(whoToMessagePath('quiet', days: 30, periodDays: 90, limit: 10), '/api/whatsapp/who-to-message?condition=quiet&days=30');
      expect(whoToMessagePath('enquiry', days: 15, periodDays: 90, limit: 10), '/api/whatsapp/who-to-message?condition=enquiry&days=15');
      expect(whoToMessagePath('whatsapp', days: 60, periodDays: 90, limit: 10), '/api/whatsapp/who-to-message?condition=whatsapp&days=60');
      expect(whoToMessagePath('top', days: 30, periodDays: 90, limit: 25), '/api/whatsapp/who-to-message?condition=top&period_days=90&limit=25');
      expect(whoToMessagePath('once', days: 30, periodDays: 90, limit: 10), '/api/whatsapp/who-to-message?condition=once');
    });

    test('range errors match the server limits', () {
      expect(whoRangeError('quiet', days: 0, periodDays: 30, limit: 10), 'Days must be a whole number from 1 to 365');
      expect(whoRangeError('quiet', days: 366, periodDays: 30, limit: 10), isNotNull);
      expect(whoRangeError('top', days: 30, periodDays: 400, limit: 10), 'Days must be a whole number from 1 to 365');
      expect(whoRangeError('top', days: 30, periodDays: 30, limit: 51), 'Show must be a whole number from 1 to 50');
      expect(whoRangeError('once', days: 0, periodDays: 0, limit: 0), isNull);
      expect(whoRangeError('quiet', days: 30, periodDays: 30, limit: 10), isNull);
    });

    test('reads people and saved replies', () {
      final people = peopleFrom({
        'condition': 'quiet',
        'people': [
          {'phone': '919876543210', 'name': 'Ravi', 'reason': 'Last bill 3 Oct 2026'},
          {'phone': '919876543211', 'name': 'Customer', 'reason': ''},
        ],
      });
      expect(people.length, 2);
      expect(people[0].reason, 'Last bill 3 Oct 2026');
      expect(whoPeopleToRecipients(people).map((r) => r.toJson()), [
        {'phone': '919876543210', 'name': 'Ravi'},
        {'phone': '919876543211', 'name': 'Customer'},
      ]);
      final replies = savedRepliesFrom({
        'replies': [
          {'id': 'r1', 'title': 'Diwali', 'message': 'Happy Diwali'},
        ],
      });
      expect(replies.single.message, 'Happy Diwali');
      expect(savedRepliesPath, '/api/whatsapp/saved-replies');
    });
  });
}
