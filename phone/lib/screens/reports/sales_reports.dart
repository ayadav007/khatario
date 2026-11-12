import 'package:flutter/material.dart';

import '../../format.dart';
import '../../session.dart';
import '../docs/doc_logic.dart';
import '../invoices/invoice_detail_screen.dart';
import '../invoices/invoice_form_screen.dart';
import '../items/item_detail_screen.dart';
import '../pages/native_routes.dart';
import '../pages/website_page_screen.dart';
import '../parties/customer_detail_screen.dart';
import '../parties/supplier_detail_screen.dart';
import '../purchases/bill_form_screen.dart';
import '../purchases/purchase_section.dart';
import '../sales/credit_debit_notes_screen.dart';
import 'table_report_screen.dart';

/// Shared with the purchase reports.
const reportPeriodFilter = _periodFilter;
const reportStatusFilter = _statusFilter;

/// The sales reports of the website's menu (`app/(app)/reports/sales/[reportType]/page.tsx`), each a
/// [TableReportSpec]. Every figure on a tile is a total the route sends; the phone adds nothing up.
///
/// All eleven routes read `from_date` and `to_date` and take the business and the user from the signed-in
/// session, so the phone sends neither. The summary route also reads `period` (day, week, month) and the
/// invoice-wise route `status` and `channel`; the phone sends none of them and takes the server's defaults
/// (by day, all statuses, all sources), which are the website's starting values too.
const salesReportHrefs = <String>[
  '/reports/sales/summary',
  '/reports/sales/invoice-wise',
  '/reports/sales/item-wise',
  '/reports/sales/party-wise',
  '/reports/sales/tax-wise',
  '/reports/sales/payment-mode',
  '/reports/sales/discount',
  '/reports/sales/credit',
  '/reports/sales/cancelled',
  '/reports/sales/returns',
  '/reports/sales/b2b-b2c',
];

/// The screen for one sales report href, or null when it is not one.
Widget? salesReportScreen(AppSession session, String href) {
  final spec = salesReportSpec(session, href);
  return spec == null ? null : TableReportScreen(session: session, spec: spec);
}

TableReportSpec? salesReportSpec(AppSession session, String href) => switch (href) {
      '/reports/sales/summary' => _summary(),
      '/reports/sales/invoice-wise' => _invoiceWise(session),
      '/reports/sales/item-wise' => _itemWise(session),
      '/reports/sales/party-wise' => _partyWise(session),
      '/reports/sales/tax-wise' => _taxWise(),
      '/reports/sales/payment-mode' => _paymentMode(),
      '/reports/sales/discount' => _discount(session),
      '/reports/sales/credit' => _credit(session),
      '/reports/sales/cancelled' => _cancelled(session),
      '/reports/sales/returns' => _returns(session),
      '/reports/sales/b2b-b2c' => _b2bB2c(),
      _ => null,
    };

// ---------------------------------------------------------------- helpers shared with the purchase and other reports

/// A scalar of the row as text.
String reportText(Map<String, dynamic> row, String key) => docText(row[key]);

/// The non-empty parts joined with a middle dot.
String reportJoin(Iterable<String> parts) => parts.where((p) => p.trim().isNotEmpty).join(' · ');

/// A date or timestamp as `08 Nov 2026`; text that is not a date comes back as it is.
String reportDate(dynamic v) {
  final d = docDate(v);
  return d == null ? docText(v) : ddMMMyyyy(d);
}

/// A number with Indian grouping and at most two decimals, or empty when the reply has none.
String reportNumber(dynamic v) {
  final n = docNum(v);
  return n == null ? '' : '${n < 0 ? '-' : ''}${enIn(n.abs(), maxFraction: 2)}';
}

/// `snake_case` or lower case words as `Snake case`.
String reportLabel(dynamic v) {
  final s = docText(v).replaceAll('_', ' ').trim();
  return s.isEmpty ? '' : s[0].toUpperCase() + s.substring(1);
}

/// Opens another phone screen when the link has one, the website page inside the app otherwise.
void reportOpenHref(BuildContext context, AppSession session, String href, String title) {
  final screen = nativeScreenFor(session, href);
  if (screen == null) return openWebsiteInApp(context, session, href, title);
  Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
}

void reportOpenInvoice(BuildContext context, AppSession session, String id) {
  if (id.isEmpty) return;
  Navigator.of(context).push(MaterialPageRoute<void>(
    builder: (_) => InvoiceDetailScreen(api: session.api, invoiceId: id, businessName: session.businessName, session: session),
  ));
}

