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
import 'credit_approvals_logic.dart';
import 'doc_action_sheets.dart';
import 'load_failed_view.dart';

/// Website `/credit-approvals`: credit limit override requests waiting for an Admin or Finance user.
///
/// The website's Approved and Rejected tabs read the same pending-only route, so they would only repeat
/// this list; the phone shows the one list the route gives.
class CreditApprovalsScreen extends StatefulWidget {
  const CreditApprovalsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<CreditApprovalsScreen> createState() => _CreditApprovalsScreenState();
}

class _CreditApprovalsScreenState extends State<CreditApprovalsScreen> {
  List<CreditApproval> _rows = const [];
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
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson('/api/credit-approvals/pending');
      if (!mounted) return;
      setState(() {
        _rows = creditApprovals(body['approvals']);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = LoadFailedView.isPlanBlock(e);
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not reach the server.'; _loading = false; });
    }
  }

  /// Asks, then posts once. A refusal is a toast and the card stays as it was.
  Future<void> _act(CreditApproval a, {required bool approve}) async {
    if (_busy.contains(a.id)) return;
    String? reason;
    if (approve) {
      final ok = await askSheet(
        context,
        title: 'Approve this credit limit override?',
        text: approveConfirmText(a),
        confirmLabel: 'Approve request',
        cancelLabel: 'Not now',
        danger: false,
      );
      if (!ok || !mounted) return;
    } else {
      reason = await showRejectReasonSheet(context, subject: '${a.title} for ${inr(a.amount, maxFraction: 2)}');
      if (reason == null || !mounted) return;
    }
    if (!_busy.add(a.id)) return;
    setState(() {});
    try {
      await widget.session.api.postJson(
        approve ? '/api/credit-approvals/approve' : '/api/credit-approvals/reject',
        approve ? approveBody(a.id) : rejectBody(a.id, reason!),
      );
      if (!mounted) return;
      showKToast(context, approve ? 'Approval granted successfully!' : 'Approval rejected', tone: KTone.positive);
      _busy.remove(a.id);
      await _load();
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, approve ? 'Failed to approve' : 'Failed to reject', tone: KTone.negative);
    } finally {
      _busy.remove(a.id);
      if (mounted) setState(() {});
    }
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
              'Credit approvals',
              trailing: KIconButton(
                icon: LucideIcons.globe,
                tooltip: 'Open on website',
                onTap: () => openWebsiteInApp(context, widget.session, '/credit-approvals', 'Credit approvals'),
              ),
            ),
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
        LoadFailedView(title: 'Could not load credit approvals', message: _error, notInPlan: _notInPlan, onRetry: _load),
      ]);
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          if (_rows.isEmpty)
            const KEmptyState(
              icon: LucideIcons.shieldCheck,
              title: 'No approvals waiting',
              body: 'Credit limit override requests show up here.',
            )
          else
            for (final a in _rows) ...[
              _card(a),
              const SizedBox(height: AppSpace.md),
            ],
        ],
      ),
    );
  }

  Widget _card(CreditApproval a) {
    final busy = _busy.contains(a.id);
    return KCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(child: Text(a.title, style: AppText.body.copyWith(fontWeight: FontWeight.w600))),
            const SizedBox(width: AppSpace.sm),
            const KPill(label: 'Pending', tone: KTone.due),
          ]),
          const SizedBox(height: 4),
          Text('Amount ${inr(a.amount, maxFraction: 2)}', style: AppText.caption),
          if (a.requestedBy != null) Text('Requested by ${a.requestedBy}', style: AppText.caption),
          if (a.reason != null) ...[
            const SizedBox(height: 6),
            Text('Reason: ${a.reason}', style: AppText.body.copyWith(color: AppColors.ink2)),
          ],
          if (a.isPending) ...[
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: KButton(label: 'Approve', height: 40, loading: busy, onPressed: busy ? null : () => _act(a, approve: true))),
              const SizedBox(width: AppSpace.sm),
              Expanded(
                child: KButton(label: 'Reject', height: 40, kind: KButtonKind.secondary, onPressed: busy ? null : () => _act(a, approve: false)),
              ),
            ]),
          ],
        ],
      ),
    );
  }
}

/// "Reject Credit Approval": a reason the website requires. Returns the trimmed reason, or null when closed.
Future<String?> showRejectReasonSheet(BuildContext context, {required String subject}) {
  return showKSheet<String>(
    context,
    title: 'Reject Credit Approval',
    builder: (ctx) => _RejectReasonSheet(subject: subject),
  );
}

class _RejectReasonSheet extends StatefulWidget {
  const _RejectReasonSheet({required this.subject});

  final String subject;

  @override
  State<_RejectReasonSheet> createState() => _RejectReasonSheetState();
}

class _RejectReasonSheetState extends State<_RejectReasonSheet> {
  final _reason = TextEditingController();
  String? _error;
  bool _done = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _submit() {
    if (_done) return;
    final error = rejectReasonError(_reason.text);
    if (error != null) {
      setState(() => _error = error);
      return;
    }
    _done = true;
    Navigator.of(context).pop(_reason.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('${widget.subject} will be turned down. Please provide a reason for rejecting this credit approval request.', style: AppText.body),
          const SizedBox(height: AppSpace.md),
          KTextField(
            label: 'Reason',
            controller: _reason,
            hint: 'Enter rejection reason...',
            maxLines: 4,
            minLines: 2,
            autofocus: true,
            error: _error,
            onChanged: (_) {
              if (_error != null) setState(() => _error = null);
            },
          ),
          const SizedBox(height: AppSpace.lg),
          KButton(label: 'Reject request', kind: KButtonKind.danger, onPressed: _submit),
        ],
      ),
    );
  }
}
