import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../purchases/bill_camera.dart';
import '../reports/statement_pdf.dart';
import '../sales/doc_action_sheets.dart';
import 'pay_logic.dart';
import 'pay_widgets.dart';

/// A bill picked from the camera or the phone, before it is uploaded.
typedef PickedReceipt = ({List<int> bytes, String name});

/// Opens the bill camera (it also uploads a saved photo or PDF) and returns what was captured.
Future<PickedReceipt?> pickReceiptFromPhone(BuildContext context) async {
  final capture = await Navigator.of(context).push<BillCapture>(MaterialPageRoute(
    fullscreenDialog: true,
    builder: (ctx) => BillCameraScreen(title: 'Scan bill', onCapture: (c) => Navigator.of(ctx).pop(c), onClose: () => Navigator.of(ctx).pop()),
  ));
  return capture == null ? null : (bytes: capture.bytes, name: capture.name);
}

const _statuses = [
  ('all', 'All'),
  ('pending', 'Pending'),
  ('approved', 'Approved'),
  ('rejected', 'Rejected'),
  ('reimbursed', 'Reimbursed'),
  ('cancelled', 'Cancelled'),
];

/// Website `/employees/expenses`: employees' expense claims for a date range, with Approve, Reject (with
/// a reason), Reimburse (with a reference), Cancel and the voucher PDF. [pickReceipt] is for tests.
class EmployeeExpensesScreen extends StatefulWidget {
  const EmployeeExpensesScreen({super.key, required this.session, this.pickReceipt});

  final AppSession session;
  final Future<PickedReceipt?> Function()? pickReceipt;

  @override
  State<EmployeeExpensesScreen> createState() => _EmployeeExpensesScreenState();
}

class _EmployeeExpensesScreenState extends State<EmployeeExpensesScreen> {
  String _status = 'all';
  late DateTime _from;
  late DateTime _to;
  List<ExpenseRow> _rows = const [];
  ExpenseTotals _totals = ExpenseTotals.zero;
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  final Set<String> _busy = {};

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _from = DateTime(now.year, now.month, 1);
    _to = dateOnly(now);
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _rows.isEmpty;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson(expensesPath(status: _status, from: _from, to: _to));
      if (!mounted) return;
      setState(() {
        _rows = expenseRows(body['expenses']);
        _totals = ExpenseTotals.fromJson(body['totals']);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not reach the server.'; _loading = false; });
    }
  }

