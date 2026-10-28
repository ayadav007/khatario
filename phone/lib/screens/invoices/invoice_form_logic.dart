import '../parties/customer_form_logic.dart';

double invoiceRound2(double n) => ((n + 1e-10) * 100).round() / 100;

/// `computeLineGst` in `lib/invoices/line-gst.ts`.
class LineGst {
  const LineGst({
    required this.discount,
    required this.taxable,
    required this.cgst,
    required this.sgst,
    required this.igst,
    required this.tax,
    required this.total,
  });

  final double discount;
  final double taxable;
  final double cgst;
  final double sgst;
  final double igst;
  final double tax;
  final double total;
}

LineGst computeLineGst({
  required double quantity,
  required double unitPrice,
  double discountPercent = 0,
  double taxRate = 0,
  required bool intraState,
  bool pricesIncludeGst = false,
  bool zeroRated = false,
}) {
  final itemSubtotal = quantity * unitPrice;
  final rate = zeroRated ? 0.0 : taxRate;
  if (pricesIncludeGst) {
    final grossDiscount = invoiceRound2((itemSubtotal * discountPercent) / 100);
    final gross = invoiceRound2(itemSubtotal - grossDiscount);
    final taxable = invoiceRound2((gross * 100) / (100 + rate));
    final tax = invoiceRound2(gross - taxable);
    final cgst = intraState ? invoiceRound2(tax / 2) : 0.0;
    final sgst = intraState ? invoiceRound2(tax - cgst) : 0.0;
    final igst = intraState ? 0.0 : tax;
    return LineGst(discount: invoiceRound2((grossDiscount * 100) / (100 + rate)), taxable: taxable, cgst: cgst, sgst: sgst, igst: igst, tax: tax, total: gross);
  }
  final discount = invoiceRound2((itemSubtotal * discountPercent) / 100);
  final taxable = invoiceRound2(itemSubtotal - discount);
  final cgst = intraState ? invoiceRound2((taxable * rate) / 200) : 0.0;
  final sgst = intraState ? invoiceRound2((taxable * rate) / 200) : 0.0;
  final igst = intraState ? 0.0 : invoiceRound2((taxable * rate) / 100);
  final tax = invoiceRound2(cgst + sgst + igst);
  return LineGst(discount: discount, taxable: taxable, cgst: cgst, sgst: sgst, igst: igst, tax: tax, total: invoiceRound2(taxable + tax));
}

/// Same place-of-supply fallback as `checkInvoiceCompliance` for a domestic bill.
String? invoicePlaceOfSupply({String? gstin, String? customerState, String? customerStateCode, String? supplierStateCode}) {
  final cleanGstin = gstin?.replaceAll(RegExp(r'\s+'), '').toUpperCase();
  if (cleanGstin != null && isValidGstin(cleanGstin)) return cleanGstin.substring(0, 2);
  final fromCode = customerStateCode?.trim() ?? '';
  if (fromCode.isNotEmpty) return fromCode.padLeft(2, '0');
  final fromName = stateCode(customerState ?? '');
  if (fromName.isNotEmpty) return fromName;
  final supplier = supplierStateCode?.trim() ?? '';
  if (supplier.isNotEmpty) return supplier.padLeft(2, '0');
  return null;
}

/// Server treats the supply as intra-state only when both codes are known and equal.
bool invoiceIntraState(String? placeOfSupply, String? supplierStateCode) {
  final supplier = supplierStateCode?.trim() ?? '';
  if (placeOfSupply == null || placeOfSupply.isEmpty || supplier.isEmpty) return false;
  return placeOfSupply == supplier.padLeft(2, '0');
}

class InvoiceLineDraft {
  const InvoiceLineDraft({
    this.itemId,
    required this.name,
    required this.quantity,
    required this.unitPrice,
    this.unit = 'PCS',
    this.discountPercent = 0,
    this.taxRate = 0,
    this.hsn,
    this.variantId,
  });

  final String? itemId;
  final String name;
  final double quantity;
  final double unitPrice;
  final String unit;
  final double discountPercent;
  final double taxRate;
  final String? hsn;

  /// The size / colour variant, when the line came from a variant (for example a scanned barcode).
  final String? variantId;

