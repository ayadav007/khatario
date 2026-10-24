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
    'gst_included': false,
    'show_in_store': showInStore,
    'featured_in_store': featuredInStore,
    'country_of_origin': 'IN',
  };
  return body;
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
  return body;
}

/// API decimals such as `"95.00"` become `"95"` for the form fields.
String itemFieldText(dynamic value) {
  if (value == null) return '';
  final parsed = num.tryParse('$value');
  if (parsed == null) return '$value';
  return parsed == parsed.roundToDouble() ? '${parsed.toInt()}' : '$parsed';
}
