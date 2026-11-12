import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/hr/attendance_screen.dart';
import 'package:khatario_phone/screens/hr/employee_form_screen.dart';
import 'package:khatario_phone/screens/hr/employees_screen.dart';
import 'package:khatario_phone/screens/hr/hr_logic.dart';
import 'package:khatario_phone/screens/hr/org_chart_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/session.dart';

import 'support/finders.dart';

/// A fake server that records every request. [employee] answers `GET /api/employees/e1`.
class _Api extends KhatarioApi {
  _Api({Map<String, dynamic>? employee}) : employee = employee ?? _asha(), super(Dio());

  Map<String, dynamic> employee;
  Object? orgChart = {'roots': [], 'orphans': [], 'cycleIds': [], 'departments': []};
  ApiException? failEmployee, failPatch, failPost, failDelete, failOrg;
  List<String> features = const ['hr_leaves', 'hr_payroll_setup'];
  final gets = <String>[];
  final posts = <String, Map<String, dynamic>>{};
  final patches = <String, Map<String, dynamic>>{};
  final deletes = <String>[];
  int postCount = 0;

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    gets.add(path);
    if (path == '/api/employees/login-options') {
      return {'canAssignLogin': true, 'seats': {'current': 1, 'limit': 5}, 'roles': [{'id': 'r1', 'role_name': 'Cashier'}]};
    }
    if (path == '/api/settings/hr-org-catalog') return {'catalog': {'departments': ['Sales'], 'designations': ['Manager']}};
    if (path == '/api/features/enabled') return {'enabledIds': features};
    if (path == '/api/settings/permissions') return {'permissions': <String, dynamic>{}, 'isPrimaryAdmin': true};
    if (path == '/api/branches') return {'branches': [{'id': 'br1', 'name': 'Main'}]};
    if (path.startsWith('/api/employees/org-chart')) {
      if (failOrg != null) throw failOrg!;
      return Map<String, dynamic>.from(orgChart! as Map);
    }
    if (path.startsWith('/api/employees/e1')) {
      if (failEmployee != null) throw failEmployee!;
      return {'employee': employee, 'documents': []};
    }
    if (path.startsWith('/api/employees/')) return {'employee': {'id': path.split('/').last, 'user_name': 'Someone'}, 'documents': []};
    return {};
  }

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    postCount++;
    if (failPost != null) throw failPost!;
    posts[path] = body;
    return {'employee': {'id': 'e1', 'user_name': body['name']}, 'portal_invite': null};
  }

  @override
  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async {
    if (failPatch != null) throw failPatch!;
    patches[path] = body;
    return {'employee': employee};
  }

  @override
  Future<Map<String, dynamic>> deleteJson(String path, {Map<String, dynamic>? body}) async {
    if (failDelete != null) throw failDelete!;
    deletes.add(path);
    employee = {...employee, 'is_active': false, 'user_is_active': false};
    return {'message': 'Employee deactivated successfully'};
  }
}

Map<String, dynamic> _asha() => {
      'id': 'e1',
      'user_name': 'Asha Rao',
      'user_phone': '9876543210',
      'employee_code': 'EMP001',
      'designation': 'Sales',
      'is_active': true,
      'user_is_active': true,
      'salary': '25000.00',
      'pan_number': 'ABCDE1234F',
    };

AppSession _session(_Api api) => AppSession(api, {'user': {'id': 'u'}, 'business': {'id': 'b'}});

Future<void> _open(WidgetTester t, Widget screen) async {
  t.view.physicalSize = const Size(800, 3600);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  await t.pumpWidget(MaterialApp(
    home: Builder(
      builder: (c) => TextButton(
        onPressed: () => Navigator.of(c).push(MaterialPageRoute(builder: (_) => screen)),
        child: const Text('go'),
      ),
    ),
  ));
  await t.tap(find.text('go'));
  await t.pumpAndSettle();
}

String _text(WidgetTester t, String label) => t.widget<TextField>(textFieldLabelled(label)).controller!.text;

