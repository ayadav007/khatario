/// Pure helpers for the employee form and the org chart.
///
/// The bodies follow `app/(app)/employees/new/page.tsx` (create) and
/// `app/(app)/employees/[id]/edit/page.tsx` (edit), minus `business_id`, `created_by_user_id` and
/// `updated_by_user_id`: the session names the business and the user. Pay figures are sent as typed.
library;

import 'employee_logic.dart';

String _t(dynamic v) => v?.toString().trim() ?? '';

String? _orNull(String v) {
  final t = v.trim();
  return t.isEmpty ? null : t;
}

num? _number(String v) => num.tryParse(v.trim());

String _digits(String v) => v.replaceAll(RegExp(r'\D'), '');

/// The HR plan switches the website reads with `hrPlanFlags` (`lib/subscription/hr-lite.ts`):
/// the reporting manager needs `hr_leaves`; PAN, Aadhaar and the statutory numbers need `hr_payroll_setup`.
/// A field the plan lacks is hidden and left out of the body, as on the website.
class HrPlan {
  const HrPlan({required this.leaves, required this.payrollSetup});

  final bool leaves;
  final bool payrollSetup;

  static const full = HrPlan(leaves: true, payrollSetup: true);
  static const lite = HrPlan(leaves: false, payrollSetup: false);
}

/// Everything the employee form can hold, as the user typed it.
class EmployeeForm {
  EmployeeForm({
    this.name = '',
    this.phone = '',
    this.email = '',
    this.employeeCode = '',
    this.roleId = '',
    this.password = '',
    this.designation = '',
    this.department = '',
    this.branchId = '',
    this.joiningDate = '',
    this.reportingManagerId = '',
    this.employmentType = 'full_time',
    this.payBasis = 'monthly',
    this.salary = '',
    this.emergencyName = '',
    this.emergencyPhone = '',
    this.bankAccount = '',
    this.bankIfsc = '',
    this.bankName = '',
    this.pan = '',
    this.aadhaar = '',
    this.uan = '',
    this.esiIp = '',
    this.pfAccount = '',
    this.pfApplicable = true,
    this.esiApplicable = true,
    this.weeklyOff = false,
    List<int>? weeklyOffDays,
    this.nthRules = const [],
  }) : weeklyOffDays = weeklyOffDays ?? [0];

  String name, phone, email, employeeCode, roleId, password;
  String designation, department, branchId, joiningDate, reportingManagerId;
  String employmentType, payBasis, salary;
  String emergencyName, emergencyPhone, bankAccount, bankIfsc, bankName;
  String pan, aadhaar, uan, esiIp, pfAccount;
  bool pfApplicable, esiApplicable, weeklyOff;
  List<int> weeklyOffDays;

  /// The saved `nth_rules` of the weekly-off override; kept when only the days change.
  List<dynamic> nthRules;

  /// The form as `GET /api/employees/[id]` fills it on the website's edit page.
  factory EmployeeForm.fromEmployee(Map<String, dynamic> e) {
    final override = e['weekly_off_override'];
    final fixed = override is Map && override['fixed_days'] is List
        ? [for (final d in override['fixed_days'] as List) if (d is num) d.toInt()]
        : <int>[];
    final joined = _t(e['joining_date']);
    final nth = override is Map && override['nth_rules'] is List ? List<dynamic>.from(override['nth_rules'] as List) : <dynamic>[];
    return EmployeeForm(
      name: _t(e['user_name'] ?? e['name']),
      phone: _t(e['user_phone'] ?? e['phone']),
      email: _t(e['user_email'] ?? e['email']),
      employeeCode: _t(e['employee_code']),
      roleId: _t(e['role_id']),
      designation: _t(e['designation']),
      department: _t(e['department']),
      branchId: _t(e['branch_id']),
      joiningDate: joined.length >= 10 ? joined.substring(0, 10) : joined,
      reportingManagerId: _t(e['reporting_manager_id']),
      employmentType: _t(e['employment_type']).isEmpty ? 'full_time' : _t(e['employment_type']),
      payBasis: e['pay_basis'] == 'daily' ? 'daily' : 'monthly',
      salary: _t(e['salary']),
      emergencyName: _t(e['emergency_contact_name']),
      emergencyPhone: _t(e['emergency_contact_phone']),
      bankAccount: _t(e['bank_account_number']),
      bankIfsc: _t(e['bank_ifsc']),
      bankName: _t(e['bank_name']),
      pan: _t(e['pan_number']),
      aadhaar: _t(e['aadhaar_number']),
      uan: _t(e['uan']),
      esiIp: _t(e['esi_ip_number']),
      pfAccount: _t(e['pf_account_no']),
      pfApplicable: e['pf_applicable'] != false,
      esiApplicable: e['esi_applicable'] != false,
      weeklyOff: fixed.isNotEmpty || nth.isNotEmpty,
      // No Sunday is added to an override that only holds nth-week rules.
      weeklyOffDays: fixed.isNotEmpty || nth.isNotEmpty ? fixed : [0],
      nthRules: nth,
    );
  }

