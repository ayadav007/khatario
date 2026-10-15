import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../format.dart';
import '../session.dart';
import '../shell/dashboard_overlays.dart';
import '../shell/date_range.dart';
import '../shell/shell_banners.dart';
import '../theme.dart';
import '../ui/kit.dart';
import 'dashboard_charts.dart';
import 'dashboard_widgets.dart';

/// Home: `app/(app)/dashboard/page.tsx` data, laid out for the phone.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({
    super.key,
    required this.session,
    required this.range,
    required this.onOpen,
    required this.onRange,
    required this.enabledFeatures,
    this.banners,
  });

  /// `/api/features/enabled` ids; null while loading.
  final List<String>? enabledFeatures;

  /// Layout banners and the plan-usage strip; owned by the shell.
  final ShellBannersController? banners;

  final AppSession session;
  final DashboardRange range;
  final ValueChanged<DashboardRange> onRange;

  /// Destination that is not copied to the phone app yet.
  final ValueChanged<String> onOpen;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  final _recentKey = GlobalKey<_RecentTransactionsFeedState>();

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await _api.getJson('/api/dashboard/overview?start_date=${widget.range.start}&end_date=${widget.range.end}');
      if (!mounted) return;
      setState(() => _data = body);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Map<String, num> _aging(dynamic v) {
    final m = v is Map ? v : const {};
    final a = m['aging'] is Map ? m['aging'] as Map : const {};
    return {
      'current': toNum(a['current']),
      'days_1_15': toNum(a['days_1_15']),
      'days_16_30': toNum(a['days_16_30']),
      'days_31_45': toNum(a['days_31_45']),
      'days_45_plus': toNum(a['days_45_plus']),
    };
  }

  num _total(dynamic v) => v is Map ? toNum(v['total']) : toNum(v);

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final sales = toNum(data?['sales']);
    final purchases = toNum(data?['purchases']);
    final collection = toNum(data?['collection']);
    final profit = toNum(data?['profit']);
    final lowStock = ((data?['lowStockItems'] as List?) ?? const []).whereType<Map>().toList();
    final name = widget.session.userName.trim().split(' ').first;

    return NotificationListener<ScrollNotification>(
      onNotification: (n) {
        if (n.metrics.extentAfter < 240) _recentKey.currentState?.loadMore();
        return false;
      },
      child: RefreshIndicator(
        color: AppColors.brand,
        onRefresh: () async {
          await _load();
          await _recentKey.currentState?.reload();
        },
        child: ListView(
          padding: const EdgeInsets.only(bottom: 112),
          children: [
            _HomeBand(
              greeting: name.isEmpty ? 'Namaste' : 'Namaste, $name',
              range: widget.range,
              onRange: widget.onRange,
              hero: _loading && data == null
                  ? const KCard(
                      child: SizedBox(height: 168, child: KSpinner(padding: EdgeInsets.zero)),
                    )
                  : _SalesHero(
                      sales: sales,
                      collection: collection,
                      purchases: purchases,
                      profit: profit,
                      onSales: () => widget.onOpen('Sales details'),
                      onCollection: () => widget.onOpen('Collection details'),
                      onPurchases: () => widget.onOpen('Purchase details'),
                    ),
            ),
            if (widget.banners != null) ...[
              ShellBanners(controller: widget.banners!, placement: BannerPlacement.dashboard, onOpen: widget.onOpen),
              UsageStrip(controller: widget.banners!, onUpgrade: () => widget.onOpen('Subscription')),
            ],
            const SizedBox(height: AppSpace.lg),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: _QuickActions(onOpen: widget.onOpen),
            ),
            if (data != null) ...[
              const SizedBox(height: 28),
              _MoneyCarousel(
                cards: [
                  _MoneyCard(
                    title: 'To collect',
                    caption: 'Customers owe you',
                    tint: AppTints.green,
                    icon: LucideIcons.arrowDownLeft,
                    total: _total(data['receivables']),
                    aging: _aging(data['receivables']),
                    onTap: () => widget.onOpen('/reports/aging/receivables'),
                  ),
                  _MoneyCard(
                    title: 'To pay',
                    caption: 'You owe suppliers',
                    tint: AppTints.rose,
                    icon: LucideIcons.arrowUpRight,
                    total: _total(data['payables']),
                    aging: _aging(data['payables']),
                    onTap: () => widget.onOpen('/reports/aging/payables'),
                  ),
                ],
              ),
            ],
            for (final c in _stack([
              if (data != null) PendingActionsCard(data: data, isPrimaryAdmin: widget.session.isPrimaryAdmin, onOpen: widget.onOpen),
              _SalesInsightsCard(api: _api, range: widget.range, onOpen: widget.onOpen),
              if (lowStock.isNotEmpty) _LowStockCard(items: lowStock, onOpen: widget.onOpen),
              if (data != null)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    CashFlowChart(api: _api),
                    const SizedBox(height: AppSpace.md),
                    SalesVsPurchasesChart(api: _api, range: widget.range, onOpen: widget.onOpen),
                  ],
                ),
              CustomizableDashboard(session: widget.session, enabledFeatures: widget.enabledFeatures, onOpen: widget.onOpen),
              _RecentTransactionsFeed(key: _recentKey, api: _api, onOpen: widget.onOpen),
            ]))
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                child: c,
              ),
          ],
        ),
      ),
    );
  }

  List<Widget> _stack(List<Widget> children) {
    final out = <Widget>[];
    for (final c in children) {
      out.add(const SizedBox(height: 28));
      out.add(c);
    }
    return out;
  }
}

