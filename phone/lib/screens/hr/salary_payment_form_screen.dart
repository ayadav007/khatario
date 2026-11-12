import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../sales/doc_action_sheets.dart';
import 'attendance_leave_logic.dart';
import 'pay_logic.dart';
import 'salary_payments_logic.dart';

/// Website `/employees/salary/payments/new`: run payroll for one employee and month. The figures come
/// from the server's prefill (salary structure, statutory deductions, attendance suggestion, pending
/// advance); the fields the website lets you edit stay editable, and the server works the posted figures
/// out again. Paying asks first, naming the employee and the net payable, then posts once.
class SalaryPaymentFormScreen extends StatefulWidget {
  const SalaryPaymentFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<SalaryPaymentFormScreen> createState() => _SalaryPaymentFormScreenState();
}

const _labels = {
  'basic_salary': 'Basic salary',
  'hra': 'HRA',
  'transport_allowance': 'Transport allowance',
  'medical_allowance': 'Medical allowance',
  'special_allowance': 'Special allowance',
  'overtime': 'Overtime',
  'bonus': 'Bonus',
  'commission': 'Commission',
  'other_earnings': 'Other earnings',
  'provident_fund': 'Employee PF',
  'employer_provident_fund': 'Employer PF (cost)',
  'esi_employee': 'Employee ESI',
  'esi_employer': 'Employer ESI (cost)',
  'professional_tax': 'Professional tax',
  'tds': 'TDS',
  'advance_recovery': 'Advance recovery',
  'loan_deduction': 'Loan deduction',
  'attendance_deduction': 'Attendance deduction (late / LWP)',
  'other_deductions': 'Other deductions',
};

const _modes = [('bank_transfer', 'Bank transfer'), ('cash', 'Cash'), ('cheque', 'Cheque'), ('upi', 'UPI')];

String _monthKey(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}';

class _SalaryPaymentFormScreenState extends State<SalaryPaymentFormScreen> {
  final Map<String, TextEditingController> _money = {};
  final _working = TextEditingController();
  final _present = TextEditingController();
  final _absent = TextEditingController();
  final _leave = TextEditingController();
  final _reference = TextEditingController();
  final _notes = TextEditingController();
  final _recoveryNote = TextEditingController();

  HrAccess _access = HrAccess.open;
  String _employeeId = '';
  String? _employeeName;
  late String _month;
  late DateTime _from;
  late DateTime _to;
  DateTime _paymentDate = dateOnly(DateTime.now());
  String _mode = 'bank_transfer';