  InvoiceLineDraft copyWith({double? quantity, double? unitPrice, double? discountPercent, String? unit}) => InvoiceLineDraft(
        itemId: itemId,
        name: name,
        quantity: quantity ?? this.quantity,
        unitPrice: unitPrice ?? this.unitPrice,
        unit: unit ?? this.unit,
        discountPercent: discountPercent ?? this.discountPercent,
        taxRate: taxRate,
        hsn: hsn,
        variantId: variantId,
      );
}

/// A unit a line can be sold in: the item's own unit (factor 1) or an alternate such as
/// BOX = 12 PCS. The server works out the factor again when the bill is saved.
class SaleUnitOption {
  const SaleUnitOption({required this.unit, required this.factor, this.sellingPrice});

  final String unit;

  /// Base units in one of this unit.
  final double factor;

  /// The unit's own selling price (the item's price for its own unit), if it has one.
  final double? sellingPrice;
}

/// The units of `itemId` from `GET /api/items/units?ids=…`: own unit first, then alternates.
List<SaleUnitOption> saleUnitsFromJson(Map<String, dynamic> body, String itemId) {
  final items = body['items'];
  final item = items is Map ? items[itemId] : null;
  if (item is! Map) return const [];
  final own = SaleUnitOption(
    unit: item['unit']?.toString() ?? 'PCS',
    factor: 1,
    sellingPrice: item['selling_price'] == null ? null : _asDouble(item['selling_price']),
  );
  final alts = item['units'] is List ? item['units'] as List : const [];
  return [
    own,
    for (final u in alts.whereType<Map>())
      SaleUnitOption(
        unit: u['unit']?.toString() ?? '',
        factor: _asDouble(u['factor_to_base']) > 0 ? _asDouble(u['factor_to_base']) : 1,
        sellingPrice: u['selling_price'] == null ? null : _asDouble(u['selling_price']),
      ),
  ];
}

double saleUnitFactor(List<SaleUnitOption> units, String unit) {
  for (final u in units) {
    if (u.unit.toUpperCase() == unit.toUpperCase()) return u.factor;
  }
  return 1;
}

/// The line moved to `unit`: a box's own price if it has one, else the item's price × factor
/// (a variant line, whose price is the variant's, scales by the change in factor).
InvoiceLineDraft lineInSaleUnit(InvoiceLineDraft line, List<SaleUnitOption> units, String unit) {
  SaleUnitOption? to;
  for (final u in units) {
    if (u.unit.toUpperCase() == unit.toUpperCase()) to = u;
  }
  if (to == null || units.isEmpty) return line;
  final from = saleUnitFactor(units, line.unit);
  final base = units.first.sellingPrice;
  final double price;
  if (to.factor != 1 && to.sellingPrice != null) {
    price = to.sellingPrice!;
  } else if (line.variantId == null && base != null) {
    price = base * to.factor;
  } else {
    price = line.unitPrice / from * to.factor;
  }
  return line.copyWith(unit: to.unit, unitPrice: invoiceRound2(price));
}

/// "= 60 PCS" under a line sold in boxes; null for a line in the item's own unit.
String? baseQtyNote(InvoiceLineDraft line, List<SaleUnitOption> units) {
  final f = saleUnitFactor(units, line.unit);
  if (f == 1 || units.isEmpty) return null;
  final q = (line.quantity * f * 1000).round() / 1000;
  final shown = q == q.roundToDouble() ? q.toInt().toString() : q.toString();
  return '= $shown ${units.first.unit}';
}

/// A charge added on top of the items (delivery, packing, freight…). Like the website, the bill
/// stores their total as `additional_charges`; it is added after tax.
class ExtraCharge {
  const ExtraCharge({required this.purpose, required this.amount});

  final String purpose;
  final double amount;
}

/// One row from the website's Record Payment sheet (`InvoicePaymentModal`).
class RecordedPayment {
  const RecordedPayment({required this.amount, required this.mode, required this.date, this.reference});

  final double amount;
  final String mode;
  final String date;
  final String? reference;

  Map<String, dynamic> toJson() => {
        'amount': amount,
        'mode': mode,
        'date': date,
        if (reference != null && reference!.trim().isNotEmpty) 'reference': reference!.trim(),
      };
}

