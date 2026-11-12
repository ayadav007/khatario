/// Pure helpers for paying salary, payslips, salary advances, employee expenses, commissions and
/// targets.
///
/// Every request here leaves out `business_id`, `user_id`, `created_by`, `processed_by`,
/// `requested_by` and `approved_by`: the session names the business and the user. Salary figures
/// come from the server's prefill; the phone adds nothing to them except the preview total the
/// website's form also shows, and it shows the server's own figures once the salary is posted.
library;

import '../../format.dart';
import 'salary_payments_logic.dart';

String _t(dynamic v) => v?.toString().trim() ?? '';

String? _orNull(String? v) {
  final t = v?.trim() ?? '';
  return t.isEmpty ? null : t;
}

String _money(num v) => v.toStringAsFixed(2);

Map<String, dynamic>? _map(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : null;

List<Map<String, dynamic>> _maps(dynamic v) =>
    v is List ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];

// ---------------------------------------------------------------------------------------------
// Pay salary: `GET /api/employees/salary/payments/prefill`, then `POST /api/employees/salary/payments`
// ---------------------------------------------------------------------------------------------

String salaryPrefillPath({required String employeeId, required DateTime from, required DateTime to}) =>
    '/api/employees/salary/payments/prefill?employee_id=${Uri.encodeQueryComponent(employeeId)}&from_date=${ymd(from)}&to_date=${ymd(to)}';

/// The money fields the form shows, in the website's order. Each key is also a body key.
const salaryEarningKeys = ['basic_salary', 'hra', 'transport_allowance', 'medical_allowance', 'special_allowance', 'overtime', 'bonus', 'commission', 'other_earnings'];
const salaryDeductionKeys = [
  'provident_fund', 'employer_provident_fund', 'esi_employee', 'esi_employer', 'professional_tax', 'tds',
  'advance_recovery', 'loan_deduction', 'attendance_deduction', 'other_deductions',
];

/// Earnings and deductions the website hides unless the plan has payroll setup (`hr_payroll_setup`).
const salaryFullHrKeys = {
  'hra', 'transport_allowance', 'medical_allowance', 'special_allowance', 'overtime',
  'provident_fund', 'employer_provident_fund', 'esi_employee', 'esi_employer', 'professional_tax', 'tds', 'attendance_deduction',
};

/// What the server worked out for this employee and period.
class SalaryPrefill {
  const SalaryPrefill({
    required this.source,
    required this.fields,
    required this.attendanceDeduction,
    required this.attendanceLines,
    required this.attendanceSummary,
    required this.componentBreakdown,
    this.proRataNote,
    this.workingDays,
    this.presentDays,
  });

  final String? source;
  final Map<String, num> fields;
  final String attendanceDeduction;
  final List<Map<String, dynamic>> attendanceLines;
  final Map<String, dynamic>? attendanceSummary;
  final List<Map<String, dynamic>> componentBreakdown;
  final String? proRataNote;
  final String? workingDays;
  final String? presentDays;

  /// A field as the form text, two decimals, zero when the server sent none.
  String field(String key) => _money(fields[key] ?? 0);

  /// `pf_wage` / `esi_wage` are left blank when the server sent none.
  String? optionalField(String key) => fields.containsKey(key) ? _money(fields[key]!) : null;

  factory SalaryPrefill.fromJson(Map<String, dynamic> json) {
    final rawFields = _map(json['fields']) ?? const {};
    final att = _map(json['attendance_deduction']);
    final pro = _map(json['pro_rata']);
    final applied = pro?['applied'] == true;
    final daysPaid = toNum(pro?['daysPaid']);
    final daysIn = toNum(pro?['daysInPeriod']);
    return SalaryPrefill(
      source: _orNull(_t(json['source'])),
      fields: {for (final e in rawFields.entries) if (e.value != null) e.key: toNum(e.value)},
      attendanceDeduction: _money(toNum(att?['total'])),
      attendanceLines: _maps(att?['lines']),
      attendanceSummary: _map(att?['summary']),
      componentBreakdown: _maps(json['component_breakdown']),
      proRataNote: applied
          ? 'Joined ${_t(pro?['joiningDate'])}: ${jsNumberString(daysPaid)} of ${jsNumberString(daysIn)} days in this period. '
              'Full monthly ${inr(toNum(pro?['fullMonthlySalary']))}, payable ${inr(toNum(pro?['proratedAmount']), maxFraction: 2)}.'
          : null,
      workingDays: applied ? jsNumberString(daysIn) : null,
      presentDays: applied ? jsNumberString(daysPaid) : null,
    );
  }
}

