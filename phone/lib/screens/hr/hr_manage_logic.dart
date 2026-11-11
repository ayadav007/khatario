/// Pure helpers for the HR dashboard, the manager view, recruitment and exits.
///
/// Every request here leaves out `business_id`, `user_id`, `created_by` and every approver or actor
/// id: the session names the business and the user, and the server takes the approver from the
/// session. The phone shows the server's numbers and statuses; it adds up nothing itself.
library;

import '../../format.dart';
import 'attendance_leave_logic.dart';

String _t(dynamic v) => v?.toString().trim() ?? '';

String? _orNull(dynamic v) {
  final t = _t(v);
  return t.isEmpty ? null : t;
}

int _int(dynamic v) => toNum(v).toInt();

DateTime? _day(dynamic v) {
  final s = _t(v);
  if (s.length < 10) return null;
  final d = DateTime.tryParse(s.substring(0, 10));
  return d == null ? null : dateOnly(d);
}

List<T> _list<T>(dynamic list, T? Function(dynamic) parse) =>
    list is List ? list.map(parse).whereType<T>().toList() : <T>[];

/// "offer_accepted" -> "offer accepted" (the website's `replace(/_/g, ' ')`).
String statusWords(String status) => status.replaceAll('_', ' ');

// ---------------------------------------------------------------------------------------------
// HR dashboard: `GET /api/hr/dashboard/overview`
// ---------------------------------------------------------------------------------------------

const hrOverviewPath = '/api/hr/dashboard/overview';

class HrNotice {
  const HrNotice({required this.type, required this.label, required this.count, required this.href});

  final String type, label, href;
  final int count;
}

class HrOverview {
  const HrOverview({
    this.headcount = 0,
    this.pendingInvites = 0,
    this.pendingLeaves = 0,
    this.presentToday = 0,
    this.absentToday = 0,
    this.inProbation = 0,
    this.pendingExitApprovals = 0,
    this.activeAnnouncements = 0,
    this.birthdaysThisWeek = 0,
    this.newJoinersThisMonth = 0,
    this.date = '',
    this.notifications = const [],
  });

  final int headcount, pendingInvites, pendingLeaves, presentToday, absentToday, inProbation;
  final int pendingExitApprovals, activeAnnouncements, birthdaysThisWeek, newJoinersThisMonth;
  final String date;
  final List<HrNotice> notifications;

  factory HrOverview.fromJson(Map<String, dynamic> j) => HrOverview(
        headcount: _int(j['headcount']),
        pendingInvites: _int(j['pending_invites']),
        pendingLeaves: _int(j['pending_leaves']),
        presentToday: _int(j['present_today']),
        absentToday: _int(j['absent_today']),
        inProbation: _int(j['in_probation']),
        pendingExitApprovals: _int(j['pending_exit_approvals']),
        activeAnnouncements: _int(j['active_announcements']),
        birthdaysThisWeek: _int(j['birthdays_this_week']),
        newJoinersThisMonth: _int(j['new_joiners_this_month']),
        date: _t(j['date']),
        notifications: _list(j['notifications'], (n) {
          if (n is! Map) return null;
          final href = _t(n['href']);
          if (href.isEmpty) return null;
          return HrNotice(type: _t(n['type']), label: _t(n['label']), count: _int(n['count']), href: href);
        }),
      );

  int get inboxTotal => pendingLeaves + pendingExitApprovals + pendingInvites;

  String get inboxText => inboxTotal > 0
      ? '$pendingLeaves leave, $pendingExitApprovals exit, $pendingInvites invite action${inboxTotal == 1 ? '' : 's'} pending.'
      : 'No pending HR actions right now.';
}

class HrTile {
  const HrTile({required this.title, required this.value, this.description, this.href, this.warn = false});

  final String title;
  final int value;
  final String? description;
  final String? href;
  final bool warn;
}

