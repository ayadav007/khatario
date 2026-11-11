import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'attendance_leave_logic.dart';
import 'leave_logic.dart';

/// Website `/employees/leaves/new`: apply for leave on someone's behalf. Employee, leave type and
/// dates are chosen; the days (sandwich days included) and the balance come from the server each
/// time one of them changes. The website has no half-day option, so neither does this form.
class LeaveFormScreen extends StatefulWidget {
  const LeaveFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<LeaveFormScreen> createState() => _LeaveFormScreenState();
}

class _LeaveFormScreenState extends State<LeaveFormScreen> {
  List<LeaveTypeOption> _types = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;

  String _employeeId = '';
  String? _employeeName;
  String? _typeId;
  DateTime? _start;
  DateTime? _end;
  final _reason = TextEditingController();
  final _link = TextEditingController();

  LeavePreview? _preview;
  LeaveBalanceRow? _balance;
  bool _checking = false;
  String? _checkError;
  int _ticket = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reason.dispose();
    _link.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson('/api/leave-types?active_only=true');
      if (!mounted) return;
      setState(() {
        _types = leaveTypeOptions(body['leave_types']);
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

  bool get _ready =>
      _employeeId.isNotEmpty && _typeId != null && _start != null && _end != null && !_start!.isAfter(_end!);

  /// Asks the server for the days and the balance whenever the person, type or dates change.
  /// Only the newest answer is kept.
  Future<void> _refresh() async {
    final ticket = ++_ticket;
    if (!_ready) {
      setState(() {
        _preview = null;
        _balance = null;
        _checking = false;
        _checkError = null;
      });
      return;
    }
    final typeId = _typeId!, employeeId = _employeeId, start = _start!, end = _end!;
    setState(() {
      _preview = null;
      _balance = null;
      _checking = true;
      _checkError = null;
    });
    try {
      final api = widget.session.api;
      // Both questions go out together; only the newest pair of answers is kept (the ticket below).
      final answers = await Future.wait<Map<String, dynamic>>([
        api.getJson(leavePreviewPath(start: start, end: end, typeId: typeId)),
        api.getJson(leaveBalancePath(employeeId, start.year)),
      ]);
      final preview = LeavePreview.fromJson(answers[0]);
      final balances = leaveBalances(answers[1]['balances']);
      if (!mounted || ticket != _ticket) return;
      setState(() {
        _preview = preview;
        // No row for the type means no balance, as on the website.
        _balance = balanceFor(balances, typeId) ??
            const LeaveBalanceRow(typeId: '', name: '', code: '', current: 0, opening: 0, earned: 0, used: 0, carryForward: 0);
        _checking = false;
      });
    } on ApiException catch (e) {
      if (!mounted || ticket != _ticket) return;
      setState(() {
        _checkError = e.message;
        _checking = false;
      });
    } catch (_) {
      if (mounted && ticket == _ticket) setState(() { _checkError = 'Could not check the days. Try again.'; _checking = false; });
    }
  }

  bool get _sufficient => _preview != null && _balance != null && _balance!.current >= _preview!.totalDays;

  Future<void> _submit() async {
    if (!_ready || !_sufficient) return;
    await widget.session.api.postJson(
      '/api/employees/leave-requests',
      leaveRequestBody(employeeId: _employeeId, typeId: _typeId!, start: _start!, end: _end!, reason: _reason.text, attachmentUrl: _link.text),
    );
    if (!mounted) return;
    showKToast(context, 'Leave requested', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _error != null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const KBackBar('Request leave'),
            Expanded(
              child: _loading
                  ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
                  : ListView(children: [
                      KEmptyState(
                        icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
                        title: _notInPlan ? 'Not included in your current plan' : 'Could not load leave types',
                        body: _error,
                        action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
                      ),
                    ]),
            ),
          ]),
        ),
      );
    }
    final backwards = _start != null && _end != null && _start!.isAfter(_end!);
    return KFormScaffold(
      title: 'Request leave',
      saveLabel: 'Submit request',
      dirty: _employeeId.isNotEmpty || _typeId != null || _start != null || _end != null || _reason.text.isNotEmpty,
      canSave: _ready && _sufficient,
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
            _refresh();
          },
        ),
        KPickField<String>(
          label: 'Leave type',
          value: _typeId,
          options: [for (final t in _types) (t.id, t.label)],
          onChanged: (v) {
            setState(() => _typeId = v);
            _refresh();
          },
        ),
        KDateField(
          label: 'Start date',
          value: _start,
          onChanged: (d) {
            setState(() => _start = dateOnly(d));
            _refresh();
          },
        ),
        KDateField(
          label: 'End date',
          value: _end,
          initial: _start,
          onChanged: (d) {
            setState(() => _end = dateOnly(d));
            _refresh();
          },
        ),
        if (backwards) Text('End date must be after start date', style: AppText.caption.copyWith(color: AppColors.negative)),
        if (_checking) const KSpinner(padding: EdgeInsets.symmetric(vertical: 12), size: 20),
        if (_checkError != null)
          Text(_checkError!, style: AppText.caption.copyWith(color: AppColors.negative)),
        if (_preview != null && _balance != null) _summary(_preview!, _balance!),
        KTextField(label: 'Reason (optional)', controller: _reason, maxLines: 4, minLines: 2, hint: 'Enter reason for leave...', onChanged: (_) => setState(() {})),
        KTextField(label: 'Attachment URL (if required by policy)', controller: _link, keyboard: TextInputType.url, hint: 'https://…'),
      ],
    );
  }

  Widget _summary(LeavePreview preview, LeaveBalanceRow balance) {
    final ok = balance.current >= preview.totalDays;
    final tone = ok ? KTone.positive : KTone.negative;
    return KCard(
      padding: const EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Leave days (incl. sandwich)', style: AppText.caption),
              Text(preview.daysLine, style: AppText.heading),
              if (preview.sandwichDays > 0) Text('Includes ${jsNumberString(preview.sandwichDays)} sandwich day(s)', style: AppText.caption),
            ]),
          ),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(AppRadius.sm)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Available balance', style: AppText.caption),
              Text(leaveDays(balance.current), style: AppText.bodyStrong.copyWith(color: tone.fg)),
              if (!ok) Text('Insufficient balance', style: AppText.small.copyWith(color: tone.fg)),
            ]),
          ),
        ],
      ),
    );
  }
}
