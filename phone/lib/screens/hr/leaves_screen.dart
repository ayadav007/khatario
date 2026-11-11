import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../sales/doc_action_sheets.dart';
import '../pages/website_page_screen.dart';
import 'attendance_leave_logic.dart';
import 'leave_calendar_screen.dart';
import 'leave_form_screen.dart';
import 'leave_logic.dart';

/// Website `/employees/leaves`: leave requests, with Approve / Reject on pending ones. Applying for
/// someone, the team calendar and balances open from the bar. Cancel (pending or approved, as on
/// the website) and Delete (pending) are row actions that ask first. What stays on the website is one
/// row at the foot of the list: the date-range filter.
class LeavesScreen extends StatefulWidget {
  const LeavesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<LeavesScreen> createState() => _LeavesScreenState();
}

class _LeavesScreenState extends State<LeavesScreen> {
  String _filter = 'pending';
  List<LeaveRow> _rows = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  final Set<String> _busy = {};
  HrAccess _access = HrAccess.open;

  @override
  void initState() {
    super.initState();
    _load();
    loadHrAccess(widget.session).then((a) {
      if (mounted) setState(() => _access = a);
    });
  }

  void _open(Widget screen) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen)).then((_) {
      if (mounted) _load();
    });
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final status = _filter == 'all' ? '' : '?status=$_filter';
      final body = await widget.session.api.getJson('/api/employees/leave-requests$status');
      if (!mounted) return;
      setState(() {
        _rows = leaveRows(body['requests']);
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

  void _setFilter(String filter) {
    if (filter == _filter) return;
    setState(() => _filter = filter);
    _load();
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _act(LeaveRow row, String action) async {
    String? reason;
    if (action == 'reject') {
      reason = await showReasonSheet(context, title: 'Reject ${row.employeeName}\'s leave', confirmLabel: 'Reject leave');
      if (reason == null || !mounted) return;
    }
    setState(() => _busy.add(row.id));
    try {
      await widget.session.api.patchJson('/api/employees/leave-requests/${row.id}', {
        'action': action,
        if (reason != null && reason.isNotEmpty) 'rejection_reason': reason,
      });
      if (!mounted) return;
      _toast(action == 'approve' ? 'Leave approved' : 'Leave rejected');
      await _load();
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    } catch (_) {
      if (mounted) _toast('Could not save. Try again.');
    } finally {
      if (mounted) setState(() => _busy.remove(row.id));
    }
  }

  /// Cancel (`PATCH {action: 'cancel'}`) or Delete (`DELETE`) after asking, naming the employee and dates.
  Future<void> _cancelOrDelete(LeaveRow row, {required bool delete}) async {
    if (_busy.contains(row.id)) return;
    final what = '${row.employeeName}\'s ${row.leaveName} leave on ${leaveDates(row)}';
    final ok = await askSheet(
      context,
      title: delete ? 'Delete leave request?' : 'Cancel leave?',
      text: delete ? 'Delete $what? This cannot be undone.' : 'Cancel $what?',
      confirmLabel: delete ? 'Delete' : 'Cancel leave',
      cancelLabel: 'Keep it',
    );
    if (!ok || !mounted || _busy.contains(row.id)) return;
    setState(() => _busy.add(row.id));
    try {
      final api = widget.session.api;
      if (delete) {
        await api.deleteJson('/api/employees/leave-requests/${row.id}');
      } else {
        await api.patchJson('/api/employees/leave-requests/${row.id}', {'action': 'cancel'});
      }
      if (mounted) showKToast(context, delete ? 'Leave request deleted' : 'Leave cancelled', tone: KTone.positive);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not save. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy.remove(row.id));
    // Reload either way: after a refusal the list may already have moved on.
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(
              'Leaves',
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                if (_access.has('leave_requests', 'create'))
                  KIconButton(icon: LucideIcons.plus, tooltip: 'Apply leave', onTap: () => _open(LeaveFormScreen(session: widget.session))),
                KIconButton(icon: LucideIcons.calendarDays, tooltip: 'Leave calendar', onTap: () => _open(LeaveCalendarScreen(session: widget.session))),
                KIconButton(icon: LucideIcons.wallet, tooltip: 'Leave balances', onTap: () => _open(LeaveBalancesScreen(session: widget.session))),
              ]),
            ),
            KChipBar<String>(
              value: _filter,
              options: const [('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected'), ('all', 'All')],
              onChanged: _setFilter,
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
          title: _notInPlan ? 'Not included in your current plan' : 'Could not load leave requests',
          body: _error,
          action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          if (_rows.isEmpty)
            KEmptyState(
              icon: LucideIcons.calendarCheck,
              title: _filter == 'pending' ? 'No leave waiting for you' : 'No leave requests',
              body: _filter == 'pending' ? 'New requests from staff show up here.' : null,
            )
          else
            KCard(child: KDivided(indent: 0, children: [for (final row in _rows) _row(row)])),
          const SizedBox(height: AppSpace.lg),
          KCard(
            child: KListRow(
              title: 'Open on website',
              subtitle: 'Filter by dates',
              leading: const Icon(LucideIcons.globe, size: 22, color: AppColors.ink2),
              onTap: () => openWebsiteInApp(context, widget.session, '/employees/leaves', 'Leaves'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(LeaveRow row) {
    final busy = _busy.contains(row.id);
    final tone = switch (row.status) {
      'approved' => KTone.positive,
      'rejected' || 'cancelled' => KTone.negative,
      'pending' => KTone.due,
      _ => KTone.neutral,
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(row.employeeName, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                Text('${row.leaveName} · ${leaveDates(row)} · ${leaveDays(row.days)}', style: AppText.caption),
              ]),
            ),
            KPill(label: leaveStatusLabel(row.status), tone: tone),
          ]),
          if (row.reason != null) ...[
            const SizedBox(height: 6),
            Text(row.reason!, style: AppText.body.copyWith(color: AppColors.ink2)),
          ],
          if (row.rejectionReason != null && row.status == 'rejected') ...[
            const SizedBox(height: 4),
            Text('Reason: ${row.rejectionReason}', style: AppText.caption),
          ],
          if (row.isPending) ...[
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: KButton(label: 'Approve', height: 40, loading: busy, onPressed: busy ? null : () => _act(row, 'approve'))),
              const SizedBox(width: AppSpace.sm),
              Expanded(
                child: KButton(label: 'Reject', height: 40, kind: KButtonKind.secondary, onPressed: busy ? null : () => _act(row, 'reject')),
              ),
            ]),
          ],
          if (row.isPending || row.status == 'approved')
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(children: [
                KTextButton(label: 'Cancel request', onTap: busy ? null : () => _cancelOrDelete(row, delete: false)),
                const Spacer(),
                if (row.isPending) KTextButton(label: 'Delete', color: AppColors.negative, onTap: busy ? null : () => _cancelOrDelete(row, delete: true)),
              ]),
            ),
        ],
      ),
    );
  }
}
