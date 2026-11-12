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
import 'pay_logic.dart';
import 'pay_widgets.dart';

const _statuses = [
  ('all', 'All'),
  ('pending', 'Pending'),
  ('approved', 'Approved'),
  ('rejected', 'Rejected'),
  ('partially_recovered', 'Partially recovered'),
  ('recovered', 'Recovered'),
];

/// Website `/employees/salary/advances`: advances with Approve and Reject on pending ones, and
/// "Request advance". Approving posts to the books, so it asks first, naming the employee and the
/// amount on the record. The phone shows the server's amounts and statuses.
class SalaryAdvancesScreen extends StatefulWidget {
  const SalaryAdvancesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<SalaryAdvancesScreen> createState() => _SalaryAdvancesScreenState();
}

class _SalaryAdvancesScreenState extends State<SalaryAdvancesScreen> {
  String _status = 'all';
  List<AdvanceRow> _rows = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  final Set<String> _busy = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _rows.isEmpty;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson(advancesPath(_status));
      if (!mounted) return;
      setState(() {
        _rows = advanceRows(body['advances']);
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

  Future<void> _request() async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SalaryAdvanceFormScreen(session: widget.session)));
    if (mounted) _load();
  }

  Future<void> _approve(AdvanceRow r) async {
    if (_busy.contains(r.id)) return;
    final ok = await askSheet(
      context,
      title: 'Approve advance?',
      text: advanceApproveAsk(employee: r.employeeName, amount: r.amount),
      confirmLabel: 'Approve',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!ok || !mounted || _busy.contains(r.id)) return;
    await _patch(r, advanceDecisionBody(), 'Advance approved');
  }

  Future<void> _reject(AdvanceRow r) async {
    if (_busy.contains(r.id)) return;
    final reason = await showReasonSheet(context, title: 'Reject ${r.employeeName}\'s advance', confirmLabel: 'Reject advance', hint: 'Reason (required)');
    if (reason == null || !mounted) return;
    if (reason.isEmpty) {
      showKToast(context, 'Enter a rejection reason', tone: KTone.negative);
      return;
    }
    await _patch(r, advanceDecisionBody(rejectionReason: reason), 'Advance rejected');
  }

  Future<void> _patch(AdvanceRow r, Map<String, dynamic> body, String done) async {
    setState(() => _busy.add(r.id));
    try {
      await widget.session.api.patchJson(advanceApprovePath(r.id), body);
      if (mounted) showKToast(context, done, tone: KTone.positive);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not save. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy.remove(r.id));
    // Reload either way: after a refusal the record may already have moved on.
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'Salary advances',
      loading: _loading,
      error: _error,
      notInPlan: _notInPlan,
      onRetry: _load,
      emptyIcon: LucideIcons.handCoins,
      emptyTitle: 'No salary advances found',
      emptyBody: 'Request an advance and it shows up here.',
      fab: KFab(icon: LucideIcons.plus, label: 'Request advance', onTap: _request),
      header: [
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
      ],
      rows: [for (final r in _rows) _row(r)],
    );
  }

  Widget _row(AdvanceRow r) {
    return KCard(
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          KAvatar(name: r.employeeName, size: 36),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(r.employeeName, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
              Text([if (r.code != null) r.code!, if (r.date != null) dMMM(r.date!)].join(' · '), style: AppText.caption),
            ]),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            KAmount(r.amount, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            KPill(label: advanceStatusLabel(r.status), tone: payStatusTone(r.status)),
          ]),
        ]),
        const SizedBox(height: 8),
        Text('Recovered ${inr(r.recovered, maxFraction: 2)} · Remaining ${inr(r.remaining, maxFraction: 2)}', style: AppText.caption),
        if (r.reason != null) Text(r.reason!, style: AppText.caption),
        if (r.status == 'pending') ...[
          const SizedBox(height: 10),
          Wrap(spacing: 8, children: [
            PayRowButton(label: 'Approve', busy: _busy.contains(r.id), onTap: () => _approve(r)),
            PayRowButton(label: 'Reject', danger: true, onTap: _busy.contains(r.id) ? null : () => _reject(r)),
          ]),
        ],
      ]),
    );
  }
}

/// Website `/employees/salary/advances/new`: request an advance for an employee. The employee's
/// pending advance balance comes from the server.
class SalaryAdvanceFormScreen extends StatefulWidget {
  const SalaryAdvanceFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<SalaryAdvanceFormScreen> createState() => _SalaryAdvanceFormScreenState();
}

class _SalaryAdvanceFormScreenState extends State<SalaryAdvanceFormScreen> {
  String _employeeId = '';
  String? _employeeName;
  final _amount = TextEditingController();
  final _reason = TextEditingController();
  final _months = TextEditingController();
  DateTime _date = dateOnly(DateTime.now());
  String _method = 'salary_deduction';
  AdvanceBalance? _balance;
  int _ticket = 0;

  @override
  void initState() {
    super.initState();
    _amount.addListener(_refresh);
  }

  @override
  void dispose() {
    _amount.dispose();
    _reason.dispose();
    _months.dispose();
    super.dispose();
  }

  Future<void> _loadBalance() async {
    final ticket = ++_ticket;
    setState(() => _balance = null);
    try {
      final b = AdvanceBalance.fromJson(await widget.session.api.getJson(advanceBalancePath(_employeeId)));
      if (mounted && ticket == _ticket) setState(() => _balance = b);
    } catch (_) {
      // The balance is a hint; the request can still be sent.
    }
  }

  bool get _ready => _employeeId.isNotEmpty && (double.tryParse(_amount.text.trim()) ?? 0) > 0 && _reason.text.trim().isNotEmpty;

  Future<void> _submit() async {
    if (!_ready) return;
    await widget.session.api.postJson(
      '/api/employees/salary/advances',
      advanceBody(employeeId: _employeeId, amount: _amount.text, date: _date, reason: _reason.text, method: _method, months: _months.text),
    );
    if (!mounted) return;
    showKToast(context, 'Advance requested', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final b = _balance;
    return KFormScaffold(
      title: 'Request advance',
      saveLabel: 'Submit request',
      dirty: _employeeId.isNotEmpty || _amount.text.isNotEmpty || _reason.text.isNotEmpty,
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
            });
            _loadBalance();
          },
        ),
        if (b != null && (b.pending > 0 || b.awaiting > 0))
          KCard(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (b.pending > 0) Text('Pending advance: ${inr(b.pending, maxFraction: 2)}', style: AppText.bodyStrong),
              if (b.awaiting > 0) Text('Waiting for approval: ${inr(b.awaiting, maxFraction: 2)}', style: AppText.caption),
            ]),
          ),
        KAmountField(label: 'Advance amount', controller: _amount),
        KDateField(label: 'Advance date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        KPickField<String>(
          label: 'Recovery method',
          value: _method,
          options: const [('salary_deduction', 'Recover from salary'), ('one_time_payment', 'One-time payment')],
          onChanged: (v) => setState(() => _method = v),
        ),
        if (_method == 'salary_deduction')
          KTextField(label: 'Recovery months (optional)', controller: _months, keyboard: TextInputType.number, hint: 'Leave empty to recover in the next salary'),
        KTextField(label: 'Reason', controller: _reason, maxLines: 4, minLines: 2, hint: 'Enter reason for the advance request...', onChanged: (_) => setState(() {})),
      ],
    );
  }

  void _refresh() {
    if (mounted) setState(() {});
  }
}
