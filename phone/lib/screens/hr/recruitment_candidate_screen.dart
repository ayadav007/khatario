import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../pages/website_page_screen.dart';
import '../reports/statement_pdf.dart';
import '../sales/doc_action_sheets.dart';
import 'attendance_leave_logic.dart';
import 'hr_manage_logic.dart';
import 'hr_manage_widgets.dart';
import 'employees_screen.dart';
import 'offer_form_screen.dart';
import 'offer_submit_screen.dart';
import 'pay_widgets.dart';
import 'recruitment_screen.dart';

/// Website `/employees/recruitment/candidates/[id]`: interviews, the offer letter and joining.
///
/// Native: scheduling interviews and marking them passed or failed, creating and editing the offer
/// draft, the offer PDF, approving or rejecting the offer on your turn, sending it, resetting a
/// rejected one, submitting a draft for approval (approvers chosen per level), and converting an
/// accepted candidate to an employee (it then opens the new employee's profile). On the website: onboarding
/// tasks, document verification and the portal invite; one "Open on website" row says so.
class CandidateScreen extends StatefulWidget {
  const CandidateScreen({super.key, required this.session, required this.candidateId});

  final AppSession session;
  final String candidateId;

  @override
  State<CandidateScreen> createState() => _CandidateScreenState();
}