/// Big sales number with collected / purchases / profit underneath.
class _SalesHero extends StatelessWidget {
  const _SalesHero({
    required this.sales,
    required this.collection,
    required this.purchases,
    required this.profit,
    required this.onSales,
    required this.onCollection,
    required this.onPurchases,
  });

  final num sales;
  final num collection;
  final num purchases;
  final num profit;
  final VoidCallback onSales;
  final VoidCallback onCollection;
  final VoidCallback onPurchases;

  @override
  Widget build(BuildContext context) {
    return KCard(
      raised: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: onSales,
            highlightColor: AppColors.sunken,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text('Sales', style: AppText.label),
                      const Spacer(),
                      const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                    ],
                  ),
                  const SizedBox(height: 4),
                  KAmount(sales),
                ],
              ),
            ),
          ),
          const Divider(height: 1, thickness: 1, color: AppColors.hairline),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: _HeroStat(label: 'Collected', value: collection, dot: AppColors.positive, onTap: onCollection),
                ),
                const VerticalDivider(width: 1, thickness: 1, color: AppColors.hairline),
                Expanded(
                  child: _HeroStat(label: 'Purchases', value: purchases, dot: AppColors.negative, onTap: onPurchases),
                ),
                const VerticalDivider(width: 1, thickness: 1, color: AppColors.hairline),
                Expanded(
                  child: _HeroStat(
                    label: 'Profit',
                    value: profit,
                    dot: AppTints.indigo.$2,
                    valueColor: profit < 0 ? AppColors.negative : null,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroStat extends StatelessWidget {
  const _HeroStat({required this.label, required this.value, required this.dot, this.valueColor, this.onTap});

  final String label;
  final num value;
  final Color dot;
  final Color? valueColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      highlightColor: AppColors.sunken,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 10, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
                ),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.label.copyWith(fontSize: 12)),
                ),
              ],
            ),
            const SizedBox(height: 4),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                '$rupeeSign${enIn(value, maxFraction: 0)}',
                style: AppText.bodyStrong.copyWith(fontSize: 16, color: valueColor, fontFeatures: AppText.tabular),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Brand band under the app bar: greeting, period chips, and the sales card overlapping its edge.
class _HomeBand extends StatelessWidget {
  const _HomeBand({required this.greeting, required this.range, required this.onRange, required this.hero});

  final String greeting;
  final DashboardRange range;
  final ValueChanged<DashboardRange> onRange;
  final Widget hero;

  /// How much of the hero card hangs below the band.
  static const _overhang = 84.0;

