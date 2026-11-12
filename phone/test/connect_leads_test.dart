import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/leads_logic.dart';

import 'support/recorded_session.dart';

const leadRow = {
  'id': 'l1',
  'name': 'Ravi Traders',
  'phone': '919876510004',
  'conversation_id': 'c1',
  'message_count': 12,
  'lead_type': 'new',
  'source': 'indiamart',
  'stage_id': 's1',
  'stage_name': 'New',
  'stage_kind': 'open',
  'temperature': 'hot',
  'lead_score': 82,
  'owner_id': 'u2',
  'owner_name': 'Meena',
  'customer_id': null,
  'opened_at': '2026-11-01T05:00:00.000Z',
  'last_activity_at': '2026-11-10T05:00:00.000Z',
  'closed_at': null,
};

void main() {
  group('lead paths', () {
    test('the list sends only the filters that are set, never a business id', () {
      expect(leadsPath(), '/api/whatsapp/leads');
      expect(leadsPath(status: 'open', stageId: 's1', source: 'direct', search: ' ravi ', offset: 50),
          '/api/whatsapp/leads?stage_id=s1&source=direct&search=ravi&status=open&offset=50');
      expect(leadsPath(type: 'existing', ownerId: 'u2'), '/api/whatsapp/leads?type=existing&owner=u2');
      expect(leadsPath().contains('business_id'), isFalse);
    });

    test('one lead, its notes, convert and new enquiry', () {
      expect(leadPath('l 1'), '/api/whatsapp/leads/l%201');
      expect(leadNotesPath('l1'), '/api/whatsapp/leads/l1/notes');
      expect(leadNotePath('l1', 'n1'), '/api/whatsapp/leads/l1/notes?note_id=n1');
      expect(leadConvertPath('l1'), '/api/whatsapp/leads/l1/convert');
      expect(newEnquiryPath('l1'), '/api/whatsapp/leads/l1/new-enquiry');
    });
  });

  group('lead bodies', () {
    test('add lead', () {
      expect(addLeadBody(name: ' Ravi ', phone: ' 98765 43210 ', source: 'walk_in'), {'name': 'Ravi', 'phone': '98765 43210', 'source': 'walk_in'});
      expect(addLeadBody(name: 'R', phone: '9876543210', source: 'call', note: ' asked ', stageId: 's1', ownerId: 'u2'), {
        'name': 'R', 'phone': '9876543210', 'source': 'call', 'note': 'asked', 'stage_id': 's1', 'owner_id': 'u2',
      });
      expect(addLeadError('', '9876543210'), 'Enter a name');
      expect(addLeadError('R', '12345'), 'Enter a 10-digit mobile number, or one with its country code');
      expect(addLeadError('R', '+91 98765 43210'), isNull);
    });

    test('stage, owner, deal value, note, convert, new enquiry, customer', () {
      expect(leadStageBody('s2'), {'stage_id': 's2'});
      expect(leadStageBody('s3', lostReason: ' Price '), {'stage_id': 's3', 'lost_reason': 'Price'});
      expect(leadStageBody('s3', lostReason: ''), {'stage_id': 's3'});
      expect(leadStageBody(null), {'stage_id': null});
      expect(leadOwnerBody('u2'), {'owner_id': 'u2'});
      expect(leadOwnerBody(null), {'owner_id': null});
      expect(leadDealValueBody(1500), {'deal_value': 1500});
      expect(leadDealValueBody(null), {'deal_value': null});
      expect(leadNoteBody(' Call back '), {'note_text': 'Call back'});
      expect(convertBody('cust1'), {'customer_id': 'cust1'});
      expect(newEnquiryBody(false), <String, dynamic>{});
      expect(newEnquiryBody(true), {'confirm_close_open': true});
      expect(newCustomerBody(name: ' Ravi ', phone: ' 9198 ', gstin: '27aaa', address: ' Pune '), {
        'name': 'Ravi', 'phone': '9198', 'gstin': '27AAA', 'address': 'Pune',
      });
      expect(newCustomerBody(name: 'R', phone: '9'), {'name': 'R', 'phone': '9'});
    });

    test('no body ever carries an identity', () {
      for (final b in [
        addLeadBody(name: 'R', phone: '9876543210', source: 'call', stageId: 's', ownerId: 'u'),
        leadStageBody('s', lostReason: 'x'),
        leadOwnerBody('u'),
        leadNoteBody('x'),
        convertBody('c'),
        newCustomerBody(name: 'R', phone: '9'),
      ]) {
        expectNoIdentity(b);
      }
    });
  });

  group('lead readers', () {
    test('a list row', () {
      final l = Lead.fromJson(leadRow);
      expect(l.name, 'Ravi Traders');
      expect(l.hasChat, isTrue);
      expect(l.isClosed, isFalse);
      expect(l.isExisting, isFalse);
      expect(l.sourceText, 'IndiaMART');
      expect(l.temperatureText, 'Hot · 82');
      expect(l.messagesText, '12 messages');
      expect(Lead.fromJson({...leadRow, 'conversation_id': null, 'message_count': null}).messagesText, 'No chat yet');
      expect(Lead.fromJson({...leadRow, 'source': null}).sourceText, 'Direct');
      expect(Lead.fromJson({...leadRow, 'temperature': null, 'lead_score': 40}).temperatureText, '40');
      expect(Lead.fromJson({...leadRow, 'temperature': null, 'lead_score': null}).temperatureText, '');
    });

    test('the detail adds deal, note, source detail and other enquiries', () {
      final l = Lead.fromJson({
        ...leadRow,
        'source': 'ctwa_ad',
        'source_detail': {'headline': 'Diwali sale'},
        'deal_value': 2500.5,
        'note': 'Wants 20 cartons',
        'summary': 'Asked about price',
        'lost_reason': null,
        'other_leads': [
          {'id': 'l0', 'opened_at': '2026-09-01T00:00:00.000Z', 'closed_at': '2026-09-05T00:00:00.000Z', 'stage_name': 'Lost'},
        ],
        'followups': [
          {'id': 'f1', 'due_at': '2026-11-12T10:00:00.000Z', 'note': 'Ring him', 'assigned_name': 'Meena'},
        ],
      });
      expect(l.sourceText, 'WhatsApp ad · Diwali sale');
      expect(l.dealValue, 2500.5);
      expect(l.note, 'Wants 20 cartons');
      expect(l.summary, 'Asked about price');
      expect(l.otherLeads.single.stageName, 'Lost');
      expect(l.otherLeads.single.isClosed, isTrue);
      expect(l.followups.single.note, 'Ring him');
    });

    test('lists of rows, notes, stages, people and labels', () {
      expect(leadsFrom({'rows': [leadRow, 'junk'], 'total': 51, 'is_supervisor': true}).rows.length, 1);
      final page = leadsFrom({'rows': [leadRow], 'total': 51, 'is_supervisor': true});
      expect((page.total, page.isSupervisor), (51, true));
      expect(leadsFrom({}).total, 0);

      final notes = leadNotes({
        'notes': [
          {'id': 'n1', 'note_text': 'Call back', 'created_at': '2026-11-10T05:00:00.000Z', 'user_id': 'u1', 'user_name': 'Asha'},
          {'id': 'n2', 'note_text': 'Quoted', 'created_at': '2026-11-09T05:00:00.000Z', 'user_id': null, 'user_name': null, 'user_email': 'a@b.c'},
        ],
      });
      expect(notes.first.author, 'Asha');
      expect(notes.last.author, 'a@b.c');

      final stages = stageOptions({
        'stages': [
          {'id': 's1', 'name': 'New', 'kind': 'open', 'position': 1},
          {'id': 's2', 'name': 'Lost', 'kind': 'lost', 'position': 2},
        ],
      });
      expect(stages.map((s) => s.name), ['New', 'Lost']);
      expect(stages.last.isLost, isTrue);

      final people = personOptions({
        'users': [
          {'id': 'u1', 'name': 'Asha', 'can_receive': true},
          {'id': 'u2', 'name': 'Boss', 'can_receive': false},
          {'id': 'u3', 'name': 'Ravi'},
        ],
      });
      expect(people.map((p) => p.name), ['Asha', 'Ravi']);
      expect(labelOptions({'labels': [{'id': 'b1', 'name': 'VIP'}]}).single.name, 'VIP');
    });

    test('phone and source labels follow the website', () {
      expect(formatLeadPhone('919876510004'), '+91 98765 10004');
      expect(formatLeadPhone('4412345678'), '+4412345678');
      expect(formatLeadPhone(''), '');
      expect(leadSourceFilters.map((e) => e.$1), ['ctwa_ad', 'link', 'indiamart', 'lead_api', 'call', 'walk_in', 'manual', 'direct']);
      expect(manualSources, [('call', 'Call'), ('walk_in', 'Walk-in'), ('manual', 'Other')]);
    });
  });
}
