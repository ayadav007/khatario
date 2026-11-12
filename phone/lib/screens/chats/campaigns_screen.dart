import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../hr/hr_manage_widgets.dart';
import '../hr/pay_widgets.dart';
import '../pages/website_page_screen.dart';
import '../sales/doc_action_sheets.dart';
import 'campaign_report_screen.dart';
import 'campaigns_logic.dart';
import 'send_message_screen.dart';

enum CampaignActionResult { done, cancelled, refused }

/// Start, pause, resume or restart one campaign: Start and Resume first check that WhatsApp is
/// connected (as the website does), then every action asks, naming the campaign and who gets it,
/// and posts once. A refusal shows the server's words. [onSending] is true only while the request
/// is on its way (for a spinner). The caller guards double taps and reloads.
Future<CampaignActionResult> runCampaignAction(BuildContext context, AppSession session, CampaignRow c, CampaignAction a, {void Function(bool sending)? onSending}) async {
  try {
    if (a != CampaignAction.pause) {
      final status = await session.api.getJson(whatsappStatusPath);
      if (!whatsappConnected(status)) {
        if (context.mounted) showKToast(context, notConnectedMessage(a.name), tone: KTone.negative);
        return CampaignActionResult.refused;
      }
    }
    if (!context.mounted) return CampaignActionResult.cancelled;
    final ask = campaignAsk(c, a);
    final sure = await askSheet(context, title: ask.title, text: ask.text, confirmLabel: ask.confirm, cancelLabel: ask.cancel, danger: false);
    if (!sure || !context.mounted) return CampaignActionResult.cancelled;
    onSending?.call(true);
    try {
      await session.api.patchJson(campaignPath(c.id), campaignActionBody(a));
    } finally {
      onSending?.call(false);
    }
    if (context.mounted) showKToast(context, campaignDoneText(a), tone: KTone.positive);
    return CampaignActionResult.done;
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not update the campaign. Try again.', tone: KTone.negative);
  }
  return CampaignActionResult.refused;
}

KTone campaignStatusTone(String status) => switch (status) {
      'running' || 'completed' => KTone.positive,
      'paused' => KTone.due,
      'failed' => KTone.negative,
      _ => KTone.neutral,
    };

/// The Start / Pause / Resume / Restart buttons a campaign in this status offers (website list and report).
List<(String, CampaignAction)> campaignActionsFor(CampaignRow c) => [
      if (c.canStart) ('Start', CampaignAction.start),
      if (c.canPause) ('Pause', CampaignAction.pause),
      if (c.canResume) ('Resume', CampaignAction.resume),
      if (c.canRestart) ('Restart', CampaignAction.start),
    ];

/// Website `/whatsapp/campaigns`: every campaign with search and a status filter, progress, the
/// Sent / Failed / Pending counts, View report, Start / Pause / Resume / Restart and Delete (never
/// while running). New campaigns are made in Send message. A running campaign refreshes itself.
class CampaignsScreen extends StatefulWidget {
  const CampaignsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<CampaignsScreen> createState() => _CampaignsScreenState();
}

class _CampaignsScreenState extends State<CampaignsScreen> with HrScreenState {
  final _searchController = TextEditingController();
  Timer? _debounce;
  Timer? _refresh;
  int _seq = 0;

  List<CampaignRow> _rows = const [];
  int _total = 0;
  bool _loadingMore = false;
  bool _connected = true;
  String _search = '', _status = 'all';

  bool get _filtered => _search.trim().isNotEmpty || _status != 'all';