/// The tiles of the website's "Today" section, with the numbers as the server sent them.
List<HrTile> hrTiles(HrOverview o) => [
      HrTile(title: 'Inbox', value: o.inboxTotal, description: o.inboxText, href: o.notifications.isEmpty ? '/employees/leaves' : o.notifications.first.href),
      HrTile(title: 'Present today', value: o.presentToday, description: '${o.absentToday} absent · ${o.headcount} active employees', href: '/employees/attendance'),
      HrTile(title: 'Pending leaves', value: o.pendingLeaves, href: '/employees/leaves', warn: true),
      HrTile(title: 'In probation', value: o.inProbation, description: 'Employees still in probation', href: '/employees'),
      HrTile(title: 'Birthdays this week', value: o.birthdaysThisWeek, description: 'Celebrate your team this week'),
      HrTile(title: 'New joiners (month)', value: o.newJoinersThisMonth, href: '/employees'),
      HrTile(title: 'Active announcements', value: o.activeAnnouncements, href: '/hr/engagement'),
      HrTile(title: 'Exit approvals', value: o.pendingExitApprovals, href: '/hr/exits', warn: o.pendingExitApprovals > 0),
    ];

class HrLink {
  const HrLink(this.href, this.label, this.description);

  final String href, label, description;
}

const hrQuickLinks = <HrLink>[
  HrLink('/employees', 'People', 'Directory & profiles'),
  HrLink('/employees/org-chart', 'Org chart', 'Reporting structure'),
  HrLink('/employees/manager', 'Manager hub', 'Team approvals'),
  HrLink('/employees/attendance', 'Attendance', 'Daily presence'),
  HrLink('/employees/leaves', 'Leaves', 'Requests & balances'),
  HrLink('/employees/salary/payments', 'Payroll', 'Salary & payslips'),
  HrLink('/hr/engagement', 'Engagement', 'Announcements'),
  HrLink('/hr/exits', 'Exits', 'Resignations & F&F'),
  HrLink('/hr/reports', 'Reports', 'HR analytics'),
  HrLink('/employees/leaves/calendar', 'Leave calendar', 'Team leave view'),
];

// ---------------------------------------------------------------------------------------------
// Manager: dashboard, team, pending approvals
// ---------------------------------------------------------------------------------------------

const managerDashboardPath = '/api/employees/manager/dashboard';
const managerTeamPath = '/api/employees/manager/team';
const managerPendingPath = '/api/employees/manager/pending-approvals';

class ManagerDashboard {
  const ManagerDashboard({this.teamCount = 0, this.pendingLeaves = 0, this.pendingExpenses = 0, this.presentToday = 0, this.absentToday = 0});

  final int teamCount, pendingLeaves, pendingExpenses, presentToday, absentToday;

  factory ManagerDashboard.fromJson(Map<String, dynamic> j) => ManagerDashboard(
        teamCount: _int(j['team_count']),
        pendingLeaves: _int(j['pending_leaves']),
        pendingExpenses: _int(j['pending_expenses']),
        presentToday: _int(j['present_today']),
        absentToday: _int(j['absent_today']),
      );
}

class TeamMember {
  const TeamMember({required this.id, required this.code, required this.name, this.designation, this.department, this.isActive = true, this.attendanceStatus});

  final String id, code, name;
  final String? designation, department, attendanceStatus;
  final bool isActive;

  static TeamMember? fromJson(dynamic j) {
    if (j is! Map) return null;
    final id = _t(j['id']);
    if (id.isEmpty) return null;
    return TeamMember(
      id: id,
      code: _t(j['employee_code']),
      name: _orNull(j['name']) ?? 'Employee',
      designation: _orNull(j['designation']),
      department: _orNull(j['department']),
      isActive: j['is_active'] != false,
      attendanceStatus: _orNull(j['attendance_status']),
    );
  }
}

List<TeamMember> teamMembers(dynamic list) => _list(list, TeamMember.fromJson);

String _name(Map j) => _orNull(j['employee_name']) ?? _orNull(j['employee_code']) ?? 'Employee';

