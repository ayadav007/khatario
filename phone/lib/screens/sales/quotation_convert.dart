import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import 'sales_logic.dart';

final _inFlight = <String>{};


/// What a conversion did. [invoiceId] is null when the server did not say which invoice it made.
class QuotationConvertResult {
  const QuotationConvertResult(this.invoiceId);

  final String? invoiceId;
}

/// Asks, then `POST /api/invoices/[id]/convert-to-tax-invoice` once (the same call the website makes).
/// Returns a result when the quotation is now converted (including a 409 "already converted", whose
/// reply carries the invoice id), so the caller reloads and opens [QuotationConvertResult.invoiceId].
/// Null when the user said no, a conversion of this quotation is already open or running, or the
/// server refused (its message is shown as a toast and nothing changed).
Future<QuotationConvertResult?> convertQuotation(
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
      builder: (ctx) => _ConfirmSheet(text: quotationConfirmText(number, amount)),
    );
    if (ok != true || !context.mounted) return null;
    showKToast(context, 'Converting $number...');
    final reply = await api.postJson('/api/invoices/$id/convert-to-tax-invoice', quotationConvertBody());
    final invoiceId = convertedInvoiceIdOf(reply);
    if (context.mounted) {
      if (invoiceId == null) {
        showKToast(context, 'Converted, but the new invoice was not returned.', tone: KTone.negative);
      } else {
        final invNo = docText(reply['invoice_number']);
        showKToast(context, invNo.isEmpty ? 'Converted to invoice' : 'Converted to invoice $invNo', tone: KTone.positive);
      }
    }
    return QuotationConvertResult(invoiceId);
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
    if (e.code == 'PROFORMA_ALREADY_CONVERTED') return QuotationConvertResult(convertedInvoiceIdOf(e.body));
    return null;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not reach the server.', tone: KTone.negative);
    return null;
  } finally {
    _inFlight.remove(id);
  }
}

class _ConfirmSheet extends StatefulWidget {
  const _ConfirmSheet({required this.text});

  final String text;

  @override
  State<_ConfirmSheet> createState() => _ConfirmSheetState();
}

class _ConfirmSheetState extends State<_ConfirmSheet> {
  bool _tapped = false;

  void _done(bool value) {
    if (_tapped) return;
    _tapped = true;
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(widget.text, style: AppText.body),
          const SizedBox(height: AppSpace.lg),
          KButton(label: 'Convert', icon: LucideIcons.arrowRight, onPressed: () => _done(true)),
          const SizedBox(height: AppSpace.sm),
          KButton.secondary(label: 'Cancel', onPressed: () => _done(false)),
        ],
      ),
    );
  }
}
