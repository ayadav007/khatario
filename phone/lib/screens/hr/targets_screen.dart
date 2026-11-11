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

/// Website `/employees/targets`: sales targets per employee and period, with set / update and delete.
/// Needs the plan's advanced HR; the server says `FEATURE_NOT_IN_PLAN` otherwise and this shows it.
class TargetsScreen extends StatefulWidget {
  const TargetsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<TargetsScreen> createState() => _TargetsScreenState();
}

class _TargetsScreenState extends State<TargetsScreen> {
  List<TargetRow> _rows = const [];
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
      final body = await widget.session.api.getJson(targetsPath);
      if (!mounted) return;
      setState(() {
        _rows = targetRows(body['targets']);
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

  Future<void> _edit([TargetRow? target]) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TargetFormScreen(session: widget.session, target: target)));
    if (mounted) _load();
  }

  Future<void> _delete(TargetRow r) async {
    if (_busy.contains(r.id)) return;
    final ok = await askSheet(
      context,
      title: 'Delete target?',
      text: 'Delete ${r.employeeName}\'s ${targetPeriodLabel(r)} target of ${inr(r.amount, maxFraction: 2)}? This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
    );
    if (!ok || !mounted || _busy.contains(r.id)) return;
    setState(() => _busy.add(r.id));
    try {
      await widget.session.api.deleteJson(targetPath(r.id));
      if (mounted) showKToast(context, 'Target deleted', tone: KTone.positive);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not delete. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy.remove(r.id));
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'Targets',
      loading: _loading,
      error: _error,
      notInPlan: _notInPlan,
      onRetry: _load,
      emptyIcon: LucideIcons.target,
      emptyTitle: 'No targets set',
      emptyBody: 'Set a sales target for an employee and it shows up here.',
      fab: KFab(icon: LucideIcons.plus, label: 'Set target', onTap: _edit),
      rows: [
        for (final r in _rows)
          KCard(
            padding: const EdgeInsets.all(14),
            child: InkWell(
              onTap: () => _edit(r),
              child: Row(children: [
                KAvatar(name: r.employeeName, size: 36),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(r.employeeName, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                    Text(targetPeriodLabel(r), style: AppText.caption),
                    Text('${r.period}${r.invoices != null ? ' · ${r.invoices} invoices' : ''}', style: AppText.caption),
                  ]),
                ),
                KAmount(r.amount, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                KIconButton(icon: LucideIcons.trash2, tooltip: 'Delete target', onTap: _busy.contains(r.id) ? () {} : () => _delete(r)),
              ]),
            ),
          ),
      ],
    );
  }
}

const _periods = [('monthly', 'Monthly'), ('quarterly', 'Quarterly'), ('yearly', 'Yearly')];
const _monthLabels = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/// Set or update one target (`POST /api/employees/targets`; the server updates an existing one for
/// the same employee and period).
class TargetFormScreen extends StatefulWidget {
  const TargetFormScreen({super.key, required this.session, this.target});

  final AppSession session;
  final TargetRow? target;

  @override
  State<TargetFormScreen> createState() => _TargetFormScreenState();
}

class _TargetFormScreenState extends State<TargetFormScreen> {
  late String _employeeId = widget.target?.employeeId ?? '';
  late String? _employeeName = widget.target?.employeeName;
  late String _period = widget.target?.period ?? 'monthly';
  late int _year = widget.target?.year ?? DateTime.now().year;
  late int _month = widget.target?.month ?? DateTime.now().month;
  late final _amount = TextEditingController(text: widget.target == null ? '' : widget.target!.amount.toString());
  late final _invoices = TextEditingController(text: widget.target?.invoices?.toString() ?? '');

  @override
  void initState() {
    super.initState();
    _amount.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _amount.dispose();
    _invoices.dispose();
    super.dispose();
  }

  bool get _ready => _employeeId.isNotEmpty && (double.tryParse(_amount.text.trim()) ?? 0) > 0;

  Future<void> _save() async {
    if (!_ready) return;
    await widget.session.api.postJson(
      targetsPath,
      targetBody(employeeId: _employeeId, period: _period, year: _year, month: _month, amount: _amount.text, invoices: _invoices.text),
    );
    if (!mounted) return;
    showKToast(context, 'Target saved', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final thisYear = DateTime.now().year;
    return KFormScaffold(
      title: widget.target == null ? 'Set target' : 'Edit target',
      saveLabel: 'Save target',
      dirty: _employeeId.isNotEmpty && widget.target == null || _amount.text.isNotEmpty,
      canSave: _ready,
      onSave: _save,
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
        KPickField<String>(label: 'Period', value: _period, options: _periods, onChanged: (v) => setState(() => _period = v)),
        KPickField<int>(label: 'Year', value: _year, options: [for (var y = thisYear - 1; y <= thisYear + 2; y++) (y, '$y')], onChanged: (v) => setState(() => _year = v)),
        if (_period == 'monthly')
          KPickField<int>(label: 'Month', value: _month, options: [for (var m = 1; m <= 12; m++) (m, _monthLabels[m - 1])], onChanged: (v) => setState(() => _month = v)),
        KAmountField(label: 'Target amount', controller: _amount),
        KTextField(label: 'Target invoices (optional)', controller: _invoices, keyboard: TextInputType.number),
      ],
    );
  }
}
