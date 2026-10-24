import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';

/// Barcode lines from a purchase (`GET /api/purchases/:id/labels`) and a printable sheet.
Future<void> openPurchaseLabels(BuildContext context, AppSession session, String purchaseId) async {
  await Navigator.of(context).push(MaterialPageRoute<void>(
    builder: (_) => _LabelsScreen(session: session, purchaseId: purchaseId),
  ));
}

class _LabelsScreen extends StatefulWidget {
  const _LabelsScreen({required this.session, required this.purchaseId});
  final AppSession session;
  final String purchaseId;

  @override
  State<_LabelsScreen> createState() => _LabelsScreenState();
}

class _LabelsScreenState extends State<_LabelsScreen> {
  List<Map<String, dynamic>> _lines = const [];
  String _bill = '';
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/purchases/${widget.purchaseId}/labels');
      final lines = body['lines'];
      final purchase = body['purchase'];
      if (!mounted) return;
      setState(() {
        _lines = lines is List ? lines.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];
        _bill = purchase is Map ? purchase['bill_number']?.toString() ?? '' : '';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _print() async {
    final doc = pw.Document();
    doc.addPage(pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      build: (context) => [
        pw.Header(level: 0, child: pw.Text(_bill.isEmpty ? 'Purchase labels' : 'Labels · $_bill')),
        pw.TableHelper.fromTextArray(
          headers: const ['Item', 'Barcode', 'Copies', 'MRP'],
          data: [
            for (final line in _lines)
              [
                line['name']?.toString() ?? '',
                line['barcode']?.toString() ?? '',
                '${line['copies'] ?? line['quantity'] ?? ''}',
                line['mrp']?.toString() ?? '',
              ],
          ],
        ),
      ],
    ));
    await Printing.layoutPdf(onLayout: (_) async => doc.save());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: _loading
          ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 80))
          : ListView(
              padding: const EdgeInsets.only(bottom: 32),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 8, 16, 0),
                  child: Row(children: [
                    KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.pop(context)),
                    const Expanded(child: Text('Print labels')),
                  ]),
                ),
                if (_error != null)
                  KEmptyState(icon: LucideIcons.circleAlert, title: 'Could not load labels', body: _error)
                else if (_lines.isEmpty)
                  const KEmptyState(icon: LucideIcons.barcode, title: 'No label lines on this bill')
                else ...[
                  for (final line in _lines)
                    KListRow(
                      title: line['name']?.toString() ?? 'Item',
                      subtitle: '${line['barcode'] ?? 'No barcode'} · ${line['copies'] ?? line['quantity']} copies',
                    ),
                  Padding(padding: const EdgeInsets.all(16), child: KButton(label: 'Print', onPressed: _print)),
                ],
              ],
            ),
    );
  }
}

Future<void> openPurchaseOrderPdf(AppSession session, String orderId, String number) async {
  final bytes = await session.api.getBytes('/api/documents/purchase_orders/$orderId/pdf');
  await Printing.layoutPdf(name: number.isEmpty ? 'purchase-order.pdf' : '$number.pdf', onLayout: (_) async => Uint8List.fromList(bytes));
}

Future<void> emailPurchaseOrder(BuildContext context, AppSession session, String orderId, String number) async {
  final to = TextEditingController();
  final subject = TextEditingController(text: number.isEmpty ? 'Purchase order' : 'Purchase order $number');
  final body = TextEditingController(text: 'Please find the purchase order attached.');
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Email purchase order'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(controller: to, decoration: const InputDecoration(labelText: 'To')),
          TextField(controller: subject, decoration: const InputDecoration(labelText: 'Subject')),
          TextField(controller: body, decoration: const InputDecoration(labelText: 'Message'), maxLines: 3),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send')),
      ],
    ),
  );
  if (ok != true || !context.mounted) return;
  try {
    await session.api.postJson('/api/documents/purchase_orders/$orderId/email', {
      'to': to.text.trim(),
      'subject': subject.text.trim(),
      'body_text': body.text.trim(),
      'body_html': body.text.trim(),
      'attach_pdf': true,
    });
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Email sent')));
    }
  } on ApiException catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }
  to.dispose();
  subject.dispose();
  body.dispose();
}

Future<void> openPurchaseOrderFiles(BuildContext context, AppSession session, String orderId) {
  return showKSheet<void>(
    context,
    title: 'Attachments',
    scrollable: true,
    builder: (ctx) => _Files(session: session, orderId: orderId),
  );
}

class _Files extends StatefulWidget {
  const _Files({required this.session, required this.orderId});
  final AppSession session;
  final String orderId;

  @override
  State<_Files> createState() => _FilesState();
}

