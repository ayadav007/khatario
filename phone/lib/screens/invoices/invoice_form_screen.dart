import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/web_ui.dart';
import '../parties/customer_form_logic.dart';
import '../parties/customer_form_screen.dart';
import 'bill_saved_screen.dart';
import 'invoice_form_logic.dart';
import 'invoice_payment_sheet.dart';
import 'invoice_scan.dart';

/// New / edit tax invoice. Mirrors the website's mobile composer (`renderMobileComposer` in
/// `app/(app)/invoices/new/page.tsx`): customer, dates, items, notes, totals, settlement.
/// The server recalculates GST, stock and the ledger; this screen sends lines only.
class InvoiceFormScreen extends StatefulWidget {
  const InvoiceFormScreen({super.key, required this.session, this.invoiceId, this.customerId, this.documentType = 'tax_invoice', this.supplyOrderId});

  final AppSession session;
  final String? invoiceId;
  final String? customerId;
  final String documentType;

  /// Bill a confirmed Supplier Hub order: customer and lines come from the order, and saving
  /// links the invoice back to it.
  final String? supplyOrderId;

  @override
  State<InvoiceFormScreen> createState() => _InvoiceFormScreenState();
}

const _gstRates = [0.0, 5.0, 12.0, 18.0, 28.0];
const _notePresets = [
  ('Due on receipt', 'Payment due upon receipt.'),
  ('Net 30', 'Net 30 days. Interest may apply on delayed remittances.'),
  ('E. & O.E.', 'Subject to jurisdiction. E. & O.E.'),
];

class _InvoiceFormScreenState extends State<InvoiceFormScreen> {
  final _lines = <InvoiceLineDraft>[];
  final _notes = TextEditingController();
  final _terms = TextEditingController();

  /// Delivery, packing, freight… added after tax (sent as `additional_charges`).
  final List<ExtraCharge> _charges = [];
  double get _chargesTotal => _charges.fold(0.0, (s, c) => s + c.amount);
  final List<RecordedPayment> _payments = [];
  double get _paidTotal => _payments.fold(0.0, (sum, p) => sum + p.amount);
  final _po = TextEditingController();
  final _reference = TextEditingController();
  String? _customerId;
  /// Null until the plan list loads. Scan stays up in that gap; the search API still refuses it.
  bool? _canScanBarcode;
  String _customerName = '';
  String _customerPhone = '';
  num _customerBalance = 0;
  String? _customerGstin;
  String? _customerState;
  String? _customerStateCode;

  /// Place of supply picked by hand; null follows the customer.
  String? _placeOverride;
  bool _pricesIncludeGst = false;
  bool _roundOff = false;
  bool _moreOpen = false;
  bool _breakupOpen = false;
  bool _loading = false;
  bool _saving = false;
  DateTime _date = DateTime.now();
  DateTime? _dueDate;
  String? _number;
  String? _locked;
  String? _loadedStatus;

  bool get _isNew => widget.invoiceId == null;

  String? get _supplierStateCode {
    final business = widget.session.business;
    final code = business['state_code']?.toString().trim() ?? '';
    if (code.isNotEmpty) return code.padLeft(2, '0');
    final named = stateCode(business['state']?.toString() ?? '');
    if (named.isNotEmpty) return named;
    final gstin = business['gstin']?.toString();
    if (gstin != null && isValidGstin(gstin)) return gstin.substring(0, 2);
    return null;
  }

  String? get _place =>
      _placeOverride ??
      invoicePlaceOfSupply(
        gstin: _customerGstin,
        customerState: _customerState,
        customerStateCode: _customerStateCode,
        supplierStateCode: _supplierStateCode,
      );

  @override
  void initState() {
    super.initState();
    _customerId = widget.customerId;
    _loadScanGate();
    if (!_isNew) {
      _loadInvoice();
    } else {
      _loadNextNumber();
      _loadDefaults();
      if (widget.customerId != null) _loadCustomer(widget.customerId!);
      if (widget.supplyOrderId != null) _loadSupplyOrder(widget.supplyOrderId!);
    }
  }

