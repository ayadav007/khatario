import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'attendance_leave_logic.dart';
import 'hr_manage_logic.dart';
import 'hr_manage_widgets.dart';
import 'pay_widgets.dart';
import 'recruitment_candidate_screen.dart';

KTone candidateTone(String status) => switch (status) {
      'offer_accepted' || 'joined' || 'selected' || 'docs_verified' || 'ready_to_join' => KTone.positive,
      'rejected' || 'withdrawn' => KTone.negative,
      'applied' => KTone.neutral,
      _ => KTone.due,
    };

void pushScreen(BuildContext context, Widget screen, VoidCallback reload) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen)).then((_) => reload());

/// Website `/employees/recruitment`: offers waiting for the owner's approval, the jobs and the most
/// recent candidates.
class RecruitmentScreen extends StatefulWidget {
  const RecruitmentScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<RecruitmentScreen> createState() => _RecruitmentScreenState();
}

class _RecruitmentScreenState extends State<RecruitmentScreen> with HrScreenState<RecruitmentScreen> {
  List<RecruitJob> _jobs = const [];
  List<RecruitCandidate> _candidates = const [];
  List<PendingOffer> _pending = const [];
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
        final api = widget.session.api;
        final jobs = await api.getJson(recruitJobsPath);
        // The candidate and offer lists are secondary: a failure there leaves them empty, as on the website.
        Future<Map<String, dynamic>> soft(String path) => api.getJson(path).catchError((_) => <String, dynamic>{});
        final rest = await Future.wait([soft(recruitCandidatesPath), soft(recruitPendingOffersPath)]);
        if (!mounted) return;
        _jobs = recruitJobs(jobs['jobs']);
        _candidates = recruitCandidates(rest[0]['candidates']).take(20).toList();
        _pending = pendingOffers(rest[1]['pending']);
      });

  @override
  Widget build(BuildContext context) {
    final s = widget.session;
    return PayListPage(
      title: 'Recruitment',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'No jobs yet',
      emptyBody: 'Add a job, then add candidates to it.',
      emptyIcon: LucideIcons.briefcaseBusiness,
      trailing: _access.has('recruitment', 'create') ? KIconButton(icon: LucideIcons.plus, tooltip: 'New job', onTap: () => pushScreen(context, JobFormScreen(session: s), _load)) : null,
      rows: _jobs.isEmpty && _candidates.isEmpty && _pending.isEmpty
          ? const []
          : [
              if (_pending.isNotEmpty) ...[
                const KSectionHeader('Offer approvals waiting on you'),
                KCard(
                  child: KDivided(indent: 0, children: [
                    for (final p in _pending)
                      KListRow(
                        title: p.candidateName,
                        subtitle: '${p.designation}${p.levelLabel == null ? '' : ' · ${p.levelLabel}'}',
                        trailing: const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink2),
                        onTap: () => pushScreen(context, CandidateScreen(session: s, candidateId: p.candidateId), _load),
                      ),
                  ]),
                ),
              ],
              const KSectionHeader('Jobs'),
              if (_jobs.isEmpty)
                Text('No jobs yet.', style: AppText.caption)
              else
                KCard(
                  child: KDivided(indent: 0, children: [
                    for (final j in _jobs)
                      KListRow(
                        title: j.title,
                        subtitle: '${j.department ?? 'No department'} · ${j.candidateCount} candidate${j.candidateCount == 1 ? '' : 's'}',
                        trailing: KPill(label: statusWords(j.status), tone: j.status == 'open' ? KTone.positive : KTone.neutral),
                        onTap: () => pushScreen(context, JobScreen(session: s, jobId: j.id), _load),
                      ),
                  ]),
                ),
              const KSectionHeader('Recent candidates'),
              if (_candidates.isEmpty)
                Text('No candidates yet.', style: AppText.caption)
              else
                KCard(
                  child: KDivided(indent: 0, children: [
                    for (final c in _candidates)
                      KListRow(
                        title: c.fullName,
                        subtitle: '${c.jobTitle ?? ''} · ${c.email}',
                        trailing: KPill(label: statusWords(c.status), tone: candidateTone(c.status)),
                        onTap: () => pushScreen(context, CandidateScreen(session: s, candidateId: c.id), _load),
                      ),
                  ]),
                ),
            ],
    );
  }
}

/// Website `/employees/recruitment/jobs/[id]`: the job, its interview rounds and its candidates.
class JobScreen extends StatefulWidget {
  const JobScreen({super.key, required this.session, required this.jobId});

  final AppSession session;
  final String jobId;

  @override
  State<JobScreen> createState() => _JobScreenState();
}

