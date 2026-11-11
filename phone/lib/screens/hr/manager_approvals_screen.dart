import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../sales/doc_action_sheets.dart';
import 'attendance_leave_logic.dart';
import 'hr_manage_logic.dart';
import 'hr_manage_widgets.dart';
import 'pay_logic.dart';
import 'pay_widgets.dart';

/// Website `/employees/manager/approvals`: everything waiting for the manager, one section per kind.
///
/// Leave, overtime, regularization and expenses have Approve and Reject (the reject takes a reason).
/// Steps in an approval chain (resignation, leave chain, overtime chain) have Approve and "Mark
/// pending" with a reason, as on the website, and a department head can grant an exception. Every
/// action asks first, posts once, shows the server's refusal and reloads.
class ManagerApprovalsScreen extends StatefulWidget {
  const ManagerApprovalsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ManagerApprovalsScreen> createState() => _ManagerApprovalsScreenState();
}

class _ManagerApprovalsScreenState extends State<ManagerApprovalsScreen> with HrScreenState<ManagerApprovalsScreen> {
  PendingApprovals _p = const PendingApprovals();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => guardedLoad(() async {
        try {
          final body = await widget.session.api.getJson(managerPendingPath);
          if (mounted) _p = PendingApprovals.fromJson(body);
        } on ApiException catch (e) {
          // The server answers 403 "No pending approvals for you" when nothing is waiting.
          if (e.status == 403 && e.code == null) {
            _p = const PendingApprovals();
          } else {
            rethrow;
          }
        }
      });

  Future<bool> _ask(String title, String text, String confirm, {bool danger = false}) =>
      askSheet(context, title: title, text: text, confirmLabel: confirm, cancelLabel: 'Not now', danger: danger);

  /// A reason sheet that must not be left blank. Returns null when closed or left empty.
  Future<String?> _reason(String title, String confirm, String hint, {required bool required}) async {
    final r = await showReasonSheet(context, title: title, confirmLabel: confirm, hint: hint);
    if (r == null || !mounted) return null;
    if (required && r.isEmpty) {
      toast('Give a reason first.');
      return null;
    }
    return r;
  }

  Future<void> _patch(String path, Map<String, dynamic> body) => widget.session.api.patchJson(path, body);

  // -- leave (direct reports) -------------------------------------------------------------------

  Future<void> _leave(PendingLeave l, {required bool approve}) async {
    String? reason;
    await act(
      'leave-${l.id}',
      confirm: () async {
        if (approve) return _ask('Approve leave?', 'Approve ${l.employeeName}\'s ${l.line}?', 'Approve');
        reason = await showReasonSheet(context, title: 'Reject ${l.employeeName}\'s leave', confirmLabel: 'Reject leave');
        return reason != null;
      },
      send: () => _patch(managerLeavePath(l.id), leaveDecisionBody(approve: approve, reason: reason)),
      done: approve ? 'Leave approved' : 'Leave rejected',
      reload: _load,
    );
  }

  Future<void> _overtime(PendingOvertime o, {required bool approve}) async {
    String? reason;
    await act(
      'ot-${o.id}',
      confirm: () async {
        if (approve) return _ask('Approve overtime?', 'Approve ${o.employeeName}\'s overtime (${o.line})?', 'Approve');
        reason = await showReasonSheet(context, title: 'Reject ${o.employeeName}\'s overtime', confirmLabel: 'Reject overtime');
        return reason != null;
      },
      send: () => _patch(overtimePath(o.id), overtimeDecisionBody(approve: approve, reason: reason)),
      done: approve ? 'Overtime approved' : 'Overtime rejected',
      reload: _load,
    );
  }

  Future<void> _regularization(RegularizationAsk r, {required bool approve}) async {
    final date = r.date == null ? '' : ' for ${ddMMMyyyy(r.date!)}';
    String? reason;
    await act(
      'reg-${r.id}',
      confirm: () async {
        if (approve) {
          return _ask('Approve request?', 'Approve ${r.employeeName}\'s ${regularizationTypeLabel(r.type).toLowerCase()} request$date?', 'Approve');
        }
        reason = await showReasonSheet(context, title: 'Reject ${r.employeeName}\'s request$date', confirmLabel: 'Reject request');
        return reason != null;
      },
      send: () => _patch('/api/employees/manager/attendance-regularization/${r.id}', regularizationDecisionBody(approve: approve, reason: reason)),
      done: approve ? 'Regularization approved' : 'Regularization rejected',
      reload: _load,
    );
  }

