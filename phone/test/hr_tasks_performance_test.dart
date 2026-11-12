import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/hr/engagement_screen.dart';
import 'package:khatario_phone/screens/hr/hr_documents_screen.dart';
import 'package:khatario_phone/screens/hr/hr_more_logic.dart';
import 'package:khatario_phone/screens/hr/hr_reports_screen.dart';
import 'package:khatario_phone/screens/hr/performance_screen.dart';
import 'package:khatario_phone/screens/hr/tasks_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/form_kit.dart';

import 'support/hr_fake_api.dart';

/// A new screen each call (a same-type screen would keep its state).
Future<void> _fresh(WidgetTester t, Widget screen) => openScreen(t, KeyedSubtree(key: UniqueKey(), child: screen));

Future<void> _tapText(WidgetTester t, String text, {bool last = false}) async {
  final f = last ? find.text(text).last : find.text(text).first;
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pumpAndSettle();
}

Future<void> _confirm(WidgetTester t, String label) async {
  await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text(label)));
  await t.pumpAndSettle();
}

Future<void> _type(WidgetTester t, String label, String text) async {
  final f = find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first, matching: find.byType(TextField)).first;
  await t.enterText(f, text);
  await t.pump();
}

const _tasks = {
  'tasks': [
    {'id': 'k1', 'title': 'Count stock', 'description': 'Aisle 3', 'status': 'pending', 'priority': 'high', 'due_date': '2026-11-15', 'assigned_to': 'e1', 'assignee_name': 'Meena', 'assignee_code': 'E9'},
    {'id': 'k2', 'title': 'Clean shelves', 'description': null, 'status': 'completed', 'priority': 'low', 'due_date': null, 'assigned_to': null, 'assignee_name': null},
  ],
};

Object? _taskApi(String m, String p, Map<String, dynamic>? b) {
  if (p.startsWith('/api/tasks')) return m == 'GET' ? _tasks : <String, dynamic>{};
  if (p.startsWith('/api/employees')) {
    return {'employees': [{'id': 'e1', 'name': 'Meena', 'employee_code': 'E9'}]};
  }
  return null;
}