  SalaryPrefill? _prefill;
  AdvanceBalance _balance = AdvanceBalance.none;
  bool _loadingPrefill = false;
  String? _prefillError;
  bool _notInPlan = false;
  int _ticket = 0;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = _monthKey(now);
    _from = DateTime(now.year, now.month, 1);
    _to = DateTime(now.year, now.month + 1, 0);
    for (final k in [...salaryEarningKeys, ...salaryDeductionKeys]) {
      _money[k] = TextEditingController(text: '0')..addListener(_changed);
    }
    _money['basic_salary']!.text = '';
    loadHrAccess(widget.session).then((a) {
      if (mounted) setState(() => _access = a);
    });
  }

  @override
  void dispose() {
    for (final c in _money.values) {
      c.dispose();
    }
    for (final c in [_working, _present, _absent, _leave, _reference, _notes, _recoveryNote]) {
      c.dispose();
    }
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  bool get _fullHr => _access.has('hr_payroll_setup');
  Map<String, String> get _values => {for (final e in _money.entries) e.key: e.value.text};
  num get _recovery => double.tryParse(_money['advance_recovery']!.text.trim()) ?? 0;

  Future<void> _loadPrefill() async {
    final ticket = ++_ticket;
    if (_employeeId.isEmpty) return;
    setState(() {
      _loadingPrefill = true;
      _prefillError = null;
      _notInPlan = false;
    });
    final api = widget.session.api;
    SalaryPrefill? prefill;
    String? error;
    var notInPlan = false;
    try {
      prefill = SalaryPrefill.fromJson(await api.getJson(salaryPrefillPath(employeeId: _employeeId, from: _from, to: _to)));
    } on ApiException catch (e) {
      notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
      error = e.message;
    } catch (_) {
      error = 'Could not reach the server.';
    }
    if (!mounted || ticket != _ticket) return;
    if (notInPlan) {
      setState(() {
        _notInPlan = true;
        _loadingPrefill = false;
      });
      return;
    }
    num gross = 0;
    if (prefill != null) {
      for (final k in const ['basic_salary', 'hra', 'transport_allowance', 'medical_allowance', 'special_allowance', 'other_earnings']) {
        gross += prefill.fields[k] ?? 0;
      }
    }
    var balance = AdvanceBalance.none;
    try {
      balance = AdvanceBalance.fromJson(await api.getJson(advanceBalancePath(_employeeId, cap: gross)));
    } catch (_) {
      // The website carries on without the advance box when the balance cannot be read.
    }
    if (!mounted || ticket != _ticket) return;
    setState(() {
      _prefill = prefill;
      _balance = balance;
      _prefillError = error;
      _loadingPrefill = false;
      if (prefill != null) _apply(prefill, gross, balance);
    });
  }

  /// Fills the form the way the website does after a prefill.
  void _apply(SalaryPrefill p, num gross, AdvanceBalance b) {
    for (final k in const [
      'basic_salary', 'hra', 'transport_allowance', 'medical_allowance', 'special_allowance', 'other_earnings', 'provident_fund',
      'professional_tax', 'tds', 'other_deductions', 'employer_provident_fund', 'esi_employee', 'esi_employer',
    ]) {
      _money[k]!.text = p.field(k);
    }
    _money['attendance_deduction']!.text = p.attendanceDeduction;
    if (p.workingDays != null && _working.text.isEmpty) _working.text = p.workingDays!;
    if (p.presentDays != null && _present.text.isEmpty) _present.text = p.presentDays!;
    if (_recovery <= 0) {
      final cap = gross > 0 ? gross : b.pending;
      final fill = [b.suggested, b.pending, cap].reduce((a, c) => a < c ? a : c);
      _money['advance_recovery']!.text = _fixed(fill);
    }
  }

  String _fixed(num v) => v.toStringAsFixed(2);

  void _setMonth(String month) {
    final parts = month.split('-');
    final y = int.parse(parts[0]), m = int.parse(parts[1]);
    setState(() {
      _month = month;
      _from = DateTime(y, m, 1);
      _to = DateTime(y, m + 1, 0);
    });
    _loadPrefill();
  }

  List<(String, String)> get _monthOptions {
    final now = DateTime.now();
    return [
      for (var i = -12; i <= 1; i++)
        (_monthKey(DateTime(now.year, now.month - i, 1)), salaryMonthLabel(_monthKey(DateTime(now.year, now.month - i, 1)))),
    ];
  }

  bool get _ready => _employeeId.isNotEmpty && _money['basic_salary']!.text.trim().isNotEmpty && !_loadingPrefill;

  Future<void> _submit() async {
    if (!_ready) return;
    final problem = recoveryProblem(pending: _balance.pending, recovery: _recovery);
    if (problem != null) {
      showKToast(context, problem, tone: KTone.negative);
      return;
    }
    final totals = salaryTotals(_values);
    final ok = await askSheet(
      context,
      title: 'Pay salary?',
      text: salaryPayAsk(employee: _employeeName ?? 'this employee', month: _month, net: totals.net),
      confirmLabel: 'Pay salary',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!ok || !mounted) return;
    final p = _prefill;
    final Map<String, dynamic> res;
    try {
      res = await widget.session.api.postJson(
      '/api/employees/salary/payments',
      salaryPaymentBody(
        employeeId: _employeeId,
        month: _month,
        from: _from,
        to: _to,
        paymentDate: _paymentDate,
        values: _values,
        fullHr: _fullHr,
        paymentMode: _mode,
        paymentReference: _reference.text,
        notes: _notes.text,
        recoveryNote: _recoveryNote.text,
        attendanceLines: p?.attendanceLines ?? const [],
        attendanceSummary: p?.attendanceSummary,
        componentBreakdown: p?.componentBreakdown ?? const [],
        workingDays: _working.text,
        presentDays: _present.text,
        absentDays: _absent.text,
        leaveDays: _access.has('hr_leaves') ? _leave.text : '',
        pfWage: p?.optionalField('pf_wage') ?? '',
        esiWage: p?.optionalField('esi_wage') ?? '',
      ),
      );
    } on ApiException catch (e) {
      // The server saved the salary but could not post it to the books (for example a locked period):
      // a retry would only say "already exists", so say what happened, close the form and let the list reload.
      if (e.body['salary_payment'] is Map && mounted) {
        showKToast(context, 'Salary was saved but could not be posted to the books: ${e.message}', tone: KTone.negative);
        Navigator.of(context).pop();
        return;
      }
      rethrow;
    }
    if (!mounted) return;
    final paid = SalaryPaid.fromJson(res);
    showKToast(context, 'Salary paid: net ${inr(paid.net, maxFraction: 2)} (gross ${inr(paid.gross, maxFraction: 2)}, deductions ${inr(paid.deductions, maxFraction: 2)})', tone: KTone.positive);
    Navigator.of(context).pop(paid);
  }

  Widget _amount(String key) => KAmountField(
        label: _labels[key]!,
        controller: _money[key]!,
        error: key == 'advance_recovery' ? recoveryProblem(pending: _balance.pending, recovery: _recovery) : null,
      );

  Widget _section(String title, List<Widget> fields) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        KSectionHeader(title),
        for (final (i, f) in fields.indexed) ...[if (i > 0) const SizedBox(height: AppSpace.md), f],
      ]);

  @override
  Widget build(BuildContext context) {
    if (_notInPlan) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const KBackBar('Process salary payment'),
            Expanded(
              child: ListView(children: const [
                KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan'),
              ]),
            ),
          ]),
        ),
      );
    }
    final totals = salaryTotals(_values);
    final p = _prefill;
    final earnings = [for (final k in salaryEarningKeys) if (_fullHr || !salaryFullHrKeys.contains(k)) k];
    final deductions = [for (final k in salaryDeductionKeys) if (_fullHr || !salaryFullHrKeys.contains(k)) k];
    return KFormScaffold(
      title: 'Process salary payment',
      saveLabel: 'Process salary',
      dirty: _employeeId.isNotEmpty,
      canSave: _ready,
      onSave: _submit,
      children: [
        KAsyncPickField(
          label: 'Employee',
          valueLabel: _employeeName,
          search: (q) => searchEmployees(widget.session.api, q),
          onPicked: (id, label) {
            setState(() {
              _employeeId = id;
              _employeeName = label;
              _money['advance_recovery']!.text = '0';
            });
            _loadPrefill();
          },
        ),
        KPickField<String>(label: 'Salary month', value: _month, options: _monthOptions, onChanged: _setMonth),
        KDateField(label: 'Payment date', value: _paymentDate, onChanged: (d) => setState(() => _paymentDate = dateOnly(d))),
        KDateField(
          label: 'Period from',
          value: _from,
          onChanged: (d) {
            setState(() => _from = dateOnly(d));
            _loadPrefill();
          },
        ),
        KDateField(
          label: 'Period to',
          value: _to,
          onChanged: (d) {
            setState(() => _to = dateOnly(d));
            _loadPrefill();
          },
        ),
        if (_loadingPrefill) const KSpinner(padding: EdgeInsets.symmetric(vertical: 12), size: 20),
        if (_prefillError != null)
          Row(children: [
            Expanded(child: Text(_prefillError!, style: AppText.caption.copyWith(color: AppColors.negative))),
            KTextButton(label: 'Try again', onTap: _loadPrefill),
          ]),
        if (_fullHr && p?.source == 'salary_structure')
          const _Note('Prefilled from salary structure', 'Earnings and statutory deductions loaded from the employee\'s active structure. You can still adjust amounts before processing.'),
        if (p?.proRataNote != null) _Note('Pro-rata salary applied', p!.proRataNote!),
        _section('Earnings', [for (final k in earnings) _amount(k)]),
        if (_fullHr && p != null && p.attendanceLines.isNotEmpty)
          _Note('Suggested attendance deductions', [for (final l in p.attendanceLines) '${l['label']}: ${inr(toNum(l['amount']), maxFraction: 2)}'].join('\n')),
        if (_balance.awaiting > 0 && _balance.pending <= 0)
          _Note('Advance waiting for approval: ${inr(_balance.awaiting, maxFraction: 2)}', 'Approve it under Salary advances before recovering it on this payment. Until then, leave Advance recovery at 0.'),
        if (_balance.pending > 0)
          _Note(
            'Pending advance: ${inr(_balance.pending, maxFraction: 2)}',
            [
              if (_balance.suggested > 0 && _balance.suggested < _balance.pending) 'Suggested this month: ${inr(_balance.suggested, maxFraction: 2)}',
              ..._balance.planLabels,
            ].join(' · '),
            action: _balance.suggested > 0 ? KTextButton(label: 'Use suggested ${inr(_balance.suggested, maxFraction: 2)}', onTap: () => setState(() => _money['advance_recovery']!.text = _fixed(_balance.suggested))) : null,
          ),
        _section('Deductions', [
          for (final k in deductions) _amount(k),
          if (_balance.pending > 0 && _recovery > 0 && _recovery < _balance.pending - 0.001)
            KTextField(label: 'Partial recovery note', controller: _recoveryNote, maxLines: 3, minLines: 2, hint: 'e.g. Half recovery this month; balance next salary.'),
        ]),
        _section('Attendance (optional)', [
          KTextField(label: 'Working days', controller: _working, keyboard: TextInputType.number),
          KTextField(label: 'Present days', controller: _present, keyboard: TextInputType.number),
          KTextField(label: 'Absent days', controller: _absent, keyboard: TextInputType.number),
          if (_access.has('hr_leaves')) KTextField(label: 'Leave days', controller: _leave, keyboard: TextInputType.number),
        ]),
        _section('Payment', [
          KPickField<String>(label: 'Payment mode', value: _mode, options: _modes, onChanged: (v) => setState(() => _mode = v)),
          KTextField(label: 'Payment reference', controller: _reference, hint: 'Transaction ID, cheque number, etc.'),
          KTextField(label: 'Notes', controller: _notes, maxLines: 3, minLines: 2),
        ]),
        KCard(
          padding: const EdgeInsets.all(14),
          child: Column(children: [
            _sumRow('Total earnings', inr(totals.earnings, maxFraction: 2)),
            const SizedBox(height: 6),
            _sumRow('Total deductions', inr(totals.deductions, maxFraction: 2)),
            const Divider(height: 20),
            _sumRow('Net salary payable', inr(totals.net, maxFraction: 2), strong: true),
            const SizedBox(height: 6),
            Text('The server works out the posted figures again, including any pending leave encashment and overtime.', style: AppText.caption),
          ]),
        ),
      ],
    );
  }

  Widget _sumRow(String label, String value, {bool strong = false}) => Row(children: [
        Expanded(child: Text(label, style: strong ? AppText.bodyStrong : AppText.body)),
        Text(value, style: strong ? AppText.bodyStrong : AppText.body.copyWith(fontWeight: FontWeight.w600)),
      ]);
}

class _Note extends StatelessWidget {
  const _Note(this.title, this.body, {this.action});

  final String title;
  final String body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return KCard(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: AppText.bodyStrong),
        if (body.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(body, style: AppText.caption)),
        if (action != null) Padding(padding: const EdgeInsets.only(top: 6), child: action),
      ]),
    );
  }
}
