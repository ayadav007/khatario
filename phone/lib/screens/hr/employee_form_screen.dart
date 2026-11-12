import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../capability.dart';
import '../../ui/toast.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import 'employee_logic.dart';
import 'employees_screen.dart';
import 'hr_logic.dart';

const _employmentTypes = [('full_time', 'Full time'), ('part_time', 'Part time'), ('contract', 'Contract')];
const _payBases = [('monthly', 'Monthly salary'), ('daily', 'Daily wages')];
const _dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/// Website `/employees/new` and `/employees/[id]/edit`: add or edit one employee.
///
/// Create posts the website's body; edit sends only the fields that changed (`PATCH` is partial).
/// Left on the website: the portal invite on a new employee, the default shift, and the salary
/// structure (the website manages it on the profile, not on these forms).
class EmployeeFormScreen extends StatefulWidget {
  const EmployeeFormScreen({super.key, required this.session, this.employeeId});

  final AppSession session;

  /// Null adds a new employee.
  final String? employeeId;

  @override
  State<EmployeeFormScreen> createState() => _EmployeeFormScreenState();
}

class _EmployeeFormScreenState extends State<EmployeeFormScreen> {
  EmployeeForm _f = EmployeeForm();
  EmployeeForm _initial = EmployeeForm();
  final Map<String, TextEditingController> _c = {};
  Map<String, String> _errors = const {};
  List<String> _departments = const [];
  List<String> _designations = const [];
  List<(String, String)> _branches = const [];
  LoginOptions? _login;
  HrPlan _plan = HrPlan.lite;
  String? _managerName;
  bool _loading = false;
  bool _dirty = false;
  String? _error;
  bool _notInPlan = false;

  bool get _editing => widget.employeeId != null;