class InvoiceDraft {
  const InvoiceDraft({
    this.invoiceId,
    this.customerId,
    required this.invoiceDate,
    required this.status,
    this.documentType = 'tax_invoice',
    required this.lines,
    this.notes,
    this.terms,
    this.placeOfSupply,
    this.pricesIncludeGst = false,
    this.paymentAmount = 0,
    this.paymentMode = 'cash',
    this.payments = const [],
    this.dueDate,
    this.enableRoundOff = false,
    this.purchaseOrderNumber,
    this.referenceNumber,
    this.additionalCharges = 0,
  });

  final String? invoiceId;
  final String? customerId;
  final String invoiceDate;
  final String status;
  final String documentType;
  final List<InvoiceLineDraft> lines;
  final String? notes;

  /// Terms & conditions printed under the totals (default from Settings › Invoice defaults).
  final String? terms;
  final String? placeOfSupply;
  final bool pricesIncludeGst;
  final double paymentAmount;
  final String paymentMode;

  /// Rows from Record Payment. When empty, [paymentAmount] and [paymentMode] are used.
  final List<RecordedPayment> payments;

  /// `yyyy-MM-dd`, optional.
  final String? dueDate;
  final bool enableRoundOff;
  final String? purchaseOrderNumber;
  final String? referenceNumber;

  /// Total of the extra charges (delivery, packing…), added after tax.
  final double additionalCharges;
}

/// Preview using the server's line formula: items, tax, then additional charges (as
/// `app/api/invoices/route.ts` computes the grand total). Offers are applied on the server.
/// With round-off on, the grand total is rounded to the rupee like the website composer.
({double taxable, double tax, double cgst, double sgst, double igst, double discount, double roundOff, double grand, bool intraState})
    previewInvoice(InvoiceDraft draft, {String? supplierStateCode}) {
  final intra = invoiceIntraState(draft.placeOfSupply, supplierStateCode);
  var taxable = 0.0;
  var cgst = 0.0;
  var sgst = 0.0;
  var igst = 0.0;
  var discount = 0.0;
  for (final line in draft.lines) {
    final gst = computeLineGst(
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
      taxRate: line.taxRate,
      intraState: intra,
      pricesIncludeGst: draft.pricesIncludeGst,
    );
    taxable += gst.taxable;
    cgst += gst.cgst;
    sgst += gst.sgst;
    igst += gst.igst;
    discount += gst.discount;
  }
  taxable = invoiceRound2(taxable);
  cgst = invoiceRound2(cgst);
  sgst = invoiceRound2(sgst);
  igst = invoiceRound2(igst);
  final tax = invoiceRound2(cgst + sgst + igst);
  final exact = invoiceRound2(taxable + tax + draft.additionalCharges);
  final grand = draft.enableRoundOff ? exact.roundToDouble() : exact;
  return (
    taxable: taxable,
    tax: tax,
    cgst: cgst,
    sgst: sgst,
    igst: igst,
    discount: invoiceRound2(discount),
    roundOff: invoiceRound2(grand - exact),
    grand: grand,
    intraState: intra,
  );
}

/// POST `/api/invoices`. Identity fields are omitted; the session owns them.
Map<String, dynamic> invoiceCreateBody(InvoiceDraft draft) {
  final body = <String, dynamic>{
    if (draft.invoiceId != null) 'id': draft.invoiceId,
    'customer_id': (draft.customerId == null || draft.customerId!.isEmpty) ? null : draft.customerId,
    'invoice_date': draft.invoiceDate,
    'status': draft.status,
    'document_type': draft.documentType,
    'place_of_supply_state_code': draft.placeOfSupply,
    'prices_include_gst': draft.pricesIncludeGst,
    'notes': _blankToNull(draft.notes),
    'terms': _blankToNull(draft.terms),
    'due_date': _blankToNull(draft.dueDate),
    'enable_round_off': draft.enableRoundOff,
    'purchase_order_number': _blankToNull(draft.purchaseOrderNumber),
    'reference_number': _blankToNull(draft.referenceNumber),
    'additional_charges': invoiceRound2(draft.additionalCharges),
    'items': [
      for (final line in draft.lines)
        {
          'item_id': line.itemId,
          if (line.variantId != null) 'variant_id': line.variantId,
          'item_name': line.name,
          'quantity': line.quantity,
          'unit': line.unit,
          'unit_price': line.unitPrice,
          'discount_percent': line.discountPercent,
          'tax_rate': line.taxRate,
          'hsn_sac': (line.hsn == null || line.hsn!.trim().isEmpty) ? null : line.hsn!.trim(),
        },
    ],
  };
  final recorded = draft.payments.where((p) => p.amount > 0).toList();
  if (draft.documentType == 'tax_invoice' && draft.status == 'final' && (recorded.isNotEmpty || draft.paymentAmount > 0)) {
    body['payments'] = recorded.isNotEmpty
        ? [for (final p in recorded) p.toJson()]
        : [
            {'amount': draft.paymentAmount, 'mode': draft.paymentMode, 'date': draft.invoiceDate},
          ];
  }
  return body;
}

