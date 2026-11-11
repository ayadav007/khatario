import 'package:flutter/material.dart';

import '../../session.dart';
import '../docs/doc_logic.dart';
import '../items/item_detail_screen.dart';
import '../pages/native_routes.dart';
import '../pages/website_page_screen.dart';
import '../sales/delivery_challans_screen.dart';
import 'report_period.dart';
import 'table_report_screen.dart';

/// The stock reports of the website's menu (`app/(app)/reports/stock/<report>/page.tsx`), each a
/// [TableReportSpec]. Every figure on a tile comes from the reply; the phone adds nothing up.
///
/// The website has no page for the low-stock, movement or expiry reports (only their routes), so
/// they are not here.
const stockReportHrefs = <String>[
  '/reports/stock/summary',
  '/reports/stock/closing-stock',
  '/reports/stock/third-party',
  '/reports/stock/valuation',
  '/reports/stock/quantitative',
  '/reports/stock/bank-statement',
  '/reports/stock/job-work',
  '/reports/stock/fifo-lots',
];

/// The screen for one stock report href, or null when it is not one.
Widget? stockReportScreen(AppSession session, String href) {
  final spec = stockReportSpec(session, href);
  return spec == null ? null : TableReportScreen(session: session, spec: spec);
}

/// A table's name for rows the reply holds only in [TableReportSpec.sections]. The reply has no such key.
const _noRows = 'sections_only';

TableReportSpec? stockReportSpec(AppSession session, String href) => switch (href) {
      '/reports/stock/summary' => _summary(session),
      '/reports/stock/closing-stock' => _closingStock(session),
      '/reports/stock/third-party' => _thirdParty(session),
      '/reports/stock/valuation' => _valuation(),
      '/reports/stock/quantitative' => _quantitative(),
      '/reports/stock/bank-statement' => _bankStatement(),
      '/reports/stock/job-work' => _jobWork(session),
      '/reports/stock/fifo-lots' => _fifoLots(),
      _ => null,
    };

// ---------------------------------------------------------------- helpers

String _text(Map<String, dynamic> row, String key) => docText(row[key]);

String _join(Iterable<String> parts) => parts.where((p) => p.trim().isNotEmpty).join(' · ');

/// A quantity as grouped digits, or empty when the reply has none.
String _qtyText(dynamic v) => docNum(v) == null ? '' : reportCellText(v, qty: true);

String _qtyWithUnit(dynamic qty, dynamic unit) => [_qtyText(qty), docText(unit)].where((p) => p.isNotEmpty).join(' ');

String _upper(dynamic v) => docText(v).toUpperCase();

/// Opens another phone screen when the link has one, the website page inside the app otherwise.
void _openHref(BuildContext context, AppSession session, String href, String title) {
  final screen = nativeScreenFor(session, href);
  if (screen == null) return openWebsiteInApp(context, session, href, title);
  Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
}

void _openItem(BuildContext context, AppSession session, String itemId) {
  if (itemId.isEmpty) return;
  Navigator.of(context).push(MaterialPageRoute<void>(
    builder: (ctx) => ItemDetailScreen(
      session: session,
      itemId: itemId,
      onOpen: (what) {
        if (what.startsWith('/')) return _openHref(ctx, session, what, 'Item');
        switch (what) {
          case 'New inventory adjustment':
            return _openHref(ctx, session, '/inventory-adjustments/new', 'New adjustment');
          case 'Purchase detail':
            return _openHref(ctx, session, '/purchases', 'Purchases');
          case 'The full item page':
            return openWebsiteInApp(ctx, session, '/items/$itemId', 'Item');
        }
      },
    ),
  ));
}

void _openChallan(BuildContext context, AppSession session, String challanId) {
  if (challanId.isEmpty) return;
  Navigator.of(context).push(MaterialPageRoute<void>(
    builder: (_) => DeliveryChallanDetailScreen(session: session, challanId: challanId),
  ));
}

// ---------------------------------------------------------------- reports

