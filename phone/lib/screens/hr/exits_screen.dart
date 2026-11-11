import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../sales/doc_action_sheets.dart';
import 'attendance_leave_logic.dart';
import 'hr_manage_logic.dart';
import 'hr_manage_widgets.dart';
import 'pay_widgets.dart';

KTone exitTone(String status) => switch (status) {
      'completed' => KTone.positive,
      'cancelled' || 'rejected' => KTone.negative,
      'pending_approval' || 'approval_on_hold' => KTone.due,
      _ => KTone.neutral,
    };

/// Website `/hr/exits`: the exits, with "Start exit" and each exit's detail (approvals and checklist).
class ExitsScreen extends StatefulWidget {
  const ExitsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ExitsScreen> createState() => _ExitsScreenState();
}

class _ExitsScreenState extends State<ExitsScreen> with HrScreenState<ExitsScreen> {
  List<ExitRow> _rows = const [];
  HrAccess _access = HrAccess.open;

  @override
  void initState() {
    super.initState();
    _load();
    loadHrAccess(widget.session).then((a) {
      if (mounted) setState(() => _access = a);
    });
  }

  Future<void> _load() => guardedLoad(() async {
        final body = await widget.session.api.getJson(exitsPath);
        if (!mounted) return;
        _rows = exitRows(body['exits']);
      });

  void _push(Widget screen) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen)).then((_) {
        if (mounted) _load();
      });

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'Employee exits',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'No exits',
      emptyBody: 'Resignations and terminations you start show up here.',
      emptyIcon: LucideIcons.logOut,
      trailing: _access.has('employees', 'update') ? KIconButton(icon: LucideIcons.plus, tooltip: 'Start exit', onTap: () => _push(StartExitScreen(session: widget.session))) : null,
      rows: [
        if (_rows.isNotEmpty)
          KCard(
            child: KDivided(indent: 0, children: [
              for (final r in _rows)
                KListRow(
                  title: '${r.employeeName}${r.employeeCode.isEmpty ? '' : ' (${r.employeeCode})'}',
                  subtitle: _words(r.exitType),
                  trailing: KPill(label: r.statusWords, tone: exitTone(r.status)),
                  onTap: () => _push(ExitDetailScreen(session: widget.session, exitId: r.id)),
                ),
            ]),
          ),
      ],
    );
  }
}

String _words(String s) {
  final t = s.replaceAll('_', ' ');
  return t.isEmpty ? t : t[0].toUpperCase() + t.substring(1);
}

/// Website "Initiate exit": the employee, resignation or termination (HR only), and a reason from the
/// business's exit settings. Asks first, naming the person.
class StartExitScreen extends StatefulWidget {
  const StartExitScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<StartExitScreen> createState() => _StartExitScreenState();
}

class _StartExitScreenState extends State<StartExitScreen> {
  String _employeeId = '';
  String? _employeeName;
  bool _terminate = false;
  String? _reason;
  List<String> _reasons = const [];

  @override
  void initState() {
    super.initState();
    widget.session.api.getJson(exitReasonsPath).then((body) {
      final s = body['settings'];
      final list = s is Map && s['exit_reasons'] is List ? (s['exit_reasons'] as List).map((e) => e.toString()).toList() : <String>[];
      if (mounted) setState(() => _reasons = list);
    }).catchError((_) {
      // Reasons are optional: without the list the field is simply left out.
    });
  }

  Future<void> _save() async {
    final name = _employeeName ?? 'this employee';
    final ok = await askSheet(
      context,
      title: _terminate ? 'Terminate $name?' : 'Start $name\'s exit?',
      text: _terminate
          ? 'Terminate $name? A termination goes straight to the notice period and cannot be approved or rejected.'
          : 'Start a resignation for $name? It follows your approval chain from Exit settings.',
      confirmLabel: _terminate ? 'Terminate' : 'Start exit',
      cancelLabel: 'Not now',
    );
    if (!ok || !mounted) return;
    await widget.session.api.postJson(exitsPath, startExitBody(employeeId: _employeeId, terminate: _terminate, reason: _reason ?? ''));
    if (!mounted) return;
    showKToast(context, 'Exit initiated', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Start exit',
      saveLabel: 'Start exit',
      dirty: _employeeId.isNotEmpty,
      canSave: _employeeId.isNotEmpty,
      onSave: _save,
      children: [
        Text('Terminations go straight to notice period (HR only). Resignations follow your approval chain from Exit settings.', style: AppText.caption),
        KAsyncPickField(
          label: 'Employee',
          valueLabel: _employeeName,
          search: (q) => searchEmployees(widget.session.api, q),
          onPicked: (id, label) => setState(() {
            _employeeId = id;
            _employeeName = label;
          }),
        ),
        KPickField<bool>(label: 'Exit type', value: _terminate, options: const [(false, 'Resignation'), (true, 'Termination (HR only)')], onChanged: (v) => setState(() => _terminate = v)),
        if (_reasons.isNotEmpty)
          KPickField<String>(label: 'Reason (optional)', value: _reason, options: [for (final r in _reasons) (r, r)], onChanged: (v) => setState(() => _reason = v)),
      ],
    );
  }
}

/// Website exit detail: the approval steps with Approve / Mark pending / Grant exception / HR reject,
/// and the checklist with Done. Every approval asks first, posts once, shows the server's refusal
/// ("already decided" included) and reloads.
class ExitDetailScreen extends StatefulWidget {
  const ExitDetailScreen({super.key, required this.session, required this.exitId});

  final AppSession session;
  final String exitId;