  EmployeeForm copy() => EmployeeForm(
        name: name, phone: phone, email: email, employeeCode: employeeCode, roleId: roleId, password: password,
        designation: designation, department: department, branchId: branchId, joiningDate: joiningDate,
        reportingManagerId: reportingManagerId, employmentType: employmentType, payBasis: payBasis, salary: salary,
        emergencyName: emergencyName, emergencyPhone: emergencyPhone, bankAccount: bankAccount, bankIfsc: bankIfsc,
        bankName: bankName, pan: pan, aadhaar: aadhaar, uan: uan, esiIp: esiIp, pfAccount: pfAccount,
        pfApplicable: pfApplicable, esiApplicable: esiApplicable, weeklyOff: weeklyOff,
        weeklyOffDays: List<int>.from(weeklyOffDays), nthRules: nthRules,
      );
}

const _passwordRule = 'A sign-in role needs a password of at least 8 characters, with a letter and a number';

/// Field errors by key (`name`, `phone`, `employeeCode`, `password`); empty means the form can be sent.
Map<String, String> employeeErrors(EmployeeForm f, {required bool editing}) {
  final errors = <String, String>{};
  if (f.name.trim().isEmpty) errors['name'] = 'Name is required';
  if (f.phone.trim().isEmpty) errors['phone'] = 'Phone is required';
  if (editing && f.employeeCode.trim().isEmpty) errors['employeeCode'] = 'Employee code is required';
  if (editing && f.weeklyOff && f.weeklyOffDays.isEmpty && f.nthRules.isEmpty) errors['weeklyOff'] = 'Pick at least one day off';
  if (!editing && f.roleId.isNotEmpty && f.password.trim().length < 8) errors['password'] = _passwordRule;
  if (editing && f.password.isNotEmpty && f.password.trim().length < 8) errors['password'] = 'A password needs at least 8 characters, with a letter and a number';
  return errors;
}

/// `POST /api/employees`, the website's "Create employee" body (no ids, no portal invite).
Map<String, dynamic> employeeCreateBody(EmployeeForm f, {required HrPlan plan}) {
  final login = f.roleId.isNotEmpty;
  return {
    'name': f.name.trim(),
    'email': _orNull(f.email),
    'phone': f.phone.trim(),
    'password': login ? f.password : null,
    'role_id': login ? f.roleId : null,
    'employee_code': _orNull(f.employeeCode),
    'designation': _orNull(f.designation),
    'department': _orNull(f.department),
    'joining_date': _orNull(f.joiningDate),
    if (plan.leaves) 'reporting_manager_id': _orNull(f.reportingManagerId),
    'employment_type': f.employmentType,
    'salary': _number(f.salary),
    'pay_basis': f.payBasis,
    'emergency_contact_name': _orNull(f.emergencyName),
    'emergency_contact_phone': _orNull(_digits(f.emergencyPhone)),
    'bank_account_number': _orNull(f.bankAccount),
    'bank_ifsc': _orNull(f.bankIfsc),
    'bank_name': _orNull(f.bankName),
    if (plan.payrollSetup) ...{
      'pan_number': _orNull(f.pan),
      'aadhaar_number': _orNull(f.aadhaar),
    },
  };
}

/// `PATCH /api/employees/[id]` is partial, so only what changed is sent and a field the form never
/// loaded can never be wiped. Values follow the website's edit body (empty text is `null`).
Map<String, dynamic> employeeEditBody(EmployeeForm initial, EmployeeForm now, {required HrPlan plan}) {
  final body = <String, dynamic>{};
  void text(String key, String a, String b, {bool nullable = true}) {
    if (a.trim() == b.trim()) return;
    final v = b.trim();
    if (v.isEmpty && !nullable) return;
    body[key] = v.isEmpty ? null : v;
  }

  text('name', initial.name, now.name, nullable: false);
  text('phone', initial.phone, now.phone, nullable: false);
  text('email', initial.email, now.email);
  text('employee_code', initial.employeeCode, now.employeeCode, nullable: false);
  text('designation', initial.designation, now.designation);
  text('department', initial.department, now.department);
  text('branch_id', initial.branchId, now.branchId);
  text('joining_date', initial.joiningDate, now.joiningDate);
  if (plan.leaves) text('reporting_manager_id', initial.reportingManagerId, now.reportingManagerId);
  if (initial.employmentType != now.employmentType) body['employment_type'] = now.employmentType;
  if (initial.payBasis != now.payBasis) body['pay_basis'] = now.payBasis;
  if (_number(initial.salary) != _number(now.salary) || (initial.salary.trim().isEmpty != now.salary.trim().isEmpty)) {
    body['salary'] = _number(now.salary);
  }
  text('emergency_contact_name', initial.emergencyName, now.emergencyName);
  if (_digits(initial.emergencyPhone) != _digits(now.emergencyPhone)) {
    body['emergency_contact_phone'] = _orNull(_digits(now.emergencyPhone));
  }
  text('bank_account_number', initial.bankAccount, now.bankAccount);
  text('bank_ifsc', initial.bankIfsc, now.bankIfsc);
  text('bank_name', initial.bankName, now.bankName);
  if (plan.payrollSetup) {
    text('pan_number', initial.pan, now.pan);
    text('aadhaar_number', initial.aadhaar, now.aadhaar);
    text('uan', initial.uan, now.uan);
    text('esi_ip_number', initial.esiIp, now.esiIp);
    text('pf_account_no', initial.pfAccount, now.pfAccount);
    if (initial.pfApplicable != now.pfApplicable) body['pf_applicable'] = now.pfApplicable;
    if (initial.esiApplicable != now.esiApplicable) body['esi_applicable'] = now.esiApplicable;
  }

  final dayList = [...now.weeklyOffDays]..sort();
  final initialDays = [...initial.weeklyOffDays]..sort();
  final weeklyChanged = initial.weeklyOff != now.weeklyOff || (now.weeklyOff && dayList.join(',') != initialDays.join(','));
  if (weeklyChanged) {
    body['weekly_off_override'] = now.weeklyOff ? {'fixed_days': now.weeklyOffDays, 'nth_rules': now.nthRules} : null;
  }

  if (initial.roleId != now.roleId) body['role_id'] = _orNull(now.roleId);
  if (now.roleId.isNotEmpty && now.password.isNotEmpty) body['password'] = now.password;
  return body;
}