// ---- Advance balance: `GET /api/employees/salary/advances/balance`

String advanceBalancePath(String employeeId, {num? cap}) =>
    '/api/employees/salary/advances/balance?employee_id=${Uri.encodeQueryComponent(employeeId)}${cap != null && cap > 0 ? '&cap_amount=${jsNumberString(cap)}' : ''}';

class AdvanceBalance {
  const AdvanceBalance({required this.pending, required this.awaiting, required this.suggested, required this.planLabels});

  static const none = AdvanceBalance(pending: 0, awaiting: 0, suggested: 0, planLabels: []);

  final num pending;
  final num awaiting;
  final num suggested;
  final List<String> planLabels;

  factory AdvanceBalance.fromJson(Map<String, dynamic> json) {
    final pending = toNum(json['pending_balance']);
    return AdvanceBalance(
      pending: pending,
      awaiting: toNum(json['awaiting_approval_amount']),
      suggested: json['suggested_recovery'] == null ? pending : toNum(json['suggested_recovery']),
      planLabels: [for (final b in _maps(json['recovery_breakdown'])) if (_t(b['plan_label']).isNotEmpty) _t(b['plan_label'])],
    );
  }
}

/// The website's refusals for a recovery larger than the approved advance still outstanding.
String? recoveryProblem({required num pending, required num recovery}) {
  if (recovery <= pending + 0.001) return null;
  return pending <= 0
      ? 'Advance recovery has to be 0 until this employee has an approved salary advance.'
      : 'Advance recovery cannot be more than the pending advance (${inr(pending)}).';
}

// ---- Totals (the preview the website form shows) and the body

num _v(Map<String, String> values, String key) => double.tryParse(values[key]?.trim() ?? '') ?? 0;

class SalaryTotals {
  const SalaryTotals(this.earnings, this.deductions);

  final num earnings;
  final num deductions;
  num get net => earnings - deductions;
}

SalaryTotals salaryTotals(Map<String, String> values) {
  num sum(Iterable<String> keys) => keys.fold<num>(0, (a, k) => a + _v(values, k));
  return SalaryTotals(
    sum(salaryEarningKeys),
    // Employer PF and ESI are costs to the business, not deductions from the employee.
    sum(const ['provident_fund', 'professional_tax', 'tds', 'advance_recovery', 'loan_deduction', 'attendance_deduction', 'other_deductions', 'esi_employee']),
  );
}

