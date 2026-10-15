import 'dart:async';
import 'dart:ui' show ImageFilter;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../session.dart';
import '../theme.dart';

/// Where `SubscriptionBanner` renders (`getSubscriptionBannerPlacement`).
enum BannerPlacement { dashboard, compact, hidden }

typedef UsageRow = ({String limitType, int current, int limit, int percent});

/// Data behind the shell banners in `app/(app)/layout.tsx` and the dashboard usage strip:
/// `PromotionBanner`, `PromotionModal`, `SubscriptionBanner`, `SubscriptionUsageBanner`.
class ShellBannersController extends ChangeNotifier {
  ShellBannersController(this.session, {SharedPreferencesAsync? prefs}) : _prefs = prefs ?? SharedPreferencesAsync();

  final AppSession session;
  final SharedPreferencesAsync _prefs;
  KhatarioApi get _api => session.api;

  Map<String, dynamic>? promoBanner;
  Map<String, dynamic>? subscription;
  bool subscriptionDismissed = false;
  List<UsageRow>? usageRows;
  bool usageDismissed = false;
  Timer? _modalTimer;
  final _trackedViews = <String>{};
  bool _disposed = false;

  /// Shown once loaded, via [onModal].
  void Function(Map<String, dynamic> promo)? onModal;

  String? get _businessId => session.businessId;

  void start() {
    if (_businessId == null) return;
    _loadPromoBanner();
    _loadSubscription();
    _modalTimer = Timer(const Duration(seconds: 2), _loadPromoModal);
  }

