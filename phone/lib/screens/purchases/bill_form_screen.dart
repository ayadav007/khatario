import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../invoices/invoice_form_logic.dart';

/// A supplier or customer bill whose tax is either calculated by the server
/// (purchases, credit notes, debit notes) or by the same line-GST function the
/// website uses (purchase orders and sales orders, which store the client totals).
enum BillKind { purchase, purchaseOrder, creditNote, debitNote, salesOrder, deliveryChallan }

class BillFormScreen extends StatefulWidget {
  const BillFormScreen({super.key, required this.session, required this.kind, this.purchaseId});

  final AppSession session;
  final BillKind kind;

  /// A saved draft to load. Saving writes a new bill, then deletes this draft.
  final String? purchaseId;

  @override
  State<BillFormScreen> createState() => _BillFormScreenState();
}

class _BillLine {
  Map<String, dynamic>? item;
  final qty = TextEditingController(text: '1');
  final price = TextEditingController();
  final discount = TextEditingController(text: '0');
  double taxRate = 0;

  void dispose() {
    qty.dispose();
    price.dispose();
    discount.dispose();
  }
}

class _BillFormScreenState extends State<BillFormScreen> {
  final _number = TextEditingController();
  final _notes = TextEditingController();
  final _lines = <_BillLine>[_BillLine()];
  DateTime _date = DateTime.now();
  DateTime? _due;
  final _paid = TextEditingController();
  String _docType = 'tax_invoice';
  String _priceMode = 'exclusive';
  final _gstin = TextEditingController();
  final _port = TextEditingController();
  final _place = TextEditingController();
  bool _itc = true;
  bool _reverseCharge = false;
  bool _replacingDraft = false;
  List<Map<String, dynamic>> _parties = const [];
  List<Map<String, dynamic>> _items = const [];
  String? _partyId;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  bool get _supplier => widget.kind == BillKind.purchase || widget.kind == BillKind.purchaseOrder;
  bool get _serverTax =>
      widget.kind == BillKind.purchase || widget.kind == BillKind.creditNote || widget.kind == BillKind.debitNote || widget.kind == BillKind.deliveryChallan;
  bool get _needsNumber => widget.kind == BillKind.purchaseOrder || widget.kind == BillKind.creditNote || widget.kind == BillKind.salesOrder;

  String get _title => switch (widget.kind) {
        BillKind.purchase => widget.purchaseId == null ? 'New purchase' : 'Edit draft',
        BillKind.purchaseOrder => 'New purchase order',
        BillKind.creditNote => 'New credit note',
        BillKind.debitNote => 'New debit note',
        BillKind.salesOrder => 'New sales order',
        BillKind.deliveryChallan => 'New delivery challan',
      };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _number.dispose();
    _notes.dispose();
    _paid.dispose();
    _gstin.dispose();
    _port.dispose();
    _place.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final partyPath = _supplier ? '/api/suppliers' : '/api/customers';
      final parties = await widget.session.api.getData(partyPath);
      final items = await widget.session.api.getData('/api/items');
      if (!mounted) return;
      setState(() {
        _parties = _rows(parties, _supplier ? const ['suppliers'] : const ['customers']);
        _items = _rows(items, const ['items']);
        _loading = false;
      });
      if (widget.purchaseId != null) await _fillDraft(widget.purchaseId!);
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _fillDraft(String id) async {
    final body = await widget.session.api.getJson('/api/purchases/$id');
    final doc = body['purchase'];
    if (doc is! Map || !mounted) return;
    final purchase = Map<String, dynamic>.from(doc);
    if (purchase['status']?.toString() != 'draft') {
      setState(() => _error = 'Only a draft can be edited. This bill is already final.');
      return;
    }
    setState(() {
      _replacingDraft = true;
      _partyId = purchase['supplier_id']?.toString();
      _number.text = purchase['bill_number']?.toString() ?? '';
      _notes.text = purchase['notes']?.toString() ?? '';
      _gstin.text = purchase['supplier_gstin']?.toString() ?? '';
      _port.text = purchase['port_code']?.toString() ?? '';
      _place.text = purchase['place_of_supply_state_code']?.toString() ?? '';
      _docType = purchase['document_type']?.toString() ?? 'tax_invoice';
      _itc = purchase['itc_eligible'] != false;
      _reverseCharge = purchase['is_reverse_charge'] == true;
      final parsed = DateTime.tryParse(purchase['bill_date']?.toString() ?? '');
      if (parsed != null) _date = parsed;
      final due = DateTime.tryParse(purchase['due_date']?.toString() ?? '');
      _due = due;
      for (final line in _lines) {
        line.dispose();
      }
      _lines
        ..clear()
        ..addAll(_linesFrom(purchase['items']));
      if (_lines.isEmpty) _lines.add(_BillLine());
    });
  }

