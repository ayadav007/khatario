import 'package:flutter/material.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../../upgrade/upgrade_copy.dart';
import '../../upgrade/upgrade_sheet.dart';
import '../sales/doc_action_sheets.dart';
import 'report_period.dart';
import 'sales_reports.dart';
import 'table_report_screen.dart';

/// The other report pages of the website's Reports menu that are not under sales, purchase or stock:
/// profit by invoice, deleted items, credit risk, inter-branch reconciliation and the label print log.
/// Each is a [TableReportSpec]; every figure on a tile is a total the route sends.
const otherReportHrefs = <String>[
  '/reports/profit-by-invoice',
  '/reports/deleted',
  '/reports/credit-risk',
  '/reports/inter-branch-reconciliation',
  '/reports/label-print-log',
];

/// The screen for one of these hrefs, or null when it is not one.
Widget? otherReportScreen(AppSession session, String href) {
  final spec = otherReportSpec(session, href);
  return spec == null ? null : TableReportScreen(session: session, spec: spec);
}

TableReportSpec? otherReportSpec(AppSession session, String href) => switch (href) {
      '/reports/profit-by-invoice' => _profitByInvoice(session),
      '/reports/deleted' => _deleted(session),
      '/reports/credit-risk' => _creditRisk(session),
      '/reports/inter-branch-reconciliation' => _interBranch(),
      '/reports/label-print-log' => _labelPrintLog(),
      _ => null,
    };

/// A table's name for rows the reply holds only in [TableReportSpec.sections]. The reply has no such key.
const _noRows = 'sections_only';

String _money(dynamic v) => reportCellText(v, money: true);

String _dateTime(dynamic v) {
  final d = docDate(v);
  return d == null ? docText(v) : ddMMMyyyyHm(d);
}

// ---------------------------------------------------------------- profit by invoice

/// `GET /api/reports/profit-by-invoice?start_date&end_date` replies `{ invoices }`, one row per posted
/// invoice with revenue, cost, profit and margin. The route reads `start_date` and `end_date` (not
/// `from_date`), sends no totals, so there are no tiles.
TableReportSpec _profitByInvoice(AppSession session) => TableReportSpec(
      title: 'Profit by Invoice',
      path: '/api/reports/profit-by-invoice',
      fromKey: 'start_date',
      toKey: 'end_date',
      rowsKey: 'invoices',
      rowTitle: (r) => reportText(r, 'invoice_number'),
      rowSubtitle: (r) => reportJoin([
        reportDate(r['date']),
        reportText(r, 'customer_name'),
        'Revenue ${_money(r['total_revenue'])}',
        'Cost ${_money(r['total_cost'])}',
        reportNumber(r['margin_percent']).isEmpty ? '' : 'Margin ${reportNumber(r['margin_percent'])}%',
      ]),
      rowAmountKey: 'total_profit',
      onOpenRow: (ctx, r) => reportOpenInvoice(ctx, session, reportText(r, 'invoice_id')),
    );

// ---------------------------------------------------------------- deleted items

/// Each type's restore route (`POST { id }`, the same ones the website's Restore button calls).
const _restoreRoutes = {
  'invoice': '/api/invoices/restore',
  'purchase': '/api/purchases/restore',
  'payment': '/api/payments/restore',
  'supplier': '/api/suppliers/restore',
};

const _typeNames = {'invoice': 'Invoice', 'purchase': 'Purchase', 'payment': 'Payment', 'supplier': 'Supplier'};

/// `GET /api/reports/deleted-items` replies `{ items, can_restore }`: soft-deleted invoices, purchases,
/// payments and suppliers, newest first, at most 400. The website starts with no date range and no type
/// filter, so this report sends no period either (a month-to-date default would hide older deletions).
/// Tapping a row offers Restore, which asks first, posts once and loads the list again. A shop whose plan
/// has no restore gets the server's own message.
TableReportSpec _deleted(AppSession session) {
  // `can_restore` of the latest reply; this spec is built again for each screen, so it is never stale.
  bool? canRestore;
  return TableReportSpec(
      title: 'Deleted Items',
      path: '/api/reports/deleted-items',
      fromKey: 'date_from',
      toKey: 'date_to',
      periodOptional: true,
      filters: const [
        ReportFilter(
          'Type',
          'type',
          [('all', 'All types'), ('invoice', 'Invoices'), ('purchase', 'Purchases'), ('payment', 'Payments'), ('supplier', 'Suppliers')],
          omitValue: 'all',
        ),
      ],
      onLoaded: (body) => canRestore = readPath(body, 'can_restore') == true,
      rowsKey: 'items',
      rowTitle: (r) => reportText(r, 'number'),
      rowSubtitle: (r) => reportJoin([
        _typeNames[reportText(r, 'type')] ?? reportLabel(r['type']),
        reportText(r, 'party'),
        _dateTime(r['deleted_at']),
      ]),
      rowAmountKey: 'amount',
      rowAmountText: (r) => reportText(r, 'type') == 'supplier' ? '' : _money(r['amount']),
      onOpenRow: (ctx, r) => _openDeleted(ctx, session, r, () => canRestore != false),
    );
}