  TextEditingController _ctl(String key, String value) => _c[key] ??= TextEditingController(text: value);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    final api = widget.session.api;
    // The catalog, login options and branches only add choices; the form works without them.
    final extras = await Future.wait<Object?>([
      api.getJson('/api/settings/hr-org-catalog').then<Object?>((v) => v).catchError((_) => <String, dynamic>{}),
      api.getJson('/api/employees/login-options').then<Object?>((v) => v).catchError((_) => null),
      api.getJson('/api/features/enabled').then<Object?>((v) => v).catchError((_) => null),
      api.getJson('/api/settings/permissions').then<Object?>((v) => v).catchError((_) => null),
      if (_editing) api.getJson('/api/branches').then<Object?>((v) => v).catchError((_) => <String, dynamic>{}),
    ]);
    Map<String, dynamic>? employee;
    if (_editing) {
      try {
        final body = await api.getJson('/api/employees/${widget.employeeId}');
        final e = body['employee'];
        if (e is! Map) throw ApiException('Employee record was empty');
        employee = Map<String, dynamic>.from(e);
      } on ApiException catch (e) {
        if (!mounted) return;
        setState(() {
          _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
          _error = e.message;
          _loading = false;
        });
        return;
      } catch (_) {
        if (!mounted) return;
        setState(() {
          _error = 'Could not load this employee. Check your connection and try again.';
          _loading = false;
        });
        return;
      }
    }
    if (!mounted) return;
    final catalog = extras[0];
    final login = extras[1];
    final branches = _editing && extras.length > 4 ? extras[4] : null;
    final plan = _hrPlan(extras[2], extras[3]);
    for (final c in _c.values) {
      c.dispose();
    }
    _c.clear();
    setState(() {
      _departments = catalogList(catalog, 'departments');
      _designations = catalogList(catalog, 'designations');
      _login = login is Map<String, dynamic> ? LoginOptions.fromJson(login) : null;
      _plan = plan;
      _branches = [
        for (final b in jsonRows(branches is Map ? branches['branches'] : null))
          if ((b['id']?.toString() ?? '').isNotEmpty) (b['id'].toString(), b['name']?.toString() ?? 'Branch'),
      ];
      if (employee != null) {
        _f = EmployeeForm.fromEmployee(employee);
        _initial = EmployeeForm.fromEmployee(employee);
        final manager = employee['reporting_manager_name']?.toString().trim() ?? '';
        _managerName = manager.isEmpty ? null : manager;
      }
      _loading = false;
    });
  }

  /// The website's `useHrPlan`: `hasCapability('hr_leaves' / 'hr_payroll_setup', 'view')` on the plan
  /// features (`/api/features/enabled`) and the role permissions. When they cannot be read the
  /// fields stay hidden, as on the website.
  HrPlan _hrPlan(Object? features, Object? permissions) {
    if (features is! Map) return HrPlan.lite;
    final perms = <String, Map<String, dynamic>>{
      for (final e in ((permissions is Map ? permissions['permissions'] : null) as Map? ?? const {}).entries)
        if (e.value is Map) e.key.toString(): Map<String, dynamic>.from(e.value as Map),
    };
    final isAdmin = permissions is Map && permissions['isPrimaryAdmin'] == true;
    final reliable = perms.isNotEmpty || isAdmin;
    final caps = Capabilities(
      sessionIsPrimaryAdmin: widget.session.isPrimaryAdmin,
      sessionPermissions: const {},
      snapshot: CapabilitySnapshot(
        permissions: reliable ? perms : const {},
        isPrimaryAdmin: reliable && isAdmin,
        enabledFeatures: [for (final id in (features['enabledIds'] as List? ?? const [])) id.toString()],
      ),
    );
    return HrPlan(leaves: caps.has('hr_leaves'), payrollSetup: caps.has('hr_payroll_setup'));
  }

  void _touch() {
    if (!_dirty) setState(() => _dirty = true);
  }

  void _set(VoidCallback change) {
    setState(() {
      change();
      _dirty = true;
    });
  }

  DateTime? get _joining => DateTime.tryParse(_f.joiningDate);

  String _ymd(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _save() async {
    final errors = employeeErrors(_f, editing: _editing);
    setState(() => _errors = errors);
    if (errors.isNotEmpty) {
      final dayMessage = errors['weeklyOff'];
      if (dayMessage != null) showKToast(context, dayMessage, tone: KTone.negative);
      return;
    }
    final api = widget.session.api;
    if (_editing) {
      final body = employeeEditBody(_initial, _f, plan: _plan);
      if (body.isNotEmpty) await api.patchJson('/api/employees/${widget.employeeId}', body);
      if (mounted) Navigator.of(context).pop(true);
      return;
    }
    final data = await api.postJson('/api/employees', employeeCreateBody(_f, plan: _plan));
    final employee = data['employee'];
    final id = employee is Map ? employee['id']?.toString() : null;
    if (!mounted) return;
    if (id == null || id.isEmpty) {
      Navigator.of(context).pop(true);
      return;
    }
    Navigator.of(context).pushReplacement(MaterialPageRoute(
      builder: (_) => EmployeeDetailScreen(session: widget.session, employeeId: id, initial: Map<String, dynamic>.from(employee as Map)),
    ));
  }

  Widget _text(String key, String label, String value, void Function(String) onChanged, {String? hint, TextInputType? keyboard, bool caps = false, int? maxLength, bool obscure = false}) {
    return KTextField(
      label: label,
      controller: _ctl(key, value),
      hint: hint,
      keyboard: keyboard,
      caps: caps,
      maxLength: maxLength,
      obscure: obscure,
      error: _errors[key],
      onChanged: (v) {
        onChanged(v);
        _touch();
      },
    );
  }

  /// Free text like the website's list-backed field, with the catalog names as quick picks.
  Widget _catalogField(String key, String label, String value, List<String> options, void Function(String) onChanged) {
    final controller = _ctl(key, value);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      KTextField(label: label, controller: controller, onChanged: (v) {
        onChanged(v);
        _touch();
      }),
      if (options.isNotEmpty) ...[
        const SizedBox(height: AppSpace.xs),
        KChipBar<String>(
          value: controller.text.trim(),
          options: [for (final o in options) (o, o)],
          padding: EdgeInsets.zero,
          onChanged: (v) => setState(() {
            controller.text = v;
            onChanged(v);
            _dirty = true;
          }),
        ),
      ],
    ]);
  }

  Widget _loginSection() {
    final login = _login;
    if (login == null) return const SizedBox.shrink();
    final showRoles = login.canAssign || (_editing && _f.roleId.isNotEmpty);
    if (!showRoles) {
      return KFormSection(title: 'Sign-in', children: [Text(login.seatNote, style: AppText.caption)]);
    }
    return KFormSection(title: 'Sign-in', children: [
      KPickField<String>(
        label: 'Sign-in role',
        value: _f.roleId,
        options: [('', 'Attendance only'), ...login.roles],
        onChanged: (v) => _set(() {
          _f.roleId = v;
          if (v.isEmpty) {
            _f.password = '';
            _c['password']?.clear();
          }
        }),
      ),
      Text('Attendance only does not use a login seat. A role lets them sign in with the permissions from Settings > Roles.', style: AppText.caption),
      if (_f.roleId.isNotEmpty)
        _text(
          'password',
          _editing ? 'New password' : 'Password',
          '',
          (v) => _f.password = v,
          hint: _editing ? 'Leave blank to keep the current password' : 'At least 8 characters, with a letter and a number',
          obscure: true,
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final title = _editing ? 'Edit employee' : 'New employee';
    if (_loading) {
      return Scaffold(backgroundColor: AppColors.bg, body: SafeArea(child: Column(children: [KBackBar(title), const Expanded(child: KSpinner(padding: EdgeInsets.symmetric(vertical: 64)))])));
    }
    if (_error != null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            KBackBar(title),
            Expanded(
              child: ListView(children: [
                KEmptyState(
                  icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
                  title: _notInPlan ? 'Not included in your current plan' : 'Could not load this employee',
                  body: _error,
                  action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
                ),
              ]),
            ),
          ]),
        ),
      );
    }
    final f = _f;
    return KFormScaffold(
      title: title,
      saveLabel: _editing ? 'Save employee' : 'Create employee',
      onSave: _save,
      dirty: _dirty,
      children: [
        KFormSection(title: 'Basic information', children: [
          _text('name', 'Full name *', f.name, (v) => f.name = v, hint: 'John Doe'),
          _text('phone', 'Phone number *', f.phone, (v) => f.phone = v, hint: 'Mobile number', keyboard: TextInputType.phone),
          _text('email', 'Email', f.email, (v) => f.email = v, hint: 'Optional', keyboard: TextInputType.emailAddress),
          _text(
            'employeeCode',
            _editing ? 'Employee code *' : 'Employee code (optional)',
            f.employeeCode,
            (v) => f.employeeCode = v,
            hint: _editing ? null : 'Auto-generated if empty (EMP001, EMP002, ...)',
          ),
        ]),
        _loginSection(),
        KFormSection(title: 'Employment', children: [
          _catalogField('designation', 'Designation', f.designation, _designations, (v) => f.designation = v),
          _catalogField('department', 'Department', f.department, _departments, (v) => f.department = v),
          KPickField<String>(label: 'Employment type', value: f.employmentType, options: _employmentTypes, onChanged: (v) => _set(() => f.employmentType = v)),
          KDateField(
            label: 'Joining date',
            value: _joining,
            onChanged: (d) => _set(() => f.joiningDate = _ymd(d)),
          ),
          if (_plan.leaves)
          KAsyncPickField(
            label: 'Reporting manager',
            valueLabel: f.reportingManagerId.isEmpty ? null : (_managerName ?? 'Selected'),
            search: (q) async {
              final rows = await searchEmployees(widget.session.api, q);
              return [
                ('', 'No reporting manager', ''),
                for (final r in rows)
                  if (r.$1 != widget.employeeId) r,
              ];
            },
            onPicked: (id, label) => _set(() {
              f.reportingManagerId = id;
              _managerName = id.isEmpty ? null : label;
            }),
          ),
          if (_editing && _branches.isNotEmpty)
            KPickField<String>(
              label: 'Branch',
              value: f.branchId,
              options: [('', 'No branch'), ..._branches],
              onChanged: (v) => _set(() => f.branchId = v),
            ),
          if (_editing) ...[
            KToggleField(
              label: 'Custom weekly off',
              help: 'Override the business default for this employee.',
              value: f.weeklyOff,
              onChanged: (v) => _set(() => f.weeklyOff = v),
            ),
            if (f.weeklyOff)
              for (var d = 0; d < 7; d++)
                KToggleField(
                  label: _dayNames[d],
                  value: f.weeklyOffDays.contains(d),
                  onChanged: (on) => _set(() {
                    f.weeklyOffDays = on ? [...f.weeklyOffDays, d] : f.weeklyOffDays.where((x) => x != d).toList();
                  }),
                ),
            if (_errors['weeklyOff'] != null) Text(_errors['weeklyOff']!, style: AppText.caption.copyWith(color: AppColors.negative)),
          ],
          KPickField<String>(label: 'Pay type', value: f.payBasis, options: _payBases, onChanged: (v) => _set(() => f.payBasis = v)),
          _text('salary', f.payBasis == 'daily' ? 'Daily wage' : 'Monthly salary', f.salary, (v) => f.salary = v, hint: '0.00', keyboard: const TextInputType.numberWithOptions(decimal: true)),
        ]),
        KFormSection(title: 'Emergency contact', children: [
          _text('emergencyName', 'Contact name', f.emergencyName, (v) => f.emergencyName = v, hint: 'Emergency contact person name'),
          _text('emergencyPhone', 'Contact phone', f.emergencyPhone, (v) => f.emergencyPhone = v, hint: 'Emergency mobile', keyboard: TextInputType.phone),
        ]),
        KFormSection(title: 'Bank details', children: [
          _text('bankAccount', 'Account number', f.bankAccount, (v) => f.bankAccount = v, hint: 'Bank account number', keyboard: TextInputType.number),
          _text('bankIfsc', 'IFSC code', f.bankIfsc, (v) => f.bankIfsc = v, hint: 'IFSC0001234', caps: true),
          _text('bankName', 'Bank name', f.bankName, (v) => f.bankName = v, hint: 'Bank name'),
        ]),
        if (_plan.payrollSetup)
        KFormSection(title: 'Documents', children: [
          _text('pan', 'PAN number', f.pan, (v) => f.pan = v, hint: 'ABCDE1234F', caps: true, maxLength: 10),
          _text('aadhaar', 'Aadhaar number', f.aadhaar, (v) => f.aadhaar = v, hint: '1234 5678 9012', keyboard: TextInputType.number, maxLength: 12),
          if (_editing) ...[
            _text('uan', 'UAN (EPFO)', f.uan, (v) => f.uan = v, maxLength: 20),
            _text('esiIp', 'ESI IP number', f.esiIp, (v) => f.esiIp = v, maxLength: 30),
            _text('pfAccount', 'PF account no.', f.pfAccount, (v) => f.pfAccount = v, maxLength: 40),
            KToggleField(label: 'PF applicable', value: f.pfApplicable, onChanged: (v) => _set(() => f.pfApplicable = v)),
            KToggleField(label: 'ESI applicable', value: f.esiApplicable, onChanged: (v) => _set(() => f.esiApplicable = v)),
          ],
        ]),
        if (!_editing)
          Text('Portal invites, the default shift and the salary structure are set on the website.', style: AppText.caption),
      ],
    );
  }
}
