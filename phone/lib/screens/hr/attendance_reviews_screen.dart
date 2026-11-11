import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../sales/doc_action_sheets.dart';
import 'attendance_leave_logic.dart';

enum _Tab { checkins, regularization }

/// One list on the screen with its own loading, error and plan state.
class _Feed<T> {
  bool loading = true;
  String? error;
  bool notInPlan = false;
  List<T> items = const [];
}

/// What the website shows as "Check-ins to review" (`/employees/attendance`) and the attendance
/// regularization section of `/employees/manager/approvals`: doubtful Khatario Staff check-ins, and
/// requests to fix a day's punches that wait for this user. Each is approved or rejected after a
/// question that names the employee and the date.
class AttendanceReviewsScreen extends StatefulWidget {
  const AttendanceReviewsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<AttendanceReviewsScreen> createState() => _AttendanceReviewsScreenState();
}

class _AttendanceReviewsScreenState extends State<AttendanceReviewsScreen> {
  List<_Tab> _tabs = const [];
  _Tab _tab = _Tab.checkins;
  bool _booting = true;
  final _checkins = _Feed<PunchReview>();
  final _regs = _Feed<RegularizationAsk>();
  final Set<String> _busy = {};

  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    setState(() => _booting = true);
    final access = await loadHrAccess(widget.session);
    if (!mounted) return;
    // Check-ins belong to the staff app plan; regularization asks to the leave and approval plan.
    final tabs = [if (access.has('hr_staff_app')) _Tab.checkins, if (access.has('hr_leaves')) _Tab.regularization];
    setState(() {
      _tabs = tabs;
      _tab = tabs.isEmpty ? _Tab.checkins : tabs.first;
      _booting = false;
    });
    await Future.wait([
      if (tabs.contains(_Tab.checkins)) _loadCheckins(),
      if (tabs.contains(_Tab.regularization)) _loadRegs(),
    ]);
  }

  Future<void> _loadCheckins() async {
    setState(() {
      _checkins.loading = true;
      _checkins.error = null;
      _checkins.notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson('/api/employees/attendance/reviews');
      if (!mounted) return;
      setState(() {
        _checkins.items = punchReviews(body['reviews']);
        _checkins.loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _checkins.notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _checkins.error = e.message;
        _checkins.loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _checkins.error = 'Could not reach the server.'; _checkins.loading = false; });
    }
  }

  Future<void> _loadRegs() async {
    setState(() {
      _regs.loading = true;
      _regs.error = null;
      _regs.notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson('/api/employees/manager/pending-approvals');
      if (!mounted) return;
      setState(() {
        _regs.items = regularizationAsks(body['regularizations']);
        _regs.loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _regs.notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        // The website treats 403 as "nothing waiting for you".
        final nothing = !_regs.notInPlan && e.status == 403;
        _regs.items = const [];
        _regs.error = nothing ? null : e.message;
        _regs.loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _regs.error = 'Could not reach the server.'; _regs.loading = false; });
    }
  }

  void _toast(String message, {KTone tone = KTone.neutral}) {
    if (mounted) showKToast(context, message, tone: tone);
  }

  Future<void> _decidePunch(PunchReview r, {required bool approve}) async {
    if (_busy.contains(r.id)) return;
    final when = r.createdAt == null ? '' : ' on ${ddMMMyyyy(r.createdAt!)}';
    final what = r.actionLabel.toLowerCase();
    final ok = await askSheet(
      context,
      title: approve ? 'Approve $what?' : 'Reject $what?',
      text: approve
          ? 'Approve ${r.employeeName}\'s $what$when? It stays in attendance.'
          : 'Reject ${r.employeeName}\'s $what$when? It is removed from attendance.',
      confirmLabel: approve ? 'Approve' : 'Reject',
      cancelLabel: 'Keep it',
      danger: !approve,
    );
    if (!ok || !mounted || _busy.contains(r.id)) return;
    setState(() => _busy.add(r.id));
    try {
      await widget.session.api.postJson('/api/employees/attendance/reviews', punchDecisionBody(r.id, approve: approve));
      _toast(approve ? 'Approved' : 'Rejected and removed from attendance', tone: KTone.positive);
    } on ApiException catch (e) {
      _toast(e.message, tone: KTone.negative);
    } catch (_) {
      _toast('Could not save. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy.remove(r.id));
    // Reload either way: after a refusal the list may already have moved on.
    await _loadCheckins();
  }

  Future<void> _decideRegularization(RegularizationAsk r, {required bool approve}) async {
    if (_busy.contains(r.id)) return;
    final date = r.date == null ? '' : ' for ${ddMMMyyyy(r.date!)}';
    String? reason;
    if (approve) {
      final ok = await askSheet(
        context,
        title: 'Approve request?',
        text: 'Approve ${r.employeeName}\'s ${regularizationTypeLabel(r.type).toLowerCase()} request$date?',
        confirmLabel: 'Approve',
        cancelLabel: 'Keep it',
        danger: false,
      );
      if (!ok) return;
    } else {
      reason = await showReasonSheet(context, title: 'Reject ${r.employeeName}\'s request$date', confirmLabel: 'Reject request');
      if (reason == null) return;
    }
    if (!mounted || _busy.contains(r.id)) return;
    setState(() => _busy.add(r.id));
    try {
      await widget.session.api.patchJson(
        '/api/employees/manager/attendance-regularization/${r.id}',
        regularizationDecisionBody(approve: approve, reason: reason),
      );
      _toast(approve ? 'Regularization approved' : 'Regularization rejected', tone: KTone.positive);
    } on ApiException catch (e) {
      _toast(e.message, tone: KTone.negative);
    } catch (_) {
      _toast('Could not save. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy.remove(r.id));
    await _loadRegs();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Check-in reviews'),
            if (_tabs.length > 1)
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
                child: KSegmented<_Tab>(
                  value: _tab,
                  options: const [(_Tab.checkins, 'Check-ins'), (_Tab.regularization, 'Regularization')],
                  onChanged: (t) => setState(() => _tab = t),
                ),
              ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_booting) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_tabs.isEmpty) {
      return ListView(children: const [
        KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan'),
      ]);
    }
    return _tab == _Tab.checkins
        ? _list<PunchReview>(
            _checkins,
            reload: _loadCheckins,
            failTitle: 'Could not load check-ins',
            emptyTitle: 'No check-ins to review',
            emptyBody: 'Check-ins from the Khatario Staff app that look unusual show up here.',
            row: _punchCard,
          )
        : _list<RegularizationAsk>(
            _regs,
            reload: _loadRegs,
            failTitle: 'Could not load requests',
            emptyTitle: 'No regularization requests waiting',
            emptyBody: 'Requests to fix a day\'s check-in or check-out that need you show up here.',
            row: _regCard,
          );
  }

  Widget _list<T>(_Feed<T> feed, {required Future<void> Function() reload, required String failTitle, required String emptyTitle, required String emptyBody, required Widget Function(T) row}) {
    if (feed.loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (feed.error != null) {
      return ListView(children: [
        KEmptyState(
          icon: feed.notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: feed.notInPlan ? 'Not included in your current plan' : failTitle,
          body: feed.error,
          action: feed.notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: reload),
        ),
      ]);
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: reload,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          if (feed.items.isEmpty)
            KEmptyState(icon: LucideIcons.circleCheck, title: emptyTitle, body: emptyBody)
          else
            KCard(child: KDivided(indent: 0, children: [for (final item in feed.items) row(item)])),
        ],
      ),
    );
  }

  Widget _actions({required bool busy, required VoidCallback onApprove, required VoidCallback onReject}) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(children: [
        Expanded(child: KButton(label: 'Approve', height: 40, onPressed: busy ? null : onApprove)),
        const SizedBox(width: AppSpace.sm),
        Expanded(child: KButton(label: 'Reject', height: 40, kind: KButtonKind.secondary, onPressed: busy ? null : onReject)),
      ]),
    );
  }

  Widget _punchCard(PunchReview r) {
    final busy = _busy.contains(r.id);
    final place = r.placeLine;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(child: Text(r.title, style: AppText.body.copyWith(fontWeight: FontWeight.w600))),
            KPill(label: 'Risk ${jsNumberString(r.riskScore)}/100', tone: r.riskScore >= 60 ? KTone.negative : KTone.due),
          ]),
          Text(r.whenLine, style: AppText.caption),
          const SizedBox(height: 6),
          Wrap(spacing: 12, runSpacing: 2, children: [
            if (place != null)
              GestureDetector(
                onTap: () => launchUrl(Uri.parse(r.mapUrl!), mode: LaunchMode.externalApplication),
                child: Text(place, style: AppText.caption.copyWith(color: AppColors.brand)),
              ),
            Text(r.wifiLine, style: AppText.caption),
            if (r.faceLine != null) Text(r.faceLine!, style: AppText.caption),
          ]),
          for (final reason in r.reasons) Padding(padding: const EdgeInsets.only(top: 2), child: Text(reason, style: AppText.caption.copyWith(color: AppColors.ink2))),
          if (r.photos.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final p in r.photos) _photo(p),
            ]),
          ],
          _actions(busy: busy, onApprove: () => _decidePunch(r, approve: true), onReject: () => _decidePunch(r, approve: false)),
        ],
      ),
    );
  }

  Widget _photo(String dataUrl) {
    final bytes = photoBytes(dataUrl);
    if (bytes == null) return const SizedBox.shrink();
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: Image.memory(bytes, width: 64, height: 64, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox(width: 64, height: 64)),
    );
  }

  Widget _regCard(RegularizationAsk r) {
    final busy = _busy.contains(r.id);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(r.title, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
          Text(r.dateLine, style: AppText.caption),
          const SizedBox(height: 6),
          Text(r.inLine, style: AppText.caption),
          Text(r.outLine, style: AppText.caption),
          if (r.reason.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(r.reason, style: AppText.body.copyWith(color: AppColors.ink2)),
          ],
          _actions(busy: busy, onApprove: () => _decideRegularization(r, approve: true), onReject: () => _decideRegularization(r, approve: false)),
        ],
      ),
    );
  }
}
