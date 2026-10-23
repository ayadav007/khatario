import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/items/scan_add_logic.dart';

void main() {
  const base = ScanAddValues(barcode: '0089012345675', name: 'Parle-G 100 g');

  ScanAddValues withValues({String? purchase, String? opening, String? mrp, String? selling, String? hsn, String? barcode}) => ScanAddValues(
        barcode: barcode ?? base.barcode,
        name: base.name,
        purchasePrice: purchase ?? '',
        openingStock: opening ?? '',
        mrp: mrp ?? '',
        sellingPrice: selling ?? '',
        hsn: hsn ?? '',
      );

  test('a name is the only thing a product without stock needs', () {
    expect(validateScanAdd(base), isEmpty);
    expect(validateScanAdd(const ScanAddValues(barcode: '', name: ' ')), contains('name'));
  });

  test('stock without a purchase price is refused', () {
    expect(validateScanAdd(withValues(opening: '20')), contains('purchase_price'));
    expect(validateScanAdd(withValues(opening: '20', purchase: '0')), contains('purchase_price'));
    expect(validateScanAdd(withValues(opening: '20', purchase: '8.5')), isEmpty);
  });

  test('selling above MRP and a bad HSN are caught', () {
    expect(validateScanAdd(withValues(mrp: '10', selling: '12')), contains('selling_price'));
    expect(validateScanAdd(withValues(hsn: '19')), contains('hsn_sac'));
    expect(validateScanAdd(withValues(hsn: '1905')), isEmpty);
  });

  test('body keeps leading zeroes and carries no identity fields', () {
    final body = scanAddItemBody(withValues(barcode: ' 0089 0123 45675 ', opening: '20', purchase: '8'));
    expect(body['barcode'], '0089012345675');
    expect(body['opening_stock'], 20);
    expect(body.containsKey('business_id'), isFalse);
    expect(body.containsKey('user_id'), isFalse);
    expect(scanAddItemBody(withValues(barcode: '')).containsKey('barcode'), isFalse);
  });

  test('each product gets its own key', () {
    expect(newScanAddKey(), isNot(newScanAddKey()));
  });
}
