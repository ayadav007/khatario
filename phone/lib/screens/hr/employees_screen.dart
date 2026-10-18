import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'employee_logic.dart';

/// Website `/employees`: everyone on the payroll, with search and an active / inactive filter.
class EmployeesScreen extends StatefulWidget {
  const EmployeesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<EmployeesScreen> createState() => _EmployeesScreenState();
}

class _EmployeesScreenState extends State<EmployeesScreen> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _rows = const [];
  int _total = 0;
  String _status = 'all';
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final status = _status == 'all' ? '' : '&status=$_status';
      final body = await widget.session.api.getJson('/api/employees?limit=100$status');
      if (!mounted) return;
      final rows = jsonRows(body['employees']);
      final pagination = body['pagination'];
      setState(() {
        _rows = rows;
        _total = pagination is Map ? toNum(pagination['total']).toInt() : rows.length;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    }
  }

  void _setStatus(String status) {
    if (status == _status) return;
    setState(() => _status = status);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _TopBar(title: 'Employees'),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 0),
              child: KSearchField(controller: _search, hint: 'Name, code, phone or role', onChanged: (_) => setState(() {})),
            ),
            const SizedBox(height: AppSpace.sm),
            KChipBar<String>(
              value: _status,
              options: const [('all', 'All'), ('active', 'Active'), ('inactive', 'Inactive')],
              onChanged: _setStatus,
            ),
            const SizedBox(height: AppSpace.sm),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null) {
      return ListView(children: [
        KEmptyState(
          icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: _notInPlan ? 'Not included in your current plan' : 'Could not load employees',
          body: _error,
          action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    final visible = filterEmployees(_rows, _search.text);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(2, 0, 2, 10),
            child: Text(
              _total > _rows.length ? 'Showing ${visible.length} of $_total employees' : '${visible.length} ${visible.length == 1 ? 'employee' : 'employees'}',
              style: AppText.label,
            ),
          ),
          if (_rows.isEmpty)
            KEmptyState(
              icon: LucideIcons.users,
              title: _status == 'inactive' ? 'No inactive employees' : 'No employees yet',
              body: _status == 'inactive' ? null : 'Add employees on the website to see them here.',
            )
          else if (visible.isEmpty)
            const KEmptyState(icon: LucideIcons.search, title: 'No matching employees')
          else
            KCard(
              child: KDivided(indent: 66, children: [for (final row in visible) _row(row)]),
            ),
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> row) {
    final name = employeeName(row);
    final active = employeeActive(row);
    return KListRow(
      leading: KAvatar(name: name, muted: !active),
      title: name,
      subtitle: employeeSubtitle(row),
      trailing: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          KStatusDot(label: active ? 'Active' : 'Inactive', tone: active ? KTone.positive : KTone.neutral),
          if (_s(row['employee_code']) != null) ...[
            const SizedBox(height: 2),
            Text(_s(row['employee_code'])!, style: AppText.caption),
          ],
        ],
      ),
      onTap: () => Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => EmployeeDetailScreen(session: widget.session, employeeId: row['id'].toString(), initial: row),
      )),
    );
  }
}

/// One employee: work, contact, pay and statutory details from `/api/employees/[id]`.
class EmployeeDetailScreen extends StatefulWidget {
  const EmployeeDetailScreen({super.key, required this.session, required this.employeeId, this.initial});

  final AppSession session;
  final String employeeId;
  final Map<String, dynamic>? initial;

  @override
  State<EmployeeDetailScreen> createState() => _EmployeeDetailScreenState();
}

