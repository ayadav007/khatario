import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/format.dart';
import 'package:khatario_phone/screens/hr/attendance_history_screen.dart';
import 'package:khatario_phone/screens/hr/attendance_leave_logic.dart';
import 'package:khatario_phone/screens/hr/attendance_reviews_screen.dart';
import 'package:khatario_phone/screens/hr/attendance_screen.dart';
import 'package:khatario_phone/screens/hr/shift_roster_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/reports/report_period.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/hr_fake_api.dart';

Map<String, dynamic> _cell(String kind, String label, {num hours = 0, String code = '', bool missing = false, num early = 0, num late = 0}) => {
      'kind': kind,
      'label': label,
      'hours': hours,
      'countsAsDay': kind == 'present' || kind == 'half_day' || kind == 'overtime',
      'calendarCode': code,
      'missingOutPunch': missing,
      'earlyMinutes': early,
      'lateMinutes': late,
    };

Map<String, dynamic> _matrix() => {
      'month': '2026-11',
      'days': [
        {'date': '2026-11-01', 'day': 1, 'weekday': 'Sun', 'isSunday': true},
        {'date': '2026-11-02', 'day': 2, 'weekday': 'Mon', 'isSunday': false},
        {'date': '2026-11-03', 'day': 3, 'weekday': 'Tue', 'isSunday': false},
        {'date': '2026-11-04', 'day': 4, 'weekday': 'Wed', 'isSunday': false},
      ],
      'workers': [
        {
          'id': 'e1',
          'code': 'EMP1',
          'name': 'Asha Rao',
          'cells': [
            _cell('off', '–', code: 'W'),
            _cell('present', 'P', hours: 8, code: 'P', early: 5),
            _cell('absent', 'A', code: 'A'),
            _cell('present', 'P', hours: 3.5, code: 'P', missing: true, late: 12),
          ],
          'days': 2,
          'totalHoursLabel': '11.5h',
        },
        {
          'id': 'e2',
          'code': 'EMP2',
          'name': 'Ravi Kumar',
          'cells': [
            _cell('off', '–', code: 'W'),
            _cell('half_day', 'HD', hours: 4, code: 'P/A'),
            _cell('leave', 'L', code: 'L'),
            _cell('overtime', '9.5', hours: 9.5, code: 'P'),
          ],
          'days': 1,
          'totalHoursLabel': '13.5h',
        },
      ],
    };

Finder _inSheet(String text) => find.descendant(of: find.byType(BottomSheet), matching: find.text(text));