class _JobScreenState extends State<JobScreen> with HrScreenState<JobScreen> {
  RecruitJob? _job;
  List<RecruitStage> _stages = const [];
  List<RecruitCandidate> _candidates = const [];
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
        final body = await widget.session.api.getJson(recruitJobPath(widget.jobId));
        if (!mounted) return;
        _job = RecruitJob.fromJson(body['job']);
        _stages = recruitStages(body['stages']);
        _candidates = recruitCandidates(body['candidates']);
      });

  @override
  Widget build(BuildContext context) {
    final s = widget.session;
    final job = _job;
    return PayListPage(
      title: job?.title ?? 'Job',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'Job not found',
      emptyBody: 'It may have been removed.',
      emptyIcon: LucideIcons.briefcaseBusiness,
      trailing: job != null && _access.has('recruitment', 'update')
          ? KIconButton(icon: LucideIcons.pencil, tooltip: 'Edit job', onTap: () => pushScreen(context, JobFormScreen(session: s, job: job), _load))
          : null,
      fab: _access.has('recruitment', 'create') && job != null
          ? KFab(icon: LucideIcons.userPlus, label: 'Add candidate', onTap: () => pushScreen(context, CandidateFormScreen(session: s, jobId: widget.jobId), _load))
          : null,
      rows: job == null
          ? const []
          : [
              KCard(
                padding: const EdgeInsets.all(14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(job.department ?? 'No department', style: AppText.caption)),
                    KPill(label: statusWords(job.status), tone: job.status == 'open' ? KTone.positive : KTone.neutral),
                  ]),
                  if (job.description != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(job.description!, style: AppText.body)),
                  if (_stages.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Text('Interview rounds', style: AppText.label),
                    for (var i = 0; i < _stages.length; i++) Text('${i + 1}. ${_stages[i].name}', style: AppText.body),
                  ],
                ]),
              ),
              KSectionHeader('Candidates (${_candidates.length})'),
              if (_candidates.isEmpty)
                Text('No candidates yet.', style: AppText.caption)
              else
                KCard(
                  child: KDivided(indent: 0, children: [
                    for (final c in _candidates)
                      KListRow(
                        title: c.fullName,
                        subtitle: c.email,
                        trailing: KPill(label: statusWords(c.status), tone: candidateTone(c.status)),
                        onTap: () => pushScreen(context, CandidateScreen(session: s, candidateId: c.id), _load),
                      ),
                  ]),
                ),
            ],
    );
  }
}

/// Website `/employees/recruitment/jobs/new`, and the edit of a job. A new job is open; the website
/// has no way to change a job's status, so neither does this form. The interview rounds are the
/// server's defaults (HR, Manager and Final Round); custom rounds stay on the website.
class JobFormScreen extends StatefulWidget {
  const JobFormScreen({super.key, required this.session, this.job});

  final AppSession session;
  final RecruitJob? job;

  @override
  State<JobFormScreen> createState() => _JobFormScreenState();
}

class _JobFormScreenState extends State<JobFormScreen> {
  late final _title = TextEditingController(text: widget.job?.title ?? '');
  late final _department = TextEditingController(text: widget.job?.department ?? '');
  late final _description = TextEditingController(text: widget.job?.description ?? '');

  @override
  void dispose() {
    _title.dispose();
    _department.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final body = jobBody(title: _title.text, department: _department.text, description: _description.text);
    final api = widget.session.api;
    if (widget.job == null) {
      await api.postJson(recruitJobsPath, body);
    } else {
      await api.patchJson(recruitJobPath(widget.job!.id), body);
    }
    if (!mounted) return;
    showKToast(context, widget.job == null ? 'Job added' : 'Job updated', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: widget.job == null ? 'New job' : 'Edit job',
      saveLabel: widget.job == null ? 'Add job' : 'Save job',
      dirty: _title.text.isNotEmpty,
      canSave: _title.text.trim().isNotEmpty,
      onSave: _save,
      children: [
        KTextField(label: 'Job title', controller: _title, onChanged: (_) => setState(() {})),
        KTextField(label: 'Department', controller: _department),
        KTextField(label: 'Description', controller: _description, maxLines: 5, minLines: 3),
      ],
    );
  }
}

/// Website "Add candidate" on the job page: name, email, phone and source.
class CandidateFormScreen extends StatefulWidget {
  const CandidateFormScreen({super.key, required this.session, required this.jobId});

  final AppSession session;
  final String jobId;

  @override
  State<CandidateFormScreen> createState() => _CandidateFormScreenState();
}

class _CandidateFormScreenState extends State<CandidateFormScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _source = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    _source.dispose();
    super.dispose();
  }

  bool get _ready => _name.text.trim().isNotEmpty && _email.text.contains('@');

  Future<void> _save() async {
    await widget.session.api.postJson(
      recruitCandidatesPath,
      candidateBody(jobId: widget.jobId, fullName: _name.text, email: _email.text, phone: _phone.text, source: _source.text),
    );
    if (!mounted) return;
    showKToast(context, 'Candidate added', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Add candidate',
      saveLabel: 'Add candidate',
      dirty: _name.text.isNotEmpty || _email.text.isNotEmpty,
      canSave: _ready,
      onSave: _save,
      children: [
        KTextField(label: 'Full name', controller: _name, onChanged: (_) => setState(() {})),
        KTextField(label: 'Email', controller: _email, keyboard: TextInputType.emailAddress, onChanged: (_) => setState(() {})),
        KTextField(label: 'Phone', controller: _phone, keyboard: TextInputType.phone),
        KTextField(label: 'Source', controller: _source),
      ],
    );
  }
}