void main() {
  group('employee form logic', () {
    EmployeeForm base() => EmployeeForm(name: 'Asha Rao', phone: '9876543210');

    test('name and phone are required; a sign-in role needs a password of 8 or more', () {
      expect(employeeErrors(EmployeeForm(), editing: false).keys, containsAll(['name', 'phone']));
      expect(employeeErrors(base(), editing: false), isEmpty);
      final withRole = base()..roleId = 'r1';
      expect(employeeErrors(withRole, editing: false)['password'], isNotNull);
      withRole.password = 'abc12345';
      expect(employeeErrors(withRole, editing: false), isEmpty);
    });

    test('editing needs an employee code, and a typed password must be 8 or more', () {
      final f = base();
      expect(employeeErrors(f, editing: true)['employeeCode'], isNotNull);
      f.employeeCode = 'EMP001';
      expect(employeeErrors(f, editing: true), isEmpty);
      f.password = 'short';
      expect(employeeErrors(f, editing: true)['password'], isNotNull);
    });

    test('create body is the website body without business_id, user_id or created_by', () {
      final f = base()
        ..email = ' a@x.in '
        ..designation = 'Sales Executive'
        ..joiningDate = '2026-11-01'
        ..salary = '25000'
        ..payBasis = 'daily'
        ..emergencyPhone = '+91 98765-00000'
        ..pan = 'ABCDE1234F';
      final b = employeeCreateBody(f, plan: HrPlan.full);
      expect(b['name'], 'Asha Rao');
      expect(b['phone'], '9876543210');
      expect(b['email'], 'a@x.in');
      expect(b['designation'], 'Sales Executive');
      expect(b['department'], isNull);
      expect(b['joining_date'], '2026-11-01');
      expect(b['salary'], 25000);
      expect(b['pay_basis'], 'daily');
      expect(b['employment_type'], 'full_time');
      expect(b['employee_code'], isNull);
      expect(b['role_id'], isNull);
      expect(b['password'], isNull);
      expect(b['emergency_contact_phone'], '919876500000');
      expect(b['pan_number'], 'ABCDE1234F');
      for (final k in ['business_id', 'user_id', 'created_by', 'created_by_user_id']) {
        expect(b.containsKey(k), isFalse, reason: k);
      }
    });

    test('create body carries the password only with a sign-in role', () {
      final f = base()..password = 'abc12345';
      expect(employeeCreateBody(f, plan: HrPlan.full)['password'], isNull);
      f.roleId = 'r1';
      final b = employeeCreateBody(f, plan: HrPlan.full);
      expect(b['role_id'], 'r1');
      expect(b['password'], 'abc12345');
    });

    final loaded = {
      'user_name': 'Asha Rao',
      'user_phone': '9876543210',
      'user_email': 'a@x.in',
      'employee_code': 'EMP001',
      'designation': 'Sales',
      'joining_date': '2026-11-01T00:00:00.000Z',
      'salary': '25000.00',
      'pay_basis': 'monthly',
      'employment_type': 'part_time',
      'role_id': 'r1',
      'pan_number': 'ABCDE1234F',
      'pf_applicable': null,
      'weekly_off_override': {'fixed_days': [0, 6], 'nth_rules': [{'n': 2}]},
    };

    test('an untouched edit sends nothing', () {
      final a = EmployeeForm.fromEmployee(loaded);
      final b = EmployeeForm.fromEmployee(loaded);
      expect(a.joiningDate, '2026-11-01');
      expect(a.pfApplicable, isTrue);
      expect(employeeEditBody(a, b, plan: HrPlan.full), isEmpty);
    });

    test('an edit sends only the changed fields, empties as null', () {
      final a = EmployeeForm.fromEmployee(loaded);
      final b = EmployeeForm.fromEmployee(loaded)
        ..designation = 'Manager'
        ..email = ''
        ..salary = '26000'
        ..esiApplicable = false
        ..bankName = '  HDFC ';
      expect(employeeEditBody(a, b, plan: HrPlan.full), {
        'designation': 'Manager',
        'email': null,
        'salary': 26000,
        'esi_applicable': false,
        'bank_name': 'HDFC',
      });
    });

    test('salary 25000.00 loaded and left alone is not a change', () {
      final a = EmployeeForm.fromEmployee(loaded);
      final b = EmployeeForm.fromEmployee(loaded)..salary = '25000';
      expect(employeeEditBody(a, b, plan: HrPlan.full), isEmpty);
    });

    test('role and password: cleared role sends null and no password; new password only when typed', () {
      final a = EmployeeForm.fromEmployee(loaded);
      final cleared = EmployeeForm.fromEmployee(loaded)..roleId = '';
      expect(employeeEditBody(a, cleared, plan: HrPlan.full), {'role_id': null});
      final pw = EmployeeForm.fromEmployee(loaded)..password = 'newpass123';
      expect(employeeEditBody(a, pw, plan: HrPlan.full), {'password': 'newpass123'});
      final swap = EmployeeForm.fromEmployee(loaded)
        ..roleId = 'r2'
        ..password = 'newpass123';
      expect(employeeEditBody(a, swap, plan: HrPlan.full), {'role_id': 'r2', 'password': 'newpass123'});
    });

    test('Lite plan: no reporting manager without leaves, no PAN/Aadhaar/statutory without payroll setup', () {
      final f = base()
        ..reportingManagerId = 'm1'
        ..pan = 'ABCDE1234F'
        ..aadhaar = '123412341234';
      final lite = employeeCreateBody(f, plan: HrPlan.lite);
      for (final k in ['reporting_manager_id', 'pan_number', 'aadhaar_number']) {
        expect(lite.containsKey(k), isFalse, reason: k);
      }
      final leavesOnly = employeeCreateBody(f, plan: const HrPlan(leaves: true, payrollSetup: false));
      expect(leavesOnly['reporting_manager_id'], 'm1');
      expect(leavesOnly.containsKey('pan_number'), isFalse);
      final payrollOnly = employeeCreateBody(f, plan: const HrPlan(leaves: false, payrollSetup: true));
      expect(payrollOnly['pan_number'], 'ABCDE1234F');
      expect(payrollOnly.containsKey('reporting_manager_id'), isFalse);
      final full = employeeCreateBody(f, plan: HrPlan.full);
      expect(full['reporting_manager_id'], 'm1');
      expect(full['aadhaar_number'], '123412341234');
    });

    test('Lite plan edit: the gated fields are never sent even if changed; full HR sends them', () {
      final a = EmployeeForm.fromEmployee(loaded);
      final b = EmployeeForm.fromEmployee(loaded)
        ..designation = 'Lead'
        ..reportingManagerId = 'm2'
        ..pan = 'ZZZZZ9999Z'
        ..aadhaar = '1'
        ..uan = '10'
        ..esiIp = '11'
        ..pfAccount = '12'
        ..pfApplicable = false
        ..esiApplicable = false;
      expect(employeeEditBody(a, b, plan: HrPlan.lite), {'designation': 'Lead'});
      final leavesOnly = employeeEditBody(a, b, plan: const HrPlan(leaves: true, payrollSetup: false));
      expect(leavesOnly, {'designation': 'Lead', 'reporting_manager_id': 'm2'});
      final full = employeeEditBody(a, b, plan: HrPlan.full);
      expect(full.keys, containsAll(['reporting_manager_id', 'pan_number', 'aadhaar_number', 'uan', 'esi_ip_number', 'pf_account_no', 'pf_applicable', 'esi_applicable']));
    });

    test('custom weekly off with no day (and no saved rules) is an error; saved rules alone are fine', () {
      final f = EmployeeForm.fromEmployee(loaded)
        ..weeklyOffDays = []
        ..nthRules = [];
      expect(employeeErrors(f, editing: true)['weeklyOff'], 'Pick at least one day off');
      f.nthRules = [{'n': 2}];
      expect(employeeErrors(f, editing: true).containsKey('weeklyOff'), isFalse);
      f
        ..nthRules = []
        ..weeklyOff = false;
      expect(employeeErrors(f, editing: true).containsKey('weeklyOff'), isFalse);
    });

    test('an override with only nth rules loads with the toggle on and no default Sunday', () {
      final onlyNth = {
        ...loaded,
        'weekly_off_override': {'fixed_days': [], 'nth_rules': [{'n': 2}]},
      };
      final a = EmployeeForm.fromEmployee(onlyNth);
      expect(a.weeklyOff, isTrue);
      expect(a.weeklyOffDays, isEmpty);
      expect(employeeErrors(a, editing: true).containsKey('weeklyOff'), isFalse);
      expect(employeeEditBody(a, EmployeeForm.fromEmployee(onlyNth), plan: HrPlan.full), isEmpty);
    });

    test('weekly off: turning it off sends null; changing days keeps the saved nth rules', () {
      final a = EmployeeForm.fromEmployee(loaded);
      final off = EmployeeForm.fromEmployee(loaded)..weeklyOff = false;
      expect(employeeEditBody(a, off, plan: HrPlan.full), {'weekly_off_override': null});
      final days = EmployeeForm.fromEmployee(loaded)..weeklyOffDays = [0, 5];
      expect(employeeEditBody(a, days, plan: HrPlan.full), {
        'weekly_off_override': {'fixed_days': [0, 5], 'nth_rules': [{'n': 2}]},
      });
    });

    test('edit body never carries identity fields', () {
      final a = EmployeeForm.fromEmployee(loaded);
      final b = EmployeeForm.fromEmployee(loaded)..name = 'New Name';
      final body = employeeEditBody(a, b, plan: HrPlan.full);
      for (final k in ['business_id', 'user_id', 'updated_by_user_id', 'created_by']) {
        expect(body.containsKey(k), isFalse, reason: k);
      }
    });
  });

  group('catalog, login options and org chart parsing', () {
    test('catalog lists', () {
      final body = {'catalog': {'departments': ['Sales', ' ', 'Ops'], 'designations': ['Manager']}};
      expect(catalogList(body, 'departments'), ['Sales', 'Ops']);
      expect(catalogList(body, 'designations'), ['Manager']);
      expect(catalogList({}, 'departments'), isEmpty);
    });

    test('login options: roles, free seat and the full-seats note', () {
      final o = LoginOptions.fromJson({
        'canAssignLogin': false,
        'seats': {'current': 3, 'limit': 3},
        'roles': [{'id': 'r1', 'role_name': 'Cashier'}],
      });
      expect(o.canAssign, isFalse);
      expect(o.roles, [('r1', 'Cashier')]);
      expect(o.seatNote, contains('3/3'));
      expect(LoginOptions.fromJson({'canAssignLogin': true, 'seats': {'current': 1, 'limit': -1}, 'roles': []}).seatNote, isNot(contains('/')));
    });

    test('org chart tree, orphans and excluded count', () {
      final chart = OrgChart.fromJson({
        'roots': [
          {'id': 'a', 'name': 'Boss', 'employee_code': 'E1', 'designation': 'Owner', 'children': [
            {'id': 'b', 'name': 'Asha', 'employee_code': 'E2', 'department': 'Sales', 'children': []},
          ]},
        ],
        'orphans': [{'id': 'c', 'name': 'Lost', 'employee_code': 'E3', 'children': []}],
        'cycleIds': ['x', 'y'],
      });
      expect(chart.roots.single.children.single.name, 'Asha');
      expect(chart.roots.single.subtitle, 'Owner');
      expect(chart.roots.single.children.single.subtitle, 'Sales');
      expect(chart.orphans.single.id, 'c');
      expect(chart.excluded, 2);
      expect(chart.isEmpty, isFalse);
      expect(OrgChart.fromJson({}).isEmpty, isTrue);
    });
  });

  group('employee form screen', () {
    testWidgets('add: a double tap posts once, sends no ids, and opens the new employee', (t) async {
      final api = _Api();
      await _open(t, EmployeeFormScreen(session: _session(api)));
      await t.enterText(textFieldLabelled('Full name *'), 'Asha Rao');
      await t.enterText(textFieldLabelled('Phone number *'), '9876543210');
      await t.tap(find.text('Create employee'));
      await t.tap(find.text('Create employee'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(api.postCount, 1);
      final body = api.posts['/api/employees']!;
      expect(body['name'], 'Asha Rao');
      expect(body['phone'], '9876543210');
      for (final k in ['business_id', 'user_id', 'created_by', 'created_by_user_id']) {
        expect(body.containsKey(k), isFalse, reason: k);
      }
      expect(api.gets, contains('/api/employees/e1'));
      expect(find.byType(EmployeeDetailScreen), findsOneWidget);
      expect(find.byType(EmployeeFormScreen), findsNothing);
    });

    testWidgets('add: a missing name stops the save before any request', (t) async {
      final api = _Api();
      await _open(t, EmployeeFormScreen(session: _session(api)));
      await t.enterText(textFieldLabelled('Phone number *'), '9876543210');
      await t.tap(find.text('Create employee'));
      await t.pumpAndSettle();
      expect(api.postCount, 0);
      expect(find.text('Name is required'), findsOneWidget);
    });

    testWidgets('add: a refused save shows the server message and keeps the form filled', (t) async {
      final api = _Api()..failPost = ApiException('This mobile number is already used in this business.', status: 409);
      await _open(t, EmployeeFormScreen(session: _session(api)));
      await t.enterText(textFieldLabelled('Full name *'), 'Asha Rao');
      await t.enterText(textFieldLabelled('Phone number *'), '9876543210');
      await t.tap(find.text('Create employee'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 100));
      expect(find.text('This mobile number is already used in this business.'), findsOneWidget);
      expect(_text(t, 'Full name *'), 'Asha Rao');
      expect(find.text('Create employee'), findsOneWidget);
      await t.pumpAndSettle(const Duration(seconds: 5));
    });

    testWidgets('add: the sign-in role section comes from login-options and a role asks for a password', (t) async {
      final api = _Api();
      await _open(t, EmployeeFormScreen(session: _session(api)));
      expect(api.gets, containsAll(['/api/employees/login-options', '/api/settings/hr-org-catalog']));
      expect(find.text('Sign-in role'), findsOneWidget);
      expect(find.text('Password'), findsNothing);
      await t.tap(find.text('Attendance only'));
      await t.pumpAndSettle();
      await t.tap(find.text('Cashier'));
      await t.pumpAndSettle();
      expect(find.text('Password'), findsOneWidget);
      await t.enterText(textFieldLabelled('Full name *'), 'Asha Rao');
      await t.enterText(textFieldLabelled('Phone number *'), '9876543210');
      await t.tap(find.text('Create employee'));
      await t.pumpAndSettle();
      expect(api.postCount, 0);
      expect(find.textContaining('at least 8 characters'), findsWidgets);
    });

    testWidgets('edit: loads the record into the form and sends only the changed field', (t) async {
      final api = _Api();
      await _open(t, EmployeeFormScreen(session: _session(api), employeeId: 'e1'));
      expect(_text(t, 'Full name *'), 'Asha Rao');
      expect(_text(t, 'Employee code *'), 'EMP001');
      expect(_text(t, 'Monthly salary'), '25000.00');
      await t.enterText(textFieldLabelled('Designation'), 'Manager');
      await t.tap(find.text('Save employee'));
      await t.pumpAndSettle();
      expect(api.patches, {'/api/employees/e1': {'designation': 'Manager'}});
      expect(api.postCount, 0);
      expect(find.byType(EmployeeFormScreen), findsNothing);
    });

    testWidgets('edit: a load failure shows Try again, no form and no Save; retry brings the form', (t) async {
      final api = _Api()..failEmployee = ApiException('Could not load employee record', status: 500);
      await _open(t, EmployeeFormScreen(session: _session(api), employeeId: 'e1'));
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Could not load employee record'), findsOneWidget);
      expect(find.text('Save employee'), findsNothing);
      expect(find.byType(TextField), findsNothing);
      api.failEmployee = null;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Save employee'), findsOneWidget);
      expect(_text(t, 'Full name *'), 'Asha Rao');
    });

    testWidgets('edit: a refused save keeps the form and the typed change', (t) async {
      final api = _Api()..failPatch = ApiException('Employee code "EMP009" already exists', status: 400);
      await _open(t, EmployeeFormScreen(session: _session(api), employeeId: 'e1'));
      await t.enterText(textFieldLabelled('Employee code *'), 'EMP009');
      await t.tap(find.text('Save employee'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 100));
      expect(find.text('Employee code "EMP009" already exists'), findsOneWidget);
      expect(_text(t, 'Employee code *'), 'EMP009');
      await t.pumpAndSettle(const Duration(seconds: 5));
    });

    testWidgets('Lite plan: no reporting manager, PAN or Aadhaar on the form, and none sent', (t) async {
      final api = _Api()..features = const ['hr_employees'];
      await _open(t, EmployeeFormScreen(session: _session(api)));
      expect(api.gets, contains('/api/features/enabled'));
      expect(find.text('Reporting manager'), findsNothing);
      expect(find.text('PAN number'), findsNothing);
      expect(find.text('Aadhaar number'), findsNothing);
      await t.enterText(textFieldLabelled('Full name *'), 'Asha Rao');
      await t.enterText(textFieldLabelled('Phone number *'), '9876543210');
      await t.tap(find.text('Create employee'));
      await t.pumpAndSettle();
      final body = api.posts['/api/employees']!;
      for (final k in ['reporting_manager_id', 'pan_number', 'aadhaar_number']) {
        expect(body.containsKey(k), isFalse, reason: k);
      }
    });

    testWidgets('full HR: the gated fields show and are sent', (t) async {
      final api = _Api();
      await _open(t, EmployeeFormScreen(session: _session(api)));
      expect(find.text('Reporting manager'), findsOneWidget);
      await t.enterText(textFieldLabelled('Full name *'), 'Asha Rao');
      await t.enterText(textFieldLabelled('Phone number *'), '9876543210');
      await t.enterText(textFieldLabelled('PAN number'), 'ABCDE1234F');
      await t.tap(find.text('Create employee'));
      await t.pumpAndSettle();
      expect(api.posts['/api/employees']!['pan_number'], 'ABCDE1234F');
    });

    testWidgets('Lite plan edit: no statutory fields and no reporting manager', (t) async {
      final lite = _Api()..features = const ['hr_employees'];
      await _open(t, EmployeeFormScreen(session: _session(lite), employeeId: 'e1'));
      for (final label in ['PAN number', 'Aadhaar number', 'UAN (EPFO)', 'ESI IP number', 'PF account no.', 'PF applicable', 'ESI applicable', 'Reporting manager']) {
        expect(find.text(label), findsNothing, reason: label);
      }
    });

    testWidgets('payroll-only plan edit shows the statutory fields without the reporting manager', (t) async {
      final payroll = _Api()..features = const ['hr_payroll_setup'];
      await _open(t, EmployeeFormScreen(session: _session(payroll), employeeId: 'e1'));
      expect(find.text('UAN (EPFO)'), findsOneWidget);
      expect(find.text('PF applicable'), findsOneWidget);
      expect(find.text('Reporting manager'), findsNothing);
    });

    testWidgets('edit: custom weekly off with every day unticked is refused with a message and no request', (t) async {
      final api = _Api();
      await _open(t, EmployeeFormScreen(session: _session(api), employeeId: 'e1'));
      await t.tap(find.text('Custom weekly off'));
      await t.pumpAndSettle();
      await t.tap(find.text('Sunday'));
      await t.pumpAndSettle();
      await t.tap(find.text('Save employee'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 100));
      expect(find.text('Pick at least one day off'), findsWidgets);
      expect(api.patches, isEmpty);
      await t.pumpAndSettle(const Duration(seconds: 5));
    });

    testWidgets('a plan without HR shows the not-in-plan state', (t) async {
      final api = _Api()..failEmployee = ApiException('Upgrade to use HR', status: 403, code: 'FEATURE_NOT_IN_PLAN');
      await _open(t, EmployeeFormScreen(session: _session(api), employeeId: 'e1'));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
      expect(find.text('Save employee'), findsNothing);
    });
  });

  group('employee profile and list', () {
    testWidgets('deactivate asks first, naming the employee, and shows the server refusal', (t) async {
      final api = _Api()..failDelete = ApiException('Pay the pending salary before deactivating.', status: 400);
      await _open(t, EmployeeDetailScreen(session: _session(api), employeeId: 'e1'));
      await t.tap(find.text('Deactivate'));
      await t.pumpAndSettle();
      expect(find.textContaining('lose access'), findsOneWidget);
      expect(find.textContaining('Asha Rao'), findsWidgets);
      expect(api.deletes, isEmpty);
      await t.tap(find.text('Deactivate employee'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 100));
      expect(find.text('Pay the pending salary before deactivating.'), findsOneWidget);
      expect(find.text('Active'), findsWidgets);
      await t.pumpAndSettle(const Duration(seconds: 5));
    });

    testWidgets('deactivate calls DELETE once and the profile turns inactive', (t) async {
      final api = _Api();
      await _open(t, EmployeeDetailScreen(session: _session(api), employeeId: 'e1'));
      await t.tap(find.text('Deactivate'));
      await t.pumpAndSettle();
      await t.tap(find.text('Deactivate employee'));
      await t.tap(find.text('Deactivate employee'), warnIfMissed: false);
      await t.pumpAndSettle(const Duration(seconds: 5));
      expect(api.deletes, ['/api/employees/e1']);
      expect(find.text('Inactive'), findsWidgets);
      expect(find.text('Deactivate'), findsNothing);
    });

    testWidgets('keeping the employee on the question deletes nothing', (t) async {
      final api = _Api();
      await _open(t, EmployeeDetailScreen(session: _session(api), employeeId: 'e1'));
      await t.tap(find.text('Deactivate'));
      await t.pumpAndSettle();
      await t.tap(find.text('Keep employee'));
      await t.pumpAndSettle();
      expect(api.deletes, isEmpty);
    });

    testWidgets('profile Edit opens the form for that employee', (t) async {
      final api = _Api();
      await _open(t, EmployeeDetailScreen(session: _session(api), employeeId: 'e1'));
      await t.tap(find.bySemanticsLabel('Edit'));
      await t.pumpAndSettle();
      expect(find.byType(EmployeeFormScreen), findsOneWidget);
      expect(_text(t, 'Full name *'), 'Asha Rao');
    });

    testWidgets('the list has Add employee and Org chart in the top bar', (t) async {
      final api = _Api();
      await _open(t, EmployeesScreen(session: _session(api)));
      await t.tap(find.bySemanticsLabel('Add employee'));
      await t.pumpAndSettle();
      expect(find.byType(EmployeeFormScreen), findsOneWidget);
      await t.tap(find.bySemanticsLabel('Back'));
      await t.pumpAndSettle();
      await t.tap(find.bySemanticsLabel('Org chart'));
      await t.pumpAndSettle();
      expect(find.byType(OrgChartScreen), findsOneWidget);
    });

    testWidgets('attendance with no one to mark opens the phone form, not the website', (t) async {
      final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
      dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) => h.resolve(Response(
            requestOptions: o,
            statusCode: 403,
            data: {'error': 'You do not have permission to mark attendance or there are no active employees.'},
          ))));
      final s = AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b'}});
      await t.pumpWidget(MaterialApp(home: AttendanceScreen(session: s)));
      await t.pumpAndSettle();
      await t.tap(find.text('Add employee'));
      await t.pumpAndSettle();
      expect(find.byType(EmployeeFormScreen), findsOneWidget);
    });

    test('/employees/new and /employees/org-chart are native screens', () {
      final s = _session(_Api());
      expect(nativeScreenFor(s, '/employees/new'), isA<EmployeeFormScreen>());
      expect(nativeScreenFor(s, '/employees/org-chart'), isA<OrgChartScreen>());
      expect(routeTier(s, '/employees/new'), RouteTier.native);
      expect(routeTier(s, '/employees/org-chart'), RouteTier.native);
      expect(websiteByDesign, isNot(contains('/employees/new')));
    });
  });

  group('org chart screen', () {
    Map<String, dynamic> node(String id, String name, [List<Map<String, dynamic>> kids = const [], String dept = '']) =>
        {'id': id, 'name': name, 'employee_code': 'C$id', 'designation': '', 'department': dept, 'children': kids};

    Map<String, dynamic> tree() => {
          'roots': [
            node('a', 'Boss', [
              node('b', 'Asha', [
                node('c', 'Ravi', [node('d', 'Meena')]),
              ], 'Sales'),
            ]),
          ],
          'orphans': [node('x', 'Lost')],
          'cycleIds': ['y'],
          'departments': ['Sales'],
        };

    testWidgets('shows the tree two levels deep, expands and collapses, notes loop and orphans', (t) async {
      final api = _Api()..orgChart = tree();
      await _open(t, OrgChartScreen(session: _session(api)));
      expect(find.text('Boss'), findsOneWidget);
      expect(find.text('Asha'), findsOneWidget);
      expect(find.text('Ravi'), findsOneWidget);
      expect(find.text('Meena'), findsNothing);
      expect(find.text('Lost'), findsOneWidget);
      expect(find.textContaining('circular reporting'), findsOneWidget);
      await t.tap(find.bySemanticsLabel('Expand Ravi'));
      await t.pumpAndSettle();
      expect(find.text('Meena'), findsOneWidget);
      await t.tap(find.bySemanticsLabel('Collapse Asha'));
      await t.pumpAndSettle();
      expect(find.text('Ravi'), findsNothing);
    });

    testWidgets('tapping a person opens their profile', (t) async {
      final api = _Api()..orgChart = tree();
      await _open(t, OrgChartScreen(session: _session(api)));
      await t.tap(find.text('Asha'));
      await t.pumpAndSettle();
      expect(find.byType(EmployeeDetailScreen), findsOneWidget);
      expect(api.gets, contains('/api/employees/b'));
    });

    testWidgets('a department chip reloads with that department', (t) async {
      final api = _Api()..orgChart = tree();
      await _open(t, OrgChartScreen(session: _session(api)));
      await t.tap(find.text('Sales').first);
      await t.pumpAndSettle();
      expect(api.gets, contains('/api/employees/org-chart?department=Sales'));
    });

    testWidgets('empty, error with Try again, and not in plan', (t) async {
      final api = _Api();
      await _open(t, OrgChartScreen(session: _session(api)));
      expect(find.textContaining('No employees in the org chart'), findsOneWidget);
    });

    testWidgets('a server error shows Try again', (t) async {
      final api = _Api()..failOrg = ApiException('Server down', status: 500);
      await _open(t, OrgChartScreen(session: _session(api)));
      expect(find.text('Try again'), findsOneWidget);
      api.failOrg = null;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('a plan without HR shows the not-in-plan state', (t) async {
      final api = _Api()..failOrg = ApiException('No', status: 403, code: 'FEATURE_NOT_IN_PLAN');
      await _open(t, OrgChartScreen(session: _session(api)));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });
}
