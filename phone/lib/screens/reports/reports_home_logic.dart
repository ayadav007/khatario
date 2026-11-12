import '../../format.dart';
import '../more/more_navigation.dart';
import 'report_period.dart';

/// One headline tile on the reports overview. [figure] reads the server's number from the reply;
/// the phone adds nothing up.
class HomeTile {
  const HomeTile(this.label, this.route, this.figure, {this.withPeriodParam = false});

  final String label;
  final String route;

  /// Sales, purchase and expense summaries group by `period` (day, week or month); their `totals`
  /// cover the whole range either way.
  final bool withPeriodParam;
  final num? Function(Map<String, dynamic> body) figure;

  /// Query: `from_date` and `to_date` only. The server picks the business and user from the session.
  String path(ReportPeriod period) => '$route?${period.query}${withPeriodParam ? '&period=month' : ''}';
}

num? _number(dynamic v) {
  if (v == null) return null;
  if (v is String && v.trim().isEmpty) return null;
  return toNum(v);
}

num? _inside(Map<String, dynamic> body, String group, String key) {
  final inner = body[group];
  return inner is Map ? _number(inner[key]) : null;
}

/// The website's overview reads `/api/reports/sales-summary` (`summary.total_sales`) and
/// `/purchase-summary` (`summary.total_amount`); expenses and profit come from
/// `/expense/summary` (`totals.total_amount`) and `/profit-loss` (`net_profit`).
final homeTiles = <HomeTile>[
  HomeTile('Sales', '/api/reports/sales-summary', (b) => _inside(b, 'summary', 'total_sales')),
  HomeTile('Purchases', '/api/reports/purchase-summary', (b) => _inside(b, 'summary', 'total_amount')),
  HomeTile('Expenses', '/api/reports/expense/summary', (b) => _inside(b, 'totals', 'total_amount'), withPeriodParam: true),
  HomeTile('Profit', '/api/reports/profit-loss', (b) => _number(b['net_profit'])),
];

/// A report the overview can open. [locked] comes from the server's More menu, never from here.
class ReportRow {
  const ReportRow(this.href, this.label, {this.locked = false});

  final String href;
  final String label;
  final bool locked;

  ReportRow withLocked(bool v) => ReportRow(href, label, locked: v);
}

class ReportGroup {
  const ReportGroup(this.title, this.rows);

  final String title;
  final List<ReportRow> rows;
}

/// The website's reports in the order of its More menu (`lib/more-navigation.ts`, Reports section)
/// and `components/reports/MobileReportsIndex.tsx`, in the groups the website's report tabs use.
const reportGroups = <ReportGroup>[
  ReportGroup('Financial', [
    ReportRow('/reports/profit-loss', 'Profit & loss'),
    ReportRow('/reports/balance-sheet', 'Balance sheet'),
    ReportRow('/reports/cash-flow', 'Cash flow'),
    ReportRow('/reports/trial-balance', 'Trial balance'),
    ReportRow('/reports/deleted', 'Deleted items'),
  ]),
  ReportGroup('Sales', [
    ReportRow('/reports/sales/summary', 'Sales summary'),
    ReportRow('/reports/sales/invoice-wise', 'Invoice-wise sales'),
    ReportRow('/reports/sales/item-wise', 'Item-wise sales'),
    ReportRow('/reports/sales/party-wise', 'Party-wise sales'),
    ReportRow('/reports/sales/tax-wise', 'Tax-wise sales'),
    ReportRow('/reports/sales/payment-mode', 'Sales by payment mode'),
    ReportRow('/reports/sales/discount', 'Sales discount'),
    ReportRow('/reports/sales/credit', 'Credit sales'),
    ReportRow('/reports/sales/cancelled', 'Cancelled sales'),
    ReportRow('/reports/sales/returns', 'Sales returns'),
    ReportRow('/reports/sales/b2b-b2c', 'B2B vs B2C'),
  ]),
  ReportGroup('Purchase', [
    ReportRow('/reports/purchase/summary', 'Purchase summary'),
    ReportRow('/reports/purchase/invoice-wise', 'Invoice-wise purchases'),
    ReportRow('/reports/purchase/supplier-wise', 'Supplier-wise purchases'),
    ReportRow('/reports/purchase/item-wise', 'Item-wise purchases'),
    ReportRow('/reports/purchase/returns', 'Purchase returns'),
    ReportRow('/reports/purchase/credit', 'Credit purchases'),
    ReportRow('/reports/purchase/tax-wise', 'Tax-wise purchases'),
  ]),
  ReportGroup('GST', [
    ReportRow('/reports/gst/gstr1', 'GSTR-1'),
    ReportRow('/reports/gst/gstr2b', 'GSTR-2B'),
    ReportRow('/reports/gst/gstr2b-reconciliation', 'GSTR-2B reconciliation'),
    ReportRow('/reports/gst/reconciliation', 'GSTR-1 vs 3B'),
    ReportRow('/reports/gst/gstr3b', 'GSTR-3B'),
    ReportRow('/reports/gst/gstr9', 'GSTR-9'),
    ReportRow('/reports/gst/cash-ledger', 'GST cash ledger'),
    ReportRow('/reports/gst/compliance', 'GST alerts'),
    ReportRow('/eway-bills', 'E-way bills'),
  ]),
  ReportGroup('Stock', [
    ReportRow('/reports/stock/summary', 'Stock summary'),
    ReportRow('/reports/stock/closing-stock', 'Closing stock'),
    ReportRow('/reports/stock/third-party', 'Stock with parties'),
    ReportRow('/reports/stock/valuation', 'Stock valuation'),
    ReportRow('/reports/stock/quantitative', 'Quantity details (3CD)'),
    ReportRow('/reports/stock/bank-statement', 'Bank stock statement'),
    ReportRow('/reports/stock/job-work', 'Job work (ITC-04)'),
  ]),
  ReportGroup('Party', [
    ReportRow('/reports/aging/receivables', 'Receivables aging'),
    ReportRow('/reports/aging/payables', 'Payables aging'),
    ReportRow('/reports/credit-risk', 'Credit risk'),
  ]),
  ReportGroup('Custom', [
    ReportRow('/reports/builder', 'Custom report builder'),
  ]),
];

/// The groups this user sees. [menu] is the server's More menu (`/api/navigation/more`): a report
/// it leaves out is hidden (role), a report it marks locked shows the lock pill (plan). With no
/// menu (it failed to load) every report shows unlocked; the server still refuses what the plan
/// does not include. Empty groups are dropped.
List<ReportGroup> visibleGroups(List<MoreNavSection>? menu) {
  if (menu == null) return reportGroups;
  final byHref = <String, MoreNavItem>{
    for (final s in menu)
      for (final i in s.items) i.href: i,
  };
  final out = <ReportGroup>[];
  for (final g in reportGroups) {
    final rows = [
      for (final r in g.rows)
        if (byHref[r.href] case final item?) r.withLocked(item.isLocked),
    ];
    if (rows.isNotEmpty) out.add(ReportGroup(g.title, rows));
  }
  return out;
}

/// The plan feature behind a locked report, only to word the upgrade sheet. Whether a report is
/// locked is always the server's answer.
String? upgradeFeatureFor(String href) => href == '/reports/builder' ? 'report_builder' : null;