/// `GET /api/reports/stock/summary` replies `{ stock: [...], totals }`. Rows link to the item. This is the
/// item-level table; the website's dashboard page (`/api/reports/stock-summary`) is not ported.
TableReportSpec _summary(AppSession session) {
  String status(String s) => switch (s) {
        'out_of_stock' => 'Out of stock',
        'low_stock' => 'Low stock',
        'in_stock' => 'In stock',
        _ => s,
      };
  return TableReportSpec(
    title: 'Stock Summary (by item)',
    path: '/api/reports/stock/summary',
    period: ReportPeriodKind.none,
    tiles: const [
      ('Stock value', 'totals.total_value'),
      ('Total items', 'totals.total_items'),
      ('Total quantity', 'totals.total_quantity'),
      ('Out of stock', 'totals.out_of_stock'),
      ('Low stock', 'totals.low_stock'),
    ],
    countTiles: const {'totals.total_items', 'totals.total_quantity', 'totals.out_of_stock', 'totals.low_stock'},
    rowsKey: 'stock',
    rowTitle: (r) => _text(r, 'item_name'),
    rowSubtitle: (r) => _join([_text(r, 'code'), _qtyWithUnit(r['current_stock'], r['unit']), status(_text(r, 'stock_status'))]),
    rowAmountKey: 'stock_value',
    onOpenRow: (ctx, r) => _openItem(ctx, session, _text(r, 'id')),
  );
}

/// `GET /api/reports/stock/closing-stock?financial_year=2026-2027` replies `{ summary, snapshots, ... }`.
TableReportSpec _closingStock(AppSession session) => TableReportSpec(
      // The route pages at 50 rows (200 at most); ask for the most so few shops need "Show more".
      extraQuery: () => 'limit=200',
      emptyTitle: 'No closing stock for this year yet',
      emptyBody: 'Create it on the website.',
      emptyActionLabel: 'Open on website',
      onEmptyAction: (ctx) => openWebsiteInApp(ctx, session, '/reports/stock/closing-stock', 'Closing Stock'),
      title: 'Closing Stock',
      path: '/api/reports/stock/closing-stock',
      period: ReportPeriodKind.financialYear,
      longFinancialYear: true,
      tiles: const [
        ('Total value', 'summary.total_value'),
        ('Total items', 'summary.total_items'),
        ('Total quantity', 'summary.total_quantity'),
      ],
      countTiles: const {'summary.total_items', 'summary.total_quantity'},
      rowsKey: 'snapshots',
      rowTitle: (r) => _text(r, 'item_name'),
      rowSubtitle: (r) => _join([_qtyText(r['quantity']).isEmpty ? '' : 'Qty ${_qtyText(r['quantity'])}', _text(r, 'valuation_method')]),
      rowAmountKey: 'total_value',
      columns: const [
        ReportColumn('Quantity', 'quantity', qty: true),
        ReportColumn('Valuation price', 'unit_cost', money: true),
        ReportColumn('Total value', 'total_value', money: true),
        ReportColumn('Last purchase date', 'last_purchase_date'),
      ],
    );

/// `GET /api/reports/stock/third-party` replies `{ with_third_party, in_transit, inward_transit, totals }`.
/// Three tables from one reply, so all three are sections.
TableReportSpec _thirdParty(AppSession session) {
  const purpose = {
    'repair': 'Repair',
    'job_work': 'Job work',
    'approval': 'Approval',
    'consignment': 'Consignment',
    'exhibition': 'Exhibition',
    'demo': 'Demo',
    'other': 'Other',
  };
  return TableReportSpec(
    title: 'Stock with Parties',
    path: '/api/reports/stock/third-party',
    period: ReportPeriodKind.none,
    tiles: const [
      ('Value held by others', 'totals.with_third_party.value'),
      ('Quantity held by others', 'totals.with_third_party.qty'),
      ('Value on transfers in transit', 'totals.in_transit.value'),
      ('Value bought, on the way', 'totals.inward_transit.value'),
      ('Past return date', 'totals.overdue_returns'),
      ('On an expired e-way bill', 'totals.unproven'),
    ],
    countTiles: const {'totals.with_third_party.qty', 'totals.overdue_returns', 'totals.unproven'},
    rowsKey: _noRows,
    sections: const [
      ('Held by others', 'with_third_party'),
      ('On transfers in transit', 'in_transit'),
      ('Bought, on the way', 'inward_transit'),
    ],
    rowTitle: (r) => _text(r, 'item_name'),
    rowSubtitle: (r) {
      final qty = _qtyText(r['qty']).isEmpty ? '' : 'Qty ${_qtyText(r['qty'])}';
      final eway = _text(r, 'eway_bill_number').isEmpty ? '' : 'E-way ${_text(r, 'eway_bill_number')} (${_text(r, 'eway_bill_status')})';
      if (r.containsKey('challan_id')) {
        final days = _text(r, 'days_out').isEmpty ? '' : '${_text(r, 'days_out')} days out${r['overdue'] == true ? ' (overdue)' : ''}';
        return _join([_text(r, 'party_name'), purpose[_text(r, 'purpose')] ?? _text(r, 'purpose'), _text(r, 'challan_number'), qty, days, eway]);
      }
      if (r.containsKey('transfer_id')) {
        final from = _text(r, 'from_warehouse_name'), to = _text(r, 'to_warehouse_name');
        final route = from.isEmpty || to.isEmpty ? from + to : '$from to $to';
        return _join([_text(r, 'transfer_number'), route, qty, eway]);
      }
      final days = _text(r, 'days_in_transit').isEmpty ? '' : '${_text(r, 'days_in_transit')} days on the way';
      return _join([_text(r, 'supplier_name'), _text(r, 'bill_number').isEmpty ? 'Bill' : _text(r, 'bill_number'), qty, days, eway]);
    },
    rowAmountKey: 'value',
    onOpenRow: (ctx, r) {
      if (_text(r, 'challan_id').isNotEmpty) return _openChallan(ctx, session, _text(r, 'challan_id'));
      if (_text(r, 'transfer_id').isNotEmpty) return openWebsiteInApp(ctx, session, '/stock-transfers/${_text(r, 'transfer_id')}', 'Transfer');
      if (_text(r, 'purchase_id').isNotEmpty) return openWebsiteInApp(ctx, session, '/purchases/${_text(r, 'purchase_id')}', 'Purchase');
    },
  );
}

