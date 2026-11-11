import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'employees_screen.dart';
import 'hr_logic.dart';

/// Website `/employees/org-chart`: the reporting hierarchy as an indented tree. The first two
/// levels are open, like the website; tap the arrow to open or close a branch, the name for the profile.
class OrgChartScreen extends StatefulWidget {
  const OrgChartScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<OrgChartScreen> createState() => _OrgChartScreenState();
}

class _OrgChartScreenState extends State<OrgChartScreen> {
  OrgChart? _chart;
  String _department = '';
  final Map<String, bool> _open = {};
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;

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
      final query = _department.isEmpty ? '' : '?department=${Uri.encodeQueryComponent(_department)}';
      final body = await widget.session.api.getJson('/api/employees/org-chart$query');
      if (!mounted) return;
      setState(() {
        _chart = OrgChart.fromJson(body);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not reach the server.'; _loading = false; });
    }
  }

  void _pickDepartment(String department) {
    if (department == _department) return;
    _department = department;
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const KBackBar('Org chart'),
          Expanded(child: _body()),
        ]),
      ),
    );
  }

  Widget _body() {
    final chart = _chart;
    if (_loading && chart == null) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null && chart == null) {
      return ListView(children: [
        KEmptyState(
          icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: _notInPlan ? 'Not included in your current plan' : 'Could not load the org chart',
          body: _error,
          action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    if (chart == null) return const SizedBox.shrink();
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          if (chart.departments.isNotEmpty || _department.isNotEmpty) ...[
            KChipBar<String>(
              value: _department,
              padding: EdgeInsets.zero,
              options: [('', 'All'), for (final d in chart.departments) (d, d)],
              onChanged: _pickDepartment,
            ),
            const SizedBox(height: AppSpace.sm),
          ],
          if (_error != null) KEmptyState(icon: LucideIcons.cloudOff, title: 'Could not refresh', body: _error, action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load)),
          if (_loading) const KSpinner(padding: EdgeInsets.symmetric(vertical: 24)),
          if (!_loading && chart.isEmpty)
            const KEmptyState(
              icon: LucideIcons.network,
              title: 'No employees in the org chart yet',
              body: 'Assign reporting managers on employee profiles.',
            ),
          if (!_loading && chart.excluded > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpace.sm),
              child: KCard(
                padding: const EdgeInsets.all(14),
                child: Text(
                  '${chart.excluded} ${chart.excluded == 1 ? 'employee is' : 'employees are'} left out because of circular reporting relationships. Fix their reporting managers on their profiles.',
                  style: AppText.caption,
                ),
              ),
            ),
          if (!_loading && chart.roots.isNotEmpty)
            KCard(child: Column(children: [for (final r in chart.roots) ..._rows(r, 0)])),
          if (!_loading && chart.orphans.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            KSectionHeader('Unassigned or invalid manager'),
            KCard(child: Column(children: [for (final r in chart.orphans) ..._rows(r, 0)])),
          ],
        ],
      ),
    );
  }

  List<Widget> _rows(OrgNode node, int depth) {
    final hasChildren = node.children.isNotEmpty;
    final open = _open[node.id] ?? depth < 2;
    final subtitle = [node.code, node.subtitle].where((s) => s.isNotEmpty).join(' · ');
    return [
      KListRow(
        padding: EdgeInsets.fromLTRB(6 + depth * 18.0, 6, 12, 6),
        leading: hasChildren
            ? KIconButton(
                icon: open ? LucideIcons.chevronDown : LucideIcons.chevronRight,
                tooltip: '${open ? 'Collapse' : 'Expand'} ${node.name}',
                onTap: () => setState(() => _open[node.id] = !open),
              )
            : const SizedBox(width: 40),
        title: node.name,
        subtitle: subtitle,
        onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
          builder: (_) => EmployeeDetailScreen(session: widget.session, employeeId: node.id),
        )),
      ),
      if (hasChildren && open) for (final c in node.children) ..._rows(c, depth + 1),
    ];
  }
}
