import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/format.dart';
import 'package:khatario_phone/screens/hr/attendance_leave_logic.dart';
import 'package:khatario_phone/screens/hr/leave_calendar_screen.dart';
import 'package:khatario_phone/screens/hr/leave_form_screen.dart';
import 'package:khatario_phone/screens/hr/leaves_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/reports/report_period.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/finders.dart';
import 'support/hr_fake_api.dart';

Finder _tapBox(bool Function(Widget w) match) => find.descendant(of: find.byWidgetPredicate(match), matching: find.byType(InkWell));

Finder _employeeField() => _tapBox((w) => w is KAsyncPickField && w.label == 'Employee');
Finder _typeField() => _tapBox((w) => w is KPickField && w.label == 'Leave type');
Finder _dateField(String label) => _tapBox((w) => w is KDateField && w.label == label);

DateTime _day(int d) {
  final now = DateTime.now();
  return DateTime(now.year, now.month, d);
}

Map<String, dynamic> _leaveEvent(String id, String date, {String status = 'approved', String name = 'Asha Rao', String code = 'EMP1', String employeeId = 'e1'}) => {
      'event_kind': 'leave',
      'id': id,
      'employee_id': employeeId,
      'start_date': '${date}T00:00:00.000Z',
      'end_date': '${date}T00:00:00.000Z',
      'total_days': '1.00',
      'status': status,
      'leave_name': 'Casual Leave',
      'employee_code': code,
      'employee_name': name,
    };

Map<String, dynamic> _absentEvent(String id, String date, {String status = 'absent', String name = 'Ravi Kumar', String code = 'EMP2', String employeeId = 'e2'}) => {
      'event_kind': 'attendance',
      'id': id,
      'employee_id': employeeId,
      'date': date,
      'status': status,
      'employee_code': code,
      'employee_name': name,
    };