  @override
  Widget build(BuildContext context) {
    final on = AppGradients.on;
    return Stack(
      children: [
        Positioned.fill(
          child: Column(
            children: [
              Expanded(
                child: Container(
                  clipBehavior: Clip.hardEdge,
                  decoration: BoxDecoration(
                    gradient: AppGradients.brand,
                    borderRadius: const BorderRadius.vertical(bottom: Radius.circular(28)),
                  ),
                  child: Stack(
                    children: [
                      // Soft rings for depth.
                      Positioned(right: -60, top: -90, child: _Ring(size: 220, color: on.withValues(alpha: 0.07))),
                      Positioned(right: 40, top: 30, child: _Ring(size: 90, color: on.withValues(alpha: 0.06))),
                      Positioned(left: -40, bottom: -50, child: _Ring(size: 140, color: on.withValues(alpha: 0.05))),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: _overhang),
            ],
          ),
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 6, AppSpace.gutter, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(greeting, style: AppText.label.copyWith(color: on.withValues(alpha: 0.78))),
                  const SizedBox(height: 2),
                  Text(range.title, style: AppText.title.copyWith(color: on)),
                ],
              ),
            ),
            const SizedBox(height: AppSpace.md),
            DateChips(range: range, onChanged: onRange, onDark: true),
            const SizedBox(height: 20),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: hero,
            ),
          ],
        ),
      ],
    );
  }
}

class _Ring extends StatelessWidget {
  const _Ring({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      border: Border.all(color: color, width: 18),
    ),
  );
}

/// Eight colour-coded shortcuts in one card. New bill stays on the floating button.
class _QuickActions extends StatelessWidget {
  const _QuickActions({required this.onOpen});

  final ValueChanged<String> onOpen;

  static const _actions = [
    (LucideIcons.handCoins, 'Collect', 'Record payment', AppTints.green),
    (LucideIcons.shoppingCart, 'Purchase', 'New purchase', AppTints.sky),
    (LucideIcons.receipt, 'Expense', 'Expenses', AppTints.rose),
    (LucideIcons.fileText, 'Quotation', 'New estimate', AppTints.violet),
    (LucideIcons.packagePlus, 'Add item', 'New item', AppTints.amber),
    (LucideIcons.userPlus, 'Add party', 'New party', AppTints.teal),
    (LucideIcons.chartColumn, 'Reports', 'Reports', AppTints.indigo),
    (LucideIcons.packageSearch, 'Low stock', 'Low stock items', AppTints.orange),
  ];

