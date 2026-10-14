import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/items/item_form_logic.dart';

void main() {
  test('a goods item omits identity and zeros nothing the shop typed', () {
    final body = itemCreateBody(name: ' Rice ', sellingPrice: '12.5', openingStock: '4', taxRate: '5', hsn: '1006');
    expect(body['name'], 'Rice');
    expect(body['selling_price'], 12.5);
    expect(body['opening_stock'], 4);
    expect(body['tax_rate'], 5);
    expect(body['has_variants'], isFalse);
    expect(body.containsKey('created_by'), isFalse);
    expect(body.containsKey('business_id'), isFalse);
    expect(body['allow_sale_when_out_of_stock'], isNull);
  });

  test('a service cannot carry stock', () {
    final body = itemCreateBody(name: 'Delivery', itemType: 'service', openingStock: '9', minStock: '2');
    expect(body['opening_stock'], 0);
    expect(body['min_stock'], 0);
  });
}