  @override
  void dispose() {
    _disposed = true;
    _modalTimer?.cancel();
    super.dispose();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<Map<String, dynamic>?> _activePromotion(String type) async {
    try {
      final body = await _api.getJson('/api/promotions/active?business_id=$_businessId&type=$type');
      final list = (body['promotions'] as List?) ?? const [];
      final first = list.isEmpty ? null : list.first;
      return first is Map ? Map<String, dynamic>.from(first) : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> _loadPromoBanner() async {
    final p = await _activePromotion('banner');
    if (p == null) return;
    if (await _prefs.getString('promo_dismissed_${p['id']}') != null) return;
    promoBanner = p;
    _notify();
    if (_trackedViews.add('banner:${p['id']}')) track(p, 'view');
  }

  Future<void> _loadPromoModal() async {
    final p = await _activePromotion('modal');
    if (p == null || _disposed) return;
    if (await _prefs.getString('promo_modal_dismissed_${p['id']}') != null) return;
    if (_trackedViews.add('modal:${p['id']}')) track(p, 'view');
    onModal?.call(p);
  }

  /// `/api/promotions/track`; failures are ignored like the website.
  void track(Map<String, dynamic> promo, String action) {
    _api.postJson('/api/promotions/track', {
      'promotion_id': promo['id'],
      'business_id': _businessId,
      'action': action,
    }).catchError((_) => <String, dynamic>{});
  }

  void dismissPromoBanner() {
    final p = promoBanner;
    if (p == null) return;
    promoBanner = null;
    _notify();
    _prefs.setString('promo_dismissed_${p['id']}', 'true');
    track(p, 'dismiss');
  }

  Future<void> rememberModalDismissed(Map<String, dynamic> promo) =>
      _prefs.setString('promo_modal_dismissed_${promo['id']}', 'true');

  Future<void> _loadSubscription() async {
    try {
      final body = await _api.getJson('/api/subscriptions/current?business_id=$_businessId');
      final sub = body['subscription'];
      if (sub is Map) {
        subscription = Map<String, dynamic>.from(sub);
        _notify();
      }
    } catch (_) {}
  }

  void dismissSubscription() {
    subscriptionDismissed = true;
    _notify();
  }

  static const usageLimitTypes = ['invoices', 'customers', 'items', 'users'];

  /// `useSubscriptionUsage` for the dashboard strip; reloaded each time Home mounts.
  Future<void> loadUsage() async {
    usageRows = null;
    usageDismissed = false;
    try {
      final results = await Future.wait(usageLimitTypes.map((t) async {
        try {
          final d = await _api.getJson('/api/subscriptions/check-limit?business_id=$_businessId&limit_type=$t');
          final current = asNum(d['current'] ?? 0).toInt();
          final limit = asNum(d['limit'] ?? 0).toInt();
          return (limitType: t, current: current, limit: limit, percent: usagePercent(current, limit));
        } on ApiException {
          return null;
        }
      }));
      usageRows = results.whereType<UsageRow>().where((r) => shouldShowUsageNudge(r.current, r.limit)).toList();
    } on DioException {
      usageRows = const [];
    }
    _notify();
  }

  void dismissUsage() {
    usageDismissed = true;
    _notify();
  }
}

/// `usagePercent` in `lib/subscription/usage-labels.ts`.
int usagePercent(int current, int max) {
  if (max == -1) return 0;
  if (max <= 0) return 100;
  return ((current / max) * 100).round().clamp(0, 100);
}

/// `shouldShowUsageNudge`: 80% of a finite limit.
bool shouldShowUsageNudge(int current, int max) {
  if (max == -1) return false;
  if (max <= 0) return current > 0;
  return usagePercent(current, max) >= 80;
}

/// Opens a promotion button target (`button_action`).
void openPromotion(Map<String, dynamic> promo, ValueChanged<String> onOpen) {
  final url = promo['button_url']?.toString();
  switch (promo['button_action']) {
    case 'link' when url != null && url.isNotEmpty:
      final uri = Uri.tryParse(url);
      final host = uri?.host ?? '';
      if (uri != null && (url.startsWith('/') || host == 'khatario.com' || host == 'www.khatario.com' || host == 'staging.khatario.com')) {
        final path = url.startsWith('/') ? url : '${uri.path}${uri.hasQuery ? '?${uri.query}' : ''}';
        onOpen(path);
      } else {
        launchUrl(uri ?? Uri.parse(url), mode: LaunchMode.externalApplication);
      }
    case 'route' when url != null && url.isNotEmpty:
      onOpen(url);
    case 'upgrade_modal':
      onOpen('Settings');
  }
}

Color _hex(Object? raw, Color fallback) {
  final hex = PortalTheme.parseHex(raw);
  return hex == null ? fallback : Color(0xFF000000 | int.parse(hex.substring(1), radix: 16));
}

/// Layout-level banners above the page: `SubscriptionBanner` then `PromotionBanner`.
class ShellBanners extends StatelessWidget {
  const ShellBanners({
    super.key,
    required this.controller,
    required this.placement,
    required this.onOpen,
    this.usageStrip = false,
  });

  final ShellBannersController controller;
  final BannerPlacement placement;
  final ValueChanged<String> onOpen;

  /// `GlobalSubscriptionUsageStrip`: pages without their own usage banner.
  final bool usageStrip;

  @override
  Widget build(BuildContext context) {
    if (controller.session.isConnectAgent || placement == BannerPlacement.hidden) return const SizedBox.shrink();
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final promo = controller.promoBanner;
        final rows = usageStrip ? controller.usageRows : null;
        final worst = rows == null || rows.isEmpty ? null : rows.reduce((acc, r) => r.percent > acc.percent ? r : acc);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (!controller.subscriptionDismissed && controller.subscription != null)
              SubscriptionBanner(
                subscription: controller.subscription!,
                compact: placement == BannerPlacement.compact,
                onUpgrade: () => onOpen('Subscription'),
                onDismiss: controller.dismissSubscription,
              ),
            if (worst != null)
              InlineUsageBanner(
                key: ValueKey('usage-strip-${worst.limitType}'),
                session: controller.session,
                limitType: worst.limitType,
                onViewPlans: () => onOpen('Subscription'),
                topGap: 0,
              ),
            if (promo != null)
              PromotionBanner(
                promo: promo,
                onTap: () {
                  controller.track(promo, 'click');
                  openPromotion(promo, onOpen);
                },
                onDismiss: controller.dismissPromoBanner,
              ),
          ],
        );
      },
    );
  }
}

/// `components/promotions/PromotionBanner.tsx` at the mobile breakpoint.
class PromotionBanner extends StatelessWidget {
  const PromotionBanner({super.key, required this.promo, required this.onTap, required this.onDismiss});