/// What the customer and supplier pages ask the app to open: links, and the "New ..." actions.
void _openFromParty(BuildContext context, AppSession session, String what) {
  if (what.startsWith('/')) return reportOpenHref(context, session, what, 'Open');
  final navigator = Navigator.of(context);
  if (what == 'New invoice' || what.startsWith('New invoice:')) {
    final id = what.startsWith('New invoice:') ? what.substring('New invoice:'.length) : '';
    navigator.push(MaterialPageRoute<void>(builder: (_) => InvoiceFormScreen(session: session, customerId: id.isEmpty ? null : id)));
  } else if (what == 'New estimate' || what == 'New quotation') {
    navigator.push(MaterialPageRoute<void>(builder: (_) => InvoiceFormScreen(session: session, documentType: 'proforma_invoice')));
  } else if (what == 'New payment') {
    reportOpenHref(context, session, '/payments/in', 'Payment in');
  } else if (what == 'New payment out') {
    reportOpenHref(context, session, '/payments/out', 'Payment out');
  } else if (what == 'New purchase') {
    navigator.push(MaterialPageRoute<void>(builder: (_) => BillFormScreen(session: session, kind: BillKind.purchase)));
  }
}

void reportOpenCustomer(BuildContext context, AppSession session, String id) {
  if (id.isEmpty) return;
  Navigator.of(context).push(MaterialPageRoute<void>(
    builder: (ctx) => CustomerDetailScreen(session: session, customerId: id, onOpen: (what) => _openFromParty(ctx, session, what)),
  ));
}

void reportOpenSupplier(BuildContext context, AppSession session, String id) {
  if (id.isEmpty) return;
  Navigator.of(context).push(MaterialPageRoute<void>(
    builder: (ctx) => SupplierDetailScreen(session: session, supplierId: id, onOpen: (what) => _openFromParty(ctx, session, what)),
  ));
}

void reportOpenItem(BuildContext context, AppSession session, String id) {
  if (id.isEmpty) return;
  Navigator.of(context).push(MaterialPageRoute<void>(
    builder: (ctx) => ItemDetailScreen(
      session: session,
      itemId: id,
      onOpen: (what) {
        if (what.startsWith('/')) return reportOpenHref(ctx, session, what, 'Item');
        switch (what) {
          case 'New inventory adjustment':
            return reportOpenHref(ctx, session, '/inventory-adjustments/new', 'New adjustment');
          case 'Purchase detail':
            return reportOpenHref(ctx, session, '/purchases', 'Purchases');
          case 'The full item page':
            return openWebsiteInApp(ctx, session, '/items/$id', 'Item');
        }
      },
    ),
  ));
}

void reportOpenCreditNote(BuildContext context, AppSession session, String id) {
  if (id.isEmpty) return;
  Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => NoteDetailScreen(session: session, noteId: id)));
}

/// A purchase bill (`/api/purchases/<id>`) or a purchase return (`/api/purchase-returns/<id>`).
void reportOpenPurchase(BuildContext context, AppSession session, String id, {bool returned = false}) {
  if (id.isEmpty) return;
  Navigator.of(context).push(MaterialPageRoute<void>(
    builder: (_) => PurchaseDetailScreen(
      session: session,
      title: returned ? 'Purchase return' : 'Purchase',
      path: returned ? '/api/purchase-returns/$id' : '/api/purchases/$id',
      objectKey: returned ? 'purchaseReturn' : 'purchase',
      kind: returned ? PurchaseKind.returns : PurchaseKind.bills,
    ),
  ));
}

// ---------------------------------------------------------------- reports

/// `GET /api/reports/sales/summary` replies `{ summary: [{ period, ... }], totals }`, one row per day.
TableReportSpec _summary() => const TableReportSpec(
      title: 'Sales Summary',
      path: '/api/reports/sales/summary',
      filters: [_periodFilter],
      tiles: [
        ('Net sales (excl. tax)', 'totals.sales'),
        ('Credit notes', 'totals.credit_note_sales'),
        ('Tax', 'totals.tax'),
        ('Net sales with tax', 'totals.sales_with_tax'),
        ('Invoices', 'totals.invoice_count'),
      ],
      countTiles: {'totals.invoice_count'},
      rowsKey: 'summary',
      rowTitle: _summaryTitle,
      rowSubtitle: _summarySubtitle,
      rowAmountKey: 'sales',
      columns: [
        ReportColumn('Invoices', 'invoice_count', qty: true),
        ReportColumn('Invoice sales', 'invoice_sales', money: true),
        ReportColumn('Credit notes', 'credit_note_sales', money: true),
        ReportColumn('Net sales', 'sales', money: true),
        ReportColumn('Tax', 'tax', money: true),
        ReportColumn('Net with tax', 'sales_with_tax', money: true),
        ReportColumn('Collected', 'collected', money: true),
        ReportColumn('Balance due', 'balance_due', money: true),
      ],
    );

