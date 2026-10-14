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