class PendingLeave {
  const PendingLeave({required this.id, required this.employeeName, required this.leaveName, required this.start, required this.end, required this.days, this.reason});

  final String id, employeeName, leaveName;
  final DateTime? start, end;
  final num days;
  final String? reason;

  static PendingLeave? fromJson(dynamic j) {
    if (j is! Map || _t(j['id']).isEmpty) return null;
    return PendingLeave(
      id: _t(j['id']),
      employeeName: _name(j),
      leaveName: _orNull(j['leave_name']) ?? 'Leave',
      start: _day(j['start_date']),
      end: _day(j['end_date']),
      days: toNum(j['total_days']),
      reason: _orNull(j['reason']),
    );
  }

  String get line => '$leaveName · ${_range(start, end)} · ${_days(days)}';
}

String _days(num d) => d == 1 ? '1 day' : '${jsNumberString(d)} days';

String _range(DateTime? s, DateTime? e) {
  if (s == null) return '';
  if (e == null || e == s) return dMMM(s);
  if (s.month == e.month && s.year == e.year) return '${s.day}–${dMMM(e)}';
  return '${dMMM(s)} – ${dMMM(e)}';
}

class PendingExpense {
  const PendingExpense({required this.id, required this.employeeName, required this.amount, required this.description, this.date});

  final String id, employeeName, description;
  final num amount;
  final DateTime? date;

  static PendingExpense? fromJson(dynamic j) {
    if (j is! Map || _t(j['id']).isEmpty) return null;
    return PendingExpense(id: _t(j['id']), employeeName: _name(j), amount: toNum(j['amount']), description: _t(j['description']), date: _day(j['expense_date']));
  }
}

/// A step in a chain (resignation, leave or overtime).
mixin ChainStep {
  int get level;
  String? get levelLabel;
  String get roleType;
  String get status;
  String? get holdReason;

  String get stepLabel => levelLabel ?? 'Level $level';
  bool get isOnHold => status == 'on_hold';
  bool get needsException => status == 'exception_needed';

  /// "Mark pending" is for department approvers on a step that is not already on hold.
  bool get canHold => roleType != 'hr' && !isOnHold && !needsException;
}

class PendingExit with ChainStep {
  const PendingExit({required this.exitId, required this.employeeName, required this.level, this.levelLabel, required this.roleType, required this.status, this.holdReason});

  final String exitId, employeeName;
  @override
  final int level;
  @override
  final String? levelLabel, holdReason;
  @override
  final String roleType, status;

  static PendingExit? fromJson(dynamic j) {
    if (j is! Map || _t(j['exit_id']).isEmpty) return null;
    return PendingExit(
      exitId: _t(j['exit_id']),
      employeeName: _name(j),
      level: _int(j['approval_level']),
      levelLabel: _orNull(j['level_label']),
      roleType: _t(j['role_type']),
      status: _t(j['status']),
      holdReason: _orNull(j['hold_reason']),
    );
  }
}

class PendingLeaveChain with ChainStep {
  const PendingLeaveChain({required this.id, required this.employeeName, required this.leaveName, this.start, this.end, required this.days, required this.level, this.levelLabel, required this.roleType, required this.status, this.holdReason});

  final String id, employeeName, leaveName;
  final DateTime? start, end;
  final num days;
  @override
  final int level;
  @override
  final String? levelLabel, holdReason;
  @override
  final String roleType, status;

  static PendingLeaveChain? fromJson(dynamic j) {
    if (j is! Map || _t(j['leave_request_id']).isEmpty) return null;
    return PendingLeaveChain(
      id: _t(j['leave_request_id']),
      employeeName: _name(j),
      leaveName: _orNull(j['leave_name']) ?? 'Leave',
      start: _day(j['start_date']),
      end: _day(j['end_date']),
      days: toNum(j['total_days']),
      level: _int(j['approval_level']),
      levelLabel: _orNull(j['level_label']),
      roleType: _t(j['role_type']),
      status: _t(j['status']),
      holdReason: _orNull(j['hold_reason']),
    );
  }