class _CandidateScreenState extends State<CandidateScreen> with HrScreenState<CandidateScreen> {
  RecruitCandidate? _c;
  List<RecruitStage> _stages = const [];
  List<RecruitInterview> _interviews = const [];
  Map<String, dynamic>? _offer;
  List<dynamic> _approvals = const [];
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
        final body = await widget.session.api.getJson(recruitCandidatePath(widget.candidateId));
        if (!mounted) return;
        _c = RecruitCandidate.fromJson(body['candidate']);
        _stages = recruitStages(body['stages']);
        _interviews = recruitInterviews(body['interviews']);
        _offer = body['offer'] is Map ? Map<String, dynamic>.from(body['offer'] as Map) : null;
        _approvals = body['offer_approvals'] is List ? body['offer_approvals'] as List : const [];
      });

  String get _offerStatus => _offer?['status']?.toString() ?? '';

  Future<bool> _ask(String title, String text, String confirm, {bool danger = false}) =>
      askSheet(context, title: title, text: text, confirmLabel: confirm, cancelLabel: 'Not now', danger: danger);

  Future<void> _interview(RecruitInterview i, {required bool passed}) async {
    final name = _c?.fullName ?? 'the candidate';
    await act(
      'iv-${i.id}',
      confirm: () => _ask(
        passed ? 'Mark as passed?' : 'Mark as failed?',
        'Mark $name\'s ${i.stageName} interview as ${passed ? 'passed' : 'failed'}? '
        'This also moves the candidate to ${passed ? 'selected' : 'rejected'}.',
        passed ? 'Mark passed' : 'Mark failed',
        danger: !passed,
      ),
      send: () => widget.session.api.patchJson(recruitInterviewPath(widget.candidateId, i.id), interviewResultBody(passed: passed)),
      done: passed ? 'Interview marked passed' : 'Interview marked failed',
      reload: _load,
    );
  }

  Future<void> _decideOffer({required bool approve}) async {
    final name = _c?.fullName ?? 'the candidate';
    String? comment;
    await act(
      'offer',
      confirm: () async {
        if (approve) return _ask('Approve offer?', 'Approve the offer for $name?', 'Approve');
        comment = await showReasonSheet(context, title: 'Reject $name\'s offer', confirmLabel: 'Reject offer', hint: 'Comment (optional)');
        return comment != null;
      },
      send: () => widget.session.api.patchJson(recruitOfferPath(widget.candidateId), offerActionBody(approve ? 'approve' : 'reject', comments: comment)),
      done: approve ? 'Offer approved' : 'Offer rejected',
      reload: _load,
    );
  }

  Future<void> _offerAction(String action) async {
    final name = _c?.fullName ?? 'the candidate';
    final send = action == 'send';
    await act(
      'offer',
      confirm: () => _ask(
        send ? 'Send offer?' : 'Edit and resubmit?',
        send ? 'Send the offer letter to $name on the candidate portal?' : 'Move $name\'s rejected offer back to a draft so you can edit it?',
        send ? 'Send offer' : 'Back to draft',
      ),
      send: () => widget.session.api.patchJson(recruitOfferPath(widget.candidateId), offerActionBody(action)),
      done: send ? 'Offer sent' : 'Offer is a draft again',
      reload: _load,
    );
  }

  Future<void> _convert() async {
    final name = _c?.fullName ?? 'the candidate';
    String? employeeId;
    await act(
      'convert',
      confirm: () => _ask(
        'Convert to employee?',
        'Convert $name to an employee? Only do this on the joining day, after checking their original documents. '
        'A salary structure is created from the accepted offer.',
        'Documents verified, convert',
      ),
      send: () async {
        final r = await widget.session.api.postJson(recruitConvertPath(widget.candidateId), convertBody());
        employeeId = r['employee_id']?.toString();
      },
      done: 'Candidate converted to employee',
      reload: _load,
    );
    // Like the website, go to the new employee.
    if (employeeId != null && employeeId!.isNotEmpty && mounted) {
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => EmployeeDetailScreen(session: widget.session, employeeId: employeeId!)));
    }
  }

  Future<void> _pdf() async {
    if (busy.contains('pdf')) return;
    setState(() => busy.add('pdf'));
    try {
      final bytes = await widget.session.api.getBytes(recruitOfferPdfPath(widget.candidateId));
      if (!mounted) return;
      final name = _c?.fullName ?? 'Candidate';
      await openPdfViewer(context, bytes, title: 'Offer letter $name', fileName: 'offer-letter-${widget.candidateId}.pdf');
    } on ApiException catch (e) {
      toast(e.message);
    } catch (_) {
      toast('Could not open the offer letter. Try again.');
    } finally {
      if (mounted) setState(() => busy.remove('pdf'));
    }
  }

  Widget _row(String l, String? v) => v == null || v.isEmpty
      ? const SizedBox.shrink()
      : Padding(padding: const EdgeInsets.only(top: 2), child: Text('$l: $v', style: AppText.body));

  Widget _interviewsCard() {
    final canSchedule = _access.has('recruitment', 'create') && _stages.isNotEmpty;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      KSectionHeader('Interviews', action: canSchedule ? 'Schedule' : null, onAction: () => pushScreen(context, InterviewFormScreen(session: widget.session, candidateId: widget.candidateId, stages: _stages), _load)),
      if (_interviews.isEmpty)
        Text('No interviews scheduled.', style: AppText.caption)
      else
        KCard(
          child: KDivided(indent: 0, children: [
            for (final i in _interviews)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(i.stageName, style: AppText.bodyStrong)),
                    KPill(label: statusWords(i.status), tone: i.status == 'passed' ? KTone.positive : (i.status == 'failed' ? KTone.negative : KTone.neutral)),
                  ]),
                  if (i.scheduledAt != null) Text(ddMMMyyyyHm(i.scheduledAt!), style: AppText.caption),
                  if (_access.has('recruitment', 'update'))
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Row(children: [
                        Expanded(child: KButton(label: 'Pass', height: 40, kind: KButtonKind.secondary, loading: busy.contains('iv-${i.id}'), onPressed: busy.contains('iv-${i.id}') ? null : () => _interview(i, passed: true))),
                        const SizedBox(width: AppSpace.sm),
                        Expanded(child: KButton(label: 'Fail', height: 40, kind: KButtonKind.secondary, onPressed: busy.contains('iv-${i.id}') ? null : () => _interview(i, passed: false))),
                      ]),
                    ),
                ]),
              ),
          ]),
        ),
    ]);
  }

  Widget _offerCard() {
    final o = _offer;
    final myTurn = isMyOfferTurn(_offerStatus, _approvals, widget.session.user['id']?.toString());
    final canUpdate = _access.has('recruitment', 'update');
    final working = busy.contains('offer');
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const KSectionHeader('Offer letter'),
      KCard(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (o == null)
            Text('No offer yet.', style: AppText.body)
          else ...[
            Row(children: [
              Expanded(child: Text(o['designation']?.toString() ?? 'Offer', style: AppText.bodyStrong)),
              KPill(label: statusWords(_offerStatus), tone: switch (_offerStatus) {
                'accepted' || 'approved' => KTone.positive,
                'approval_rejected' || 'declined' => KTone.negative,
                _ => KTone.due,
              }),
            ]),
            _row('Department', o['department']?.toString()),
            _row('Joining date', o['joining_date'] == null ? null : ddMMMyyyy(DateTime.tryParse(o['joining_date'].toString().substring(0, 10)) ?? DateTime.now())),
            _row('Basic salary (monthly)', o['basic_salary'] == null ? null : inr(toNum(o['basic_salary']), maxFraction: 2)),
            for (final a in _approvals.whereType<Map>())
              _row('Level ${a['approval_level']}${a['level_label'] == null ? '' : ' · ${a['level_label']}'}', '${a['approver_name'] ?? ''} — ${statusWords(a['status']?.toString() ?? '')}'),
          ],
          if (myTurn && canUpdate) ...[
            const SizedBox(height: 10),
            Text('Your approval is required', style: AppText.label),
            const SizedBox(height: 6),
            Row(children: [
              Expanded(child: KButton(label: 'Approve', height: 40, loading: working, onPressed: working ? null : () => _decideOffer(approve: true))),
              const SizedBox(width: AppSpace.sm),
              Expanded(child: KButton(label: 'Reject', height: 40, kind: KButtonKind.secondary, onPressed: working ? null : () => _decideOffer(approve: false))),
            ]),
          ],
          const SizedBox(height: 10),
          Wrap(spacing: AppSpace.sm, runSpacing: AppSpace.sm, children: [
            if (canEditOffer(o == null ? null : _offerStatus) && _access.has('recruitment', o == null ? 'create' : 'update'))
              KButton.secondary(
                label: o == null ? 'Create offer' : 'Edit offer',
                expand: false,
                onPressed: () => pushScreen(context, OfferFormScreen(session: widget.session, candidateId: widget.candidateId, offer: o), _load),
              ),
            if (o != null && offerPdfReady(_offerStatus))
              KButton.secondary(label: 'Open offer PDF', expand: false, icon: LucideIcons.fileText, loading: busy.contains('pdf'), onPressed: busy.contains('pdf') ? null : _pdf),
            if (canSubmitOffer(_offerStatus) && canUpdate)
              KButton(
                label: 'Submit for approval',
                expand: false,
                onPressed: () => pushScreen(context, SubmitOfferScreen(session: widget.session, candidateId: widget.candidateId, candidateName: _c?.fullName ?? 'the candidate'), _load),
              ),
            if (_offerStatus == 'approved' && canUpdate) KButton(label: 'Send to candidate', expand: false, loading: working, onPressed: working ? null : () => _offerAction('send')),
            if (_offerStatus == 'approval_rejected' && canUpdate) KButton.secondary(label: 'Edit and resubmit', expand: false, onPressed: working ? null : () => _offerAction('reset_to_draft')),
          ]),
        ]),
      ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    return PayListPage(
      title: c?.fullName ?? 'Candidate',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'Candidate not found',
      emptyBody: 'They may have been removed.',
      emptyIcon: LucideIcons.user,
      rows: c == null
          ? const []
          : [
              KCard(
                padding: const EdgeInsets.all(14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text('${c.jobTitle ?? ''} · ${c.email}', style: AppText.caption)),
                    KPill(label: statusWords(c.status), tone: candidateTone(c.status)),
                  ]),
                  _row('Phone', c.phone),
                  _row('Source', c.source),
                  _row('Notes', c.notes),
                ]),
              ),
              _interviewsCard(),
              _offerCard(),
              if (canConvert(c.status, employeeId: c.employeeId) && _access.has('recruitment', 'update'))
                KCard(
                  padding: const EdgeInsets.all(14),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Joining: convert to employee', style: AppText.bodyStrong),
                    const SizedBox(height: 4),
                    Text('A manual step on the joining day, after you have checked their original documents.', style: AppText.caption),
                    const SizedBox(height: 10),
                    KButton(label: 'Convert to employee', loading: busy.contains('convert'), onPressed: busy.contains('convert') ? null : _convert),
                  ]),
                ),
              KCard(
                child: KListRow(
                  title: 'Open on website',
                  subtitle: 'Onboarding tasks, candidate documents, portal invite',
                  leading: const Icon(LucideIcons.globe, size: 22, color: AppColors.ink2),
                  onTap: () => openWebsiteInApp(context, widget.session, '/employees/recruitment/candidates/${widget.candidateId}', 'Candidate'),
                ),
              ),
            ],
    );
  }
}