Future<void> _openDeleted(BuildContext context, AppSession session, Map<String, dynamic> row, bool Function() allowed) async {
  final type = reportText(row, 'type');
  final id = reportText(row, 'id');
  final route = _restoreRoutes[type];
  if (route == null || id.isEmpty) return;
  final number = reportText(row, 'number');
  final name = (_typeNames[type] ?? type).toLowerCase();

  final restore = await showKSheet<bool>(
    context,
    title: number.isEmpty ? 'Deleted $name' : number,
    scrollable: true,
    builder: (ctx) => Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.xl, AppSpace.sm, AppSpace.xl, AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KDivided(children: [
            _sheetRow('Type', _typeNames[type] ?? reportLabel(type)),
            _sheetRow('Party', reportText(row, 'party')),
            if (type != 'supplier') _sheetRow('Amount', _money(row['amount'])),
            _sheetRow('Deleted at', _dateTime(row['deleted_at'])),
          ]),
          const SizedBox(height: AppSpace.lg),
          KButton(label: 'Restore', onPressed: () => Navigator.of(ctx).pop(true)),
        ],
      ),
    ),
  );
  if (restore != true || !context.mounted) return;

  // The website opens its upgrade dialog instead when the plan has no soft delete.
  if (!allowed()) {
    await showUpgradeSheet(
      context,
      request: const UpgradeRequest(UpgradeVariant.feature, featureKey: 'soft_delete'),
      api: session.api,
      businessId: session.businessId,
      onSeePlans: () => reportOpenHref(context, session, '/subscription', 'Subscription'),
    );
    return;
  }

  final sure = await askSheet(
    context,
    title: 'Restore $name${number.isEmpty ? '' : ' $number'}?',
    text: 'It goes back into your lists and reports.',
    confirmLabel: 'Yes, restore',
    cancelLabel: 'Not now',
    danger: false,
  );
  if (!sure || !context.mounted) return;

  try {
    await session.api.postJson(route, {'id': id});
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
    return;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not reach the server.', tone: KTone.negative);
    return;
  }
  if (!context.mounted) return;
  showKToast(context, 'Restored $name${number.isEmpty ? '' : ' $number'}', tone: KTone.positive);
  // The report loads its own rows, so a fresh copy of it is the reload.
  await Navigator.of(context).pushReplacement(MaterialPageRoute<void>(
    builder: (_) => TableReportScreen(session: session, spec: _deleted(session)),
  ));
}

Widget _sheetRow(String label, String value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpace.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(label, style: AppText.caption)),
          const SizedBox(width: AppSpace.md),
          Flexible(child: Text(value.isEmpty ? '—' : value, textAlign: TextAlign.end, style: AppText.bodyStrong)),
        ],
      ),
    );

// ---------------------------------------------------------------- credit risk

const _riskStatus = {
  'OVER_LIMIT': 'Over limit',
  'CRITICAL': 'Critical',
  'WARNING': 'Warning',
  'HEALTHY': 'Healthy',
  'UNLIMITED': 'No limit',
};

/// `GET /api/reports/credit-risk` replies `{ total_receivables, total_payables, over_limit_count,
/// customers_by_risk, suppliers_by_risk }`, no period. The website's "Total parties" tile is a count the
/// page makes, so it is not here. Customer rows open the customer and supplier rows the supplier, by `id`.
/// The route already sorts by utilisation (highest first) and has no sort query, so the website's client-side
/// sort by balance or name is not ported.
TableReportSpec _creditRisk(AppSession session) => TableReportSpec(
      title: 'Credit Risk',
      path: '/api/reports/credit-risk',
      period: ReportPeriodKind.none,
      tiles: const [
        ('Total receivables', 'total_receivables'),
        ('Total payables', 'total_payables'),
        ('Parties over limit', 'over_limit_count'),
      ],
      countTiles: const {'over_limit_count'},
      rowsKey: _noRows,
      sections: const [
        ('Customers', 'customers_by_risk'),
        ('Suppliers', 'suppliers_by_risk'),
      ],
      rowTitle: (r) => reportText(r, 'name'),
      rowSubtitle: (r) => reportJoin([
        _riskStatus[reportText(r, 'credit_status')] ?? reportLabel(r['credit_status']),
        reportNumber(r['credit_utilization_percent']).isEmpty ? '' : '${reportNumber(r['credit_utilization_percent'])}% used',
      ]),
      rowAmountKey: 'current_balance',
      onOpenSectionRow: (ctx, section, r) => section == 0
          ? reportOpenCustomer(ctx, session, reportText(r, 'id'))
          : reportOpenSupplier(ctx, session, reportText(r, 'id')),
    );