  Future<void> _submitNew() async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => EmployeeExpenseFormScreen(session: widget.session, pickReceipt: widget.pickReceipt)));
    if (mounted) _load();
  }

  Future<void> _act(ExpenseRow r, String action) async {
    if (_busy.contains(r.id)) return;
    String? text;
    if (action == 'reject') {
      text = await showReasonSheet(context, title: 'Reject ${r.employeeName}\'s expense', confirmLabel: 'Reject expense');
      if (text == null || !mounted) return;
    } else if (action == 'reimburse') {
      text = await showReasonSheet(
        context,
        title: 'Reimburse ${inr(r.amount, maxFraction: 2)} to ${r.employeeName}',
        confirmLabel: 'Mark reimbursed',
        hint: 'Reimbursement reference (optional)',
      );
      if (text == null || !mounted) return;
    } else {
      final ok = await askSheet(
        context,
        title: action == 'approve' ? 'Approve expense?' : 'Cancel expense?',
        text: expenseAsk(action, employee: r.employeeName, amount: r.amount),
        confirmLabel: action == 'approve' ? 'Approve' : 'Cancel expense',
        cancelLabel: action == 'approve' ? 'Not now' : 'Keep it',
        danger: action != 'approve',
      );
      if (!ok || !mounted || _busy.contains(r.id)) return;
    }
    setState(() => _busy.add(r.id));
    try {
      await widget.session.api.patchJson(expensePath(r.id), expenseActionBody(action, text: text));
      if (mounted) {
        showKToast(
          context,
          switch (action) { 'approve' => 'Expense approved', 'reject' => 'Expense rejected', 'reimburse' => 'Marked reimbursed', _ => 'Expense cancelled' },
          tone: KTone.positive,
        );
      }
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not save. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy.remove(r.id));
    await _load();
  }

  Future<void> _voucher(ExpenseRow r) async {
    if (_busy.contains(r.id)) return;
    setState(() => _busy.add(r.id));
    try {
      final bytes = await widget.session.api.getBytes(expenseVoucherPdfPath(r.id));
      if (!mounted) return;
      await openPdfViewer(context, bytes, title: 'Expense voucher', fileName: 'Voucher-${r.id.substring(0, r.id.length < 8 ? r.id.length : 8)}.pdf');
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not open the voucher. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy.remove(r.id));
  }

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'Employee expenses',
      loading: _loading,
      error: _error,
      notInPlan: _notInPlan,
      onRetry: _load,
      emptyIcon: LucideIcons.receipt,
      emptyTitle: 'No expenses found',
      emptyBody: 'Nothing was submitted in this period.',
      fab: KFab(icon: LucideIcons.plus, label: 'Submit expense', onTap: _submitNew),
      header: [
        PayTotals(items: [
          ('Pending', inr(_totals.pending, maxFraction: 2)),
          ('Approved', inr(_totals.approved, maxFraction: 2)),
          ('Reimbursed', inr(_totals.reimbursed, maxFraction: 2)),
          ('Total', inr(_totals.total, maxFraction: 2)),
        ]),
        KChipBar<String>(
          value: _status,
          options: _statuses,
          padding: EdgeInsets.zero,
          onChanged: (v) {
            setState(() => _status = v);
            _load();
          },
        ),
        const SizedBox(height: AppSpace.sm),
        Row(children: [
          Expanded(
            child: KDateField(
              label: 'From',
              value: _from,
              onChanged: (d) {
                setState(() => _from = dateOnly(d));
                _load();
              },
            ),
          ),
          const SizedBox(width: AppSpace.sm),
          Expanded(
            child: KDateField(
              label: 'To',
              value: _to,
              onChanged: (d) {
                setState(() => _to = dateOnly(d));
                _load();
              },
            ),
          ),
        ]),
        const SizedBox(height: AppSpace.sm),
      ],
      rows: [for (final r in _rows) _row(r)],
    );
  }

  Widget _row(ExpenseRow r) {
    final busy = _busy.contains(r.id);
    return KCard(
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          KAvatar(name: r.employeeName, size: 36),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(r.employeeName, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
              Text([if (r.category != null) r.category!, if (r.date != null) dMMM(r.date!)].join(' · '), style: AppText.caption),
            ]),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            KAmount(r.amount, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            KPill(label: expenseStatusLabel(r.status), tone: payStatusTone(r.status)),
          ]),
        ]),
        if (r.description.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(r.description, style: AppText.body)),
        if (r.vendor != null) Text('Vendor: ${r.vendor}', style: AppText.caption),
        if (r.hasReceipt) Text('Bill attached', style: AppText.caption),
        if (r.status == 'rejected' && r.rejectionReason != null) Text('Rejected: ${r.rejectionReason}', style: AppText.caption.copyWith(color: AppColors.negative)),
        if (r.approverName != null && r.status != 'pending') Text('By ${r.approverName}', style: AppText.caption),
        const SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          if (r.status == 'pending') PayRowButton(label: 'Approve', busy: busy, onTap: () => _act(r, 'approve')),
          if (r.status == 'pending') PayRowButton(label: 'Reject', danger: true, onTap: busy ? null : () => _act(r, 'reject')),
          if (r.status == 'approved') PayRowButton(label: 'Reimburse', busy: busy, onTap: () => _act(r, 'reimburse')),
          if (r.status == 'pending' || r.status == 'approved') PayRowButton(label: 'Cancel', onTap: busy ? null : () => _act(r, 'cancel')),
          PayRowButton(label: 'Voucher', onTap: busy ? null : () => _voucher(r)),
        ]),
      ]),
    );
  }
}

const _modes = [('cash', 'Cash'), ('card', 'Card'), ('upi', 'UPI'), ('bank_transfer', 'Bank transfer'), ('other', 'Other')];

/// Website `/employees/expenses/new`: submit an expense for an employee, with the bill photo. The bill
/// is uploaded first (`/api/upload/image`) and goes in the body as `receipt_url`, as on the website.
class EmployeeExpenseFormScreen extends StatefulWidget {
  const EmployeeExpenseFormScreen({super.key, required this.session, this.pickReceipt});

  final AppSession session;
  final Future<PickedReceipt?> Function()? pickReceipt;

  @override
  State<EmployeeExpenseFormScreen> createState() => _EmployeeExpenseFormScreenState();
}

class _EmployeeExpenseFormScreenState extends State<EmployeeExpenseFormScreen> {
  String _employeeId = '';
  String? _employeeName;
  String _categoryId = '';
  List<(String, String)> _categories = const [];
  DateTime _date = dateOnly(DateTime.now());
  final _amount = TextEditingController();
  final _description = TextEditingController();
  final _vendor = TextEditingController();
  final _project = TextEditingController();
  String _mode = '';
  String _receiptUrl = '';
  String? _receiptName;
  bool _uploading = false;
  bool _billable = false;
  String _customerId = '';
  String? _customerName;

  @override
  void initState() {
    super.initState();
    _amount.addListener(_refresh);
    _loadCategories();
  }

