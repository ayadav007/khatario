import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/tools/todo_logic.dart';
import 'package:khatario_phone/screens/tools/todo_screen.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

final _now = DateTime(2026, 11, 12, 10, 0);

Map<String, dynamic> _todo(
  String id,
  String title, {
  String status = 'pending',
  String priority = 'medium',
  DateTime? due,
  String? assignedTo,
  String reminderType = 'once',
  String? description,
}) => {
  'id': id,
  'title': title,
  'description': description,
  'status': status,
  'priority': priority,
  'due_date': (due ?? DateTime.now().add(const Duration(days: 3)))
      .toUtc()
      .toIso8601String(),
  'reminder_type': reminderType,
  'reminder_time': (due ?? DateTime.now().add(const Duration(days: 3)))
      .toUtc()
      .toIso8601String(),
  'assigned_to': assignedTo,
};

final _todos = [
  _todo(
    't1',
    'Call the transporter',
    priority: 'high',
    description: 'About the Surat lorry',
  ),
  _todo(
    't2',
    'Pay rent',
    status: 'overdue',
    due: DateTime.now().subtract(const Duration(days: 2)),
  ),
];

Reply _handler(RequestOptions o, Map b) {
  final p = o.uri.path;
  if (p == '/api/todos' && o.method == 'GET') return (200, _todos);
  if (p == '/api/todos/stats') {
    return (200, {'today': 1, 'upcoming': 4, 'overdue': 2, 'high_priority': 0});
  }
  if (p == '/api/todos/users') {
    return (
      200,
      {
        'users': [
          {'id': 'u', 'name': 'Owner', 'display_name': 'Owner'},
          {'id': 'u2', 'name': 'Ravi', 'display_name': 'Ravi (E001)'},
        ],
      },
    );
  }
  if (p.startsWith('/api/todos/') && o.method == 'GET') {
    return (200, {'todo': _todos.first, 'history': []});
  }
  return (200, <String, dynamic>{});
}

Finder _icon(String label) =>
    find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == label);

Future<void> _type(WidgetTester t, String label, String text) async {
  final f = find
      .descendant(
        of: find
            .ancestor(of: find.text(label), matching: find.byType(Column))
            .first,
        matching: find.byType(TextField),
      )
      .first;
  await t.ensureVisible(f);
  await t.enterText(f, text);
  await t.pump();
}