/// `GET /api/reports/stock/valuation?as_on_date=` replies `{ report: { items, total_value, item_count, ... } }`.
TableReportSpec _valuation() => TableReportSpec(
      title: 'Stock Valuation',
      path: '/api/reports/stock/valuation',
      period: ReportPeriodKind.asOn,
      tiles: const [('Total value', 'report.total_value'), ('Items', 'report.item_count')],
      countTiles: const {'report.item_count'},
      rowsKey: 'report.items',
      rowTitle: (r) => _text(r, 'item_name'),
      rowSubtitle: (r) => _join([_text(r, 'item_code'), _qtyWithUnit(r['quantity'], r['unit']), _upper(r['valuation_method'])]),
      rowAmountKey: 'total_value',
      columns: const [
        ReportColumn('Code', 'item_code'),
        ReportColumn('Quantity', 'quantity', qty: true),
        ReportColumn('Unit cost', 'unit_cost', money: true),
        ReportColumn('Total value', 'total_value', money: true),
        ReportColumn('Method', 'valuation_method'),
      ],
    );

/// `GET /api/reports/stock/quantitative?from=&to=` replies `{ from, to, rows }`. Quantities only.
TableReportSpec _quantitative() => TableReportSpec(
      title: 'Quantity details',
      path: '/api/reports/stock/quantitative',
      period: ReportPeriodKind.range,
      fromKey: 'from',
      toKey: 'to',
      rowsKey: 'rows',
      rowTitle: (r) => _text(r, 'item_name'),
      rowSubtitle: (r) => _join([_text(r, 'item_code'), _text(r, 'unit')]),
      rowAmountKey: 'closing',
      rowAmountText: (r) => reportCellText(r['closing'], qty: true),
      columns: const [
        ReportColumn('Opening', 'opening', qty: true),
        ReportColumn('Purchases', 'purchases', qty: true),
        ReportColumn('Purchase returns', 'purchase_returns', qty: true),
        ReportColumn('Consumed', 'consumed', qty: true),
        ReportColumn('Produced', 'produced', qty: true),
        ReportColumn('Sales', 'sales', qty: true),
        ReportColumn('Sales returns', 'sales_returns', qty: true),
        ReportColumn('Shortage', 'shortage', qty: true),
        ReportColumn('Excess', 'excess', qty: true),
        ReportColumn('Other', 'other', qty: true),
        ReportColumn('Closing', 'closing', qty: true),
      ],
    );