  String get line => '$leaveName · ${_range(start, end)} · ${_days(days)} · $stepLabel';
}

class PendingOtChain with ChainStep {
  const PendingOtChain({required this.id, required this.employeeName, this.date, required this.hours, this.reason, required this.level, this.levelLabel, required this.roleType, required this.status, this.holdReason});

  final String id, employeeName;
  final DateTime? date;
  final num hours;
  final String? reason;
  @override
  final int level;
  @override
  final String? levelLabel, holdReason;
  @override
  final String roleType, status;

  static PendingOtChain? fromJson(dynamic j) {
    if (j is! Map || _t(j['overtime_request_id']).isEmpty) return null;
    return PendingOtChain(
      id: _t(j['overtime_request_id']),
      employeeName: _name(j),
      date: _day(j['request_date']),
      hours: toNum(j['total_hours']),
      reason: _orNull(j['reason']),
      level: _int(j['approval_level']),
      levelLabel: _orNull(j['level_label']),
      roleType: _t(j['role_type']),
      status: _t(j['status']),
      holdReason: _orNull(j['hold_reason']),
    );
  }

  String get line => '${date == null ? '' : '${dMMM(date!)} · '}${jsNumberString(hours)} h · $stepLabel';
}

class PendingOvertime {
  const PendingOvertime({required this.id, required this.employeeName, this.date, required this.hours, this.reason});

  final String id, employeeName;
  final DateTime? date;
  final num hours;
  final String? reason;

  static PendingOvertime? fromJson(dynamic j) {
    if (j is! Map || _t(j['id']).isEmpty) return null;
    return PendingOvertime(id: _t(j['id']), employeeName: _name(j), date: _day(j['request_date']), hours: toNum(j['total_hours']), reason: _orNull(j['reason']));
  }

  String get line => '${date == null ? '' : '${dMMM(date!)} · '}${jsNumberString(hours)} h';
}

class PendingApprovals {
  const PendingApprovals({
    this.leaves = const [],
    this.expenses = const [],
    this.exits = const [],
    this.leaveChain = const [],
    this.otChain = const [],
    this.overtime = const [],
    this.regularizations = const [],
  });

  final List<PendingLeave> leaves;
  final List<PendingExpense> expenses;
  final List<PendingExit> exits;
  final List<PendingLeaveChain> leaveChain;
  final List<PendingOtChain> otChain;
  final List<PendingOvertime> overtime;
  final List<RegularizationAsk> regularizations;

  factory PendingApprovals.fromJson(Map<String, dynamic> j) => PendingApprovals(
        leaves: _list(j['leaves'], PendingLeave.fromJson),
        expenses: _list(j['expenses'], PendingExpense.fromJson),
        exits: _list(j['exits'], PendingExit.fromJson),
        leaveChain: _list(j['leave_chain'], PendingLeaveChain.fromJson),
        otChain: _list(j['ot_chain'], PendingOtChain.fromJson),
        overtime: _list(j['overtime'], PendingOvertime.fromJson),
        regularizations: regularizationAsks(j['regularizations']),
      );

  bool get isEmpty =>
      leaves.isEmpty && expenses.isEmpty && exits.isEmpty && leaveChain.isEmpty && otChain.isEmpty && overtime.isEmpty && regularizations.isEmpty;
}

String managerLeavePath(String id) => '/api/employees/leave-requests/$id';
String leaveChainPath(String id) => '/api/employees/manager/leave-approvals/$id';
String otChainPath(String id) => '/api/employees/manager/ot-approvals/$id';
String overtimePath(String id) => '/api/employees/overtime-requests/$id';
String managerExitPath(String id) => '/api/employees/manager/exit-approvals/$id';

Map<String, dynamic> leaveDecisionBody({required bool approve, String? reason}) => {
      'action': approve ? 'approve' : 'reject',
      if (!approve && _orNull(reason) != null) 'rejection_reason': reason!.trim(),
    };

