import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';

enum InvoiceShareFormat { pdf, image, link }

/// `fetchInvoiceShareUrl` in `lib/share-invoice.ts`.
Future<String> fetchInvoiceShareUrl(KhatarioApi api, String invoiceId) async {
  try {
    final data = await api.getJson('/api/invoices/$invoiceId/public-link');
    final url = data['public_url'];
    if (url is String && url.isNotEmpty) return url;
  } catch (_) {}
  return '$apiBaseUrl/invoices/$invoiceId/view';
}

/// `fetchInvoiceFileBlob`: the server renders the PDF / PNG for the session user.
Future<Uint8List> fetchInvoiceFile(KhatarioApi api, String invoiceId, InvoiceShareFormat format) async {
  final kind = format == InvoiceShareFormat.pdf ? 'pdf' : 'image';
  final bytes = await api.getBytes('/api/invoices/$invoiceId/$kind');
  if (bytes.length < 32) throw ApiException('Invoice ${kind.toUpperCase()} file is empty');
  return Uint8List.fromList(bytes);
}

String invoiceFileName(String invoiceNumber, String ext) {
  final base = invoiceNumber.replaceAll(RegExp(r'[^\w.-]+'), '_');
  return 'invoice-${base.isEmpty ? 'invoice' : base}.$ext';
}

/// `shareInvoiceNative` (Capacitor path): link text or a PDF / PNG attachment through the phone share menu.
Future<ShareResultStatus> shareInvoice({
  required AppSession session,
  required String invoiceId,
  required String invoiceNumber,
  required InvoiceShareFormat format,
}) async {
  final api = session.api;
  final shareUrl = await fetchInvoiceShareUrl(api, invoiceId);
  final title = 'Invoice $invoiceNumber';
  final businessName = session.businessName;
  final text = businessName.isNotEmpty ? 'Invoice $invoiceNumber from $businessName' : 'Invoice $invoiceNumber';

  if (format == InvoiceShareFormat.link) {
    final result = await SharePlus.instance.share(ShareParams(text: '$text\n$shareUrl', subject: title, title: 'Share invoice'));
    return result.status;
  }

  final bytes = await fetchInvoiceFile(api, invoiceId, format);
  final isPdf = format == InvoiceShareFormat.pdf;
  final dir = await getTemporaryDirectory();
  final file = File('${dir.path}/${invoiceFileName(invoiceNumber, isPdf ? 'pdf' : 'png')}');
  await file.writeAsBytes(bytes, flush: true);
  final result = await SharePlus.instance.share(ShareParams(
    files: [XFile(file.path, mimeType: isPdf ? 'application/pdf' : 'image/png')],
    text: text,
    subject: title,
    title: 'Share invoice',
  ));
  return result.status;
}

/// `components/invoices/ShareInvoiceFormatSheet.tsx`.
Future<void> showShareInvoiceSheet(
  BuildContext context, {
  required AppSession session,
  required String invoiceId,
  required String invoiceNumber,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    barrierColor: AppColors.scrim,
    backgroundColor: Colors.transparent,
    elevation: 0,
    builder: (_) => _ShareInvoiceSheet(session: session, invoiceId: invoiceId, invoiceNumber: invoiceNumber),
  );
}

class _ShareInvoiceSheet extends StatefulWidget {
  const _ShareInvoiceSheet({required this.session, required this.invoiceId, required this.invoiceNumber});

  final AppSession session;
  final String invoiceId;
  final String invoiceNumber;

  @override
  State<_ShareInvoiceSheet> createState() => _ShareInvoiceSheetState();
}

class _ShareInvoiceSheetState extends State<_ShareInvoiceSheet> {
  InvoiceShareFormat? _loading;

  Future<void> _handle(InvoiceShareFormat format) async {
    setState(() => _loading = format);
    final messenger = ScaffoldMessenger.of(context);
    final nav = Navigator.of(context);
    try {
      await shareInvoice(
        session: widget.session,
        invoiceId: widget.invoiceId,
        invoiceNumber: widget.invoiceNumber,
        format: format,
      );
      if (mounted) nav.pop();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not share invoice')));
    } finally {
      if (mounted) setState(() => _loading = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    const options = [
      (InvoiceShareFormat.pdf, 'Share as PDF', 'Attach invoice PDF — WhatsApp, Gmail, Drive, etc.', LucideIcons.fileText, AppTints.rose),
      (InvoiceShareFormat.image, 'Share as image', 'Attach PNG screenshot of the invoice', LucideIcons.image, AppTints.sky),
      (InvoiceShareFormat.link, 'Share link only', 'Send a view link without attaching a file', LucideIcons.link2, AppTints.violet),
    ];
    return Container(
      constraints: const BoxConstraints(maxWidth: 448),
      padding: EdgeInsets.fromLTRB(0, 8, 0, 16 + MediaQuery.of(context).padding.bottom),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(color: AppColors.hairline, borderRadius: BorderRadius.circular(4)),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 8, 0),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Share invoice', style: AppText.heading),
                      Text.rich(
                        TextSpan(
                          text: 'Choose how to share ',
                          children: [TextSpan(text: widget.invoiceNumber, style: const TextStyle(fontWeight: FontWeight.w600))],
                        ),
                        style: AppText.caption,
                      ),
                    ],
                  ),
                ),
                KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.of(context).pop()),
              ],
            ),
          ),
          const SizedBox(height: 8),
          for (final (format, label, description, icon, tint) in options)
            Opacity(
              opacity: _loading != null && _loading != format ? 0.5 : 1,
              child: InkWell(
                onTap: _loading != null ? null : () => _handle(format),
                highlightColor: AppColors.sunken,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  child: Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(color: tint.$1, borderRadius: BorderRadius.circular(14)),
                        child: Icon(icon, size: 20, color: tint.$2),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(label, style: AppText.bodyStrong),
                            Text(description, style: AppText.caption.copyWith(fontSize: 12)),
                          ],
                        ),
                      ),
                      if (_loading == format)
                        const KSpinner(size: 20, padding: EdgeInsets.zero)
                      else
                        const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