/// The summary routes' `period=day|week|month` (website: `<select>` with Day, Week, Month; day first).
const _periodFilter = ReportFilter('Group by', 'period', [('day', 'Day'), ('week', 'Week'), ('month', 'Month')]);

/// `status` of the invoice-wise route (website `invoiceStatus` select: all, final, draft, cancelled).
const _statusFilter = ReportFilter(
  'Status',
  'status',
  [('all', 'All'), ('final', 'Final'), ('draft', 'Draft'), ('cancelled', 'Cancelled')],
  omitValue: 'all',
);

/// `channel` of the invoice-wise route (website `invoiceChannel` select; labels from `CHANNEL_LABEL`).
const _channelFilter = ReportFilter(
  'Source',
  'channel',
  [
    ('all', 'All sources'),
    ('online_store', 'Online store'),
    ('whatsapp', 'WhatsApp'),
    ('counter', 'Counter'),
    ('manual', 'Manual'),
    ('sales_order', 'Sales order'),
  ],
  omitValue: 'all',
);

String _summaryTitle(Map<String, dynamic> r) => reportDate(r['period']);

String _summarySubtitle(Map<String, dynamic> r) {
  final n = docNum(r['invoice_count']);
  return n == null ? '' : '${reportNumber(n)} ${n == 1 ? 'invoice' : 'invoices'}';
}

/// `GET /api/reports/sales/invoice-wise` replies `{ invoices, totals, by_channel, unbilled_orders }`.
TableReportSpec _invoiceWise(AppSession session) => TableReportSpec(
      title: 'Invoice-wise Sales',
      path: '/api/reports/sales/invoice-wise',
      filters: const [_statusFilter, _channelFilter],
      notice: _unbilledNotice,
      tiles: const [
        ('Posted invoices', 'totals.total_invoices'),
        ('Sales (excl. tax)', 'totals.total_sales'),
        ('Sales with tax', 'totals.total_sales_with_tax'),
        ('Balance due', 'totals.total_pending'),
        ('Drafts', 'totals.draft_count'),
        ('Cancelled', 'totals.cancelled_count'),
      ],
      countTiles: const {'totals.total_invoices', 'totals.draft_count', 'totals.cancelled_count'},
      rowsKey: 'invoices',
      rowTitle: (r) => reportText(r, 'invoice_number'),
      rowSubtitle: (r) => reportJoin([
        reportDate(r['invoice_date']),
        reportText(r, 'customer_name'),
        reportLabel(reportText(r, 'status') == 'final' ? r['payment_status'] : r['status']),
      ]),
      rowAmountKey: 'grand_total',
      onOpenRow: (ctx, r) => reportOpenInvoice(ctx, session, reportText(r, 'id')),
    );

/// The website's note when store or WhatsApp orders in the period have no bill yet (`unbilled_orders`).
String? _unbilledNotice(dynamic body) {
  final u = readPath(body, 'unbilled_orders');
  final count = u is Map ? docNum(u['count']) : null;
  if (count == null || count <= 0) return null;
  final amount = reportCellText(u is Map ? u['amount'] : null, money: true);
  final orders = count == 1 ? 'order' : 'orders';
  return '${reportNumber(count)} online store / WhatsApp $orders worth $amount in this period '
      '${count == 1 ? 'has' : 'have'} no bill yet, so ${count == 1 ? 'it is' : 'they are'} not counted as sales.';
}

/// `GET /api/reports/sales/item-wise` replies `{ items, totals }`. A free-text line has no `item_id`.
TableReportSpec _itemWise(AppSession session) => TableReportSpec(
      title: 'Item-wise Sales',
      path: '/api/reports/sales/item-wise',
      tiles: const [
        ('Quantity sold (net)', 'totals.quantity_sold'),
        ('Amount (excl. tax)', 'totals.amount'),
        ('Tax', 'totals.tax'),
        ('Discount given', 'totals.discount'),
      ],
      countTiles: const {'totals.quantity_sold'},
      rowsKey: 'items',
      rowTitle: (r) => reportText(r, 'item_name'),
      rowSubtitle: (r) => reportJoin([
        reportText(r, 'quantity_label').isEmpty ? reportNumber(r['quantity_sold']) : reportText(r, 'quantity_label'),
        reportText(r, 'hsn_sac').isEmpty ? '' : 'HSN ${reportText(r, 'hsn_sac')}',
      ]),
      rowAmountKey: 'amount',
      onOpenRow: (ctx, r) => reportOpenItem(ctx, session, reportText(r, 'item_id')),
      openRowIdKey: 'item_id',
    );

