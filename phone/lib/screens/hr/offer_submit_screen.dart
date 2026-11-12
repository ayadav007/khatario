import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../sales/doc_action_sheets.dart';
import 'hr_manage_logic.dart';

/// The website's "Submit offer for approval" dialog: one approver per level, in order. The level rules
/// come from `/api/settings/hr-approval` and the people from `/api/todos/users`. The chosen user ids
/// are data the server validates (active, in this business, no duplicates); the server refusals
/// (`ONBOARDING_INCOMPLETE`, level limits) are shown as they come. Asks first.
class SubmitOfferScreen extends StatefulWidget {
  const SubmitOfferScreen({super.key, required this.session, required this.candidateId, required this.candidateName});

  final AppSession session;
  final String candidateId;
  final String candidateName;

  @override
  State<SubmitOfferScreen> createState() => _SubmitOfferScreenState();
}

class _Level {
  _Level(String label) : label = TextEditingController(text: label);

  final TextEditingController label;
  String? userId;
}

class _SubmitOfferScreenState extends State<SubmitOfferScreen> {
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  OfferApprovalRules _rules = const OfferApprovalRules();
  List<ApproverOption> _users = const [];
  final List<_Level> _levels = [_Level('Hiring Manager')];
  final List<_Level> _removed = []; // disposed with the screen, not while still on screen

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final l in [..._levels, ..._removed]) {
      l.label.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final api = widget.session.api;
      final answers = await Future.wait([api.getJson(hrApprovalSettingsPath), api.getJson(todosUsersPath)]);
      if (!mounted) return;
      setState(() {
        _rules = OfferApprovalRules.fromJson(answers[0]);
        _users = approverOptions(answers[1]['users']);
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

  bool get _ready => _levels.length >= _rules.minLevels && _levels.every((l) => l.userId != null);

  String _nameOf(String id) => _users.firstWhere((u) => u.id == id, orElse: () => ApproverOption(id, 'approver')).label;

  Future<void> _submit() async {
    final names = [for (final l in _levels) _nameOf(l.userId!)].join(', ');
    final ok = await askSheet(
      context,
      title: 'Submit for approval?',
      text: 'Submit ${widget.candidateName}\'s offer for approval to $names? Each level approves in order.',
      confirmLabel: 'Submit',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!ok || !mounted) return;
    await widget.session.api.patchJson(recruitOfferPath(widget.candidateId), submitOfferBody([for (final l in _levels) (l.label.text, l.userId!)]));
    if (!mounted) return;
    showKToast(context, 'Offer submitted for approval', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _error != null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const KBackBar('Submit for approval'),
            Expanded(
              child: _loading
                  ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
                  : ListView(children: [
                      KEmptyState(
                        icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
                        title: _notInPlan ? 'Not included in your current plan' : 'Could not load the approvers',
                        body: _error,
                        action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
                      ),
                    ]),
            ),
          ]),
        ),
      );
    }
    return KFormScaffold(
      title: 'Submit for approval',
      saveLabel: 'Submit for approval',
      dirty: _levels.any((l) => l.userId != null),
      canSave: _ready,
      onSave: _submit,
      children: [
        Text(
          'Pick approvers for this offer. Each level must approve in order before the next is notified.'
          '${_rules.maxLevels == null ? ' Unlimited levels allowed.' : ' Maximum ${_rules.maxLevels} level(s).'}',
          style: AppText.caption,
        ),
        for (var i = 0; i < _levels.length; i++) ...[
          Row(children: [
            Expanded(child: Text('Level ${i + 1}', style: AppText.bodyStrong)),
            if (_rules.canRemove(_levels.length))
              KTextButton(
                label: 'Remove level',
                color: AppColors.negative,
                onTap: () => setState(() => _removed.add(_levels.removeAt(i))),
              ),
          ]),
          KTextField(label: 'Step label (optional)', controller: _levels[i].label, hint: 'e.g. Finance'),
          KPickField<String>(
            label: 'Approver',
            value: _levels[i].userId,
            searchable: true,
            options: [for (final u in _users) (u.id, u.label)],
            onChanged: (v) => setState(() => _levels[i].userId = v),
          ),
        ],
        if (_rules.canAdd(_levels.length)) KTextButton(label: 'Add level', onTap: () => setState(() => _levels.add(_Level('')))),
      ],
    );
  }
}