Map<String, dynamic> overtimeDecisionBody({required bool approve, String? reason}) => leaveDecisionBody(approve: approve, reason: reason);

/// `approve`, `hold` (with a reason) or `grant_exception` on a chain step.
Map<String, dynamic> chainBody(String action, {String? holdReason}) => {
      'action': action,
      if (action == 'hold' && _orNull(holdReason) != null) 'hold_reason': holdReason!.trim(),
    };

// ---------------------------------------------------------------------------------------------
// Recruitment
// ---------------------------------------------------------------------------------------------

const recruitJobsPath = '/api/hr/recruitment/jobs';
const recruitCandidatesPath = '/api/hr/recruitment/candidates';
const recruitPendingOffersPath = '/api/hr/recruitment/offer-approvals/pending';

String recruitJobPath(String id) => '$recruitJobsPath/$id';
String recruitCandidatePath(String id) => '$recruitCandidatesPath/$id';
String recruitInterviewsPath(String candidateId) => '$recruitCandidatesPath/$candidateId/interviews';
String recruitInterviewPath(String candidateId, String interviewId) => '${recruitInterviewsPath(candidateId)}/$interviewId';
String recruitOfferPath(String candidateId) => '$recruitCandidatesPath/$candidateId/offer';
String recruitOfferPdfPath(String candidateId) => '${recruitOfferPath(candidateId)}/pdf';
String recruitConvertPath(String candidateId) => '$recruitCandidatesPath/$candidateId/convert';

class RecruitJob {
  const RecruitJob({required this.id, required this.title, this.department, this.description, required this.status, this.candidateCount = 0});

  final String id, title, status;
  final String? department, description;
  final int candidateCount;

  static RecruitJob? fromJson(dynamic j) {
    if (j is! Map || _t(j['id']).isEmpty) return null;
    return RecruitJob(
      id: _t(j['id']),
      title: _orNull(j['title']) ?? 'Job',
      department: _orNull(j['department']),
      description: _orNull(j['description']),
      status: _orNull(j['status']) ?? 'open',
      candidateCount: _int(j['candidate_count']),
    );
  }
}

List<RecruitJob> recruitJobs(dynamic list) => _list(list, RecruitJob.fromJson);

class RecruitCandidate {
  const RecruitCandidate({required this.id, required this.fullName, required this.email, this.phone, required this.status, this.jobTitle, this.source, this.notes, this.employeeId});

  final String id, fullName, email, status;
  final String? phone, jobTitle, source, notes, employeeId;

  static RecruitCandidate? fromJson(dynamic j) {
    if (j is! Map || _t(j['id']).isEmpty) return null;
    return RecruitCandidate(
      id: _t(j['id']),
      fullName: _orNull(j['full_name']) ?? 'Candidate',
      email: _t(j['email']),
      phone: _orNull(j['phone']),
      status: _orNull(j['status']) ?? 'applied',
      jobTitle: _orNull(j['job_title']),
      source: _orNull(j['source']),
      notes: _orNull(j['notes']),
      employeeId: _orNull(j['employee_id']),
    );
  }
}

List<RecruitCandidate> recruitCandidates(dynamic list) => _list(list, RecruitCandidate.fromJson);

class RecruitStage {
  const RecruitStage({required this.id, required this.name});

  final String id, name;

  static RecruitStage? fromJson(dynamic j) {
    if (j is! Map || _t(j['id']).isEmpty) return null;
    return RecruitStage(id: _t(j['id']), name: _orNull(j['stage_name']) ?? 'Round');
  }
}

List<RecruitStage> recruitStages(dynamic list) => _list(list, RecruitStage.fromJson);

class RecruitInterview {
  const RecruitInterview({required this.id, required this.stageName, required this.status, this.scheduledAt, this.interviewer});

  final String id, stageName, status;
  final DateTime? scheduledAt;
  final String? interviewer;