  Future<void> _loadSupplyOrder(String orderId) async {
    try {
      final body = await widget.session.api.getJson('/api/supply-orders/$orderId/invoice-draft');
      if (!mounted) return;
      final customerId = body['customer_id']?.toString();
      final lines = body['lines'] is List ? (body['lines'] as List).whereType<Map>() : const <Map>[];
      setState(() {
        _lines
          ..clear()
          ..addAll([
            for (final l in lines)
              InvoiceLineDraft(
                itemId: l['item_id']?.toString(),
                name: l['name']?.toString() ?? '',
                quantity: toNum(l['quantity']).toDouble(),
                unitPrice: l['gst_included'] == true && toNum(l['tax_rate']) > 0
                    ? toNum(l['selling_price']) / (1 + toNum(l['tax_rate']) / 100)
                    : toNum(l['selling_price']).toDouble(),
                unit: l['unit']?.toString() ?? 'PCS',
                taxRate: toNum(l['tax_rate']).toDouble(),
                hsn: l['hsn_sac']?.toString(),
              ),
          ]);
        _customerId = customerId;
      });
      if (customerId != null) _loadCustomer(customerId);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _loadScanGate() async {
    try {
      final body = await widget.session.api.getJson('/api/features/enabled');
      final ids = body['enabledIds'];
      if (ids is! List || !mounted) return;
      final on = ids.map((e) => e.toString()).any((id) => id == 'advanced_barcode' || id == 'barcode_scanning');
      setState(() => _canScanBarcode = on);
    } catch (_) {}
  }

  bool get _showScan => _canScanBarcode != false;

  /// Settings › Invoices & documents › Invoice defaults, applied to a new bill before anything is
  /// typed. Each value can still be changed on this bill.
  Future<void> _loadDefaults() async {
    try {
      final body = await widget.session.api.getJson('/api/settings/invoice-defaults');
      final d = body['defaults'] is Map ? Map<String, dynamic>.from(body['defaults'] as Map) : const <String, dynamic>{};
      if (!mounted) return;
      setState(() {
        _pricesIncludeGst = d['pricesIncludeGst'] == true;
        _roundOff = d['roundOff'] == true;
        final days = d['dueDays'];
        if (days is num) _dueDate = dateOnly(_date).add(Duration(days: days.toInt()));
        if (_notes.text.isEmpty) _notes.text = d['notes']?.toString() ?? '';
        if (_terms.text.isEmpty) _terms.text = d['terms']?.toString() ?? '';
      });
    } catch (_) {
      // Older servers have no defaults; the bill starts blank as before.
    }
  }

  @override
  void dispose() {
    _notes.dispose();
    _terms.dispose();
    _po.dispose();
    _reference.dispose();
    super.dispose();
  }

  /// Number preview only; the server assigns the real number on save.
  Future<void> _loadNextNumber() async {
    final branch = widget.session.defaultBranchId;
    if (branch == null) return;
    try {
      final body = await widget.session.api.getJson(
        Uri(path: '/api/invoices/next-number', queryParameters: {'branch_id': branch, 'document_type': widget.documentType}).toString(),
      );
      final full = body['full_number']?.toString();
      if (mounted && full != null && full.isNotEmpty) setState(() => _number = full);
    } catch (_) {}
  }

  Future<void> _loadInvoice() async {
    setState(() => _loading = true);
    try {
      final body = await widget.session.api.getJson('/api/invoices/${widget.invoiceId}');
      final invoice = body['invoice'] is Map ? Map<String, dynamic>.from(body['invoice'] as Map) : body;
      if (invoice['status'] == 'cancelled' || invoice['is_editable'] == false) {
        if (mounted) {
          setState(() {
            _locked = 'This invoice is locked and cannot be edited.';
            _loading = false;
          });
        }
        return;
      }
      final rawLines = invoice['items'];
      final lines = rawLines is List
          ? rawLines.whereType<Map>().map((row) {
              final e = Map<String, dynamic>.from(row);
              return InvoiceLineDraft(
                itemId: e['item_id']?.toString(),
                name: e['item_name']?.toString() ?? '',
                quantity: toNum(e['quantity']).toDouble(),
                unitPrice: toNum(e['unit_price']).toDouble(),
                unit: e['unit']?.toString() ?? 'PCS',
                discountPercent: toNum(e['discount_percent']).toDouble(),
                taxRate: toNum(e['tax_rate']).toDouble(),
                hsn: e['hsn_sac']?.toString(),
                variantId: e['variant_id']?.toString(),
              );
            }).toList()
          : <InvoiceLineDraft>[];
      if (!mounted) return;
      setState(() {
        _lines
          ..clear()
          ..addAll(lines);
        _number = invoice['invoice_number']?.toString();
        _loadedStatus = invoice['status']?.toString();
        _customerId = invoice['customer_id']?.toString();
        _customerName = invoice['customer_name']?.toString() ?? '';
        _customerGstin = invoice['customer_gstin']?.toString();
        _notes.text = invoice['notes']?.toString() ?? '';
        _terms.text = invoice['terms']?.toString() ?? '';
        final charges = toNum(invoice['additional_charges']).toDouble();
        _charges
          ..clear()
          ..addAll([if (charges.abs() > 0.004) ExtraCharge(purpose: 'Additional charges', amount: charges)]);
        _po.text = invoice['purchase_order_number']?.toString() ?? '';
        _reference.text = invoice['reference_number']?.toString() ?? '';
        _pricesIncludeGst = invoice['prices_include_gst'] == true;
        _roundOff = invoice['enable_round_off'] == true;
        final parsed = DateTime.tryParse(invoice['invoice_date']?.toString() ?? '');
        if (parsed != null) _date = parsed.toLocal();
        _dueDate = DateTime.tryParse(invoice['due_date']?.toString() ?? '')?.toLocal();
        _loading = false;
      });
      if (_customerId != null && _customerId!.isNotEmpty) await _loadCustomer(_customerId!);
    } catch (e) {
      if (mounted) {
        setState(() {
          _locked = e is ApiException ? e.message : 'Could not load this invoice.';
          _loading = false;
        });
      }
    }
  }

  Future<void> _loadCustomer(String id) async {
    try {
      final body = await widget.session.api.getJson('/api/customers/$id');
      final customer = body['customer'] is Map ? Map<String, dynamic>.from(body['customer'] as Map) : body;
      if (!mounted) return;
      setState(() {
        _customerId = id;
        _customerName = customer['name']?.toString() ?? _customerName;
        _customerPhone = customer['phone']?.toString() ?? '';
        _customerBalance = toNum(customer['current_balance']);
        _customerGstin = customer['gstin']?.toString();
        _customerState = customer['state']?.toString();
        _customerStateCode = customer['state_code']?.toString();
        _placeOverride = null;
      });
    } catch (_) {}
  }

  void _clearCustomer() {
    setState(() {
      _customerId = null;
      _customerName = '';
      _customerPhone = '';
      _customerBalance = 0;
      _customerGstin = null;
      _customerState = null;
      _customerStateCode = null;
      _placeOverride = null;
    });
  }

  InvoiceDraft _draft(String status) => InvoiceDraft(
        invoiceId: widget.invoiceId,
        customerId: _customerId,
        invoiceDate: ymd(_date),
        dueDate: _dueDate == null ? null : ymd(_dueDate!),
        status: status,
        documentType: widget.documentType,
        lines: _lines,
        notes: _notes.text,
        terms: _terms.text,
        placeOfSupply: _place,
        pricesIncludeGst: _pricesIncludeGst,
        enableRoundOff: _roundOff,
        purchaseOrderNumber: _po.text,
        referenceNumber: _reference.text,
        additionalCharges: _chargesTotal,
        paymentAmount: status == 'final' && (_isNew || _loadedStatus == 'draft') ? _paidTotal : 0,
        payments: status == 'final' && (_isNew || _loadedStatus == 'draft') ? List<RecordedPayment>.from(_payments) : const [],
      );

  Future<void> _save(String status) async {
    final grand = previewInvoice(_draft('draft'), supplierStateCode: _supplierStateCode).grand;
    if (status == 'final' && (_isNew || _loadedStatus == 'draft') && _payments.isEmpty) {
      final hasCustomer = _customerId != null && _customerId!.isNotEmpty;
      final saved = await showInvoicePaymentSheet(
        context,
        grandTotal: grand,
        payments: const [],
        canLeaveUnpaid: hasCustomer,
        prefillFull: true,
        requireFull: !hasCustomer,
        saveLabel: 'Continue',
      );
      if (saved == null || !mounted) return;
      setState(() {
        _payments
          ..clear()
          ..addAll(saved);
      });
    }
    final draft = _draft(status);
    final problem = validateInvoiceDraft(draft) ??
        (status == 'final' && _isNew && draft.paymentAmount > grand + 0.005
            ? 'Amount received cannot be more than the bill total'
            : null);
    if (problem != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem)));
      return;
    }
    setState(() => _saving = true);
    try {
      final body = await widget.session.api.postJson('/api/invoices', {
        ...invoiceCreateBody(draft),
        if (widget.supplyOrderId != null && _isNew) 'supply_order_id': widget.supplyOrderId,
      });
      final invoice = body['invoice'] is Map ? body['invoice'] as Map : body;
      final number = invoice['invoice_number']?.toString();
      final id = invoice['id']?.toString();
      if (!mounted) return;
      if (status == 'final' && _isNew && id != null && id.isNotEmpty) {
        // The caller gets `true` now (lists refresh); the shopkeeper lands on share / print / next bill.
        Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(
            builder: (_) => BillSavedScreen(
              session: widget.session,
              invoiceId: id,
              invoiceNumber: number ?? '',
              total: toNum(invoice['grand_total'] ?? grand),
              received: draft.paymentAmount,
              customerName: _customerId == null ? null : _customerName,
            ),
          ),
          result: true,
        );
        return;
      }
      if (number != null && number.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(status == 'draft' ? 'Draft $number saved' : 'Saved $number')));
      }
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Network error. The bill was not saved.')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _close() async {
    if (_lines.isEmpty || _saving) {
      Navigator.of(context).pop();
      return;
    }
    final discard = await showKSheet<bool>(
      context,
      title: 'Discard this bill?',
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('The items you added will be lost.', style: AppText.body.copyWith(color: AppColors.ink2)),
            const SizedBox(height: AppSpace.lg),
            KButton(label: 'Discard', kind: KButtonKind.danger, onPressed: () => Navigator.of(ctx).pop(true)),
            const SizedBox(height: AppSpace.sm),
            KButton.secondary(label: 'Keep editing', onPressed: () => Navigator.of(ctx).pop(false)),
          ],
        ),
      ),
    );
    if (discard == true && mounted) Navigator.of(context).pop();
  }

  Future<void> _pickCustomer() async {
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _PickerSheet(
        title: 'Bill to',
        hint: 'Name or phone',
        load: (q) async {
          final body = await widget.session.api.getJson(
            Uri(path: '/api/customers', queryParameters: {'search': q, 'limit': '20'}).toString(),
          );
          final rows = (body['customers'] as List?) ?? const [];
          return rows.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        },
        header: (ctx) => KListRow(
          leading: const KAvatar(name: '', muted: true, icon: LucideIcons.banknote),
          title: 'Cash sale',
          subtitle: 'Walk-in customer, no account',
          trailing: _customerId == null ? Icon(LucideIcons.check, size: 20, color: AppColors.brand) : null,
          onTap: () => Navigator.of(ctx).pop(const {'id': null}),
        ),
        footer: (ctx) => KListRow(
          leading: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: AppColors.brandSoft, shape: BoxShape.circle),
            child: Icon(LucideIcons.userPlus, size: 18, color: AppColors.brand),
          ),
          title: 'Add new customer',
          onTap: () => Navigator.of(ctx).pop(const {'id': '__new__'}),
        ),
        row: (ctx, row, _) {
          final balance = toNum(row['current_balance']);
          return KListRow(
            leading: KAvatar(name: row['name']?.toString() ?? ''),
            title: row['name']?.toString() ?? '',
            subtitle: row['phone']?.toString() ?? '',
            trailing: balance > 0.005
                ? Text('Due $rupeeSign${enIn(balance, maxFraction: 0)}', style: AppText.small.copyWith(color: AppColors.due))
                : (row['id']?.toString() == _customerId ? Icon(LucideIcons.check, size: 20, color: AppColors.brand) : null),
            onTap: () => Navigator.of(ctx).pop(row),
          );
        },
      ),
    );
    if (picked == null || !mounted) return;
    final id = picked['id'];
    if (id == null) {
      _clearCustomer();
    } else if (id == '__new__') {
      final saved = await Navigator.of(context).push<bool>(
        MaterialPageRoute(builder: (_) => CustomerFormScreen(session: widget.session, capabilities: null)),
      );
      if (saved == true && mounted) _pickCustomer();
    } else {
      await _loadCustomer(id.toString());
    }
  }

  void _addOrBump(Map<String, dynamic> row, {Map<String, dynamic>? variant}) {
    final id = row['id']?.toString();
    final variantId = variant?['id']?.toString();
    final at = id == null ? -1 : _lines.indexWhere((l) => l.itemId == id && l.variantId == variantId);
    setState(() {
      if (at >= 0) {
        _lines[at] = _withQty(_lines[at], _lines[at].quantity + 1);
      } else {
        final vName = variant?['variant_name']?.toString();
        _lines.add(InvoiceLineDraft(
          itemId: id,
          variantId: variantId,
          name: vName == null || vName.isEmpty ? row['name']?.toString() ?? '' : '${row['name']} ($vName)',
          quantity: 1,
          unitPrice: toNum(variant?['selling_price'] ?? row['selling_price']).toDouble(),
          unit: row['unit']?.toString() ?? 'PCS',
          taxRate: toNum(row['tax_rate']).toDouble(),
          hsn: row['hsn_sac']?.toString(),
        ));
      }
    });
  }

  /// Camera (or scanner gun / typed code) straight onto the bill, like the website's Scan.
  Future<void> _scan() async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => BarcodeScanScreen(
        api: widget.session.api,
        onItem: (hit) => _addOrBump(hit.item, variant: hit.variant),
      ),
    ));
  }

  Future<void> _editCharge([int? index]) async {
    final existing = index == null ? null : _charges[index];
    final purpose = TextEditingController(text: existing?.purpose ?? '');
    final amount = TextEditingController(text: existing == null ? '' : formatAmount(existing.amount).replaceAll(RegExp('[^0-9.]'), ''));
    final result = await showKSheet<String>(
      context,
      title: existing == null ? 'Add a charge' : 'Edit charge',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final p in const ['Delivery', 'Packing', 'Freight', 'Installation', 'Labour'])
                    KChip(label: p, selected: purpose.text == p, onTap: () => set(() => purpose.text = p)),
                ],
              ),
              const SizedBox(height: 12),
              TextField(controller: purpose, onChanged: (_) => set(() {}), decoration: const InputDecoration(labelText: 'What for')),
              const SizedBox(height: 12),
              TextField(
                controller: amount,
                autofocus: existing == null,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Amount', prefixText: '$rupeeSign '),
              ),
              const SizedBox(height: 6),
              Text('Added to the total after GST, as on the website.', style: AppText.caption),
              const SizedBox(height: 16),
              Row(
                children: [
                  if (existing != null) ...[
                    Expanded(child: KButton(label: 'Remove', kind: KButtonKind.danger, onPressed: () => Navigator.pop(ctx, 'remove'))),
                    const SizedBox(width: 10),
                  ],
                  Expanded(child: KButton(label: existing == null ? 'Add charge' : 'Save', onPressed: () => Navigator.pop(ctx, 'save'))),
                ],
              ),
            ],
          ),
        ),
      ),
    );
    if (!mounted || result == null) return;
    setState(() {
      if (result == 'remove' && index != null) {
        _charges.removeAt(index);
        return;
      }
      final value = double.tryParse(amount.text.trim().replaceAll(',', '')) ?? 0;
      if (value <= 0) return;
      final charge = ExtraCharge(purpose: purpose.text.trim().isEmpty ? 'Charges' : purpose.text.trim(), amount: value);
      if (index == null) {
        _charges.add(charge);
      } else {
        _charges[index] = charge;
      }
    });
  }

  Future<void> _addItems() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => StatefulBuilder(
        builder: (ctx, setSheet) {
          final count = _lines.fold<double>(0, (s, l) => s + l.quantity);
          return _PickerSheet(
            title: 'Add items',
            hint: 'Search items',
            tall: true,
            load: (q) async {
              final body = await widget.session.api.getJson(
                Uri(path: '/api/items', queryParameters: {'search': q, 'limit': '30'}).toString(),
              );
              final rows = (body['items'] as List?) ?? const [];
              return rows.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
            },
            row: (_, row, _) {
              final id = row['id']?.toString();
              final inBill = _lines.where((l) => l.itemId != null && l.itemId == id).fold<double>(0, (s, l) => s + l.quantity);
              final stock = toNum(row['current_stock']);
              final unit = row['unit']?.toString() ?? 'PCS';
              return KListRow(
                leading: KAvatar(name: row['name']?.toString() ?? '', muted: true),
                title: row['name']?.toString() ?? '',
                subtitle: '$rupeeSign${enIn(toNum(row['selling_price']), maxFraction: 2)} · GST ${enIn(toNum(row['tax_rate']))}%'
                    ' · ${enIn(stock, maxFraction: 2)} $unit',
                trailing: inBill > 0
                    ? Container(
                        height: 32,
                        constraints: const BoxConstraints(minWidth: 32),
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(color: AppColors.brand, borderRadius: BorderRadius.circular(999)),
                        child: Text(enIn(inBill), style: AppText.small.copyWith(color: AppColors.onBrand)),
                      )
                    : Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(color: AppColors.brandSoft, shape: BoxShape.circle),
                        child: Icon(LucideIcons.plus, size: 18, color: AppColors.brand),
                      ),
                onTap: () {
                  _addOrBump(row);
                  setSheet(() {});
                },
              );
            },
            bottom: (ctx) => KButton(
              label: count == 0 ? 'Done' : 'Done · ${enIn(count)} in bill',
              onPressed: () => Navigator.of(ctx).pop(),
            ),
          );
        },
      ),
    );
  }

  InvoiceLineDraft _withQty(InvoiceLineDraft l, double qty) => l.copyWith(quantity: qty);

  void _stepQty(int index, double delta) {
    final next = _lines[index].quantity + delta;
    setState(() {
      if (next <= 0) {
        _lines.removeAt(index);
      } else {
        _lines[index] = _withQty(_lines[index], next);
      }
    });
  }

  Future<void> _editLine(int index) async {
    final result = await showKSheet<(InvoiceLineDraft?, bool)>(
      context,
      title: _lines[index].name,
      scrollable: true,
      builder: (_) => _LineEditor(line: _lines[index]),
    );
    if (result == null || !mounted) return;
    setState(() {
      if (result.$2) {
        _lines.removeAt(index);
      } else if (result.$1 != null) {
        _lines[index] = result.$1!;
      }
    });
  }

  Future<void> _pickPlace() async {
    final current = _place ?? '';
    await showKPicker<String>(
      context,
      title: 'Place of supply',
      value: current,
      options: [
        for (final s in indianStates)
          if (stateCode(s).isNotEmpty) (stateCode(s), '$s (${stateCode(s)})'),
      ],
      onChanged: (code) => setState(() => _placeOverride = code),
    );
  }

  Future<void> _pickDate({required bool due}) async {
    final initial = due ? (_dueDate ?? _date.add(const Duration(days: 15))) : _date;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: due ? _date : DateTime(2000),
      lastDate: DateTime(2100),
      helpText: due ? 'Due date' : 'Invoice date',
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (due) {
        _dueDate = picked;
      } else {
        _date = picked;
        if (_dueDate != null && _dueDate!.isBefore(picked)) _dueDate = null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final preview = previewInvoice(_draft('draft'), supplierStateCode: _supplierStateCode);
    return PopScope(
      canPop: _lines.isEmpty || _saving,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _header(),
              Expanded(
                child: _loading
                    ? const KSpinner()
                    : _locked != null
                        ? KEmptyState(
                            icon: LucideIcons.lock,
                            title: _locked!,
                            action: KButton.secondary(label: 'Close', expand: false, onPressed: () => Navigator.of(context).pop()),
                          )
                        : _form(preview),
              ),
              if (!_loading && _locked == null) _totalBar(preview),
            ],
          ),
        ),
      ),
    );
  }

  Widget _header() {
    return SizedBox(
      height: 64,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpace.xs),
        child: Row(
          children: [
            KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: _close),
            const SizedBox(width: 4),
            Expanded(
              child: Text(_isNew ? 'New bill' : 'Edit bill', style: AppText.heading.copyWith(fontSize: 18)),
            ),
          ],
        ),
      ),
    );
  }

  String get _dueSummary {
    final due = _dueDate;
    if (due == null) return 'No due date';
    final days = dateOnly(due).difference(dateOnly(_date)).inDays;
    if (days <= 0) return 'Due on bill date';
    return 'Due in $days day${days == 1 ? '' : 's'}';
  }

  /// Bill date, due date, place of supply and GST pricing, behind the EDIT pill.
  Future<void> _editDetails() async {
    await showKSheet<void>(
      context,
      title: 'Bill details',
      scrollable: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) {
          void update(VoidCallback fn) {
            setState(fn);
            setSheet(() {});
          }

          final place = _place;
          final dueDays = _dueDate == null ? null : dateOnly(_dueDate!).difference(dateOnly(_date)).inDays;
          return Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _SheetField(
                  icon: LucideIcons.calendar,
                  label: 'Bill date',
                  value: ddMMMyyyy(_date),
                  onTap: () async {
                    await _pickDate(due: false);
                    setSheet(() {});
                  },
                ),
                const SizedBox(height: AppSpace.lg),
                Text('Due date', style: AppText.label),
                const SizedBox(height: AppSpace.sm),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    KChip(label: 'None', selected: _dueDate == null, onTap: () => update(() => _dueDate = null)),
                    for (final d in const [7, 15, 30])
                      KChip(
                        label: '$d days',
                        selected: dueDays == d,
                        onTap: () => update(() => _dueDate = dateOnly(_date).add(Duration(days: d))),
                      ),
                    KChip(
                      label: _dueDate != null && !const [7, 15, 30].contains(dueDays) ? ddMMM(_dueDate!) : 'Pick date',
                      icon: LucideIcons.calendarDays,
                      selected: _dueDate != null && !const [7, 15, 30].contains(dueDays),
                      onTap: () async {
                        await _pickDate(due: true);
                        setSheet(() {});
                      },
                    ),
                  ],
                ),
                const SizedBox(height: AppSpace.lg),
                _SheetField(
                  icon: LucideIcons.mapPin,
                  label: 'Place of supply',
                  value: place == null ? 'Choose state' : gstStateName(place),
                  caption: place == null ? null : (_draftIntraState ? 'Same state · CGST + SGST' : 'Other state · IGST'),
                  onTap: () async {
                    await _pickPlace();
                    setSheet(() {});
                  },
                ),
                const SizedBox(height: AppSpace.sm),
                _SwitchRow(
                  title: 'Prices include GST',
                  subtitle: 'Item prices already have tax in them',
                  value: _pricesIncludeGst,
                  onChanged: (v) => update(() => _pricesIncludeGst = v),
                ),
                const SizedBox(height: AppSpace.md),
                KButton(label: 'Done', onPressed: () => Navigator.of(ctx).pop()),
              ],
            ),
          );
        },
      ),
    );
  }

  bool get _draftIntraState => invoiceIntraState(_place, _supplierStateCode);

  Widget _form(({double taxable, double tax, double cgst, double sgst, double igst, double discount, double roundOff, double grand, bool intraState}) preview) {
    final hasLines = _lines.isNotEmpty;
    return ListView(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
      children: [
        // 1. Which bill: number, date, due. Everything else is behind EDIT.
        KCard(
          padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _number == null ? 'Tax invoice' : 'Invoice $_number',
                      style: AppText.bodyStrong.copyWith(color: AppColors.brand, fontSize: 16),
                    ),
                    const SizedBox(height: 4),
                    Text.rich(
                      TextSpan(children: [
                        TextSpan(text: ddMMMyyyy(_date), style: AppText.label.copyWith(color: AppColors.ink)),
                        TextSpan(text: '  ·  $_dueSummary', style: AppText.label),
                      ]),
                    ),
                  ],
                ),
              ),
              _EditPill(onTap: _editDetails),
            ],
          ),
        ),
        const SizedBox(height: AppSpace.lg),

        // 2. Who it is for.
        _SectionLabel('Bill to'),
        _PartyField(
          name: _customerId == null ? null : _customerName,
          detail: [
            if (_customerPhone.isNotEmpty) _customerPhone,
            if (_customerBalance > 0.005) 'Due $rupeeSign${enIn(_customerBalance, maxFraction: 0)}',
          ].join(' · '),
          onTap: _pickCustomer,
          onClear: _customerId == null ? null : _clearCustomer,
        ),
        const SizedBox(height: AppSpace.lg),

        // 3. What is in it.
        Row(
          children: [
            Expanded(child: _SectionLabel(hasLines ? 'Items (${_lines.length})' : 'Items')),
            if (hasLines) ...[
              if (_showScan) ...[
                KTextButton(label: 'Scan', onTap: _scan),
                const SizedBox(width: 14),
              ],
              KTextButton(label: '+ Add more', onTap: _addItems),
            ],
          ],
        ),
        if (!hasLines)
          Row(
            children: [
              Expanded(child: _AddItemsButton(onTap: _addItems)),
              if (_showScan) ...[
                const SizedBox(width: 10),
                _ScanButton(onTap: _scan),
              ],
            ],
          )
        else
          KCard(
            child: KDivided(
              children: [
                for (final (i, line) in _lines.indexed)
                  _LineRow(
                    line: line,
                    preview: computeLineGst(
                      quantity: line.quantity,
                      unitPrice: line.unitPrice,
                      discountPercent: line.discountPercent,
                      taxRate: line.taxRate,
                      intraState: preview.intraState,
                      pricesIncludeGst: _pricesIncludeGst,
                    ),
                    onTap: () => _editLine(i),
                    onMinus: () => _stepQty(i, -1),
                    onPlus: () => _stepQty(i, 1),
                  ),
                _TotalRow(
                  preview: preview,
                  charges: _chargesTotal,
                  open: _breakupOpen,
                  roundOff: _roundOff,
                  onToggle: () => setState(() => _breakupOpen = !_breakupOpen),
                  onRoundOff: (v) => setState(() => _roundOff = v),
                ),
              ],
            ),
          ),

        // Charges on top of the items: delivery, packing, freight…
        if (hasLines) ...[
          const SizedBox(height: AppSpace.lg),
          Row(
            children: [
              Expanded(child: _SectionLabel('Additional charges')),
              if (_charges.isNotEmpty) KTextButton(label: '+ Add', onTap: () => _editCharge()),
            ],
          ),
          if (_charges.isEmpty)
            OutlinedButton.icon(
              onPressed: () => _editCharge(),
              icon: const Icon(LucideIcons.plus, size: 18),
              label: const Text('Add delivery, packing or other charges'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                foregroundColor: AppColors.brand,
                side: BorderSide(color: AppColors.hairline),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
              ),
            )
          else
            KCard(
              child: KDivided(children: [
                for (final (i, c) in _charges.indexed)
                  KListRow(
                    title: c.purpose,
                    trailing: Text(formatAmount(c.amount), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                    onTap: () => _editCharge(i),
                  ),
              ]),
            ),
        ],

        // 4. Settlement, only once there is something to settle.
        if (hasLines && (_isNew || _loadedStatus == 'draft')) ...[
          const SizedBox(height: AppSpace.lg),
          _SectionLabel('Payment'),
          KCard(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_paidTotal > 0) ...[
                  _payLine('Paid', formatAmount(_paidTotal), AppColors.positive),
                  _payLine('To collect', formatAmount(invoiceRound2(preview.grand - _paidTotal)), AppColors.negative),
                  const SizedBox(height: AppSpace.sm),
                ],
                KButton.secondary(
                  label: _paidTotal > 0 ? 'Payment: ${formatAmount(_paidTotal)}' : 'Record payment',
                  icon: LucideIcons.creditCard,
                  onPressed: () => _recordPayment(preview.grand),
                ),
              ],
            ),
          ),
        ],

        // 5. Rarely used, folded away.
        const SizedBox(height: AppSpace.md),
        InkWell(
          onTap: () => setState(() => _moreOpen = !_moreOpen),
          borderRadius: BorderRadius.circular(AppRadius.sm),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 2),
            child: Row(
              children: [
                AnimatedRotation(
                  turns: _moreOpen ? 0.5 : 0,
                  duration: const Duration(milliseconds: 180),
                  child: const Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink2),
                ),
                const SizedBox(width: 8),
                Text('ADDITIONAL FIELDS', style: AppText.overline.copyWith(color: AppColors.ink2)),
                const Spacer(),
                Flexible(child: Text(_moreSummary(), maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption.copyWith(fontSize: 12))),
              ],
            ),
          ),
        ),
        if (_moreOpen)
          KCard(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                WebInput(label: 'PO number', controller: _po, placeholder: 'Optional'),
                const SizedBox(height: AppSpace.md),
                WebInput(label: 'Reference number', controller: _reference, placeholder: 'Optional'),
                const SizedBox(height: AppSpace.md),
                Text('Notes / terms', style: AppText.label),
                const SizedBox(height: AppSpace.sm),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final (label, text) in _notePresets)
                      KChip(label: label, selected: _notes.text == text, onTap: () => setState(() => _notes.text = text)),
                  ],
                ),
                const SizedBox(height: AppSpace.sm),
                TextField(
                  controller: _notes,
                  minLines: 2,
                  maxLines: 5,
                  onChanged: (_) => setState(() {}),
                  style: AppText.body,
                  decoration: _fieldDecoration('Add notes or terms'),
                ),
                const SizedBox(height: AppSpace.md),
                Text('Terms & conditions', style: AppText.label),
                const SizedBox(height: AppSpace.sm),
                TextField(
                  controller: _terms,
                  minLines: 2,
                  maxLines: 5,
                  style: AppText.body,
                  decoration: _fieldDecoration('Goods once sold…'),
                ),
              ],
            ),
          ),
      ],
    );
  }

  String _moreSummary() {
    final parts = [
      if (_notes.text.trim().isNotEmpty) 'Notes added',
      if (_po.text.trim().isNotEmpty) 'PO ${_po.text.trim()}',
      if (_reference.text.trim().isNotEmpty) 'Ref ${_reference.text.trim()}',
    ];
    return parts.join(' · ');
  }

  Future<void> _recordPayment(double grand) async {
    final saved = await showInvoicePaymentSheet(context, grandTotal: grand, payments: _payments);
    if (saved == null || !mounted) return;
    setState(() {
      _payments
        ..clear()
        ..addAll(saved);
    });
  }

  Widget _payLine(String label, String value, Color color) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Expanded(child: Text(label, style: AppText.caption)),
          Text(value, style: AppText.bodyStrong.copyWith(color: color)),
        ],
      ),
    );
  }

  Widget _totalBar(({double taxable, double tax, double cgst, double sgst, double igst, double discount, double roundOff, double grand, bool intraState}) preview) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.hairline)),
      ),
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 10, AppSpace.gutter, 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  preview.tax > 0 ? 'Total · GST ${formatAmount(preview.tax)}' : 'Total',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.caption.copyWith(fontSize: 12),
                ),
                KAmount(preview.grand, maxFraction: 2, style: AppText.amount.copyWith(fontSize: 22, height: 28 / 22)),
              ],
            ),
          ),
          if (_isNew) ...[
            KIconTile(icon: LucideIcons.save, label: 'Save draft', onTap: _saving ? () {} : () => _save('draft')),
            const SizedBox(width: 10),
          ],
          KButton(
            label: _isNew ? 'Save bill' : (_loadedStatus == 'draft' ? 'Finalize' : 'Update'),
            icon: LucideIcons.check,
            expand: false,
            loading: _saving,
            onPressed: () => _save('final'),
          ),
        ],
      ),
    );
  }
}