  @override
  State<ExitDetailScreen> createState() => _ExitDetailScreenState();
}

class _ExitDetailScreenState extends State<ExitDetailScreen> with HrScreenState<ExitDetailScreen> {
  ExitDetail? _d;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => guardedLoad(() async {
        final body = await widget.session.api.getJson(exitPath(widget.exitId));
        if (!mounted) return;
        _d = ExitDetail.fromJson(body);
      });

  Future<void> _decide(String action) async {
    final d = _d!;
    String? hold;
    await act(
      'decide',
      confirm: () async {
        switch (action) {
          case 'hold':
            hold = await showReasonSheet(context, title: 'Mark ${d.employeeName}\'s resignation pending', confirmLabel: 'Mark pending', hint: 'Reason (required)');
            if (hold == null) return false;
            if (hold!.isEmpty) {
              toast('Give a reason first.');
              return false;
            }
            return true;
          case 'reject':
            return askSheet(context, title: 'Reject resignation?', text: 'Reject ${d.employeeName}\'s resignation? The exit is cancelled.', confirmLabel: 'Reject resignation', cancelLabel: 'Not now');
          case 'grant_exception':
            return askSheet(context, title: 'Grant exception?', text: 'Grant an exception for ${d.employeeName}\'s resignation?', confirmLabel: 'Grant exception', cancelLabel: 'Not now', danger: false);
          default:
            final step = d.activeStep?.stepLabel;
            return askSheet(context, title: 'Approve resignation?', text: 'Approve ${d.employeeName}\'s resignation${step == null ? '' : ' at $step'}?', confirmLabel: 'Approve', cancelLabel: 'Not now', danger: false);
        }
      },
      send: () => widget.session.api.patchJson(exitPath(widget.exitId), exitDecisionBody(action, holdReason: hold)),
      done: switch (action) { 'hold' => 'Marked as pending', 'reject' => 'Resignation rejected', 'grant_exception' => 'Exception granted', _ => 'Resignation step approved' },
      reload: _load,
    );
  }

  Future<void> _done(ExitTask t) async {
    await act(
      'task-${t.id}',
      confirm: () async => true,
      send: () => widget.session.api.patchJson(exitPath(widget.exitId), exitTaskDoneBody(t.id)),
      done: 'Marked done',
      reload: _load,
    );
  }

  Widget _actions(ExitDetail d) {
    final step = d.activeStep;
    final working = busy.contains('decide');
    return KCard(
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (d.canActOnStep && step != null) ...[
          Text('Current step: ${step.stepLabel}', style: AppText.bodyStrong),
          if (step.isOnHold && step.holdReason != null) Text('On hold: ${step.holdReason}', style: AppText.caption),
          const SizedBox(height: 10),
          KButton(label: 'Approve', height: 44, loading: working, onPressed: working ? null : () => _decide('approve')),
          if (step.roleType != 'hr' && step.status == 'awaiting') ...[
            const SizedBox(height: AppSpace.sm),
            KButton(label: 'Mark pending', height: 44, kind: KButtonKind.secondary, onPressed: working ? null : () => _decide('hold')),
          ],
          if (d.showException) ...[
            const SizedBox(height: AppSpace.sm),
            KButton(label: 'Grant exception (dept head)', height: 44, kind: KButtonKind.secondary, onPressed: working ? null : () => _decide('grant_exception')),
          ],
        ],
        if (d.canHrReject) ...[
          const SizedBox(height: AppSpace.sm),
          KButton(label: 'Reject resignation (HR only)', height: 44, kind: KButtonKind.danger, onPressed: working ? null : () => _decide('reject')),
        ],
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return PayListPage(
      title: d == null ? 'Exit' : '${d.employeeName} · ${_words(d.exitType)}',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'Exit not found',
      emptyBody: 'It may have been removed.',
      emptyIcon: LucideIcons.logOut,
      rows: d == null
          ? const []
          : [
              KCard(
                padding: const EdgeInsets.all(14),
                child: Row(children: [
                  Expanded(child: Text(d.noticeLine, style: AppText.body)),
                  KPill(label: statusWords(d.status), tone: exitTone(d.status)),
                ]),
              ),
              if (d.isResignation && d.approvals.isNotEmpty) ...[
                const KSectionHeader('Approvals'),
                KCard(
                  child: KDivided(indent: 0, children: [
                    for (final a in d.approvals)
                      KListRow(
                        title: a.stepLabel,
                        subtitle: [if (a.approverName != null) a.approverName!, if (a.holdReason != null) 'On hold: ${a.holdReason}'].join(' · '),
                        trailing: KPill(label: statusWords(a.status), tone: a.status == 'approved' ? KTone.positive : (a.status == 'rejected' ? KTone.negative : KTone.neutral)),
                      ),
                  ]),
                ),
              ],
              if (d.isResignation && d.awaitingApproval && (d.canActOnStep || d.canHrReject)) _actions(d),
              const KSectionHeader('Checklist'),
              if (d.tasks.isEmpty)
                Text('No checklist items.', style: AppText.caption)
              else
                KCard(
                  child: KDivided(indent: 0, children: [
                    for (final t in d.tasks)
                      KListRow(
                        title: t.title,
                        subtitle: t.category,
                        trailing: t.done
                            ? KPill(label: 'Completed', tone: KTone.positive)
                            : KButton(label: 'Done', expand: false, height: 36, kind: KButtonKind.secondary, loading: busy.contains('task-${t.id}'), onPressed: busy.contains('task-${t.id}') ? null : () => _done(t)),
                      ),
                  ]),
                ),
            ],
    );
  }
}