// ---------------------------------------------------------------- inter-branch reconciliation

/// `GET /api/reports/inter-branch-reconciliation?as_on_date` replies `{ totals: { receivables, payables,
/// difference, is_reconciled }, branch_wise: { receivables, payables }, unmatched_transactions, ... }`.
/// The website's three tables are all sections here.
TableReportSpec _interBranch() => TableReportSpec(
      title: 'Inter-Branch Reconciliation',
      path: '/api/reports/inter-branch-reconciliation',
      period: ReportPeriodKind.asOn,
      tiles: const [
        ('Inter-branch receivables', 'totals.receivables'),
        ('Inter-branch payables', 'totals.payables'),
        ('Difference', 'totals.difference'),
      ],
      rowsKey: _noRows,
      sections: const [
        ('Receivables by branch', 'branch_wise.receivables'),
        ('Payables by branch', 'branch_wise.payables'),
        ('Unmatched transactions', 'unmatched_transactions'),
      ],
      rowTitle: (r) {
        if (!r.containsKey('voucher_type')) return reportText(r, 'branch_name');
        final narration = reportText(r, 'narration');
        return narration.isNotEmpty ? narration : reportLabel(r['voucher_type']);
      },
      rowSubtitle: (r) => r.containsKey('voucher_type')
          ? reportJoin([reportDate(r['entry_date']), reportText(r, 'branch_name'), reportText(r, 'transaction_type')])
          : '',
      rowAmountKey: 'amount',
      rowAmountText: (r) => _money(r['receivables_balance'] ?? r['payables_balance'] ?? r['amount']),
    );

// ---------------------------------------------------------------- label print log

const _purposes = {'purchase': 'Purchase / GRN', 'item_create': 'Item Create'};

/// `GET /api/reports/label-print-log?from&to` replies `{ entries, total_jobs, total_labels }`. The route
/// compares `to` with a timestamp, so the website sends the end of the last day (`...T23:59:59`); a plain
/// date would drop that day's jobs, so `toSuffix` adds it to whatever end day the period bar holds.
TableReportSpec _labelPrintLog() => TableReportSpec(
      title: 'Label Printing Activity',
      path: '/api/reports/label-print-log',
      fromKey: 'from',
      toKey: 'to',
      toSuffix: 'T23:59:59',
      filters: const [
        ReportFilter(
          'Purpose',
          'purpose',
          [('', 'All'), ('standalone', 'Standalone'), ('purchase', 'Purchase / GRN'), ('item_create', 'Item Create')],
          omitValue: '',
        ),
      ],
      tiles: const [
        ('Print jobs', 'total_jobs'),
        ('Labels printed', 'total_labels'),
      ],
      countTiles: const {'total_jobs', 'total_labels'},
      rowsKey: 'entries',
      rowTitle: (r) => _purposes[reportText(r, 'purpose')] ?? 'Standalone',
      rowSubtitle: (r) => reportJoin([
        _dateTime(r['created_at']),
        reportText(r, 'user_name').isNotEmpty ? reportText(r, 'user_name') : (reportText(r, 'user_email').isNotEmpty ? reportText(r, 'user_email') : 'Unknown'),
        reportText(r, 'bill_number').isEmpty ? '' : 'Bill ${reportText(r, 'bill_number')}',
      ]),
      rowAmountKey: 'total_labels',
      rowAmountText: (r) => '${reportNumber(r['total_labels'])} labels',
      columns: const [
        ReportColumn('Template', 'template_name'),
        ReportColumn('Bill', 'bill_number'),
        ReportColumn('Lines', 'line_count', qty: true),
        ReportColumn('Labels', 'total_labels', qty: true),
        ReportColumn('Format', 'format'),
        ReportColumn('Layout', 'layout'),
        ReportColumn('Barcode type', 'symbology'),
      ],
    );