/// `GET /api/reports/stock/bank-statement?as_of=` replies `{ stock, debtors, creditors, eligible_debtors,
/// paid_stock, drawing_power }`. The margins stay at the server's 25 / 25 / 90 days.
TableReportSpec _bankStatement() {
  const classNames = {
    'trading': 'Stock in trade',
    'raw_material': 'Raw material',
    'wip': 'Work in progress',
    'finished_goods': 'Finished goods',
  };
  String title(Map<String, dynamic> r) {
    if (r.containsKey('item_name')) return _text(r, 'item_name');
    if (r.containsKey('stock_class')) return classNames[_text(r, 'stock_class')] ?? _text(r, 'stock_class');
    final bucket = _text(r, 'bucket');
    return bucket == 'no purchase' ? 'Opening stock, never bought since' : '$bucket days';
  }

  return TableReportSpec(
    title: 'Bank stock statement',
    path: '/api/reports/stock/bank-statement',
    period: ReportPeriodKind.asOn,
    asOnKey: 'as_of',
    tiles: const [
      ('Stock', 'stock.total_value'),
      ('Less creditors', 'creditors.total'),
      ('Paid stock', 'paid_stock'),
      ('Debtors', 'debtors.total'),
      ('Eligible debtors', 'eligible_debtors'),
      ('Drawing power', 'drawing_power'),
      ('Slow-moving stock', 'stock.slow_moving_value'),
    ],
    rowsKey: _noRows,
    sections: const [
      ('Stock lines', 'stock.lines'),
      ('Stock by class', 'stock.by_class'),
      ('Stock by age (since last purchase)', 'stock.by_age'),
    ],
    rowTitle: title,
    rowSubtitle: (r) {
      if (!r.containsKey('item_name')) return '';
      final inward = _text(r, 'last_inward');
      return _join([
        _qtyText(r['qty']).isEmpty ? '' : 'Qty ${_qtyText(r['qty'])}',
        inward.isEmpty ? '' : 'last bought $inward',
        _text(r, 'age_bucket'),
        r['slow_moving'] == true ? 'slow moving' : '',
      ]);
    },
    rowAmountKey: 'value',
  );
}

/// `GET /api/reports/stock/job-work?from=&to=` replies `{ sent, received, open }`. Goods still out first.
TableReportSpec _jobWork(AppSession session) => TableReportSpec(
      title: 'Job work (ITC-04)',
      path: '/api/reports/stock/job-work',
      period: ReportPeriodKind.range,
      fromKey: 'from',
      toKey: 'to',
      rowsKey: _noRows,
      sections: const [
        ('Still out', 'open'),
        ('Sent to job workers', 'sent'),
        ('Received back', 'received'),
      ],
      rowTitle: (r) => _text(r, 'item_name'),
      rowSubtitle: (r) {
        final worker = _text(r, 'job_worker');
        final number = _text(r, 'challan_number');
        if (r.containsKey('qty_open')) {
          final due = _text(r, 'deadline');
          return _join([worker, number, due.isEmpty ? '' : 'back by $due${r['deemed_supply'] == true ? ' (past the deadline)' : ''}']);
        }
        if (r.containsKey('qty_returned')) {
          final lost = docNum(r['qty_lost']) ?? 0;
          return _join([worker, number, 'received ${_text(r, 'return_date')}', lost > 0 ? 'lost ${_qtyText(lost)}' : '']);
        }
        return _join([worker, number, _text(r, 'challan_date'), _qtyText(r['qty']).isEmpty ? '' : 'Qty ${_qtyText(r['qty'])}']);
      },
      rowAmountKey: 'taxable_value',
      rowAmountText: (r) {
        if (r.containsKey('qty_open')) return reportCellText(r['qty_open'], qty: true);
        if (r.containsKey('qty_returned')) return reportCellText(r['qty_returned'], qty: true);
        return reportCellText(r['taxable_value'], money: true);
      },
      onOpenRow: (ctx, r) => _openChallan(ctx, session, _text(r, 'challan_id')),
    );

/// `GET /api/reports/stock/fifo-lots?as_on_date=` replies `{ report: { items, totals } }`.
TableReportSpec _fifoLots() => TableReportSpec(
      title: 'FIFO lots',
      path: '/api/reports/stock/fifo-lots',
      period: ReportPeriodKind.asOn,
      tiles: const [
        ('Open lot value', 'report.totals.open_value'),
        ('Inventory account (1104)', 'report.totals.ledger_inventory'),
        ('Difference', 'report.totals.difference'),
      ],
      rowsKey: 'report.items',
      rowTitle: (r) => _text(r, 'item_name'),
      rowSubtitle: (r) => _qtyText(r['open_qty']).isEmpty ? '' : 'Open ${_qtyText(r['open_qty'])}',
      rowAmountKey: 'open_value',
      columns: const [
        ReportColumn('Open quantity', 'open_qty', qty: true),
        ReportColumn('Open value', 'open_value', money: true),
      ],
    );