  @override
  void dispose() {
    for (final c in [_amount, _description, _vendor, _project]) {
      c.dispose();
    }
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Future<void> _loadCategories() async {
    try {
      final body = await widget.session.api.getJson('/api/expense-categories');
      final list = body['categories'];
      if (!mounted || list is! List) return;
      setState(() {
        _categories = [
          for (final c in list)
            if (c is Map && c['id'] != null) (c['id'].toString(), (c['category_name'] ?? c['name'] ?? '').toString()),
        ];
      });
    } catch (_) {
      // Category is optional on the website too.
    }
  }

  Future<void> _addBill() async {
    if (_uploading) return;
    final picked = await (widget.pickReceipt ?? () => pickReceiptFromPhone(context))();
    if (picked == null || !mounted) return;
    final problem = receiptProblem(name: picked.name, size: picked.bytes.length);
    if (problem != null) {
      showKToast(context, problem, tone: KTone.negative);
      return;
    }
    setState(() => _uploading = true);
    try {
      final res = await widget.session.api.uploadImage('/api/upload/image', bytes: picked.bytes, fileName: picked.name, fields: const {'folder': 'expense_receipts'});
      final url = res['url']?.toString() ?? '';
      if (url.isEmpty) throw ApiException('Upload failed');
      if (mounted) {
        setState(() {
          _receiptUrl = url;
          _receiptName = picked.name;
        });
      }
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Failed to upload the bill. Please try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  bool get _ready => _employeeId.isNotEmpty && (double.tryParse(_amount.text.trim()) ?? 0) > 0 && _description.text.trim().isNotEmpty && !_uploading;

  Future<void> _submit() async {
    if (!_ready) return;
    await widget.session.api.postJson(
      '/api/employees/expenses',
      expenseBody(
        employeeId: _employeeId,
        categoryId: _categoryId,
        date: _date,
        amount: _amount.text,
        description: _description.text,
        paymentMode: _mode,
        vendor: _vendor.text,
        receiptUrl: _receiptUrl,
        billable: _billable,
        billableCustomer: _customerId,
        billableProject: _project.text,
      ),
    );
    if (!mounted) return;
    showKToast(context, 'Expense submitted', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Submit expense',
      saveLabel: 'Submit expense',
      dirty: _employeeId.isNotEmpty || _amount.text.isNotEmpty || _description.text.isNotEmpty,
      canSave: _ready,
      onSave: _submit,
      children: [
        KAsyncPickField(
          label: 'Employee',
          valueLabel: _employeeName,
          search: (q) => searchEmployees(widget.session.api, q),
          onPicked: (id, label) => setState(() {
            _employeeId = id;
            _employeeName = label;
          }),
        ),
        if (_categories.isNotEmpty)
          KPickField<String>(
            label: 'Category (optional)',
            value: _categoryId.isEmpty ? null : _categoryId,
            options: _categories,
            onChanged: (v) => setState(() => _categoryId = v),
          ),
        KDateField(label: 'Expense date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        KAmountField(label: 'Amount', controller: _amount),
        KPickField<String>(label: 'Payment mode', value: _mode.isEmpty ? null : _mode, options: _modes, onChanged: (v) => setState(() => _mode = v)),
        KTextField(label: 'Vendor name (optional)', controller: _vendor),
        KTextField(label: 'Description', controller: _description, maxLines: 4, minLines: 2, hint: 'Enter expense description...', onChanged: (_) => setState(() {})),
        KCard(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Bill (optional)', style: AppText.label),
            const SizedBox(height: 4),
            Text(_receiptName ?? 'JPG, PNG or PDF, up to 5MB.', style: AppText.caption),
            const SizedBox(height: 8),
            Wrap(spacing: 12, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
              KButton.secondary(label: _receiptUrl.isEmpty ? 'Add bill photo' : 'Replace bill', icon: LucideIcons.camera, expand: false, loading: _uploading, onPressed: _uploading ? null : _addBill),
              if (_receiptUrl.isNotEmpty) KTextButton(label: 'Remove', onTap: () => setState(() { _receiptUrl = ''; _receiptName = null; })),
            ]),
          ]),
        ),
        KToggleField(label: 'Billable to a customer or project', value: _billable, onChanged: (v) => setState(() => _billable = v)),
        if (_billable) ...[
          KAsyncPickField(
            label: 'Billable to customer (optional)',
            valueLabel: _customerName,
            search: (q) => searchCustomers(widget.session.api, q),
            onPicked: (id, label) => setState(() {
              _customerId = id;
              _customerName = label;
            }),
          ),
          KTextField(label: 'Billable to project (optional)', controller: _project),
        ],
      ],
    );
  }
}
