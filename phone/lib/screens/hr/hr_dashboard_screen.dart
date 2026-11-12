import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../pages/native_routes.dart';
import 'attendance_leave_logic.dart';
import 'hr_manage_logic.dart';
import 'hr_manage_widgets.dart';
import 'pay_widgets.dart';

const _linkIcons = <String, IconData>{
  '/employees': LucideIcons.users,
  '/employees/org-chart': LucideIcons.network,
  '/employees/manager': LucideIcons.inbox,
  '/employees/attendance': LucideIcons.calendarCheck,
  '/employees/leaves': LucideIcons.clipboardList,
  '/employees/salary/payments': LucideIcons.wallet,
  '/hr/engagement': LucideIcons.megaphone,
  '/hr/exits': LucideIcons.logOut,
  '/hr/reports': LucideIcons.fileChartColumn,
  '/employees/leaves/calendar': LucideIcons.calendarRange,
};

/// Website `/hr/dashboard`: the server's HR numbers as tiles, "Needs attention" and a "Go to" list.
/// Every tile and link opens its phone screen (or the website page inside the app when it has none yet).
class HrDashboardScreen extends StatefulWidget {
  const HrDashboardScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<HrDashboardScreen> createState() => _HrDashboardScreenState();
}

class _HrDashboardScreenState extends State<HrDashboardScreen> with HrScreenState<HrDashboardScreen> {
  HrOverview _overview = const HrOverview();
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
        final body = await widget.session.api.getJson(hrOverviewPath);
        if (!mounted) return;
        _overview = HrOverview.fromJson(body);
      });

  void _open(String href, String label) => openAppHref(context, widget.session, href, label);

  /// The same plan rule as the website's menu: the manager hub is part of the leave plan.
  bool _visible(String href) => switch (href) {
        '/employees/manager' || '/employees/leaves' || '/employees/leaves/calendar' => _access.has('hr_leaves'),
        _ => true,
      };

  @override
  Widget build(BuildContext context) {
    final o = _overview;
    final tiles = hrTiles(o);
    return PayListPage(
      title: 'HR dashboard',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: '',
      emptyBody: '',
      emptyIcon: LucideIcons.users,
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        KIconButton(icon: LucideIcons.inbox, tooltip: 'Approvals', onTap: () => _open('/employees/manager/approvals', 'Pending approvals')),
        KIconButton(icon: LucideIcons.userPlus, tooltip: 'Add employee', onTap: () => _open('/employees/new', 'Add employee')),
      ]),
      rows: [
        if (o.date.isNotEmpty) Text('Team overview · ${o.date}', style: AppText.caption),
        if (o.notifications.isNotEmpty)
          KCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(padding: const EdgeInsets.fromLTRB(14, 12, 14, 0), child: Text('Needs attention', style: AppText.label)),
              KDivided(indent: 0, children: [
                for (final n in o.notifications.take(5))
                  KListRow(
                    title: n.count > 0 ? '${n.label} (${n.count})' : n.label,
                    trailing: const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink2),
                    onTap: () => _open(n.href, n.label),
                  ),
              ]),
            ]),
          ),
        const KSectionHeader('Today'),
        HrTileGrid(tiles: [
          for (final t in tiles)
            HrCountTile(
              key: ValueKey('tile-${t.title}'),
              title: t.title,
              value: t.value,
              description: t.description,
              warn: t.warn,
              onTap: t.href == null ? null : () => _open(t.href!, t.title),
            ),
        ]),
        const KSectionHeader('Go to'),
        KCard(
          child: KDivided(indent: 0, children: [
            for (final l in hrQuickLinks.where((l) => _visible(l.href)))
              KListRow(
                title: l.label,
                subtitle: l.description,
                leading: Icon(_linkIcons[l.href] ?? LucideIcons.users, size: 22, color: AppColors.ink2),
                trailing: const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink2),
                onTap: () => _open(l.href, l.label),
              ),
          ]),
        ),
      ],
    );
  }
}
