import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/hr/attendance_screen.dart';
import 'package:khatario_phone/screens/hr/leave_logic.dart';
import 'package:khatario_phone/screens/hr/leaves_screen.dart';
import 'package:khatario_phone/screens/hr/roll_call_logic.dart';
import 'package:khatario_phone/screens/hr/salary_payments_logic.dart';
import 'package:khatario_phone/screens/hr/salary_payments_screen.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/pages/record_page.dart';
import 'package:khatario_phone/screens/pages/website_page_screen.dart';
import 'package:khatario_phone/screens/whatsapp/order_verification_logic.dart';
import 'package:khatario_phone/screens/whatsapp/order_verification_screen.dart';
import 'package:khatario_phone/session.dart';

/// A session whose server answers every request with [reply] and records what was sent.
(AppSession, List<RequestOptions>) fakeSession(Object? Function(RequestOptions o) reply) {
  final sent = <RequestOptions>[];
  final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
  dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
    sent.add(o);
    h.resolve(Response(requestOptions: o, statusCode: 200, data: reply(o)));
  }));
  return (AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b'}}), sent);
}

void main() {
  final (session, _) = fakeSession((_) => <String, dynamic>{});

  test('HR and Connect pages open their own phone screens', () {
    expect(dedicatedPageScreen(session, '/employees/attendance'), isA<AttendanceScreen>());
    expect(dedicatedPageScreen(session, '/employees/leaves'), isA<LeavesScreen>());
    expect(dedicatedPageScreen(session, '/employees/salary/payments'), isA<SalaryPaymentsScreen>());
    expect(dedicatedPageScreen(session, '/whatsapp/orders'), isA<OrderVerificationScreen>());
  });

  test('pages without a phone screen open the website, signed in, inside the app', () {
    final page = pageForHref('/employees/new')!;
    expect(page.path.startsWith('/api'), isFalse);
    expect(websiteUri('/employees/new').path, '/employees/new');
    expect(websiteUri('docs').path, '/docs');
  });

  group('roll call', () {
    final rows = rollCallRows([
      {'id': 'e1', 'name': 'Asha', 'attendance_status': 'present'},
      {'id': 'e2', 'name': '', 'employee_code': 'EMP-2', 'attendance_status': null},
      {'id': 'e3', 'name': 'Ravi', 'attendance_status': 'half_day'},
      {'id': 'e4', 'name': 'Meena', 'attendance_status': 'leave'},
      {'name': 'no id'},
    ]);

    test('reads the team and counts like the website', () {
      expect(rows.map((r) => r.name), ['Asha', 'EMP-2', 'Ravi', 'Meena']);
      final s = rollCallSummary(rows);
      expect((s.present, s.pending, s.half, s.absent, s.total), (1, 1, 1, 1, 4));
    });

    test('mark all present only fills people not yet marked', () {
      expect(markAllPresentMarks(rows), [
        {'employee_id': 'e2', 'status': 'present'},
      ]);
    });

    test('day label', () {
      final now = DateTime(2026, 10, 18, 15);
      expect(rollCallDayLabel(DateTime(2026, 10, 18), now), 'Today');
      expect(rollCallDayLabel(DateTime(2026, 10, 17), now), 'Yesterday');
      expect(rollCallDayLabel(DateTime(2026, 10, 16), now), 'Fri, 16 Oct');
    });
  });

  test('leave rows', () {
    final rows = leaveRows([
      {'id': 'l1', 'employee_name': 'Asha', 'leave_name': 'Casual', 'start_date': '2026-10-20T00:00:00.000Z', 'end_date': '2026-10-22', 'total_days': '3', 'status': 'pending', 'reason': 'Wedding'},
      {'id': 'l2', 'employee_code': 'EMP-2', 'start_date': '2026-10-30', 'end_date': '2026-11-02', 'total_days': 0.5, 'status': 'rejected'},
    ]);
    expect(rows.first.isPending, isTrue);
    expect(leaveDates(rows.first), '20–22 Oct');
    expect(leaveDays(rows.first.days), '3 days');
    expect(rows.last.employeeName, 'EMP-2');
    expect(leaveDates(rows.last), '30 Oct – 2 Nov');
    expect(leaveDays(rows.last.days), '0.5 days');
    expect(leaveStatusLabel('on_hold'), 'On hold');
  });

  test('WhatsApp order rows', () {
    final rows = whatsAppOrderRows([
      {
        'id': 'o1',
        'order_number': 'SO-7',
        'customer_name': 'Mehta Stores',
        'grand_total': '1180.50',
        'order_date': '2026-10-17',
        'whatsapp_phone': '9198',
        'items': [
          {'item_name': 'Rice 5kg', 'quantity': '2.000'},
        ],
      },
    ]);
    expect(rows.single.number, 'SO-7');
    expect(rows.single.total, 1180.5);
    expect(rows.single.lines, ['2 × Rice 5kg']);
  });

  test('salary payments group by month', () {
    final rows = salaryPaymentRows([
      {'id': 's1', 'employee_name': 'Asha', 'salary_month': '2026-10', 'net_salary': '12000', 'status': 'paid'},
      {'id': 's2', 'employee_name': 'Ravi', 'salary_month': '2026-10', 'net_salary': 8000, 'status': 'paid'},
      {'id': 's3', 'employee_name': 'Asha', 'salary_month': '2026-09', 'net_salary': 11000},
    ]);
    final months = salaryMonths(rows);
    expect(months.map((m) => m.month), ['2026-10', '2026-09']);
    expect(months.first.total, 20000);
    expect(salaryMonthLabel('2026-10'), 'October 2026');
    expect(salaryMonthLabel('February 2024'), 'February 2024');
  });

  testWidgets('attendance shows the roll call and saves a tap', (tester) async {
    final (s, sent) = fakeSession((o) => o.method == 'GET'
        ? {
            'team': [
              {'id': 'e1', 'name': 'Asha Rao', 'attendance_status': null},
            ],
          }
        : {'success': true});
    await tester.pumpWidget(MaterialApp(home: AttendanceScreen(session: s)));
    await tester.pumpAndSettle();
    expect(find.text('Asha Rao'), findsOneWidget);
    expect(find.text('1 not marked'), findsOneWidget);
    await tester.tap(find.text('Present').first);
    await tester.pumpAndSettle();
    final put = sent.lastWhere((o) => o.method == 'PUT');
    expect(put.path, '/api/employees/manager/attendance');
    expect((put.data as Map)['status'], 'present');
    expect(find.text('1 present'), findsOneWidget);
  });

  testWidgets('attendance with no one to mark offers to add an employee', (tester) async {
    final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) => h.resolve(Response(
          requestOptions: o,
          statusCode: 403,
          data: {'error': 'You do not have permission to mark attendance or there are no active employees.'},
        ))));
    final s = AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b'}});
    await tester.pumpWidget(MaterialApp(home: AttendanceScreen(session: s)));
    await tester.pumpAndSettle();
    expect(find.text('No employees to mark yet'), findsOneWidget);
    expect(find.text('Add employee'), findsOneWidget);
  });
}