void main() {
  group('task logic', () {
    test('paths and bodies', () {
      expect(taskListPath(), '/api/tasks');
      expect(taskListPath(status: 'pending'), '/api/tasks?status=pending');
      expect(taskListPath(status: 'completed', priority: 'urgent'), '/api/tasks?status=completed&priority=urgent');
      expect(taskPath('k1'), '/api/tasks/k1');
      expect(taskCreateBody(title: ' Do it ', description: '', priority: 'medium'), {'title': 'Do it', 'priority': 'medium'});
      expect(taskCreateBody(title: 'T', description: 'D', priority: 'high', assignedTo: 'e1', dueDate: DateTime(2026, 11, 20)), {
        'title': 'T', 'description': 'D', 'priority': 'high', 'assigned_to': 'e1', 'due_date': '2026-11-20',
      });
      expect(taskDoneBody, {'status': 'completed'});
    });

    test('rows read the website reply', () {
      final r = taskRows(_tasks['tasks']);
      expect(r.first.assigneeName, 'Meena');
      expect(r.first.due, DateTime(2026, 11, 15));
      expect(r.first.canComplete, isTrue);
      expect(r.last.canComplete, isFalse);
    });
  });

  group('tasks screen', () {
    testWidgets('lists tasks with priority, status, assignee and due date', (t) async {
      final api = FakeHrApi(_taskApi);
      await _fresh(t, TasksScreen(session: hrSession(api)));
      expect(find.text('Count stock'), findsOneWidget);
      expect(find.text('Aisle 3'), findsOneWidget);
      expect(find.textContaining('Meena'), findsOneWidget);
      expect(find.textContaining('15 Nov 2026'), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('task-k1')), matching: find.text('High')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('task-k1')), matching: find.text('Pending')), findsOneWidget);
      expect(api.paths('GET', '/api/tasks'), ['/api/tasks']);
    });

    testWidgets('filtering by status asks the server with the website query name', (t) async {
      final api = FakeHrApi(_taskApi);
      await _fresh(t, TasksScreen(session: hrSession(api)));
      await _tapText(t, 'Completed');
      expect(api.paths('GET', '/api/tasks').last, '/api/tasks?status=completed');
      await _tapText(t, 'Urgent');
      expect(api.paths('GET', '/api/tasks').last, '/api/tasks?status=completed&priority=urgent');
    });

    testWidgets('empty, error with Try again, and not in plan', (t) async {
      await _fresh(t, TasksScreen(session: hrSession(FakeHrApi((m, p, b) => {'tasks': []}))));
      expect(find.text('No tasks found'), findsOneWidget);
      var fail = true;
      final api = FakeHrApi((m, p, b) => fail ? ApiException('Boom', status: 500) : _taskApi(m, p, b));
      await _fresh(t, TasksScreen(session: hrSession(api)));
      expect(find.text('Boom'), findsOneWidget);
      fail = false;
      await _tapText(t, 'Try again');
      expect(find.text('Count stock'), findsOneWidget);
      await _fresh(t, TasksScreen(session: hrSession(FakeHrApi((m, p, b) => ApiException('Upgrade', status: 403, code: 'FEATURE_NOT_IN_PLAN')))));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('Mark done patches the status once and reloads; done tasks have no button', (t) async {
      final api = FakeHrApi(_taskApi);
      await _fresh(t, TasksScreen(session: hrSession(api)));
      expect(find.text('Mark done'), findsOneWidget);
      await _tapText(t, 'Mark done');
      expect(api.bodies('PATCH', '/api/tasks/k1'), [{'status': 'completed'}]);
      expect(api.paths('GET', '/api/tasks').length, 2);
    });

    testWidgets('Delete asks first, names the task, deletes once and reloads', (t) async {
      final api = FakeHrApi(_taskApi);
      await _fresh(t, TasksScreen(session: hrSession(api)));
      await _tapText(t, 'Delete');
      expect(find.textContaining('Delete "Count stock"?'), findsOneWidget);
      expect(api.paths('DELETE'), isEmpty);
      await _confirm(t, 'Delete task');
      expect(api.paths('DELETE'), ['/api/tasks/k1']);
      expect(api.paths('GET', '/api/tasks').length, 2);
    });

    testWidgets('Not now keeps the task', (t) async {
      final api = FakeHrApi(_taskApi);
      await _fresh(t, TasksScreen(session: hrSession(api)));
      await _tapText(t, 'Delete');
      await _confirm(t, 'Not now');
      expect(api.paths('DELETE'), isEmpty);
    });

    testWidgets('a refused delete shows the server message', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'DELETE' ? ApiException('Task not found', status: 404) : _taskApi(m, p, b));
      await _fresh(t, TasksScreen(session: hrSession(api)));
      await _tapText(t, 'Delete');
      await _confirm(t, 'Delete task');
      expect(find.text('Task not found'), findsOneWidget);
    });

    testWidgets('a new task posts the website body with no identity fields', (t) async {
      final api = FakeHrApi(_taskApi);
      await openScreen(t, TaskFormScreen(session: hrSession(api)));
      await _type(t, 'Title', 'Reorder bags');
      await _type(t, 'Description', 'Large size');
      await t.tap(find.byType(KAsyncPickField));
      await t.pumpAndSettle();
      await t.tap(find.text('Meena').last);
      await t.pumpAndSettle();
      await _tapText(t, 'Create task', last: true);
      expect(api.bodies('POST', '/api/tasks'), [
        {'title': 'Reorder bags', 'description': 'Large size', 'priority': 'medium', 'assigned_to': 'e1'},
      ]);
    });

    testWidgets('a refused task save shows the server message', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'POST' ? ApiException('Assignee not found', status: 404) : _taskApi(m, p, b));
      await openScreen(t, TaskFormScreen(session: hrSession(api)));
      await _type(t, 'Title', 'X');
      await _tapText(t, 'Create task', last: true);
      expect(find.text('Assignee not found'), findsOneWidget);
    });
  });

  group('performance', () {
    const reply = {
      'performance': [
        {'id': 'p1', 'employee_id': 'e1', 'employee_code': 'E9', 'employee_name': 'Meena', 'designation': 'Cashier', 'period_date': '2026-11-01', 'total_sales': '120000.00', 'total_invoices': 40, 'average_invoice_value': '3000.00', 'total_commission': '1200.00', 'target_amount': '100000.00', 'achievement_percentage': '120.00'},
        {'id': 'p2', 'employee_id': 'e2', 'employee_code': 'E3', 'employee_name': 'Ravi', 'designation': null, 'period_date': '2026-11-01', 'total_sales': '1000', 'total_invoices': 2, 'average_invoice_value': '500', 'total_commission': '0', 'target_amount': null, 'achievement_percentage': null},
      ],
      'summary': {'totalSales': 121000, 'totalInvoices': 42, 'totalCommission': 1200, 'totalEmployees': 2},
    };

    test('path uses the website query names', () {
      expect(performancePath(period: 'monthly', from: DateTime(2026, 11, 1), to: DateTime(2026, 11, 10)),
          '/api/employees/performance?period_type=monthly&start_date=2026-11-01&end_date=2026-11-10');
    });

    testWidgets('shows server totals and each row', (t) async {
      final api = FakeHrApi((m, p, b) => reply);
      await _fresh(t, PerformanceScreen(session: hrSession(api), now: DateTime(2026, 11, 10)));
      expect(api.paths('GET').single, '/api/employees/performance?period_type=monthly&start_date=2026-11-01&end_date=2026-11-10');
      expect(find.text('₹1,21,000'), findsOneWidget);
      expect(find.text('42'), findsOneWidget);
      expect(find.text('Meena'), findsOneWidget);
      expect(find.textContaining('120.0%'), findsOneWidget);
      expect(find.textContaining('₹1,00,000'), findsOneWidget);
      expect(find.text('Ravi'), findsOneWidget);
    });

    testWidgets('changing the period asks the server again', (t) async {
      final api = FakeHrApi((m, p, b) => reply);
      await _fresh(t, PerformanceScreen(session: hrSession(api), now: DateTime(2026, 11, 10)));
      await _tapText(t, 'Weekly');
      expect(api.paths('GET').last, contains('period_type=weekly'));
    });

    testWidgets('empty, error with Try again and not in plan', (t) async {
      await _fresh(t, PerformanceScreen(session: hrSession(FakeHrApi((m, p, b) => {'performance': [], 'summary': {}})), now: DateTime(2026, 11, 10)));
      expect(find.text('No performance data found'), findsOneWidget);
      await _fresh(t, PerformanceScreen(session: hrSession(FakeHrApi((m, p, b) => ApiException('Down', status: 500))), now: DateTime(2026, 11, 10)));
      expect(find.text('Try again'), findsOneWidget);
      await _fresh(t, PerformanceScreen(session: hrSession(FakeHrApi((m, p, b) => ApiException('Upgrade', status: 403, code: 'FEATURE_NOT_IN_PLAN'))), now: DateTime(2026, 11, 10)));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });

  group('routes', () {
    final s = AppSession(KhatarioApi(Dio()), {'user': {'id': 'u'}, 'business': {'id': 'b'}});

    test('the five links open their own screens', () {
      expect(nativeScreenFor(s, '/hr/engagement'), isA<EngagementScreen>());
      expect(nativeScreenFor(s, '/hr/documents'), isA<HrDocumentsScreen>());
      expect(nativeScreenFor(s, '/hr/reports'), isA<HrReportsScreen>());
      expect(nativeScreenFor(s, '/employees/performance'), isA<PerformanceScreen>());
      expect(nativeScreenFor(s, '/employees/tasks'), isA<TasksScreen>());
      expect(nativeScreenFor(s, '/employees/tasks/new'), isA<TaskFormScreen>());
    });

    test('each HR link has a native screen', () {
      for (final h in ['/hr/engagement', '/hr/documents', '/hr/reports', '/employees/performance', '/employees/tasks']) {
        expect(routeTier(s, h), RouteTier.native, reason: h);
      }
    });
  });
}
