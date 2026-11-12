import 'package:flutter/material.dart';

import '../../session.dart';
import '../docs/doc_logic.dart';
import 'sales_reports.dart';
import 'table_report_screen.dart';

/// The purchase reports of the website's menu (`app/(app)/reports/purchase/[reportType]/page.tsx`), each a
/// [TableReportSpec]. Every figure on a tile is a total the route sends; the phone adds nothing up.
///
/// All seven routes read `from_date` and `to_date` and take the business and the user from the signed-in
/// session (`resolveReportContext` in `lib/reports/report-context.ts`), so the phone sends neither. The
/// summary route also reads `period` and the bill-details route `status`; the phone takes their defaults
/// (by day, all statuses), which are the website's starting values too.
const purchaseReportHrefs = <String>[
  '/reports/purchase/summary',
  '/reports/purchase/invoice-wise',
  '/reports/purchase/supplier-wise',
  '/reports/purchase/item-wise',
  '/reports/purchase/returns',
  '/reports/purchase/credit',
  '/reports/purchase/tax-wise',
];

/// The screen for one purchase report href, or null when it is not one.
Widget? purchaseReportScreen(AppSession session, String href) {
  final spec = purchaseReportSpec(session, href);
  return spec == null ? null : TableReportScreen(session: session, spec: spec);
}

TableReportSpec? purchaseReportSpec(AppSession session, String href) => switch (href) {
      '/reports/purchase/summary' => _summary(),
      '/reports/purchase/invoice-wise' => _billDetails(session),
      '/reports/purchase/supplier-wise' => _supplierWise(session),
      '/reports/purchase/item-wise' => _itemWise(session),
      '/reports/purchase/returns' => _returns(session),
      '/reports/purchase/credit' => _credit(session),
      '/reports/purchase/tax-wise' => _taxWise(),
      _ => null,
    };

String _count(dynamic v, String one, String many) {
  final n = docNum(v);
  return n == null ? '' : '${reportNumber(n)} ${n == 1 ? one : many}';
}

/// `GET /api/reports/purchase/summary` replies `{ summary: [{ period, ... }], totals }`, one row per day.
TableReportSpec _summary() => TableReportSpec(
      title: 'Purchase Summary',
      path: '/api/reports/purchase/summary',
      filters: const [reportPeriodFilter],
      tiles: const [
        ('Net purchases (excl. tax)', 'totals.purchases'),
        ('Purchase returns', 'totals.return_purchases'),
        ('Input tax', 'totals.tax'),
        ('Balance due', 'totals.balance_due'),
        ('Bills', 'totals.bill_count'),
      ],
      countTiles: const {'totals.bill_count'},
      rowsKey: 'summary',
      rowTitle: (r) => reportDate(r['period']),
      rowSubtitle: (r) => _count(r['bill_count'], 'bill', 'bills'),
      rowAmountKey: 'purchases',
      columns: const [
        ReportColumn('Bills', 'bill_count', qty: true),
        ReportColumn('Bill purchases', 'bill_purchases', money: true),
        ReportColumn('Returns', 'return_purchases', money: true),
        ReportColumn('Net purchases', 'purchases', money: true),
        ReportColumn('Tax', 'tax', money: true),
        ReportColumn('Net with tax', 'purchases_with_tax', money: true),
        ReportColumn('Paid', 'paid', money: true),
        ReportColumn('Balance due', 'balance_due', money: true),
      ],
    );

/// `GET /api/reports/purchase/invoice-wise` (Bill Details) replies `{ purchases, totals }`.
TableReportSpec _billDetails(AppSession session) => TableReportSpec(
      title: 'Bill Details',
      path: '/api/reports/purchase/invoice-wise',
      filters: const [reportStatusFilter],
      tiles: const [
        ('Posted bills', 'totals.total_bills'),
        ('Purchases (excl. tax)', 'totals.total_purchases'),
        ('Purchases with tax', 'totals.total_purchases_with_tax'),
        ('Balance due', 'totals.total_pending'),
        ('Drafts', 'totals.draft_count'),
        ('Cancelled', 'totals.cancelled_count'),
      ],
      countTiles: const {'totals.total_bills', 'totals.draft_count', 'totals.cancelled_count'},
      rowsKey: 'purchases',
      rowTitle: (r) => reportText(r, 'bill_number'),
      rowSubtitle: (r) => reportJoin([
        reportDate(r['bill_date']),
        reportText(r, 'supplier_name'),
        reportLabel(reportText(r, 'status') == 'final' ? r['payment_status'] : r['status']),
      ]),
      rowAmountKey: 'grand_total',
      onOpenRow: (ctx, r) => reportOpenPurchase(ctx, session, reportText(r, 'id')),
    );

/// `GET /api/reports/purchase/supplier-wise` replies `{ suppliers, totals }`. The website's "Suppliers" tile
/// is the length of the list, which is not a total the route sends, so it is not here.
TableReportSpec _supplierWise(AppSession session) => TableReportSpec(
      title: 'Purchases by Supplier',
      path: '/api/reports/purchase/supplier-wise',
      tiles: const [
        ('Net purchases (excl. tax)', 'totals.purchases'),
        ('Net purchases with tax', 'totals.purchases_with_tax'),
        ('Balance due', 'totals.balance_due'),
        ('Bills', 'totals.bill_count'),
      ],
      countTiles: const {'totals.bill_count'},
      rowsKey: 'suppliers',
      rowTitle: (r) => reportText(r, 'supplier_name'),
      rowSubtitle: (r) => reportJoin([_count(r['bill_count'], 'bill', 'bills'), reportText(r, 'gstin')]),
      rowAmountKey: 'purchases',
      onOpenRow: (ctx, r) => reportOpenSupplier(ctx, session, reportText(r, 'supplier_id')),
      openRowIdKey: 'supplier_id',
    );