Map<String, dynamic> salaryPaymentBody({
  required String employeeId,
  required String month,
  required DateTime from,
  required DateTime to,
  required DateTime paymentDate,
  required Map<String, String> values,
  required bool fullHr,
  required String paymentMode,
  required String paymentReference,
  required String notes,
  required String recoveryNote,
  required List<Map<String, dynamic>> attendanceLines,
  required Map<String, dynamic>? attendanceSummary,
  required List<Map<String, dynamic>> componentBreakdown,
  String workingDays = '',
  String presentDays = '',
  String absentDays = '',
  String leaveDays = '',
  String overtimeHours = '',
  String pfWage = '',
  String esiWage = '',
}) {
  num amount(String key) => (!fullHr && salaryFullHrKeys.contains(key)) ? 0 : _v(values, key);
  int? days(String v) => int.tryParse(v.trim());
  return {
    'employee_id': employeeId,
    'salary_month': month,
    'from_date': ymd(from),
    'to_date': ymd(to),
    'payment_date': ymd(paymentDate),
    for (final k in [...salaryEarningKeys, ...salaryDeductionKeys]) k: amount(k),
    if (fullHr && double.tryParse(pfWage.trim()) != null) 'pf_wage': double.parse(pfWage.trim()),
    if (fullHr && double.tryParse(esiWage.trim()) != null) 'esi_wage': double.parse(esiWage.trim()),
    if (days(workingDays) != null) 'working_days': days(workingDays),
    if (days(presentDays) != null) 'present_days': days(presentDays),
    if (days(absentDays) != null) 'absent_days': days(absentDays),
    if (fullHr && days(leaveDays) != null) 'leave_days': days(leaveDays),
    if (fullHr && days(overtimeHours) != null) 'overtime_hours': days(overtimeHours),
    'payment_mode': paymentMode,
    if (_orNull(paymentReference) != null) 'payment_reference': paymentReference.trim(),
    if (_orNull(notes) != null) 'notes': notes.trim(),
    if (_orNull(recoveryNote) != null) 'advance_recovery_note': recoveryNote.trim(),
    'generate_payslip': true,
    'component_breakdown': fullHr ? componentBreakdown : const <Map<String, dynamic>>[],
    'attendance_adjustment_details': fullHr && attendanceLines.isNotEmpty ? {'lines': attendanceLines, 'summary': attendanceSummary} : null,
  };
}

String salaryPayAsk({required String employee, required String month, required num net}) =>
    'Pay $employee ${inr(net, maxFraction: 2)} (form total) for ${salaryMonthLabel(month)}? '
    'The server adds any pending leave encashment or overtime and posts the final amount. This posts to your books.';

/// `POST /api/employees/salary/payments` answer: the server's own figures.
class SalaryPaid {
  const SalaryPaid({required this.id, required this.net, required this.gross, required this.deductions, required this.advanceRecoveries});

  final String id;
  final num net;
  final num gross;
  final num deductions;
  final int advanceRecoveries;

  factory SalaryPaid.fromJson(Map<String, dynamic> json) {
    final p = _map(json['salary_payment']) ?? const {};
    return SalaryPaid(
      id: _t(p['id']),
      net: toNum(p['net_salary']),
      gross: toNum(p['gross_salary']),
      deductions: toNum(p['total_deductions']),
      advanceRecoveries: toNum(json['advance_recoveries']).toInt(),
    );
  }
}

String payslipPdfPath(String salaryPaymentId) => '/api/employees/salary/payslips/$salaryPaymentId/pdf';

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

DateTime? _date(dynamic v) {
  final s = _t(v);
  return s.length < 10 ? null : DateTime.tryParse(s.substring(0, 10));
}

String _amountText(num v) => inr(v, maxFraction: 2);

String _query(Map<String, String?> q) {
  final parts = [for (final e in q.entries) if (e.value != null && e.value!.isNotEmpty) '${e.key}=${Uri.encodeQueryComponent(e.value!)}'];
  return parts.isEmpty ? '' : '?${parts.join('&')}';
}

String _label(String status) => status.isEmpty ? 'Recorded' : status[0].toUpperCase() + status.substring(1).replaceAll('_', ' ');

// ---------------------------------------------------------------------------------------------
// Salary advances: `/api/employees/salary/advances`
// ---------------------------------------------------------------------------------------------

String advancesPath(String status) => '/api/employees/salary/advances${_query({'status': status == 'all' ? null : status})}';

String advanceApprovePath(String id) => '/api/employees/salary/advances/$id/approve';

class AdvanceRow {
  const AdvanceRow({
    required this.id,
    required this.employeeName,
    required this.amount,
    required this.recovered,
    required this.remaining,
    required this.status,
    this.code,
    this.date,
    this.reason,
  });

  final String id;
  final String employeeName;
  final String? code;
  final DateTime? date;
  final num amount;
  final num recovered;
  final num remaining;
  final String status;
  final String? reason;