  Future<void> _expense(PendingExpense x, {required bool approve}) async {
    String? reason;
    await act(
      'exp-${x.id}',
      confirm: () async {
        if (approve) return _ask('Approve expense?', expenseAsk('approve', employee: x.employeeName, amount: x.amount), 'Approve');
        reason = await showReasonSheet(context, title: 'Reject ${x.employeeName}\'s expense', confirmLabel: 'Reject expense');
        return reason != null;
      },
      send: () => _patch(expensePath(x.id), expenseActionBody(approve ? 'approve' : 'reject', text: reason)),
      done: approve ? 'Expense approved' : 'Expense rejected',
      reload: _load,
    );
  }

  // -- chains -----------------------------------------------------------------------------------

  Future<void> _chain({
    required String key,
    required String path,
    required String action,
    required String title,
    required String question,
    required String done,
  }) async {
    String? hold;
    await act(
      key,
      confirm: () async {
        if (action == 'hold') {
          hold = await _reason(title, 'Mark pending', 'Reason (required)', required: true);
          return hold != null;
        }
        return _ask(title, question, action == 'grant_exception' ? 'Grant exception' : 'Approve');
      },
      send: () => _patch(path, chainBody(action, holdReason: hold)),
      done: done,
      reload: _load,
    );
  }

  // -- rows -------------------------------------------------------------------------------------

