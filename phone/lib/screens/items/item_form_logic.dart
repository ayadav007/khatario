/// GST slabs from `lib/gst/rates.ts`, most used first. 28% is kept only for cess goods,
/// and the server refuses 12% as a new rate.
const itemGstRates = [
  ('0', '0%'),
  ('5', '5%'),
  ('18', '18%'),
  ('40', '40%'),
  ('28', '28% cess goods'),
  ('3', '3%'),
  ('1.5', '1.5%'),
  ('0.25', '0.25%'),
  ('0.1', '0.1%'),
];

/// `GST_UQC_CODES` from `lib/gst/uqc.ts`. Blank lets the server work it out from the unit and HSN.
const itemUqcCodes = [
  'BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN',
  'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS',
  'NA', 'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS',
  'TGM', 'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS',
];

/// The country select on the website's Retail label section. Blank is "Other / Not specified".
const itemCountries = [
  ('IN', 'India (IN)'),
  ('CN', 'China (CN)'),
  ('US', 'United States (US)'),
  ('GB', 'United Kingdom (GB)'),
  ('JP', 'Japan (JP)'),
  ('DE', 'Germany (DE)'),
  ('FR', 'France (FR)'),
  ('AE', 'UAE (AE)'),
  ('SG', 'Singapore (SG)'),
  ('BD', 'Bangladesh (BD)'),
  ('LK', 'Sri Lanka (LK)'),
  ('NP', 'Nepal (NP)'),
  ('', 'Other / Not specified'),
];

/// Digits only, at most 5, as the items routes store a PLU code.
String normalizePluCode(String code) {
  final digits = code.replaceAll(RegExp(r'\D'), '');
  return digits.length > 5 ? digits.substring(0, 5) : digits;
}

/// Simple goods/service create body for `app/(app)/items/new/page.tsx`.
/// Variants, bundles, and images stay on the website. Identity fields are omitted.
Map<String, dynamic> itemCreateBody({
  required String name,
  String code = '',
  String itemType = 'goods',
  String unit = 'PCS',
  String sellingPrice = '',
  String purchasePrice = '',
  String taxRate = '',
  String hsn = '',
  String openingStock = '',
  String minStock = '',
  String description = '',
  bool showInStore = false,
  bool featuredInStore = false,
  bool storeReturnable = true,
  String barcode = '',
  String categoryId = '',
  String brand = '',
  String mrp = '',
  String defaultSupplierId = '',
  String packSize = '',
  String packUnit = '',
  String imageUrl = '',
  bool gstIncluded = false,
  String uqc = '',
  String fssai = '',
  String netQuantity = '',
  String countryOfOrigin = 'IN',
  bool isWeighed = false,
  String pluCode = '',
  String weightBarcodeMode = 'weight',
}) {
  final service = itemType == 'service';
  final selling = num.tryParse(sellingPrice);
  final body = <String, dynamic>{
    'name': name.trim(),
    'code': code.trim().isEmpty ? null : code.trim(),
    'unit': unit,
    'item_type': itemType,
    'selling_price': service ? selling : (selling ?? 0),
    'purchase_price': num.tryParse(purchasePrice) ?? 0,
    'tax_rate': num.tryParse(taxRate) ?? 0,
    'hsn_sac': hsn.trim().isEmpty ? null : hsn.trim(),
    'opening_stock': service ? 0 : (num.tryParse(openingStock) ?? 0),
    'min_stock': service ? 0 : (num.tryParse(minStock) ?? 0),
    'description': description.trim().isEmpty ? null : description.trim(),
    'has_variants': false,
    'variants': const [],
    'allow_sale_when_out_of_stock': null,
    'gst_included': gstIncluded,
    'show_in_store': showInStore,
    'featured_in_store': featuredInStore,
    'store_returnable': storeReturnable,
    'country_of_origin': countryOfOrigin.trim().isEmpty ? null : countryOfOrigin.trim(),
  };
  // The new fields go in only when set.
  final cleanBarcode = normalizeItemBarcode(barcode);
  if (cleanBarcode.isNotEmpty) body['barcode'] = cleanBarcode;
  if (categoryId.isNotEmpty) body['category_id'] = categoryId;
  if (brand.trim().isNotEmpty) body['brand'] = brand.trim();
  final mrpValue = _positive(mrp);
  if (mrpValue != null) body['mrp'] = mrpValue;
  if (defaultSupplierId.isNotEmpty) body['default_supplier_id'] = defaultSupplierId;
  final size = int.tryParse(packSize.trim());
  if (size != null && packUnit.trim().isNotEmpty) {
    body['pack_size'] = size;
    body['pack_unit'] = packUnit.trim().toUpperCase();
  }
  if (imageUrl.isNotEmpty) body['image_url'] = imageUrl;
  // Blank UQC lets the server work it out from the unit and HSN.
  if (uqc.trim().isNotEmpty) body['uqc'] = uqc.trim();
  if (fssai.trim().isNotEmpty) body['fssai_licence_no'] = fssai.trim();
  if (netQuantity.trim().isNotEmpty) body['net_quantity'] = netQuantity.trim();
  if (!service && isWeighed) {
    body['is_weighed'] = true;
    final plu = normalizePluCode(pluCode);
    if (plu.isNotEmpty) body['plu_code'] = plu;
    body['weight_barcode_mode'] = weightBarcodeMode == 'price' ? 'price' : 'weight';
  }
  return body;
}

