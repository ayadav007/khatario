import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/format.dart';
import 'package:khatario_phone/screens/accounting/activity_logs_logic.dart';
import 'package:khatario_phone/screens/accounting/activity_logs_screen.dart';
import 'package:khatario_phone/screens/invoices/invoice_detail_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _log(String id, String at, {String action = 'create', String module = 'invoices', String? user = 'Asha', String? userId = 'u1', String description = 'Created invoice INV-1', Map<String, dynamic> extra = const {}}) => {
      'id': id,
      'created_at': at,
      'action_type': action,
      'module': module,
      'user_name': user,
      'user_id': userId,
      'description': description,
      ...extra,
    };

void main() {
  group('activity log logic', () {
    test('the request carries the date range, the filters and the limit, and the whole end day counts', () {
      final path = activityPath(from: DateTime(2026, 11, 3), to: DateTime(2026, 11, 10), module: 'invoices', action: 'delete', userId: 'u2', limit: 200);
      final uri = Uri.parse(path);
      expect(uri.path, '/api/activity-logs');
      expect(uri.queryParameters, {
        'start_date': '2026-11-03',
        'end_date': '2026-11-10 23:59:59',
        'module': 'invoices',
        'action_type': 'delete',
        'user_id': 'u2',
        'limit': '200',
      });
      expect(Uri.parse(activityPath(from: DateTime(2026, 11, 3), to: DateTime(2026, 11, 10))).queryParameters.keys.toSet(), {'start_date', 'end_date', 'limit'});
    });

    test('the dates start a week back, as on the website', () {
      expect(activityDefaultFrom(DateTime(2026, 11, 10)), DateTime(2026, 11, 3));
    });

    test('it pages by asking for more rows, and only while the last ask came back full', () {
      expect(activityHasMore(100, 100), isTrue);
      expect(activityHasMore(37, 100), isFalse);
      expect(activityNextLimit(100), 200);
    });

    test('the people list is the users the server sent, each with an id and a name', () {
      expect(activityPeople({'users': [{'id': 'u1', 'name': 'Asha'}, {'id': 'u2', 'name': 'Ravi', 'email': 'r@x.in'}, {'id': '', 'name': 'x'}, {'id': 'u3'}]}), [('u1', 'Asha'), ('u2', 'Ravi')]);
      expect(activityPeople({}), isEmpty);
    });


    test('rows group by day, newest first', () {
      final rows = [_log('old', '2026-11-08T09:00:00'), _log('b', '2026-11-09T09:00:00'), _log('a', '2026-11-09T18:00:00')];
      final groups = activityGroups(rows);
      expect([for (final g in groups) activityDayLabel(g.day)], ['09 Nov 2026', '08 Nov 2026']);
      expect([for (final r in groups.first.rows) r['id']], ['a', 'b']);
      expect(activityGroups(const []), isEmpty);
    });

    test('a row reads action and module, then the description, then the time', () {
      final r = _log('1', '2026-11-09T14:05:09', user: 'Asha', extra: {'employee_code': 'E-7'});
      expect(activityTitle(r), 'Create • invoices');
      expect(activitySubtitle(r), 'Created invoice INV-1');
      expect(activityTimeText(r), '14:05');
      expect(activityWho(r), 'Asha (E-7)');
      expect(activityWho(_log('2', '2026-11-09T14:05:09', user: null, userId: null)), '');
    });

    test('details say what, who and when, in the website words', () {
      final r = _log('1', '2026-11-09T14:05:09', extra: {'employee_code': 'E-7', 'user_email': 'asha@x.in', 'ip_address': '10.0.0.4'});
      expect(activityDetailRows(r), [
        ('Action', 'Create'),
        ('Module', 'invoices'),
        ('Description', 'Created invoice INV-1'),
        ('By', 'Asha (E-7)'),
        ('Email', 'asha@x.in'),
        ('When', '09 Nov 2026 14:05:09'),
        ('IP address', '10.0.0.4'),
      ]);
      final bare = activityDetailRows(_log('2', '2026-11-09T14:05:09', user: null, userId: null));
      expect([for (final (l, _) in bare) l], ['Action', 'Module', 'Description', 'When']);
    });

    test('only an invoice entry links to a screen the phone has', () {
      expect(activityInvoiceId(_log('1', '2026-11-09T14:05:09', extra: {'entity_type': 'invoice', 'entity_id': 'i9'})), 'i9');
      expect(activityInvoiceId(_log('1', '2026-11-09T14:05:09', extra: {'entity_id': 'i9'})), 'i9');
      expect(activityInvoiceId(_log('1', '2026-11-09T14:05:09', module: 'items', extra: {'entity_type': 'item', 'entity_id': 'x'})), isNull);
      expect(activityInvoiceId(_log('1', '2026-11-09T14:05:09')), isNull);
    });
  });

  group('activity logs screen', () {
    var rows = <Map<String, dynamic>>[];
    var loadFails = 0;
    String? failCode;

    String stamp(DateTime d, int h, int m, int s) => '${ymd(d)}T${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
    final today = dateOnly(DateTime.now());
    final yesterday = today.subtract(const Duration(days: 1));

    setUp(() {
      loadFails = 0;
      failCode = null;
      rows = [
        _log('1', stamp(today, 14, 5, 9), extra: {'employee_code': 'E-7', 'user_email': 'asha@x.in', 'ip_address': '10.0.0.4', 'entity_type': 'invoice', 'entity_id': 'i9'}),
        _log('2', stamp(today, 9, 0, 0), action: 'update', module: 'items', user: 'Ravi', userId: 'u2', description: 'Updated item Rice'),
        _log('3', stamp(yesterday, 18, 30, 0), action: 'delete', module: 'customers', description: 'Deleted customer Meena'),
      ];
    });

    Reply server(RequestOptions o, Map body) {
      if (o.method == 'GET' && o.uri.path == '/api/settings/users') {
        return (200, {'users': [{'id': 'u1', 'name': 'Asha'}, {'id': 'u2', 'name': 'Ravi'}]});
      }
      if (o.method == 'GET' && o.uri.path == '/api/activity-logs') {
        if (loadFails > 0) {
          loadFails--;
          return (failCode == null ? 500 : 403, {'error': 'Server is down', 'code': ?failCode});
        }
        final limit = int.parse(o.uri.queryParameters['limit'] ?? '100');
        final module = o.uri.queryParameters['module'];
        final user = o.uri.queryParameters['user_id'];
        final out = [for (final r in rows) if ((module == null || r['module'] == module) && (user == null || r['user_id'] == user)) r];
        return (200, {'logs': out.take(limit).toList()});
      }
      return (404, {'error': 'not found'});
    }

    Future<List<RequestOptions>> open(WidgetTester t, {int pageSize = 100}) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ActivityLogsScreen(session: session, pageSize: pageSize));
      return sent;
    }

    Future<void> pick(WidgetTester t, String label, String option) async {
      await t.tap(find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first, matching: find.byType(InkWell)).first);
      await t.pumpAndSettle();
      await t.tap(find.text(option).last);
      await t.pumpAndSettle();
    }

    testWidgets('it asks for the last week, groups by day newest first, and identifies no business', (t) async {
      final sent = await open(t);
      final q = requestsOf(sent, 'GET', '/api/activity-logs').single.uri.queryParameters;
      expect(q['start_date'], ymd(activityDefaultFrom(today)));
      expect(q['end_date'], '${ymd(today)} 23:59:59');
      expect(q['limit'], '100');
      expect(q.containsKey('business_id'), isFalse);
      expect(q.containsKey('user_id'), isFalse);
      expect(find.text(activityDayLabel(today)), findsNWidgets(2), reason: 'the To field and the day header');
      expect(find.text(activityDayLabel(yesterday)), findsOneWidget);
      expect(find.text('Create • invoices'), findsOneWidget);
      expect(find.text('Asha (E-7) · Created invoice INV-1'), findsOneWidget);
      expect(find.text('14:05'), findsOneWidget);
      final order = [for (final id in ['Create • invoices', 'Update • items', 'Delete • customers']) t.getTopLeft(find.text(id)).dy];
      expect(order[0] < order[1] && order[1] < order[2], isTrue);
    });

    testWidgets('the module filter and the person filter each ask the server again', (t) async {
      final sent = await open(t);
      await pick(t, 'Module', 'Items');
      expect(requestsOf(sent, 'GET', '/api/activity-logs').last.uri.queryParameters['module'], 'items');
      expect(find.text('Update • items'), findsOneWidget);
      expect(find.text('Create • invoices'), findsNothing);

      await pick(t, 'Module', 'All modules');
      expect(find.text('Create • invoices'), findsOneWidget);
      await pick(t, 'Person', 'Ravi');
      expect(requestsOf(sent, 'GET', '/api/activity-logs').last.uri.queryParameters['user_id'], 'u2');
      expect(find.text('Update • items'), findsOneWidget);
      expect(find.text('Create • invoices'), findsNothing);
    });

    testWidgets('changing the From date asks again from that day', (t) async {
      final sent = await open(t);
      await t.tap(find.descendant(of: find.ancestor(of: find.text('From'), matching: find.byType(Column)).first, matching: find.byType(InkWell)).first);
      await t.pumpAndSettle();
      await t.tap(find.text('1').first);
      await t.pump();
      await t.tap(find.text('OK'));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/activity-logs').last.uri.queryParameters['start_date'], endsWith('-01'));
    });

    testWidgets('Show more asks for a larger page while the last answer was full', (t) async {
      final sent = await open(t, pageSize: 2);
      expect(find.text('Show more'), findsOneWidget);
      await t.tap(find.text('Show more'));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/activity-logs').last.uri.queryParameters['limit'], '4');
      expect(find.text('Delete • customers'), findsOneWidget);
      expect(find.text('Show more'), findsNothing);
    });

    testWidgets('an entry opens its details, and an invoice entry opens the invoice', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ActivityLogsScreen(session: session));
      await t.tap(find.text('Create • invoices'));
      await t.pumpAndSettle();
      expect(inSheet('Asha (E-7)'), findsOneWidget);
      expect(inSheet('Created invoice INV-1'), findsOneWidget);
      expect(inSheet('10.0.0.4'), findsOneWidget);
      expect(inSheet('${activityDayLabel(today)} 14:05:09'), findsOneWidget);
      await t.tap(find.text('Open invoice'));
      await t.pumpAndSettle();
      expect(find.byType(InvoiceDetailScreen), findsOneWidget);
      expect(requestsOf(sent, 'GET', '/api/invoices/i9'), isNotEmpty);
    });

    testWidgets('an entry with no phone screen shows only the details', (t) async {
      await open(t);
      await t.tap(find.text('Update • items'));
      await t.pumpAndSettle();
      expect(inSheet('Updated item Rice'), findsOneWidget);
      expect(find.text('Open invoice'), findsNothing);
    });

    testWidgets('empty, server error with Try again, and plan refusal', (t) async {
      rows = [];
      await open(t);
      expect(find.text('No activity logs found'), findsOneWidget);

      loadFails = 1;
      await open(t);
      expect(find.text('Could not load activity logs'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('No activity logs found'), findsOneWidget);

      loadFails = 9;
      failCode = 'FEATURE_NOT_IN_PLAN';
      await open(t);
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('the route table opens the screen and the link is no longer generic', (t) async {
      final (session, _) = recordedSession(server);
      expect(nativeScreenFor(session, '/activity-logs'), isA<ActivityLogsScreen>());
      expect(stillGeneric.contains('/activity-logs'), isFalse);
    });
  });
}
