import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../api.dart';
import 'upgrade_copy.dart';

const _orange = Color(0xFFF58220);
const _green = Color(0xFF032B23);
const _paper = Color(0xFFFFFDF9);
const _body = Color(0xFF5C5247);
const _muted = Color(0xFF8A7B6B);
const _box = Color(0xFFF6F0E8);

/// "Maybe later" choices for this run of the app.
final upgradeSnooze = UpgradeSnooze();
bool _sheetOpen = false;

/// Opens the upgrade sheet unless one is open or the user said "Maybe later" today. The phone has
/// no checkout yet, so the button opens the plan screen.
Future<void> showUpgradeSheet(
  BuildContext context, {
  required UpgradeRequest request,
  required KhatarioApi api,
  required VoidCallback onSeePlans,
  String? businessId,
}) async {
  if (_sheetOpen || upgradeSnooze.isSnoozed(request, DateTime.now())) return;
  _sheetOpen = true;
  try {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => UpgradeSheet(request: request, api: api, onSeePlans: onSeePlans, businessId: businessId),
    );
  } finally {
    _sheetOpen = false;
  }
}

class UpgradeSheet extends StatefulWidget {
  const UpgradeSheet({super.key, required this.request, required this.api, required this.onSeePlans, this.businessId});

  final UpgradeRequest request;
  final KhatarioApi api;
  final VoidCallback onSeePlans;
  final String? businessId;

  @override
  State<UpgradeSheet> createState() => _UpgradeSheetState();
}

class _UpgradeSheetState extends State<UpgradeSheet> {
  RecommendedPlan? _plan;

  @override
  void initState() {
    super.initState();
    _loadPlan();
  }

  Future<void> _loadPlan() async {
    final req = widget.request;
    try {
      Map<String, dynamic>? p;
      if ((req.variant == UpgradeVariant.feature || req.variant == UpgradeVariant.addon) && req.featureKey != null) {
        final d = await widget.api.getJson('/api/subscriptions/feature-plan?feature_key=${Uri.encodeQueryComponent(req.featureKey!)}');
        p = d['requiredPlan'] is Map ? Map<String, dynamic>.from(d['requiredPlan'] as Map) : null;
      } else if (req.variant == UpgradeVariant.limit && req.limitType != null) {
        final business = widget.businessId == null ? '' : '&business_id=${Uri.encodeQueryComponent(widget.businessId!)}';
        final d = await widget.api.getJson(
          '/api/subscriptions/limit-plan?limit_type=${req.limitType}&current=${req.current ?? req.limit ?? 0}$business',
        );
        p = d['recommendedPlan'] is Map ? Map<String, dynamic>.from(d['recommendedPlan'] as Map) : null;
      }
      if (p == null || !mounted) return;
      setState(() => _plan = RecommendedPlan(
            planId: p!['planId']?.toString() ?? '',
            planLabel: p['planDisplayName']?.toString() ?? '',
            priceMonthly: asNum(p['priceMonthly']),
            planLimit: p['planLimit'] is num ? (p['planLimit'] as num).toInt() : null,
          ));
    } catch (_) {
      // No plan suggestion: the sheet still explains and offers the plan screen.
    }
  }

  @override
  Widget build(BuildContext context) {
    final req = widget.request;
    final copy = buildUpgradeCopy(req, _plan);
    final plan = _plan;
    return Container(
      decoration: const BoxDecoration(color: _paper, borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      padding: EdgeInsets.fromLTRB(16, 10, 16, 16 + MediaQuery.of(context).padding.bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 34,
                height: 4,
                decoration: BoxDecoration(color: const Color(0xFFE3D3C0), borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: SvgPicture.string(upgradeIllustrationSvg(copy), fit: BoxFit.fitWidth),
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                decoration: BoxDecoration(color: const Color(0xFFFEECDE), borderRadius: BorderRadius.circular(99)),
                child: Text(copy.tag, style: const TextStyle(fontSize: 11, color: Color(0xFF8E4B13), fontWeight: FontWeight.w500)),
              ),
            ),
            const SizedBox(height: 8),
            Text(copy.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: _green, height: 1.3)),
            const SizedBox(height: 6),
            Text(copy.body, style: const TextStyle(fontSize: 13, color: _body, height: 1.45)),
            const SizedBox(height: 12),
            ..._detail(req, copy, plan),
            if (plan != null) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF8F1),
                  border: Border.all(color: _orange, width: 1.5),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Recommended for you', style: TextStyle(fontSize: 11, color: Color(0xFFB05E17))),
                    Text(
                      plan.priceMonthly > 0 ? '${plan.planLabel} · ₹${plan.priceMonthly}/month' : plan.planLabel,
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: _green),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
            ],
            SizedBox(
              height: 44,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: _orange,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                onPressed: () {
                  Navigator.pop(context);
                  widget.onSeePlans();
                },
                child: const Text('See plans', style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: Colors.white)),
              ),
            ),
            TextButton(
              onPressed: () {
                upgradeSnooze.snooze(req, DateTime.now());
                Navigator.pop(context);
              },
              child: Text(copy.laterLabel, style: const TextStyle(color: _muted, fontSize: 13)),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _detail(UpgradeRequest req, UpgradeCopy copy, RecommendedPlan? plan) {
    Widget box(List<Widget> children) => Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(color: _box, borderRadius: BorderRadius.circular(12)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
        );

    final limit = req.limit;
    if (req.variant == UpgradeVariant.limit && limit != null && limit > 0) {
      final used = (req.current ?? limit).clamp(0, limit);
      return [
        box([
          Row(children: [
            const Expanded(child: Text('Used', style: TextStyle(fontSize: 12, color: _body))),
            Text('$used of $limit', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFFB05E17))),
          ]),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: used / limit,
              minHeight: 7,
              backgroundColor: const Color(0xFFEADFD2),
              color: _orange,
            ),
          ),
        ]),
      ];
    }
    if (copy.benefits.isNotEmpty) {
      return [
        box([
          for (final b in copy.benefits)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(children: [
                const Icon(Icons.check_circle_outline, size: 15, color: Color(0xFF1F9D6A)),
                const SizedBox(width: 6),
                Expanded(child: Text(b, style: const TextStyle(fontSize: 12.5, color: Color(0xFF3D3A35)))),
              ]),
            ),
        ]),
      ];
    }
    return const [];
  }
}

