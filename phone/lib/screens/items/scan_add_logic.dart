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
    this.batchNumber = '',
    this.manufacturingDate = '',
    this.expiryDate = '',
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

  /// Batch of the stock in hand, from the MRP/batch/expiry photo. Saved only with stock.
  final String batchNumber;

  /// YYYY-MM-DD or YYYY-MM, as the pack prints it.
  final String manufacturingDate;
  final String expiryDate;
}

final _dateRe = RegExp(r'^\d{4}-\d{2}(-\d{2})?$');

/// Same checks as `batchErrors` in lib/items/scan-add-form.ts.
Map<String, String> batchErrors(String manufacturingDate, String expiryDate) {
  final errors = <String, String>{};
  final mfg = manufacturingDate.trim();
  final exp = expiryDate.trim();
  if (mfg.isNotEmpty && !_dateRe.hasMatch(mfg)) errors['manufacturing_date'] = 'Use YYYY-MM-DD or YYYY-MM';
  if (exp.isNotEmpty && !_dateRe.hasMatch(exp)) errors['expiry_date'] = 'Use YYYY-MM-DD or YYYY-MM';
  if (errors.isEmpty && mfg.isNotEmpty && exp.isNotEmpty && exp.substring(0, 7).compareTo(mfg.substring(0, 7)) < 0) {
    errors['expiry_date'] = 'Expiry is before the manufacturing date';
  }
  return errors;
}

/// Batch body for the APIs; null when there is no stock or nothing was entered.
Map<String, dynamic>? batchBody(String quantity, String batchNumber, String manufacturingDate, String expiryDate) {
  if (!((_num(quantity) ?? 0) > 0)) return null;
  final b = batchNumber.trim(), m = manufacturingDate.trim(), e = expiryDate.trim();
  if (b.isEmpty && m.isEmpty && e.isEmpty) return null;
  return {if (b.isNotEmpty) 'batch_number': b, if (m.isNotEmpty) 'manufacturing_date': m, if (e.isNotEmpty) 'expiry_date': e};
}

/// "Harpic 500 ml" with size "500 ml" → "Harpic". Same as `nameWithoutSize` on the website.
String nameWithoutSize(String name, String? size) {
  final sz = (size ?? '').trim();
  if (sz.isEmpty) return name.trim();
  final pattern = RegExp.escape(sz).replaceAll(RegExp(r'\s+'), r'\s*');
  final stripped = name.replaceAll(RegExp('\\s*$pattern\\s*\$', caseSensitive: false), '').trim();
  return stripped.isEmpty ? name.trim() : stripped;
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
  return {...errors, ...batchErrors(v.manufacturingDate, v.expiryDate)};
}

/// Body for POST /api/items. Identity fields are omitted; the server takes them from the session.
Map<String, dynamic> scanAddItemBody(ScanAddValues v, {String? lookupSource}) {
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
    // Which database's suggestion was accepted. The server records the source from its own cache.
    if (lookupSource != null && lookupSource.isNotEmpty) 'lookup_source': lookupSource,
    'opening_batch': ?batchBody(v.openingStock, v.batchNumber, v.manufacturingDate, v.expiryDate),
  };
}

String _tidyName(String name) => name == name.toLowerCase() && name.isNotEmpty ? name[0].toUpperCase() + name.substring(1) : name;

/// "Harpic" + "500 ml" → "Harpic 500 ml", so two sizes of one product never share a name.
String nameWithSize(String name, String? size) {
  final n = _tidyName(name.trim());
  final sz = (size ?? '').trim();
  if (sz.isEmpty) return n;
  String squash(String v) => v.toLowerCase().replaceAll(RegExp(r'\s+'), '');
  return squash(n).contains(squash(sz)) ? n : '$n $sz';
}

/// Product details from a database suggestion or a label photo.
class ProductFacts {
  const ProductFacts({this.name, this.brand, this.quantity, this.mrp});

  final String? name;
  final String? brand;
  final String? quantity;
  final num? mrp;

  factory ProductFacts.fromSuggestion(Map<String, dynamic> s) =>
      ProductFacts(name: s['name']?.toString(), brand: s['brand']?.toString(), quantity: s['quantity']?.toString());

  factory ProductFacts.fromReading(Map<String, dynamic> r) =>
      ProductFacts(name: r['name']?.toString(), brand: r['brand']?.toString(), quantity: r['size']?.toString(), mrp: r['mrp'] is num ? r['mrp'] as num : null);
}

/// Same rules as `fillFromFacts` in lib/items/scan-add-form.ts: only empty fields are filled, and a
/// pack size the databases disagree on is left blank so a 300 ml product never becomes 200 ml.
({String name, String brand, String size, String mrp}) fillFromFacts(
  ({String name, String brand, String size, String mrp}) form,
  ProductFacts facts, {
  bool sizeInDoubt = false,
}) {
  String t(String? v) => (v ?? '').trim();
  final size = sizeInDoubt ? '' : t(facts.quantity);
  final nextSize = form.size.trim().isEmpty && size.isNotEmpty ? size : form.size;
  final brand = form.brand.trim().isEmpty && t(facts.brand).isNotEmpty ? t(facts.brand) : form.brand;
  var name = form.name;
  if (name.trim().isEmpty && t(facts.name).isNotEmpty) {
    name = nameWithSize(t(facts.name), nextSize);
  } else if (name.trim().isNotEmpty && size.isNotEmpty && form.size.trim().isEmpty) {
    name = nameWithSize(name, size);
  }
  final mrp = form.mrp.trim().isEmpty && facts.mrp != null && facts.mrp! > 0 ? '${facts.mrp}' : form.mrp;
  return (name: name, brand: brand, size: nextSize, mrp: mrp);
}

/// A random key per product being added. A retried save reuses it, so the server
/// returns the item it already created instead of adding it twice.
String newScanAddKey() {
  final r = Random.secure();
  final hex = List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  return 'scan-add-$hex';
}