/// `GET /api/reports/sales/party-wise` replies `{ parties, totals }`. The website's "Customers" tile is the
/// length of the list, which is not a total the route sends, so it is not here.
TableReportSpec _partyWise(AppSession session) => TableReportSpec(
      title: 'Party-wise Sales',
      path: '/api/reports/sales/party-wise',
      tiles: const [
        ('Net sales (excl. tax)', 'totals.sales'),
        ('Net sales with tax', 'totals.sales_with_tax'),
        ('Balance due', 'totals.balance_due'),
        ('Invoices', 'totals.invoice_count'),
      ],
      countTiles: const {'totals.invoice_count'},
      rowsKey: 'parties',
      rowTitle: (r) => reportText(r, 'customer_name'),
      rowSubtitle: (r) {
        final n = docNum(r['invoice_count']);
        return reportJoin([
          n == null ? '' : '${reportNumber(n)} ${n == 1 ? 'invoice' : 'invoices'}',
          reportText(r, 'gstin'),
        ]);
      },
      rowAmountKey: 'sales',
      onOpenRow: (ctx, r) => reportOpenCustomer(ctx, session, reportText(r, 'customer_id')),
      openRowIdKey: 'customer_id',
    );

/// `GET /api/reports/sales/tax-wise` replies `{ taxWise, totals }`, one row per rate and HSN. The rows come
/// straight from the database, so their numbers are strings.
TableReportSpec _taxWise() => TableReportSpec(
      title: 'Tax-wise Sales',
      path: '/api/reports/sales/tax-wise',
      tiles: const [
        ('Taxable value', 'totals.total_taxable_value'),
        ('Total tax', 'totals.total_tax'),
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
        ReportColumn('Total tax', 'total_tax', money: true),
        ReportColumn('Total amount', 'total_amount', money: true),
      ],
    );

/// `GET /api/reports/sales/payment-mode` replies `{ byPaymentMode, totals }`.
TableReportSpec _paymentMode() => const TableReportSpec(
      title: 'Sales by Payment Mode',
      path: '/api/reports/sales/payment-mode',
      tiles: [
        ('Invoices', 'totals.total_invoices'),
        ('Total amount', 'totals.total_amount'),
      ],
      countTiles: {'totals.total_invoices'},
      rowsKey: 'byPaymentMode',
      rowTitle: _modeTitle,
      rowSubtitle: _modeSubtitle,
      rowAmountKey: 'total_amount',
      columns: [
        ReportColumn('Invoices', 'invoice_count', qty: true),
        ReportColumn('Total amount', 'total_amount', money: true),
      ],
    );

String _modeTitle(Map<String, dynamic> r) {
  final mode = reportLabel(r['payment_mode']);
  return mode.isEmpty ? 'Unpaid' : mode;
}

String _modeSubtitle(Map<String, dynamic> r) {
  final n = docNum(r['invoice_count']);
  return n == null ? '' : '${reportNumber(n)} ${n == 1 ? 'invoice' : 'invoices'}';
}

/// `GET /api/reports/sales/discount` replies `{ discounts, totals }`; the average is a percentage.
TableReportSpec _discount(AppSession session) => TableReportSpec(
      title: 'Discount Given',
      path: '/api/reports/sales/discount',
      tiles: const [
        ('Invoices', 'totals.total_invoices'),
        ('Total subtotal', 'totals.total_subtotal'),
        ('Total discount', 'totals.total_discount'),
        ('Average discount %', 'totals.avg_discount_percent'),
      ],
      countTiles: const {'totals.total_invoices', 'totals.avg_discount_percent'},
      rowsKey: 'discounts',
      rowTitle: (r) => reportText(r, 'invoice_number'),
      rowSubtitle: (r) => reportJoin([
        reportDate(r['invoice_date']),
        reportText(r, 'customer_name'),
        reportNumber(r['discount_percent']).isEmpty ? '' : '${reportNumber(r['discount_percent'])}% off',
      ]),
      rowAmountKey: 'discount_total',
      onOpenRow: (ctx, r) => reportOpenInvoice(ctx, session, reportText(r, 'id')),
    );