/// Bill money: whole rupees stay whole, anything with paise shows two places (`₹199.50`).
String formatAmount(num v) {
  final text = enIn(v, maxFraction: 2);
  final dot = text.indexOf('.');
  return '$rupeeSign${dot != -1 && text.length - dot == 2 ? '${text}0' : text}';
}

InputDecoration _fieldDecoration(String hint) => InputDecoration(
      hintText: hint,
      hintStyle: AppText.body.copyWith(color: AppColors.ink3),
      filled: true,
      fillColor: AppColors.surface,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide: const BorderSide(color: AppColors.hairline, width: 1.5),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide: BorderSide(color: AppColors.brand, width: 2),
      ),
    );

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(2, 0, 2, 8),
        child: Text(text.toUpperCase(), style: AppText.overline.copyWith(color: AppColors.ink2)),
      );
}

class _EditPill extends StatelessWidget {
  const _EditPill({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Edit bill details',
      excludeSemantics: true,
      child: Material(
        color: AppColors.brandSoft,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(LucideIcons.pencil, size: 14, color: AppColors.brand),
                const SizedBox(width: 6),
                Text('EDIT', style: AppText.small.copyWith(color: AppColors.brand, letterSpacing: 0.6)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Looks like a search box until a party is chosen, then shows the party.
class _PartyField extends StatelessWidget {
  const _PartyField({required this.name, required this.detail, required this.onTap, this.onClear});

  final String? name;
  final String detail;
  final VoidCallback onTap;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final chosen = name != null;
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Container(
          constraints: const BoxConstraints(minHeight: 56),
          padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: AppColors.hairline, width: 1.5),
          ),
          child: Row(
            children: [
              chosen ? KAvatar(name: name!, size: 36) : const Icon(LucideIcons.userRound, size: 20, color: AppColors.ink3),
              const SizedBox(width: 12),
              Expanded(
                child: chosen
                    ? Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(name!, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong),
                          if (detail.isNotEmpty) Text(detail, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption.copyWith(fontSize: 12)),
                        ],
                      )
                    : Text('Search / add party  ·  or cash sale', style: AppText.body.copyWith(color: AppColors.ink3)),
              ),
              if (onClear != null)
                KIconButton(icon: LucideIcons.x, tooltip: 'Make it a cash sale', color: AppColors.ink3, onTap: onClear!)
              else
                const Padding(padding: EdgeInsets.all(10), child: Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink3)),
            ],
          ),
        ),
      ),
    );
  }
}

