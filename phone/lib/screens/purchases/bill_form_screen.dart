import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../invoices/invoice_form_logic.dart';
import '../parties/customer_form_logic.dart';
import 'bill_camera.dart';
import 'bill_scan_flow.dart';
import 'bill_scan_logic.dart';

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
  final discountAmount = TextEditingController(text: '0');
  final cess = TextEditingController();
  final batch = TextEditingController();
  final manufactured = TextEditingController();
  final expiry = TextEditingController();
  final serials = TextEditingController();
  double taxRate = 0;
  bool capitalGoods = false;

  /// From a scanned bill: the line as printed. A line with a name and no item still saves;
  /// the server links it to the catalogue, or adds it there when the bill is finalized.
  String name = '';
  String hsn = '';
  String unit = '';
  String? taxMode;
  double? inclusiveTotal;
  bool discountOnTaxInclusive = false;

  String get label => item?['name']?.toString() ?? (name.isEmpty ? 'Item' : name);

  void dispose() {
    qty.dispose();
    price.dispose();
    discount.dispose();
    discountAmount.dispose();
    cess.dispose();
    batch.dispose();
    manufactured.dispose();
    expiry.dispose();
    serials.dispose();
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
  bool _roundOff = false;
  bool _breakupOpen = false;
  bool _moreOpen = false;
  List<Map<String, dynamic>> _parties = const [];
  List<Map<String, dynamic>> _items = const [];
  List<Map<String, dynamic>> _warehouses = const [];
  String? _partyId;
  String? _warehouseId;
  String _supplierStateCode = '';
  bool _loading = true;
  bool _saving = false;
  String? _error;
  String? _scanJobId;
  Map<String, dynamic>? _scanReview;
  String _scannedSupplierName = '';
  bool _scanGstinMissing = false;
  double? _scanRoundOff;

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
      List<Map<String, dynamic>> warehouses = const [];
      if (widget.kind == BillKind.purchase) {
        try {
          final body = await widget.session.api.getJson('/api/warehouses');
          warehouses = _rows(body, const ['warehouses']);
        } catch (_) {}
      }
      if (!mounted) return;
      setState(() {
        _parties = _rows(parties, _supplier ? const ['suppliers'] : const ['customers']);
        _items = _rows(items, const ['items']);
        _warehouses = warehouses;
        final primary = warehouses.cast<Map<String, dynamic>?>().where((row) => row?['is_primary'] == true).firstOrNull;
        _warehouseId ??= primary?['id']?.toString() ?? warehouses.firstOrNull?['id']?.toString();
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
      _supplierStateCode = purchase['supplier_state_code']?.toString() ?? '';
      _port.text = purchase['port_code']?.toString() ?? '';
      _place.text = purchase['place_of_supply_state_code']?.toString() ?? '';
      _docType = purchase['document_type']?.toString() ?? 'tax_invoice';
      _itc = purchase['itc_eligible'] != false;
      _reverseCharge = purchase['is_reverse_charge'] == true;
      _priceMode = purchase['price_mode']?.toString() == 'inclusive' ? 'inclusive' : 'exclusive';
      _roundOff = (num.tryParse(purchase['round_off']?.toString() ?? '') ?? 0) != 0;
      _paid.text = purchase['paid_amount']?.toString() ?? '';
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
          line.discountAmount.text = (entry['discount_amount'] ?? '0').toString();
          line.cess.text = (entry['cess_amount'] ?? '').toString();
          line.batch.text = entry['batch_number']?.toString() ?? '';
          line.manufactured.text = entry['manufacturing_date']?.toString() ?? '';
          line.expiry.text = entry['expiry_date']?.toString() ?? '';
          final serials = entry['serial_numbers'];
          line.serials.text = serials is List ? serials.map((s) => s.toString()).join(', ') : (serials?.toString() ?? '');
          line.capitalGoods = entry['itc_type']?.toString() == 'capital_goods';
          line.taxRate = double.tryParse(entry['tax_rate']?.toString() ?? '') ?? 0;
          final location = entry['location_id']?.toString();
          if (location != null && location.isNotEmpty) _warehouseId = location;
          return line;
        }(),
    ];
  }

  Future<void> _scanBill() async {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => BillScanFlow(read: _readBill)));
  }

  /// Reads the bill into the form for the scan flow: the number of items, or null on failure.
  Future<int?> _readBill(BillCapture capture) async {
    final bytes = capture.bytes;
    setState(() { _saving = true; _error = null; });
    try {
      final form = FormData.fromMap({
        'file': MultipartFile.fromBytes(bytes, filename: capture.name),
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
      final totals = data['totals'] is Map ? Map<String, dynamic>.from(data['totals'] as Map) : const <String, dynamic>{};
      final supplierName = supplier['name']?.toString().trim() ?? '';
      final extGstin = (supplier['gstin'] ?? invoice['supplier_gstin'] ?? '').toString().trim().toUpperCase();
      final match = autoLinkSupplier(_parties, name: supplierName, gstin: extGstin) ?? await _supplierAlias(supplierName, extGstin);
      if (!mounted) return null;
      setState(() {
        _scanJobId = body['job_id']?.toString();
        _scanReview = data;
        _scanGstinMissing = extGstin.isEmpty;
        _scannedSupplierName = match == null ? supplierName : '';
        _number.text = invoice['bill_number']?.toString() ?? _number.text;
        final billDate = DateTime.tryParse(invoice['bill_date']?.toString() ?? '');
        if (billDate != null) _date = billDate;
        final docType = invoice['document_type']?.toString() ?? '';
        if (docType.isNotEmpty) _docType = docType;
        if (invoice['is_reverse_charge'] == true) _reverseCharge = true;
        final mode = invoice['price_mode']?.toString();
        if (mode == 'inclusive' || mode == 'exclusive') _priceMode = mode!;
        final roundOff = totals['round_off'];
        if (roundOff is num) {
          _scanRoundOff = invoiceRound2(roundOff.toDouble());
          _roundOff = _scanRoundOff != 0;
        }
        if (match != null) {
          _applySupplier(match);
        } else if (extGstin.isNotEmpty) {
          _gstin.text = extGstin;
          _supplierStateCode = invoicePlaceOfSupply(gstin: extGstin) ?? _supplierStateCode;
        }
        _place.text = scannedPlaceOfSupply(invoice, gstin: _gstin.text, stateCodeOf: stateCode) ?? _place.text;
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
                  final scan = scannedLine(entry);
                  final line = _BillLine()
                    ..name = scan.name
                    ..hsn = scan.hsn
                    ..unit = scan.unit
                    ..taxRate = scan.taxRate
                    ..taxMode = scan.taxMode
                    ..inclusiveTotal = scan.inclusiveTotal
                    ..discountOnTaxInclusive = scan.discountOnTaxInclusive
                    ..item = matchScannedItem(_items, name: scan.name, hsn: scan.hsn);
                  line.qty.text = _plain(scan.quantity);
                  line.price.text = _plain(scan.unitPrice);
                  line.discount.text = _plain(scan.discountPercent);
                  line.discountAmount.text = _plain(scan.discountAmount);
                  return line;
                }(),
            ]);
        }
        _error = 'Bill read. Check the supplier and each item before saving.';
      });
      final items = data['items'];
      return items is List ? items.length : 0;
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not read this bill.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
    return null;
  }

  static String _plain(double value) => value == value.roundToDouble() ? value.toStringAsFixed(0) : value.toString();

  /// The supplier name aliases the website learns (`/api/suppliers/match`).
  Future<Map<String, dynamic>?> _supplierAlias(String name, String gstin) async {
    if (name.isEmpty && gstin.isEmpty) return null;
    try {
      final body = await widget.session.api.postJson('/api/suppliers/match', {
        'name': name,
        if (gstin.isNotEmpty) 'gstin': gstin,
      });
      final match = body['match'];
      if (match is! Map) return null;
      final id = match['supplier_id']?.toString();
      return _parties.cast<Map<String, dynamic>?>().where((p) => p?['id']?.toString() == id).firstOrNull;
    } catch (_) {
      return null;
    }
  }

  /// "Create supplier" under a new party from the bill, filled from the scan.
  Future<void> _createScannedSupplier() async {
    final name = _scannedSupplierName.trim();
    if (name.isEmpty) return;
    final gstin = _gstin.text.trim().toUpperCase();
    final validGstin = gstin.isNotEmpty && isValidGstin(gstin);
    final code = validGstin ? gstin.substring(0, 2) : '';
    setState(() { _saving = true; _error = null; });
    try {
      final body = await widget.session.api.postJson('/api/suppliers', {
        'name': name,
        'gstin': validGstin ? gstin : null,
        if (code.isNotEmpty) 'state': gstStateName(code),
        if (code.isNotEmpty) 'state_code': code,
        'opening_balance': 0,
        'opening_balance_type': 'credit',
      });
      final created = body['supplier'];
      if (created is Map && mounted) {
        final party = Map<String, dynamic>.from(created);
        setState(() {
          if (!_parties.any((p) => p['id']?.toString() == party['id']?.toString())) _parties = [..._parties, party];
          _scannedSupplierName = '';
        });
        _applySupplier(party);
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  List<_BillLine> get _unlinkedLines => _lines.where((line) => line.item == null && line.name.trim().isNotEmpty).toList();

  /// Website "Match automatically": links bill lines to close item names, keeping the bill's qty, rate and tax.
  void _matchUnlinked() {
    var linked = 0;
    final unlinked = _unlinkedLines;
    setState(() {
      for (final line in unlinked) {
        final best = closeCatalogueMatch(_items, line.name);
        if (best == null) continue;
        line.item = best;
        line.name = best['name']?.toString() ?? line.name;
        if (line.hsn.isEmpty) line.hsn = best['hsn_sac']?.toString() ?? '';
        linked++;
      }
    });
    _snack(linked == 0
        ? 'No close matches in your items. Link the items one by one, or add them.'
        : 'Linked $linked of ${unlinked.length} items. Check the names before saving.');
  }

  /// Website "Add all to catalogue".
  Future<void> _addUnlinkedToItems() async {
    final unlinked = _unlinkedLines;
    setState(() => _saving = true);
    var added = 0, failed = 0;
    for (final line in unlinked) {
      try {
        final body = await widget.session.api.postJson('/api/items', {
          'name': line.name.trim(),
          'hsn_sac': line.hsn,
          'unit': line.unit,
          'tax_rate': line.taxRate,
          'purchase_price': double.tryParse(line.price.text) ?? 0,
          'item_type': 'goods',
          'is_active': true,
        });
        if (body['item'] is Map) {
          final item = Map<String, dynamic>.from(body['item'] as Map);
          _items = [..._items, item];
          line.item = item;
          added++;
        } else {
          failed++;
        }
      } on ApiException catch (_) {
        failed++;
      }
    }
    if (!mounted) return;
    setState(() => _saving = false);
    _snack(failed > 0 ? 'Added $added items; $failed could not be added.' : 'Added $added items to your list.');
  }

  void _snack(String message) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  /// The website's `buildReviewSnapshotFromPurchaseForm`, compared with the scan to learn corrections.
  Map<String, dynamic> _reviewAfter(List<Map<String, dynamic>> rows, ({double taxable, double tax, double cgst, double sgst, double igst, double discount, double cess, double roundOff, double grand, bool intraState}) preview) {
    final party = _parties.cast<Map<String, dynamic>?>().where((row) => row?['id']?.toString() == _partyId).firstOrNull;
    final extra = _scanReview?['supplier'] is Map ? Map<String, dynamic>.from(_scanReview!['supplier'] as Map) : <String, dynamic>{};
    final gstin = (party?['gstin']?.toString() ?? _gstin.text).trim().toUpperCase();
    final place = _placeCode() ?? '';
    final placeName = place.isEmpty ? '' : gstStateName(place);
    final date = _iso(_date);
    final number = _number.text.trim();
    return {
      'supplier': {
        ...extra,
        'name': party?['name']?.toString() ?? '',
        'gstin': gstin.isEmpty ? null : gstin,
        'state_code': _supplierCode() ?? extra['state_code'],
        'phone': party?['phone'] ?? extra['phone'],
        'email': party?['email'] ?? extra['email'],
        'address': party?['address'] ?? extra['address'],
      },
      'invoice': {
        'bill_number': number.isEmpty ? null : number,
        'bill_date': date,
        'document_type': _docType,
        'invoice_number': number.isEmpty ? null : number,
        'invoice_date': date,
        'due_date': null,
        'place_of_supply': placeName.isEmpty ? place : placeName,
        'place_of_supply_state_code': place.isEmpty ? null : place,
        'reverse_charge': _reverseCharge,
      },
      'items': [
        for (final row in rows)
          {
            'item_name': row['item_name'],
            'quantity': row['quantity'],
            'unit_price': row['unit_price'],
            'amount': row['invoice_inclusive_line_total'] ?? row['line_total'],
            'tax_rate': row['tax_rate'],
            'hsn_sac': row['hsn_sac'],
            'discount_percent': row['discount_percent'],
            'discount_amount': row['discount_amount'],
            'discount_on_tax_inclusive': row['discount_on_tax_inclusive'] == true,
          },
      ],
      'totals': {
        'subtotal': invoiceRound2(preview.taxable),
        'tax_amount': invoiceRound2(preview.tax),
        'grand_total': preview.grand,
        'cgst_total': invoiceRound2(preview.cgst),
        'sgst_total': invoiceRound2(preview.sgst),
        'igst_total': invoiceRound2(preview.igst),
        'round_off': preview.roundOff,
      },
    };
  }

  /// Website `extraction learning` ping after a scanned bill saves.
  void _sendScanLearning(Map<String, dynamic> after, String? purchaseId) {
    final jobId = _scanJobId;
    final before = _scanReview;
    if (jobId == null || jobId.isEmpty || before == null) return;
    _scanJobId = null;
    widget.session.api.postJson('/api/invoices/extract/learning', {
      'job_id': jobId,
      'source': 'purchase_form_save',
      'correction_summary': correctionSummary(before, after),
      'review_before': before,
      'review_after': after,
      'invoice_id': ?purchaseId,
    }).catchError((_) => <String, dynamic>{});
  }

  Future<void> _save({String purchaseStatus = 'final'}) async {
    if (_partyId == null) {
      setState(() => _error = _supplier ? 'Choose a supplier.' : 'Choose a customer.');
      return;
    }
    if (_needsNumber && _number.text.trim().isEmpty) {
      setState(() => _error = 'Enter a number.');
      return;
    }
    final party = _parties.cast<Map<String, dynamic>?>().firstWhere((row) => row?['id']?.toString() == _partyId, orElse: () => null);
    final intra = widget.kind == BillKind.purchase
        ? _purchasePreview().intraState
        : invoiceIntraState(
            invoicePlaceOfSupply(gstin: party?['gstin']?.toString(), customerState: party?['state']?.toString(), customerStateCode: party?['state_code']?.toString()),
            widget.session.business['state_code']?.toString(),
          );
    final includeGst = widget.kind == BillKind.purchase && _priceMode == 'inclusive';
    final items = <Map<String, dynamic>>[];
    final lineTotals = <double>[];
    var subtotal = 0.0;
    var taxTotal = 0.0;
    var grand = 0.0;
    for (final line in _lines) {
      final item = line.item;
      final qty = double.tryParse(line.qty.text) ?? 0;
      final price = double.tryParse(line.price.text) ?? 0;
      final scannedOnly = widget.kind == BillKind.purchase && item == null && line.name.trim().isNotEmpty;
      if ((item == null && !scannedOnly) || qty <= 0) {
        final blank = item == null && line.price.text.trim().isEmpty;
        if (widget.kind == BillKind.purchase && blank) continue;
        setState(() => _error = item == null ? 'Match every line to an item in your list.' : 'Each line needs an item and a quantity.');
        return;
      }
      final gst = computeLineGst(
        quantity: qty,
        unitPrice: price,
        discountPercent: widget.kind == BillKind.purchase ? (double.tryParse(line.discount.text) ?? 0) : 0,
        taxRate: line.taxRate,
        intraState: intra,
        pricesIncludeGst: includeGst,
      );
      subtotal += gst.taxable;
      taxTotal += gst.tax;
      grand += gst.total;
      final discountAmount = double.tryParse(line.discountAmount.text) ?? 0;
      final row = <String, dynamic>{
        'item_id': item?['id'],
        'item_name': line.name.trim().isNotEmpty ? line.name.trim() : item?['name'],
        'hsn_sac': line.hsn.isNotEmpty ? line.hsn : item?['hsn_sac'],
        'quantity': qty,
        'qty': qty,
        'unit': line.unit.isNotEmpty ? line.unit : (item?['unit'] ?? 'PCS'),
        'unit_price': price,
        'tax_rate': line.taxRate,
        'discount_percent': widget.kind == BillKind.purchase && discountAmount > 0 ? 0 : (double.tryParse(line.discount.text) ?? 0),
        if (widget.kind == BillKind.purchase) ...{
          'discount_amount': discountAmount,
          'tax_mode': line.taxMode ?? _priceMode,
          'discount_on_tax_inclusive': line.discountOnTaxInclusive,
          if (line.inclusiveTotal != null) 'invoice_inclusive_line_total': line.inclusiveTotal,
          'cess_amount': double.tryParse(line.cess.text) ?? 0,
          if (line.capitalGoods) 'itc_type': 'capital_goods',
          if (line.batch.text.trim().isNotEmpty) 'batch_number': line.batch.text.trim(),
          if (line.manufactured.text.trim().isNotEmpty) 'manufacturing_date': line.manufactured.text.trim(),
          if (line.expiry.text.trim().isNotEmpty) 'expiry_date': line.expiry.text.trim(),
          if (line.serials.text.trim().isNotEmpty)
            'serial_numbers': line.serials.text.split(RegExp(r'[,\n]')).map((s) => s.trim()).where((s) => s.isNotEmpty).toList(),
        },
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
      lineTotals.add(widget.kind == BillKind.purchase ? _purchaseLineGst(line, intra).total : gst.total);
    }
    if (items.isEmpty) {
      setState(() => _error = 'Add at least one item.');
      return;
    }
    if (widget.kind == BillKind.purchase && purchaseStatus == 'final' && _warehouses.isNotEmpty && _warehouseId == null) {
      setState(() => _error = 'Pick a receiving warehouse before finalizing. Stock is tracked per warehouse.');
      return;
    }
    final date = '${_date.year.toString().padLeft(4, '0')}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';
    final businessId = widget.session.businessId;
    final userId = widget.session.user['id']?.toString();
    final body = switch (widget.kind) {
      BillKind.purchase => {
          'supplier_id': _partyId,
          'bill_number': _number.text.trim().isEmpty ? null : _number.text.trim(),
          'bill_date': date,
          'due_date': _due == null ? null : _iso(_due!),
          'status': purchaseStatus,
          'paid_amount': num.tryParse(_paid.text) ?? 0,
          'document_type': _docType,
          'price_mode': _priceMode,
          'supplier_gstin': _gstin.text.trim(),
          'supplier_state_code': _supplierCode(),
          'port_code': _docType == 'bill_of_entry' ? _port.text.trim() : '',
          'place_of_supply_state_code': _placeCode(),
          'itc_eligible': _itc,
          'is_reverse_charge': _reverseCharge,
          'round_off': _purchasePreview().roundOff,
          'notes': _notes.text.trim(),
          'branch_id': widget.session.defaultBranchId,
          'items': [
            for (final row in items)
              {
                ...row,
                if (_warehouseId != null) 'location_id': _warehouseId,
              },
          ],
          if (_scanJobId != null) 'extraction_job_id': _scanJobId,
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
      final saved = await widget.session.api.postJson(path, body);
      if (widget.kind == BillKind.purchase && _scanJobId != null) {
        final preview = _purchasePreview();
        final rows = [
          for (var i = 0; i < items.length; i++) {...items[i], 'line_total': invoiceRound2(lineTotals[i])},
        ];
        final purchase = saved['purchase'];
        _sendScanLearning(_reviewAfter(rows, preview), purchase is Map ? purchase['id']?.toString() : null);
      }
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

  String _iso(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

  String? _supplierCode() {
    if (_supplierStateCode.trim().isNotEmpty) return _supplierStateCode.trim();
    final party = _parties.cast<Map<String, dynamic>?>().where((row) => row?['id']?.toString() == _partyId).firstOrNull;
    return invoicePlaceOfSupply(
      gstin: _gstin.text.isNotEmpty ? _gstin.text : party?['gstin']?.toString(),
      customerState: party?['state']?.toString(),
      customerStateCode: party?['state_code']?.toString(),
    );
  }

  String? _placeCode() {
    if (_place.text.trim().isNotEmpty) return _place.text.trim();
    return _businessStateCode();
  }

  String? _businessStateCode() {
    final code = widget.session.business['state_code']?.toString().trim() ?? '';
    if (code.isNotEmpty) return code.padLeft(2, '0');
    final named = stateCode(widget.session.business['state']?.toString() ?? '');
    return named.isEmpty ? null : named;
  }

  ({double taxable, double tax, double cgst, double sgst, double igst, double discount, double cess, double roundOff, double grand, bool intraState}) _purchasePreview() {
    final intra = invoiceIntraState(_businessStateCode(), _supplierCode());
    var taxable = 0.0, tax = 0.0, cgst = 0.0, sgst = 0.0, igst = 0.0, discount = 0.0, cess = 0.0, grand = 0.0;
    for (final line in _lines) {
      if (line.item == null && line.name.trim().isEmpty) continue;
      final gst = _purchaseLineGst(line, intra);
      taxable += gst.taxable;
      tax += gst.tax;
      cgst += gst.cgst;
      sgst += gst.sgst;
      igst += gst.igst;
      discount += gst.discount;
      cess += double.tryParse(line.cess.text) ?? 0;
      grand += gst.total;
    }
    grand += cess;
    // A scanned bill keeps its printed round off, as on the website.
    final roundOff = !_roundOff ? 0.0 : (_scanRoundOff ?? invoiceRound2(grand.roundToDouble() - grand));
    return (taxable: taxable, tax: tax, cgst: cgst, sgst: sgst, igst: igst, discount: discount, cess: cess, roundOff: roundOff, grand: invoiceRound2(grand + roundOff), intraState: intra);
  }

  LineGst _purchaseLineGst(_BillLine line, bool intra) {
    final qty = double.tryParse(line.qty.text) ?? 0;
    final price = double.tryParse(line.price.text) ?? 0;
    final amount = double.tryParse(line.discountAmount.text) ?? 0;
    final gross = qty * price;
    final percent = amount > 0 && gross > 0 ? (amount / gross) * 100 : (double.tryParse(line.discount.text) ?? 0);
    return computeLineGst(
      quantity: qty,
      unitPrice: price,
      discountPercent: percent,
      taxRate: line.taxRate,
      intraState: intra,
      pricesIncludeGst: (line.taxMode ?? _priceMode) == 'inclusive',
    );
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

  List<_BillLine> get _purchaseLines => _lines.where((line) => line.item != null || line.name.trim().isNotEmpty).toList();

  String get _dueSummary => _due == null ? 'No due date' : 'Due ${ddMMMyyyy(_due!)}';

  String _money(num value) => inr(value, maxFraction: 2);

  String _docLabel(String type) => switch (type) {
        'bill_of_supply' => 'Bill of supply',
        'bill_of_entry' => 'Bill of entry',
        'import_service' => 'Import of services',
        _ => 'Tax invoice',
      };

  void _applySupplier(Map<String, dynamic> party) {
    setState(() {
      _partyId = party['id']?.toString();
      final gstin = party['gstin']?.toString() ?? '';
      if (gstin.isNotEmpty) _gstin.text = gstin.toUpperCase();
      _supplierStateCode = invoicePlaceOfSupply(
            gstin: gstin,
            customerState: party['state']?.toString(),
            customerStateCode: party['state_code']?.toString(),
          ) ??
          '';
      if (_place.text.trim().isEmpty) _place.text = _placeCode() ?? '';
    });
  }

  void _applyItem(Map<String, dynamic> item, _BillLine line) {
    line.item = item;
    final price = item['purchase_price'] ?? item['selling_price'];
    line.price.text = price == null ? '' : price.toString();
    line.taxRate = double.tryParse(item['tax_rate']?.toString() ?? '') ?? 0;
  }

  Future<void> _searchSupplier() async {
    final picked = await _searchSheet(
      title: 'Supplier',
      rows: _parties,
      nameOf: (row) => row['name']?.toString() ?? 'Supplier',
      detailOf: (row) => [row['phone'], row['gstin']].whereType<Object>().map((v) => v.toString()).where((v) => v.isNotEmpty).join(' · '),
    );
    if (picked != null) _applySupplier(picked);
  }

  Future<void> _addPurchaseItem() async {
    final picked = await _searchSheet(
      title: 'Item',
      rows: _items,
      nameOf: (row) => row['name']?.toString() ?? 'Item',
      detailOf: (row) => row['hsn_sac']?.toString() ?? '',
    );
    if (picked == null || !mounted) return;
    final line = _BillLine();
    _applyItem(picked, line);
    setState(() => _lines.add(line));
  }

  Future<Map<String, dynamic>?> _searchSheet({
    required String title,
    required List<Map<String, dynamic>> rows,
    required String Function(Map<String, dynamic>) nameOf,
    required String Function(Map<String, dynamic>) detailOf,
  }) {
    final query = TextEditingController();
    return showKSheet<Map<String, dynamic>>(
      context,
      title: title,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setSheet) {
          final q = query.text.trim().toLowerCase();
          final shown = rows.where((row) {
            if (q.isEmpty) return true;
            return nameOf(row).toLowerCase().contains(q) || detailOf(row).toLowerCase().contains(q);
          }).take(40);
          return SizedBox(
            height: 420,
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: TextField(
                    controller: query,
                    autofocus: true,
                    decoration: const InputDecoration(hintText: 'Search'),
                    onChanged: (_) => setSheet(() {}),
                  ),
                ),
                Expanded(
                  child: ListView(
                    children: [
                      for (final row in shown)
                        ListTile(
                          title: Text(nameOf(row)),
                          subtitle: detailOf(row).isEmpty ? null : Text(detailOf(row)),
                          onTap: () => Navigator.pop(ctx, row),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _editPurchaseDetails() async {
    final number = TextEditingController(text: _number.text);
    var date = _date;
    var due = _due;
    await showKSheet<void>(
      context,
      title: 'Bill details',
      builder: (ctx) => StatefulBuilder(
        builder: (context, setSheet) => Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: number, decoration: const InputDecoration(labelText: 'Bill number')),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Bill date'),
                subtitle: Text(ddMMMyyyy(date)),
                onTap: () async {
                  final picked = await showDatePicker(context: context, initialDate: date, firstDate: DateTime(2000), lastDate: DateTime(2100));
                  if (picked != null) setSheet(() => date = picked);
                },
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Due date'),
                subtitle: Text(due == null ? 'None' : ddMMMyyyy(due!)),
                onTap: () async {
                  final picked = await showDatePicker(context: context, initialDate: due ?? date, firstDate: DateTime(2000), lastDate: DateTime(2100));
                  if (picked != null) setSheet(() => due = picked);
                },
              ),
              const SizedBox(height: 8),
              KButton(
                label: 'Done',
                onPressed: () {
                  setState(() {
                    _number.text = number.text;
                    _date = date;
                    _due = due;
                  });
                  Navigator.pop(ctx);
                },
              ),
            ],
          ),
        ),
      ),
    );
    number.dispose();
  }

  Future<void> _editPurchaseLine(_BillLine line) async {
    final qty = TextEditingController(text: line.qty.text);
    final price = TextEditingController(text: line.price.text);
    final discount = TextEditingController(text: line.discount.text);
    final discountAmount = TextEditingController(text: line.discountAmount.text);
    final cess = TextEditingController(text: line.cess.text);
    final batch = TextEditingController(text: line.batch.text);
    final manufactured = TextEditingController(text: line.manufactured.text);
    final expiry = TextEditingController(text: line.expiry.text);
    final serials = TextEditingController(text: line.serials.text);
    var rate = line.taxRate;
    var capital = line.capitalGoods;
    final trackBatch = line.item?['track_batch'] == true;
    final trackSerial = line.item?['track_serial'] == true;
    var link = false;
    void apply() {
      setState(() {
        line.qty.text = qty.text;
        line.price.text = price.text;
        line.discount.text = discount.text;
        line.discountAmount.text = discountAmount.text;
        line.cess.text = cess.text;
        line.batch.text = batch.text;
        line.manufactured.text = manufactured.text;
        line.expiry.text = expiry.text;
        line.serials.text = serials.text;
        line.capitalGoods = capital;
        line.taxRate = rate;
      });
    }
    await showKSheet<void>(
      context,
      title: line.label,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setSheet) => Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (line.name.isNotEmpty)
                Align(
                  alignment: Alignment.centerLeft,
                  child: KTextButton(
                    label: line.item == null ? 'Link to an item in your list' : 'Change linked item',
                    onTap: () {
                      apply();
                      link = true;
                      Navigator.pop(ctx);
                    },
                  ),
                ),
              TextField(controller: qty, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Quantity')),
              TextField(controller: price, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Rate')),
              TextField(controller: discount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Discount %')),
              TextField(controller: discountAmount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Discount ₹ (overrides %)')),
              TextField(controller: cess, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Cess ₹')),
              if (trackBatch) ...[
                TextField(controller: batch, decoration: const InputDecoration(labelText: 'Batch number')),
                TextField(controller: manufactured, decoration: const InputDecoration(labelText: 'Manufactured (YYYY-MM-DD)')),
                TextField(controller: expiry, decoration: const InputDecoration(labelText: 'Expiry (YYYY-MM-DD)')),
              ],
              if (trackSerial) TextField(controller: serials, maxLines: 2, decoration: const InputDecoration(labelText: 'Serial numbers')),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Capital goods'),
                value: capital,
                onChanged: (v) => setSheet(() => capital = v),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  for (final option in const [0.0, 5.0, 12.0, 18.0, 28.0])
                    ChoiceChip(
                      label: Text('${option.toStringAsFixed(0)}%'),
                      selected: rate == option,
                      onSelected: (_) => setSheet(() => rate = option),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              KButton(
                label: 'Done',
                onPressed: () {
                  apply();
                  Navigator.pop(ctx);
                },
              ),
            ],
          ),
        ),
      ),
    );
    qty.dispose();
    price.dispose();
    discount.dispose();
    discountAmount.dispose();
    cess.dispose();
    batch.dispose();
    manufactured.dispose();
    expiry.dispose();
    serials.dispose();
    if (link && mounted) await _linkLine(line);
  }

  /// Links one scanned line to a catalogue item, keeping the bill's qty, rate and tax.
  Future<void> _linkLine(_BillLine line) async {
    final picked = await _searchSheet(
      title: 'Item',
      rows: _items,
      nameOf: (row) => row['name']?.toString() ?? 'Item',
      detailOf: (row) => row['hsn_sac']?.toString() ?? '',
    );
    if (picked == null || !mounted) return;
    setState(() {
      line.item = picked;
      line.name = picked['name']?.toString() ?? line.name;
      if (line.hsn.isEmpty) line.hsn = picked['hsn_sac']?.toString() ?? '';
    });
  }

  void _stepQty(_BillLine line, int delta) {
    final next = (double.tryParse(line.qty.text) ?? 0) + delta;
    if (next <= 0) {
      setState(() {
        line.dispose();
        _lines.remove(line);
      });
      return;
    }
    setState(() => line.qty.text = next == next.roundToDouble() ? next.toStringAsFixed(0) : next.toString());
  }

  Future<void> _pickState({required String title, required String current, required ValueChanged<String> onPicked}) async {
    final options = <(String, String)>[
      for (final name in indianStates)
        if (stateCode(name).isNotEmpty) (stateCode(name), name),
    ];
    await showKPicker<String>(
      context,
      title: title,
      value: current,
      options: options,
      onChanged: onPicked,
    );
  }

  Widget _purchaseScaffold() {
    final preview = _purchasePreview();
    final lines = _purchaseLines;
    final party = _parties.cast<Map<String, dynamic>?>().where((row) => row?['id']?.toString() == _partyId).firstOrNull;
    final billNo = _number.text.trim();
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 8, 16, 0),
              child: Row(children: [
                KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).maybePop()),
                Expanded(child: Text(_title, style: AppText.heading.copyWith(fontSize: 22))),
                KTextButton(label: 'Scan bill', onTap: _saving ? () {} : _scanBill),
              ]),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 8, AppSpace.gutter, 16),
                children: [
                  KCard(
                    padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(billNo.isEmpty ? 'Supplier bill' : 'Bill $billNo', style: AppText.bodyStrong.copyWith(color: AppColors.brand, fontSize: 16)),
                              const SizedBox(height: 4),
                              Text('${ddMMMyyyy(_date)}  ·  $_dueSummary', style: AppText.label),
                            ],
                          ),
                        ),
                        TextButton(onPressed: _editPurchaseDetails, child: const Text('EDIT')),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text('SUPPLIER', style: AppText.overline),
                  const SizedBox(height: 8),
                  KCard(
                    onTap: _searchSupplier,
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                    child: Row(
                      children: [
                        KAvatar(name: _partyName ?? ''),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(_partyName ?? (_scannedSupplierName.isNotEmpty ? _scannedSupplierName : 'Choose supplier'), style: AppText.bodyStrong),
                              if ((party?['phone']?.toString() ?? '').isNotEmpty)
                                Text(party!['phone'].toString(), style: AppText.caption),
                            ],
                          ),
                        ),
                        const Icon(LucideIcons.chevronRight, size: 18),
                      ],
                    ),
                  ),
                  if (_partyId == null && _scannedSupplierName.isNotEmpty)
                    _scanNotice(
                      'New party — not in your supplier list.',
                      [('Link existing', _searchSupplier), ('Create supplier', _createScannedSupplier)],
                    ),
                  if (_scanGstinMissing && _gstin.text.trim().isEmpty) _scanNotice('GSTIN not found on the bill.', const []),
                  if (_warehouses.isNotEmpty) ...[
                    const SizedBox(height: 18),
                    Text('WAREHOUSE', style: AppText.overline),
                    const SizedBox(height: 8),
                    KCard(
                      onTap: () => showKPicker<String>(
                        context,
                        title: 'Warehouse',
                        value: _warehouseId ?? '',
                        options: [for (final wh in _warehouses) (wh['id'].toString(), wh['name']?.toString() ?? 'Warehouse')],
                        onChanged: (id) => setState(() => _warehouseId = id),
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                      child: Row(
                        children: [
                          Expanded(child: Text(_warehouses.cast<Map<String, dynamic>?>().where((row) => row?['id']?.toString() == _warehouseId).firstOrNull?['name']?.toString() ?? 'Choose warehouse', style: AppText.bodyStrong)),
                          const Icon(LucideIcons.chevronRight, size: 18),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      Expanded(child: Text(lines.isEmpty ? 'ITEMS' : 'ITEMS (${lines.length})', style: AppText.overline)),
                      if (lines.isNotEmpty) KTextButton(label: '+ Add', onTap: _addPurchaseItem),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (_unlinkedLines.isNotEmpty) ...[
                    _scanNotice(
                      '${_unlinkedLines.length} item${_unlinkedLines.length == 1 ? '' : 's'}${_scanJobId != null ? ' from the bill' : ''} '
                      "${_unlinkedLines.length == 1 ? "isn't" : "aren't"} in your items. Link them so stock updates on save.",
                      [('Match automatically', _matchUnlinked), ('Add all to items', _addUnlinkedToItems)],
                    ),
                    const SizedBox(height: 8),
                  ],
                  if (lines.isEmpty)
                    KButton.secondary(label: 'Add item', onPressed: _addPurchaseItem)
                  else
                    KCard(
                      child: Column(
                        children: [
                          for (final line in lines) _purchaseLine(line, preview.intraState),
                          _purchaseTotal(preview),
                        ],
                      ),
                    ),
                  const SizedBox(height: 18),
                  Text('PAYMENT', style: AppText.overline),
                  const SizedBox(height: 8),
                  KCard(
                    padding: const EdgeInsets.all(14),
                    child: TextField(
                      controller: _paid,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'Amount paid now', border: InputBorder.none),
                    ),
                  ),
                  const SizedBox(height: 8),
                  InkWell(
                    onTap: () => setState(() => _moreOpen = !_moreOpen),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Row(
                        children: [
                          Icon(_moreOpen ? LucideIcons.chevronDown : LucideIcons.chevronRight, size: 18, color: AppColors.ink2),
                          const SizedBox(width: 8),
                          Text('GST AND NOTES', style: AppText.overline.copyWith(color: AppColors.ink2)),
                        ],
                      ),
                    ),
                  ),
                  if (_moreOpen) _purchaseMore(),
                  if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: AppText.body.copyWith(color: AppColors.negative))),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: Row(
                children: [
                  Expanded(child: KButton.secondary(label: 'Save draft', onPressed: _saving ? null : () => _save(purchaseStatus: 'draft'))),
                  const SizedBox(width: 10),
                  Expanded(child: KButton(label: _saving ? 'Saving…' : 'Finalize', onPressed: _saving ? null : () => _save())),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Amber note under a card, like the website's scan checks.
  Widget _scanNotice(String message, List<(String, VoidCallback)> actions) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(color: AppColors.warning.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(message, style: AppText.body),
          if (actions.isNotEmpty)
            Wrap(spacing: 16, children: [for (final (label, onTap) in actions) KTextButton(label: label, onTap: _saving ? () {} : onTap)]),
        ],
      ),
    );
  }

  Widget _purchaseLine(_BillLine line, bool intra) {
    final gst = _purchaseLineGst(line, intra);
    final discount = double.tryParse(line.discountAmount.text) ?? 0;
    final percent = double.tryParse(line.discount.text) ?? 0;
    final cess = double.tryParse(line.cess.text) ?? 0;
    final details = [
      '${_money(double.tryParse(line.price.text) ?? 0)} / ${line.unit.isNotEmpty ? line.unit : (line.item?['unit'] ?? 'PCS')}',
      'GST ${enIn(line.taxRate)}%',
      if (discount > 0) '${_money(discount)} off' else if (percent > 0) '${enIn(percent)}% off',
      if (cess > 0) 'Cess ${_money(cess)}',
      if (line.capitalGoods) 'Capital goods',
    ].join(' · ');
    return InkWell(
      onTap: () => _editPurchaseLine(line),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(line.label, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong),
                      if (line.item == null) Text('Not in your items', style: AppText.caption.copyWith(color: AppColors.warning)),
                    ],
                  ),
                ),
                Text(_money(gst.total + cess), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(child: Text(details, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption)),
                IconButton(visualDensity: VisualDensity.compact, onPressed: () => _stepQty(line, -1), icon: const Icon(LucideIcons.minus, size: 16)),
                Text(line.qty.text, style: AppText.bodyStrong),
                IconButton(visualDensity: VisualDensity.compact, onPressed: () => _stepQty(line, 1), icon: const Icon(LucideIcons.plus, size: 16)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _purchaseTotal(({double taxable, double tax, double cgst, double sgst, double igst, double discount, double cess, double roundOff, double grand, bool intraState}) preview) {
    return Container(
      color: const Color(0xFFFBFAF7),
      child: Column(
        children: [
          InkWell(
            onTap: () => setState(() => _breakupOpen = !_breakupOpen),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Total', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                        Text(_breakupOpen ? 'Hide breakup' : 'View breakup', style: AppText.small.copyWith(color: AppColors.brand)),
                      ],
                    ),
                  ),
                  Text(_money(preview.grand), style: AppText.heading.copyWith(fontFeatures: AppText.tabular)),
                ],
              ),
            ),
          ),
          if (_breakupOpen)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
              child: Column(
                children: [
                  _sum('Taxable value', preview.taxable),
                  if (preview.discount > 0) _sum('Discount', preview.discount),
                  if (preview.cess > 0) _sum('Cess', preview.cess),
                  if (preview.intraState) ...[
                    _sum('CGST', preview.cgst),
                    _sum('SGST', preview.sgst),
                  ] else
                    _sum('IGST', preview.igst),
                  Row(
                    children: [
                      const Expanded(child: Text('Round off')),
                      Switch.adaptive(
                        value: _roundOff,
                        activeTrackColor: AppColors.brand,
                        activeThumbColor: AppColors.onBrand,
                        onChanged: (v) => setState(() {
                          _roundOff = v;
                          _scanRoundOff = null;
                        }),
                      ),
                    ],
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _sum(String label, double value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [Expanded(child: Text(label, style: AppText.caption)), Text(_money(value), style: AppText.label)]),
      );

  Widget _purchaseMore() {
    final supplierState = gstStateName(_supplierCode() ?? '');
    final place = gstStateName(_placeCode() ?? '');
    return KCard(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: TextField(controller: _gstin, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Supplier GSTIN')),
          ),
          KListRow(
            title: 'Supplier state',
            subtitle: supplierState.isEmpty ? 'From GSTIN' : supplierState,
            onTap: () => _pickState(title: 'Supplier state', current: _supplierCode() ?? '', onPicked: (code) => setState(() => _supplierStateCode = code)),
          ),
          KListRow(
            title: 'Place of supply',
            subtitle: place.isEmpty ? 'Your state' : place,
            onTap: () => _pickState(title: 'Place of supply', current: _placeCode() ?? '', onPicked: (code) => setState(() => _place.text = code)),
          ),
          KListRow(
            title: 'Document',
            subtitle: _docLabel(_docType),
            onTap: () => showKPicker<String>(
              context,
              title: 'Document',
              value: _docType,
              options: const [('tax_invoice', 'Tax invoice'), ('bill_of_supply', 'Bill of supply'), ('bill_of_entry', 'Bill of entry'), ('import_service', 'Import of services')],
              onChanged: (v) => setState(() => _docType = v),
            ),
          ),
          KListRow(
            title: 'Prices',
            subtitle: _priceMode == 'inclusive' ? 'GST included in the rate' : 'GST extra',
            onTap: () => showKPicker<String>(
              context,
              title: 'Prices',
              value: _priceMode,
              options: const [('exclusive', 'GST extra'), ('inclusive', 'GST included')],
              onChanged: (v) => setState(() => _priceMode = v),
            ),
          ),
          if (_docType == 'bill_of_entry')
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: TextField(controller: _port, decoration: const InputDecoration(labelText: 'Port code')),
            ),
          SwitchListTile(title: const Text('GST credit (ITC) allowed'), value: _itc, onChanged: (v) => setState(() => _itc = v)),
          SwitchListTile(title: const Text('Reverse charge'), value: _reverseCharge, onChanged: (v) => setState(() => _reverseCharge = v)),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
            child: TextField(controller: _notes, maxLines: 2, decoration: const InputDecoration(labelText: 'Notes')),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: KSpinner(padding: EdgeInsets.symmetric(vertical: 64)));
    if (widget.kind == BillKind.purchase) return _purchaseScaffold();
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: ListView(
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