/// `GET /api/reports/sales/credit` replies `{ creditSales, totals }`: invoices that still have a balance.
TableReportSpec _credit(AppSession session) => TableReportSpec(
      title: 'Credit Sales',
      path: '/api/reports/sales/credit',
      tiles: const [
        ('Invoices', 'totals.total_invoices'),
        ('Total sales', 'totals.total_sales'),
        ('Outstanding', 'totals.total_outstanding'),
        ('Overdue', 'totals.total_overdue'),
      ],
      countTiles: const {'totals.total_invoices'},
      rowsKey: 'creditSales',
      rowTitle: (r) => reportText(r, 'invoice_number'),
      rowSubtitle: (r) => reportJoin([
        reportText(r, 'customer_name'),
        reportDate(r['invoice_date']),
        reportDate(r['due_date']).isEmpty ? '' : 'Due ${reportDate(r['due_date'])}',
        reportLabel(r['status_category']),
      ]),
      rowAmountKey: 'balance_amount',
      onOpenRow: (ctx, r) => reportOpenInvoice(ctx, session, reportText(r, 'id')),
    );

/// `GET /api/reports/sales/cancelled` replies `{ cancelledInvoices, totals }`.
TableReportSpec _cancelled(AppSession session) => TableReportSpec(
      title: 'Cancelled Sales',
      path: '/api/reports/sales/cancelled',
      tiles: const [
        ('Cancelled', 'totals.total_invoices'),
        ('Total amount', 'totals.total_amount'),
        ('Total tax', 'totals.total_tax'),
      ],
      countTiles: const {'totals.total_invoices'},
      rowsKey: 'cancelledInvoices',
      rowTitle: (r) => reportText(r, 'invoice_number'),
      rowSubtitle: (r) => reportJoin([
        reportText(r, 'customer_name'),
        reportDate(r['invoice_date']),
        reportText(r, 'cancellation_reason'),
      ]),
      rowAmountKey: 'grand_total',
      onOpenRow: (ctx, r) => reportOpenInvoice(ctx, session, reportText(r, 'id')),
    );

/// `GET /api/reports/sales/returns` replies `{ returns, totals }`: credit notes by their date.
TableReportSpec _returns(AppSession session) => TableReportSpec(
      title: 'Sales Returns',
      path: '/api/reports/sales/returns',
      tiles: const [
        ('Returns', 'totals.total_returns'),
        ('Total amount', 'totals.total_amount'),
        ('Total refunded', 'totals.total_refunded'),
        ('Refund pending', 'totals.pending_count'),
      ],
      countTiles: const {'totals.total_returns', 'totals.pending_count'},
      rowsKey: 'returns',
      rowTitle: (r) => reportText(r, 'credit_note_number'),
      rowSubtitle: (r) => reportJoin([
        reportText(r, 'customer_name'),
        reportDate(r['credit_note_date']),
        reportText(r, 'invoice_number').isEmpty ? '' : 'Invoice ${reportText(r, 'invoice_number')}',
        reportLabel(r['refund_status']),
      ]),
      rowAmountKey: 'grand_total',
      onOpenRow: (ctx, r) => reportOpenCreditNote(ctx, session, reportText(r, 'id')),
    );

/// `GET /api/reports/sales/b2b-b2c` replies `{ salesByType, totals }`.
TableReportSpec _b2bB2c() => const TableReportSpec(
      title: 'B2B vs B2C Sales',
      path: '/api/reports/sales/b2b-b2c',
      tiles: [
        ('Invoices', 'totals.total_invoices'),
        ('Total sales', 'totals.total_sales'),
        ('Total tax', 'totals.total_tax'),
        ('Total pending', 'totals.total_pending'),
      ],
      countTiles: {'totals.total_invoices'},
      rowsKey: 'salesByType',
      rowTitle: _typeTitle,
      rowSubtitle: _modeSubtitle,
      rowAmountKey: 'total_sales',
      columns: [
        ReportColumn('Invoices', 'invoice_count', qty: true),
        ReportColumn('Sales', 'total_sales', money: true),
        ReportColumn('Taxable value', 'total_taxable_value', money: true),
        ReportColumn('CGST', 'total_cgst', money: true),
        ReportColumn('SGST', 'total_sgst', money: true),
        ReportColumn('IGST', 'total_igst', money: true),
        ReportColumn('Total tax', 'total_tax', money: true),
        ReportColumn('Collected', 'total_collected', money: true),
        ReportColumn('Pending', 'total_pending', money: true),
      ],
    );

String _typeTitle(Map<String, dynamic> r) => reportText(r, 'sale_type');