class _AddItemsButton extends StatelessWidget {
  const _AddItemsButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.brandSoft,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: SizedBox(
          height: 56,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(LucideIcons.plus, size: 20, color: AppColors.brand),
              const SizedBox(width: 8),
              Text('Add items', style: AppText.bodyStrong.copyWith(color: AppColors.brand)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Square "Scan" next to "Add items": camera, scanner gun or typed barcode.
class _ScanButton extends StatelessWidget {
  const _ScanButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      button: true,
      label: 'Scan barcode',
      child: Material(
        color: AppColors.brandSoft,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.md),
          child: SizedBox(
            width: 72,
            height: 56,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(LucideIcons.scanBarcode, size: 20, color: AppColors.brand),
                const SizedBox(height: 2),
                Text('Scan', style: AppText.small.copyWith(color: AppColors.brand)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Last row of the items card: the total, with the tax breakup and round-off one tap away.
class _TotalRow extends StatelessWidget {
  const _TotalRow({required this.preview, this.charges = 0, required this.open, required this.roundOff, required this.onToggle, required this.onRoundOff});

  final double charges;

  final ({double taxable, double tax, double cgst, double sgst, double igst, double discount, double roundOff, double grand, bool intraState}) preview;
  final bool open;
  final bool roundOff;
  final VoidCallback onToggle;
  final ValueChanged<bool> onRoundOff;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFFFBFAF7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Total', style: AppText.bodyStrong.copyWith(fontSize: 16)),
                        Row(
                          children: [
                            Text(
                              preview.tax > 0 ? 'incl. GST ${formatAmount(preview.tax)}  ·  ' : '',
                              style: AppText.caption.copyWith(fontSize: 12),
                            ),
                            Text(open ? 'Hide breakup' : 'View breakup', style: AppText.small.copyWith(color: AppColors.brand)),
                          ],
                        ),
                      ],
                    ),
                  ),
                  Text(formatAmount(preview.grand), style: AppText.heading.copyWith(fontFeatures: AppText.tabular)),
                ],
              ),
            ),
          ),
          if (open)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 8, 10),
              child: Column(
                children: [
                  _SumRow('Taxable value', preview.taxable),
                  if (preview.discount > 0) _SumRow('Discount given', preview.discount, note: true),
                  if (preview.intraState) ...[
                    _SumRow('CGST', preview.cgst),
                    _SumRow('SGST', preview.sgst),
                  ] else
                    _SumRow('IGST', preview.igst),
                  if (charges > 0) _SumRow('Additional charges', charges),
                  Row(
                    children: [
                      Expanded(child: Text('Round off', style: AppText.caption.copyWith(color: AppColors.ink2))),
                      if (preview.roundOff.abs() > 0.001)
                        Text(formatAmount(preview.roundOff), style: AppText.label.copyWith(color: AppColors.ink, fontFeatures: AppText.tabular)),
                      Switch.adaptive(value: roundOff, onChanged: onRoundOff, activeTrackColor: AppColors.brand, activeThumbColor: AppColors.onBrand),
                    ],
                  ),
                  Padding(
                    padding: const EdgeInsets.only(right: 6, top: 2),
                    child: Text('Offers are applied when the bill is saved.', style: AppText.caption.copyWith(fontSize: 11)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Tappable label / value row inside the bill details sheet.
class _SheetField extends StatelessWidget {
  const _SheetField({required this.icon, required this.label, required this.value, required this.onTap, this.caption});

  final IconData icon;
  final String label;
  final String value;
  final String? caption;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.sunken,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
          child: Row(
            children: [
              Icon(icon, size: 18, color: AppColors.ink2),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: AppText.label.copyWith(fontSize: 12)),
                    Text(value, style: AppText.bodyStrong),
                    if (caption != null) Text(caption!, style: AppText.caption.copyWith(fontSize: 12)),
                  ],
                ),
              ),
              const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
            ],
          ),
        ),
      ),
    );
  }
}