double _asDouble(dynamic v) {
  if (v is num) return v.toDouble();
  return double.tryParse(v?.toString() ?? '') ?? 0;
}

String _ymdFromServer(dynamic v) {
  final raw = v?.toString() ?? '';
  return raw.length >= 10 ? raw.substring(0, 10) : raw;
}

/// Rebuilds a draft from `GET /api/invoices/:id` so finalizing can post the same bill with a payment.
InvoiceDraft invoiceDraftFromRecord(
  Map<String, dynamic> invoice, {
  required String status,
  List<RecordedPayment> payments = const [],
}) {
  final rawLines = invoice['items'];
  final lines = rawLines is List
      ? rawLines.whereType<Map>().map((row) {
          final e = Map<String, dynamic>.from(row);
          return InvoiceLineDraft(
            itemId: e['item_id']?.toString(),
            name: e['item_name']?.toString() ?? '',
            quantity: _asDouble(e['quantity']),
            unitPrice: _asDouble(e['unit_price']),
            unit: e['unit']?.toString() ?? 'PCS',
            discountPercent: _asDouble(e['discount_percent']),
            taxRate: _asDouble(e['tax_rate']),
            hsn: e['hsn_sac']?.toString(),
            variantId: e['variant_id']?.toString(),
          );
        }).toList()
      : <InvoiceLineDraft>[];
  final customerId = invoice['customer_id']?.toString();
  return InvoiceDraft(
    invoiceId: invoice['id']?.toString(),
    customerId: (customerId == null || customerId.isEmpty) ? null : customerId,
    invoiceDate: _ymdFromServer(invoice['invoice_date']),
    dueDate: _ymdFromServer(invoice['due_date']).isEmpty ? null : _ymdFromServer(invoice['due_date']),
    status: status,
    documentType: invoice['document_type']?.toString() ?? 'tax_invoice',
    lines: lines,
    notes: invoice['notes']?.toString(),
    terms: invoice['terms']?.toString(),
    placeOfSupply: invoice['place_of_supply_state_code']?.toString(),
    pricesIncludeGst: invoice['prices_include_gst'] == true,
    enableRoundOff: invoice['enable_round_off'] == true,
    purchaseOrderNumber: invoice['purchase_order_number']?.toString(),
    referenceNumber: invoice['reference_number']?.toString(),
    additionalCharges: _asDouble(invoice['additional_charges']),
    payments: payments,
  );
}

String? _blankToNull(String? v) => (v == null || v.trim().isEmpty) ? null : v.trim();

String? validateInvoiceDraft(InvoiceDraft draft) {
  if (draft.lines.isEmpty) return 'Please add at least one item';
  for (final line in draft.lines) {
    if (line.name.trim().isEmpty) return 'Each line needs a name';
    if (line.quantity <= 0) return 'Quantity must be greater than zero';
    if (line.unitPrice < 0) return 'Price cannot be negative';
  }
  final due = draft.dueDate;
  if (due != null && due.isNotEmpty && due.compareTo(draft.invoiceDate) < 0) {
    return 'Due date cannot be before the invoice date';
  }
  if (draft.status != 'final' && draft.paymentAmount > 0) {
    return 'A payment can only be recorded on a final invoice';
  }
  return null;
}
