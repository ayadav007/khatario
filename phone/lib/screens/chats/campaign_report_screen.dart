import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../pages/website_page_screen.dart';
import 'campaigns_logic.dart';
import 'campaigns_screen.dart';

enum _ReportTab { overview, recipients, analytics }

/// Website `/whatsapp/campaigns/[id]`: the report for one campaign. Totals and success rate, then
/// Overview (message, settings, timeline), Recipients and Analytics (button clicks). Start, Pause,
/// Resume and Restart are here too. A running campaign refreshes itself. CSV export stays on the website.
class CampaignReportScreen extends StatefulWidget {
  const CampaignReportScreen({super.key, required this.session, required this.campaignId});

  final AppSession session;
  final String campaignId;

  @override
  State<CampaignReportScreen> createState() => _CampaignReportScreenState();
}

class _CampaignReportScreenState extends State<CampaignReportScreen> {
  CampaignDetail? _detail;
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  bool _missing = false;
  bool _acting = false;
  bool _guarded = false;
  _ReportTab _tab = _ReportTab.overview;
  Timer? _refresh;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _refresh?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    final seq = ++_seq;
    _refresh?.cancel();
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
        _notInPlan = false;
        _missing = false;
      });
    }
    try {
      final detail = campaignDetailFrom(await widget.session.api.getJson(campaignPath(widget.campaignId)));
      if (!mounted || seq != _seq) return;
      setState(() {
        _detail = detail;
        _loading = false;
      });
      if (detail.campaign.status == 'running') {
        _refresh = Timer(const Duration(seconds: 5), () {
          if (mounted) _load(silent: true);
        });
      }
    } on ApiException catch (e) {
      if (!mounted || seq != _seq || silent) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _missing = e.status == 404;
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq || silent) return;
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  Future<void> _action(CampaignAction a) async {
    final d = _detail;
    if (d == null || _guarded) return;
    _guarded = true;
    final result = await runCampaignAction(context, widget.session, d.campaign, a, onSending: (on) {
      if (mounted) setState(() => _acting = on);
    });
    _guarded = false;
    if (!mounted) return;
    if (result != CampaignActionResult.cancelled) await _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final d = _detail;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          KBackBar(d?.campaign.name ?? 'Campaign report'),
          Expanded(child: _body(d)),
        ]),
      ),
    );
  }

  Widget _body(CampaignDetail? d) {
    if (_loading && d == null) return const KSpinner(padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2));
    if (_error != null && d == null || _loading) {
      return ListView(children: [
        KEmptyState(
          icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: _notInPlan
              ? 'Not included in your current plan'
              : _missing
                  ? 'Campaign not found'
                  : 'Could not load this campaign',
          body: _error,
          action: _notInPlan || _missing ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    if (d == null) return const SizedBox.shrink();
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(silent: true),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl * 3),
        children: [
          _header(d),
          const SizedBox(height: AppSpace.md),
          _tiles(d),
          const SizedBox(height: AppSpace.lg),
          KSegmented<_ReportTab>(
            value: _tab,
            options: const [(_ReportTab.overview, 'Overview'), (_ReportTab.recipients, 'Recipients'), (_ReportTab.analytics, 'Analytics')],
            onChanged: (v) => setState(() => _tab = v),
          ),
          const SizedBox(height: AppSpace.lg),
          ...switch (_tab) {
            _ReportTab.overview => _overview(d),
            _ReportTab.recipients => _recipients(d),
            _ReportTab.analytics => _analytics(d),
          },
        ],
      ),
    );
  }

  Widget _header(CampaignDetail d) {
    final c = d.campaign;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        KPill(label: c.statusLabel, tone: campaignStatusTone(c.status)),
        const SizedBox(width: AppSpace.sm),
        if (c.createdAt != null) Expanded(child: Text('Created ${ddMMMyyyyHm(c.createdAt!)}', style: AppText.caption)),
      ]),
      if (campaignActionsFor(c).isNotEmpty) ...[
        const SizedBox(height: AppSpace.md),
        Wrap(spacing: AppSpace.sm, runSpacing: AppSpace.sm, children: [
          for (final (label, action) in campaignActionsFor(c))
            KButton(label: label, expand: false, height: 44, loading: _acting, onPressed: _acting ? null : () => _action(action)),
        ]),
      ],
    ]);
  }

  Widget _tile(String label, String value, {Color? color}) {
    return Expanded(
      child: KCard(
        padding: const EdgeInsets.all(AppSpace.md),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: AppText.caption),
          const SizedBox(height: AppSpace.xs),
          Text(value, style: AppText.title.copyWith(color: color ?? AppColors.ink)),
        ]),
      ),
    );
  }

  Widget _tiles(CampaignDetail d) {
    final c = d.campaign;
    return Column(children: [
      Row(children: [_tile('Total recipients', '${c.total}'), const SizedBox(width: AppSpace.sm), _tile('Sent', '${c.sent}', color: AppColors.positive)]),
      const SizedBox(height: AppSpace.sm),
      Row(children: [_tile('Failed', '${c.failed}', color: AppColors.negative), const SizedBox(width: AppSpace.sm), _tile('Success rate', '${d.successRate}%')]),
    ]);
  }

  List<Widget> _overview(CampaignDetail d) {
    final c = d.campaign;
    return [
      const KSectionHeader('Message'),
      KCard(
        padding: const EdgeInsets.all(AppSpace.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(c.messageText, style: AppText.body),
          if (d.footer != null) ...[const SizedBox(height: AppSpace.sm), Text(d.footer!, style: AppText.caption)],
          if (d.buttonLabels.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            Wrap(spacing: AppSpace.sm, runSpacing: AppSpace.sm, children: [for (final l in d.buttonLabels) KPill(label: l, tone: KTone.brand)]),
          ],
        ]),
      ),
      const SizedBox(height: AppSpace.lg),
      KInfoCard(title: 'Campaign settings', rows: d.settings),
      const SizedBox(height: AppSpace.lg),
      const KSectionHeader('Timeline'),
      KCard(
        child: KDivided(children: [
          for (final (label, at) in d.timeline) KListRow(title: label, subtitle: ddMMMyyyyHm(at)),
        ]),
      ),
    ];
  }

  List<Widget> _recipients(CampaignDetail d) {
    return [
      KSectionHeader('Recipients (${d.recipients.length})'),
      if (d.recipients.isEmpty)
        const KEmptyState(icon: LucideIcons.users, title: 'No recipients')
      else
        KCard(
          child: KDivided(children: [
            for (final r in d.recipients) _RecipientRow(r),
          ]),
        ),
      const SizedBox(height: AppSpace.md),
      KCard(
        child: KListRow(
          title: 'Export CSV on the website',
          leading: const Icon(LucideIcons.globe, size: 20, color: AppColors.ink2),
          trailing: Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
          onTap: () => openWebsiteInApp(context, widget.session, '/whatsapp/campaigns/${widget.campaignId}', 'Campaign report'),
        ),
      ),
    ];
  }

  List<Widget> _analytics(CampaignDetail d) {
    final stats = d.buttonStats;
    return [
      const KSectionHeader('Button analytics'),
      if (stats.isEmpty)
        const KEmptyState(icon: LucideIcons.chartBar, title: 'No buttons in this campaign')
      else
        KCard(
          child: KDivided(children: [
            for (final s in stats) KListRow(title: s.title, subtitle: '${s.clicks} clicks · ${s.uniqueClicks} unique · CTR ${s.ctr}%'),
          ]),
        ),
    ];
  }
}

class _RecipientRow extends StatelessWidget {
  const _RecipientRow(this.r);

  final CampaignRecipient r;

  @override
  Widget build(BuildContext context) {
    final tone = switch (r.tone) {
      RecipientTone.good => KTone.positive,
      RecipientTone.bad => KTone.negative,
      RecipientTone.waiting => KTone.neutral,
    };
    final sub = [
      if (r.name != null) formatPhoneForList(r.phone),
      if (r.sentAt != null) ddMMMyyyyHm(r.sentAt!),
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.md, vertical: AppSpace.md),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(r.title, style: AppText.bodyStrong),
            if (sub.isNotEmpty) Text(sub, style: AppText.caption),
            if (r.error != null) Text(r.error!, style: AppText.caption.copyWith(color: AppColors.negative)),
            if (r.clickedId != null) Text('Tapped: ${r.clickedId}', style: AppText.caption),
          ]),
        ),
        const SizedBox(width: AppSpace.sm),
        KPill(label: r.statusLabel, tone: tone),
      ]),
    );
  }
}
