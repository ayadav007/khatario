import 'dart:io';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_detail_screen.dart';
import '../docs/doc_list_screen.dart';
import '../docs/doc_logic.dart';
import '../invoices/invoice_detail_screen.dart';
import '../payments/payment_in_logic.dart' show RecordedPayments;
import '../payments/payment_in_screen.dart';
import '../purchases/bill_form_screen.dart';
import 'sales_order_convert.dart';
import 'sales_order_logic.dart';

/// `app/(app)/sales-orders/page.tsx`: orders newest first with the website's status chips.
/// `GET /api/sales-orders?status=` replies `{ salesOrders }` in one piece (the route does not page).
/// Open shows the order; long-press offers Convert, Open invoice and Share.
class SalesOrdersScreen extends StatelessWidget {
  const SalesOrdersScreen({super.key, required this.session});

  final AppSession session;

  /// The order page. The list reloads when it closes with a change (convert, edit, advance).
  Future<bool?> _open(BuildContext context, Map<String, dynamic> row) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => SalesOrderDetailScreen(session: session, seed: row)),
    );
    return changed == true;
  }

  @override
  Widget build(BuildContext context) {
    return DocListScreen(
      session: session,
      spec: DocListSpec(
        title: 'Sales orders',
        href: '/sales-orders',
        path: '/api/sales-orders',
        listKey: 'salesOrders',
        titleOf: salesOrderTitle,
        subtitleOf: salesOrderSubtitle,
        amountOf: (r) => docNum(r['grand_total']),
        statusOf: salesOrderStatus,
        searchKeys: const ['order_number', 'customer_name'],
        filters: kSalesOrderFilters,
        icon: LucideIcons.package,
        emptyTitle: 'No sales orders yet',
        emptyBody: 'Create a sales order to track what a customer ordered, then convert it to an invoice when you deliver.',
        createLabel: 'New sales order',
        onCreate: (ctx) => Navigator.of(ctx).push<bool>(
          MaterialPageRoute(builder: (_) => BillFormScreen(session: session, kind: BillKind.salesOrder)),
        ),
        onOpen: _open,
        rowActions: (row) => [
          for (final a in salesOrderRowActions(row))
            switch (a) {
              SalesOrderAction.convert => DocAction('Convert to invoice', LucideIcons.arrowRight, (ctx) => convertAndOpen(ctx, session, row)),
              SalesOrderAction.openInvoice =>
                DocAction('Open invoice', LucideIcons.externalLink, (ctx) => openInvoice(ctx, session, linkedInvoiceIdOf(row)!)),
              SalesOrderAction.share => DocAction('Share', LucideIcons.share2, (ctx) => shareSalesOrder(ctx, session, row)),
            },
        ],
      ),
    );
  }
}

/// Opens an invoice. Returns true: what is behind it may have changed.
Future<bool?> openInvoice(BuildContext context, AppSession session, String id) async {
  await Navigator.of(context).push<void>(
    MaterialPageRoute(builder: (_) => InvoiceDetailScreen(api: session.api, invoiceId: id, session: session)),
  );
  return true;
}

/// Asks, converts, and opens the new invoice from the reply. True when the order changed (reload).
Future<bool?> convertAndOpen(BuildContext context, AppSession session, Map<String, dynamic> order) async {
  final result = await convertSalesOrder(
    context,
    session.api,
    id: docText(order['id']),
    number: salesOrderTitle(order),
    amount: docNum(order['grand_total']) ?? 0,
  );
  if (result == null) return null;
  final newId = result.invoiceId;
  if (newId != null && context.mounted) await openInvoice(context, session, newId);
  return true;
}

/// Shares the order's PDF (`GET /api/documents/sales_orders/[id]/pdf`, the website's Print and PDF).
Future<bool?> shareSalesOrder(BuildContext context, AppSession session, Map<String, dynamic> order) async {
  final id = docText(order['id']);
  final number = salesOrderTitle(order);
  try {
    final bytes = await session.api.getBytes('/api/documents/sales_orders/$id/pdf');
    final dir = await getTemporaryDirectory();
    final safe = number.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    final file = File('${dir.path}/SalesOrder-$safe.pdf');
    await file.writeAsBytes(bytes);
    await SharePlus.instance.share(ShareParams(files: [XFile(file.path)], subject: 'Sales order $number'));
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not share the sales order. Try again.', tone: KTone.negative);
  }
  return null;
}

/// The order page: `GET /api/sales-orders/[id]` (`{ salesOrder }`) and `.../payment-summary`. Convert is the
/// main action while the order is open; Edit, Record advance, Open invoice and Share are under More.
class SalesOrderDetailScreen extends StatelessWidget {
  const SalesOrderDetailScreen({super.key, required this.session, this.seed, this.orderId});