/// Website "Schedule" on the candidate page: a round and, optionally, when.
class InterviewFormScreen extends StatefulWidget {
  const InterviewFormScreen({super.key, required this.session, required this.candidateId, required this.stages});

  final AppSession session;
  final String candidateId;
  final List<RecruitStage> stages;

  @override
  State<InterviewFormScreen> createState() => _InterviewFormScreenState();
}

class _InterviewFormScreenState extends State<InterviewFormScreen> {
  String? _stageId;
  DateTime? _date;
  String _time = '10:00';

  static final _slots = [
    for (var h = 8; h <= 20; h++) for (final m in const ['00', '30']) '${h.toString().padLeft(2, '0')}:$m',
  ];

  Future<void> _save() async {
    DateTime? when;
    if (_date != null) {
      final parts = _time.split(':');
      when = DateTime(_date!.year, _date!.month, _date!.day, int.parse(parts[0]), int.parse(parts[1]));
    }
    await widget.session.api.postJson(recruitInterviewsPath(widget.candidateId), interviewBody(stageId: _stageId!, scheduledAt: when));
    if (!mounted) return;
    showKToast(context, 'Interview scheduled', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Schedule interview',
      saveLabel: 'Schedule',
      dirty: _stageId != null,
      canSave: _stageId != null,
      onSave: _save,
      children: [
        KPickField<String>(label: 'Round', value: _stageId, options: [for (final s in widget.stages) (s.id, s.name)], onChanged: (v) => setState(() => _stageId = v)),
        KDateField(label: 'Date (optional)', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        if (_date != null) KPickField<String>(label: 'Time', value: _time, options: [for (final t in _slots) (t, t)], onChanged: (v) => setState(() => _time = v)),
      ],
    );
  }
}