class _FilesState extends State<_Files> {
  List<Map<String, dynamic>> _docs = const [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final businessId = widget.session.businessId;
    try {
      final body = await widget.session.api.getJson('/api/documents?business_id=$businessId&entity_type=purchase_order&entity_id=${widget.orderId}');
      final list = body['documents'];
      if (!mounted) return;
      setState(() => _docs = list is List ? list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const []);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _upload() async {
    final file = await FilePicker.pickFile();
    if (file == null) return;
    final bytes = await file.readAsBytes();
    final form = FormData.fromMap({
      'business_id': widget.session.businessId,
      'entity_type': 'purchase_order',
      'entity_id': widget.orderId,
      'file': MultipartFile.fromBytes(bytes, filename: file.name),
    });
    final res = await widget.session.api.dio.post<dynamic>('/api/documents', data: form);
    final body = res.data is Map ? Map<String, dynamic>.from(res.data as Map) : <String, dynamic>{};
    if ((res.statusCode ?? 500) >= 400) {
      if (mounted) setState(() => _error = body['error']?.toString() ?? 'Upload failed');
      return;
    }
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_error != null) Padding(padding: const EdgeInsets.all(12), child: Text(_error!, style: AppText.caption.copyWith(color: AppColors.negative))),
        for (final doc in _docs) KListRow(title: doc['file_name']?.toString() ?? 'File', subtitle: doc['uploaded_by_name']?.toString()),
        Padding(padding: const EdgeInsets.all(16), child: KButton(label: 'Add file', onPressed: _upload)),
      ],
    );
  }
}

Future<void> openPurchaseOrderComments(BuildContext context, AppSession session, String orderId) {
  return showKSheet<void>(
    context,
    title: 'Comments',
    scrollable: true,
    builder: (ctx) => _Comments(session: session, orderId: orderId),
  );
}

class _Comments extends StatefulWidget {
  const _Comments({required this.session, required this.orderId});
  final AppSession session;
  final String orderId;
  @override
  State<_Comments> createState() => _CommentsState();
}

class _CommentsState extends State<_Comments> {
  final _text = TextEditingController();
  List<Map<String, dynamic>> _rows = const [];
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/purchase-orders/${widget.orderId}/history');
      final list = body['history'];
      if (!mounted) return;
      setState(() => _rows = list is List ? list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const []);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _send() async {
    final text = _text.text.trim();
    if (text.isEmpty) return;
    try {
      await widget.session.api.postJson('/api/purchase-orders/${widget.orderId}/comments', {'comment_text': text});
      _text.clear();
      _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_error != null) Padding(padding: const EdgeInsets.all(12), child: Text(_error!)),
        for (final row in _rows)
          KListRow(title: row['description']?.toString() ?? '', subtitle: row['user_name']?.toString() ?? row['kind']?.toString()),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(children: [
            TextField(controller: _text, decoration: const InputDecoration(labelText: 'Comment')),
            const SizedBox(height: 8),
            KButton(label: 'Add comment', onPressed: _send),
          ]),
        ),
      ],
    );
  }
}

Future<void> respondToStockRequest(BuildContext context, AppSession session, Map<String, dynamic> row) async {
  final qty = TextEditingController(text: row['requested_qty']?.toString() ?? '');
  final notes = TextEditingController();
  var status = 'confirmed';
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setLocal) => AlertDialog(
        title: const Text('Reply to request'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButton<String>(
              isExpanded: true,
              value: status,
              items: const [
                DropdownMenuItem(value: 'confirmed', child: Text('Accept all')),
                DropdownMenuItem(value: 'partial', child: Text('Accept part')),
                DropdownMenuItem(value: 'backorder', child: Text('Back order')),
                DropdownMenuItem(value: 'declined', child: Text('Decline')),
              ],
              onChanged: (v) => setLocal(() => status = v ?? 'confirmed'),
            ),
            TextField(controller: qty, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Quantity')),
            TextField(controller: notes, decoration: const InputDecoration(labelText: 'Note')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send')),
        ],
      ),
    ),
  );
  if (ok != true) return;
  try {
    await session.api.postJson('/api/stock-requests/${row['id']}/respond', {
      'status': status,
      'confirmed_qty': num.tryParse(qty.text) ?? 0,
      'notes': notes.text.trim(),
    });
  } on ApiException catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
  }
  qty.dispose();
  notes.dispose();
}

Future<void> linkStockRequest(BuildContext context, AppSession session, String requestId) async {
  final po = TextEditingController();
  final purchase = TextEditingController();
  final invoice = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Link documents'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(controller: po, decoration: const InputDecoration(labelText: 'Purchase order id')),
          TextField(controller: purchase, decoration: const InputDecoration(labelText: 'Purchase bill id')),
          TextField(controller: invoice, decoration: const InputDecoration(labelText: 'Invoice id')),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Link')),
      ],
    ),
  );
  if (ok != true) return;
  try {
    await session.api.postJson('/api/stock-requests/$requestId/link', {
      if (po.text.trim().isNotEmpty) 'purchase_order_id': po.text.trim(),
      if (purchase.text.trim().isNotEmpty) 'purchase_id': purchase.text.trim(),
      if (invoice.text.trim().isNotEmpty) 'invoice_id': invoice.text.trim(),
    });
  } on ApiException catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
  }
  po.dispose();
  purchase.dispose();
  invoice.dispose();
}