  @override
  void initState() {
    super.initState();
    _load();
    _checkConnection();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _refresh?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _checkConnection() async {
    try {
      final s = await widget.session.api.getJson(whatsappStatusPath);
      if (mounted) setState(() => _connected = whatsappConnected(s));
    } catch (_) {
      // The warning is optional; starting a campaign checks again.
    }
  }

  /// [silent] keeps the list on screen (after an action, pull to refresh, the 5 second refresh).
  Future<void> _load({bool silent = false}) async {
    final seq = ++_seq;
    _refresh?.cancel();
    if (silent) {
      try {
        final page = campaignsFrom(await widget.session.api.getJson(campaignsListPath(search: _search, status: _status)));
        if (!mounted || seq != _seq) return;
        setState(() {
          _rows = page.rows;
          _total = page.total;
        });
      } catch (_) {
        // Keep what is shown; the next refresh tries again.
      }
      if (mounted && seq == _seq) _arm();
      return;
    }
    setState(() {
      loading = true;
      error = null;
      notInPlan = false;
    });
    try {
      final page = campaignsFrom(await widget.session.api.getJson(campaignsListPath(search: _search, status: _status)));
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = page.rows;
        _total = page.total;
        loading = false;
      });
      _arm();
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        error = e.message;
        loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      setState(() {
        error = 'Could not reach the server.';
        loading = false;
      });
    }
  }

  void _arm() {
    _refresh?.cancel();
    if (_rows.any((r) => r.status == 'running')) {
      _refresh = Timer(const Duration(seconds: 5), () {
        if (mounted) _load(silent: true);
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore) return;
    final seq = _seq;
    setState(() => _loadingMore = true);
    try {
      final page = campaignsFrom(await widget.session.api.getJson(campaignsListPath(search: _search, status: _status, offset: _rows.length)));
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = [..._rows, ...page.rows.where((r) => !_rows.any((x) => x.id == r.id))];
        _total = page.total;
      });
    } on ApiException catch (e) {
      toast(e.message);
    } catch (_) {
      toast('Could not load more campaigns.');
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _setFilter(VoidCallback change) {
    setState(change);
    _load();
  }

  void _onSearch(String text) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (!mounted || text.trim() == _search.trim()) return;
      _setFilter(() => _search = text);
    });
  }

  /// Taps while an action is being checked, asked or sent do nothing.
  final Set<String> _guard = {};

  Future<void> _action(CampaignRow c, CampaignAction a) async {
    final key = c.id;
    if (!_guard.add(key)) return;
    final result = await runCampaignAction(context, widget.session, c, a, onSending: (on) {
      if (!mounted) return;
      setState(() => on ? busy.add('a-$key') : busy.remove('a-$key'));
    });
    _guard.remove(key);
    if (!mounted) return;
    if (result == CampaignActionResult.refused) _checkConnection();
    if (result != CampaignActionResult.cancelled) await _load(silent: true);
  }

  Future<void> _delete(CampaignRow c) async {
    final key = 'd-${c.id}';
    if (busy.contains(key) || !_guard.add(key)) return;
    final ask = campaignDeleteAsk(c);
    final sure = await askSheet(context, title: ask.title, text: ask.text, confirmLabel: ask.confirm, cancelLabel: ask.cancel);
    _guard.remove(key);
    if (!sure || !mounted || busy.contains(key)) return;
    setState(() => busy.add(key));
    try {
      await widget.session.api.deleteJson(campaignPath(c.id));
      toast('Campaign deleted successfully', tone: KTone.positive);
    } on ApiException catch (e) {
      toast(e.message);
    } catch (_) {
      toast('Could not delete the campaign. Try again.');
    }
    if (!mounted) return;
    setState(() => busy.remove(key));
    await _load(silent: true);
  }

  Future<void> _newCampaign() async {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => SendMessageScreen(session: widget.session, startOnCampaign: true)));
    if (mounted) _load(silent: true);
  }

  Future<void> _report(CampaignRow c) async {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => CampaignReportScreen(session: widget.session, campaignId: c.id)));
    if (mounted) _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          KBackBar('Campaigns', trailing: notInPlan ? null : KIconButton(icon: LucideIcons.plus, tooltip: 'New campaign', onTap: _newCampaign)),
          if (!notInPlan) _filters(),
          Expanded(child: _body()),
        ]),
      ),
    );
  }

  Widget _filters() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        KSearchField(controller: _searchController, hint: 'Search campaigns...', onChanged: _onSearch),
        const SizedBox(height: AppSpace.sm),
        KChipBar<String>(value: _status, padding: EdgeInsets.zero, options: campaignStatusFilters, onChanged: (v) => _setFilter(() => _status = v)),
      ]),
    );
  }

  Widget _body() {
    if (loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2));
    if (error != null) {
      return ListView(children: [
        KEmptyState(
          icon: notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: notInPlan ? 'Not included in your current plan' : 'Could not load campaigns',
          body: error,
          action: notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(silent: true),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl * 3),
        children: [
          if (!_connected) ...[_notConnectedCard(), const SizedBox(height: AppSpace.md)],
          if (_rows.isEmpty)
            KEmptyState(
              icon: LucideIcons.megaphone,
              title: _filtered ? 'No campaigns match your filters.' : 'No campaigns yet. Create your first campaign to get started.',
              action: _filtered ? null : KButton(label: 'Create campaign', expand: false, onPressed: _newCampaign),
            )
          else ...[
            for (final c in _rows) Padding(padding: const EdgeInsets.only(bottom: AppSpace.sm), child: _card(c)),
            Padding(padding: const EdgeInsets.only(top: AppSpace.xs), child: Text('Showing ${_rows.length} of $_total', textAlign: TextAlign.center, style: AppText.caption)),
            if (_rows.length < _total)
              Padding(
                padding: const EdgeInsets.only(top: AppSpace.sm),
                child: KButton.secondary(label: _loadingMore ? 'Loading…' : 'Load more', expand: false, onPressed: _loadingMore ? null : _loadMore),
              ),
          ],
        ],
      ),
    );
  }

  Widget _notConnectedCard() {
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('WhatsApp is not connected', style: AppText.bodyStrong),
        const SizedBox(height: AppSpace.xs),
        Text('You need to connect your WhatsApp account before you can start campaigns. Messages will not be sent until WhatsApp is connected.', style: AppText.caption),
        const SizedBox(height: AppSpace.md),
        KButton.secondary(label: 'Connect WhatsApp', expand: false, onPressed: () => openWebsiteInApp(context, widget.session, '/settings?tab=whatsapp', 'WhatsApp')),
      ]),
    );
  }

  Widget _card(CampaignRow c) {
    final acting = busy.contains('a-${c.id}');
    final deleting = busy.contains('d-${c.id}');
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(child: Text(c.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong)),
          const SizedBox(width: AppSpace.sm),
          KPill(label: c.statusLabel, tone: campaignStatusTone(c.status)),
        ]),
        if (c.preview.isNotEmpty) Padding(padding: const EdgeInsets.only(top: AppSpace.xs), child: Text(c.preview, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.caption)),
        const SizedBox(height: AppSpace.sm),
        Row(children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.sm),
              child: LinearProgressIndicator(value: c.progress / 100, minHeight: AppSpace.sm, backgroundColor: AppColors.sunken, color: AppColors.brand),
            ),
          ),
          const SizedBox(width: AppSpace.sm),
          Text('${c.progress}%', style: AppText.caption),
        ]),
        const SizedBox(height: AppSpace.xs),
        Text('${c.countsText} · ${c.total} total', style: AppText.caption),
        const SizedBox(height: AppSpace.xs),
        Row(children: [
          KPill(label: c.type, tone: KTone.neutral),
          const SizedBox(width: AppSpace.sm),
          if (c.createdAt != null) Expanded(child: Text(ddMMMyyyyHm(c.createdAt!), style: AppText.caption)),
        ]),
        const SizedBox(height: AppSpace.md),
        Wrap(spacing: AppSpace.sm, runSpacing: AppSpace.sm, children: [
          PayRowButton(label: 'View report', onTap: () => _report(c)),
          for (final (label, action) in campaignActionsFor(c)) PayRowButton(label: label, busy: acting, onTap: () => _action(c, action)),
          if (c.canDelete) PayRowButton(label: 'Delete', danger: true, busy: deleting, onTap: () => _delete(c)),
        ]),
      ]),
    );
  }
}