class _SwitchRow extends StatelessWidget {
  const _SwitchRow({required this.title, required this.subtitle, required this.value, required this.onChanged});

  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return KListRow(
      onTap: () => onChanged(!value),
      title: title,
      subtitle: subtitle,
      trailing: Switch.adaptive(
        value: value,
        onChanged: onChanged,
        activeTrackColor: AppColors.brand,
        activeThumbColor: AppColors.onBrand,
      ),
    );
  }
}

class _SumRow extends StatelessWidget {
  const _SumRow(this.label, this.value, {this.note = false});

  final String label;
  final double value;

  /// Shown for information; already inside the taxable value.
  final bool note;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(label, style: AppText.caption.copyWith(color: AppColors.ink2))),
          Text(
            note ? '- ${formatAmount(value)}' : formatAmount(value),
            style: AppText.label.copyWith(color: note ? AppColors.positive : AppColors.ink, fontFeatures: AppText.tabular),
          ),
        ],
      ),
    );
  }
}

/// One bill line: name and total on top, rate details and a quantity stepper below.
class _LineRow extends StatelessWidget {
  const _LineRow({required this.line, required this.preview, required this.onTap, required this.onMinus, required this.onPlus});

  final InvoiceLineDraft line;
  final LineGst preview;
  final VoidCallback onTap;
  final VoidCallback onMinus;
  final VoidCallback onPlus;

