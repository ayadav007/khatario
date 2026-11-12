import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../pages/native_routes.dart';
import 'hr_manage_logic.dart';
import 'hr_manage_widgets.dart';
import 'manager_approvals_screen.dart';
import 'pay_widgets.dart';

/// Website `/employees/manager`: the team overview (numbers from the server) with the manager's links.
class ManagerScreen extends StatefulWidget {
  const ManagerScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ManagerScreen> createState() => _ManagerScreenState();
}

class _ManagerScreenState extends State<ManagerScreen> with HrScreenState<ManagerScreen> {
  ManagerDashboard _data = const ManagerDashboard();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => guardedLoad(() async {
        final body = await widget.session.api.getJson(managerDashboardPath);
        if (!mounted) return;
        _data = ManagerDashboard.fromJson(body);
      });

  void _push(Widget screen) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen)).then((_) {
        if (mounted) _load();
      });

  @override
  Widget build(BuildContext context) {
    final d = _data;
    Widget link(IconData icon, String title, String subtitle, VoidCallback onTap) => KListRow(
          title: title,
          subtitle: subtitle,
          leading: Icon(icon, size: 22, color: AppColors.ink2),
          trailing: const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink2),
          onTap: onTap,
        );
    return PayListPage(
      title: 'Manager',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: '',
      emptyBody: '',
      emptyIcon: LucideIcons.users,
      rows: [
        Text('Your team overview and pending actions', style: AppText.caption),
        HrTileGrid(tiles: [
          HrCountTile(title: 'Direct reports', value: d.teamCount),
          HrCountTile(title: 'Pending leaves', value: d.pendingLeaves, warn: true),
          HrCountTile(title: 'Pending expenses', value: d.pendingExpenses, warn: true),
          HrCountTile(title: 'Present today', value: d.presentToday, description: '${d.absentToday} absent'),
        ]),
        KCard(
          child: KDivided(indent: 0, children: [
            link(LucideIcons.users, 'View team', 'Your direct reports', () => _push(ManagerTeamScreen(session: widget.session))),
            link(LucideIcons.inbox, 'Pending approvals', 'Leave, overtime, regularization, resignations', () => _push(ManagerApprovalsScreen(session: widget.session))),
            link(LucideIcons.calendarCheck, 'Team roll call', 'Mark your team\'s attendance', () => openAppHref(context, widget.session, '/employees/manager/attendance', 'Team roll call')),
            link(LucideIcons.network, 'My org subtree', 'Reporting structure under you', () => openAppHref(context, widget.session, '/employees/org-chart?scope=my_subtree', 'Org chart')),
          ]),
        ),
      ],
    );
  }
}

/// Website `/employees/manager/team`.
class ManagerTeamScreen extends StatefulWidget {
  const ManagerTeamScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ManagerTeamScreen> createState() => _ManagerTeamScreenState();
}

class _ManagerTeamScreenState extends State<ManagerTeamScreen> with HrScreenState<ManagerTeamScreen> {
  List<TeamMember> _team = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => guardedLoad(() async {
        final body = await widget.session.api.getJson(managerTeamPath);
        if (!mounted) return;
        _team = teamMembers(body['team']);
      });

  KTone _tone(String? s) => switch (s) {
        'present' => KTone.positive,
        'absent' => KTone.negative,
        'half_day' => KTone.due,
        _ => KTone.neutral,
      };

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'My team',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'No direct reports',
      emptyBody: 'People who report to you appear here.',
      emptyIcon: LucideIcons.users,
      rows: [
        for (final m in _team)
          KCard(
            child: KListRow(
              title: m.name,
              subtitle: [m.code, if (m.designation != null) m.designation!, if (m.department != null) m.department!].where((e) => e.isNotEmpty).join(' · '),
              leading: KAvatar(name: m.name, size: 40),
              trailing: m.attendanceStatus == null ? null : KPill(label: _statusWords(m.attendanceStatus!), tone: _tone(m.attendanceStatus)),
            ),
          ),
      ],
    );
  }
}

String _statusWords(String s) {
  final t = s.replaceAll('_', ' ');
  return t.isEmpty ? t : t[0].toUpperCase() + t.substring(1);
}