  final Map<String, dynamic> promo;
  final VoidCallback onTap;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final bg = _hex(promo['background_color'], const Color(0xFF3B82F6));
    final fg = _hex(promo['text_color'], Colors.white);
    final buttonText = promo['button_text']?.toString() ?? '';
    return Container(
      margin: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xs),
      padding: const EdgeInsets.fromLTRB(16, 10, 6, 10),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(AppRadius.lg)),
      child: Row(
        children: [
          Expanded(
            child: Text(
              promo['title']?.toString() ?? '',
              style: TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w700, color: fg),
            ),
          ),
          const SizedBox(width: 8),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (buttonText.isNotEmpty)
                _TapTarget44(
                  onTap: onTap,
                  child: Container(
                    height: 32,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(999),
                      boxShadow: const [BoxShadow(color: Color(0x0D000000), offset: Offset(0, 1), blurRadius: 2)],
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(buttonText,
                            style: TextStyle(fontSize: 12, height: 16 / 12, fontWeight: FontWeight.w700, color: bg)),
                        const SizedBox(width: 4),
                        Icon(promo['button_action'] == 'link' ? LucideIcons.externalLink : LucideIcons.arrowRight,
                            size: 12, color: bg),
                      ],
                    ),
                  ),
                ),
              if (buttonText.isNotEmpty && promo['dismissible'] == true) const SizedBox(width: 4),
              if (promo['dismissible'] == true)
                _TapTarget44(
                  onTap: onDismiss,
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: Icon(LucideIcons.x, size: 16, color: fg.withValues(alpha: 0.8)),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TapTarget44 extends StatelessWidget {
  const _TapTarget44({required this.onTap, required this.child});

  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) => GestureDetector(behavior: HitTestBehavior.opaque, onTap: onTap, child: child);
}

/// `components/subscription/SubscriptionBanner.tsx`.
class SubscriptionBanner extends StatelessWidget {
  const SubscriptionBanner({
    super.key,
    required this.subscription,
    required this.compact,
    required this.onUpgrade,
    required this.onDismiss,
    this.now,
  });

  final Map<String, dynamic> subscription;
  final bool compact;
  final VoidCallback onUpgrade;
  final VoidCallback onDismiss;
  final DateTime? now;

  /// Banner type and days remaining, in the website's order of checks.
  static (String, int, String)? state(Map<String, dynamic> sub, DateTime now) {
    DateTime? parse(Object? v) => v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
    final end = parse(sub['end_date']);
    if (sub['cancel_at_period_end'] == true && end != null && end.isAfter(now)) {
      return ('cancelled', 0, DateFormat('d MMM y').format(end));
    }
    if (sub['show_trial_extension_modal'] == true) return null;
    final grace = parse(sub['grace_period_end']);
    if (grace != null) {
      if (grace.isAfter(now)) {
        return ('grace_expiring', (grace.difference(now).inMilliseconds / 86400000).ceil(), '');
      }
      if ((sub['status'] == 'expired' || sub['plan_id'] == 'free') && sub['downgraded_from'] != null) {
        return ('grace_expired', 0, '');
      }
    }
    final trialRaw = sub['trial_end_date']?.toString();
    if (trialRaw != null && trialRaw.isNotEmpty) {
      final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(trialRaw.length >= 10 ? trialRaw.substring(0, 10) : trialRaw);
      final trialEnd = m != null
          ? DateTime(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!))
          : DateTime.tryParse(trialRaw)?.toLocal();
      if (trialEnd == null) return null;
      final today = DateTime(now.year, now.month, now.day);
      final days = (trialEnd.difference(today).inMilliseconds / 86400000).ceil();
      if (days < 0) return ('trial_expired', 0, '');
      if (days <= 7) return ('trial_ending', days, '');
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final s = state(subscription, now ?? DateTime.now());
    if (s == null) return const SizedBox.shrink();
    final (type, days, cancelDate) = s;
    if (compact && type != 'trial_ending' && type != 'grace_expiring') return const SizedBox.shrink();
    final plural = days != 1 ? 's' : '';
    final (bg, border, fg, icon, message, cta) = switch (type) {
      'trial_ending' => (
          Tw.yellow50,
          Tw.yellow300,
          Tw.yellow800,
          LucideIcons.clock,
          days == 0
              ? 'Today is the last day of your trial. Upgrade to keep full access.'
              : 'Your trial ends in $days day$plural. Upgrade to keep full access.',
          'Upgrade Now',
        ),
      'trial_expired' => (
          Tw.orange50,
          Tw.orange300,
          Tw.orange800,
          LucideIcons.triangleAlert,
          'Your trial has expired. You are on the Free plan — upgrade anytime to restore full access.',
          'Upgrade Now',
        ),
      'grace_expiring' => (
          Tw.orange50,
          Tw.orange400,
          Tw.orange900,
          LucideIcons.triangleAlert,
          'Grace period: $days day$plural remaining. After this, your account will be restricted to the free plan.',
          'Upgrade Now',
        ),
      'grace_expired' => (
          Tw.red50,
          Tw.red300,
          Tw.red800,
          LucideIcons.shield,
          'Your account has been restricted to the free plan. Upgrade to restore full access.',
          'Upgrade',
        ),
      _ => (
          Tw.blue50,
          Tw.blue300,
          Tw.blue800,
          LucideIcons.clock,
          'Your subscription will end on $cancelDate. You have full access until then.',
          'Reactivate',
        ),
    };
    final size = compact ? 12.0 : 14.0;
    final lh = compact ? 16 / 12 : 20 / 14;
    return Container(
      padding: compact ? const EdgeInsets.symmetric(horizontal: 12, vertical: 6) : const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(color: bg, border: Border(bottom: BorderSide(color: border))),
      child: Row(
        children: [
          Expanded(
            child: Row(
              children: [
                Icon(icon, size: 16, color: fg),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    compact ? 'Trial ends in ${days}d — upgrade to keep access' : message,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: size, height: lh, fontWeight: FontWeight.w500, color: fg),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: onUpgrade,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(cta, style: TextStyle(fontSize: size, height: lh, fontWeight: FontWeight.w600, color: fg)),
                if (!compact) ...[const SizedBox(width: 2), Icon(LucideIcons.arrowRight, size: 14, color: fg)],
              ],
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: onDismiss,
            child: Padding(
              padding: const EdgeInsets.all(2),
              child: Icon(LucideIcons.x, size: compact ? 14 : 16, color: fg.withValues(alpha: 0.6)),
            ),
          ),
        ],
      ),
    );
  }
}