  @override
  Widget build(BuildContext context) {
    return KCard(
      padding: const EdgeInsets.fromLTRB(8, 16, 8, 12),
      child: Column(
        children: [
          for (var row = 0; row < 2; row++) ...[
            if (row > 0) const SizedBox(height: 14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final (icon, label, target, tint) in _actions.skip(row * 4).take(4))
                  Expanded(
                    child: _QuickAction(icon: icon, label: label, tint: tint, onTap: () => onOpen(target)),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({required this.icon, required this.label, required this.tint, required this.onTap});

  final IconData icon;
  final String label;
  final (Color, Color) tint;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(
            children: [
              Container(
                width: 50,
                height: 50,
                decoration: BoxDecoration(color: tint.$1, borderRadius: BorderRadius.circular(16)),
                child: Icon(icon, size: 22, color: tint.$2),
              ),
              const SizedBox(height: 8),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppText.label.copyWith(color: AppColors.ink, fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Swipeable money cards with page dots.
class _MoneyCarousel extends StatefulWidget {
  const _MoneyCarousel({required this.cards});

  final List<Widget> cards;

  @override
  State<_MoneyCarousel> createState() => _MoneyCarouselState();
}

class _MoneyCarouselState extends State<_MoneyCarousel> {
  final _controller = PageController(viewportFraction: 0.88);
  int _page = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: AppSpace.gutter),
          child: KSectionHeader('Money'),
        ),
        SizedBox(
          height: 196,
          child: PageView(
            controller: _controller,
            padEnds: false,
            clipBehavior: Clip.none,
            onPageChanged: (i) => setState(() => _page = i),
            children: [
              for (final (i, card) in widget.cards.indexed)
                Padding(
                  padding: EdgeInsets.only(left: i == 0 ? AppSpace.gutter : 6, right: i == widget.cards.length - 1 ? AppSpace.gutter : 6),
                  child: card,
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var i = 0; i < widget.cards.length; i++)
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: i == _page ? 18 : 6,
                height: 6,
                decoration: BoxDecoration(
                  color: i == _page ? AppColors.brand : AppColors.ink3.withValues(alpha: 0.35),
                  borderRadius: BorderRadius.circular(6),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// Receivables or payables: total, a stacked bar by age, and how much is overdue.
class _MoneyCard extends StatelessWidget {
  const _MoneyCard({
    required this.title,
    required this.caption,
    required this.tint,
    required this.icon,
    required this.total,
    required this.aging,
    required this.onTap,
  });

  final String title;
  final String caption;
  final (Color, Color) tint;
  final IconData icon;
  final num total;
  final Map<String, num> aging;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final current = aging['current']!;
    final early = aging['days_1_15']! + aging['days_16_30']!;
    final late = aging['days_31_45']! + aging['days_45_plus']!;
    final overdue = early + late;
    final sum = current + overdue;
    final segments = [
      (current, AppColors.positive),
      (early, AppColors.warning),
      (late, AppColors.negative),
    ].where((s) => s.$1 > 0).toList();
    return KCard(
      onTap: onTap,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: tint.$1, borderRadius: BorderRadius.circular(12)),
                child: Icon(icon, size: 18, color: tint.$2),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: AppText.bodyStrong),
                    Text(caption, style: AppText.caption.copyWith(fontSize: 12)),
                  ],
                ),
              ),
              if (overdue > 0) KPill(label: '${_compactInr(overdue)} overdue', tone: KTone.negative),
            ],
          ),
          const Spacer(),
          KAmount(total, style: AppText.amount.copyWith(fontSize: 28, height: 34 / 28), maxFraction: 0),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: SizedBox(
              height: 6,
              child: sum <= 0
                  ? const ColoredBox(color: AppColors.sunken)
                  : Row(
                      children: [
                        for (final (i, (v, c)) in segments.indexed) ...[
                          if (i > 0) const SizedBox(width: 2),
                          Expanded(
                            flex: (v / sum * 1000).round().clamp(1, 1000),
                            child: ColoredBox(color: c),
                          ),
                        ],
                      ],
                    ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Wrap(
                  spacing: 12,
                  children: [
                    _Legend(color: AppColors.positive, label: 'Current', value: current),
                    _Legend(color: AppColors.warning, label: '1-30d', value: early),
                    _Legend(color: AppColors.negative, label: '31d+', value: late),
                  ],
                ),
              ),
              Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
            ],
          ),
        ],
      ),
    );
  }
}

/// `SalesInsightsCard`.
class _SalesInsightsCard extends StatefulWidget {
  const _SalesInsightsCard({required this.api, required this.range, required this.onOpen});

  final KhatarioApi api;
  final DashboardRange range;
  final ValueChanged<String> onOpen;

  @override
  State<_SalesInsightsCard> createState() => _SalesInsightsCardState();
}

class _SalesInsightsCardState extends State<_SalesInsightsCard> {
  Map<String, dynamic>? _data;
  bool _loading = true;

  static const _plotHeight = 160.0;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    try {
      final body = await widget.api.getJson('/api/dashboard/sales-trend?start_date=${widget.range.start}&end_date=${widget.range.end}');
      if (mounted) setState(() => _data = body);
    } catch (_) {
      if (mounted) setState(() => _data = null);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String get _subtitle {
    final g = _data?['granularity'];
    if (_data == null) return '';
    if (g == 'hour') return 'Hourly';
    if (g == 'week') return 'Weekly';
    return 'Daily';
  }

  @override
  Widget build(BuildContext context) {
    final summary = _data?['summary'] is Map ? _data!['summary'] as Map : const {};
    final buckets = ((_data?['buckets'] as List?) ?? const []).whereType<Map>().toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KSectionHeader('Sales trend', trailing: _subtitle.isEmpty ? null : Text(_subtitle, style: AppText.caption)),
        KCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_loading)
                const SizedBox(height: 200, child: KSpinner(padding: EdgeInsets.zero))
              else ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: _SummaryStat(label: 'Bills', value: '${toNum(summary['receipt_count']).toInt()}'),
                      ),
                      Expanded(
                        child: _SummaryStat(label: 'Net sales', value: '$rupeeSign${enIn(toNum(summary['net_sales']), maxFraction: 0)}'),
                      ),
                      Expanded(
                        child: _SummaryStat(label: 'Avg bill', value: '$rupeeSign${enIn(toNum(summary['average_sale']), maxFraction: 0)}'),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 8, 12, 8),
                  child: _SalesBars(
                    buckets: buckets,
                    granularity: _data?['granularity']?.toString() ?? 'day',
                    plotHeight: _plotHeight,
                    hourOfDay: widget.range.startDate == widget.range.endDate,
                    onBar: (_) => widget.onOpen('Invoices for this period'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _SummaryStat extends StatelessWidget {
  const _SummaryStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppText.label.copyWith(fontSize: 12)),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular),
        ),
      ],
    );
  }
}

