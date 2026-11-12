import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/hr/exits_screen.dart';
import 'package:khatario_phone/screens/hr/hr_dashboard_screen.dart';
import 'package:khatario_phone/screens/hr/manager_approvals_screen.dart';
import 'package:khatario_phone/screens/hr/manager_screen.dart';
import 'package:khatario_phone/screens/hr/offer_submit_screen.dart';
import 'package:khatario_phone/screens/hr/recruitment_candidate_screen.dart';
import 'package:khatario_phone/screens/hr/recruitment_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/hr/employees_screen.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/hr_fake_api.dart';

Future<void> _tapText(WidgetTester t, String text, {bool last = false}) async {
  final f = last ? find.text(text).last : find.text(text).first;
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pumpAndSettle();
}

/// The confirm button of the sheet that just opened.
Future<void> _confirm(WidgetTester t, String label) async {
  await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text(label)));
  await t.pumpAndSettle();
}

/// The button [label] in the section row of [who] (each section here has one row).
Finder _in(String who, String label) =>
    find.descendant(of: find.ancestor(of: find.text(who), matching: find.byType(KDivided)).first, matching: find.text(label)).first;

class _Bytes extends FakeHrApi {
  _Bytes(super.handler);
  final bytesPaths = <String>[];

  @override
  Future<List<int>> getBytes(String path) async {
    bytesPaths.add(path);
    return <int>[37, 80, 68, 70];
  }
}

const _overview = {
  'headcount': 12, 'pending_invites': 2, 'pending_leaves': 3, 'present_today': 8, 'absent_today': 4,
  'in_probation': 1, 'pending_exit_approvals': 1, 'active_announcements': 5, 'birthdays_this_week': 2,
  'new_joiners_this_month': 3, 'date': '11 Nov 2026',
  'notifications': [
    {'type': 'exits', 'label': 'Exit approvals pending', 'count': 1, 'href': '/hr/exits'},
  ],
};

