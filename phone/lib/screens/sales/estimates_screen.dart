import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:share_plus/share_plus.dart';

import '../../session.dart';
import '../docs/doc_list_screen.dart';
import '../docs/doc_logic.dart';
import '../invoices/invoice_detail_screen.dart';
import '../invoices/invoice_form_screen.dart';
import '../invoices/invoice_share.dart';
import 'quotation_convert.dart';
import 'sales_logic.dart';

/// `app/(app)/estimates/page.tsx`: quotations (invoice rows of type `proforma_invoice`), newest
/// first, with the website's status chips. `GET /api/estimates?limit=50&page=&status=` replies
/// `{ estimates, pagination }`. Open shows the invoice detail; Convert makes a tax invoice.
class EstimatesScreen extends StatelessWidget {
  const EstimatesScreen({super.key, required this.session});

  final AppSession session;

  /// Opens an invoice or quotation. The list reloads when it closes: converting or editing in there
  /// changes the row, and the detail does not report back.
  Future<bool?> _open(BuildContext context, String id) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => InvoiceDetailScreen(api: session.api, invoiceId: id, session: session)),
    );
    return true;
  }

  Future<bool?> _convert(BuildContext context, Map<String, dynamic> row) async {
    final result = await convertQuotation(
      context,
      session.api,
      id: docText(row['id']),
      number: quotationTitle(row),
      amount: docNum(row['grand_total']) ?? 0,
    );
    if (result == null) return null;
    final newId = result.invoiceId;
    if (newId != null && context.mounted) await _open(context, newId);
    return true;
  }

  Future<bool?> _share(BuildContext context, Map<String, dynamic> row) async {
    final number = quotationTitle(row);
    final url = await fetchInvoiceShareUrl(session.api, docText(row['id']));
    await SharePlus.instance.share(ShareParams(text: 'Quotation $number\n$url', subject: 'Quotation $number', title: 'Share quotation'));
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return DocListScreen(
      session: session,
      spec: DocListSpec(
        title: 'Quotations',
        href: '/estimates',
        path: '/api/estimates?limit=50',
        listKey: 'estimates',
        titleOf: quotationTitle,
        subtitleOf: quotationSubtitle,
        amountOf: (r) => docNum(r['grand_total']),
        statusOf: quotationStatus,
        searchKeys: const ['estimate_number', 'customer_name'],
        filters: kQuotationFilters,
        icon: LucideIcons.fileText,
        emptyTitle: 'No quotations yet',
        emptyBody: 'Create a quotation and convert it to an invoice when the customer agrees.',
        createLabel: 'New quotation',
        onCreate: (ctx) => Navigator.of(ctx).push<bool>(
          MaterialPageRoute(builder: (_) => InvoiceFormScreen(session: session, documentType: 'proforma_invoice')),
        ),
        onOpen: (ctx, row) => _open(ctx, docText(row['id'])),
        rowActions: (row) => [
          for (final a in quotationActions(row))
            switch (a) {
              QuotationAction.convert => DocAction('Convert to invoice', LucideIcons.arrowRight, (ctx) => _convert(ctx, row)),
              QuotationAction.openInvoice =>
                DocAction('Open invoice', LucideIcons.externalLink, (ctx) => _open(ctx, convertedInvoiceIdOf(row)!)),
              QuotationAction.share => DocAction('Share', LucideIcons.share2, (ctx) => _share(ctx, row)),
            },
        ],
      ),
    );
  }
}