  List<_BillLine> _linesFrom(dynamic raw) {
    if (raw is! List) return [];
    return [
      for (final entry in raw.whereType<Map>())
        () {
          final line = _BillLine();
          final id = entry['item_id']?.toString();
          line.item = _items.cast<Map<String, dynamic>?>().where((row) => row?['id']?.toString() == id).firstOrNull ??
              {'id': id, 'name': entry['item_name'] ?? entry['catalog_item_name'] ?? 'Item'};
          line.qty.text = (entry['quantity'] ?? entry['qty'] ?? '1').toString();
          line.price.text = (entry['unit_price'] ?? '').toString();
          line.discount.text = (entry['discount_percent'] ?? '0').toString();
          line.taxRate = double.tryParse(entry['tax_rate']?.toString() ?? '') ?? 0;
          return line;
        }(),
    ];
  }

  Future<void> _scanBill() async {
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png']);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    setState(() { _saving = true; _error = null; });
    try {
      final form = FormData.fromMap({
        'file': MultipartFile.fromBytes(bytes, filename: file.name),
        'business_id': widget.session.businessId,
      });
      final res = await widget.session.api.dio.post<dynamic>('/api/invoices/extract', data: form);
      final body = res.data is Map ? Map<String, dynamic>.from(res.data as Map) : <String, dynamic>{};
      if ((res.statusCode ?? 500) >= 400) {
        throw ApiException(body['error']?.toString() ?? 'Could not read this bill');
      }
      final data = body['data'] is Map ? Map<String, dynamic>.from(body['data'] as Map) : body;
      final invoice = data['invoice'] is Map ? Map<String, dynamic>.from(data['invoice'] as Map) : data;
      final supplier = data['supplier'] is Map ? Map<String, dynamic>.from(data['supplier'] as Map) : const <String, dynamic>{};
      if (!mounted) return;
      setState(() {
        _number.text = invoice['bill_number']?.toString() ?? _number.text;
        _gstin.text = supplier['gstin']?.toString() ?? invoice['supplier_gstin']?.toString() ?? _gstin.text;
        _place.text = invoice['place_of_supply_state_code']?.toString() ?? _place.text;
        if (invoice['price_mode']?.toString() == 'inclusive') _priceMode = 'inclusive';
        final name = supplier['name']?.toString().toLowerCase() ?? '';
        final gstin = _gstin.text.toLowerCase();
        final match = _parties.cast<Map<String, dynamic>?>().where((p) {
          final g = p?['gstin']?.toString().toLowerCase() ?? '';
          final n = p?['name']?.toString().toLowerCase() ?? '';
          return (gstin.isNotEmpty && g == gstin) || (name.isNotEmpty && n == name);
        }).firstOrNull;
        if (match != null) _partyId = match['id']?.toString();
        final extracted = data['items'];
        if (extracted is List && extracted.isNotEmpty) {
          for (final line in _lines) {
            line.dispose();
          }
          _lines
            ..clear()
            ..addAll([
              for (final entry in extracted.whereType<Map>())
                () {
                  final line = _BillLine();
                  final label = (entry['item_name'] ?? entry['name'] ?? entry['description'] ?? '').toString();
                  line.item = _items.cast<Map<String, dynamic>?>().where((row) => (row?['name']?.toString().toLowerCase() ?? '') == label.toLowerCase()).firstOrNull;
                  line.qty.text = (entry['quantity'] ?? entry['qty'] ?? '1').toString();
                  line.price.text = (entry['unit_price'] ?? entry['rate'] ?? '').toString();
                  line.discount.text = (entry['discount_percent'] ?? '0').toString();
                  line.taxRate = double.tryParse(entry['tax_rate']?.toString() ?? '') ?? 0;
                  return line;
                }(),
            ]);
        }
        _error = 'Bill read. Check the supplier and each item before saving.';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not read this bill.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _save() async {
    if (_partyId == null) {
      setState(() => _error = _supplier ? 'Choose a supplier.' : 'Choose a customer.');
      return;
    }
    if (_needsNumber && _number.text.trim().isEmpty) {
      setState(() => _error = 'Enter a number.');
      return;
    }
    final party = _parties.cast<Map<String, dynamic>?>().firstWhere((row) => row?['id']?.toString() == _partyId, orElse: () => null);
    final businessCode = widget.session.business['state_code']?.toString();
    final intra = invoiceIntraState(
      invoicePlaceOfSupply(gstin: party?['gstin']?.toString(), customerState: party?['state']?.toString(), customerStateCode: party?['state_code']?.toString()),
      businessCode,
    );
    final items = <Map<String, dynamic>>[];
    var subtotal = 0.0;
    var taxTotal = 0.0;
    var grand = 0.0;
    for (final line in _lines) {
      final item = line.item;
      final qty = double.tryParse(line.qty.text) ?? 0;
      final price = double.tryParse(line.price.text) ?? 0;
      if (item == null || qty <= 0) {
        setState(() => _error = 'Each line needs an item and a quantity.');
        return;
      }
      final gst = computeLineGst(quantity: qty, unitPrice: price, taxRate: line.taxRate, intraState: intra);
      subtotal += gst.taxable;
      taxTotal += gst.tax;
      grand += gst.total;
      final row = <String, dynamic>{
        'item_id': item['id'],
        'item_name': item['name'],
        'hsn_sac': item['hsn_sac'],
        'quantity': qty,
        'qty': qty,
        'unit': item['unit'] ?? 'PCS',
        'unit_price': price,
        'tax_rate': line.taxRate,
        'discount_percent': double.tryParse(line.discount.text) ?? 0,
      };
      if (!_serverTax) {
        row.addAll({
          'discount_amount': gst.discount,
          'taxable_value': gst.taxable,
          'tax_amount': gst.tax,
          'cgst_amount': gst.cgst,
          'sgst_amount': gst.sgst,
          'igst_amount': gst.igst,
          'line_total': gst.total,
        });
      }
      items.add(row);
    }
    final date = '${_date.year.toString().padLeft(4, '0')}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';
    final businessId = widget.session.businessId;
    final userId = widget.session.user['id']?.toString();
    final body = switch (widget.kind) {
      BillKind.purchase => {
          'supplier_id': _partyId,
          'bill_number': _number.text.trim().isEmpty ? null : _number.text.trim(),
          'bill_date': date,
          'due_date': _due == null ? null : '${_due!.year.toString().padLeft(4, '0')}-${_due!.month.toString().padLeft(2, '0')}-${_due!.day.toString().padLeft(2, '0')}',
          'status': 'final',
          'paid_amount': num.tryParse(_paid.text) ?? 0,
          'document_type': _docType,
          'price_mode': _priceMode,
          'supplier_gstin': _gstin.text.trim(),
          'port_code': _port.text.trim(),
          'place_of_supply_state_code': _place.text.trim(),
          'itc_eligible': _itc,
          'is_reverse_charge': _reverseCharge,
          'notes': _notes.text.trim(),
          'branch_id': widget.session.defaultBranchId,
          'items': items,
        },
      BillKind.purchaseOrder => {
          'business_id': businessId,
          'supplier_id': _partyId,
          'order_number': _number.text.trim(),
          'order_date': date,
          'status': 'draft',
          'subtotal': invoiceRound2(subtotal),
          'tax_total': invoiceRound2(taxTotal),
          'grand_total': invoiceRound2(grand),
          'notes': _notes.text.trim(),
          'items': items,
        },
      BillKind.creditNote => {
          'customer_id': _partyId,
          'credit_note_number': _number.text.trim(),
          'credit_note_date': date,
          'branch_id': widget.session.defaultBranchId,
          'notes': _notes.text.trim(),
          'items': items,
        },
      BillKind.debitNote => {
          'customer_id': _partyId,
          'debit_note_number': _number.text.trim().isEmpty ? null : _number.text.trim(),
          'debit_note_date': date,
          'branch_id': widget.session.defaultBranchId,
          'notes': _notes.text.trim(),
          'items': items,
        },
      BillKind.salesOrder => {
          'business_id': businessId,
          'created_by': userId,
          'customer_id': _partyId,
          'order_number': _number.text.trim(),
          'order_date': date,
          'branch_id': widget.session.defaultBranchId,
          'status': 'draft',
          'subtotal': invoiceRound2(subtotal),
          'tax_total': invoiceRound2(taxTotal),
          'grand_total': invoiceRound2(grand),
          'notes': _notes.text.trim(),
          'items': items,
        },
      BillKind.deliveryChallan => {
          'customer_id': _partyId,
          'challan_date': date,
          'challan_number': _number.text.trim().isEmpty ? null : _number.text.trim(),
          'auto_number': _number.text.trim().isEmpty,
          'branch_id': widget.session.defaultBranchId,
          'notes': _notes.text.trim(),
          'items': items,
        },
    };
    setState(() { _saving = true; _error = null; });
    try {
      final path = switch (widget.kind) {
        BillKind.purchase => '/api/purchases',
        BillKind.purchaseOrder => '/api/purchase-orders',
        BillKind.creditNote => '/api/credit-notes',
        BillKind.debitNote => '/api/debit-notes',
        BillKind.salesOrder => '/api/sales-orders',
        BillKind.deliveryChallan => '/api/delivery-challans',
      };
      await widget.session.api.postJson(path, body);
      if (_replacingDraft && widget.purchaseId != null) {
        await widget.session.api.deleteJson('/api/purchases/${widget.purchaseId}');
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String? get _partyName => _parties.cast<Map<String, dynamic>?>().where((row) => row?['id']?.toString() == _partyId).firstOrNull?['name']?.toString();

  void _pickParty() {
    showKPicker<String>(
      context,
      title: _supplier ? 'Supplier' : 'Customer',
      value: _partyId ?? '',
      options: [for (final party in _parties) (party['id'].toString(), party['name']?.toString() ?? 'Party')],
      onChanged: (id) => setState(() => _partyId = id),
    );
  }

  void _pickItem(int index) {
    final line = _lines[index];
    showKPicker<String>(
      context,
      title: 'Item',
      value: line.item?['id']?.toString() ?? '',
      options: [for (final item in _items) (item['id'].toString(), item['name']?.toString() ?? 'Item')],
      onChanged: (id) {
        final item = _items.cast<Map<String, dynamic>?>().where((row) => row?['id']?.toString() == id).firstOrNull;
        setState(() {
          line.item = item;
          final price = _supplier ? (item?['purchase_price'] ?? item?['selling_price']) : (item?['selling_price'] ?? item?['price']);
          line.price.text = price == null ? '' : price.toString();
          line.taxRate = double.tryParse(item?['tax_rate']?.toString() ?? '') ?? 0;
        });
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: KSpinner(padding: EdgeInsets.symmetric(vertical: 64)));
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 8, AppSpace.gutter, 0),
            child: Row(children: [
              KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).maybePop()),
              Expanded(child: Text(_title, style: AppText.heading.copyWith(fontSize: 22))),
              if (widget.kind == BillKind.purchase)
                KTextButton(label: 'Scan bill', onTap: _saving ? () {} : _scanBill),
            ]),
          ),
          KListRow(
            onTap: _pickParty,
            leading: KAvatar(name: _partyName ?? ''),
            title: _supplier ? 'Supplier' : 'Customer',
            subtitle: _partyName ?? 'Choose',
            trailing: const Icon(LucideIcons.chevronRight, size: 18),
          ),
          ListTile(
            title: const Text('Date'),
            subtitle: Text(ddMMMyyyy(_date)),
            trailing: const Icon(LucideIcons.calendar, size: 18),
            onTap: () async {
              final picked = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2000), lastDate: DateTime(2100));
              if (picked != null) setState(() => _date = picked);
            },
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: TextField(controller: _number, decoration: InputDecoration(labelText: _needsNumber ? 'Number' : 'Bill number (optional)')),
          ),
          if (widget.kind == BillKind.purchase) ...[
            ListTile(
              title: const Text('Due date'),
              subtitle: Text(_due == null ? 'None' : ddMMMyyyy(_due!)),
              onTap: () async {
                final picked = await showDatePicker(context: context, initialDate: _due ?? _date, firstDate: DateTime(2000), lastDate: DateTime(2100));
                if (picked != null) setState(() => _due = picked);
              },
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: TextField(controller: _paid, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount paid now')),
            ),
            KListRow(
              onTap: () => showKPicker<String>(
                context,
                title: 'Document',
                value: _docType,
                options: const [('tax_invoice', 'Tax invoice'), ('bill_of_supply', 'Bill of supply'), ('bill_of_entry', 'Bill of entry'), ('import_service', 'Import of services')],
                onChanged: (v) => setState(() => _docType = v),
              ),
              title: 'Document',
              subtitle: _docType.replaceAll('_', ' '),
            ),
            KListRow(
              onTap: () => showKPicker<String>(
                context,
                title: 'Prices',
                value: _priceMode,
                options: const [('exclusive', 'GST extra'), ('inclusive', 'GST included')],
                onChanged: (v) => setState(() => _priceMode = v),
              ),
              title: 'Prices',
              subtitle: _priceMode == 'inclusive' ? 'GST included' : 'GST extra',
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: TextField(controller: _gstin, decoration: const InputDecoration(labelText: 'Supplier GSTIN')),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: TextField(controller: _place, decoration: const InputDecoration(labelText: 'Place of supply (state code)')),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: TextField(controller: _port, decoration: const InputDecoration(labelText: 'Port code')),
            ),
            SwitchListTile(title: const Text('GST credit (ITC) allowed'), value: _itc, onChanged: (v) => setState(() => _itc = v)),
            SwitchListTile(title: const Text('Reverse charge'), value: _reverseCharge, onChanged: (v) => setState(() => _reverseCharge = v)),
          ],
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xl, AppSpace.gutter, AppSpace.sm),
            child: Text('ITEMS', style: AppText.overline),
          ),
          for (var i = 0; i < _lines.length; i++) _lineCard(i),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: KButton.secondary(label: 'Add item', onPressed: _saving ? null : () => setState(() => _lines.add(_BillLine()))),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
            child: TextField(controller: _notes, decoration: const InputDecoration(labelText: 'Notes'), maxLines: 2),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!, style: AppText.body.copyWith(color: AppColors.negative))),
          Padding(padding: const EdgeInsets.all(16), child: KButton(label: _saving ? 'Saving…' : 'Save', onPressed: _saving ? null : _save)),
        ],
      ),
    );
  }

  Widget _lineCard(int index) {
    final line = _lines[index];
    final gst = const [0.0, 5.0, 12.0, 18.0, 28.0].contains(line.taxRate) ? line.taxRate : 0.0;
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, 12),
      child: KCard(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              KListRow(
                onTap: () => _pickItem(index),
                title: line.item?['name']?.toString() ?? 'Item ${index + 1}',
                subtitle: 'Choose from your catalogue',
                trailing: const Icon(LucideIcons.chevronRight, size: 18),
              ),
              TextField(controller: line.qty, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Quantity')),
              TextField(controller: line.price, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Unit price')),
              TextField(controller: line.discount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Discount %')),
              KListRow(
                onTap: () => showKPicker<double>(
                  context,
                  title: 'GST',
                  value: gst,
                  options: const [(0.0, '0%'), (5.0, '5%'), (12.0, '12%'), (18.0, '18%'), (28.0, '28%')],
                  onChanged: (value) => setState(() => line.taxRate = value),
                ),
                title: 'GST',
                subtitle: '${gst.toStringAsFixed(0)}%',
                trailing: const Icon(LucideIcons.chevronRight, size: 18),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

List<Map<String, dynamic>> _rows(dynamic body, List<String> keys) {
  if (body is List) return body.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
  if (body is! Map) return const [];
  for (final key in keys) {
    final value = body[key];
    if (value is List) return value.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
  }
  for (final value in body.values) {
    if (value is List && value.whereType<Map>().isNotEmpty) {
      return value.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
    }
  }
  return const [];
}