  @override
  Widget build(BuildContext context) {
    final details = [
      '${formatAmount(line.unitPrice)} / ${line.unit}',
      'GST ${enIn(line.taxRate)}%',
      if (line.discountPercent > 0) '${enIn(line.discountPercent)}% off',
    ].join(' · ');
    return InkWell(
      onTap: onTap,
      highlightColor: AppColors.sunken,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: Text(line.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong)),
                const SizedBox(width: 12),
                Text(formatAmount(preview.total), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(child: Text(details, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption)),
                const SizedBox(width: 8),
                _QtyStepper(quantity: line.quantity, unit: line.unit, onMinus: onMinus, onPlus: onPlus),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _QtyStepper extends StatelessWidget {
  const _QtyStepper({required this.quantity, required this.unit, required this.onMinus, required this.onPlus});

  final double quantity;
  final String unit;
  final VoidCallback onMinus;
  final VoidCallback onPlus;

  Widget _button(IconData icon, String label, VoidCallback onTap) => Semantics(
        button: true,
        label: label,
        excludeSemantics: true,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: SizedBox(width: 36, height: 36, child: Icon(icon, size: 16, color: AppColors.ink)),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(AppRadius.sm)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _button(quantity <= 1 ? LucideIcons.trash2 : LucideIcons.minus, quantity <= 1 ? 'Remove' : 'Less', onMinus),
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 28),
            child: Text(enIn(quantity), textAlign: TextAlign.center, style: AppText.bodyStrong.copyWith(fontSize: 14, fontFeatures: AppText.tabular)),
          ),
          _button(LucideIcons.plus, 'More', onPlus),
        ],
      ),
    );
  }
}