/// The names under `catalog.departments` / `catalog.designations` of `GET /api/settings/hr-org-catalog`.
List<String> catalogList(dynamic body, String kind) {
  final catalog = body is Map ? body['catalog'] : null;
  final list = catalog is Map ? catalog[kind] : null;
  if (list is! List) return const [];
  return [for (final v in list) if (_t(v).isNotEmpty) _t(v)];
}

/// `GET /api/employees/login-options`: the roles that can be given and whether a login seat is free.
class LoginOptions {
  const LoginOptions({required this.canAssign, required this.seatsCurrent, required this.seatsLimit, required this.roles});

  final bool canAssign;
  final num seatsCurrent;
  final num seatsLimit;
  final List<(String id, String name)> roles;

  factory LoginOptions.fromJson(Map<String, dynamic> json) {
    final seats = json['seats'];
    return LoginOptions(
      canAssign: json['canAssignLogin'] == true,
      seatsCurrent: seats is Map && seats['current'] is num ? seats['current'] as num : 0,
      seatsLimit: seats is Map && seats['limit'] is num ? seats['limit'] as num : -1,
      roles: [
        for (final r in jsonRows(json['roles']))
          if (_t(r['id']).isNotEmpty) (_t(r['id']), _t(r['role_name']).isEmpty ? _t(r['role_key']) : _t(r['role_name'])),
      ],
    );
  }

  /// The website's line when no seat is free.
  String get seatNote {
    final limit = seatsLimit == -1 ? '' : ' (${seatsCurrent.toInt()}/${seatsLimit.toInt()} logins in use)';
    return 'This person is saved for attendance and salary only. A sign-in role needs a free user seat$limit.';
  }
}

/// One person in the org chart.
class OrgNode {
  OrgNode({required this.id, required this.name, required this.code, this.designation = '', this.department = '', this.children = const []});

  final String id, name, code, designation, department;
  final List<OrgNode> children;

  factory OrgNode.fromJson(Map<String, dynamic> j) => OrgNode(
        id: _t(j['id']),
        name: _t(j['name']).isEmpty ? 'Employee' : _t(j['name']),
        code: _t(j['employee_code']),
        designation: _t(j['designation']),
        department: _t(j['department']),
        children: [for (final c in jsonRows(j['children'])) OrgNode.fromJson(c)],
      );

  /// Designation and department, as the website shows them beside the name.
  String get subtitle => [designation, department].where((s) => s.isNotEmpty).join(' · ');
}

/// `GET /api/employees/org-chart`: `{roots, orphans, cycleIds, departments}`.
class OrgChart {
  OrgChart({required this.roots, required this.orphans, required this.excluded, required this.departments});

  final List<OrgNode> roots, orphans;

  /// People left out because their reporting managers form a loop.
  final int excluded;
  final List<String> departments;

  factory OrgChart.fromJson(Map<String, dynamic> j) => OrgChart(
        roots: [for (final r in jsonRows(j['roots'])) OrgNode.fromJson(r)],
        orphans: [for (final r in jsonRows(j['orphans'])) OrgNode.fromJson(r)],
        excluded: j['cycleIds'] is List ? (j['cycleIds'] as List).length : 0,
        departments: [for (final d in (j['departments'] is List ? j['departments'] as List : const [])) if (_t(d).isNotEmpty) _t(d)],
      );

  bool get isEmpty => roots.isEmpty && orphans.isEmpty;
}