  static RecruitInterview? fromJson(dynamic j) {
    if (j is! Map || _t(j['id']).isEmpty) return null;
    return RecruitInterview(
      id: _t(j['id']),
      stageName: _orNull(j['stage_name']) ?? 'Round',
      status: _orNull(j['status']) ?? 'scheduled',
      scheduledAt: DateTime.tryParse(_t(j['scheduled_at']))?.toLocal(),
      interviewer: _orNull(j['interviewer_name']),
    );
  }
}

List<RecruitInterview> recruitInterviews(dynamic list) => _list(list, RecruitInterview.fromJson);

class PendingOffer {
  const PendingOffer({required this.offerId, required this.candidateId, required this.candidateName, required this.designation, this.levelLabel, required this.level});

  final String offerId, candidateId, candidateName, designation;
  final String? levelLabel;
  final int level;

  static PendingOffer? fromJson(dynamic j) {
    if (j is! Map || _t(j['candidate_id']).isEmpty) return null;
    return PendingOffer(
      offerId: _t(j['offer_id']),
      candidateId: _t(j['candidate_id']),
      candidateName: _orNull(j['candidate_name']) ?? 'Candidate',
      designation: _t(j['designation']),
      levelLabel: _orNull(j['level_label']),
      level: _int(j['approval_level']),
    );
  }
}

List<PendingOffer> pendingOffers(dynamic list) => _list(list, PendingOffer.fromJson);

Map<String, dynamic> jobBody({required String title, required String department, required String description}) =>
    {'title': title.trim(), 'department': department.trim(), 'description': description.trim()};

Map<String, dynamic> candidateBody({required String jobId, required String fullName, required String email, required String phone, required String source}) => {
      'job_id': jobId,
      'full_name': fullName.trim(),
      'email': email.trim(),
      'phone': phone.trim(),
      'source': source.trim(),
    };

Map<String, dynamic> interviewBody({required String stageId, DateTime? scheduledAt}) => {
      'stage_id': stageId,
      if (scheduledAt != null) 'scheduled_at': scheduledAt.toUtc().toIso8601String(),
    };

/// Passed moves the candidate to "selected", failed to "rejected" (the server does it, as for the website).
Map<String, dynamic> interviewResultBody({required bool passed}) => {'status': passed ? 'passed' : 'failed'};

num _num(String v, num fallback) {
  final t = v.trim();
  if (t.isEmpty) return fallback;
  final n = num.tryParse(t);
  return n == null ? fallback : (n == n.truncate() ? n.truncate() : n);
}

/// The offer form of the candidate page, with the same fallbacks (bonus 0, notice 30 days, probation 0).
Map<String, dynamic> offerBody({
  required String designation,
  required String department,
  required DateTime joiningDate,
  required String basicSalary,
  required String workLocation,
  required String annualBonus,
  required String noticePeriodDays,
  required String probationMonths,
  required String signatoryName,
  required String signatoryTitle,
  required String terms,
}) =>
    {
      'designation': designation.trim(),
      'department': department.trim(),
      'joining_date': ymd(joiningDate),
      'basic_salary': _num(basicSalary, 0),
      'work_location': workLocation.trim(),
      'annual_bonus': _num(annualBonus, 0),
      'notice_period_days': _num(noticePeriodDays, 30),
      'probation_months': _num(probationMonths, 0),
      'signatory_name': signatoryName.trim(),
      'signatory_title': signatoryTitle.trim(),
      'terms_text': terms.trim(),
    };

/// `send`, `reset_to_draft`, `approve` or `reject` (the last two with an optional comment).
Map<String, dynamic> offerActionBody(String action, {String? comments}) => {
      'action': action,
      if (_orNull(comments) != null) 'comments': comments!.trim(),
    };

/// The website sends only this; the reporting manager is not asked for on the website either.
Map<String, dynamic> convertBody() => {'physical_documents_verified': true};

bool canEditOffer(String? status) => status == null || status == 'draft' || status == 'approval_rejected';