String _compactInr(num value) {
  if (value >= 100000) return '$rupeeSign${(value / 100000).toStringAsFixed(1)}L';
  if (value >= 1000) return '$rupeeSign${(value / 1000).toStringAsFixed(value >= 10000 ? 0 : 1)}k';
  return '$rupeeSign${enIn(value.round())}';
}

/// The SVG bar chart from SalesInsightsCard: an 800-wide viewBox scaled to the card width.
class _SalesBars extends StatelessWidget {
  const _SalesBars({
    required this.buckets,
    required this.granularity,
    required this.plotHeight,
    required this.hourOfDay,
    required this.onBar,
  });

  final List<Map> buckets;
  final String granularity;
  final double plotHeight;
  final bool hourOfDay;
  final ValueChanged<Map> onBar;

  @override
  Widget build(BuildContext context) {
    final hasSales = buckets.any((b) => toNum(b['sales']) > 0);
    if (!hasSales) {
      return SizedBox(
        height: plotHeight,
        child: const Center(
          child: Text(
            'No sales in this period',
            style: TextStyle(fontSize: 14, height: 20 / 14, color: KhatarioColors.muted),
          ),
        ),
      );
    }
    final painter = _BarsPainter(
      buckets: buckets,
      granularity: granularity,
      plotHeight: plotHeight,
      paddingBottom: hourOfDay && granularity == 'hour' ? 22 : 26,
    );
    return AspectRatio(
      aspectRatio: 800 / plotHeight,
      child: LayoutBuilder(
        builder: (context, c) => GestureDetector(
          onTapUp: (d) {
            final hit = painter.bucketAt(d.localPosition.dx * 800 / c.maxWidth, d.localPosition.dy * 800 / c.maxWidth);
            if (hit != null && toNum(hit['sales']) > 0) onBar(hit);
          },
          child: CustomPaint(size: Size(c.maxWidth, c.maxHeight), painter: painter),
        ),
      ),
    );
  }
}

class _BarsPainter extends CustomPainter {
  _BarsPainter({required this.buckets, required this.granularity, required this.plotHeight, required this.paddingBottom});

  final List<Map> buckets;
  final String granularity;
  final double plotHeight;
  final double paddingBottom;

  static const _paddingLeft = 52.0;
  static const _paddingRight = 8.0;
  static const _paddingTop = 2.0;
  static const _width = 800.0;

  double get _chartWidth => _width - _paddingLeft - _paddingRight;
  double get _chartHeight => plotHeight - _paddingTop - paddingBottom;
  double get _barSpacing => _chartWidth / buckets.length;
  double get _barWidth => (_barSpacing * 0.72).clamp(4, 40).toDouble();
  num get _max => buckets.map((b) => toNum(b['sales'])).fold<num>(1, (a, b) => b > a ? b : a);

  Map? bucketAt(double x, double y) {
    for (var i = 0; i < buckets.length; i++) {
      final bx = _paddingLeft + i * _barSpacing + (_barSpacing - _barWidth) / 2;
      if (x >= bx && x <= bx + _barWidth && y >= _paddingTop && y <= _paddingTop + _chartHeight) return buckets[i];
    }
    return null;
  }