/// Edit one line: quantity, price, discount, GST rate, HSN. Pops `(line, removed)`.
class _LineEditor extends StatefulWidget {
  const _LineEditor({required this.line});

  final InvoiceLineDraft line;

  @override
  State<_LineEditor> createState() => _LineEditorState();
}

class _LineEditorState extends State<_LineEditor> {
  late final _qty = TextEditingController(text: jsNumberString(widget.line.quantity));
  late final _price = TextEditingController(text: jsNumberString(widget.line.unitPrice));
  late final _discount = TextEditingController(text: widget.line.discountPercent == 0 ? '' : jsNumberString(widget.line.discountPercent));
  late final _hsn = TextEditingController(text: widget.line.hsn ?? '');
  late double _tax = widget.line.taxRate;

  @override
  void dispose() {
    _qty.dispose();
    _price.dispose();
    _discount.dispose();
    _hsn.dispose();
    super.dispose();
  }

  void _apply() {
    final qty = double.tryParse(_qty.text.trim());
    final price = double.tryParse(_price.text.trim());
    final discount = _discount.text.trim().isEmpty ? 0.0 : double.tryParse(_discount.text.trim());
    final problem = qty == null || qty <= 0
        ? 'Quantity must be greater than zero'
        : price == null || price < 0
            ? 'Enter a valid price'
            : discount == null || discount < 0 || discount > 100
                ? 'Discount must be between 0 and 100%'
                : null;
    if (problem != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem)));
      return;
    }
    final l = widget.line;
    Navigator.of(context).pop((
      InvoiceLineDraft(
        itemId: l.itemId,
        variantId: l.variantId,
        name: l.name,
        quantity: qty!,
        unitPrice: price!,
        unit: l.unit,
        discountPercent: discount!,
        taxRate: _tax,
        hsn: _hsn.text.trim().isEmpty ? null : _hsn.text.trim(),
      ),
      false,
    ));
  }

  @override
  Widget build(BuildContext context) {
    const decimal = TextInputType.numberWithOptions(decimal: true);
    final rates = {..._gstRates, _tax}.toList()..sort();
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: WebInput(label: 'Quantity (${widget.line.unit})', controller: _qty, keyboardType: decimal, autofocus: true)),
              const SizedBox(width: AppSpace.md),
              Expanded(child: WebInput(label: 'Price ($rupeeSign)', controller: _price, keyboardType: decimal)),
            ],
          ),
          const SizedBox(height: AppSpace.md),
          Row(
            children: [
              Expanded(child: WebInput(label: 'Discount %', controller: _discount, placeholder: '0', keyboardType: decimal)),
              const SizedBox(width: AppSpace.md),
              Expanded(child: WebInput(label: 'HSN / SAC', controller: _hsn, placeholder: 'Optional')),
            ],
          ),
          const SizedBox(height: AppSpace.md),
          Text('GST rate', style: AppText.label),
          const SizedBox(height: AppSpace.sm),
          KChipBar<double>(
            value: _tax,
            padding: EdgeInsets.zero,
            options: [for (final r in rates) (r, '${enIn(r)}%')],
            onChanged: (r) => setState(() => _tax = r),
          ),
          const SizedBox(height: AppSpace.xl),
          Row(
            children: [
              KButton(
                label: 'Remove',
                icon: LucideIcons.trash2,
                kind: KButtonKind.ghost,
                expand: false,
                onPressed: () => Navigator.of(context).pop((null, true)),
              ),
              const SizedBox(width: AppSpace.md),
              Expanded(child: KButton(label: 'Update line', onPressed: _apply)),
            ],
          ),
        ],
      ),
    );
  }
}

