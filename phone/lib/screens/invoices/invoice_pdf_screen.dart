import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:printing/printing.dart';

import '../../api.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'invoice_share.dart';

/// "View invoice": the server-rendered invoice PDF (`/api/invoices/[id]/pdf`) with print and share.
class InvoicePdfScreen extends StatefulWidget {
  const InvoicePdfScreen({super.key, required this.api, required this.invoiceId, required this.invoiceNumber});

  final KhatarioApi api;
  final String invoiceId;
  final String invoiceNumber;

  @override
  State<InvoicePdfScreen> createState() => _InvoicePdfScreenState();
}

class _InvoicePdfScreenState extends State<InvoicePdfScreen> {
  late Future<Uint8List> _pdf = _load();

  Future<Uint8List> _load() => fetchInvoiceFile(widget.api, widget.invoiceId, InvoiceShareFormat.pdf);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: KhatarioColors.background,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(widget.invoiceNumber),
            Expanded(
              child: FutureBuilder<Uint8List>(
        future: _pdf,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return Center(
              child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2, color: KhatarioColors.primary500)),
            );
          }
          if (snap.hasError) {
            final e = snap.error;
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(e is ApiException ? e.message : 'Could not load the invoice PDF',
                        textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, color: KhatarioColors.inkSecondary)),
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: () => setState(() => _pdf = _load()),
                      child: Text('Try again', style: TextStyle(color: KhatarioColors.primary600)),
                    ),
                  ],
                ),
              ),
            );
          }
          final bytes = snap.data!;
          return PdfPreview(
            build: (_) async => bytes,
            pdfFileName: invoiceFileName(widget.invoiceNumber, 'pdf'),
            canChangePageFormat: false,
            canChangeOrientation: false,
            canDebug: false,
            scrollViewDecoration: const BoxDecoration(color: KhatarioColors.background),
            actionBarTheme: PdfActionBarTheme(backgroundColor: KhatarioColors.primary600, iconColor: Colors.white),
          );
        },
      ),
            ),
          ],
        ),
      ),
    );
  }
}
