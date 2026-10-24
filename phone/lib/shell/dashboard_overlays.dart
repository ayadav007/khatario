import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../format.dart';
import '../theme.dart';
import '../ui/kit.dart';

typedef PendingAction = ({String id, String label, int count, num? amount, KTone tone, IconData icon});

/// `PendingActionsButton` counts from the dashboard overview payload.
List<PendingAction> pendingActions(Map<String, dynamic> d, {required bool isPrimaryAdmin}) {
  final alerts = d['invoiceAlerts'] is Map ? d['invoiceAlerts'] as Map : const {};
  final overdue = alerts['overdue'] is Map ? alerts['overdue'] as Map : const {};
  final tomorrow = alerts['due_tomorrow'] is Map ? alerts['due_tomorrow'] as Map : const {};
  final recent = ((d['recentInvoices'] as List?) ?? const []).whereType<Map>();
  final drafts = d['draftInvoicesCount'] is num
      ? (d['draftInvoicesCount'] as num).toInt()
      : (isPrimaryAdmin ? recent.where((i) => i['status'] == 'draft').length : 0);
  final listedLowStock = ((d['lowStockItems'] as List?) ?? const []).length;
  final lowStock = d['lowStockCount'] is num ? (d['lowStockCount'] as num).toInt() : listedLowStock;
  num? amount(Map m) => m['total_amount'] == null ? null : toNum(m['total_amount']);
  return [
    (id: 'overdue', label: 'Overdue Invoices', count: toNum(overdue['count']).toInt(), amount: amount(overdue), tone: KTone.negative, icon: LucideIcons.circleAlert),
    (id: 'due_tomorrow', label: 'Due Tomorrow', count: toNum(tomorrow['count']).toInt(), amount: amount(tomorrow), tone: KTone.due, icon: LucideIcons.calendar),
    (id: 'drafts', label: 'Draft Invoices', count: drafts, amount: null, tone: KTone.neutral, icon: LucideIcons.fileText),
    (id: 'itc', label: 'ITC Decisions Pending', count: 0, amount: null, tone: KTone.due, icon: LucideIcons.clock),
    (id: 'low_stock', label: 'Low Stock Items', count: lowStock, amount: null, tone: KTone.due, icon: LucideIcons.package),
  ];
}

/// "Needs attention" on Home. Hidden when nothing is pending.
class PendingActionsCard extends StatelessWidget {
  static const _titles = {
    'overdue': 'Overdue invoices',
    'due_tomorrow': 'Due tomorrow',
    'drafts': 'Draft invoices',
    'itc': 'ITC decisions pending',
    'low_stock': 'Low stock items',
  };

  const PendingActionsCard({super.key, required this.data, required this.isPrimaryAdmin, required this.onOpen});

  final Map<String, dynamic> data;
  final bool isPrimaryAdmin;
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context) {
    final actions = pendingActions(data, isPrimaryAdmin: isPrimaryAdmin).where((a) => a.count > 0).toList();
    if (actions.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const KSectionHeader('Needs attention'),
        KCard(
          child: KDivided(
            indent: 66,
            children: [
              for (final a in actions)
                KListRow(
                  onTap: () => onOpen(a.id == 'low_stock' ? 'Low stock items' : a.label),
                  leading: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: a.tone.bg, borderRadius: BorderRadius.circular(12)),
                    child: Icon(a.icon, size: 18, color: a.tone.fg),
                  ),
                  title: _titles[a.id] ?? a.label,
                  subtitle: a.amount != null && a.amount! > 0 ? '$rupeeSign${enIn(a.amount!, maxFraction: 0)}' : null,
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('${a.count}', style: AppText.heading.copyWith(fontFeatures: AppText.tabular)),
                      const SizedBox(width: 4),
                      const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
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