void main() {
  group('leave logic', () {
    test('leave types parse into labelled options', () {
      final types = leaveTypeOptions([
        {'id': 't1', 'leave_name': 'Casual Leave', 'leave_code': 'CL'},
        {'id': 't2', 'leave_name': 'Sick Leave', 'leave_code': ''},
        {'leave_name': 'No id'},
      ]);
      expect(types.map((t) => t.label), ['Casual Leave (CL)', 'Sick Leave']);
      expect(types.first.id, 't1');
    });

    test('the days preview names the dates and the type, never a person or business', () {
      expect(
        leavePreviewPath(start: DateTime(2026, 11, 10), end: DateTime(2026, 11, 12), typeId: 't1'),
        '/api/hr/leave/preview-days?start_date=2026-11-10&end_date=2026-11-12&leave_type_id=t1',
      );
    });

    test('the preview is the server days and sandwich days', () {
      final p = LeavePreview.fromJson({'working_days': 2, 'total_days': 3, 'sandwich_days': 1});
      expect(p.totalDays, 3);
      expect(p.sandwichDays, 1);
      expect(p.daysLine, '3 days');
      expect(LeavePreview.fromJson({'total_days': 1}).daysLine, '1 day');
      expect(LeavePreview.fromJson({'total_days': '1.5'}).daysLine, '1.5 days');
    });

    test('balances are asked per employee and year', () {
      expect(leaveBalancePath('e1', 2026), '/api/employees/leave-balances?employee_id=e1&year=2026');
    });

    test('balances read the numbers the server sends, as text or numbers', () {
      final rows = leaveBalances([
        {
          'leave_type_id': 't1',
          'leave_name': 'Casual Leave',
          'leave_code': 'CL',
          'current_balance': '4.50',
          'opening_balance': '6.00',
          'earned_days': 0,
          'used_days': '1.50',
          'carry_forward_days': '0.00',
        },
      ]);
      expect(rows.single.name, 'Casual Leave');
      expect(rows.single.code, 'CL');
      expect(rows.single.current, 4.5);
      expect(rows.single.opening, 6);
      expect(rows.single.used, 1.5);
      expect(balanceFor(rows, 't1')?.current, 4.5);
      expect(balanceFor(rows, 'nope'), isNull);
    });

    test('the request body has the person, type, dates and optional text, and no ids of the caller', () {
      final body = leaveRequestBody(employeeId: 'e1', typeId: 't1', start: DateTime(2026, 11, 10), end: DateTime(2026, 11, 12), reason: ' Family ', attachmentUrl: '');
      expect(body, {'employee_id': 'e1', 'leave_type_id': 't1', 'start_date': '2026-11-10', 'end_date': '2026-11-12', 'reason': 'Family'});
      final withLink = leaveRequestBody(employeeId: 'e1', typeId: 't1', start: DateTime(2026, 11, 10), end: DateTime(2026, 11, 10), reason: '', attachmentUrl: ' https://x.test/a.pdf ');
      expect(withLink['attachment_url'], 'https://x.test/a.pdf');
      expect(withLink.containsKey('reason'), isFalse);
      for (final key in ['business_id', 'user_id', 'created_by', 'created_by_user_id']) {
        expect(body.containsKey(key), isFalse, reason: key);
      }
    });

    test('form errors are the website messages', () {
      expect(leaveFormErrors(employeeId: '', typeId: '', start: null, end: null), {
        'employee': 'Employee is required',
        'type': 'Leave type is required',
        'start': 'Start date is required',
        'end': 'End date is required',
      });
      expect(leaveFormErrors(employeeId: 'e', typeId: 't', start: DateTime(2026, 11, 12), end: DateTime(2026, 11, 10)), {
        'end': 'End date must be after start date',
      });
      expect(leaveFormErrors(employeeId: 'e', typeId: 't', start: DateTime(2026, 11, 10), end: DateTime(2026, 11, 10)), isEmpty);
    });

    test('the calendar asks for whole weeks, Sunday to Saturday, around the month', () {
      expect(leaveCalendarPath(const MonthPeriod(2026, 11)), '/api/employees/leave-calendar?start_date=2026-11-01&end_date=2026-12-05');
      expect(leaveCalendarPath(const MonthPeriod(2026, 10)), '/api/employees/leave-calendar?start_date=2026-09-27&end_date=2026-10-31');
      final days = calendarGridDays(const MonthPeriod(2026, 11));
      expect(days.length, 35);
      expect(ymd(days.first), '2026-11-01');
      expect(ymd(days.last), '2026-12-05');
    });

    test('calendar events group by date, with leave and attendance told apart', () {
      final byDate = calendarEvents({
        '2026-11-03': [_leaveEvent('l1', '2026-11-03', status: 'pending'), _absentEvent('a1', '2026-11-03', status: 'half_day')],
      });
      final events = byDate['2026-11-03']!;
      expect(events.length, 2);
      expect(events[0].isLeave, isTrue);
      expect(events[0].status, 'pending');
      expect(events[0].leaveName, 'Casual Leave');
      expect(events[0].days, 1);
      expect(events[1].isLeave, isFalse);
      expect(events[1].employeeName, 'Ravi Kumar');
    });

    test('event colours: approved green, pending amber, absent red, half day sky', () {
      CalendarEvent ev(Map<String, dynamic> j) => calendarEvents({'d': [j]})['d']!.single;
      expect(calendarTone(ev(_leaveEvent('1', '2026-11-03'))), KTone.positive);
      expect(calendarTone(ev(_leaveEvent('1', '2026-11-03', status: 'pending'))), KTone.due);
      expect(calendarTone(ev(_absentEvent('1', '2026-11-03'))), KTone.negative);
      expect(calendarTone(ev(_absentEvent('1', '2026-11-03', status: 'half_day'))), KTone.brand);
    });

    test('chips show the first name, with a half or cross mark for attendance', () {
      CalendarEvent ev(Map<String, dynamic> j) => calendarEvents({'d': [j]})['d']!.single;
      expect(ev(_leaveEvent('1', '2026-11-03')).chip, 'Asha');
      expect(ev(_absentEvent('1', '2026-11-03')).chip, 'Ravi ✕');
      expect(ev(_absentEvent('1', '2026-11-03', status: 'half_day')).chip, 'Ravi ½');
      expect(ev(_leaveEvent('1', '2026-11-03')).statusLabel, 'Approved');
      expect(ev(_absentEvent('1', '2026-11-03', status: 'half_day')).statusLabel, 'Half day');
    });
  });

  group('leave form screen', () {
    FakeHrApi server({Object? Function(String m, String p, Map<String, dynamic>? b)? onPost, String balance = '4.50', Object? types}) {
      return FakeHrApi((m, p, b) {
        if (p.startsWith('/api/leave-types')) {
          return types ??
              {
                'leave_types': [
                  {'id': 't1', 'leave_name': 'Casual Leave', 'leave_code': 'CL'},
                  {'id': 't2', 'leave_name': 'Sick Leave', 'leave_code': 'SL'},
                ],
              };
        }
        if (p.startsWith('/api/employees?')) {
          return {
            'employees': [
              {'id': 'e1', 'user_name': 'Asha Rao', 'employee_code': 'EMP1', 'designation': 'Sales'},
            ],
          };
        }
        if (p.startsWith('/api/hr/leave/preview-days')) {
          final end = Uri.parse(p).queryParameters['end_date']!;
          final long = end.endsWith('-18');
          return {'working_days': long ? 3 : 2, 'total_days': long ? 4 : 3, 'sandwich_days': 1};
        }
        if (p.startsWith('/api/employees/leave-balances')) {
          return {
            'balances': [
              {'leave_type_id': 't1', 'leave_name': 'Casual Leave', 'leave_code': 'CL', 'current_balance': balance},
            ],
          };
        }
        if (m == 'POST') return onPost?.call(m, p, b) ?? {'request': {'id': 'l9'}};
        return null;
      });
    }

    Future<void> pickDay(WidgetTester t, String field, int day) async {
      await t.tap(_dateField(field));
      await t.pumpAndSettle();
      await t.tap(find.text('$day').last);
      await t.pumpAndSettle();
      await t.tap(find.text('OK'));
      await t.pumpAndSettle();
    }

    Future<void> fill(WidgetTester t, {int start = 15, int end = 17}) async {
      await t.tap(_employeeField());
      await t.pumpAndSettle();
      await t.tap(find.text('Asha Rao'));
      await t.pumpAndSettle();
      await t.tap(_typeField());
      await t.pumpAndSettle();
      await t.tap(find.text('Casual Leave (CL)'));
      await t.pumpAndSettle();
      await pickDay(t, 'Start date', start);
      await pickDay(t, 'End date', end);
    }

    testWidgets('shows the server days and the balance once the person, type and dates are chosen', (t) async {
      final api = server();
      await openScreen(t, LeaveFormScreen(session: hrSession(api)));
      expect(api.paths('GET', '/api/hr/leave/preview-days'), isEmpty);
      await fill(t);
      expect(api.paths('GET', '/api/hr/leave/preview-days').last, leavePreviewPath(start: _day(15), end: _day(17), typeId: 't1'));
      expect(api.paths('GET', '/api/employees/leave-balances').last, leaveBalancePath('e1', _day(15).year));
      expect(find.text('Leave days (incl. sandwich)'), findsOneWidget);
      expect(find.text('3 days'), findsOneWidget);
      expect(find.text('Includes 1 sandwich day(s)'), findsOneWidget);
      expect(find.text('Available balance'), findsOneWidget);
      expect(find.text('4.5 days'), findsOneWidget);
    });

    testWidgets('the days and the balance are asked for together, not one after the other', (t) async {
      final gate = Completer<Object?>();
      final api = FakeHrApi((m, p, b) {
        if (p.startsWith('/api/leave-types')) {
          return {
            'leave_types': [
              {'id': 't1', 'leave_name': 'Casual Leave', 'leave_code': 'CL'},
            ],
          };
        }
        if (p.startsWith('/api/employees?')) {
          return {
            'employees': [
              {'id': 'e1', 'user_name': 'Asha Rao', 'employee_code': 'EMP1'},
            ],
          };
        }
        if (p.startsWith('/api/hr/leave/preview-days')) return gate.future;
        return {'balances': []};
      });
      await openScreen(t, LeaveFormScreen(session: hrSession(api)));
      await t.tap(_employeeField());
      await t.pumpAndSettle();
      await t.tap(find.text('Asha Rao'));
      await t.pumpAndSettle();
      await t.tap(_typeField());
      await t.pumpAndSettle();
      await t.tap(find.text('Casual Leave (CL)'));
      await t.pumpAndSettle();
      await pickDay(t, 'Start date', 15);
      await t.tap(_dateField('End date'));
      await t.pumpAndSettle();
      await t.tap(find.text('17').last);
      await t.pumpAndSettle();
      await t.tap(find.text('OK'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(api.paths('GET', '/api/hr/leave/preview-days'), isNotEmpty);
      expect(api.paths('GET', '/api/employees/leave-balances'), isNotEmpty);
      gate.complete({'total_days': 3, 'sandwich_days': 0});
      await t.pumpAndSettle();
    });

    testWidgets('changing a date asks the server again and shows the new days', (t) async {
      final api = server();
      await openScreen(t, LeaveFormScreen(session: hrSession(api)));
      await fill(t);
      await pickDay(t, 'End date', 18);
      expect(api.paths('GET', '/api/hr/leave/preview-days').last, leavePreviewPath(start: _day(15), end: _day(18), typeId: 't1'));
      expect(find.text('4 days'), findsOneWidget);
      expect(find.text('3 days'), findsNothing);
    });

    testWidgets('posts the request once with the typed reason and none of the caller ids', (t) async {
      final gate = Completer<Object?>();
      final api = server(onPost: (m, p, b) => gate.future);
      await openScreen(t, LeaveFormScreen(session: hrSession(api)));
      await fill(t);
      await t.enterText(textFieldLabelled('Reason (optional)'), 'Family function');
      await t.tap(find.text('Submit request'));
      await t.pump();
      await t.tap(find.text('Submit request'));
      await t.pump();
      expect(api.paths('POST'), ['/api/employees/leave-requests']);
      expect(api.bodies('POST', '/api/employees/leave-requests').single, {
        'employee_id': 'e1',
        'leave_type_id': 't1',
        'start_date': ymd(_day(15)),
        'end_date': ymd(_day(17)),
        'reason': 'Family function',
      });
      gate.complete({'request': {'id': 'l9'}});
      await t.pumpAndSettle();
      expect(find.byType(LeaveFormScreen), findsNothing);
    });

    testWidgets('an insufficient balance says so and the request cannot be sent', (t) async {
      final api = server(balance: '1.00');
      await openScreen(t, LeaveFormScreen(session: hrSession(api)));
      await fill(t);
      expect(find.text('Insufficient balance'), findsOneWidget);
      await t.tap(find.text('Submit request'));
      await t.pumpAndSettle();
      expect(api.paths('POST'), isEmpty);
    });

    testWidgets('a refused request shows the server message and keeps the form', (t) async {
      final api = server(onPost: (m, p, b) => ApiException('Leave overlaps an existing request', status: 400));
      await openScreen(t, LeaveFormScreen(session: hrSession(api)));
      await fill(t);
      await t.tap(find.text('Submit request'));
      await t.pumpAndSettle();
      expect(find.text('Leave overlaps an existing request'), findsOneWidget);
      expect(find.byType(LeaveFormScreen), findsOneWidget);
      expect(find.text('Asha Rao'), findsOneWidget);
    });

    testWidgets('an end date before the start says so and asks nothing', (t) async {
      final api = server();
      await openScreen(t, LeaveFormScreen(session: hrSession(api)));
      await fill(t, start: 17, end: 15);
      expect(find.text('End date must be after start date'), findsOneWidget);
      expect(api.paths('GET', '/api/hr/leave/preview-days'), isEmpty);
    });

    testWidgets('a plan without leaves shows the plan message', (t) async {
      final api = server(types: ApiException('Not on your plan', status: 403, code: 'FEATURE_NOT_IN_PLAN'));
      await openScreen(t, LeaveFormScreen(session: hrSession(api)));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('a load error offers Try again', (t) async {
      var fail = true;
      final api = FakeHrApi((m, p, b) => fail ? ApiException('Boom', status: 500) : {'leave_types': []});
      await openScreen(t, LeaveFormScreen(session: hrSession(api)));
      expect(find.text('Boom'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Boom'), findsNothing);
    });
  });

  group('leave balances screen', () {
    FakeHrApi server({Object? balances}) => FakeHrApi((m, p, b) {
          if (p.startsWith('/api/employees?')) {
            return {
              'employees': [
                {'id': 'e1', 'user_name': 'Asha Rao', 'employee_code': 'EMP1', 'designation': 'Sales'},
              ],
            };
          }
          if (p.startsWith('/api/employees/leave-balances')) {
            return balances ??
                {
                  'balances': [
                    {'leave_type_id': 't1', 'leave_name': 'Casual Leave', 'leave_code': 'CL', 'current_balance': '4.50', 'opening_balance': '6.00', 'earned_days': '0.00', 'used_days': '1.50', 'carry_forward_days': '0.00'},
                    {'leave_type_id': 't2', 'leave_name': 'Sick Leave', 'leave_code': 'SL', 'current_balance': '10.00', 'opening_balance': '10.00', 'earned_days': '0.00', 'used_days': '0.00', 'carry_forward_days': '0.00'},
                  ],
                };
          }
          return null;
        });

    Future<void> pickAsha(WidgetTester t) async {
      await t.tap(_tapBox((w) => w is KAsyncPickField && w.label == 'Employee'));
      await t.pumpAndSettle();
      await t.tap(find.text('Asha Rao'));
      await t.pumpAndSettle();
    }

    testWidgets('asks for an employee first, then shows their balances as the server has them', (t) async {
      final api = server();
      await openScreen(t, LeaveBalancesScreen(session: hrSession(api)));
      expect(find.text('Choose an employee to see their leave balances'), findsOneWidget);
      expect(api.paths('GET', '/api/employees/leave-balances'), isEmpty);
      await pickAsha(t);
      expect(api.paths('GET', '/api/employees/leave-balances').single, leaveBalancePath('e1', DateTime.now().year));
      expect(find.text('Casual Leave (CL)'), findsOneWidget);
      expect(find.text('4.5 days'), findsOneWidget);
      expect(find.text('Sick Leave (SL)'), findsOneWidget);
      expect(find.text('10 days'), findsOneWidget);
      expect(find.text('Opening 6 · Earned 0 · Carried 0 · Used 1.5'), findsOneWidget);
    });

    testWidgets('stepping the year asks for that year', (t) async {
      final api = server();
      await openScreen(t, LeaveBalancesScreen(session: hrSession(api)));
      await pickAsha(t);
      await t.tap(find.bySemanticsLabel('Previous year'));
      await t.pumpAndSettle();
      expect(api.paths('GET', '/api/employees/leave-balances').last, leaveBalancePath('e1', DateTime.now().year - 1));
    });

    testWidgets('no balances for the year says so', (t) async {
      final api = server(balances: {'balances': []});
      await openScreen(t, LeaveBalancesScreen(session: hrSession(api)));
      await pickAsha(t);
      expect(find.text('No leave balances for ${DateTime.now().year}'), findsOneWidget);
    });

    testWidgets('a server error offers Try again; a plan refusal shows the plan message', (t) async {
      var fail = true;
      final api = FakeHrApi((m, p, b) {
        if (p.startsWith('/api/employees?')) {
          return {
            'employees': [
              {'id': 'e1', 'user_name': 'Asha Rao', 'employee_code': 'EMP1'},
            ],
          };
        }
        return fail ? ApiException('Boom', status: 500) : {'balances': []};
      });
      await openScreen(t, LeaveBalancesScreen(session: hrSession(api)));
      await pickAsha(t);
      expect(find.text('Boom'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Boom'), findsNothing);
    });

    testWidgets('a plan without leaves shows the plan message', (t) async {
      final api = FakeHrApi((m, p, b) {
        if (p.startsWith('/api/employees?')) {
          return {
            'employees': [
              {'id': 'e1', 'user_name': 'Asha Rao', 'employee_code': 'EMP1'},
            ],
          };
        }
        return ApiException('Not on your plan', status: 403, code: 'FEATURE_NOT_IN_PLAN');
      });
      await openScreen(t, LeaveBalancesScreen(session: hrSession(api)));
      await pickAsha(t);
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('opened for one employee it loads straight away', (t) async {
      final api = server();
      await openScreen(t, LeaveBalancesScreen(session: hrSession(api), employeeId: 'e1', employeeName: 'Asha Rao'));
      expect(api.paths('GET', '/api/employees/leave-balances').single, leaveBalancePath('e1', DateTime.now().year));
    });
  });

  group('leave calendar screen', () {
    FakeHrApi server({Object? Function(String p)? reply}) {
      final d10 = ymd(_day(10));
      return FakeHrApi((m, p, b) {
        if (!p.startsWith('/api/employees/leave-calendar')) return null;
        if (reply != null) return reply(p);
        return {
          'events_by_date': {
            d10: [_leaveEvent('l1', d10), _absentEvent('a1', d10)],
            ymd(_day(11)): [_leaveEvent('l2', ymd(_day(11)), status: 'pending')],
          },
        };
      });
    }

    testWidgets('asks for the month in whole weeks and shows who is off on a tapped day', (t) async {
      final api = server();
      await openScreen(t, LeaveCalendarScreen(session: hrSession(api)));
      expect(api.paths('GET').single, leaveCalendarPath(MonthPeriod.of(DateTime.now())));
      await t.tap(find.byKey(ValueKey('cal-${ymd(_day(10))}')));
      await t.pumpAndSettle();
      expect(find.text('Asha Rao'), findsOneWidget);
      expect(find.text('Casual Leave'), findsOneWidget);
      expect(find.text('Approved'), findsOneWidget);
      expect(find.text('Ravi Kumar'), findsOneWidget);
      expect(find.descendant(of: find.byType(KPill), matching: find.text('Absent')), findsOneWidget);
      expect(find.text('Marked on attendance register (absent).'), findsOneWidget);
      expect(find.text('No approved leave request — may count as LWP in payroll.'), findsOneWidget);
    });

    testWidgets('a day with nothing recorded says so', (t) async {
      final api = server();
      await openScreen(t, LeaveCalendarScreen(session: hrSession(api)));
      await t.tap(find.byKey(ValueKey('cal-${ymd(_day(12))}')));
      await t.pumpAndSettle();
      expect(find.text('Nothing recorded for this day.'), findsOneWidget);
    });

    testWidgets('the month summary counts leave and attendance marks as the website does', (t) async {
      final api = server();
      await openScreen(t, LeaveCalendarScreen(session: hrSession(api)));
      expect(find.text('2 leave · 1 attendance mark'), findsOneWidget);
    });

    testWidgets('stepping the month asks for that month', (t) async {
      final api = server();
      await openScreen(t, LeaveCalendarScreen(session: hrSession(api)));
      await t.tap(find.bySemanticsLabel('Next month'));
      await t.pumpAndSettle();
      expect(api.paths('GET').last, leaveCalendarPath(MonthPeriod.of(DateTime.now()).next));
      await t.tap(find.bySemanticsLabel('Previous month'));
      await t.pumpAndSettle();
      await t.tap(find.bySemanticsLabel('Previous month'));
      await t.pumpAndSettle();
      expect(api.paths('GET').last, leaveCalendarPath(MonthPeriod.of(DateTime.now()).previous));
    });

    testWidgets('a server error offers Try again', (t) async {
      var fail = true;
      final api = FakeHrApi((m, p, b) => fail ? ApiException('Boom', status: 500) : {'events_by_date': {}});
      await openScreen(t, LeaveCalendarScreen(session: hrSession(api)));
      expect(find.text('Boom'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Boom'), findsNothing);
    });

    testWidgets('a plan without leaves shows the plan message', (t) async {
      final api = FakeHrApi((m, p, b) => ApiException('Not on your plan', status: 403, code: 'FEATURE_NOT_IN_PLAN'));
      await openScreen(t, LeaveCalendarScreen(session: hrSession(api)));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });
  });

  group('leaves screen and routes', () {
    FakeHrApi server(List<String> features, {Map<String, dynamic>? permissions}) => FakeHrApi((m, p, b) {
          if (p == '/api/features/enabled') return {'enabledIds': features};
          if (p == '/api/settings/permissions') return permissions ?? {'permissions': <String, dynamic>{}, 'isPrimaryAdmin': true};
          if (p.startsWith('/api/employees/leave-requests')) return {'requests': []};
          return null;
        });

    testWidgets('the globe is gone; apply, calendar and balances open their screens; one website row stays', (t) async {
      final api = server(['hr_leaves']);
      await openScreen(t, LeavesScreen(session: hrSession(api)));
      expect(find.bySemanticsLabel('Open on website'), findsNothing);
      expect(find.text('Open on website'), findsOneWidget);
      await t.tap(find.bySemanticsLabel('Apply leave'));
      await t.pumpAndSettle();
      expect(find.byType(LeaveFormScreen), findsOneWidget);
      await t.tap(find.bySemanticsLabel('Back'));
      await t.pumpAndSettle();
      await t.tap(find.bySemanticsLabel('Leave calendar'));
      await t.pumpAndSettle();
      expect(find.byType(LeaveCalendarScreen), findsOneWidget);
      await t.tap(find.bySemanticsLabel('Back'));
      await t.pumpAndSettle();
      await t.tap(find.bySemanticsLabel('Leave balances'));
      await t.pumpAndSettle();
      expect(find.byType(LeaveBalancesScreen), findsOneWidget);
    });

    testWidgets('a role that cannot create leave does not see Apply leave', (t) async {
      final api = server(['hr_leaves'], permissions: {
        'permissions': {
          'leaves': {'can_view': true, 'can_read': true},
        },
        'isPrimaryAdmin': false,
      });
      await openScreen(t, LeavesScreen(session: hrSession(api)));
      expect(find.bySemanticsLabel('Apply leave'), findsNothing);
      expect(find.bySemanticsLabel('Leave calendar'), findsOneWidget);
    });

    Map<String, dynamic> leave(String id, String status, String name) => {
          'id': id,
          'employee_name': name,
          'leave_name': 'Casual Leave',
          'start_date': '2026-11-10',
          'end_date': '2026-11-12',
          'total_days': '3.00',
          'status': status,
        };

    FakeHrApi withRows({Object? Function(String m, String p, Map<String, dynamic>? b)? onWrite}) => FakeHrApi((m, p, b) {
          if (p == '/api/features/enabled') return {'enabledIds': ['hr_leaves']};
          if (p == '/api/settings/permissions') return {'permissions': <String, dynamic>{}, 'isPrimaryAdmin': true};
          if (m == 'GET') {
            return {
              'requests': [leave('l1', 'pending', 'Asha Rao'), leave('l2', 'approved', 'Ravi Kumar'), leave('l3', 'rejected', 'Meena Iyer')],
            };
          }
          return onWrite?.call(m, p, b) ?? {'success': true};
        });

    testWidgets('Cancel is offered on pending and approved requests, Delete only on pending', (t) async {
      await openScreen(t, LeavesScreen(session: hrSession(withRows())));
      expect(find.text('Cancel request'), findsNWidgets(2));
      expect(find.text('Delete'), findsOneWidget);
    });

    testWidgets('cancelling asks with the name and dates, then patches the action once and reloads', (t) async {
      final api = withRows();
      await openScreen(t, LeavesScreen(session: hrSession(api)));
      await t.tap(find.text('Cancel request').first);
      await t.pumpAndSettle();
      expect(find.textContaining('Asha Rao'), findsWidgets);
      expect(find.textContaining('10–12 Nov'), findsWidgets);
      expect(api.paths('PATCH'), isEmpty);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Cancel leave')));
      await t.pumpAndSettle();
      expect(api.paths('PATCH'), ['/api/employees/leave-requests/l1']);
      expect(api.bodies('PATCH', '/api/employees/leave-requests').single, {'action': 'cancel'});
      expect(api.paths('GET', '/api/employees/leave-requests').length, 2);
    });

    testWidgets('keeping the request posts nothing', (t) async {
      final api = withRows();
      await openScreen(t, LeavesScreen(session: hrSession(api)));
      await t.tap(find.text('Cancel request').first);
      await t.pumpAndSettle();
      await t.tap(find.text('Keep it'));
      await t.pumpAndSettle();
      expect(api.paths('PATCH'), isEmpty);
    });

    testWidgets('deleting asks with the name and dates, then sends DELETE once', (t) async {
      final api = withRows();
      await openScreen(t, LeavesScreen(session: hrSession(api)));
      await t.tap(find.text('Delete'));
      await t.pumpAndSettle();
      expect(find.textContaining('Asha Rao'), findsWidgets);
      expect(api.paths('DELETE'), isEmpty);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Delete')));
      await t.pumpAndSettle();
      expect(api.paths('DELETE'), ['/api/employees/leave-requests/l1']);
      expect(api.paths('GET', '/api/employees/leave-requests').length, 2);
    });

    testWidgets('a refused cancel shows the server message and reloads', (t) async {
      final api = withRows(onWrite: (m, p, b) => ApiException('Approved requests cannot be cancelled. Please contact admin.', status: 400));
      await openScreen(t, LeavesScreen(session: hrSession(api)));
      await t.tap(find.text('Cancel request').last);
      await t.pumpAndSettle();
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Cancel leave')));
      await t.pumpAndSettle();
      expect(find.text('Approved requests cannot be cancelled. Please contact admin.'), findsOneWidget);
      expect(api.paths('GET', '/api/employees/leave-requests').length, 2);
    });

    testWidgets('the website row now covers only the date filter', (t) async {
      await openScreen(t, LeavesScreen(session: hrSession(withRows())));
      expect(find.text('Filter by dates'), findsOneWidget);
      expect(find.textContaining('Cancel or delete'), findsNothing);
    });

    test('the leave calendar is a native screen, no longer generic', () {
      final s = hrSession(FakeHrApi((m, p, b) => null));
      expect(nativeScreenFor(s, '/employees/leaves/calendar'), isA<LeaveCalendarScreen>());
      expect(routeTier(s, '/employees/leaves/calendar'), RouteTier.native);
      expect(stillGeneric, isNot(contains('/employees/leaves/calendar')));
    });
  });
}