class _EmployeeDetailScreenState extends State<EmployeeDetailScreen> {
  Map<String, dynamic>? _employee;
  List<Map<String, dynamic>> _documents = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _employee = widget.initial;
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/employees/${widget.employeeId}');
      if (!mounted) return;
      final employee = body['employee'];
      setState(() {
        if (employee is Map) _employee = {...?widget.initial, ...Map<String, dynamic>.from(employee)};
        _documents = jsonRows(body['documents']);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = _employee;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _TopBar(title: e == null ? 'Employee' : employeeName(e)),
            Expanded(
              child: e == null
                  ? (_loading
                      ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
                      : ListView(children: [KEmptyState(icon: LucideIcons.cloudOff, title: 'Could not load this employee', body: _error)]))
                  : _details(e),
            ),
          ],
        ),
      ),
    );
  }

  Widget _details(Map<String, dynamic> e) {
    final name = employeeName(e);
    final active = employeeActive(e);
    final phone = _s(e['user_phone'] ?? e['phone']);
    final email = _s(e['user_email'] ?? e['email']);
    final salary = e['salary'] ?? e['monthly_salary'];
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          KCard(
            padding: const EdgeInsets.all(16),
            child: Row(children: [
              KAvatar(name: name, size: 52, muted: !active),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(name, style: AppText.heading.copyWith(fontSize: 18)),
                  const SizedBox(height: 2),
                  Text(employeeSubtitle(e).isEmpty ? 'Employee' : employeeSubtitle(e), style: AppText.caption),
                  const SizedBox(height: 6),
                  KPill(label: active ? 'Active' : 'Inactive', tone: active ? KTone.positive : KTone.neutral),
                ]),
              ),
            ]),
          ),
          if (phone != null || email != null) ...[
            const SizedBox(height: AppSpace.md),
            Row(children: [
              if (phone != null)
                Expanded(child: KButton.secondary(label: 'Call', icon: LucideIcons.phone, onPressed: () => launchUrl(Uri.parse('tel:$phone')))),
              if (phone != null && email != null) const SizedBox(width: AppSpace.sm),
              if (email != null)
                Expanded(child: KButton.secondary(label: 'Email', icon: LucideIcons.mail, onPressed: () => launchUrl(Uri.parse('mailto:$email')))),
            ]),
          ],
          _section('Work', [
            ('Employee code', e['employee_code']),
            ('Designation', e['designation']),
            ('Department', e['department']),
            ('Employment', employmentLabel(e['employment_type'])),
            ('Access', e['access_type'] == 'attendance_only' ? 'Attendance only' : e['access_type'] == 'full' ? 'Full app' : null),
            ('Joined', _date(e['joining_date'])),
            ('Reports to', e['reporting_manager_name']),
          ]),
          _section('Contact', [
            ('Phone', phone),
            ('Email', email),
            ('Emergency contact', [_s(e['emergency_contact_name']), _s(e['emergency_contact_phone'])].whereType<String>().join(' · ')),
          ]),
          _section('Pay', [
            ('Salary', salary == null || salary == '' ? null : '$rupeeSign${enIn(toNum(salary), maxFraction: 2)}'),
            ('Bank', e['bank_name']),
            ('Account', maskTail(e['bank_account_number'])),
            ('IFSC', e['bank_ifsc']),
          ]),
          _section('Statutory', [
            ('PAN', e['pan_number']),
            ('Aadhaar', maskTail(e['aadhaar_number'])),
            ('UAN', e['uan']),
            ('PF', e['pf_applicable'] == null ? null : (e['pf_applicable'] == true ? 'Applicable' : 'Not applicable')),
            ('ESI', e['esi_applicable'] == null ? null : (e['esi_applicable'] == true ? 'Applicable' : 'Not applicable')),
          ]),
          if (_documents.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            KSectionHeader('Documents'),
            KCard(
              child: KDivided(indent: 62, children: [
                for (final d in _documents)
                  KListRow(
                    leading: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(color: AppColors.brandSoft, borderRadius: BorderRadius.circular(11)),
                      child: Icon(LucideIcons.fileText, size: 17, color: AppColors.brand),
                    ),
                    title: _s(d['document_name']) ?? _s(d['document_type']) ?? 'Document',
                    subtitle: _date(d['uploaded_at']) ?? '',
                  ),
              ]),
            ),
          ],
        ],
      ),
    );
  }

  Widget _section(String title, List<(String, dynamic)> rows) {
    final shown = [
      for (final (label, value) in rows)
        if (_s(value) != null) (label, _s(value)!),
    ];
    if (shown.isEmpty) return const SizedBox.shrink();
    return Padding(padding: const EdgeInsets.only(top: AppSpace.md), child: KInfoCard(title: title, rows: shown));
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 64,
      child: Row(children: [
        const SizedBox(width: 4),
        KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).maybePop()),
        const SizedBox(width: 4),
        Expanded(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.heading.copyWith(fontSize: 18))),
        const SizedBox(width: AppSpace.gutter),
      ]),
    );
  }
}

String? _s(dynamic v) {
  final t = v?.toString().trim() ?? '';
  return t.isEmpty ? null : t;
}

String? _date(dynamic v) {
  final parsed = DateTime.tryParse(v?.toString() ?? '');
  return parsed == null ? null : ddMMMyyyy(parsed.toLocal());
}