  static AdvanceRow? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = _t(json['id']);
    if (id.isEmpty) return null;
    return AdvanceRow(
      id: id,
      employeeName: _orNull(_t(json['employee_name'])) ?? _orNull(_t(json['employee_code'])) ?? 'Employee',
      code: _orNull(_t(json['employee_code'])),
      date: _date(json['advance_date']),
      amount: toNum(json['advance_amount']),
      recovered: toNum(json['recovered_amount']),
      remaining: toNum(json['remaining_amount']),
      status: _t(json['status']),
      reason: _orNull(_t(json['reason'])),
    );
  }
}

List<AdvanceRow> advanceRows(dynamic list) => list is List ? list.map(AdvanceRow.fromJson).whereType<AdvanceRow>().toList() : const [];

String advanceStatusLabel(String status) => _label(status);

/// `POST /api/employees/salary/advances`: the website's form fields. The session names who asked.
Map<String, dynamic> advanceBody({
  required String employeeId,
  required String amount,
  required DateTime date,
  required String reason,
  required String method,
  required String months,
}) {
  final m = method == 'salary_deduction' ? int.tryParse(months.trim()) : null;
  return {
    'employee_id': employeeId,
    'advance_amount': double.tryParse(amount.trim()) ?? 0,
    'advance_date': ymd(date),
    'reason': reason.trim(),
    'recovery_method': method,
    'recovery_months': m,
  };
}

/// `PATCH .../approve`: the website approves with a bank transfer and rejects with a reason.
Map<String, dynamic> advanceDecisionBody({String? rejectionReason}) =>
    rejectionReason == null ? {'approved': true, 'payment_mode': 'bank_transfer'} : {'approved': false, 'rejection_reason': rejectionReason.trim()};

String advanceApproveAsk({required String employee, required num amount}) =>
    'Approve the advance of ${_amountText(amount)} for $employee? This posts to your books and cannot be undone here.';

// ---------------------------------------------------------------------------------------------
// Employee expenses: `/api/employees/expenses`
// ---------------------------------------------------------------------------------------------

String expensesPath({required String status, required DateTime from, required DateTime to}) =>
    '/api/employees/expenses${_query({'status': status == 'all' ? null : status, 'start_date': ymd(from), 'end_date': ymd(to)})}';

String expensePath(String id) => '/api/employees/expenses/$id';

String expenseVoucherPdfPath(String id) => '/api/employees/expenses/$id/voucher/pdf';

class ExpenseRow {
  const ExpenseRow({
    required this.id,
    required this.employeeName,
    required this.amount,
    required this.status,
    required this.description,
    required this.hasReceipt,
    this.code,
    this.category,
    this.date,
    this.vendor,
    this.rejectionReason,
    this.approverName,
  });

  final String id;
  final String employeeName;
  final String? code;
  final String? category;
  final DateTime? date;
  final num amount;
  final String status;
  final String description;
  final bool hasReceipt;
  final String? vendor;
  final String? rejectionReason;
  final String? approverName;

  static ExpenseRow? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = _t(json['id']);
    if (id.isEmpty) return null;
    return ExpenseRow(
      id: id,
      employeeName: _orNull(_t(json['employee_name'])) ?? _orNull(_t(json['employee_code'])) ?? 'Employee',
      code: _orNull(_t(json['employee_code'])),
      category: _orNull(_t(json['category_name'])),
      date: _date(json['expense_date']),
      amount: toNum(json['amount']),
      status: _t(json['status']),
      description: _t(json['description']),
      hasReceipt: _t(json['receipt_url']).isNotEmpty,
      vendor: _orNull(_t(json['vendor_name'])),
      rejectionReason: _orNull(_t(json['rejection_reason'])),
      approverName: _orNull(_t(json['approver_name'])),
    );
  }
}

List<ExpenseRow> expenseRows(dynamic list) => list is List ? list.map(ExpenseRow.fromJson).whereType<ExpenseRow>().toList() : const [];

class ExpenseTotals {
  const ExpenseTotals({required this.pending, required this.approved, required this.reimbursed, required this.total});

  static const zero = ExpenseTotals(pending: 0, approved: 0, reimbursed: 0, total: 0);