/// `SubscriptionUsageBanner` variant "dashboard": compact strip under the page header.
class UsageStrip extends StatelessWidget {
  const UsageStrip({super.key, required this.controller, required this.onUpgrade});

  final ShellBannersController controller;
  final VoidCallback onUpgrade;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final rows = controller.usageRows;
        if (rows == null || rows.isEmpty || controller.usageDismissed) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(top: 12),
          child: _UpgradeStrip(rows: rows, onUpgrade: onUpgrade, onDismiss: controller.dismissUsage),
        );
      },
    );
  }
}

/// What upgrading unlocks for each plan limit. Leads with the benefit, not the limit.
String _upgradeBenefit(String limitType) => switch (limitType) {
      'users' => 'Bring your whole team on board',
      'invoices' => 'Keep billing without limits',
      'customers' => 'Add as many customers as you like',
      'items' => 'List your full product range',
      'branches' => 'Run more branches from one app',
      'suppliers' => 'Work with more suppliers',
      _ => 'Unlock more with a bigger plan',
    };

/// Full-width upsell strip: rotating benefit lines, a pulsing sparkle and a shimmering Upgrade pill.
class _UpgradeStrip extends StatefulWidget {
  const _UpgradeStrip({required this.rows, required this.onUpgrade, required this.onDismiss});

  final List<UsageRow> rows;
  final VoidCallback onUpgrade;
  final VoidCallback onDismiss;

  @override
  State<_UpgradeStrip> createState() => _UpgradeStripState();
}

class _UpgradeStripState extends State<_UpgradeStrip> with SingleTickerProviderStateMixin {
  static const _ink = Color(0xFF6B3500);
  static const _cta = [Color(0xFFF58220), Color(0xFFE5600B)];

