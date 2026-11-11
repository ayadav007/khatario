import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../theme.dart';
import '../../ui/kit.dart';

/// Colour for the status words on the pay screens (advances, expenses, commissions).
KTone payStatusTone(String status) => switch (status) {
      'approved' || 'paid' || 'reimbursed' || 'recovered' || 'processed' => KTone.positive,
      'pending' || 'partially_recovered' => KTone.due,
      'rejected' || 'cancelled' => KTone.negative,
      _ => KTone.neutral,
    };

/// A list screen with the states every pay list has: loading, a server error with "Try again",
/// "not in your plan", empty, and the rows under optional [header] widgets.
class PayListPage extends StatelessWidget {
  const PayListPage({
    super.key,
    required this.title,
    required this.loading,
    required this.error,
    required this.notInPlan,
    required this.onRetry,
    required this.rows,
    required this.emptyTitle,
    required this.emptyBody,
    required this.emptyIcon,
    this.header = const [],
    this.trailing,
    this.fab,
  });

  final String title;
  final bool loading;
  final String? error;
  final bool notInPlan;
  final Future<void> Function() onRetry;
  final List<Widget> rows;
  final String emptyTitle;
  final String emptyBody;
  final IconData emptyIcon;
  final List<Widget> header;
  final Widget? trailing;
  final Widget? fab;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: notInPlan ? null : fab,
      body: SafeArea(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          KBackBar(title, trailing: trailing),
          Expanded(child: _body()),
        ]),
      ),
    );
  }

  Widget _body() {
    if (loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (error != null) {
      return ListView(children: [
        KEmptyState(
          icon: notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: notInPlan ? 'Not included in your current plan' : 'Could not load $title',
          body: error,
          action: notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: onRetry),
        ),
      ]);
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: onRetry,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 96),
        children: [
          ...header,
          if (rows.isEmpty)
            KEmptyState(icon: emptyIcon, title: emptyTitle, body: emptyBody)
          else
            for (final r in rows) Padding(padding: const EdgeInsets.only(bottom: AppSpace.sm), child: r),
        ],
      ),
    );
  }
}

/// A small action button on a row.
class PayRowButton extends StatelessWidget {
  const PayRowButton({super.key, required this.label, required this.onTap, this.danger = false, this.busy = false});

  final String label;
  final VoidCallback? onTap;
  final bool danger;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return KButton(
      label: label,
      expand: false,
      height: 40,
      kind: danger ? KButtonKind.danger : KButtonKind.secondary,
      loading: busy,
      onPressed: busy ? null : onTap,
    );
  }
}

/// A row of four totals (pending / approved / paid or reimbursed / total).
class PayTotals extends StatelessWidget {
  const PayTotals({super.key, required this.items});

  final List<(String, String)> items;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.sm),
      child: KCard(
        padding: const EdgeInsets.all(12),
        child: Wrap(spacing: 20, runSpacing: 10, children: [
          for (final (label, value) in items)
            Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(label, style: AppText.caption),
              Text(value, style: AppText.bodyStrong),
            ]),
        ]),
      ),
    );
  }
}
