import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../pages/website_page_screen.dart';
import 'salary_payments_logic.dart';

/// Website `/employees/salary/payments`: salaries paid, grouped by month. Paying a salary opens the
/// website's pay form inside the app (it works out deductions and payroll from the salary structure).
class SalaryPaymentsScreen extends StatefulWidget {
  const SalaryPaymentsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<SalaryPaymentsScreen> createState() => _SalaryPaymentsScreenState();
}

class _SalaryPaymentsScreenState extends State<SalaryPaymentsScreen> {
  List<SalaryPaymentRow> _rows = const [];
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
      final body = await widget.session.api.getJson('/api/employees/salary/payments');
      if (!mounted) return;
      setState(() {
        _rows = salaryPaymentRows(body['payments']);
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

  Future<void> _pay() async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => WebsitePageScreen(session: widget.session, href: '/employees/salary/payments/new', title: 'Pay salary'),
    ));
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: _notInPlan ? null : KFab(icon: LucideIcons.plus, label: 'Pay salary', onTap: _pay),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(
              'Salary Payments',
              trailing: KIconButton(
                icon: LucideIcons.globe,
                tooltip: 'Open on website',
                onTap: () => openWebsiteInApp(context, widget.session, '/employees/salary/payments', 'Salary Payments'),
              ),
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null) {
      return ListView(children: [
        KEmptyState(
          icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: _notInPlan ? 'Not included in your current plan' : 'Could not load salary payments',
          body: _error,
          action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    final months = salaryMonths(_rows);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 96),
        children: [
          if (months.isEmpty)
            KEmptyState(
              icon: LucideIcons.wallet,
              title: 'No salaries paid yet',
              body: 'Pay a salary and it shows up here, month by month.',
              action: KButton(label: 'Pay salary', expand: false, onPressed: _pay),
            )
          else
            for (final m in months) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(2, AppSpace.sm, 2, 6),
                child: Row(children: [
                  Expanded(child: Text(salaryMonthLabel(m.month), style: AppText.label)),
                  Text(inr(m.total), style: AppText.label.copyWith(fontWeight: FontWeight.w600)),
                ]),
              ),
              KCard(child: KDivided(indent: 0, children: [for (final r in m.rows) _row(r)])),
            ],
        ],
      ),
    );
  }

  Widget _row(SalaryPaymentRow r) {
    final details = [
      if (r.paidOn != null) 'Paid ${dMMM(r.paidOn!)}',
      if (r.deductions > 0) '${inr(r.deductions)} deducted',
      salaryStatusLabel(r.status),
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(children: [
        KAvatar(name: r.employeeName, size: 36),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(r.employeeName, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
            Text(details, style: AppText.caption),
          ]),
        ),
        KAmount(r.net, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
      ]),
    );
  }
}
