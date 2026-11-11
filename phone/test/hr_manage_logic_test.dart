import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/hr/hr_manage_logic.dart';

void main() {
  group('HR dashboard', () {
    final o = HrOverview.fromJson({
      'headcount': 12, 'pending_invites': 2, 'pending_leaves': 3, 'present_today': 8, 'absent_today': 4,
      'in_probation': 1, 'pending_exit_approvals': 1, 'active_announcements': 5, 'birthdays_this_week': 2,
      'new_joiners_this_month': 3, 'date': '11 Nov 2026',
      'notifications': [
        {'type': 'leaves', 'label': 'Leave approvals pending', 'count': 3, 'href': '/employees/leaves'},
      ],
    });
    test('reads the server numbers', () {
      expect(o.headcount, 12);
      expect(o.presentToday, 8);
      expect(o.notifications.single.href, '/employees/leaves');
    });
    test('inbox adds leaves, exits and invites like the website', () {
      expect(o.inboxTotal, 6);
      expect(o.inboxText, '3 leave, 1 exit, 2 invite actions pending.');
      expect(HrOverview.fromJson({'pending_leaves': 1}).inboxText, '1 leave, 0 exit, 0 invite action pending.');
      expect(HrOverview.fromJson(const {}).inboxText, 'No pending HR actions right now.');
    });
    test('tiles carry the numbers and the website screen they open', () {
      final tiles = hrTiles(o);
      expect(tiles.map((t) => t.title), [
        'Inbox', 'Present today', 'Pending leaves', 'In probation', 'Birthdays this week',
        'New joiners (month)', 'Active announcements', 'Exit approvals',
      ]);
      expect(tiles.first.href, '/employees/leaves');
      expect(tiles[1].value, 8);
      expect(tiles[1].href, '/employees/attendance');
      expect(tiles[4].href, isNull);
      expect(tiles.last.href, '/hr/exits');
    });
    test('the inbox opens the first notification when there is one', () {
      expect(hrTiles(HrOverview.fromJson(const {})).first.href, '/employees/leaves');
      final withNote = HrOverview.fromJson({'notifications': [{'type': 'exits', 'label': 'x', 'count': 1, 'href': '/hr/exits'}]});
      expect(hrTiles(withNote).first.href, '/hr/exits');
    });
    test('the go-to list matches the website', () {
      expect(hrQuickLinks.map((l) => l.href), [
        '/employees', '/employees/org-chart', '/employees/manager', '/employees/attendance', '/employees/leaves',
        '/employees/salary/payments', '/hr/engagement', '/hr/exits', '/hr/reports', '/employees/leaves/calendar',
      ]);
    });
  });

  group('manager', () {
    test('dashboard numbers', () {
      final d = ManagerDashboard.fromJson({'team_count': 4, 'pending_leaves': 2, 'pending_expenses': 1, 'present_today': 3, 'absent_today': 1});
      expect((d.teamCount, d.pendingLeaves, d.pendingExpenses, d.presentToday), (4, 2, 1, 3));
    });
    test('team members', () {
      final t = teamMembers([
        {'id': 'e1', 'employee_code': 'E1', 'name': 'Asha', 'designation': 'Cashier', 'department': 'Shop', 'is_active': true, 'attendance_status': 'present'},
        {'name': 'no id'},
      ]);
      expect(t.length, 1);
      expect(t.first.name, 'Asha');
      expect(t.first.attendanceStatus, 'present');
    });
    test('pending approvals parse every kind', () {
      final p = PendingApprovals.fromJson({
        'leaves': [{'id': 'l1', 'employee_name': 'Asha', 'leave_name': 'Casual', 'start_date': '2026-11-12T00:00:00.000Z', 'end_date': '2026-11-13', 'total_days': 2, 'reason': 'trip'}],
        'expenses': [{'id': 'x1', 'employee_name': 'Ravi', 'amount': '250.00', 'description': 'Taxi', 'expense_date': '2026-11-10'}],
        'exits': [{'exit_id': 'z1', 'employee_name': 'Meena', 'approval_level': 2, 'level_label': null, 'role_type': 'hr', 'status': 'awaiting', 'hold_reason': null, 'created_at': '2026-11-01'}],
        'leave_chain': [{'leave_request_id': 'c1', 'employee_name': 'Kim', 'leave_name': 'Sick', 'start_date': '2026-11-12', 'end_date': '2026-11-12', 'total_days': 1, 'approval_level': 1, 'level_label': 'Manager', 'role_type': 'reporting_manager', 'status': 'awaiting', 'hold_reason': null}],
        'ot_chain': [{'overtime_request_id': 'o1', 'employee_name': 'Lee', 'request_date': '2026-11-09', 'total_hours': 2.5, 'reason': null, 'approval_level': 1, 'level_label': null, 'role_type': 'reporting_manager', 'status': 'on_hold', 'hold_reason': 'wait'}],
        'overtime': [{'id': 'v1', 'employee_name': 'Sam', 'request_date': '2026-11-08', 'total_hours': 1, 'reason': 'rush'}],
        'regularizations': [{'id': 'r1', 'employee_name': 'Tia', 'employee_code': 'T1', 'attendance_date': '2026-11-07', 'request_type': 'missing_check_in', 'reason': 'forgot'}],
      });
      expect(p.leaves.single.id, 'l1');
      expect(p.expenses.single.amount, 250);
      expect(p.exits.single.stepLabel, 'Level 2');
      expect(p.leaveChain.single.stepLabel, 'Manager');
      expect(p.otChain.single.isOnHold, isTrue);
      expect(p.otChain.single.holdReason, 'wait');
      expect(p.overtime.single.hours, 1);
      expect(p.regularizations.single.id, 'r1');
      expect(p.isEmpty, isFalse);
      expect(PendingApprovals.fromJson(const {}).isEmpty, isTrue);
    });
    test('exit step: exception needed, hold only for non-HR awaiting steps', () {
      PendingExit ex(String role, String status) => PendingExit.fromJson({'exit_id': 'z', 'employee_name': 'M', 'approval_level': 1, 'role_type': role, 'status': status})!;
      expect(ex('reporting_manager', 'awaiting').canHold, isTrue);
      expect(ex('hr', 'awaiting').canHold, isFalse);
      expect(ex('reporting_manager', 'on_hold').canHold, isFalse);
      expect(ex('reporting_manager', 'exception_needed').needsException, isTrue);
    });
    test('requests name the route and never an identity', () {
      expect(managerLeavePath('l1'), '/api/employees/leave-requests/l1');
      expect(leaveDecisionBody(approve: true), {'action': 'approve'});
      expect(leaveDecisionBody(approve: false, reason: ' trip '), {'action': 'reject', 'rejection_reason': 'trip'});
      expect(leaveChainPath('c1'), '/api/employees/manager/leave-approvals/c1');
      expect(otChainPath('o1'), '/api/employees/manager/ot-approvals/o1');
      expect(overtimePath('v1'), '/api/employees/overtime-requests/v1');
      expect(managerExitPath('z1'), '/api/employees/manager/exit-approvals/z1');
      expect(chainBody('approve'), {'action': 'approve'});
      expect(chainBody('hold', holdReason: ' later '), {'action': 'hold', 'hold_reason': 'later'});
      expect(overtimeDecisionBody(approve: false, reason: 'no'), {'action': 'reject', 'rejection_reason': 'no'});
      expect(overtimeDecisionBody(approve: true), {'action': 'approve'});
    });
  });

  group('recruitment', () {
    test('paths', () {
      expect(recruitJobsPath, '/api/hr/recruitment/jobs');
      expect(recruitJobPath('j1'), '/api/hr/recruitment/jobs/j1');
      expect(recruitCandidatePath('c1'), '/api/hr/recruitment/candidates/c1');
      expect(recruitInterviewsPath('c1'), '/api/hr/recruitment/candidates/c1/interviews');
      expect(recruitInterviewPath('c1', 'i1'), '/api/hr/recruitment/candidates/c1/interviews/i1');
      expect(recruitOfferPath('c1'), '/api/hr/recruitment/candidates/c1/offer');
      expect(recruitOfferPdfPath('c1'), '/api/hr/recruitment/candidates/c1/offer/pdf');
      expect(recruitConvertPath('c1'), '/api/hr/recruitment/candidates/c1/convert');
      expect(recruitPendingOffersPath, '/api/hr/recruitment/offer-approvals/pending');
    });
    test('job and candidate bodies', () {
      expect(jobBody(title: ' Cashier ', department: ' ', description: 'Counter'), {'title': 'Cashier', 'department': '', 'description': 'Counter'});
      expect(candidateBody(jobId: 'j1', fullName: ' Asha ', email: 'A@x.com ', phone: '', source: 'Walk-in'),
          {'job_id': 'j1', 'full_name': 'Asha', 'email': 'A@x.com', 'phone': '', 'source': 'Walk-in'});
    });
    test('interview bodies', () {
      expect(interviewBody(stageId: 's1'), {'stage_id': 's1'});
      expect(interviewBody(stageId: 's1', scheduledAt: DateTime.utc(2026, 11, 12, 10, 30)), {'stage_id': 's1', 'scheduled_at': '2026-11-12T10:30:00.000Z'});
      expect(interviewResultBody(passed: true), {'status': 'passed'});
      expect(interviewResultBody(passed: false), {'status': 'failed'});
    });
    test('offer body matches the website form', () {
      final b = offerBody(
        designation: ' Cashier ', department: 'Shop', joiningDate: DateTime(2026, 12, 1), basicSalary: '18000',
        workLocation: 'Pune', annualBonus: '', noticePeriodDays: '', probationMonths: '3',
        signatoryName: 'Owner', signatoryTitle: 'Director', terms: 'T&C',
      );
      expect(b, {
        'designation': 'Cashier', 'department': 'Shop', 'joining_date': '2026-12-01', 'basic_salary': 18000,
        'work_location': 'Pune', 'annual_bonus': 0, 'notice_period_days': 30, 'probation_months': 3,
        'signatory_name': 'Owner', 'signatory_title': 'Director', 'terms_text': 'T&C',
      });
      expect(offerActionBody('send'), {'action': 'send'});
      expect(offerActionBody('reject', comments: ' no '), {'action': 'reject', 'comments': 'no'});
      expect(convertBody(), {'physical_documents_verified': true});
    });
    test('who can do what follows the website', () {
      expect(canEditOffer(null), isTrue);
      expect(canEditOffer('draft'), isTrue);
      expect(canEditOffer('approval_rejected'), isTrue);
      expect(canEditOffer('sent'), isFalse);
      expect(offerPdfReady('approved'), isTrue);
      expect(offerPdfReady('draft'), isFalse);
      expect(canConvert('offer_accepted', employeeId: null), isTrue);
      expect(canConvert('offer_accepted', employeeId: 'e1'), isFalse);
      expect(canConvert('interviewing', employeeId: null), isFalse);
      expect(statusWords('offer_accepted'), 'offer accepted');
    });
    test('my approval turn is the lowest pending level with my user id', () {
      final approvals = [
        {'approval_level': 2, 'status': 'pending', 'approver_user_id': 'me'},
        {'approval_level': 1, 'status': 'approved', 'approver_user_id': 'x'},
      ];
      expect(isMyOfferTurn('pending_approval', approvals, 'me'), isTrue);
      expect(isMyOfferTurn('pending_approval', approvals, 'other'), isFalse);
      expect(isMyOfferTurn('approved', approvals, 'me'), isFalse);
    });
    test('parse rows', () {
      final jobs = recruitJobs([{'id': 'j1', 'title': 'Cashier', 'department': null, 'status': 'open', 'candidate_count': 3}, {'title': 'x'}]);
      expect(jobs.single.candidateCount, 3);
      final c = RecruitCandidate.fromJson({'id': 'c1', 'full_name': 'Asha', 'email': 'a@x', 'status': 'offer_accepted', 'job_title': 'Cashier', 'employee_id': null})!;
      expect(c.jobTitle, 'Cashier');
      final i = RecruitInterview.fromJson({'id': 'i1', 'stage_name': 'HR Round', 'status': 'scheduled', 'scheduled_at': '2026-11-12T10:00:00.000Z'})!;
      expect(i.stageName, 'HR Round');
      final p = pendingOffers([{'offer_id': 'o1', 'candidate_id': 'c1', 'candidate_name': 'Asha', 'designation': 'Cashier', 'level_label': 'HR', 'approval_level': 1}]);
      expect(p.single.candidateName, 'Asha');
    });
  });

  group('exits', () {
    test('requests', () {
      expect(exitsPath, '/api/hr/exits');
      expect(exitPath('z1'), '/api/hr/exits/z1');
      expect(exitReasonsPath, '/api/settings/hr-exit');
      expect(startExitBody(employeeId: 'e1', terminate: false, reason: ''), {'employee_id': 'e1', 'exit_type': 'resignation'});
      expect(startExitBody(employeeId: 'e1', terminate: true, reason: ' Misconduct '), {'employee_id': 'e1', 'exit_type': 'termination', 'reason': 'Misconduct'});
      expect(exitTaskDoneBody('t1'), {'action': 'update_task', 'task_id': 't1', 'status': 'completed'});
      expect(exitDecisionBody('hold', holdReason: ' x '), {'action': 'hold', 'hold_reason': 'x'});
      expect(exitDecisionBody('reject'), {'action': 'reject'});
    });
    test('rows and detail', () {
      final rows = exitRows([{'id': 'z1', 'employee_name': 'Meena', 'employee_code': 'E9', 'exit_type': 'resignation', 'status': 'pending_approval', 'fnf_status': 'pending'}, {}]);
      expect(rows.single.statusWords, 'pending approval');
      final d = ExitDetail.fromJson({
        'exit': {'id': 'z1', 'employee_name': 'Meena', 'exit_type': 'resignation', 'status': 'pending_approval', 'notice_period_days': 30, 'fnf_status': 'pending'},
        'tasks': [{'id': 't1', 'title': 'Return laptop', 'category': 'assets', 'status': 'pending'}],
        'approvals': [{'id': 'a1', 'approval_level': 1, 'level_label': 'Manager', 'role_type': 'reporting_manager', 'approver_name': 'Boss', 'status': 'awaiting', 'hold_reason': null}],
        'permissions': {'can_hr_reject': true, 'can_act_on_step': true},
      });
      expect(d.tasks.single.done, isFalse);
      expect(d.activeStep!.stepLabel, 'Manager');
      expect(d.canActOnStep, isTrue);
      expect(d.canHrReject, isTrue);
      expect(d.isResignation, isTrue);
      expect(d.awaitingApproval, isTrue);
      expect(d.showException, isFalse);
      expect(d.noticeLine, 'Notice: 30 days · F&F: pending');
    });
  });

  group('submit offer for approval', () {
    test('paths', () {
      expect(hrApprovalSettingsPath, '/api/settings/hr-approval');
      expect(todosUsersPath, '/api/todos/users');
    });
    test('level rules: at least one level, no maximum unless the server says', () {
      final none = OfferApprovalRules.fromJson({'settings': <String, dynamic>{}});
      expect((none.minLevels, none.maxLevels), (1, null));
      final r = OfferApprovalRules.fromJson({'settings': {'offer_min_levels': 2, 'offer_max_levels': 3}});
      expect((r.minLevels, r.maxLevels), (2, 3));
      expect(r.canAdd(2), isTrue);
      expect(r.canAdd(3), isFalse);
      expect(r.canRemove(2), isFalse);
      expect(r.canRemove(3), isTrue);
      expect(none.canAdd(50), isTrue);
    });
    test('approver choices use the display name', () {
      final u = approverOptions([
        {'id': 'u1', 'name': 'Boss', 'display_name': 'Boss (E1)'},
        {'id': 'u2', 'name': 'Meena'},
        {'name': 'no id'},
      ]);
      expect(u.map((e) => (e.id, e.label)), [('u1', 'Boss (E1)'), ('u2', 'Meena')]);
    });
    test('body numbers the levels from 1 and sends only the chosen users', () {
      expect(submitOfferBody([(' Hiring Manager ', 'u1'), ('', 'u2')]), {
        'action': 'submit_for_approval',
        'approvers': [
          {'level': 1, 'label': 'Hiring Manager', 'user_id': 'u1'},
          {'level': 2, 'user_id': 'u2'},
        ],
      });
    });
    test('an offer can be submitted only as a draft', () {
      expect(canSubmitOffer('draft'), isTrue);
      expect(canSubmitOffer('approval_rejected'), isFalse);
      expect(canSubmitOffer(null), isFalse);
    });
  });
}
