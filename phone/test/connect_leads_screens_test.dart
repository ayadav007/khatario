import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/chat_thread_screen.dart';
import 'package:khatario_phone/screens/chats/lead_profile_screen.dart';
import 'package:khatario_phone/screens/chats/leads_screen.dart';
import 'package:khatario_phone/screens/parties/customer_detail_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

const _stages = {
  'stages': [
    {'id': 's1', 'name': 'New', 'kind': 'open', 'position': 1},
    {'id': 's2', 'name': 'Quoted', 'kind': 'open', 'position': 2},
    {'id': 's3', 'name': 'Lost', 'kind': 'lost', 'position': 3},
  ],
};
const _users = {
  'users': [
    {'id': 'u1', 'name': 'Asha', 'can_receive': true},
    {'id': 'u2', 'name': 'Meena', 'can_receive': true},
  ],
};

Map<String, dynamic> _lead({String id = 'l1', String name = 'Ravi Traders', Map<String, dynamic> extra = const {}}) => {
      'id': id,
      'name': name,
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
      ...extra,
    };

Map<String, dynamic> _detail({Map<String, dynamic> extra = const {}}) => _lead(extra: {
      'deal_value': 2500,
      'note': 'Wants 20 cartons',
      'summary': 'Asked about price',
      'source_detail': {'product': 'Cartons'},
      'followups': [
        {'id': 'f1', 'due_at': '2026-11-12T10:00:00.000Z', 'note': 'Ring him', 'assigned_name': 'Meena'},
      ],
      'other_leads': [
        {'id': 'l0', 'opened_at': '2026-09-01T00:00:00.000Z', 'closed_at': '2026-09-05T00:00:00.000Z', 'stage_name': 'Lost'},
      ],
      ...extra,
    });