void main() {
  group('to-do logic', () {
    test('paths and the five views follow the website', () {
      expect(todosViewPath('overdue'), '/api/todos?view=overdue');
      expect(todoStatsPath, '/api/todos/stats');
      expect(todoUsersPath, '/api/todos/users');
      expect(todoPath('a b'), '/api/todos/a%20b');
      expect(todoSnoozePath('t1'), '/api/todos/t1/snooze');
      expect(todoViews.map((v) => v.$2), [
        'Today',
        'Upcoming',
        'Overdue',
        'Completed',
        'High Priority',
      ]);
      expect(todoViews.map((v) => v.$1), [
        'today',
        'upcoming',
        'overdue',
        'completed',
        'high_priority',
      ]);
    });

    test('rows, stats and users parse; a row with no id is skipped', () {
      final items = todoItems([
        ..._todos,
        {'title': 'no id'},
      ]);
      expect(items.map((i) => i.id), ['t1', 't2']);
      expect(items.first.priority, 'high');
      expect(items.first.description, 'About the Surat lorry');
      expect(todoItems({'error': 'x'}), isEmpty);
      final s = TodoStats.fromJson({
        'today': '2',
        'upcoming': 3,
        'overdue': null,
        'high_priority': 1,
      });
      expect((s.today, s.upcoming, s.overdue, s.highPriority), (2, 3, 0, 1));
      expect(s.countFor('overdue'), 0);
      expect(s.countFor('completed'), 0);
      expect(s.countFor('high_priority'), 1);
      final users = todoUsers({
        'users': [
          {'id': 'u2', 'name': 'Ravi', 'display_name': 'Ravi (E001)'},
          {'name': 'x'},
        ],
      });
      expect(users.single.id, 'u2');
      expect(users.single.label, 'Ravi (E001)');
    });

    test('search looks in the title and the description', () {
      final items = todoItems(_todos);
      expect(filterTodos(items, 'TRANSPORTER').map((i) => i.id), ['t1']);
      expect(filterTodos(items, 'surat').map((i) => i.id), ['t1']);
      expect(filterTodos(items, '  ').length, 2);
      expect(filterTodos(items, 'zzz'), isEmpty);
    });

    test('due labels say Today, Tomorrow, Overdue or the date', () {
      expect(
        todoDueLabel(DateTime(2026, 11, 12, 17, 0), _now),
        'Today, 5:00 PM',
      );
      expect(
        todoDueLabel(DateTime(2026, 11, 13, 9, 30), _now),
        'Tomorrow, 9:30 AM',
      );
      expect(
        todoDueLabel(DateTime(2026, 11, 8, 9, 30), _now),
        'Overdue • Nov 8, 9:30 AM',
      );
      expect(
        todoDueLabel(DateTime(2026, 11, 20, 12, 0), _now),
        'Nov 20, 12:00 PM',
      );
    });

    test('the smart reminder is the website rule: never sooner than two minutes from now', () {
      expect(
        smartReminder(DateTime(2026, 11, 12, 15, 0), _now),
        DateTime(2026, 11, 12, 14, 0),
      );
      expect(
        smartReminder(DateTime(2026, 11, 12, 10, 30), _now),
        DateTime(2026, 11, 12, 10, 5),
      );
      expect(
        smartReminder(DateTime(2026, 11, 12, 10, 8), _now),
        DateTime(2026, 11, 12, 10, 8),
      );
      expect(
        smartReminder(DateTime(2026, 11, 12, 10, 1), _now),
        DateTime(2026, 11, 12, 10, 2),
      );
      expect(
        smartReminder(DateTime(2026, 11, 12, 9, 0), _now),
        DateTime(2026, 11, 12, 10, 5),
      );
    });

    test(
      'presets are at due time, 10 or 30 minutes before, or an hour before',
      () {
        final due = DateTime(2026, 11, 14, 17, 0);
        expect(reminderFor('at_due', due, _now), due);
        expect(reminderFor('m10', due, _now), DateTime(2026, 11, 14, 16, 50));
        expect(reminderFor('m30', due, _now), DateTime(2026, 11, 14, 16, 30));
        expect(reminderFor('h1', due, _now), DateTime(2026, 11, 14, 16, 0));
        expect(reminderFor('smart', due, _now), DateTime(2026, 11, 14, 16, 0));
        expect(
          reminderFor('h1', DateTime(2026, 11, 12, 10, 30), _now),
          DateTime(2026, 11, 12, 10, 2),
        );
        expect(todoReminderPresets.map((p) => p.$2), [
          'Smart default',
          'At due time',
          '10 min before',
          '30 min before',
          '1 hour before',
        ]);
      },
    );

    test('time slots run in half hours with am and pm labels', () {
      expect(todoTimeSlots.length, 48);
      expect(todoTimeSlots.first, ('00:00', '12:00 AM'));
      expect(todoTimeSlots[34], ('17:00', '5:00 PM'));
      expect(todoSlotOf(DateTime(2026, 1, 1, 17, 0)), '17:00');
      expect(todoSlotOf(DateTime(2026, 1, 1, 17, 20)), '17:20');
      expect(
        todoDueAt(DateTime(2026, 11, 14), '17:30'),
        DateTime(2026, 11, 14, 17, 30),
      );
    });

    test('the add body has the website fields and never an identity key', () {
      final due = DateTime(2026, 11, 14, 17, 0);
      final body = todoCreateBody(
        title: '  Call Ravi ',
        description: ' notes ',
        due: due,
        priority: 'high',
        reminderType: 'once',
        preset: 'm30',
        whatsapp: true,
        assignedTo: 'u2',
        now: _now,
      );
      expect(body, {
        'title': 'Call Ravi',
        'description': 'notes',
        'due_date': due.toUtc().toIso8601String(),
        'priority': 'high',
        'reminder_type': 'once',
        'reminder_time': DateTime(
          2026,
          11,
          14,
          16,
          30,
        ).toUtc().toIso8601String(),
        'reminder_channels': ['in_app', 'whatsapp'],
        'assigned_to': 'u2',
      });
      expectNoIdentity(body);
      final none = todoCreateBody(
        title: 'x',
        description: '',
        due: due,
        priority: 'low',
        reminderType: 'none',
        preset: 'smart',
        whatsapp: true,
        assignedTo: null,
        now: _now,
      );
      expect(none.containsKey('reminder_time'), isFalse);
      expect(none['reminder_channels'], ['in_app']);
      expect(none.containsKey('assigned_to'), isFalse);
      expect(none['description'], '');
    });

    test('the title is required and at most 255 characters', () {
      expect(todoTitleError(' '), 'Title is required');
      expect(todoTitleError('a' * 256), 'Title must be at most 255 characters');
      expect(todoTitleError('a' * 255), isNull);
    });

    test('the edit body sends only what changed; a new due time carries the reason and a matching reminder', () {
      final todo = todoItems([
        _todo(
          't1',
          'Call',
          due: DateTime(2026, 11, 14, 17, 0),
          priority: 'medium',
          assignedTo: 'u',
        ),
      ]).single;
      expect(
        todoEditBody(
          todo,
          title: 'Call',
          description: '',
          due: DateTime(2026, 11, 14, 17, 0),
          priority: 'medium',
          assignedTo: 'u',
          now: _now,
        ),
        isEmpty,
      );
      final b = todoEditBody(
        todo,
        title: 'Call now',
        description: 'x',
        due: DateTime(2026, 11, 15, 9, 0),
        priority: 'high',
        assignedTo: '',
        now: _now,
      );
      expect(b['title'], 'Call now');
      expect(b['description'], 'x');
      expect(b['priority'], 'high');
      expect(b['assigned_to'], '');
      expect(
        b['due_date'],
        DateTime(2026, 11, 15, 9, 0).toUtc().toIso8601String(),
      );
      expect(b.containsKey('reason'), isFalse);
      expect(
        b['reminder_time'],
        DateTime(2026, 11, 15, 9, 0).toUtc().toIso8601String(),
      );
      expectNoIdentity(b);
    });

    test('done, reopen and snooze bodies', () {
      expect(todoStatusBody(done: true), {'status': 'completed'});
      expect(todoStatusBody(done: false), {'status': 'pending'});
      expect(todoSnoozeBody(10, _now), {
        'snooze_until': DateTime(
          2026,
          11,
          12,
          10,
          10,
        ).toUtc().toIso8601String(),
      });
      expect(todoSnoozeOptions.map((o) => (o.$1, o.$2)), [
        (10, 'Snooze 10 min'),
        (60, 'Snooze 1 hour'),
        (1440, 'Snooze tomorrow'),
      ]);
    });
  });

  group('routes', () {
    test('/tools/todo opens the to-do screen and is no longer generic', () {
      final (session, _) = recordedSession(_handler);
      expect(nativeScreenFor(session, '/tools/todo'), isA<TodoScreen>());
      expect(stillGeneric, isEmpty);
    });
  });

  group('to-do screen', () {
    testWidgets('lists today with the counts and sends no identity', (t) async {
      final (session, sent) = recordedSession(_handler);
      await pumpScreen(t, TodoScreen(session: session));
      expect(find.text('Call the transporter'), findsOneWidget);
      expect(find.text('Pay rent'), findsOneWidget);
      expect(find.text('Today (1)'), findsOneWidget);
      expect(find.text('Upcoming (4)'), findsOneWidget);
      expect(find.text('Overdue (2)'), findsOneWidget);
      expect(find.text('High Priority'), findsOneWidget);
      expect(
        requestsOf(sent, 'GET', '/api/todos').single.uri.query,
        'view=today',
      );
      for (final o in sent) {
        expect(o.uri.query.contains('business_id'), isFalse);
        expect(o.uri.query.contains('user_id'), isFalse);
      }
    });

    testWidgets(
      'a view chip loads that view and search narrows without another request',
      (t) async {
        final (session, sent) = recordedSession(_handler);
        await pumpScreen(t, TodoScreen(session: session));
        await t.tap(find.text('Overdue (2)'));
        await t.pumpAndSettle();
        expect(
          requestsOf(sent, 'GET', '/api/todos').last.uri.query,
          'view=overdue',
        );
        final before = requestCount(sent, 'GET', '/api/todos');
        await t.enterText(find.byType(TextField).first, 'rent');
        await t.pumpAndSettle();
        expect(find.text('Call the transporter'), findsNothing);
        expect(find.text('Pay rent'), findsOneWidget);
        expect(requestCount(sent, 'GET', '/api/todos'), before);
      },
    );

    testWidgets('empty, server error with Try again, and not in the plan', (
      t,
    ) async {
      final (empty, _) = recordedSession(
        (o, b) =>
            o.uri.path == '/api/todos' ? (200, <dynamic>[]) : _handler(o, b),
      );
      await pumpScreen(t, TodoScreen(session: empty));
      expect(find.text('Nothing here'), findsOneWidget);

      var fail = true;
      final (flaky, sent) = recordedSession(
        (o, b) => fail && o.uri.path == '/api/todos'
            ? (500, {'error': 'Boom'})
            : _handler(o, b),
      );
      await pumpScreen(t, TodoScreen(session: flaky));
      expect(find.text('Could not load your to-do list'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Pay rent'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/todos'), 2);

      final (locked, _) = recordedSession(
        (o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}),
      );
      await pumpScreen(t, TodoScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(_icon('Add to-do'), findsNothing);
    });

    testWidgets(
      'the tick marks it done once, with only the status in the body',
      (t) async {
        final (session, sent) = recordedSession(_handler);
        await pumpScreen(t, TodoScreen(session: session));
        await t.tap(_icon('Mark done').first);
        await t.tap(_icon('Mark done').first, warnIfMissed: false);
        await t.pumpAndSettle();
        expect(requestCount(sent, 'PATCH', '/api/todos/t1'), 1);
        final body = lastBody(sent, 'PATCH', '/api/todos/t1');
        expect(body, {'status': 'completed'});
        expectNoIdentity(body);
        expect(requestCount(sent, 'GET', '/api/todos'), 2);
      },
    );

    testWidgets('a refused change shows the server reason and reloads', (
      t,
    ) async {
      final (session, sent) = recordedSession(
        (o, b) => o.method == 'PATCH'
            ? (404, {'error': 'Todo not found'})
            : _handler(o, b),
      );
      await pumpScreen(t, TodoScreen(session: session));
      await t.tap(_icon('Mark done').first);
      await t.pumpAndSettle();
      expect(find.text('Todo not found'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/todos'), 2);
    });

    testWidgets('the detail page snoozes by the website options', (t) async {
      final (session, sent) = recordedSession(_handler);
      await pumpScreen(t, TodoScreen(session: session));
      await t.tap(find.text('Call the transporter'));
      await t.pumpAndSettle();
      expect(find.text('About the Surat lorry'), findsWidgets);
      expect(find.text('Snooze 10 min'), findsOneWidget);
      expect(find.text('Snooze 1 hour'), findsOneWidget);
      expect(find.text('Snooze tomorrow'), findsOneWidget);
      await t.ensureVisible(find.text('Snooze 1 hour'));
      await t.tap(find.text('Snooze 1 hour'));
      await t.tap(find.text('Snooze 1 hour'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/todos/t1/snooze'), 1);
      final body = lastBody(sent, 'POST', '/api/todos/t1/snooze');
      expect(body.keys, ['snooze_until']);
      final until = DateTime.parse(body['snooze_until'] as String);
      expect(
        until.difference(DateTime.now()).inMinutes,
        inInclusiveRange(58, 61),
      );
    });

    testWidgets(
      'a refused snooze keeps the detail page open, shows the reason and reloads it',
      (t) async {
        final (session, sent) = recordedSession(
          (o, b) => o.method == 'POST'
              ? (404, {'error': 'Todo not found'})
              : _handler(o, b),
        );
        await pumpScreen(t, TodoScreen(session: session));
        await t.tap(find.text('Call the transporter'));
        await t.pumpAndSettle();
        await t.ensureVisible(find.text('Snooze 10 min'));
        await t.tap(find.text('Snooze 10 min'));
        await t.pumpAndSettle();
        expect(find.text('Todo not found'), findsOneWidget);
        expect(find.text('Snooze 10 min'), findsOneWidget);
        expect(find.byType(TodoDetailScreen), findsOneWidget);
        expect(requestCount(sent, 'GET', '/api/todos/t1'), 2);
      },
    );

    testWidgets('a refused Mark complete also stays on the detail page', (
      t,
    ) async {
      final (session, _) = recordedSession(
        (o, b) => o.method == 'PATCH'
            ? (400, {'error': 'status must be one of: pending'})
            : _handler(o, b),
      );
      await pumpScreen(t, TodoScreen(session: session));
      await t.tap(find.text('Call the transporter'));
      await t.pumpAndSettle();
      await t.tap(find.text('Mark complete'));
      await t.pumpAndSettle();
      expect(find.text('status must be one of: pending'), findsOneWidget);
      expect(find.byType(TodoDetailScreen), findsOneWidget);
    });

    testWidgets(
      'Add to-do checks the title, then posts the website fields once and assigns to the person picked',
      (t) async {
        final (session, sent) = recordedSession(
          (o, b) => o.method == 'POST' ? (200, {'id': 'n1'}) : _handler(o, b),
        );
        await pumpScreen(t, TodoScreen(session: session));
        await t.tap(_icon('Add to-do'));
        await t.pumpAndSettle();
        await t.tap(find.text('Save to-do'));
        await t.pumpAndSettle();
        expect(find.text('Title is required'), findsOneWidget);
        expect(requestCount(sent, 'POST', '/api/todos'), 0);

        await _type(t, 'Title', 'Order stock');
        await t.ensureVisible(find.text('Myself'));
        await t.tap(find.text('Myself'));
        await t.pumpAndSettle();
        await t.tap(inSheet('Ravi (E001)'));
        await t.pumpAndSettle();
        await t.tap(find.text('Save to-do'));
        await t.tap(find.text('Save to-do'), warnIfMissed: false);
        await t.pumpAndSettle();
        expect(requestCount(sent, 'POST', '/api/todos'), 1);
        final body = lastBody(sent, 'POST', '/api/todos');
        expect(body['title'], 'Order stock');
        expect(body['assigned_to'], 'u2');
        expect(body['priority'], 'medium');
        expect(body['reminder_type'], 'once');
        expect(body['reminder_channels'], ['in_app']);
        expect(body['due_date'], isA<String>());
        expectNoIdentity(body);
        expect(requestCount(sent, 'GET', '/api/todos'), 2);
      },
    );

    testWidgets('a refused save shows the reason and stays on the form', (
      t,
    ) async {
      final (session, _) = recordedSession(
        (o, b) => o.method == 'POST'
            ? (400, {'error': 'assigned_to must be a user of this business'})
            : _handler(o, b),
      );
      await pumpScreen(t, TodoScreen(session: session));
      await t.tap(_icon('Add to-do'));
      await t.pumpAndSettle();
      await _type(t, 'Title', 'x');
      await t.tap(find.text('Save to-do'));
      await t.pumpAndSettle();
      expect(
        find.text('assigned_to must be a user of this business'),
        findsOneWidget,
      );
      expect(find.text('Save to-do'), findsOneWidget);
    });

    testWidgets('Edit patches only the changed title', (t) async {
      final (session, sent) = recordedSession(_handler);
      await pumpScreen(t, TodoScreen(session: session));
      await t.tap(find.text('Call the transporter'));
      await t.pumpAndSettle();
      await t.ensureVisible(find.text('Edit'));
      await t.tap(find.text('Edit'));
      await t.pumpAndSettle();
      expect(find.text('Edit to-do'), findsOneWidget);
      await _type(t, 'Title', 'Call the transporter today');
      await t.tap(find.text('Save to-do'));
      await t.pumpAndSettle();
      final body = lastBody(sent, 'PATCH', '/api/todos/t1');
      expect(body, {'title': 'Call the transporter today'});
      expectNoIdentity(body);
    });
  });
}