  final AppSession session;
  final Map<String, dynamic>? seed;
  final String? orderId;

  String get _id => orderId ?? docText(seed?['id']);

  /// The payment summary rides along under this key. A failing summary just leaves it out
  /// (the website hides the card then).
  static const summaryKey = '_payment_summary';

  Future<Map<String, dynamic>> _load(KhatarioApi api) async {
    final body = await api.getJson('/api/sales-orders/$_id');
    final raw = body['salesOrder'];
    if (raw is! Map) throw ApiException('Sales order not found');
    final order = Map<String, dynamic>.from(raw);
    try {
      order[summaryKey] = await api.getJson('/api/sales-orders/$_id/payment-summary');
    } catch (_) {}
    return order;
  }

  Future<bool?> _edit(BuildContext context, Map<String, dynamic> order) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => BillFormScreen(session: session, kind: BillKind.salesOrder, salesOrderId: docText(order['id']))),
    );
    return saved == true ? true : null;
  }

  /// Payment in for the order's customer. The website has no key that ties a receipt to an order (its
  /// payment card only sums gateway payments), so this records an ordinary receipt for the customer.
  Future<bool?> _advance(BuildContext context, Map<String, dynamic> order) async {
    final recorded = await Navigator.of(context).push<RecordedPayments>(
      MaterialPageRoute(
        builder: (_) => PaymentInFormScreen(
          session: session,
          initialParty: {'id': docText(order['customer_id']), 'name': docText(order['customer_name'])},
          initialNotes: 'Advance for sales order ${salesOrderTitle(order)}',
        ),
      ),
    );
    return recorded == null ? null : true;
  }

  static bool _canAdvance(Map<String, dynamic> order) =>
      salesOrderStatus(order) != 'cancelled' && docText(order['customer_id']).isNotEmpty;

  @override
  Widget build(BuildContext context) {
    return DocDetailScreen(
      session: session,
      seed: seed,
      spec: DocDetailSpec(
        title: 'Sales order',
        load: _load,
        numberOf: salesOrderTitle,
        statusOf: salesOrderStatus,
        partyOf: (d) => docText(d['customer_name']),
        amountOf: (d) => docNum(d['grand_total']),
        facts: (d) {
          final date = docDate(d['order_date']);
          final delivery = docDate(d['expected_delivery_date']);
          final summary = d[summaryKey];
          return [
            ('Order date', date == null ? '' : ddMMMyyyy(date)),
            ('Expected delivery', delivery == null ? '' : ddMMMyyyy(delivery)),
            ...salesOrderPaymentRows(summary is Map ? Map<String, dynamic>.from(summary) : null),
            ('Phone', docText(d['customer_phone'])),
            ('Notes', docText(d['notes'])),
          ];
        },
        lines: (d) {
          final raw = d['items'];
          if (raw is! List) return const [];
          return [
            for (final l in raw.whereType<Map>())
              DocLine(
                docText(l['item_name']).isEmpty ? 'Item' : docText(l['item_name']),
                subtitle: salesOrderLineSubtitle(Map<String, dynamic>.from(l)),
                amount: docNum(l['line_total']),
              ),
          ];
        },
        totals: (d) {
          num? shown(String key) {
            final v = docNum(d[key]);
            return v == null || v.abs() < 0.0001 ? null : v;
          }

          return [
            ('Subtotal', docNum(d['subtotal'])),
            ('Additional charges', shown('additional_charges')),
            ('GST', shown('tax_total')),
            ('Round off', shown('round_off')),
            ('Total', docNum(d['grand_total'])),
          ];
        },
        primary: (d) {
          if (canConvertSalesOrder(d)) {
            return DocAction('Convert to invoice', LucideIcons.arrowRight, (ctx) => convertAndOpen(ctx, session, d));
          }
          final invoice = linkedInvoiceIdOf(d);
          if (invoice != null) return DocAction('Open invoice', LucideIcons.externalLink, (ctx) => openInvoice(ctx, session, invoice));
          return null;
        },
        actions: (d) {
          final invoice = linkedInvoiceIdOf(d);
          return [
            if (canEditSalesOrder(d)) DocAction('Edit', LucideIcons.pencil, (ctx) => _edit(ctx, d)),
            if (_canAdvance(d)) DocAction('Record advance', LucideIcons.indianRupee, (ctx) => _advance(ctx, d)),
            if (invoice != null && canConvertSalesOrder(d)) DocAction('Open invoice', LucideIcons.externalLink, (ctx) => openInvoice(ctx, session, invoice)),
            DocAction('Share', LucideIcons.share2, (ctx) => shareSalesOrder(ctx, session, d)),
          ];
        },
      ),
    );
  }
}