  void _text(Canvas canvas, String s, double x, double y, double size, TextAlign align) {
    final tp = TextPainter(
      text: TextSpan(
        text: s,
        style: TextStyle(fontSize: size, color: AppColors.ink3, fontFamily: KhatarioColors.fontFamily),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final dx = switch (align) {
      TextAlign.right || TextAlign.end => x - tp.width,
      TextAlign.center => x - tp.width / 2,
      _ => x,
    };
    tp.paint(canvas, Offset(dx, y - tp.height * 0.8));
  }

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / _width);
    final grid = Paint()
      ..color = AppColors.hairline
      ..strokeWidth = 1;
    final max = _max;
    for (final ratio in const [0.0, 0.25, 0.5, 0.75, 1.0]) {
      final y = _paddingTop + _chartHeight * (1 - ratio);
      canvas.drawLine(Offset(_paddingLeft, y), Offset(_width - _paddingRight, y), grid);
      _text(canvas, _compactInr(max * ratio), _paddingLeft - 8, y + 4, 10, TextAlign.right);
    }
    final labelEvery = granularity == 'hour' ? 4 : (buckets.length / 8).ceil().clamp(1, 1 << 30);
    final bar = Paint()..color = AppColors.brand;
    for (var i = 0; i < buckets.length; i++) {
      final b = buckets[i];
      final v = toNum(b['sales']).toDouble();
      final x = _paddingLeft + i * _barSpacing + (_barSpacing - _barWidth) / 2;
      final h = max > 0 ? (v > 0 ? (v / max * _chartHeight).clamp(2, double.infinity).toDouble() : 0.0) : 0.0;
      final y = _paddingTop + _chartHeight - h;
      if (v > 0) {
        canvas.drawRRect(
          RRect.fromRectAndCorners(
            Rect.fromLTWH(x, y, _barWidth, h),
            topLeft: const Radius.circular(6),
            topRight: const Radius.circular(6),
          ),
          bar,
        );
      }
      if (i % labelEvery == 0 || i == buckets.length - 1) {
        final label = b['label']?.toString() ?? '';
        _text(canvas, granularity == 'hour' ? label.replaceFirst(' ', '') : label, x + _barWidth / 2, plotHeight - 10, 9, TextAlign.center);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _BarsPainter old) => old.buckets != buckets;
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label, required this.value});

  final Color color;
  final String label;
  final num value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3)),
        ),
        const SizedBox(width: 6),
        Text(label, style: AppText.caption.copyWith(fontSize: 12, color: AppColors.ink2)),
        const SizedBox(width: 4),
        Text(
          _compactInr(value),
          style: AppText.small.copyWith(color: AppColors.ink, fontFeatures: AppText.tabular),
        ),
      ],
    );
  }
}

String _trimNumber(num v) => enIn(v, maxFraction: 3).replaceAll(',', '');

String formatStockQuantity(dynamic quantity, String? unit, dynamic packSize, String? packUnit) {
  final baseUnit = (unit ?? 'PCS').trim().isEmpty ? 'PCS' : unit!.trim();
  final qty = num.tryParse('$quantity');
  if (qty == null) return '0 $baseUnit';
  final size = num.tryParse('${packSize ?? ''}');
  final pack = (packUnit ?? '').trim();
  final whole = (qty - qty.round()).abs() < 0.0001;
  if (pack.isEmpty || size == null || size != size.roundToDouble() || size < 2 || !whole) {
    return '${_trimNumber(qty)} $baseUnit';
  }
  final w = qty.round();
  final sign = w < 0 ? '-' : '';
  final abs = w.abs();
  final packs = abs ~/ size.toInt();
  final rem = abs % size.toInt();
  if (packs == 0) return '$sign$rem $baseUnit';
  if (rem == 0) return '$sign$packs $pack';
  return '$sign$packs $pack + $rem $baseUnit';
}

class _LowStockCard extends StatelessWidget {
  const _LowStockCard({required this.items, required this.onOpen});