  Widget _head(String name, String line, {String? extra, Widget? pill}) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(name, style: AppText.bodyStrong)),
          ?pill,
        ]),
        if (line.isNotEmpty) Text(line, style: AppText.caption),
        if (extra != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(extra, style: AppText.body.copyWith(color: AppColors.ink2))),
      ]);

  Widget _buttons(String key, {required String yes, required VoidCallback onYes, String? no, VoidCallback? onNo}) {
    final b = busy.contains(key);
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(children: [
        Expanded(child: KButton(label: yes, height: 40, loading: b, onPressed: b ? null : onYes)),
        if (no != null) ...[
          const SizedBox(width: AppSpace.sm),
          Expanded(child: KButton(label: no, height: 40, kind: KButtonKind.secondary, onPressed: b ? null : onNo)),
        ],
      ]),
    );
  }

  Widget _card(List<Widget> rows) => KCard(child: KDivided(indent: 0, children: rows));

  Widget _pad(Widget child) => Padding(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12), child: child);

  Widget _section(String title, List<Widget> rows) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        KSectionHeader(title),
        _card(rows),
      ]);

  List<Widget> _sections() {
    final p = _p;
    return [
      if (p.regularizations.isNotEmpty)
        _section('Attendance regularization', [
          for (final r in p.regularizations)
            _pad(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _head(r.employeeName, r.dateLine, extra: r.reason),
              Text(r.inLine, style: AppText.caption),
              Text(r.outLine, style: AppText.caption),
              _buttons('reg-${r.id}', yes: 'Approve', onYes: () => _regularization(r, approve: true), no: 'Reject', onNo: () => _regularization(r, approve: false)),
            ])),
        ]),
      if (p.exits.isNotEmpty)
        _section('Resignation approvals', [
          for (final x in p.exits)
            _pad(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _head(x.employeeName, '${x.stepLabel}${x.holdReason != null ? ' · Pending: ${x.holdReason}' : ''}',
                  extra: x.needsException ? 'Exception approval needed from department head' : null),
              if (x.needsException)
                _buttons('exit-${x.exitId}',
                    yes: 'Grant exception',
                    onYes: () => _chain(
                        key: 'exit-${x.exitId}', path: managerExitPath(x.exitId), action: 'grant_exception', title: 'Grant exception?',
                        question: 'Grant an exception for ${x.employeeName}\'s resignation?', done: 'Exception granted'))
              else
                _buttons('exit-${x.exitId}',
                    yes: 'Approve',
                    onYes: () => _chain(
                        key: 'exit-${x.exitId}', path: managerExitPath(x.exitId), action: 'approve', title: 'Approve resignation?',
                        question: 'Approve ${x.employeeName}\'s resignation at ${x.stepLabel}?', done: 'Resignation step approved'),
                    no: x.canHold ? 'Mark pending' : null,
                    onNo: () => _chain(
                        key: 'exit-${x.exitId}', path: managerExitPath(x.exitId), action: 'hold', title: 'Mark ${x.employeeName}\'s resignation pending',
                        question: '', done: 'Marked as pending')),
            ])),
        ]),
      if (p.leaveChain.isNotEmpty)
        _section('Leave approval chain', [
          for (final l in p.leaveChain)
            _pad(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _head(l.employeeName, l.line, extra: l.holdReason == null ? null : 'On hold: ${l.holdReason}'),
              _buttons('lc-${l.id}',
                  yes: 'Approve',
                  onYes: () => _chain(
                      key: 'lc-${l.id}', path: leaveChainPath(l.id), action: 'approve', title: 'Approve leave step?',
                      question: 'Approve ${l.employeeName}\'s ${l.line}?', done: 'Leave step approved'),
                  no: l.canHold ? 'Mark pending' : null,
                  onNo: () => _chain(
                      key: 'lc-${l.id}', path: leaveChainPath(l.id), action: 'hold', title: 'Mark ${l.employeeName}\'s leave pending',
                      question: '', done: 'Updated')),
            ])),
        ]),
      if (p.otChain.isNotEmpty)
        _section('Overtime approval chain', [
          for (final o in p.otChain)
            _pad(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _head(o.employeeName, o.line, extra: o.holdReason == null ? null : 'On hold: ${o.holdReason}'),
              _buttons('oc-${o.id}',
                  yes: 'Approve',
                  onYes: () => _chain(
                      key: 'oc-${o.id}', path: otChainPath(o.id), action: 'approve', title: 'Approve overtime step?',
                      question: 'Approve ${o.employeeName}\'s overtime (${o.line})?', done: 'Overtime step approved'),
                  no: o.canHold ? 'Mark pending' : null,
                  onNo: () => _chain(
                      key: 'oc-${o.id}', path: otChainPath(o.id), action: 'hold', title: 'Mark ${o.employeeName}\'s overtime pending',
                      question: '', done: 'Updated')),
            ])),
        ]),
      if (p.overtime.isNotEmpty)
        _section('Overtime requests', [
          for (final o in p.overtime)
            _pad(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _head(o.employeeName, o.line, extra: o.reason),
              _buttons('ot-${o.id}', yes: 'Approve', onYes: () => _overtime(o, approve: true), no: 'Reject', onNo: () => _overtime(o, approve: false)),
            ])),
        ]),
      if (p.leaves.isNotEmpty)
        _section('Leave requests', [
          for (final l in p.leaves)
            _pad(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _head(l.employeeName, l.line, extra: l.reason),
              _buttons('leave-${l.id}', yes: 'Approve', onYes: () => _leave(l, approve: true), no: 'Reject', onNo: () => _leave(l, approve: false)),
            ])),
        ]),
      if (p.expenses.isNotEmpty)
        _section('Expense claims', [
          for (final x in p.expenses)
            _pad(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _head(x.employeeName, '${inr(x.amount, maxFraction: 2)}${x.date == null ? '' : ' · ${dMMM(x.date!)}'}', extra: x.description),
              _buttons('exp-${x.id}', yes: 'Approve', onYes: () => _expense(x, approve: true), no: 'Reject', onNo: () => _expense(x, approve: false)),
            ])),
        ]),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final sections = _sections();
    return PayListPage(
      title: 'Pending approvals',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'Nothing waiting for you',
      emptyBody: 'Resignations, leave, overtime and expense requests show up here.',
      emptyIcon: LucideIcons.inbox,
      rows: sections,
    );
  }
}