void main() {
  group('attendance logic', () {
    test('matrix path takes the month as YYYY-MM and never an id', () {
      expect(matrixPath(const MonthPeriod(2026, 11)), '/api/employees/attendance/matrix?month=2026-11');
      expect(matrixPath(const MonthPeriod(2027, 3)), '/api/employees/attendance/matrix?month=2027-03');
    });

    test('matrix parses days, workers and the server totals', () {
      final m = AttendanceMatrix.fromJson(_matrix());
      expect(m.days.map((d) => d.date), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
      expect(m.days.first.isSunday, isTrue);
      expect(m.workers.length, 2);
      final asha = m.workers.first;
      expect(asha.name, 'Asha Rao');
      expect(asha.days, 2);
      expect(asha.totalHoursLabel, '11.5h');
      expect(asha.cells[1].label, 'P');
      expect(asha.cells[1].earlyMinutes, 5);
      expect(asha.cells[3].missingOutPunch, isTrue);
      expect(asha.cells[3].lateMinutes, 12);
    });

    test('cell tones follow the website colours: emerald, amber, sky, rose, off muted', () {
      expect(matrixTone('present'), KTone.positive);
      expect(matrixTone('overtime'), KTone.due);
      expect(matrixTone('half_day'), KTone.brand);
      expect(matrixTone('absent'), KTone.negative);
      expect(matrixTone('leave'), KTone.neutral);
      expect(matrixTone('off'), KTone.neutral);
      expect(matrixTone('empty'), isNull);
    });

    test('searching workers matches name or code', () {
      final workers = AttendanceMatrix.fromJson(_matrix()).workers;
      expect(filterWorkers(workers, 'ravi').map((w) => w.code), ['EMP2']);
      expect(filterWorkers(workers, 'emp1').map((w) => w.name), ['Asha Rao']);
      expect(filterWorkers(workers, '  ').length, 2);
    });

    test('a punch review is approved or rejected with the punch id only', () {
      expect(punchDecisionBody('p1', approve: true), {'punch_id': 'p1', 'decision': 'approved'});
      expect(punchDecisionBody('p1', approve: false), {'punch_id': 'p1', 'decision': 'rejected'});
    });

    test('a regularization is decided with action and an optional reason', () {
      expect(regularizationDecisionBody(approve: true), {'action': 'approve'});
      expect(regularizationDecisionBody(approve: false), {'action': 'reject'});
      expect(regularizationDecisionBody(approve: false, reason: ' late '), {'action': 'reject', 'rejection_reason': 'late'});
    });

    test('regularization type labels are the website labels', () {
      expect(regularizationTypeLabel('missing_both'), 'Missing check-in & check-out');
      expect(regularizationTypeLabel('partial_early_out'), 'Partial day — early departure');
      expect(regularizationTypeLabel('something_new'), 'something_new');
    });

    test('timestamps read like the website: dd MMM yyyy, h:mm a', () {
      expect(clockTs(null), '—');
      expect(clockTs('2026-11-09 18:05:00'), '09 Nov 2026, 6:05 PM');
      expect(clockTs('2026-11-09 00:30:00'), '09 Nov 2026, 12:30 AM');
    });

    test('roster path asks for the week and optional filters', () {
      expect(rosterPath(DateTime(2026, 11, 9)), '/api/hr/shifts/roster?week_start=2026-11-09');
      expect(rosterPath(DateTime(2026, 11, 9), department: 'Sales', branchId: 'br1'),
          '/api/hr/shifts/roster?week_start=2026-11-09&department=Sales&branch_id=br1');
    });

    test('the week starts on Monday', () {
      expect(ymd(mondayOf(DateTime(2026, 11, 11))), '2026-11-09');
      expect(ymd(mondayOf(DateTime(2026, 11, 15))), '2026-11-09');
      expect(ymd(mondayOf(DateTime(2026, 11, 9))), '2026-11-09');
    });

    test('one roster day is sent as a single entry with no ids but the employee', () {
      expect(rosterEntryBody('e1', '2026-11-10', shiftId: 's2'), {
        'entries': [
          {'employee_id': 'e1', 'roster_date': '2026-11-10', 'shift_id': 's2', 'is_day_off': false},
        ],
      });
      expect(rosterEntryBody('e1', '2026-11-10'), {
        'entries': [
          {'employee_id': 'e1', 'roster_date': '2026-11-10', 'shift_id': null, 'is_day_off': true},
        ],
      });
    });

    test('fill from defaults names the week and the filters', () {
      expect(fillDefaultsBody(DateTime(2026, 11, 9)), {'action': 'fill_defaults', 'week_start': '2026-11-09'});
      expect(fillDefaultsBody(DateTime(2026, 11, 9), department: 'Sales', branchId: 'br1'),
          {'action': 'fill_defaults', 'week_start': '2026-11-09', 'department': 'Sales', 'branch_id': 'br1'});
    });

    test('bulk assign always names its employees: an empty list would mean everyone', () {
      expect(bulkAssignBody(shiftId: 's1', employeeIds: const [], from: DateTime(2026, 11, 9)), isNull);
      expect(bulkAssignBody(shiftId: 's1', employeeIds: const ['e1', 'e2'], from: DateTime(2026, 11, 9)), {
        'shift_id': 's1',
        'employee_ids': ['e1', 'e2'],
        'effective_from': '2026-11-09',
        'effective_to': null,
      });
      expect(bulkAssignBody(shiftId: null, employeeIds: const ['e1'], from: DateTime(2026, 11, 9), to: DateTime(2026, 11, 30)), {
        'shift_id': null,
        'employee_ids': ['e1'],
        'effective_from': '2026-11-09',
        'effective_to': '2026-11-30',
      });
    });

    test('plan access reads the same tables as the website and is open when unreadable', () {
      final off = hrAccess({'enabledIds': ['hr_attendance']}, {'permissions': <String, dynamic>{}, 'isPrimaryAdmin': true}, sessionIsPrimaryAdmin: true);
      expect(off.has('hr_staff_app'), isFalse);
      expect(off.has('hr_attendance'), isTrue);
      final on = hrAccess({'enabledIds': ['hr_staff_app', 'hr_shifts']}, {'permissions': <String, dynamic>{}, 'isPrimaryAdmin': true}, sessionIsPrimaryAdmin: true);
      expect(on.has('hr_staff_app'), isTrue);
      expect(on.has('hr_shifts'), isTrue);
      expect(hrAccess(null, null, sessionIsPrimaryAdmin: false).has('hr_staff_app'), isTrue);
    });
  });

  group('attendance history screen', () {
    testWidgets('shows each employee row with the server codes and totals, and opens a day', (t) async {
      final api = FakeHrApi((m, p, b) => p.startsWith('/api/employees/attendance/matrix') ? _matrix() : null);
      await openScreen(t, AttendanceHistoryScreen(session: hrSession(api)));
      expect(api.paths('GET'), [matrixPath(MonthPeriod.of(DateTime.now()))]);
      expect(find.text('Asha Rao'), findsOneWidget);
      expect(find.text('Ravi Kumar'), findsOneWidget);
      expect(find.text('2 days · 11.5h'), findsOneWidget);
      expect(find.text('HD'), findsOneWidget);
      expect(find.text('9.5'), findsOneWidget);
      // Colour by status, from tokens.
      Color fill(String key) => ((t.widget<Container>(find.byKey(ValueKey(key))).decoration) as BoxDecoration).color!;
      expect(fill('cell-e1-2026-11-02'), KTone.positive.bg);
      expect(fill('cell-e1-2026-11-03'), KTone.negative.bg);
      expect(fill('cell-e2-2026-11-02'), KTone.brand.bg);
      expect(fill('cell-e2-2026-11-04'), KTone.due.bg);

      await t.tap(find.byKey(const ValueKey('cell-e1-2026-11-04')));
      await t.pumpAndSettle();
      expect(_inSheet('Asha Rao'), findsOneWidget);
      expect(_inSheet('04 Nov 2026'), findsOneWidget);
      expect(_inSheet('Present'), findsOneWidget);
      expect(_inSheet('3.5'), findsOneWidget);
      expect(_inSheet('Late by 12 min'), findsOneWidget);
      expect(_inSheet('Out punch missing'), findsOneWidget);
    });

    testWidgets('stepping the month reloads, and searching narrows the rows', (t) async {
      final api = FakeHrApi((m, p, b) => p.startsWith('/api/employees/attendance/matrix') ? _matrix() : null);
      await openScreen(t, AttendanceHistoryScreen(session: hrSession(api)));
      await t.tap(find.bySemanticsLabel('Previous month'));
      await t.pumpAndSettle();
      expect(api.paths('GET').last, matrixPath(MonthPeriod.of(DateTime.now()).previous));
      await t.enterText(find.byType(TextField), 'ravi');
      await t.pumpAndSettle();
      expect(find.text('Asha Rao'), findsNothing);
      expect(find.text('Ravi Kumar'), findsOneWidget);
    });

    testWidgets('an empty month says so', (t) async {
      final api = FakeHrApi((m, p, b) => {'month': '2026-11', 'days': [], 'workers': []});
      await openScreen(t, AttendanceHistoryScreen(session: hrSession(api)));
      expect(find.text('No employees to show for this month.'), findsOneWidget);
    });

    testWidgets('a server error offers Try again, which reloads', (t) async {
      var fail = true;
      final api = FakeHrApi((m, p, b) => fail ? ApiException('Database is down', status: 500) : _matrix());
      await openScreen(t, AttendanceHistoryScreen(session: hrSession(api)));
      expect(find.text('Database is down'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Asha Rao'), findsOneWidget);
    });

    testWidgets('a plan without attendance shows the plan message and no retry', (t) async {
      final api = FakeHrApi((m, p, b) => ApiException('Not on your plan', status: 403, code: 'FEATURE_NOT_IN_PLAN'));
      await openScreen(t, AttendanceHistoryScreen(session: hrSession(api)));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });
  });

  group('attendance reviews screen', () {
    Map<String, dynamic> review() => {
          'id': 'p1',
          'action': 'check_in',
          'risk_score': 62,
          'reasons': [
            {'code': 'FAR', 'message': 'Far from the office'},
          ],
          'distance_m': 540,
          'lat': '12.9',
          'lng': '77.5',
          'wifi_matched': false,
          'face_similarity': 0.81,
          'photos': [],
          'created_at': '2026-11-10T04:15:00.000Z',
          'site_name': 'Main shop',
          'employee_name': 'Asha Rao',
          'employee_code': 'EMP1',
        };

    Map<String, dynamic> regularization() => {
          'id': 'r1',
          'employee_code': 'EMP2',
          'employee_name': 'Ravi Kumar',
          'attendance_date': '2026-11-09',
          'request_type': 'missing_check_out',
          'original_check_in': '2026-11-09 09:00:00',
          'original_check_out': null,
          'requested_check_in': null,
          'requested_check_out': '2026-11-09 18:00:00',
          'reason': 'Forgot to punch out',
        };

    FakeHrApi server({List<String> features = const ['hr_staff_app', 'hr_leaves'], FutureOr<Object?> Function(String m, String p, Map<String, dynamic>? b)? onWrite}) {
      var reviews = [review()];
      var regs = [regularization()];
      return FakeHrApi((m, p, b) {
        final plan = planReply(p, features);
        if (plan != null) return plan;
        if (m == 'GET' && p == '/api/employees/attendance/reviews') return {'reviews': reviews};
        if (m == 'GET' && p == '/api/employees/manager/pending-approvals') return {'regularizations': regs};
        if (m != 'GET') {
          final custom = onWrite?.call(m, p, b);
          if (custom != null) return custom;
          if (p == '/api/employees/attendance/reviews') reviews = [];
          if (p.startsWith('/api/employees/manager/attendance-regularization/')) regs = [];
          return {'success': true};
        }
        return null;
      });
    }

    testWidgets('lists the check-in with the reasons and approves it only after asking', (t) async {
      final api = server();
      await openScreen(t, AttendanceReviewsScreen(session: hrSession(api)));
      expect(find.text('Asha Rao (EMP1)'), findsOneWidget);
      expect(find.text('Far from the office'), findsOneWidget);
      expect(find.text('Risk 62/100'), findsOneWidget);
      expect(find.text('Face match 81%'), findsOneWidget);
      await t.tap(find.text('Approve'));
      await t.pumpAndSettle();
      final date = ddMMMyyyy(DateTime.parse('2026-11-10T04:15:00.000Z').toLocal());
      expect(find.textContaining('Asha Rao'), findsWidgets);
      expect(find.textContaining(date), findsWidgets);
      expect(api.paths('POST'), isEmpty);
      await t.tap(_inSheet('Approve'));
      await t.pumpAndSettle();
      expect(api.bodies('POST', '/api/employees/attendance/reviews'), [
        {'punch_id': 'p1', 'decision': 'approved'},
      ]);
      expect(api.paths('GET', '/api/employees/attendance/reviews').length, 2);
      expect(find.text('Asha Rao (EMP1)'), findsNothing);
    });

    testWidgets('closing the question posts nothing', (t) async {
      final api = server();
      await openScreen(t, AttendanceReviewsScreen(session: hrSession(api)));
      await t.tap(find.text('Reject'));
      await t.pumpAndSettle();
      await t.tap(find.text('Keep it'));
      await t.pumpAndSettle();
      expect(api.paths('POST'), isEmpty);
    });

    testWidgets('a double tap on the answer posts once', (t) async {
      final gate = Completer<Object?>();
      final api = server(onWrite: (m, p, b) => gate.future);
      await openScreen(t, AttendanceReviewsScreen(session: hrSession(api)));
      await t.tap(find.text('Reject'));
      await t.pumpAndSettle();
      await t.tap(_inSheet('Reject'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 500));
      await t.tap(find.text('Reject'));
      await t.pump(const Duration(milliseconds: 500));
      expect(find.byType(BottomSheet), findsNothing);
      expect(api.paths('POST').length, 1);
      expect(api.bodies('POST', '/api/employees/attendance/reviews').single, {'punch_id': 'p1', 'decision': 'rejected'});
      gate.complete({'success': true});
      await t.pumpAndSettle();
    });

    testWidgets('an already-decided check-in shows the server message and reloads', (t) async {
      final api = server(onWrite: (m, p, b) => ApiException('This check-in was already reviewed or does not exist.', status: 404));
      await openScreen(t, AttendanceReviewsScreen(session: hrSession(api)));
      await t.tap(find.text('Approve'));
      await t.pumpAndSettle();
      await t.tap(_inSheet('Approve'));
      await t.pumpAndSettle();
      expect(find.text('This check-in was already reviewed or does not exist.'), findsOneWidget);
      expect(api.paths('GET', '/api/employees/attendance/reviews').length, 2);
    });

    testWidgets('regularization asks show in and out times and the reason, and approve patches once', (t) async {
      final api = server();
      await openScreen(t, AttendanceReviewsScreen(session: hrSession(api)));
      await t.tap(find.text('Regularization'));
      await t.pumpAndSettle();
      expect(find.text('Ravi Kumar (EMP2)'), findsOneWidget);
      expect(find.text('09 Nov 2026 · Missing check-out'), findsOneWidget);
      expect(find.text('In: 09 Nov 2026, 9:00 AM → —'), findsOneWidget);
      expect(find.text('Out: — → 09 Nov 2026, 6:00 PM'), findsOneWidget);
      expect(find.text('Forgot to punch out'), findsOneWidget);
      await t.tap(find.text('Approve'));
      await t.pumpAndSettle();
      expect(find.textContaining('Ravi Kumar'), findsWidgets);
      expect(find.textContaining('09 Nov 2026'), findsWidgets);
      await t.tap(_inSheet('Approve'));
      await t.pumpAndSettle();
      expect(api.paths('PATCH'), ['/api/employees/manager/attendance-regularization/r1']);
      expect(api.bodies('PATCH', '/api/employees/manager').single, {'action': 'approve'});
      expect(find.text('Ravi Kumar (EMP2)'), findsNothing);
    });

    testWidgets('rejecting a regularization sends the reason typed', (t) async {
      final api = server();
      await openScreen(t, AttendanceReviewsScreen(session: hrSession(api)));
      await t.tap(find.text('Regularization'));
      await t.pumpAndSettle();
      await t.tap(find.text('Reject'));
      await t.pumpAndSettle();
      await t.enterText(find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)), 'Not on shift');
      await t.tap(_inSheet('Reject request'));
      await t.pumpAndSettle();
      expect(api.bodies('PATCH', '/api/employees/manager').single, {'action': 'reject', 'rejection_reason': 'Not on shift'});
    });

    testWidgets('a request that is no longer pending shows the server message and reloads', (t) async {
      final api = server(onWrite: (m, p, b) => ApiException('Request is no longer pending', status: 400));
      await openScreen(t, AttendanceReviewsScreen(session: hrSession(api)));
      await t.tap(find.text('Regularization'));
      await t.pumpAndSettle();
      await t.tap(find.text('Approve'));
      await t.pumpAndSettle();
      await t.tap(_inSheet('Approve'));
      await t.pumpAndSettle();
      expect(find.text('Request is no longer pending'), findsOneWidget);
      expect(api.paths('GET', '/api/employees/manager/pending-approvals').length, 2);
    });

    testWidgets('nothing waiting: the empty state, and a 403 from approvals is the same', (t) async {
      final api = FakeHrApi((m, p, b) {
        final plan = planReply(p, ['hr_staff_app', 'hr_leaves']);
        if (plan != null) return plan;
        if (p == '/api/employees/attendance/reviews') return {'reviews': []};
        return ApiException('No pending approvals for you', status: 403);
      });
      await openScreen(t, AttendanceReviewsScreen(session: hrSession(api)));
      expect(find.text('No check-ins to review'), findsOneWidget);
      await t.tap(find.text('Regularization'));
      await t.pumpAndSettle();
      expect(find.text('No regularization requests waiting'), findsOneWidget);
    });

    testWidgets('a plan without the staff app hides check-ins; one without leaves hides regularization', (t) async {
      final api = server(features: const ['hr_leaves']);
      await openScreen(t, AttendanceReviewsScreen(session: hrSession(api)));
      expect(find.text('Check-ins'), findsNothing);
      expect(find.text('Ravi Kumar (EMP2)'), findsOneWidget);
      expect(api.paths('GET', '/api/employees/attendance/reviews'), isEmpty);
    });

    testWidgets('a server error shows Try again', (t) async {
      var fail = true;
      final api = FakeHrApi((m, p, b) {
        final plan = planReply(p, ['hr_staff_app']);
        if (plan != null) return plan;
        return fail ? ApiException('Boom', status: 500) : {'reviews': [review()]};
      });
      await openScreen(t, AttendanceReviewsScreen(session: hrSession(api)));
      expect(find.text('Boom'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Asha Rao (EMP1)'), findsOneWidget);
    });

    testWidgets('FEATURE_NOT_IN_PLAN on the list shows the plan message', (t) async {
      final api = FakeHrApi((m, p, b) {
        final plan = planReply(p, ['hr_staff_app']);
        if (plan != null) return plan;
        return ApiException('Not on your plan', status: 403, code: 'FEATURE_NOT_IN_PLAN');
      });
      await openScreen(t, AttendanceReviewsScreen(session: hrSession(api)));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });

  group('shift roster screen', () {
    final monday = mondayOf(DateTime.now());
    String day(int i) => ymd(monday.add(Duration(days: i)));

    Map<String, dynamic> roster(String path) {
      final ws = Uri.parse(path).queryParameters['week_start']!;
      final start = DateTime.parse(ws);
      final days = [for (var i = 0; i < 7; i++) ymd(start.add(Duration(days: i)))];
      return {
        'week_start': ws,
        'week_end': days.last,
        'days': days,
        'employees': [
          {'id': 'e1', 'employee_code': 'EMP1', 'employee_name': 'Asha Rao', 'department': 'Sales', 'default_shift_id': null},
          {'id': 'e2', 'employee_code': 'EMP2', 'employee_name': 'Ravi Kumar', 'department': 'Sales', 'default_shift_id': null},
        ],
        'cells': {
          'e1|${days[0]}': {'shift_id': 's1', 'is_day_off': false, 'shift_name': 'Morning'},
          'e1|${days[1]}': {'shift_id': null, 'is_day_off': true},
        },
        'shifts': [
          {'id': 's1', 'shift_name': 'Morning', 'start_time': '09:00:00', 'end_time': '17:00:00'},
          {'id': 's2', 'shift_name': 'Evening', 'start_time': '14:00:00', 'end_time': '22:00:00'},
        ],
        'settings': {'auto_mark_absent': false},
      };
    }

    FakeHrApi server({Object? Function(String m, String p, Map<String, dynamic>? b)? onWrite}) => FakeHrApi((m, p, b) {
          final plan = planReply(p, ['hr_shifts']);
          if (plan != null) return plan;
          if (p == '/api/settings/hr-org-catalog') return {'catalog': {'departments': ['Sales'], 'designations': []}};
          if (p == '/api/branches') return {'branches': [{'id': 'br1', 'name': 'Main'}]};
          if (m == 'GET' && p.startsWith('/api/hr/shifts/roster')) return roster(p);
          if (m == 'PATCH') return onWrite?.call(m, p, b) ?? {'saved': 1};
          return null;
        });

    testWidgets('shows the week for the employees with shift names and Off', (t) async {
      final api = server();
      await openScreen(t, ShiftRosterScreen(session: hrSession(api)));
      expect(api.paths('GET', '/api/hr/shifts/roster').first, rosterPath(monday));
      expect(find.text('Asha Rao'), findsOneWidget);
      expect(find.text('Ravi Kumar'), findsOneWidget);
      expect(find.descendant(of: find.byKey(ValueKey('roster-e1-${day(0)}')), matching: find.text('Morning')), findsOneWidget);
      expect(find.descendant(of: find.byKey(ValueKey('roster-e1-${day(1)}')), matching: find.text('Off')), findsOneWidget);
      expect(find.descendant(of: find.byKey(ValueKey('roster-e2-${day(0)}')), matching: find.text('—')), findsOneWidget);
    });

    testWidgets('changing one day patches one entry then reloads', (t) async {
      final api = server();
      await openScreen(t, ShiftRosterScreen(session: hrSession(api)));
      await t.tap(find.byKey(ValueKey('roster-e2-${day(2)}')));
      await t.pumpAndSettle();
      expect(find.text('Evening (14:00–22:00)'), findsOneWidget);
      await t.tap(find.text('Evening (14:00–22:00)'));
      await t.pumpAndSettle();
      expect(api.bodies('PATCH', '/api/hr/shifts/roster'), [
        {
          'entries': [
            {'employee_id': 'e2', 'roster_date': day(2), 'shift_id': 's2', 'is_day_off': false},
          ],
        },
      ]);
      expect(api.paths('GET', '/api/hr/shifts/roster').length, 2);
    });

    testWidgets('choosing Off sends a day off with no shift', (t) async {
      final api = server();
      await openScreen(t, ShiftRosterScreen(session: hrSession(api)));
      await t.tap(find.byKey(ValueKey('roster-e2-${day(3)}')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('pick-off')));
      await t.pumpAndSettle();
      expect(api.bodies('PATCH', '/api/hr/shifts/roster').single, {
        'entries': [
          {'employee_id': 'e2', 'roster_date': day(3), 'shift_id': null, 'is_day_off': true},
        ],
      });
    });

    testWidgets('a refused save shows the server message and keeps the cell as it was', (t) async {
      final api = server(onWrite: (m, p, b) => ApiException('Shift not found', status: 400));
      await openScreen(t, ShiftRosterScreen(session: hrSession(api)));
      await t.tap(find.byKey(ValueKey('roster-e2-${day(2)}')));
      await t.pumpAndSettle();
      await t.tap(find.text('Evening (14:00–22:00)'));
      await t.pumpAndSettle();
      expect(find.text('Shift not found'), findsOneWidget);
      expect(find.descendant(of: find.byKey(ValueKey('roster-e2-${day(2)}')), matching: find.text('—')), findsOneWidget);
    });

    testWidgets('previous and next week reload for that week', (t) async {
      final api = server();
      await openScreen(t, ShiftRosterScreen(session: hrSession(api)));
      await t.tap(find.bySemanticsLabel('Next week'));
      await t.pumpAndSettle();
      expect(api.paths('GET', '/api/hr/shifts/roster').last, rosterPath(monday.add(const Duration(days: 7))));
      await t.tap(find.bySemanticsLabel('Previous week'));
      await t.tap(find.bySemanticsLabel('Previous week'));
      await t.pumpAndSettle();
      expect(api.paths('GET', '/api/hr/shifts/roster').last, rosterPath(monday.subtract(const Duration(days: 7))));
    });

    testWidgets('fill from defaults asks first, then patches the action', (t) async {
      final api = server(onWrite: (m, p, b) => {'filled': 12});
      await openScreen(t, ShiftRosterScreen(session: hrSession(api)));
      await t.tap(find.text('Fill from defaults'));
      await t.pumpAndSettle();
      expect(api.paths('PATCH'), isEmpty);
      await t.tap(_inSheet('Fill week'));
      await t.pumpAndSettle();
      expect(api.bodies('PATCH', '/api/hr/shifts/roster').single, {'action': 'fill_defaults', 'week_start': ymd(monday)});
      expect(find.text('Filled 12 roster cells from defaults'), findsOneWidget);
    });

    testWidgets('picking a department reloads the roster for it', (t) async {
      final api = server();
      await openScreen(t, ShiftRosterScreen(session: hrSession(api)));
      await t.tap(find.text('All departments'));
      await t.pumpAndSettle();
      await t.tap(find.text('Sales').last);
      await t.pumpAndSettle();
      expect(api.paths('GET', '/api/hr/shifts/roster').last, rosterPath(monday, department: 'Sales'));
    });

    testWidgets('server error offers Try again', (t) async {
      var fail = true;
      final api = FakeHrApi((m, p, b) {
        final plan = planReply(p, ['hr_shifts']);
        if (plan != null) return plan;
        if (p.startsWith('/api/hr/shifts/roster')) return fail ? ApiException('Boom', status: 500) : roster(p);
        return null;
      });
      await openScreen(t, ShiftRosterScreen(session: hrSession(api)));
      expect(find.text('Boom'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Asha Rao'), findsOneWidget);
    });

    testWidgets('a plan without shifts shows the plan message and no retry', (t) async {
      final off = FakeHrApi((m, p, b) => ApiException('Not on your plan', status: 403, code: 'FEATURE_NOT_IN_PLAN'));
      await openScreen(t, ShiftRosterScreen(session: hrSession(off)));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('an empty roster says no employees match', (t) async {
      final api = FakeHrApi((m, p, b) {
        final plan = planReply(p, ['hr_shifts']);
        if (plan != null) return plan;
        if (p.startsWith('/api/hr/shifts/roster')) return {...roster(p), 'employees': []};
        return null;
      });
      await openScreen(t, ShiftRosterScreen(session: hrSession(api)));
      expect(find.text('No active employees match the filter.'), findsOneWidget);
    });
  });

  group('bulk shift assignment screen', () {
    FakeHrApi server({Object? Function(String m, String p, Map<String, dynamic>? b)? onPost}) => FakeHrApi((m, p, b) {
          if (p.startsWith('/api/shifts')) {
            return {
              'shifts': [
                {'id': 's1', 'shift_name': 'Morning', 'start_time': '09:00:00', 'end_time': '17:00:00', 'is_active': true},
                {'id': 's9', 'shift_name': 'Old', 'start_time': '01:00:00', 'end_time': '02:00:00', 'is_active': false},
              ],
            };
          }
          if (p.startsWith('/api/employees')) {
            return {
              'employees': [
                {'id': 'e1', 'user_name': 'Asha Rao', 'employee_code': 'EMP1', 'designation': 'Sales'},
                {'id': 'e2', 'user_name': 'Ravi Kumar', 'employee_code': 'EMP2'},
                {'id': 'e3', 'user_name': 'Meena Iyer', 'employee_code': 'EMP3'},
              ],
            };
          }
          if (m == 'POST') return onPost?.call(m, p, b) ?? {'assigned': 2};
          return null;
        });

    Future<void> chooseMorning(WidgetTester t) async {
      await t.tap(find.text('No default shift'));
      await t.pumpAndSettle();
      await t.tap(find.text('Morning (09:00–17:00)'));
      await t.pumpAndSettle();
    }

    testWidgets('selecting employees and a shift asks with the count, then posts their ids', (t) async {
      final api = server();
      await openScreen(t, BulkShiftAssignScreen(session: hrSession(api)));
      expect(find.text('Old (01:00–02:00)'), findsNothing);
      await chooseMorning(t);
      await t.tap(find.byKey(const ValueKey('emp-e1')));
      await t.tap(find.byKey(const ValueKey('emp-e3')));
      await t.pumpAndSettle();
      expect(find.text('2 selected'), findsOneWidget);
      await t.tap(find.text('Assign shift'));
      await t.pumpAndSettle();
      expect(find.textContaining('2 employees'), findsOneWidget);
      expect(api.paths('POST'), isEmpty);
      await t.tap(_inSheet('Assign'));
      await t.pumpAndSettle();
      expect(api.bodies('POST', '/api/hr/shifts/bulk-assign').single, {
        'shift_id': 's1',
        'employee_ids': ['e1', 'e3'],
        'effective_from': ymd(DateTime.now()),
        'effective_to': null,
      });
      expect(find.text('Assigned shift to 2 employee(s)'), findsOneWidget);
    });

    testWidgets('with no default shift the question says the shift is cleared, naming the count and date', (t) async {
      final api = server();
      await openScreen(t, BulkShiftAssignScreen(session: hrSession(api)));
      await t.tap(find.byKey(const ValueKey('emp-e1')));
      await t.tap(find.byKey(const ValueKey('emp-e2')));
      await t.pumpAndSettle();
      await t.tap(find.text('Assign shift'));
      await t.pumpAndSettle();
      expect(find.text('Clear the default shift of 2 employees from ${ddMMMyyyy(DateTime.now())}?'), findsOneWidget);
      await t.tap(_inSheet('Clear shift'));
      await t.pumpAndSettle();
      expect(api.bodies('POST', '/api/hr/shifts/bulk-assign').single?['shift_id'], isNull);
    });

    testWidgets('nothing selected posts nothing', (t) async {
      final api = server();
      await openScreen(t, BulkShiftAssignScreen(session: hrSession(api)));
      await chooseMorning(t);
      await t.tap(find.text('Assign shift'));
      await t.pumpAndSettle();
      expect(api.paths('POST'), isEmpty);
    });

    testWidgets('select all picks everyone listed', (t) async {
      final api = server();
      await openScreen(t, BulkShiftAssignScreen(session: hrSession(api)));
      await t.tap(find.text('Select all'));
      await t.pumpAndSettle();
      expect(find.text('3 selected'), findsOneWidget);
    });

    testWidgets('a double tap on Assign posts once', (t) async {
      final gate = Completer<Object?>();
      final api = server(onPost: (m, p, b) => gate.future);
      await openScreen(t, BulkShiftAssignScreen(session: hrSession(api)));
      await t.tap(find.byKey(const ValueKey('emp-e1')));
      await t.pumpAndSettle();
      await t.tap(find.text('Assign shift'));
      await t.pumpAndSettle();
      await t.tap(_inSheet('Clear shift'));
      await t.pump();
      await t.tap(find.text('Assign shift'), warnIfMissed: false);
      await t.pump();
      expect(api.paths('POST').length, 1);
      gate.complete({'assigned': 1});
      await t.pumpAndSettle();
    });

    testWidgets('a refusal shows the server message and keeps the selection', (t) async {
      final api = server(onPost: (m, p, b) => ApiException('Bulk assign failed', status: 400));
      await openScreen(t, BulkShiftAssignScreen(session: hrSession(api)));
      await t.tap(find.byKey(const ValueKey('emp-e1')));
      await t.pumpAndSettle();
      await t.tap(find.text('Assign shift'));
      await t.pumpAndSettle();
      await t.tap(_inSheet('Clear shift'));
      await t.pumpAndSettle();
      expect(find.text('Bulk assign failed'), findsOneWidget);
      expect(find.text('1 selected'), findsOneWidget);
    });

    testWidgets('a plan without shifts shows the plan message', (t) async {
      final api = FakeHrApi((m, p, b) => ApiException('Not on your plan', status: 403, code: 'FEATURE_NOT_IN_PLAN'));
      await openScreen(t, BulkShiftAssignScreen(session: hrSession(api)));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('a load error offers Try again', (t) async {
      var fail = true;
      final api = FakeHrApi((m, p, b) => fail && p.startsWith('/api/shifts') ? ApiException('Boom', status: 500) : {'shifts': [], 'employees': []});
      await openScreen(t, BulkShiftAssignScreen(session: hrSession(api)));
      expect(find.text('Boom'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Boom'), findsNothing);
    });
  });

  group('routes and the attendance hub', () {
    test('roster and bulk assign are native screens, no longer generic', () {
      final s = hrSession(FakeHrApi((m, p, b) => null));
      expect(nativeScreenFor(s, '/hr/shifts/roster'), isA<ShiftRosterScreen>());
      expect(nativeScreenFor(s, '/hr/shifts/bulk-assign'), isA<BulkShiftAssignScreen>());
      expect(routeTier(s, '/hr/shifts/roster'), RouteTier.native);
    });

    testWidgets('attendance links to history and reviews and keeps one Open on website row for the rest', (t) async {
      final api = FakeHrApi((m, p, b) {
        final plan = planReply(p, ['hr_attendance', 'hr_staff_app', 'hr_leaves']);
        if (plan != null) return plan;
        if (p.startsWith('/api/employees/manager/attendance')) return {'team': []};
        if (p.startsWith('/api/employees/attendance/matrix')) return _matrix();
        return {};
      });
      await openScreen(t, AttendanceScreen(session: hrSession(api)));
      expect(find.bySemanticsLabel('History and reviews on the website'), findsNothing);
      expect(find.text('Open on website'), findsOneWidget);
      await t.tap(find.bySemanticsLabel('Attendance history'));
      await t.pumpAndSettle();
      expect(find.byType(AttendanceHistoryScreen), findsOneWidget);
      await t.tap(find.bySemanticsLabel('Back'));
      await t.pumpAndSettle();
      await t.tap(find.bySemanticsLabel('Check-in reviews'));
      await t.pumpAndSettle();
      expect(find.byType(AttendanceReviewsScreen), findsOneWidget);
    });

    testWidgets('without the staff app or leaves plans the reviews link is hidden', (t) async {
      final api = FakeHrApi((m, p, b) {
        final plan = planReply(p, ['hr_attendance']);
        if (plan != null) return plan;
        return {'team': []};
      });
      await openScreen(t, AttendanceScreen(session: hrSession(api)));
      expect(find.bySemanticsLabel('Attendance history'), findsOneWidget);
      expect(find.bySemanticsLabel('Check-in reviews'), findsNothing);
    });
  });
}