  final List<Map> items;
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KSectionHeader('Low stock', action: 'See all', onAction: () => onOpen('Low stock items')),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          clipBehavior: Clip.none,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final (i, item) in items.take(8).indexed) ...[
                if (i > 0) const SizedBox(width: 10),
                _LowStockTile(item: item, onOpen: onOpen),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _LowStockTile extends StatelessWidget {
  const _LowStockTile({required this.item, required this.onOpen});

  final Map item;
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context) {
    final out = toNum(item['current_stock']) <= 0;
    final tone = out ? KTone.negative : KTone.due;
    return SizedBox(
      width: 196,
      child: KCard(
        onTap: () => onOpen('Item details'),
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              item['name']?.toString() ?? '',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.bodyStrong.copyWith(fontSize: 14),
            ),
            const SizedBox(height: 8),
            KPill(
              label: formatStockQuantity(item['current_stock'], item['unit']?.toString(), item['pack_size'], item['pack_unit']?.toString()),
              tone: tone,
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Min ${item['min_stock']} ${item['unit'] ?? ''}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.caption.copyWith(fontSize: 12),
                  ),
                ),
                KTextButton(label: 'Restock', onTap: () => _showRestock(context)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _showRestock(BuildContext context) {
    showKSheet<void>(
      context,
      title: 'Restock ${item['name']?.toString() ?? 'item'}',
      builder: (ctx) => _RestockSheet(onContinue: onOpen),
    );
  }
}

class _RestockSheet extends StatefulWidget {
  const _RestockSheet({required this.onContinue});

  final ValueChanged<String> onContinue;

  @override
  State<_RestockSheet> createState() => _RestockSheetState();
}

class _RestockSheetState extends State<_RestockSheet> {
  String? _choice;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KSheetAction(
          icon: LucideIcons.clipboardList,
          label: 'Create purchase order',
          subtitle: 'Order from the supplier. Stock updates when you receive it.',
          selected: _choice == 'purchase_order',
          onTap: () => setState(() => _choice = 'purchase_order'),
        ),
        KSheetAction(
          icon: LucideIcons.shoppingCart,
          label: 'Record purchase',
          subtitle: 'You already bought it. Fill the purchase bill and add stock.',
          selected: _choice == 'purchase',
          onTap: () => setState(() => _choice = 'purchase'),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
          child: KButton(
            label: 'Continue',
            onPressed: _choice == null
                ? null
                : () {
                    Navigator.pop(context);
                    widget.onContinue(_choice == 'purchase_order' ? 'New purchase order' : 'New purchase');
                  },
          ),
        ),
      ],
    );
  }
}

/// `RecentTransactionsFeed`.
class _RecentTransactionsFeed extends StatefulWidget {
  const _RecentTransactionsFeed({super.key, required this.api, required this.onOpen});

  final KhatarioApi api;
  final ValueChanged<String> onOpen;

  @override
  State<_RecentTransactionsFeed> createState() => _RecentTransactionsFeedState();
}

class _RecentTransactionsFeedState extends State<_RecentTransactionsFeed> {
  static const _filters = [
    ('all', 'All'),
    ('invoice', 'Invoice'),
    ('purchase', 'Purchase'),
    ('payment', 'Payment'),
    ('return', 'Return'),
    ('expense', 'Expense'),
  ];
  static const _kindLabel = {
    'invoice': 'Invoice',
    'purchase': 'Purchase',
    'payment_in': 'Payment in',
    'payment_out': 'Payment out',
    'credit_note': 'Credit note',
    'purchase_return': 'Purchase return',
    'expense': 'Expense',
  };
  static const _kindIcon = {
    'invoice': LucideIcons.fileText,
    'purchase': LucideIcons.shoppingCart,
    'payment_in': LucideIcons.arrowDownLeft,
    'payment_out': LucideIcons.arrowUpRight,
    'credit_note': LucideIcons.rotateCcw,
    'purchase_return': LucideIcons.rotateCcw,
    'expense': LucideIcons.wallet,
  };

  String _filter = 'all';
  final _query = TextEditingController();
  String _debounced = '';
  Timer? _debounce;
  List<Map> _rows = [];
  bool _hasMore = false;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    reload();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  Future<void> reload() => _loadPage(append: false, gen: ++_generation);