num? _positive(String text) {
  final n = num.tryParse(text.trim());
  return n != null && n > 0 ? n : null;
}

/// Spaces dropped, as `normalizeBarcode` in `lib/barcode-validator.ts`.
String normalizeItemBarcode(String code) => code.trim().replaceAll(RegExp(r'\s+'), '');

bool _checkDigitOk(String code, List<int> weights) {
  final digits = code.split('').map(int.parse).toList();
  var sum = 0;
  for (var i = 0; i < digits.length - 1; i++) {
    sum += digits[i] * weights[i % 2];
  }
  return (10 - (sum % 10)) % 10 == digits.last;
}

/// Same checks as `validateBarcode` in `lib/barcode-validator.ts`; null when fine.
/// Whether the code is already used by another item is the server's answer.
String? validateItemBarcode(String raw) {
  final code = normalizeItemBarcode(raw);
  if (code.isEmpty) return null;
  if (code.length < 3) return 'Barcode must be at least 3 characters';
  if (code.length > 50) return 'Barcode cannot exceed 50 characters';
  if (RegExp(r'^\d{13}$').hasMatch(code)) {
    return _checkDigitOk(code, const [1, 3]) ? null : 'Invalid EAN-13 check digit';
  }
  if (RegExp(r'^\d{12}$').hasMatch(code)) {
    return _checkDigitOk(code, const [3, 1]) ? null : 'Invalid UPC-A check digit';
  }
  return null;
}

/// Field name → message for the barcode, MRP and pack fields. Empty when they can be saved.
/// Pack rules are `normalizePack` in `lib/quantity-display.ts`.
Map<String, String> validateItemExtras({
  String barcode = '',
  String mrp = '',
  String packSize = '',
  String packUnit = '',
  String unit = 'PCS',
}) {
  final errors = <String, String>{};
  final barcodeError = validateItemBarcode(barcode);
  if (barcodeError != null) errors['barcode'] = barcodeError;
  if (mrp.trim().isNotEmpty) {
    final n = num.tryParse(mrp.trim());
    if (n == null || n < 0) errors['mrp'] = 'Enter a number, 0 or more';
  }
  final sizeText = packSize.trim();
  final unitText = packUnit.trim();
  if (sizeText.isNotEmpty || unitText.isNotEmpty) {
    final size = int.tryParse(sizeText);
    if (size == null || size < 2 || size > 100000) {
      errors['pack_size'] = 'Pack size must be a whole number from 2 to 100000';
    } else if (unitText.isEmpty) {
      errors['pack_unit'] = 'Enter the pack name, such as CTN or BOX';
    } else if (unitText.toUpperCase() == unit.trim().toUpperCase()) {
      errors['pack_unit'] = 'Pack name must be different from the stock unit';
    }
  }
  return errors;
}