  final num pending;
  final num approved;
  final num reimbursed;
  final num total;

  factory ExpenseTotals.fromJson(dynamic json) {
    final m = _map(json) ?? const {};
    return ExpenseTotals(pending: toNum(m['pending']), approved: toNum(m['approved']), reimbursed: toNum(m['reimbursed']), total: toNum(m['total']));
  }
}

String expenseStatusLabel(String status) => _label(status);

/// `POST /api/employees/expenses`. Left out: `business_id`, `created_by`; the session names both.
/// The bill goes in as `receipt_url`, as on the website's form.
Map<String, dynamic> expenseBody({
  required String employeeId,
  required String categoryId,
  required DateTime date,
  required String amount,
  required String description,
  required String paymentMode,
  required String vendor,
  required String receiptUrl,
  required bool billable,
  required String billableCustomer,
  required String billableProject,
}) =>
    {
      'employee_id': employeeId,
      'expense_category_id': _orNull(categoryId),
      'expense_date': ymd(date),
      'amount': double.tryParse(amount.trim()) ?? 0,
      'currency': 'INR',
      'description': description.trim(),
      if (_orNull(paymentMode) != null) 'payment_mode': paymentMode,
      if (_orNull(vendor) != null) 'vendor_name': vendor.trim(),
      if (_orNull(receiptUrl) != null) 'receipt_url': receiptUrl,
      'is_billable': billable,
      'billable_to_customer_id': billable ? _orNull(billableCustomer) : null,
      if (billable && _orNull(billableProject) != null) 'billable_to_project': billableProject.trim(),
    };

/// `PATCH /api/employees/expenses/[id]`: approve, reject (with a reason), reimburse (with a reference) or cancel.
Map<String, dynamic> expenseActionBody(String action, {String? text}) => {
      'action': action,
      if (action == 'reject' && _orNull(text) != null) 'rejection_reason': text!.trim(),
      if (action == 'reimburse' && _orNull(text) != null) 'reimbursement_reference': text!.trim(),
    };

const receiptMaxBytes = 5 * 1024 * 1024;

/// The website's receipt rules: JPG, PNG or PDF, up to 5 MB.
String? receiptProblem({required String name, required int size}) {
  final ext = name.toLowerCase().split('.').last;
  if (!const ['jpg', 'jpeg', 'png', 'pdf'].contains(ext)) return 'Choose a JPG, PNG or PDF.';
  if (size > receiptMaxBytes) return 'File size too large. Maximum size is 5MB.';
  return null;
}

String expenseAsk(String action, {required String employee, required num amount}) {
  final a = _amountText(amount);
  return switch (action) {
    'approve' => 'Approve the expense of $a from $employee?',
    'reimburse' => 'Mark the expense of $a from $employee as reimbursed?',
    'cancel' => 'Cancel the expense of $a from $employee?',
    _ => 'Reject the expense of $a from $employee?',
  };
}

// ---------------------------------------------------------------------------------------------
// Commissions: `/api/employees/commissions`
// ---------------------------------------------------------------------------------------------

String commissionsPath({required String status, required DateTime from, required DateTime to}) =>
    '/api/employees/commissions${_query({'status': status == 'all' ? null : status, 'start_date': ymd(from), 'end_date': ymd(to)})}';

class CommissionRow {
  const CommissionRow({
    required this.id,
    required this.employeeName,
    required this.saleAmount,
    required this.rate,
    required this.amount,
    required this.status,
    this.code,
    this.invoiceNumber,
    this.invoiceDate,
  });

  final String id;
  final String employeeName;
  final String? code;
  final String? invoiceNumber;
  final DateTime? invoiceDate;
  final num saleAmount;
  final num rate;
  final num amount;
  final String status;

  static CommissionRow? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = _t(json['id']);
    if (id.isEmpty) return null;
    return CommissionRow(
      id: id,
      employeeName: _orNull(_t(json['employee_name'])) ?? _orNull(_t(json['employee_code'])) ?? 'Employee',
      code: _orNull(_t(json['employee_code'])),
      invoiceNumber: _orNull(_t(json['invoice_number'])),
      invoiceDate: _date(json['invoice_date']),
      saleAmount: toNum(json['sale_amount']),
      rate: toNum(json['commission_rate']),
      amount: toNum(json['commission_amount']),
      status: _t(json['status']),
    );
  }
}