bool offerPdfReady(String? status) => const ['pending_approval', 'approved', 'sent', 'viewed', 'accepted'].contains(status);

/// The website's rule for showing the convert button.
bool canConvert(String status, {required String? employeeId}) =>
    employeeId == null && const ['offer_accepted', 'docs_verified', 'docs_submitted', 'ready_to_join'].contains(status);

/// It is my turn when the offer awaits approval and the lowest pending level is mine.
bool isMyOfferTurn(String? offerStatus, List<dynamic> approvals, String? userId) {
  if (offerStatus != 'pending_approval' || userId == null || userId.isEmpty) return false;
  final pending = approvals.whereType<Map>().where((a) => a['status'] == 'pending').toList()
    ..sort((a, b) => _int(a['approval_level']).compareTo(_int(b['approval_level'])));
  return pending.isNotEmpty && _t(pending.first['approver_user_id']) == userId;
}

// ---------------------------------------------------------------------------------------------
// Exits
// ---------------------------------------------------------------------------------------------

const exitsPath = '/api/hr/exits';
const exitReasonsPath = '/api/settings/hr-exit';

String exitPath(String id) => '$exitsPath/$id';

class ExitRow {
  const ExitRow({required this.id, required this.employeeName, required this.employeeCode, required this.exitType, required this.status, required this.fnfStatus});

  final String id, employeeName, employeeCode, exitType, status, fnfStatus;

  String get statusWords => statusWordsOf(status);

  static ExitRow? fromJson(dynamic j) {
    if (j is! Map || _t(j['id']).isEmpty) return null;
    return ExitRow(
      id: _t(j['id']),
      employeeName: _orNull(j['employee_name']) ?? 'Employee',
      employeeCode: _t(j['employee_code']),
      exitType: _t(j['exit_type']),
      status: _t(j['status']),
      fnfStatus: _t(j['fnf_status']),
    );
  }
}

String statusWordsOf(String s) => statusWords(s);

List<ExitRow> exitRows(dynamic list) => _list(list, ExitRow.fromJson);

class ExitTask {
  const ExitTask({required this.id, required this.title, required this.category, required this.status});

  final String id, title, category, status;

  bool get done => status == 'completed';

  static ExitTask? fromJson(dynamic j) {
    if (j is! Map || _t(j['id']).isEmpty) return null;
    return ExitTask(id: _t(j['id']), title: _t(j['title']), category: _t(j['category']), status: _t(j['status']));
  }
}

class ExitApproval with ChainStep {
  const ExitApproval({required this.id, required this.level, this.levelLabel, required this.roleType, this.approverName, required this.status, this.holdReason});

  final String id;
  @override
  final int level;
  @override
  final String? levelLabel, holdReason;
  @override
  final String roleType, status;
  final String? approverName;

  bool get isActive => status == 'awaiting' || status == 'on_hold';

  static ExitApproval? fromJson(dynamic j) {
    if (j is! Map) return null;
    return ExitApproval(
      id: _t(j['id']),
      level: _int(j['approval_level']),
      levelLabel: _orNull(j['level_label']),
      roleType: _t(j['role_type']),
      approverName: _orNull(j['approver_name']),
      status: _t(j['status']),
      holdReason: _orNull(j['hold_reason']),
    );
  }
}

class ExitDetail {
  const ExitDetail({
    required this.id,
    required this.employeeName,
    required this.exitType,
    required this.status,
    this.noticeDays,
    required this.fnfStatus,
    required this.tasks,
    required this.approvals,
    required this.canActOnStep,
    required this.canHrReject,
  });

  final String id, employeeName, exitType, status, fnfStatus;
  final int? noticeDays;
  final List<ExitTask> tasks;
  final List<ExitApproval> approvals;
  final bool canActOnStep, canHrReject;