/// Searchable list in a bottom sheet. Loads on open and as the user types.
class _PickerSheet extends StatefulWidget {
  const _PickerSheet({
    required this.title,
    required this.hint,
    required this.load,
    required this.row,
    this.header,
    this.footer,
    this.bottom,
    this.tall = false,
  });

  final String title;
  final String hint;
  final Future<List<Map<String, dynamic>>> Function(String query) load;
  final Widget Function(BuildContext context, Map<String, dynamic> row, int index) row;
  final WidgetBuilder? header;
  final WidgetBuilder? footer;
  final WidgetBuilder? bottom;
  final bool tall;

  @override
  State<_PickerSheet> createState() => _PickerSheetState();
}

class _PickerSheetState extends State<_PickerSheet> {
  final _query = TextEditingController();
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;
  Timer? _debounce;
  int _request = 0;

  @override
  void initState() {
    super.initState();
    _run();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  Future<void> _run() async {
    final request = ++_request;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await widget.load(_query.text.trim());
      if (mounted && request == _request) setState(() => _rows = rows);
    } on ApiException catch (e) {
      if (mounted && request == _request) setState(() => _error = e.message);
    } catch (_) {
      if (mounted && request == _request) setState(() => _error = 'Could not load. Check the connection.');
    } finally {
      if (mounted && request == _request) setState(() => _loading = false);
    }
  }

  void _onChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), _run);
  }

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.sizeOf(context).height * (widget.tall ? 0.9 : 0.8);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: height,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 8, bottom: 4),
                width: 36,
                height: 4,
                decoration: BoxDecoration(color: AppColors.hairline, borderRadius: BorderRadius.circular(4)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 8, 4),
              child: Row(
                children: [
                  Expanded(child: Text(widget.title, style: AppText.heading)),
                  KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.of(context).pop()),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 4, AppSpace.gutter, AppSpace.sm),
              child: KSearchField(controller: _query, hint: widget.hint, onChanged: _onChanged),
            ),
            if (_loading) LinearProgressIndicator(minHeight: 2, color: AppColors.brand, backgroundColor: Colors.transparent) else const SizedBox(height: 2),
            Expanded(
              child: ListView(
                children: [
                  if (widget.header != null) widget.header!(context),
                  if (_error != null)
                    KEmptyState(icon: LucideIcons.cloudOff, title: _error!, action: KButton.secondary(label: 'Try again', expand: false, onPressed: _run))
                  else if (!_loading && _rows.isEmpty)
                    KEmptyState(
                      icon: LucideIcons.searchX,
                      title: _query.text.trim().isEmpty ? 'Nothing here yet' : 'No match for "${_query.text.trim()}"',
                    )
                  else
                    for (final (i, row) in _rows.indexed) widget.row(context, row, i),
                  if (widget.footer != null) widget.footer!(context),
                ],
              ),
            ),
            if (widget.bottom != null)
              Container(
                decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.hairline))),
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, AppSpace.md),
                child: widget.bottom!(context),
              ),
          ],
        ),
      ),
    );
  }
}