  void loadMore() {
    if (!_hasMore || _loading || _loadingMore) return;
    _loadPage(append: true, gen: _generation);
  }

  Future<void> _loadPage({required bool append, required int gen}) async {
    final params = <String, String>{'kind': _filter};
    if (_debounced.isNotEmpty) params['q'] = _debounced;
    if (append) {
      if (_rows.isEmpty) return;
      final last = _rows.last;
      params['before'] = DateTime.parse(last['sort_at'].toString()).toUtc().toIso8601String();
      params['before_id'] = last['id'].toString();
      setState(() => _loadingMore = true);
    } else {
      setState(() {
        _rows = [];
        _hasMore = false;
        _loading = true;
      });
    }
    setState(() => _error = null);
    try {
      final q = Uri(queryParameters: params).query;
      final body = await widget.api.getJson('/api/dashboard/recent-transactions?$q');
      if (gen != _generation || !mounted) return;
      final next = ((body['transactions'] as List?) ?? const []).whereType<Map>().toList();
      setState(() {
        _rows = append ? [..._rows, ...next] : next;
        _hasMore = body['hasMore'] == true;
      });
    } on ApiException catch (e) {
      if (gen != _generation || !mounted) return;
      setState(() {
        _error = e.message.isEmpty ? 'Could not load transactions' : e.message;
        if (!append) _rows = [];
        _hasMore = false;
      });
    } catch (_) {
      if (gen != _generation || !mounted) return;
      setState(() {
        _error = 'Could not load transactions';
        if (!append) _rows = [];
        _hasMore = false;
      });
    } finally {
      if (gen == _generation && mounted) {
        setState(() {
          _loading = false;
          _loadingMore = false;
        });
      }
    }
  }

  void _onQuery(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (v.trim() != _debounced) {
        _debounced = v.trim();
        reload();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KSectionHeader('Recent activity'),
        KSearchField(controller: _query, hint: 'Search number or party', onChanged: _onQuery),
        const SizedBox(height: AppSpace.md),
        KChipBar<String>(
          value: _filter,
          options: _filters,
          padding: EdgeInsets.zero,
          onChanged: (id) {
            if (_filter == id) return;
            setState(() => _filter = id);
            reload();
          },
        ),
        const SizedBox(height: AppSpace.md),
        KCard(
          child: _loading
              ? const KSpinner()
              : _error != null
              ? KEmptyState(icon: LucideIcons.cloudOff, title: _error!)
              : _rows.isEmpty
              ? KEmptyState(
                  icon: LucideIcons.receipt,
                  title: _debounced.isNotEmpty || _filter != 'all' ? 'No transactions match this search.' : 'No recent transactions yet.',
                )
              : KDivided(indent: 66, children: [for (final tx in _rows) _txRow(tx)]),
        ),
        if (_loadingMore) const KSpinner(size: 20, padding: EdgeInsets.symmetric(vertical: 16)),
      ],
    );
  }

  Widget _txRow(Map tx) {
    final kind = tx['kind']?.toString() ?? '';
    final doc = tx['doc_number']?.toString() ?? '';
    final docDate = tx['doc_date'] == null ? null : DateTime.tryParse(tx['doc_date'].toString());
    final party = tx['party']?.toString() ?? '';
    final label = _kindLabel[kind] ?? kind;
    final status = tx['status']?.toString() ?? 'final';
    return KListRow(
      onTap: () => widget.onOpen('$label details'),
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(12)),
        child: Icon(_kindIcon[kind] ?? LucideIcons.fileText, size: 18, color: AppColors.ink2),
      ),
      title: party.isEmpty ? label : party,
      subtitle: [if (doc.isNotEmpty) doc else label, docDate == null ? '—' : ddMMMyyyy(docDate.toLocal())].join(' · '),
      trailing: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$rupeeSign${enIn(toNum(tx['amount']))}', style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
          const SizedBox(height: 2),
          KStatusDot.status(status),
        ],
      ),
    );
  }
}

/// `components/ui/StatusBadge.tsx`, drawn as a soft pill.
class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (tone, label) = statusTone(status);
    return KPill(label: label, tone: tone);
  }
}