void main() {
  group('HR dashboard', () {
    testWidgets('tiles show the server numbers and open their screens', (t) async {
      final api = FakeHrApi((m, p, b) => p == '/api/hr/dashboard/overview' ? _overview : null);
      await openScreen(t, HrDashboardScreen(session: hrSession(api)));
      expect(find.text('Team overview · 11 Nov 2026'), findsOneWidget);
      expect(find.text('Exit approvals pending (1)'), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('tile-Present today')), matching: find.text('8')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('tile-Present today')), matching: find.text('4 absent · 12 active employees')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('tile-Inbox')), matching: find.text('6')), findsOneWidget);
      expect(find.text('3 leave, 1 exit, 2 invite actions pending.'), findsOneWidget);
      await t.tap(find.byKey(const ValueKey('tile-Exit approvals')));
      await t.pumpAndSettle();
      expect(find.text('Employee exits'), findsOneWidget);
      expect(api.paths('GET', '/api/hr/exits'), ['/api/hr/exits']);
    });

    testWidgets('a server error offers Try again', (t) async {
      var fail = true;
      final api = FakeHrApi((m, p, b) => fail ? ApiException('Boom', status: 500) : _overview);
      await openScreen(t, HrDashboardScreen(session: hrSession(api)));
      expect(find.text('Boom'), findsOneWidget);
      fail = false;
      await _tapText(t, 'Try again');
      expect(find.text('Present today'), findsOneWidget);
    });

    testWidgets('not in the plan says so and offers no retry', (t) async {
      final api = FakeHrApi((m, p, b) => ApiException('Upgrade', status: 403, code: 'FEATURE_NOT_IN_PLAN'));
      await openScreen(t, HrDashboardScreen(session: hrSession(api)));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('the manager hub link is hidden when the plan has no leave module', (t) async {
      final api = FakeHrApi((m, p, b) => p == '/api/hr/dashboard/overview' ? _overview : planReply(p, ['hr_advanced']));
      await openScreen(t, HrDashboardScreen(session: hrSession(api)));
      expect(find.text('Manager hub'), findsNothing);
      expect(find.text('People'), findsOneWidget);
    });
  });

  group('manager', () {
    testWidgets('the overview shows the server numbers', (t) async {
      final api = FakeHrApi((m, p, b) => {'team_count': 4, 'pending_leaves': 2, 'pending_expenses': 1, 'present_today': 3, 'absent_today': 1});
      await openScreen(t, ManagerScreen(session: hrSession(api)));
      expect(find.text('Direct reports'), findsOneWidget);
      expect(find.text('4'), findsOneWidget);
      expect(find.text('1 absent'), findsOneWidget);
      expect(find.text('Pending approvals'), findsOneWidget);
    });

    testWidgets('the team lists the direct reports', (t) async {
      final api = FakeHrApi((m, p, b) => {
            'team': [
              {'id': 'e1', 'employee_code': 'E1', 'name': 'Asha Rao', 'designation': 'Cashier', 'attendance_status': 'present'},
            ],
          });
      await openScreen(t, ManagerTeamScreen(session: hrSession(api)));
      expect(find.text('Asha Rao'), findsOneWidget);
      expect(find.text('Present'), findsOneWidget);
    });

    Map<String, dynamic> pending() => {
          'leaves': [{'id': 'l1', 'employee_name': 'Asha Rao', 'leave_name': 'Casual', 'start_date': '2026-11-12', 'end_date': '2026-11-13', 'total_days': 2}],
          'overtime': [{'id': 'v1', 'employee_name': 'Sam', 'request_date': '2026-11-08', 'total_hours': 1}],
          'expenses': [{'id': 'x1', 'employee_name': 'Ravi', 'amount': '250.00', 'description': 'Taxi', 'expense_date': '2026-11-10'}],
          'regularizations': [{'id': 'r1', 'employee_name': 'Tia', 'employee_code': 'T1', 'attendance_date': '2026-11-07', 'request_type': 'missing_check_in', 'reason': 'forgot'}],
          'exits': [{'exit_id': 'z1', 'employee_name': 'Meena', 'approval_level': 1, 'level_label': 'Manager', 'role_type': 'reporting_manager', 'status': 'awaiting', 'created_at': '2026-11-01'}],
          'leave_chain': [{'leave_request_id': 'c1', 'employee_name': 'Kim', 'leave_name': 'Sick', 'start_date': '2026-11-12', 'end_date': '2026-11-12', 'total_days': 1, 'approval_level': 1, 'level_label': 'Manager', 'role_type': 'reporting_manager', 'status': 'awaiting'}],
          'ot_chain': [{'overtime_request_id': 'o1', 'employee_name': 'Lee', 'request_date': '2026-11-09', 'total_hours': 2, 'approval_level': 1, 'role_type': 'hr', 'status': 'awaiting'}],
        };

    FakeHrApi server({Object? Function(String m, String p, Map<String, dynamic>? b)? onWrite}) {
      var first = true;
      return FakeHrApi((m, p, b) {
        if (m == 'GET') {
          final reply = first ? pending() : <String, dynamic>{};
          return reply;
        }
        final r = onWrite?.call(m, p, b);
        if (r == null) first = false;
        return r;
      });
    }

    testWidgets('every kind of pending approval has its section', (t) async {
      await openScreen(t, ManagerApprovalsScreen(session: hrSession(server())));
      for (final h in ['Attendance regularization', 'Resignation approvals', 'Leave approval chain', 'Overtime approval chain', 'Overtime requests', 'Leave requests', 'Expense claims']) {
        expect(find.text(h), findsOneWidget, reason: h);
      }
      // HR steps and steps already on hold have no "Mark pending".
      expect(find.text('Mark pending'), findsNWidgets(2));
    });

    testWidgets('approving leave asks, names the person and dates, posts once and reloads', (t) async {
      final api = server();
      await openScreen(t, ManagerApprovalsScreen(session: hrSession(api)));
      await t.tap(_in('Asha Rao', 'Approve'));
      await t.pumpAndSettle();
      expect(find.textContaining('Approve Asha Rao\'s Casual · 12–13 Nov · 2 days?'), findsOneWidget);
      await _confirm(t, 'Approve');
      expect(api.paths('PATCH'), ['/api/employees/leave-requests/l1']);
      expect(api.bodies('PATCH', '/api').single, {'action': 'approve'});
      expect(api.paths('GET', '/api/employees/manager/pending-approvals').length, 2);
      expect(find.text('Leave approved'), findsOneWidget);
    });

    testWidgets('rejecting leave takes a reason and sends it', (t) async {
      final api = server();
      await openScreen(t, ManagerApprovalsScreen(session: hrSession(api)));
      await t.tap(_in('Asha Rao', 'Reject'));
      await t.pumpAndSettle();
      await t.enterText(find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)), 'Peak season');
      await _confirm(t, 'Reject leave');
      expect(api.bodies('PATCH', '/api').single, {'action': 'reject', 'rejection_reason': 'Peak season'});
    });

    testWidgets('a refusal shows the server message and still reloads', (t) async {
      final api = server(onWrite: (m, p, b) => ApiException('Leave request was already decided', status: 400));
      await openScreen(t, ManagerApprovalsScreen(session: hrSession(api)));
      await t.tap(_in('Asha Rao', 'Approve'));
      await t.pumpAndSettle();
      await _confirm(t, 'Approve');
      expect(find.text('Leave request was already decided'), findsOneWidget);
      expect(api.paths('GET', '/api/employees/manager/pending-approvals').length, 2);
    });

    testWidgets('closing the question posts nothing', (t) async {
      final api = server();
      await openScreen(t, ManagerApprovalsScreen(session: hrSession(api)));
      await t.tap(_in('Sam', 'Approve'));
      await t.pumpAndSettle();
      await _confirm(t, 'Not now');
      expect(api.paths('PATCH'), isEmpty);
    });

    Future<FakeHrApi> approveOne(WidgetTester t, String who) async {
      final api = server();
      await openScreen(t, ManagerApprovalsScreen(session: hrSession(api)));
      await t.tap(_in(who, 'Approve'));
      await t.pumpAndSettle();
      await _confirm(t, 'Approve');
      return api;
    }

    testWidgets('overtime is approved on the overtime route', (t) async {
      final api = await approveOne(t, 'Sam');
      expect(api.paths('PATCH'), ['/api/employees/overtime-requests/v1']);
      expect(api.bodies('PATCH', '/api').single, {'action': 'approve'});
    });

    testWidgets('regularization is approved on the regularization route', (t) async {
      final api = await approveOne(t, 'Tia');
      expect(api.paths('PATCH'), ['/api/employees/manager/attendance-regularization/r1']);
      expect(api.bodies('PATCH', '/api').single, {'action': 'approve'});
    });

    testWidgets('an expense is approved on the expense route', (t) async {
      final api = await approveOne(t, 'Ravi');
      expect(api.paths('PATCH'), ['/api/employees/expenses/x1']);
      expect(api.bodies('PATCH', '/api').single, {'action': 'approve'});
    });

    testWidgets('two taps before the answer arrives post once', (t) async {
      final answer = Completer<Map<String, dynamic>>();
      var asked = false;
      final api = FakeHrApi((m, p, b) {
        if (m == 'GET') return pending();
        asked = true;
        return answer.future;
      });
      await openScreen(t, ManagerApprovalsScreen(session: hrSession(api)));
      await t.tap(_in('Asha Rao', 'Approve'));
      await t.pumpAndSettle();
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Approve')));
      await t.pump(const Duration(milliseconds: 600));
      await t.pump(const Duration(milliseconds: 600));
      expect(asked, isTrue);
      // The row's button is busy now; tapping it again asks nothing and posts nothing.
      await t.tap(find.descendant(of: find.ancestor(of: find.text('Asha Rao'), matching: find.byType(KDivided)).first, matching: find.byType(KButton)).first, warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 600));
      expect(find.byType(BottomSheet), findsNothing);
      answer.complete(<String, dynamic>{});
      await t.pumpAndSettle();
      expect(api.paths('PATCH'), ['/api/employees/leave-requests/l1']);
    });

    testWidgets('a chain step is approved with the chain route; mark pending needs a reason', (t) async {
      final api = server();
      await openScreen(t, ManagerApprovalsScreen(session: hrSession(api)));
      await t.tap(_in('Meena', 'Mark pending'));
      await t.pumpAndSettle();
      await _confirm(t, 'Mark pending');
      expect(find.text('Give a reason first.'), findsOneWidget);
      expect(api.paths('PATCH'), isEmpty);
      await t.pumpAndSettle(const Duration(seconds: 4));
      await t.tap(_in('Meena', 'Mark pending'));
      await t.pumpAndSettle();
      await t.enterText(find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)), 'Needs a handover plan');
      await _confirm(t, 'Mark pending');
      expect(api.paths('PATCH'), ['/api/employees/manager/exit-approvals/z1']);
      expect(api.bodies('PATCH', '/api').single, {'action': 'hold', 'hold_reason': 'Needs a handover plan'});
    });

    testWidgets('nothing waiting, and the server 403 "no pending approvals", show the empty state', (t) async {
      final api = FakeHrApi((m, p, b) => ApiException('No pending approvals for you', status: 403));
      await openScreen(t, ManagerApprovalsScreen(session: hrSession(api)));
      expect(find.text('Nothing waiting for you'), findsOneWidget);
    });

    testWidgets('an error offers Try again', (t) async {
      final api = FakeHrApi((m, p, b) => ApiException('Down', status: 500));
      await openScreen(t, ManagerApprovalsScreen(session: hrSession(api)));
      expect(find.text('Try again'), findsOneWidget);
    });
  });

  group('recruitment', () {
    FakeHrApi hub({List<Map<String, dynamic>> jobs = const [], Object? Function(String m, String p, Map<String, dynamic>? b)? other}) {
      return FakeHrApi((m, p, b) {
        final o = other?.call(m, p, b);
        if (o != null) return o;
        if (p == '/api/hr/recruitment/jobs') return {'jobs': jobs};
        if (p == '/api/hr/recruitment/candidates') {
          return {'candidates': [{'id': 'c1', 'full_name': 'Asha Rao', 'email': 'asha@x.com', 'status': 'interviewing', 'job_title': 'Cashier'}]};
        }
        if (p == '/api/hr/recruitment/offer-approvals/pending') {
          return {'pending': [{'offer_id': 'o1', 'candidate_id': 'c1', 'candidate_name': 'Asha Rao', 'designation': 'Cashier', 'level_label': 'HR', 'approval_level': 1}]};
        }
        return null;
      });
    }

    final jobs = [{'id': 'j1', 'title': 'Cashier', 'department': 'Shop', 'status': 'open', 'candidate_count': 3}];

    testWidgets('the hub lists offers waiting, jobs and candidates', (t) async {
      await openScreen(t, RecruitmentScreen(session: hrSession(hub(jobs: jobs))));
      expect(find.text('Offer approvals waiting on you'), findsOneWidget);
      expect(find.text('Shop · 3 candidates'), findsOneWidget);
      expect(find.text('asha@x.com'), findsNothing);
      expect(find.text('Cashier · asha@x.com'), findsOneWidget);
    });

    testWidgets('no jobs, no candidates: the empty state', (t) async {
      final api = FakeHrApi((m, p, b) => <String, dynamic>{});
      await openScreen(t, RecruitmentScreen(session: hrSession(api)));
      expect(find.text('No jobs yet'), findsOneWidget);
    });

    testWidgets('a job is added with title, department and description only', (t) async {
      final api = hub(jobs: jobs, other: (m, p, b) => m == 'POST' ? {'job': {'id': 'j2'}} : null);
      await openScreen(t, RecruitmentScreen(session: hrSession(api)));
      await t.tap(find.bySemanticsLabel('New job'));
      await t.pumpAndSettle();
      await t.enterText(find.byType(TextField).first, 'Packer');
      await t.pump();
      await _tapText(t, 'Add job', last: true);
      expect(api.paths('POST'), ['/api/hr/recruitment/jobs']);
      expect(api.bodies('POST', '/api').single, {'title': 'Packer', 'department': '', 'description': ''});
    });

    testWidgets('a job opens with its rounds and candidates, and a candidate is added', (t) async {
      final api = FakeHrApi((m, p, b) {
        if (p == '/api/hr/recruitment/jobs/j1') {
          return {
            'job': {'id': 'j1', 'title': 'Cashier', 'department': 'Shop', 'status': 'open'},
            'stages': [{'id': 's1', 'stage_name': 'HR Round'}],
            'candidates': [{'id': 'c1', 'full_name': 'Asha Rao', 'email': 'asha@x.com', 'status': 'applied'}],
          };
        }
        return <String, dynamic>{};
      });
      await openScreen(t, JobScreen(session: hrSession(api), jobId: 'j1'));
      expect(find.text('1. HR Round'), findsOneWidget);
      expect(find.text('Asha Rao'), findsOneWidget);
      await t.tap(find.bySemanticsLabel('Add candidate'));
      await t.pumpAndSettle();
      await t.enterText(find.byType(TextField).at(0), 'Ravi');
      await t.enterText(find.byType(TextField).at(1), 'ravi@x.com');
      await t.pump();
      await _tapText(t, 'Add candidate', last: true);
      expect(api.bodies('POST', '/api/hr/recruitment/candidates').single, {'job_id': 'j1', 'full_name': 'Ravi', 'email': 'ravi@x.com', 'phone': '', 'source': ''});
    });

    Map<String, dynamic> candidate({String status = 'interviewing', Map<String, dynamic>? offer, List<dynamic> approvals = const []}) => {
          'candidate': {'id': 'c1', 'full_name': 'Asha Rao', 'email': 'asha@x.com', 'phone': '9999999999', 'status': status, 'job_title': 'Cashier'},
          'stages': [{'id': 's1', 'stage_name': 'HR Round'}],
          'interviews': [{'id': 'i1', 'stage_name': 'HR Round', 'status': 'scheduled'}],
          'offer': offer,
          'offer_approvals': approvals,
        };

    testWidgets('passing an interview asks, mentions the candidate moves, posts once and reloads', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET' ? candidate() : <String, dynamic>{});
      await openScreen(t, CandidateScreen(session: hrSession(api), candidateId: 'c1'));
      await _tapText(t, 'Pass');
      expect(find.textContaining('also moves the candidate to selected'), findsOneWidget);
      await _confirm(t, 'Mark passed');
      expect(api.paths('PATCH'), ['/api/hr/recruitment/candidates/c1/interviews/i1']);
      expect(api.bodies('PATCH', '/api').single, {'status': 'passed'});
      expect(api.paths('GET', '/api/hr/recruitment/candidates/c1').length, 2);
    });

    testWidgets('failing an interview names rejected', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET' ? candidate() : <String, dynamic>{});
      await openScreen(t, CandidateScreen(session: hrSession(api), candidateId: 'c1'));
      await _tapText(t, 'Fail');
      expect(find.textContaining('also moves the candidate to rejected'), findsOneWidget);
    });

    testWidgets('an interview is scheduled for a round', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET' ? candidate() : <String, dynamic>{});
      await openScreen(t, CandidateScreen(session: hrSession(api), candidateId: 'c1'));
      await _tapText(t, 'Schedule');
      await t.tap(find.text('Select').first);
      await t.pumpAndSettle();
      await t.tap(find.text('HR Round').last);
      await t.pumpAndSettle();
      await _tapText(t, 'Schedule', last: true);
      expect(api.bodies('POST', '/api/hr/recruitment/candidates/c1/interviews').single, {'stage_id': 's1'});
    });

    testWidgets('an offer is created as a draft with the website fields', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET' ? candidate() : <String, dynamic>{});
      await openScreen(t, CandidateScreen(session: hrSession(api), candidateId: 'c1'));
      await _tapText(t, 'Create offer');
      expect(find.text('Notice period (days)'), findsOneWidget);
      await t.enterText(find.byType(TextField).at(0), 'Cashier');
      await t.enterText(find.byType(TextField).at(1), 'Shop');
      await t.enterText(find.byType(TextField).at(2), '18000');
      await t.pump();
      // The joining date is required.
      await t.tap(find.descendant(of: find.byType(KFormScaffold), matching: find.text('Save draft')));
      await t.pumpAndSettle();
      expect(api.paths('POST', '/api/hr/recruitment/candidates/c1/offer'), isEmpty);
    });

    testWidgets('the offer PDF opens from the PDF route; an unready offer has none', (t) async {
      final api = _Bytes((m, p, b) => m == 'GET' ? candidate(offer: {'id': 'o1', 'status': 'approved', 'designation': 'Cashier', 'basic_salary': '18000'}) : <String, dynamic>{});
      await openScreen(t, CandidateScreen(session: hrSession(api), candidateId: 'c1'));
      await t.tap(find.text('Open offer PDF'));
      await t.pump(const Duration(milliseconds: 600));
      expect(api.bytesPaths, ['/api/hr/recruitment/candidates/c1/offer/pdf']);
    });

    testWidgets('a draft offer has no PDF and can be edited', (t) async {
      final draft = _Bytes((m, p, b) => m == 'GET' ? candidate(offer: {'id': 'o1', 'status': 'draft', 'designation': 'Cashier'}) : <String, dynamic>{});
      await openScreen(t, CandidateScreen(session: hrSession(draft), candidateId: 'c1'));
      expect(find.text('Open offer PDF'), findsNothing);
      expect(find.text('Edit offer'), findsOneWidget);
    });

    testWidgets('on my turn the offer is approved or rejected after asking', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET'
          ? candidate(status: 'offer_sent', offer: {'id': 'o1', 'status': 'pending_approval', 'designation': 'Cashier'}, approvals: [
              {'approval_level': 1, 'status': 'pending', 'approver_user_id': 'u', 'approver_name': 'Me', 'level_label': 'HR'},
            ])
          : <String, dynamic>{});
      await openScreen(t, CandidateScreen(session: hrSession(api), candidateId: 'c1'));
      expect(find.text('Your approval is required'), findsOneWidget);
      await _tapText(t, 'Approve');
      expect(find.textContaining('Approve the offer for Asha Rao?'), findsOneWidget);
      await _confirm(t, 'Approve');
      expect(api.paths('PATCH'), ['/api/hr/recruitment/candidates/c1/offer']);
      expect(api.bodies('PATCH', '/api').single, {'action': 'approve'});
    });

    testWidgets('not my turn: no approve buttons', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET'
          ? candidate(offer: {'id': 'o1', 'status': 'pending_approval', 'designation': 'Cashier'}, approvals: [
              {'approval_level': 1, 'status': 'pending', 'approver_user_id': 'someone-else'},
            ])
          : <String, dynamic>{});
      await openScreen(t, CandidateScreen(session: hrSession(api), candidateId: 'c1'));
      expect(find.text('Your approval is required'), findsNothing);
    });

    testWidgets('an accepted candidate converts after asking; the body names no identity', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET' ? candidate(status: 'offer_accepted', offer: {'id': 'o1', 'status': 'accepted', 'designation': 'Cashier'}) : <String, dynamic>{'employee_id': 'e9'});
      await openScreen(t, CandidateScreen(session: hrSession(api), candidateId: 'c1'));
      await t.tap(find.widgetWithText(KButton, 'Convert to employee'));
      await t.pumpAndSettle();
      expect(find.textContaining('Convert Asha Rao to an employee?'), findsOneWidget);
      await _confirm(t, 'Documents verified, convert');
      expect(api.paths('POST'), ['/api/hr/recruitment/candidates/c1/convert']);
      expect(api.bodies('POST', '/api').single, {'physical_documents_verified': true});
      // Like the website, it opens the new employee.
      expect(find.byType(EmployeeDetailScreen), findsOneWidget);
    });

    testWidgets('a refused convert shows the server message', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET'
          ? candidate(status: 'offer_accepted', offer: {'id': 'o1', 'status': 'accepted'})
          : ApiException('Candidate phone is required before converting to employee', status: 400));
      await openScreen(t, CandidateScreen(session: hrSession(api), candidateId: 'c1'));
      await t.tap(find.widgetWithText(KButton, 'Convert to employee'));
      await t.pumpAndSettle();
      await _confirm(t, 'Documents verified, convert');
      expect(find.text('Candidate phone is required before converting to employee'), findsOneWidget);
    });

    testWidgets('a candidate not yet accepted has no convert, and the rest stays on the website', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET' ? candidate() : <String, dynamic>{});
      await openScreen(t, CandidateScreen(session: hrSession(api), candidateId: 'c1'));
      expect(find.text('Convert to employee'), findsNothing);
      expect(find.text('Open on website'), findsOneWidget);
      expect(find.textContaining('Onboarding tasks, candidate documents'), findsOneWidget);
      expect(find.textContaining('Submit offer'), findsNothing);
    });

    testWidgets('a draft offer can be submitted for approval', (t) async {
      final draft = FakeHrApi((m, p, b) => m == 'GET' ? candidate(offer: {'id': 'o1', 'status': 'draft', 'designation': 'Cashier'}) : <String, dynamic>{});
      await openScreen(t, CandidateScreen(session: hrSession(draft), candidateId: 'c1'));
      expect(find.text('Submit for approval'), findsOneWidget);
    });

    testWidgets('a rejected offer has no submit button', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET' ? candidate(offer: {'id': 'o1', 'status': 'approval_rejected'}) : <String, dynamic>{});
      await openScreen(t, CandidateScreen(session: hrSession(api), candidateId: 'c1'));
      expect(find.text('Submit for approval'), findsNothing);
    });

    FakeHrApi submitServer({Object? Function(String m, String p, Map<String, dynamic>? b)? onPatch}) => FakeHrApi((m, p, b) {
          if (p == '/api/settings/hr-approval') return {'settings': {'offer_min_levels': 1, 'offer_max_levels': 2}};
          if (p.startsWith('/api/todos/users')) return {'users': [{'id': 'u1', 'name': 'Boss', 'display_name': 'Boss (E1)'}]};
          if (m == 'PATCH') return onPatch?.call(m, p, b) ?? <String, dynamic>{};
          return <String, dynamic>{};
        });

    Future<void> chooseAndSubmit(WidgetTester t) async {
      await t.tap(find.descendant(of: find.byWidgetPredicate((w) => w is KPickField && w.label == 'Approver'), matching: find.byType(InkWell)));
      await t.pumpAndSettle();
      await t.tap(find.text('Boss (E1)').last);
      await t.pumpAndSettle();
      await t.tap(find.descendant(of: find.byType(KFormScaffold), matching: find.text('Submit for approval')).last);
      await t.pump(const Duration(milliseconds: 600));
      await t.pump(const Duration(milliseconds: 600));
    }

    testWidgets('submitting asks first, then sends the chosen approvers only', (t) async {
      final api = submitServer();
      await openScreen(t, SubmitOfferScreen(session: hrSession(api), candidateId: 'c1', candidateName: 'Asha Rao'));
      expect(api.paths('GET'), containsAll(['/api/settings/hr-approval', '/api/todos/users']));
      expect(find.text('Level 1'), findsOneWidget);
      expect(find.text('Add level'), findsOneWidget);
      await chooseAndSubmit(t);
      expect(find.textContaining('Submit Asha Rao\'s offer for approval to Boss (E1)?'), findsOneWidget);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Submit')));
      await t.pump(const Duration(milliseconds: 600));
      await t.pump(const Duration(milliseconds: 600));
      expect(api.paths('PATCH'), ['/api/hr/recruitment/candidates/c1/offer']);
      expect(api.bodies('PATCH', '/api').single, {
        'action': 'submit_for_approval',
        'approvers': [{'level': 1, 'label': 'Hiring Manager', 'user_id': 'u1'}],
      });
    });

    testWidgets('the server refusal (onboarding incomplete) is shown and the form stays', (t) async {
      final api = submitServer(onPatch: (m, p, b) => ApiException('Candidate must finish onboarding first', status: 400, code: 'ONBOARDING_INCOMPLETE'));
      await openScreen(t, SubmitOfferScreen(session: hrSession(api), candidateId: 'c1', candidateName: 'Asha Rao'));
      await chooseAndSubmit(t);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Submit')));
      await t.pump(const Duration(milliseconds: 600));
      await t.pump(const Duration(milliseconds: 600));
      expect(find.text('Candidate must finish onboarding first'), findsOneWidget);
      expect(find.byType(SubmitOfferScreen), findsOneWidget);
    });

    testWidgets('no approver chosen: nothing is asked or sent', (t) async {
      final api = submitServer();
      await openScreen(t, SubmitOfferScreen(session: hrSession(api), candidateId: 'c1', candidateName: 'Asha Rao'));
      await t.tap(find.descendant(of: find.byType(KFormScaffold), matching: find.text('Submit for approval')).last, warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 600));
      expect(find.byType(BottomSheet), findsNothing);
      expect(api.paths('PATCH'), isEmpty);
    });
  });

  group('exits', () {
    Map<String, dynamic> detail({String status = 'pending_approval', Map<String, dynamic>? perms, String role = 'reporting_manager', String stepStatus = 'awaiting'}) => {
          'exit': {'id': 'z1', 'employee_name': 'Meena', 'exit_type': 'resignation', 'status': status, 'notice_period_days': 30, 'fnf_status': 'pending'},
          'tasks': [{'id': 't1', 'title': 'Return laptop', 'category': 'assets', 'status': 'pending'}, {'id': 't2', 'title': 'Exit interview', 'category': 'hr', 'status': 'completed'}],
          'approvals': [{'id': 'a1', 'approval_level': 1, 'level_label': 'Manager', 'role_type': role, 'approver_name': 'Boss', 'status': stepStatus}],
          'permissions': perms ?? {'can_hr_reject': true, 'can_act_on_step': true},
        };

    testWidgets('the list shows each exit and its status', (t) async {
      final api = FakeHrApi((m, p, b) => {'exits': [{'id': 'z1', 'employee_name': 'Meena', 'employee_code': 'E9', 'exit_type': 'resignation', 'status': 'pending_approval', 'fnf_status': 'pending'}]});
      await openScreen(t, ExitsScreen(session: hrSession(api)));
      expect(find.text('Meena (E9)'), findsOneWidget);
      expect(find.text('pending approval'), findsOneWidget);
    });

    testWidgets('an empty list says so', (t) async {
      await openScreen(t, ExitsScreen(session: hrSession(FakeHrApi((m, p, b) => {'exits': []}))));
      expect(find.text('No exits'), findsOneWidget);
    });

    testWidgets('an error offers Try again', (t) async {
      await openScreen(t, ExitsScreen(session: hrSession(FakeHrApi((m, p, b) => ApiException('Down', status: 500)))));
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('starting an exit asks first, naming the person, and posts the website body', (t) async {
      final api = FakeHrApi((m, p, b) {
        if (p == '/api/settings/hr-exit') return {'settings': {'exit_reasons': ['Better opportunity', 'Relocation']}};
        if (p == '/api/employees' || p.startsWith('/api/employees?')) {
          return {'employees': [{'id': 'e1', 'name': 'Meena', 'employee_code': 'E9'}]};
        }
        return <String, dynamic>{};
      });
      await openScreen(t, StartExitScreen(session: hrSession(api)));
      expect(find.text('Reason (optional)'), findsOneWidget);
      await t.tap(find.descendant(of: find.byWidgetPredicate((w) => w.runtimeType.toString() == 'KAsyncPickField'), matching: find.byType(InkWell)));
      await t.pumpAndSettle();
      await t.tap(find.text('Meena').last);
      await t.pumpAndSettle();
      await t.tap(find.descendant(of: find.byType(KFormScaffold), matching: find.text('Start exit')).last);
      await t.pump(const Duration(milliseconds: 600)); // the save button spins while the question is open
      await t.pump(const Duration(milliseconds: 600));
      expect(find.textContaining('Start a resignation for Meena?'), findsOneWidget);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Start exit')));
      await t.pump(const Duration(milliseconds: 600));
      await t.pump(const Duration(milliseconds: 600));
      expect(api.paths('POST'), ['/api/hr/exits']);
      expect(api.bodies('POST', '/api').single, {'employee_id': 'e1', 'exit_type': 'resignation'});
    });

    testWidgets('detail shows approvals and the checklist; Done posts once and reloads', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET' ? detail() : <String, dynamic>{});
      await openScreen(t, ExitDetailScreen(session: hrSession(api), exitId: 'z1'));
      expect(find.text('Notice: 30 days · F&F: pending'), findsOneWidget);
      expect(find.text('Current step: Manager'), findsOneWidget);
      expect(find.text('Completed'), findsOneWidget);
      await _tapText(t, 'Done');
      expect(api.bodies('PATCH', '/api/hr/exits/z1').single, {'action': 'update_task', 'task_id': 't1', 'status': 'completed'});
      expect(api.paths('GET', '/api/hr/exits/z1').length, 2);
    });

    testWidgets('approving a step asks first and sends only the action', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET' ? detail() : <String, dynamic>{});
      await openScreen(t, ExitDetailScreen(session: hrSession(api), exitId: 'z1'));
      await _tapText(t, 'Approve');
      expect(find.textContaining('Approve Meena\'s resignation at Manager?'), findsOneWidget);
      await _confirm(t, 'Approve');
      expect(api.bodies('PATCH', '/api/hr/exits/z1').single, {'action': 'approve'});
    });

    testWidgets('HR reject asks first; a refusal shows the server message and reloads', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET' ? detail() : ApiException('Exit cannot be rejected in its current state', status: 400));
      await openScreen(t, ExitDetailScreen(session: hrSession(api), exitId: 'z1'));
      await _tapText(t, 'Reject resignation (HR only)');
      await _confirm(t, 'Reject resignation');
      expect(find.text('Exit cannot be rejected in its current state'), findsOneWidget);
      expect(api.paths('GET', '/api/hr/exits/z1').length, 2);
    });

    testWidgets('mark pending needs a reason and is hidden on an HR step', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'GET' ? detail() : <String, dynamic>{});
      await openScreen(t, ExitDetailScreen(session: hrSession(api), exitId: 'z1'));
      await _tapText(t, 'Mark pending');
      await t.enterText(find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)), 'Handover first');
      await _confirm(t, 'Mark pending');
      expect(api.bodies('PATCH', '/api/hr/exits/z1').single, {'action': 'hold', 'hold_reason': 'Handover first'});
    });

    testWidgets('mark pending is hidden on an HR step', (t) async {
      final hr = FakeHrApi((m, p, b) => detail(role: 'hr'));
      await openScreen(t, ExitDetailScreen(session: hrSession(hr), exitId: 'z1'));
      expect(find.text('Mark pending'), findsNothing);
    });

    testWidgets('a person who cannot act sees no action panel', (t) async {
      final api = FakeHrApi((m, p, b) => detail(perms: {'can_hr_reject': false, 'can_act_on_step': false}));
      await openScreen(t, ExitDetailScreen(session: hrSession(api), exitId: 'z1'));
      expect(find.text('Approve'), findsNothing);
      expect(find.text('Return laptop'), findsOneWidget);
    });
  });

  group('routes', () {
    final s = hrSession(FakeHrApi((m, p, b) => null));
    test('the four links are native and no longer generic', () {
      expect(nativeScreenFor(s, '/hr/dashboard'), isA<HrDashboardScreen>());
      expect(nativeScreenFor(s, '/employees/manager'), isA<ManagerScreen>());
      expect(nativeScreenFor(s, '/employees/recruitment'), isA<RecruitmentScreen>());
      expect(nativeScreenFor(s, '/hr/exits'), isA<ExitsScreen>());
    });
  });
}