/// PATCH body for the same fields as [itemCreateBody].
///
/// The items PATCH writes image, supplier, brand, MRP and similar columns
/// whenever `name` is sent, and clears them when they are missing. Values the
/// phone form does not edit are copied from [existing]. Barcode, variants,
/// bundle membership and opening stock are left out so this save does not
/// replace them.
Map<String, dynamic> itemUpdateBody({
  required Map<String, dynamic> existing,
  required String name,
  String code = '',
  String itemType = 'goods',
  String unit = 'PCS',
  String sellingPrice = '',
  String purchasePrice = '',
  String taxRate = '',
  String hsn = '',
  String minStock = '',
  String description = '',
  bool showInStore = false,
  bool featuredInStore = false,
  bool storeReturnable = true,
  String? barcode,
  String? categoryId,
  String? brand,
  String? mrp,
  String? defaultSupplierId,
  String? packSize,
  String? packUnit,
  String? imageUrl,
  bool? gstIncluded,
  String? uqc,
  String? fssai,
  String? netQuantity,
  String? countryOfOrigin,
  bool? isWeighed,
  String? pluCode,
  String? weightBarcodeMode,
}) {
  final body = itemCreateBody(
    name: name,
    code: code,
    itemType: itemType,
    unit: unit,
    sellingPrice: sellingPrice,
    purchasePrice: purchasePrice,
    taxRate: taxRate,
    hsn: hsn,
    minStock: minStock,
    description: description,
    showInStore: showInStore,
    featuredInStore: featuredInStore,
    storeReturnable: storeReturnable,
  );
  body.remove('has_variants');
  body.remove('variants');
  body.remove('opening_stock');
  body.remove('allow_sale_when_out_of_stock');
  for (final key in [
    'default_supplier_id',
    'image_url',
    'mrp',
    'fssai_licence_no',
    'net_quantity',
    'country_of_origin',
    'brand',
    'plu_code',
    'weight_barcode_mode',
  ]) {
    final value = existing[key];
    if (value != null && '$value'.isNotEmpty) body[key] = value;
  }
  if (existing['gst_included'] == true) body['gst_included'] = true;
  if (existing['is_weighed'] == true) body['is_weighed'] = true;

  // The new fields; null means the form did not offer that field. PATCH keeps barcode,
  // category and pack when their keys are missing, so those go only when changed. It
  // clears brand, MRP, supplier and photo when missing, so those are always carried.
  String text(String key) => existing[key]?.toString() ?? '';
  if (barcode != null) {
    final next = normalizeItemBarcode(barcode);
    if (next != text('barcode')) body['barcode'] = next.isEmpty ? null : next;
  }
  if (categoryId != null && categoryId != text('category_id')) {
    body['category_id'] = categoryId.isEmpty ? null : categoryId;
  }
  if (packSize != null || packUnit != null) {
    final oldSize = int.tryParse(itemFieldText(existing['pack_size'])) ?? 0;
    final size = int.tryParse((packSize ?? itemFieldText(existing['pack_size'])).trim());
    final unitText = (packUnit ?? text('pack_unit')).trim().toUpperCase();
    if ((size ?? 0) != oldSize || unitText != text('pack_unit').toUpperCase()) {
      final both = size != null && unitText.isNotEmpty;
      body['pack_size'] = both ? size : null;
      body['pack_unit'] = both ? unitText : null;
    }
  }
  if (brand != null) {
    if (brand.trim().isEmpty) {
      body.remove('brand');
    } else {
      body['brand'] = brand.trim();
    }
  }
  if (mrp != null) {
    final next = _positive(mrp);
    if (next == null) {
      body.remove('mrp');
    } else if (num.tryParse(text('mrp')) == next) {
      body['mrp'] = existing['mrp'];
    } else {
      body['mrp'] = next;
    }
  }
  if (defaultSupplierId != null) {
    if (defaultSupplierId.isEmpty) {
      body.remove('default_supplier_id');
    } else {
      body['default_supplier_id'] = defaultSupplierId;
    }
  }
  if (imageUrl != null) body['image_url'] = imageUrl;

  // Tax and retail label fields; null means the form did not offer that field, so the value
  // copied from [existing] above stays. PATCH writes all of these on every save.
  if (gstIncluded != null) body['gst_included'] = gstIncluded;
  // PATCH keeps the UQC when the key is missing, so it goes only when changed; blank asks the
  // server to work it out again.
  if (uqc != null && uqc.trim() != text('uqc')) body['uqc'] = uqc.trim().isEmpty ? null : uqc.trim();
  void carry(String key, String? value) {
    if (value == null) return;
    if (value.trim().isEmpty) {
      body.remove(key);
    } else {
      body[key] = value.trim();
    }
  }

  carry('fssai_licence_no', fssai);
  carry('net_quantity', netQuantity);
  carry('country_of_origin', countryOfOrigin);
  if (isWeighed != null) {
    final weighed = itemType != 'service' && isWeighed;
    if (weighed) {
      body['is_weighed'] = true;
    } else {
      body.remove('is_weighed');
    }
    if (pluCode != null) {
      final plu = normalizePluCode(pluCode);
      if (weighed && plu.isNotEmpty) {
        body['plu_code'] = plu;
      } else {
        body.remove('plu_code');
      }
    }
    if (weightBarcodeMode != null) body['weight_barcode_mode'] = weightBarcodeMode == 'price' ? 'price' : 'weight';
  }
  return body;
}

/// API decimals such as `"95.00"` become `"95"` for the form fields.
String itemFieldText(dynamic value) {
  if (value == null) return '';
  final parsed = num.tryParse('$value');
  if (parsed == null) return '$value';
  return parsed == parsed.roundToDouble() ? '${parsed.toInt()}' : '$parsed';
}
