import 'package:flutter/material.dart';

import '../../api.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import 'quotation_convert.dart' show ConvertConfirmSheet;
import 'sales_order_logic.dart';

final _inFlight = <String>{};

/// What a conversion did. [invoiceId] is null when no new invoice should open (partial, refused-as-stale).
class SalesOrderConvertResult {
  const SalesOrderConvertResult({this.invoiceId, this.partial = false});

  final String? invoiceId;

  /// The order is still open (some quantity left to invoice).
  final bool partial;
}

/// Asks, then `POST /api/sales-orders/[id]/convert` once with `{}` (invoice everything left, the website's
/// "Invoice all remaining"). The reply is `{ invoice: { id, invoice_number }, partial, sales_order_status }`.
///
/// Returns a result when the order changed, so the caller reloads. `NOTHING_REMAINING` and
/// `NOT_CONVERTIBLE` mean the order was already invoiced or closed: the server message is shown and the
/// caller reloads (a result with no invoice). Null when the user said no, a conversion of this order is
/// already open or running, or the server refused (its message is a toast and nothing changed).
Future<SalesOrderConvertResult?> convertSalesOrder(
  BuildContext context,
  KhatarioApi api, {
  required String id,
  required String number,
  required num amount,
}) async {
  if (!_inFlight.add(id)) return null;
  try {
    final ok = await showKSheet<bool>(
      context,
      title: 'Convert to invoice?',
      builder: (ctx) => ConvertConfirmSheet(text: salesOrderConfirmText(number, amount)),
    );
    if (ok != true || !context.mounted) return null;
    showKToast(context, 'Converting $number...');
    final reply = await api.postJson('/api/sales-orders/$id/convert', const {});
    final invoice = reply['invoice'];
    final invoiceId = [invoice is Map ? docText(invoice['id']) : '', docText(reply['invoice_id'])].firstWhere((e) => e.isNotEmpty, orElse: () => '');
    final invoiceNo = invoice is Map ? docText(invoice['invoice_number']) : '';
    final partial = reply['partial'] == true;
    if (context.mounted) {
      if (invoiceId.isEmpty) {
        showKToast(context, 'Converted. Open the order to see the new invoice.');
      } else if (partial) {
        showKToast(context, 'Partial invoice created${invoiceNo.isEmpty ? '' : ': $invoiceNo'} (order still open)', tone: KTone.positive);
      } else {
        showKToast(context, invoiceNo.isEmpty ? 'Converted to invoice' : 'Converted to invoice $invoiceNo', tone: KTone.positive);
      }
    }
    return SalesOrderConvertResult(invoiceId: invoiceId.isEmpty || partial ? null : invoiceId, partial: partial);
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
    if (e.code == 'NOTHING_REMAINING' || e.code == 'NOT_CONVERTIBLE') return const SalesOrderConvertResult();
    return null;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not reach the server.', tone: KTone.negative);
    return null;
  } finally {
    _inFlight.remove(id);
  }
}