String _esc(String s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

String _clip(String s, int max) => s.length > max ? '${s.substring(0, max - 1)}…' : s;

const _icons = <String, String>{
  'chart': '<rect x="6" y="13" width="3" height="5" rx="1" fill="#fff"/><rect x="10" y="10" width="3" height="8" rx="1" fill="#fff"/><rect x="14" y="6" width="3" height="12" rx="1" fill="#fff"/>',
  'rupee': '<path d="M7 6h9M7 9.5h9M8 6c5 0 5 7 0 7l6 5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  'users': '<circle cx="11.5" cy="8.5" r="3" fill="#fff"/><rect x="6" y="12.5" width="11" height="6" rx="3" fill="#fff"/>',
  'lock': '<rect x="7" y="10" width="9" height="7" rx="1.5" fill="#fff"/><path d="M9 10V8a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="#fff" stroke-width="1.6"/>',
  'chat': '<rect x="5" y="6" width="13" height="9" rx="3" fill="#fff"/><path d="M8 15l-1 3 4-3z" fill="#fff"/>',
  'bolt': '<path d="M13 4l-6 9h4l-1 6 6-9h-4z" fill="#fff"/>',
  'clock': '<circle cx="11.5" cy="11.5" r="6" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M11.5 8.5v3l2 1.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
  'check': '<path d="M7 12l3 3 6-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  'phone': '<rect x="8" y="5" width="7.5" height="13" rx="1.8" fill="#fff"/>',
  'box': '<rect x="6" y="9" width="11" height="9" rx="1" fill="#fff"/><path d="M6 9l5.5-3 5.5 3" fill="none" stroke="#fff" stroke-width="1.5"/>',
};

const _objects = <UpgradeArt, String>{
  UpgradeArt.bill:
      '<rect x="40" y="10" width="40" height="52" rx="5" fill="#fff"/><rect x="46" y="17" width="18" height="4" rx="2" fill="#032B23"/><rect x="46" y="26" width="28" height="3" rx="1.5" fill="#eadfd2"/><rect x="46" y="33" width="24" height="3" rx="1.5" fill="#eadfd2"/><rect x="46" y="40" width="28" height="3" rx="1.5" fill="#eadfd2"/><rect x="58" y="50" width="16" height="4" rx="2" fill="#F58220"/>',
  UpgradeArt.users:
      '<circle cx="50" cy="28" r="9" fill="#fff"/><rect x="36" y="40" width="28" height="20" rx="10" fill="#fff"/><circle cx="72" cy="30" r="7" fill="#fef6ef" stroke="#d9c6b0" stroke-dasharray="2 2"/><rect x="61" y="40" width="22" height="16" rx="8" fill="#fef6ef" stroke="#d9c6b0" stroke-dasharray="2 2"/>',
  UpgradeArt.chat:
      '<rect x="34" y="14" width="46" height="30" rx="8" fill="#fff"/><path d="M44 44l-4 9 11-9z" fill="#fff"/><rect x="41" y="22" width="26" height="3.5" rx="1.75" fill="#032B23"/><rect x="41" y="30" width="32" height="3" rx="1.5" fill="#eadfd2"/><rect x="56" y="38" width="30" height="20" rx="7" fill="#1f9d6a"/><rect x="61" y="45" width="18" height="3" rx="1.5" fill="#fff"/>',
  UpgradeArt.cal:
      '<rect x="38" y="14" width="44" height="46" rx="6" fill="#fff"/><rect x="38" y="14" width="44" height="11" rx="6" fill="#F58220"/><rect x="38" y="20" width="44" height="5" fill="#F58220"/><g fill="#eadfd2"><rect x="44" y="31" width="6" height="6" rx="1.5"/><rect x="53" y="31" width="6" height="6" rx="1.5"/><rect x="62" y="31" width="6" height="6" rx="1.5"/><rect x="44" y="40" width="6" height="6" rx="1.5"/><rect x="53" y="40" width="6" height="6" rx="1.5"/></g><rect x="62" y="40" width="6" height="6" rx="1.5" fill="#F58220"/>',
  UpgradeArt.laptop:
      '<rect x="30" y="16" width="56" height="36" rx="4" fill="#fff"/><rect x="34" y="20" width="48" height="28" rx="2" fill="#efe6da"/><rect x="24" y="52" width="68" height="5" rx="2.5" fill="#d9c6b0"/><rect x="80" y="30" width="18" height="32" rx="4" fill="#F58220"/><rect x="82.5" y="34" width="13" height="24" rx="2" fill="#fff"/>',
};

const _badges = <UpgradeBadge, String>{
  UpgradeBadge.lock:
      '<rect x="77.5" y="53" width="9" height="7" rx="1.5" fill="#F58220"/><path d="M79.5 53v-2a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="#F58220" stroke-width="1.6"/>',
  UpgradeBadge.full:
      '<path d="M77 57a5 5 0 0 1 10 0" fill="none" stroke="#F58220" stroke-width="2"/><path d="M82 57l3-3" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>',
  UpgradeBadge.plus: '<path d="M82 50v8M78 54h8" stroke="#F58220" stroke-width="2.2" stroke-linecap="round"/>',
  UpgradeBadge.clock:
      '<circle cx="82" cy="54" r="5" fill="none" stroke="#F58220" stroke-width="1.6"/><path d="M82 51.5V54l2 1.5" fill="none" stroke="#F58220" stroke-width="1.6" stroke-linecap="round"/>',
};

String _tile(double x, double y, String icon, [double scale = 1]) =>
    '<g transform="translate($x,$y) scale($scale)"><rect width="23" height="23" rx="7" fill="#F58220"/>${_icons[icon] ?? ''}</g>';

String _chip(double x, double y, UpgradeChip c) => '<g transform="translate($x,$y)">'
    '<rect width="118" height="38" rx="11" fill="#fff" stroke="#f6c9a2" stroke-width="1.2"/>${_tile(8, 7.5, c.icon)}'
    '<text x="38" y="17" font-size="11" font-weight="600" fill="#032B23" font-family="sans-serif">${_esc(_clip(c.title, 15))}</text>'
    '<text x="38" y="30" font-size="9.5" fill="#7a6c5d" font-family="sans-serif">${_esc(_clip(c.subtitle, 17))}</text></g>';

String _round(double cx, double cy, double r, String icon) {
  final s = r / 14;
  return '<circle cx="$cx" cy="$cy" r="$r" fill="#F58220"/>'
      '<g transform="translate(${cx - 11.5 * s},${cy - 11.5 * s}) scale($s)">${_icons[icon] ?? ''}</g>';
}

/// The popup's header band (same drawing as `components/subscription/upgrade/UpgradeIllustration.tsx`).
String upgradeIllustrationSvg(UpgradeCopy copy) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 158">'
    '<rect width="380" height="158" fill="#F8F3E9"/>'
    '<ellipse cx="190" cy="84" rx="150" ry="58" fill="none" stroke="#F58220" stroke-width="1.3" stroke-dasharray="3 5" opacity="0.75"/>'
    '<circle cx="190" cy="84" r="54" fill="#feecde"/><circle cx="190" cy="84" r="40" fill="#fcd7b8" opacity="0.55"/>'
    '<g transform="translate(100,28) scale(1.5)">${_objects[copy.art]}<circle cx="82" cy="54" r="11" fill="#032B23"/>${_badges[copy.badge]}</g>'
    '${_chip(14, 18, copy.chips[0])}${_chip(248, 100, copy.chips[1])}'
    '${_round(330, 30, 15, copy.tiles[0])}${_round(46, 124, 12, copy.tiles[1])}'
    '<circle cx="292" cy="62" r="2.5" fill="#F58220"/><circle cx="96" cy="78" r="2" fill="#032B23" opacity="0.5"/>'
    '<circle cx="246" cy="22" r="2" fill="#032B23" opacity="0.5"/>'
    '<path d="M150 132l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="#F58220" opacity="0.8"/></svg>';
