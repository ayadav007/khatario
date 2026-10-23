import 'dart:math';

/// Scan & Add Items rules, shared with the website's `lib/items/scan-add-form.ts`.
/// The server in `app/api/items/route.ts` stays the authority; these only catch what the
/// shopkeeper can fix before saving.

class ScanAddValues {
  const ScanAddValues({
    required this.barcode,
    required this.name,
    this.brand = '',
    this.size = '',
    this.unit = 'PCS',
    this.mrp = '',
    this.sellingPrice = '',
    this.purchasePrice = '',
    this.taxRate = '0',
    this.hsn = '',
    this.openingStock = '',
  });

  final String barcode;
  final String name;
  final String brand;

  /// Pack size as printed, e.g. "100 g". Saved as items.net_quantity.
  final String size;
  final String unit;
  final String mrp;
  final String sellingPrice;
  final String purchasePrice;
  final String taxRate;
  final String hsn;
  final String openingStock;
}

num? _num(String v) => v.trim().isEmpty ? null : num.tryParse(v.trim());

/// Field name → message. Empty when the form can be saved.
Map<String, String> validateScanAdd(ScanAddValues v) {
  final errors = <String, String>{};
  if (v.name.trim().isEmpty) errors['name'] = 'Enter the product name';

  final fields = {'mrp': v.mrp, 'selling_price': v.sellingPrice, 'purchase_price': v.purchasePrice, 'opening_stock': v.openingStock};
  fields.forEach((key, raw) {
    if (raw.trim().isEmpty) return;
    final n = _num(raw);
    if (n == null || n < 0) errors[key] = 'Enter a number, 0 or more';
  });

  final qty = _num(v.openingStock) ?? 0;
  final cost = _num(v.purchasePrice);
  // Opening stock is valued at purchase price in the ledger, so stock without a cost is refused.
  if (qty > 0 && !errors.containsKey('purchase_price') && (cost == null || cost <= 0)) {
    errors['purchase_price'] = 'Enter the purchase price for the stock you have';
  }

  final mrp = _num(v.mrp);
  final sell = _num(v.sellingPrice);
  if (mrp != null && sell != null && !errors.containsKey('mrp') && !errors.containsKey('selling_price') && sell > mrp) {
    errors['selling_price'] = 'Selling price is more than MRP';
  }

  final hsn = v.hsn.replaceAll(RegExp(r'\s'), '');
  if (hsn.isNotEmpty && !RegExp(r'^\d{4,8}$').hasMatch(hsn)) errors['hsn_sac'] = 'HSN must be 4 to 8 digits';
  return errors;
}

/// Body for POST /api/items. Identity fields are omitted; the server takes them from the session.
Map<String, dynamic> scanAddItemBody(ScanAddValues v) {
  String? text(String s) => s.trim().isEmpty ? null : s.trim();
  final barcode = v.barcode.replaceAll(RegExp(r'\s+'), '');
  final hsn = v.hsn.replaceAll(RegExp(r'\s'), '');
  return <String, dynamic>{
    'name': v.name.trim(),
    if (barcode.isNotEmpty) 'barcode': barcode,
    if (text(v.brand) != null) 'brand': text(v.brand),
    if (text(v.size) != null) 'net_quantity': text(v.size),
    'unit': v.unit.isEmpty ? 'PCS' : v.unit,
    'item_type': 'goods',
    if (_num(v.mrp) != null) 'mrp': _num(v.mrp),
    'selling_price': _num(v.sellingPrice) ?? 0,
    'purchase_price': _num(v.purchasePrice) ?? 0,
    'tax_rate': _num(v.taxRate) ?? 0,
    if (hsn.isNotEmpty) 'hsn_sac': hsn,
    'opening_stock': _num(v.openingStock) ?? 0,
  };
}

/// A random key per product being added. A retried save reuses it, so the server
/// returns the item it already created instead of adding it twice.
String newScanAddKey() {
  final r = Random.secure();
  final hex = List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  return 'scan-add-$hex';
}
