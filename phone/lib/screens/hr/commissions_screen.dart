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
import 'pay_widgets.dart';
import 'targets_screen.dart';

const _statuses = [
  ('all', 'All'),
  ('pending', 'Pending'),
  ('approved', 'Approved'),
  ('paid', 'Paid'),
  ('cancelled', 'Cancelled'),
];

/// Website `/employees/commissions`: commissions earned on invoices for a date range, with Approve,
/// Pay and Cancel. Each asks first, naming the employee and the amount on the record. The website
/// does not add commissions by hand (they are earned from invoices and the commission rules), so
/// neither does the phone; targets open from the bar when the plan has them.
class CommissionsScreen extends StatefulWidget {
  const CommissionsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<CommissionsScreen> createState() => _CommissionsScreenState();
}

class _CommissionsScreenState extends State<CommissionsScreen> {
  String _status = 'all';
  late DateTime _from;
  late DateTime _to;
  List<CommissionRow> _rows = const [];
  CommissionTotals _totals = CommissionTotals.zero;
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  final Set<String> _busy = {};
  HrAccess _access = HrAccess.open;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _from = DateTime(now.year, now.month, 1);
    _to = dateOnly(now);
    _load();
    loadHrAccess(widget.session).then((a) {
      if (mounted) setState(() => _access = a);
    });
  }

  Future<void> _load() async {
    setState(() {
      _loading = _rows.isEmpty;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson(commissionsPath(status: _status, from: _from, to: _to));
      if (!mounted) return;
      setState(() {
        _rows = commissionRows(body['commissions']);
        _totals = CommissionTotals.fromJson(body['totals']);
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

  Future<void> _act(CommissionRow r, String action) async {
    if (_busy.contains(r.id)) return;
    final ok = await askSheet(
      context,
      title: switch (action) { 'pay' => 'Pay commission?', 'cancel' => 'Cancel commission?', _ => 'Approve commission?' },
      text: commissionAsk(action, employee: r.employeeName, amount: r.amount),
      confirmLabel: switch (action) { 'pay' => 'Pay', 'cancel' => 'Cancel commission', _ => 'Approve' },
      cancelLabel: action == 'cancel' ? 'Keep it' : 'Not now',
      danger: action == 'cancel',
    );
    if (!ok || !mounted || _busy.contains(r.id)) return;
    setState(() => _busy.add(r.id));
    try {
      await widget.session.api.postJson('/api/employees/commissions', commissionActionBody(r.id, action));
      if (mounted) {
        showKToast(context, switch (action) { 'pay' => 'Commission paid', 'cancel' => 'Commission cancelled', _ => 'Commission approved' }, tone: KTone.positive);
      }
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not save. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy.remove(r.id));
    await _load();
  }

  Future<void> _openTargets() => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TargetsScreen(session: widget.session)));

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'Commissions',
      loading: _loading,
      error: _error,
      notInPlan: _notInPlan,
      onRetry: _load,
      emptyIcon: LucideIcons.percent,
      emptyTitle: 'No commissions found',
      emptyBody: 'Commissions appear here as employees make sales.',
      trailing: _access.has('hr_advanced') ? KIconButton(icon: LucideIcons.target, tooltip: 'Targets', onTap: _openTargets) : null,
      header: [
        PayTotals(items: [
          ('Pending', inr(_totals.pending, maxFraction: 2)),
          ('Approved', inr(_totals.approved, maxFraction: 2)),
          ('Paid', inr(_totals.paid, maxFraction: 2)),
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

  Widget _row(CommissionRow r) {
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
              Text([if (r.invoiceNumber != null) r.invoiceNumber!, if (r.invoiceDate != null) dMMM(r.invoiceDate!)].join(' · '), style: AppText.caption),
            ]),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            KAmount(r.amount, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            KPill(label: commissionStatusLabel(r.status), tone: payStatusTone(r.status)),
          ]),
        ]),
        const SizedBox(height: 8),
        Text('Sale ${inr(r.saleAmount, maxFraction: 2)} at ${jsNumberString(r.rate)}%', style: AppText.caption),
        if (r.status == 'pending' || r.status == 'approved') ...[
          const SizedBox(height: 10),
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (r.status == 'pending') PayRowButton(label: 'Approve', busy: busy, onTap: () => _act(r, 'approve')),
            if (r.status == 'approved') PayRowButton(label: 'Pay', busy: busy, onTap: () => _act(r, 'pay')),
            PayRowButton(label: 'Cancel', danger: true, onTap: busy ? null : () => _act(r, 'cancel')),
          ]),
        ],
      ]),
    );
  }
}