const _notes = {
  'notes': [
    {'id': 'n1', 'note_text': 'Call back after lunch', 'created_at': '2026-11-10T05:00:00.000Z', 'user_id': 'u', 'user_name': 'Asha'},
    {'id': 'n2', 'note_text': 'Quoted 20 cartons', 'created_at': '2026-11-09T05:00:00.000Z', 'user_id': 'u9', 'user_name': 'Boss'},
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

void main() {
  group('leads list', () {
    Reply handler(RequestOptions o, Map b, {int total = 1}) {
      final p = o.uri.path;
      if (p == '/api/whatsapp/pipeline/stages') return (200, _stages);
      if (p == '/api/whatsapp/users') return (200, _users);
      if (p == '/api/whatsapp/leads' && o.method == 'GET') {
        return (200, {'rows': [_lead()], 'total': total, 'is_supervisor': false});
      }
      return (200, <String, dynamic>{});
    }

    testWidgets('lists leads with source, stage and owner, and sends no business id', (t) async {
      final (session, sent) = recordedSession((o, b) => handler(o, b));
      await pumpScreen(t, LeadsScreen(session: session));
      expect(find.text('Ravi Traders'), findsOneWidget);
      expect(find.textContaining('IndiaMART'), findsWidgets);
      expect(find.textContaining('Meena'), findsWidgets);
      expect(find.textContaining('12 messages'), findsOneWidget);
      expect(requestsOf(sent, 'GET', '/api/whatsapp/leads').single.uri.query, '');
      for (final o in sent) {
        expect(o.uri.query.contains('business_id'), isFalse);
      }
    });

    testWidgets('the stage and source pickers and the status chips filter the list', (t) async {
      final (session, sent) = recordedSession((o, b) => handler(o, b));
      await pumpScreen(t, LeadsScreen(session: session));
      await _tapText(t, 'All stages');
      await _sheet(t, 'Quoted');
      expect(requestsOf(sent, 'GET', '/api/whatsapp/leads').last.uri.queryParameters, {'stage_id': 's2'});
      await _tapText(t, 'All sources');
      await _sheet(t, 'IndiaMART');
      expect(requestsOf(sent, 'GET', '/api/whatsapp/leads').last.uri.queryParameters, {'stage_id': 's2', 'source': 'indiamart'});
      await _tapText(t, 'Open');
      expect(requestsOf(sent, 'GET', '/api/whatsapp/leads').last.uri.queryParameters, {'stage_id': 's2', 'source': 'indiamart', 'status': 'open'});
    });

    testWidgets('an empty list says so, with and without filters', (t) async {
      final (session, _) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/leads') return (200, {'rows': [], 'total': 0});
        return handler(o, b);
      });
      await pumpScreen(t, LeadsScreen(session: session));
      expect(find.text('No leads yet'), findsOneWidget);
      await _tapText(t, 'Closed');
      expect(find.text('No leads match these filters'), findsOneWidget);
    });

    testWidgets('Load more asks for the next page and appends it', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/leads' && o.uri.queryParameters['offset'] == '1') {
          return (200, {'rows': [_lead(id: 'l2', name: 'Second Lead')], 'total': 2});
        }
        return handler(o, b, total: 2);
      });
      await pumpScreen(t, LeadsScreen(session: session));
      expect(find.text('Showing 1 of 2'), findsOneWidget);
      await _tapText(t, 'Load more');
      expect(find.text('Second Lead'), findsOneWidget);
      expect(find.text('Ravi Traders'), findsOneWidget);
      expect(find.text('Load more'), findsNothing);
    });

    testWidgets('a server error offers Try again; a plan without Connect does not', (t) async {
      var fail = true;
      final (session, sent) = recordedSession((o, b) => fail && o.uri.path == '/api/whatsapp/leads' ? (400, {'error': 'Could not load leads'}) : handler(o, b));
      await pumpScreen(t, LeadsScreen(session: session));
      expect(find.text('Could not load leads'), findsWidgets);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Ravi Traders'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/leads'), 2);

      final (locked, _) = recordedSession((o, b) => (403, {'error': 'Not in plan', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, LeadsScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('Add lead posts the form once, with no identity, and opens the lead', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/leads' && o.method == 'POST') return (201, {'lead': {'id': 'l9'}});
        if (o.uri.path == '/api/whatsapp/leads/l9') return (200, {'lead': _detail(extra: {'id': 'l9', 'name': 'Walk In'})});
        return handler(o, b);
      });
      await pumpScreen(t, LeadsScreen(session: session));
      await t.tap(_icon('Add lead'));
      await t.pumpAndSettle();
      await _type(t, 'Name', ' Walk In ');
      await _type(t, 'Phone', '98765 43210');
      await _tapText(t, 'Call');
      await _sheet(t, 'Walk-in');
      await t.ensureVisible(find.text('Save lead'));
      await t.tap(find.text('Save lead'));
      await t.tap(find.text('Save lead'));
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/whatsapp/leads').toList();
      expect(posts.length, 1);
      expect(posts.single.data, {'name': 'Walk In', 'phone': '98765 43210', 'source': 'walk_in'});
      expectNoIdentity(posts.single.data as Map);
      expect(find.byType(LeadProfileScreen), findsOneWidget);
    });

    testWidgets('Add lead checks the form before posting, shows a refusal and a number that already has a lead', (t) async {
      var mode = 'refuse';
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/leads' && o.method == 'POST') {
          return mode == 'refuse' ? (409, {'error': 'This number already has an open lead', 'code': 'LEAD_OPEN'}) : (200, {'lead': {'id': 'l1'}, 'existing': true});
        }
        if (o.uri.path == '/api/whatsapp/leads/l1') return (200, {'lead': _detail()});
        return handler(o, b);
      });
      await pumpScreen(t, LeadsScreen(session: session));
      await t.tap(_icon('Add lead'));
      await t.pumpAndSettle();
      await _tapText(t, 'Save lead');
      expect(find.text('Enter a name'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/whatsapp/leads'), 0);
      await _type(t, 'Name', 'R');
      await _type(t, 'Phone', '12345');
      await _tapText(t, 'Save lead');
      expect(find.text('Enter a 10-digit mobile number, or one with its country code'), findsOneWidget);
      await _type(t, 'Phone', '9876543210');
      await _tapText(t, 'Save lead');
      expect(find.text('This number already has an open lead'), findsOneWidget);
      expect(find.text('Save lead'), findsOneWidget);
      mode = 'existing';
      await _tapText(t, 'Save lead');
      expect(find.byType(LeadProfileScreen), findsOneWidget);
    });
  });

  group('lead profile', () {
    Reply handler(RequestOptions o, Map b, {Map<String, dynamic>? lead}) {
      final p = o.uri.path;
      if (p == '/api/whatsapp/pipeline/stages') return (200, _stages);
      if (p == '/api/whatsapp/users') return (200, _users);
      if (p == '/api/whatsapp/leads/l1' && o.method == 'GET') return (200, {'lead': lead ?? _detail()});
      if (p == '/api/whatsapp/leads/l1/notes' && o.method == 'GET') return (200, _notes);
      return (200, <String, dynamic>{});
    }

    Future<(AppSession, List<RequestOptions>)> open(WidgetTester t, Reply Function(RequestOptions, Map) h, {bool supervisor = false}) async {
      final r = recordedSession(h);
      await pumpScreen(t, LeadProfileScreen(session: r.$1, leadId: 'l1', isSupervisor: supervisor));
      return r;
    }

    testWidgets('shows the lead, its deal, comments, reminders and other enquiries', (t) async {
      await open(t, (o, b) => handler(o, b));
      expect(find.text('Ravi Traders'), findsWidgets);
      expect(find.text('+91 98765 10004'), findsOneWidget);
      expect(find.textContaining('IndiaMART · Cartons'), findsOneWidget);
      expect(find.text('Asked about price'), findsOneWidget);
      expect(find.text('Call back after lunch'), findsOneWidget);
      expect(find.textContaining('Asha'), findsWidgets);
      expect(find.textContaining('Ring him'), findsOneWidget);
      expect(find.textContaining('Other leads from this number'), findsOneWidget);
      expect(find.text('Convert to customer'), findsOneWidget);
      expect(find.text('Open chat'), findsOneWidget);
    });

    testWidgets('a lead the caller cannot see says so; a plan without Connect locks it', (t) async {
      await open(t, (o, b) => o.uri.path == '/api/whatsapp/leads/l1' ? (404, {'error': 'Lead not found'}) : handler(o, b));
      expect(find.text('This lead was not found, or you cannot see it'), findsOneWidget);
      await open(t, (o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('changing the stage sends only the stage; a lost stage asks why first', (t) async {
      final (_, sent) = await open(t, (o, b) => handler(o, b));
      await _tapText(t, 'New', last: true);
      await _sheet(t, 'Quoted');
      expect(requestsOf(sent, 'PATCH', '/api/whatsapp/leads/l1').single.data, {'stage_id': 's2'});

      await _tapText(t, 'New', last: true);
      await _sheet(t, 'Lost');
      expect(find.text('Why was it lost?'), findsOneWidget);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)));
      await t.enterText(find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)), 'Price too high');
      await _sheet(t, 'Mark lost');
      final patches = requestsOf(sent, 'PATCH', '/api/whatsapp/leads/l1').toList();
      expect(patches.length, 2);
      expect(patches.last.data, {'stage_id': 's3', 'lost_reason': 'Price too high'});
      for (final p in patches) {
        expectNoIdentity(p.data as Map);
      }
    });

    testWidgets('a refused stage change shows the server text and reloads', (t) async {
      final (_, sent) = await open(t, (o, b) => o.method == 'PATCH' ? (400, {'error': 'Another open lead has this number', 'code': 'LEAD_OPEN'}) : handler(o, b));
      await _tapText(t, 'New', last: true);
      await _sheet(t, 'Quoted');
      expect(find.text('Another open lead has this number'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/leads/l1'), 2);
    });

    testWidgets('changing the owner sends only the owner', (t) async {
      final (_, sent) = await open(t, (o, b) => handler(o, b));
      await _tapText(t, 'Meena', last: true);
      await _sheet(t, 'Asha');
      expect(requestsOf(sent, 'PATCH', '/api/whatsapp/leads/l1').single.data, {'owner_id': 'u1'});
    });

    testWidgets('a comment is posted once as note_text and the list reloads', (t) async {
      final (_, sent) = await open(t, (o, b) => handler(o, b));
      await _type(t, 'Add a comment', ' Sent the rate card ');
      await _tapText(t, 'Add comment');
      expect(requestsOf(sent, 'POST', '/api/whatsapp/leads/l1/notes').single.data, {'note_text': 'Sent the rate card'});
      expect(requestCount(sent, 'GET', '/api/whatsapp/leads/l1/notes'), 2);
    });

    testWidgets('deleting your own comment asks first; someone else\'s shows no delete', (t) async {
      final (_, sent) = await open(t, (o, b) => handler(o, b));
      expect(_icon('Delete comment'), findsOneWidget);
      await t.tap(_icon('Delete comment'));
      await t.pumpAndSettle();
      await _sheet(t, 'Not now');
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/leads/l1/notes'), 0);
      await t.tap(_icon('Delete comment'));
      await t.pumpAndSettle();
      await _sheet(t, 'Delete');
      final del = requestsOf(sent, 'DELETE', '/api/whatsapp/leads/l1/notes').single;
      expect(del.uri.queryParameters, {'note_id': 'n1'});
    });

    testWidgets('a supervisor can delete anyone\'s comment', (t) async {
      await open(t, (o, b) => handler(o, b), supervisor: true);
      expect(_icon('Delete comment'), findsNWidgets(2));
    });

    testWidgets('Convert links the customer whose number matches, after asking, then opens the customer', (t) async {
      final (_, sent) = await open(t, (o, b) {
        if (o.uri.path == '/api/whatsapp/leads/l1/convert' && o.method == 'GET') return (200, {'match': {'id': 'c9', 'name': 'Mehta Stores'}});
        if (o.uri.path == '/api/whatsapp/leads/l1/convert' && o.method == 'POST') return (200, {'lead': _lead()});
        return handler(o, b);
      });
      await _tapText(t, 'Convert to customer');
      expect(find.text('Convert Ravi Traders?'), findsOneWidget);
      expect(find.textContaining('Mehta Stores already has this number'), findsOneWidget);
      await _sheet(t, 'Not now');
      expect(requestCount(sent, 'POST', '/api/whatsapp/leads/l1/convert'), 0);
      await _tapText(t, 'Convert to customer');
      await _sheet(t, 'Link to Mehta Stores');
      expect(requestsOf(sent, 'POST', '/api/whatsapp/leads/l1/convert').single.data, {'customer_id': 'c9'});
      expect(find.byType(CustomerDetailScreen), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/leads/l1'), 2);
    });

    testWidgets('Convert with no matching customer adds one, then links it', (t) async {
      final (_, sent) = await open(t, (o, b) {
        if (o.uri.path == '/api/whatsapp/leads/l1/convert' && o.method == 'GET') return (200, {'match': null});
        if (o.uri.path == '/api/customers' && o.method == 'POST') return (201, {'customer': {'id': 'c10'}});
        if (o.uri.path == '/api/whatsapp/leads/l1/convert' && o.method == 'POST') return (200, {'lead': _lead()});
        return handler(o, b);
      });
      await _tapText(t, 'Convert to customer');
      expect(find.text('Create and link'), findsOneWidget);
      await _type(t, 'GSTIN (optional)', '27aaapz1234a1z5');
      await t.ensureVisible(find.text('Create and link'));
      await t.tap(find.text('Create and link'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 600)); // the save button spins while the question is open
      expect(find.text('Add Ravi Traders as a customer?'), findsOneWidget);
      await _sheet(t, 'Create and link');
      final created = requestsOf(sent, 'POST', '/api/customers').single.data as Map;
      expect(created, {'name': 'Ravi Traders', 'phone': '919876510004', 'gstin': '27AAAPZ1234A1Z5'});
      expectNoIdentity(created);
      expect(requestsOf(sent, 'POST', '/api/whatsapp/leads/l1/convert').single.data, {'customer_id': 'c10'});
      expect(find.byType(CustomerDetailScreen), findsOneWidget);
    });

    testWidgets('Convert with a number a customer already has links that customer and says so', (t) async {
      final (_, sent) = await open(t, (o, b) {
        if (o.uri.path == '/api/whatsapp/leads/l1/convert' && o.method == 'GET') return (200, {'match': null});
        if (o.uri.path == '/api/customers' && o.method == 'POST') {
          return (409, {'customer': {'id': 'c11', 'name': 'Mehta Stores'}, 'deduplicated': true, 'error': 'A customer named Mehta Stores already uses this phone number.'});
        }
        if (o.uri.path == '/api/whatsapp/leads/l1/convert' && o.method == 'POST') return (200, {'lead': _lead()});
        return handler(o, b);
      });
      await _tapText(t, 'Convert to customer');
      await t.ensureVisible(find.text('Create and link'));
      await t.tap(find.text('Create and link'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 600));
      await _sheet(t, 'Create and link');
      expect(requestsOf(sent, 'POST', '/api/whatsapp/leads/l1/convert').single.data, {'customer_id': 'c11'});
      expect(find.text('Linked to existing customer Mehta Stores'), findsOneWidget);
      expect(find.byType(CustomerDetailScreen), findsOneWidget);
    });

    testWidgets('a failed link after an existing customer came back does not claim a customer was added', (t) async {
      await open(t, (o, b) {
        if (o.uri.path == '/api/whatsapp/leads/l1/convert' && o.method == 'GET') return (200, {'match': null});
        if (o.uri.path == '/api/customers' && o.method == 'POST') {
          return (409, {'customer': {'id': 'c11', 'name': 'Mehta Stores'}, 'deduplicated': true, 'error': 'exists'});
        }
        if (o.uri.path == '/api/whatsapp/leads/l1/convert' && o.method == 'POST') return (404, {'error': 'Lead not found'});
        return handler(o, b);
      });
      await _tapText(t, 'Convert to customer');
      await t.ensureVisible(find.text('Create and link'));
      await t.tap(find.text('Create and link'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 600));
      await _sheet(t, 'Create and link');
      expect(find.textContaining('Mehta Stores already exists as a customer'), findsOneWidget);
      expect(find.textContaining('was added'), findsNothing);
    });

    testWidgets('a refused convert shows the server text and stays on the lead', (t) async {
      final (_, sent) = await open(t, (o, b) {
        if (o.uri.path == '/api/whatsapp/leads/l1/convert' && o.method == 'GET') return (200, {'match': {'id': 'c9', 'name': 'Mehta Stores'}});
        if (o.uri.path == '/api/whatsapp/leads/l1/convert' && o.method == 'POST') return (404, {'error': 'Customer not found', 'code': 'CUSTOMER_NOT_FOUND'});
        return handler(o, b);
      });
      await _tapText(t, 'Convert to customer');
      await _sheet(t, 'Link to Mehta Stores');
      expect(find.text('Customer not found'), findsOneWidget);
      expect(find.byType(CustomerDetailScreen), findsNothing);
      expect(requestCount(sent, 'POST', '/api/whatsapp/leads/l1/convert'), 1);
    });

    testWidgets('a lead that already has a customer shows View customer, not Convert', (t) async {
      await open(t, (o, b) => handler(o, b, lead: _detail(extra: {'customer_id': 'c9'})));
      expect(find.text('Convert to customer'), findsNothing);
      await _tapText(t, 'View customer');
      expect(find.byType(CustomerDetailScreen), findsOneWidget);
    });

    testWidgets('New enquiry on an open lead asks, then posts confirm_close_open and opens the new lead', (t) async {
      final (_, sent) = await open(t, (o, b) {
        if (o.uri.path == '/api/whatsapp/leads/l1/new-enquiry') return (201, {'lead': {'id': 'l2'}});
        if (o.uri.path == '/api/whatsapp/leads/l2') return (200, {'lead': _detail(extra: {'id': 'l2', 'name': 'Ravi again'})});
        return handler(o, b);
      });
      await _tapText(t, 'New enquiry');
      expect(find.text('Start a new enquiry?'), findsOneWidget);
      await _sheet(t, 'Not now');
      expect(requestCount(sent, 'POST', '/api/whatsapp/leads/l1/new-enquiry'), 0);
      await _tapText(t, 'New enquiry');
      await _sheet(t, 'Close it and start');
      expect(requestsOf(sent, 'POST', '/api/whatsapp/leads/l1/new-enquiry').single.data, {'confirm_close_open': true});
      expect(find.text('Ravi again'), findsWidgets);
    });

    testWidgets('New enquiry on a closed lead posts without confirming until the server says the number is open', (t) async {
      final (_, sent) = await open(t, (o, b) {
        if (o.uri.path == '/api/whatsapp/leads/l1/new-enquiry') {
          return (b['confirm_close_open'] == true) ? (201, {'lead': {'id': 'l2'}}) : (409, {'error': 'This number already has an open lead', 'code': 'LEAD_OPEN'});
        }
        if (o.uri.path == '/api/whatsapp/leads/l2') return (200, {'lead': _detail(extra: {'id': 'l2', 'name': 'Ravi again'})});
        return handler(o, b, lead: _detail(extra: {'closed_at': '2026-11-05T05:00:00.000Z'}));
      });
      await _tapText(t, 'New enquiry');
      expect(find.text('Start a new enquiry?'), findsOneWidget);
      await _sheet(t, 'Close it and start');
      final posts = requestsOf(sent, 'POST', '/api/whatsapp/leads/l1/new-enquiry').toList();
      expect(posts.map((p) => p.data), [<String, dynamic>{}, {'confirm_close_open': true}]);
      expect(find.text('Ravi again'), findsWidgets);
    });

    testWidgets('Open chat opens the lead\'s chat', (t) async {
      await open(t, (o, b) => handler(o, b));
      await _tapText(t, 'Open chat');
      expect(find.byType(ChatThreadScreen), findsOneWidget);
    });
  });
}