  /// Plays once on show and again each time the line changes, so the strip catches the eye without looping.
  late final _shine = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..forward();
  Timer? _timer;
  int _line = 0;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 3600), (_) {
      if (!mounted) return;
      setState(() => _line++);
      _shine.forward(from: 0);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _shine.dispose();
    super.dispose();
  }

  List<String> get _lines {
    final worst = widget.rows.reduce((acc, r) => r.percent > acc.percent ? r : acc);
    final atLimit = worst.limit != -1 && worst.current >= worst.limit;
    final cap = worst.limit == -1 ? 'unlimited' : '${worst.limit}';
    return [
      _upgradeBenefit(worst.limitType),
      atLimit
          ? '${worst.current} of $cap ${worst.limitType} used on your plan'
          : "You're growing fast: ${worst.percent}% of your ${worst.limitType} used",
      'Upgrade in a minute, keep everything you have',
    ];
  }

  @override
  Widget build(BuildContext context) {
    final lines = _lines;
    final text = lines[_line % lines.length];
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(colors: [Color(0xFFFFF3DD), Color(0xFFFFE6CC)]),
      ),
      padding: const EdgeInsets.fromLTRB(16, 10, 4, 10),
      child: Row(
        children: [
          AnimatedBuilder(
            animation: _shine,
            builder: (_, child) {
              final t = _shine.value;
              final pulse = 1 + 0.12 * (t < 0.5 ? t * 2 : (1 - t) * 2);
              return Transform.scale(scale: pulse, child: child);
            },
            child: Container(
              width: 32,
              height: 32,
              decoration: const BoxDecoration(color: Color(0x33F58220), shape: BoxShape.circle),
              child: const Icon(LucideIcons.sparkles, size: 17, color: Color(0xFFE5600B)),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: ClipRect(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 420),
                switchInCurve: Curves.easeOutCubic,
                switchOutCurve: Curves.easeInCubic,
                transitionBuilder: (child, animation) => FadeTransition(
                  opacity: animation,
                  child: SlideTransition(
                    position: Tween(begin: const Offset(0, 0.6), end: Offset.zero).animate(animation),
                    child: child,
                  ),
                ),
                layoutBuilder: (current, previous) => Stack(alignment: Alignment.centerLeft, children: [...previous, ?current]),
                child: Text(
                  text,
                  key: ValueKey(text),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13, height: 17 / 13, fontWeight: FontWeight.w600, color: _ink),
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Semantics(
            button: true,
            label: 'Upgrade plan',
            excludeSemantics: true,
            child: GestureDetector(
              onTap: widget.onUpgrade,
              child: Container(
                height: 34,
                clipBehavior: Clip.antiAlias,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(colors: _cta),
                  borderRadius: BorderRadius.circular(999),
                  boxShadow: const [BoxShadow(color: Color(0x40E5600B), blurRadius: 10, offset: Offset(0, 4))],
                ),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 14),
                      child: Text('Upgrade', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white)),
                    ),
                    Positioned.fill(
                      child: IgnorePointer(
                        child: AnimatedBuilder(
                          animation: _shine,
                          builder: (_, _) => FractionalTranslation(
                            translation: Offset(-1.2 + _shine.value * 2.8, 0),
                            child: Transform.rotate(
                              angle: 0.35,
                              child: Container(
                                decoration: const BoxDecoration(
                                  gradient: LinearGradient(colors: [Color(0x00FFFFFF), Color(0x66FFFFFF), Color(0x00FFFFFF)]),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Semantics(
            button: true,
            label: 'Dismiss',
            excludeSemantics: true,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: widget.onDismiss,
              child: SizedBox(width: 36, height: 40, child: Icon(LucideIcons.x, size: 16, color: _ink.withValues(alpha: 0.55))),
            ),
          ),
        ],
      ),
    );
  }
}

/// `SubscriptionUsageBanner` variant "inline" for one limit on a list page (12px above it when shown).
class InlineUsageBanner extends StatefulWidget {
  const InlineUsageBanner({
    super.key,
    required this.session,
    required this.limitType,
    required this.onViewPlans,
    this.topGap = 12,
  });

  final AppSession session;
  final String limitType;
  final VoidCallback onViewPlans;
  final double topGap;

  @override
  State<InlineUsageBanner> createState() => _InlineUsageBannerState();
}

class _InlineUsageBannerState extends State<InlineUsageBanner> {
  static const _short = {'invoices': 'invoices', 'customers': 'customers', 'items': 'items', 'users': 'users'};

  UsageRow? _row;
  Map<String, dynamic>? _plan;
  bool _dismissed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = widget.session.api;
    final businessId = widget.session.businessId;
    try {
      final d = await api.getJson('/api/subscriptions/check-limit?business_id=$businessId&limit_type=${widget.limitType}');
      final current = asNum(d['current'] ?? 0).toInt();
      final limit = asNum(d['limit'] ?? 0).toInt();
      if (!shouldShowUsageNudge(current, limit)) return;
      final row = (limitType: widget.limitType, current: current, limit: limit, percent: usagePercent(current, limit));
      if (mounted) setState(() => _row = row);
      final p = await api.getJson(
          '/api/subscriptions/limit-plan?business_id=$businessId&limit_type=${widget.limitType}&current=$current');
      final plan = p['recommendedPlan'];
      if (mounted && plan is Map) setState(() => _plan = Map<String, dynamic>.from(plan));
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final row = _row;
    if (row == null || _dismissed) return const SizedBox.shrink();
    final critical = row.limit != -1 && row.current >= row.limit;
    final short = _short[row.limitType] ?? row.limitType;
    final plan = _plan;
    final planLimit = plan == null ? 0 : asNum(plan['planLimit']).toInt();
    final planLimitText = planLimit == -1 ? 'unlimited' : (row.limitType == 'invoices' ? '$planLimit/month' : '$planLimit');
    final hint = plan != null
        ? '${plan['planLabel']} (₹${plan['priceMonthly']}/mo) gives you $planLimitText $short.'
        : 'A bigger plan gives you more room.';
    const ink = Color(0xFF6B3500);
    return Padding(
      padding: EdgeInsets.only(top: widget.topGap),
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 12, 4, 12),
        decoration: BoxDecoration(
          gradient: const LinearGradient(colors: [Color(0xFFFFF3DD), Color(0xFFFFE6CC)]),
          borderRadius: BorderRadius.circular(AppRadius.lg),
        ),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: const BoxDecoration(color: Color(0x33F58220), shape: BoxShape.circle),
              child: const Icon(LucideIcons.sparkles, size: 17, color: Color(0xFFE5600B)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _upgradeBenefit(row.limitType),
                    style: const TextStyle(fontSize: 14, height: 19 / 14, fontWeight: FontWeight.w700, color: ink),
                  ),
                  const SizedBox(height: 2),
                  Text.rich(
                    TextSpan(children: [
                      TextSpan(
                        text: '${row.current}/${row.limit == -1 ? '∞' : row.limit} $short',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      TextSpan(text: ' — ${critical ? 'limit reached' : '${row.percent}% used'}. $hint'),
                    ]),
                    style: TextStyle(fontSize: 12, height: 16 / 12, color: ink.withValues(alpha: 0.8)),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Semantics(
              container: true,
              button: true,
              label: 'View plans',
              excludeSemantics: true,
              child: GestureDetector(
                onTap: widget.onViewPlans,
                child: Container(
                  height: 32,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(colors: [Color(0xFFF58220), Color(0xFFE5600B)]),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const Text('Upgrade', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.white)),
                ),
              ),
            ),
            Semantics(
              container: true,
              button: true,
              label: 'Dismiss',
              excludeSemantics: true,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => setState(() => _dismissed = true),
                child: SizedBox(width: 32, height: 40, child: Icon(LucideIcons.x, size: 15, color: ink.withValues(alpha: 0.55))),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// `components/promotions/PromotionModal.tsx`.
Future<void> showPromotionModal(
  BuildContext context, {
  required Map<String, dynamic> promo,
  required ShellBannersController controller,
  required ValueChanged<String> onOpen,
}) {
  return showGeneralDialog(
    context: context,
    barrierDismissible: false,
    barrierColor: Colors.transparent,
    pageBuilder: (ctx, _, _) => _PromotionModal(promo: promo, controller: controller, onOpen: onOpen),
  );
}

class _PromotionModal extends StatefulWidget {
  const _PromotionModal({required this.promo, required this.controller, required this.onOpen});

  final Map<String, dynamic> promo;
  final ShellBannersController controller;
  final ValueChanged<String> onOpen;

  @override
  State<_PromotionModal> createState() => _PromotionModalState();
}

class _PromotionModalState extends State<_PromotionModal> {
  bool _dontShowAgain = false;

  Map<String, dynamic> get _promo => widget.promo;

  void _finish(String action) {
    widget.controller.track(_promo, action);
    if (_dontShowAgain || _promo['show_once_per_business'] == true) widget.controller.rememberModalDismissed(_promo);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final bg = _hex(_promo['background_color'], KhatarioColors.primary600);
    final fg = _hex(_promo['text_color'], Colors.white);
    final title = _promo['title']?.toString() ?? '';
    final image = _promo['image_url']?.toString();
    final description = _promo['description']?.toString();
    final buttonText = _promo['button_text']?.toString() ?? '';
    const titleStyle = TextStyle(fontSize: 24, height: 1.25, fontWeight: FontWeight.w900, color: Colors.white);
    return Stack(
      children: [
        Positioned.fill(
          child: GestureDetector(
            onTap: () => _finish('dismiss'),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 4, sigmaY: 4),
              child: const ColoredBox(color: Color(0x99000000)),
            ),
          ),
        ),
        Center(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 512),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: const [BoxShadow(color: Color(0x40000000), offset: Offset(0, 25), blurRadius: 50, spreadRadius: -12)],
                ),
                child: Material(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                  clipBehavior: Clip.antiAlias,
                  child: Stack(
                    children: [
                      Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (image != null && image.isNotEmpty)
                            SizedBox(
                              height: 224,
                              child: Stack(
                                fit: StackFit.expand,
                                children: [
                                  Image.network(image, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox()),
                                  const DecoratedBox(
                                    decoration: BoxDecoration(
                                      gradient: LinearGradient(
                                        begin: Alignment.bottomCenter,
                                        end: Alignment.topCenter,
                                        colors: [Color(0x99000000), Color(0x00000000)],
                                      ),
                                    ),
                                  ),
                                  Positioned(left: 24, right: 24, bottom: 24, child: Text(title, style: titleStyle)),
                                ],
                              ),
                            )
                          else
                            Container(
                              color: bg,
                              padding: const EdgeInsets.fromLTRB(32, 32, 32, 16),
                              child: Text(title, style: titleStyle),
                            ),
                          Padding(
                            padding: const EdgeInsets.fromLTRB(32, 24, 32, 32),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (description != null && description.isNotEmpty) ...[
                                  Text(description, style: const TextStyle(fontSize: 16, height: 1.625, color: Tw.gray600)),
                                  const SizedBox(height: 24),
                                ],
                                if (buttonText.isNotEmpty) ...[
                                  GestureDetector(
                                    onTap: () {
                                      _finish('click');
                                      openPromotion(_promo, widget.onOpen);
                                    },
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(vertical: 16),
                                      decoration: BoxDecoration(
                                        color: bg,
                                        borderRadius: BorderRadius.circular(16),
                                        boxShadow: [
                                          BoxShadow(color: KhatarioColors.primary200, offset: const Offset(0, 10), blurRadius: 15, spreadRadius: -3),
                                          BoxShadow(color: KhatarioColors.primary200, offset: const Offset(0, 4), blurRadius: 6, spreadRadius: -4),
                                        ],
                                      ),
                                      child: Row(
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        children: [
                                          Text(buttonText,
                                              style: TextStyle(fontSize: 18, height: 28 / 18, fontWeight: FontWeight.w700, color: fg)),
                                          const SizedBox(width: 8),
                                          Icon(_promo['button_action'] == 'link' ? LucideIcons.externalLink : LucideIcons.arrowRight,
                                              size: 20, color: fg),
                                        ],
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 16),
                                ],
                                Padding(
                                  padding: const EdgeInsets.only(top: 8),
                                  child: Row(
                                    children: [
                                      GestureDetector(
                                        onTap: () => setState(() => _dontShowAgain = !_dontShowAgain),
                                        child: Row(
                                          children: [
                                            SizedBox(
                                              width: 16,
                                              height: 16,
                                              child: Checkbox(
                                                value: _dontShowAgain,
                                                onChanged: (v) => setState(() => _dontShowAgain = v ?? false),
                                                activeColor: KhatarioColors.primary600,
                                                side: const BorderSide(color: Tw.gray300),
                                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                                                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                                visualDensity: VisualDensity.compact,
                                              ),
                                            ),
                                            const SizedBox(width: 8),
                                            const Text("Don't show again",
                                                style: TextStyle(fontSize: 14, height: 20 / 14, color: Tw.gray500)),
                                          ],
                                        ),
                                      ),
                                      const Spacer(),
                                      GestureDetector(
                                        onTap: () => _finish('dismiss'),
                                        child: const Text('Maybe later',
                                            style: TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w600, color: Tw.gray400)),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      Positioned(
                        top: 16,
                        right: 16,
                        child: GestureDetector(
                          onTap: () => _finish('dismiss'),
                          child: Container(
                            padding: const EdgeInsets.all(8),
                            decoration: const BoxDecoration(color: Color(0x33000000), shape: BoxShape.circle),
                            child: const Icon(LucideIcons.x, size: 20, color: Colors.white),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
