/// GST slabs from `lib/gst/rates.ts`, most used first. 28% is kept only for cess goods,
/// and the server rejects 12% on a new rate.
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

/// The unit select on `app/(app)/items/new/page.tsx`.
const itemUnits = ['PCS', 'KG', 'BOX', 'LTR', 'MTR', 'NOS', 'HRS', 'DAYS'];

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

/// Values the phone item form edits, as typed. Variants and bundles stay on the website.
class ItemFields {
  const ItemFields({
    required this.name,
    this.code = '',
    this.itemType = 'goods',
    this.unit = 'PCS',
    this.sellingPrice = '',
    this.purchasePrice = '',
    this.taxRate = '',
    this.hsn = '',
    this.minStock = '',
    this.description = '',
    this.showInStore = false,
    this.featuredInStore = false,
    this.barcode = '',
    this.mrp = '',
    this.gstIncluded = false,
    this.brand = '',
    this.netQuantity = '',
    this.categoryId = '',
    this.imageUrl = '',
    this.packSize = '',
    this.packUnit = '',
    this.uqc = '',
    this.supplierId = '',
    this.fssai = '',
    this.countryOfOrigin = 'IN',
    this.isWeighed = false,
    this.pluCode = '',
    this.weightBarcodeMode = 'weight',
  });

  /// The form filled from `GET /api/items/[id]`.
  factory ItemFields.fromItem(Map<String, dynamic> row) {
    String s(String key) => row[key]?.toString() ?? '';
    final unit = s('unit');
    return ItemFields(
      name: s('name'),
      code: s('code'),
      itemType: row['item_type'] == 'service' ? 'service' : 'goods',
      unit: unit.isEmpty ? 'PCS' : unit,
      sellingPrice: itemFieldText(row['selling_price']),
      purchasePrice: itemFieldText(row['purchase_price']),
      taxRate: itemFieldText(row['tax_rate']),
      hsn: s('hsn_sac'),
      minStock: itemFieldText(row['min_stock']),
      description: s('description'),
      showInStore: row['show_in_store'] == true,
      featuredInStore: row['featured_in_store'] == true,
      barcode: s('barcode'),
      mrp: itemFieldText(row['mrp']),
      gstIncluded: row['gst_included'] == true,
      brand: s('brand'),
      netQuantity: s('net_quantity'),
      categoryId: s('category_id'),
      imageUrl: s('image_url'),
      packSize: itemFieldText(row['pack_size']),
      packUnit: s('pack_unit'),
      uqc: s('uqc'),
      supplierId: s('default_supplier_id'),
      fssai: s('fssai_licence_no'),
      // An item saved without a country keeps none; a new item starts at India like the website.
      countryOfOrigin: s('country_of_origin'),
      isWeighed: row['is_weighed'] == true,
      pluCode: s('plu_code'),
      weightBarcodeMode: row['weight_barcode_mode'] == 'price' ? 'price' : 'weight',
    );
  }

  final String name;
  final String code;
  final String itemType;
  final String unit;
  final String sellingPrice;
  final String purchasePrice;
  final String taxRate;
  final String hsn;
  final String minStock;
  final String description;
  final bool showInStore;
  final bool featuredInStore;
  final String barcode;
  final String mrp;
  final bool gstIncluded;
  final String brand;
  final String netQuantity;
  final String categoryId;
  final String imageUrl;
  final String packSize;
  final String packUnit;
  final String uqc;
  final String supplierId;
  final String fssai;
  final String countryOfOrigin;
  final bool isWeighed;
  final String pluCode;
  final String weightBarcodeMode;
}

String? _text(String v) => v.trim().isEmpty ? null : v.trim();

/// Create body for `POST /api/items`, the same fields as `app/(app)/items/new/page.tsx`.
/// The server validates barcode, GST rate, HSN, pack, category and supplier. Identity fields are omitted.
Map<String, dynamic> itemCreateBody(ItemFields f, {String openingStock = ''}) {
  final service = f.itemType == 'service';
  final selling = num.tryParse(f.sellingPrice);
  final weighed = !service && f.isWeighed;
  final body = <String, dynamic>{
    'name': f.name.trim(),
    'code': _text(f.code),
    'barcode': _text(f.barcode),
    'unit': f.unit,
    'item_type': f.itemType,
    'selling_price': service ? selling : (selling ?? 0),
    'purchase_price': num.tryParse(f.purchasePrice) ?? 0,
    'tax_rate': num.tryParse(f.taxRate) ?? 0,
    'hsn_sac': _text(f.hsn),
    'opening_stock': service ? 0 : (num.tryParse(openingStock) ?? 0),
    'min_stock': service ? 0 : (num.tryParse(f.minStock) ?? 0),
    'description': _text(f.description),
    'category_id': _text(f.categoryId),
    'default_supplier_id': _text(f.supplierId),
    'image_url': _text(f.imageUrl),
    'has_variants': false,
    'variants': const [],
    'allow_sale_when_out_of_stock': null,
    'gst_included': f.gstIncluded,
    'mrp': num.tryParse(f.mrp),
    // A size that is not a whole number goes as typed so the server explains the rule.
    'pack_size': service ? null : (num.tryParse(f.packSize) ?? _text(f.packSize)),
    'pack_unit': service ? null : _text(f.packUnit),
    'fssai_licence_no': _text(f.fssai),
    'net_quantity': _text(f.netQuantity),
    'country_of_origin': _text(f.countryOfOrigin),
    'brand': _text(f.brand),
    'is_weighed': weighed,
    'plu_code': weighed ? _text(f.pluCode.replaceAll(RegExp(r'\D'), '')) : null,
    'weight_barcode_mode': f.weightBarcodeMode == 'price' ? 'price' : 'weight',
    'show_in_store': f.showInStore,
    'featured_in_store': f.featuredInStore,
  };
  if (_text(f.uqc) != null) body['uqc'] = f.uqc.trim();
  return body;
}

/// PATCH body for `PATCH /api/items/[id]`.
///
/// The PATCH writes every column [itemCreateBody] sends and clears the ones missing, so the
/// form must be filled with [ItemFields.fromItem]. Variants, bundle membership and opening
/// stock are left out so this save does not replace them; gallery and SEO are not sent either.
Map<String, dynamic> itemUpdateBody(ItemFields f) {
  final body = itemCreateBody(f);
  body.remove('has_variants');
  body.remove('variants');
  body.remove('opening_stock');
  body.remove('allow_sale_when_out_of_stock');
  return body;
}

/// API decimals such as `"95.00"` become `"95"` for the form fields.
String itemFieldText(dynamic value) {
  if (value == null) return '';
  final parsed = num.tryParse('$value');
  if (parsed == null) return '$value';
  return parsed == parsed.roundToDouble() ? '${parsed.toInt()}' : '$parsed';
}
