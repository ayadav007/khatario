import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../upgrade/upgrade_copy.dart';
import '../../upgrade/upgrade_sheet.dart';
import '../more/more_navigation.dart';
import '../pages/native_routes.dart';
import 'report_period.dart';
import 'reports_home_logic.dart';
import 'statement_kit.dart';

/// Website `/reports` at the mobile breakpoint (`MobileReportsIndex`), with the period and four
/// headline figures the desktop page shows. Every figure is the server's; a tile that fails shows
/// a dash and the others still show. The report list comes from the website's menu, and the More
/// menu reply says which reports this user's plan locks.
class ReportsHomeScreen extends StatefulWidget {
  const ReportsHomeScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ReportsHomeScreen> createState() => _ReportsHomeScreenState();
}

class _ReportsHomeScreenState extends State<ReportsHomeScreen> {
  ReportPeriod _period = ReportPeriod.of('this_month');

  /// Per tile: null while loading, then the figure or [_failed].
  final Map<int, num?> _figures = {};
  final Set<int> _failed = {};
  bool _tilesLoading = true;
  int _generation = 0;
  List<MoreNavSection>? _menu;

  @override
  void initState() {
    super.initState();
    _loadTiles();
    _loadMenu();
  }

  Future<void> _loadMenu() async {
    try {
      final data = await widget.session.api.getJson('/api/navigation/more').timeout(const Duration(seconds: 10));
      final sections = parseMoreMenu(data);
      if (mounted && sections != null) setState(() => _menu = sections);
    } catch (_) {
      // Without the menu every report shows, unlocked.
    }
  }

  Future<void> _loadTiles() async {
    final generation = ++_generation;
    final period = _period;
    setState(() {
      _tilesLoading = true;
      _figures.clear();
      _failed.clear();
    });
    await Future.wait([
      for (final (i, tile) in homeTiles.indexed)
        () async {
          num? figure;
          try {
            figure = tile.figure(await widget.session.api.getJson(tile.path(period)));
          } catch (_) {
            figure = null;
          }
          if (!mounted || generation != _generation) return;
          setState(() {
            if (figure == null) {
              _failed.add(i);
            } else {
              _figures[i] = figure;
            }
          });
        }(),
    ]);
    if (mounted && generation == _generation) setState(() => _tilesLoading = false);
  }

  void _changePeriod(ReportPeriod p) {
    setState(() => _period = p);
    _loadTiles();
  }

  void _open(String href, String label) => openAppHref(context, widget.session, href, label);

  void _upgrade(String href) {
    showUpgradeSheet(
      context,
      request: UpgradeRequest(UpgradeVariant.feature, featureKey: upgradeFeatureFor(href)),
      api: widget.session.api,
      businessId: widget.session.businessId,
      onSeePlans: () => _open('/subscription', 'Subscription'),
    );
  }

  @override
  Widget build(BuildContext context) {
    final groups = visibleGroups(_menu);
    return StatementScaffold(
      title: 'Reports',
      period: _period,
      onPeriod: _changePeriod,
      loading: false,
      // Every tile failed: the server or the network is down, so offer a retry.
      error: !_tilesLoading && _failed.length == homeTiles.length ? 'Could not load the figures for this period.' : null,
      notInPlan: false,
      onRetry: () async {
        await Future.wait([_loadTiles(), _loadMenu()]);
      },
      children: [
        _Tiles(figures: _figures, failed: _failed, loading: _tilesLoading),
        for (final g in groups)
          Padding(
            padding: const EdgeInsets.only(top: AppSpace.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                KSectionHeader(g.title),
                KCard(
                  child: Column(
                    children: [
                      for (final (i, r) in g.rows.indexed) ...[
                        if (i > 0) const Divider(height: 1, color: AppColors.hairline),
                        KListRow(
                          title: r.label,
                          opensWebsite: rowOpensWebsite(widget.session, r.href),
                          leading: Icon(LucideIcons.chartColumn, size: 18, color: r.locked ? AppColors.ink3 : AppColors.brand),
                          trailing: r.locked
                              ? const KPill(label: 'Upgrade', tone: KTone.due, icon: LucideIcons.lock)
                              : const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                          onTap: () => r.locked ? _upgrade(r.href) : _open(r.href, r.label),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _Tiles extends StatelessWidget {
  const _Tiles({required this.figures, required this.failed, required this.loading});

  final Map<int, num?> figures;
  final Set<int> failed;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    Widget tile(int i) {
      final figure = figures[i];
      final Widget value;
      if (figure != null) {
        value = FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: KAmount(figure, maxFraction: 2, style: AppText.amount.copyWith(fontSize: 20)),
        );
      } else if (failed.contains(i) || !loading) {
        value = Text('—', style: AppText.amount.copyWith(fontSize: 20, color: AppColors.ink3));
      } else {
        value = const SizedBox(height: 28, width: 28, child: Align(alignment: Alignment.centerLeft, child: KSpinner(size: 16, padding: EdgeInsets.zero)));
      }
      return Expanded(
        child: KCard(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(homeTiles[i].label, style: AppText.label),
              const SizedBox(height: 6),
              value,
            ],
          ),
        ),
      );
    }

    return Column(
      children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [tile(0), const SizedBox(width: AppSpace.sm), tile(1)]),
        const SizedBox(height: AppSpace.sm),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [tile(2), const SizedBox(width: AppSpace.sm), tile(3)]),
      ],
    );
  }
}