  factory ExitDetail.fromJson(Map<String, dynamic> j) {
    final e = j['exit'] is Map ? j['exit'] as Map : const {};
    final p = j['permissions'] is Map ? j['permissions'] as Map : const {};
    return ExitDetail(
      id: _t(e['id']),
      employeeName: _orNull(e['employee_name']) ?? 'Employee',
      exitType: _t(e['exit_type']),
      status: _t(e['status']),
      noticeDays: e['notice_period_days'] == null ? null : _int(e['notice_period_days']),
      fnfStatus: _t(e['fnf_status']),
      tasks: _list(j['tasks'], ExitTask.fromJson),
      approvals: _list(j['approvals'], ExitApproval.fromJson),
      canActOnStep: p['can_act_on_step'] == true,
      canHrReject: p['can_hr_reject'] == true,
    );
  }

  bool get isResignation => exitType == 'resignation';
  bool get awaitingApproval => status == 'pending_approval' || status == 'approval_on_hold';
  ExitApproval? get activeStep {
    for (final a in approvals) {
      if (a.isActive) return a;
    }
    return null;
  }

  bool get showException => status == 'approval_on_hold' && approvals.any((a) => a.status == 'on_hold');

  String get noticeLine => 'Notice: ${noticeDays ?? '—'} days · F&F: $fnfStatus';
}

Map<String, dynamic> startExitBody({required String employeeId, required bool terminate, required String reason}) => {
      'employee_id': employeeId,
      'exit_type': terminate ? 'termination' : 'resignation',
      if (_orNull(reason) != null) 'reason': reason.trim(),
    };

Map<String, dynamic> exitTaskDoneBody(String taskId) => {'action': 'update_task', 'task_id': taskId, 'status': 'completed'};

/// `approve`, `hold` (with a reason), `reject` (HR) or `grant_exception` (department head).
Map<String, dynamic> exitDecisionBody(String action, {String? holdReason}) => {
      'action': action,
      if (action == 'hold' && _orNull(holdReason) != null) 'hold_reason': holdReason!.trim(),
    };

// ---------------------------------------------------------------------------------------------
// Submit an offer for approval (the website's "Submit offer for approval" dialog)
// ---------------------------------------------------------------------------------------------

const hrApprovalSettingsPath = '/api/settings/hr-approval';
const todosUsersPath = '/api/todos/users';

/// `settings.offer_min_levels` / `offer_max_levels` of `GET /api/settings/hr-approval`.
class OfferApprovalRules {
  const OfferApprovalRules({this.minLevels = 1, this.maxLevels});

  final int minLevels;
  final int? maxLevels;

  factory OfferApprovalRules.fromJson(Map<String, dynamic> j) {
    final s = j['settings'] is Map ? j['settings'] as Map : const {};
    return OfferApprovalRules(
      minLevels: s['offer_min_levels'] == null ? 1 : _int(s['offer_min_levels']),
      maxLevels: s['offer_max_levels'] == null ? null : _int(s['offer_max_levels']),
    );
  }

  bool canAdd(int rows) => maxLevels == null || rows < maxLevels!;
  bool canRemove(int rows) => rows > minLevels;
}

class ApproverOption {
  const ApproverOption(this.id, this.label);

  final String id, label;
}

List<ApproverOption> approverOptions(dynamic list) => _list(list, (j) {
      if (j is! Map || _t(j['id']).isEmpty) return null;
      return ApproverOption(_t(j['id']), _orNull(j['display_name']) ?? _orNull(j['name']) ?? 'User');
    });

/// Levels count from 1 in the order given; the chosen users are data the server checks, not the actor.
Map<String, dynamic> submitOfferBody(List<(String label, String userId)> approvers) => {
      'action': 'submit_for_approval',
      'approvers': [
        for (var i = 0; i < approvers.length; i++)
          {
            'level': i + 1,
            if (_orNull(approvers[i].$1) != null) 'label': approvers[i].$1.trim(),
            'user_id': approvers[i].$2,
          },
      ],
    };

bool canSubmitOffer(String? status) => status == 'draft';