List<CommissionRow> commissionRows(dynamic list) => list is List ? list.map(CommissionRow.fromJson).whereType<CommissionRow>().toList() : const [];

class CommissionTotals {
  const CommissionTotals({required this.pending, required this.approved, required this.paid, required this.total});

  static const zero = CommissionTotals(pending: 0, approved: 0, paid: 0, total: 0);

  final num pending;
  final num approved;
  final num paid;
  final num total;

  factory CommissionTotals.fromJson(dynamic json) {
    final m = _map(json) ?? const {};
    return CommissionTotals(pending: toNum(m['pending']), approved: toNum(m['approved']), paid: toNum(m['paid']), total: toNum(m['total']));
  }
}

String commissionStatusLabel(String status) => _label(status);

/// `POST /api/employees/commissions`: approve, pay or cancel one earning. The session is the approver.
Map<String, dynamic> commissionActionBody(String commissionId, String action) => {'commission_id': commissionId, 'action': action};

String commissionAsk(String action, {required String employee, required num amount}) {
  final a = _amountText(amount);
  return switch (action) {
    'pay' => 'Pay the commission of $a to $employee? This is recorded as paid and cannot be undone here.',
    'cancel' => 'Cancel the commission of $a for $employee?',
    _ => 'Approve the commission of $a for $employee?',
  };
}

// ---------------------------------------------------------------------------------------------
// Targets: `/api/employees/targets`
// ---------------------------------------------------------------------------------------------

const targetsPath = '/api/employees/targets';

String targetPath(String id) => '/api/employees/targets/$id';

class TargetRow {
  const TargetRow({
    required this.id,
    required this.employeeId,
    required this.employeeName,
    required this.period,
    required this.year,
    required this.amount,
    this.code,
    this.month,
    this.invoices,
  });

  final String id;
  final String employeeId;
  final String employeeName;
  final String? code;
  final String period;
  final int year;
  final int? month;
  final num amount;
  final int? invoices;

  static TargetRow? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = _t(json['id']);
    if (id.isEmpty) return null;
    return TargetRow(
      id: id,
      employeeId: _t(json['employee_id']),
      employeeName: _orNull(_t(json['employee_name'])) ?? _orNull(_t(json['employee_code'])) ?? 'Employee',
      code: _orNull(_t(json['employee_code'])),
      period: _t(json['target_period']),
      year: toNum(json['target_year']).toInt(),
      month: json['target_month'] == null ? null : toNum(json['target_month']).toInt(),
      amount: toNum(json['target_amount']),
      invoices: json['target_invoices'] == null ? null : toNum(json['target_invoices']).toInt(),
    );
  }
}

List<TargetRow> targetRows(dynamic list) => list is List ? list.map(TargetRow.fromJson).whereType<TargetRow>().toList() : const [];

const _monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/// The website's label: "November 2026", "Q2 2026" or "2026".
String targetPeriodLabel(TargetRow t) {
  if (t.period == 'monthly' && t.month != null && t.month! >= 1 && t.month! <= 12) return '${_monthNames[t.month! - 1]} ${t.year}';
  if (t.period == 'quarterly') return 'Q${((t.month ?? 1) / 3).ceil()} ${t.year}';
  return '${t.year}';
}

/// `POST /api/employees/targets` (sets or updates the target for that employee and period).
Map<String, dynamic> targetBody({
  required String employeeId,
  required String period,
  required int year,
  required int month,
  required String amount,
  required String invoices,
}) =>
    {
      'employee_id': employeeId,
      'target_period': period,
      'target_year': year,
      'target_month': period == 'monthly' ? month : null,
      'target_amount': double.tryParse(amount.trim()) ?? 0,
      'target_invoices': int.tryParse(invoices.trim()),
    };