/// `GET /api/reports/purchase/item-wise` replies `{ items, totals, charges }`. Freight and independent
/// services are listed once in `charges`, outside the item amounts.
TableReportSpec _itemWise(AppSession session) => TableReportSpec(
      title: 'Purchases by Item',
      path: '/api/reports/purchase/item-wise',
      tiles: const [
        ('Quantity purchased (net)', 'totals.quantity'),
        ('Goods amount (excl. tax)', 'totals.amount'),
        ('Incidental freight (net, excl. tax)', 'charges.incidental_freight.net_taxable'),
        ('Independent services (excl. tax)', 'charges.independent_services.taxable'),
      ],
      countTiles: const {'totals.quantity'},
      rowsKey: 'items',
      rowTitle: (r) => reportText(r, 'item_name'),
      rowSubtitle: (r) => reportJoin([
        [reportNumber(r['quantity']), reportText(r, 'unit')].where((p) => p.isNotEmpty).join(' '),
        reportText(r, 'hsn_sac').isEmpty ? '' : 'HSN ${reportText(r, 'hsn_sac')}',
      ]),
      rowAmountKey: 'amount',
      onOpenRow: (ctx, r) => reportOpenItem(ctx, session, reportText(r, 'item_id')),
      openRowIdKey: 'item_id',
    );

/// `GET /api/reports/purchase/returns` replies `{ returns, totals }`: purchase returns (debit notes).
TableReportSpec _returns(AppSession session) => TableReportSpec(
      title: 'Purchase Returns',
      path: '/api/reports/purchase/returns',
      tiles: const [
        ('Returns', 'totals.total_returns'),
        ('Returned (excl. tax)', 'totals.total_purchases'),
        ('Returned with tax', 'totals.total_amount'),
        ('Refunded', 'totals.total_refunded'),
      ],
      countTiles: const {'totals.total_returns'},
      rowsKey: 'returns',
      rowTitle: (r) => reportText(r, 'return_number'),
      rowSubtitle: (r) => reportJoin([
        reportText(r, 'supplier_name'),
        reportDate(r['return_date']),
        reportText(r, 'purchase_bill_number').isEmpty ? '' : 'Bill ${reportText(r, 'purchase_bill_number')}',
        reportLabel(r['refund_status']),
      ]),
      rowAmountKey: 'grand_total',
      onOpenRow: (ctx, r) => reportOpenPurchase(ctx, session, reportText(r, 'id'), returned: true),
    );

/// `GET /api/reports/purchase/credit` replies `{ creditPurchases, totals }`: bills that still owe the supplier.
TableReportSpec _credit(AppSession session) => TableReportSpec(
      title: 'Credit Purchases',
      path: '/api/reports/purchase/credit',
      tiles: const [
        ('Unpaid bills', 'totals.total_purchases'),
        ('Bill total', 'totals.total_amount'),
        ('Outstanding', 'totals.total_outstanding'),
        ('Overdue', 'totals.total_overdue'),
      ],
      countTiles: const {'totals.total_purchases'},
      rowsKey: 'creditPurchases',
      rowTitle: (r) => reportText(r, 'bill_number'),
      rowSubtitle: (r) {
        final overdue = reportText(r, 'status_category') == 'overdue';
        return reportJoin([
          reportText(r, 'supplier_name'),
          reportDate(r['bill_date']),
          reportDate(r['due_date']).isEmpty ? '' : 'Due ${reportDate(r['due_date'])}',
          overdue ? 'Overdue ${reportNumber(r['days_overdue'])}d' : reportLabel(r['status_category']),
        ]);
      },
      rowAmountKey: 'balance_amount',
      onOpenRow: (ctx, r) => reportOpenPurchase(ctx, session, reportText(r, 'id')),
    );

/// `GET /api/reports/purchase/tax-wise` replies `{ taxWise, totals }`, net of returns. The website's
/// "CGST + SGST" tile is a sum the page makes, so the two totals are separate tiles here.
TableReportSpec _taxWise() => TableReportSpec(
      title: 'Tax-wise Purchases',
      path: '/api/reports/purchase/tax-wise',
      tiles: const [
        ('Taxable value', 'totals.total_taxable_value'),
        ('Input tax', 'totals.total_tax'),
        ('CGST', 'totals.total_cgst'),
        ('SGST', 'totals.total_sgst'),
        ('IGST', 'totals.total_igst'),
      ],
      rowsKey: 'taxWise',
      rowTitle: (r) => '${reportNumber(r['tax_rate'])}%',
      rowSubtitle: (r) => reportJoin([
        reportText(r, 'hsn_sac').isEmpty ? '' : 'HSN ${reportText(r, 'hsn_sac')}',
        reportNumber(r['total_quantity']).isEmpty ? '' : 'Qty ${reportNumber(r['total_quantity'])}',
      ]),
      rowAmountKey: 'total_tax',
      columns: const [
        ReportColumn('HSN/SAC', 'hsn_sac'),
        ReportColumn('Quantity', 'total_quantity', qty: true),
        ReportColumn('Taxable value', 'total_taxable_value', money: true),
        ReportColumn('CGST', 'total_cgst', money: true),
        ReportColumn('SGST', 'total_sgst', money: true),
        ReportColumn('IGST', 'total_igst', money: true),
        ReportColumn('Cess', 'total_cess', money: true),
        ReportColumn('Total tax', 'total_tax', money: true),
      ],
    );
