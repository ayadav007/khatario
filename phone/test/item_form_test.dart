import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/items/item_detail_screen.dart';
import 'package:khatario_phone/screens/items/item_form_logic.dart';
import 'package:khatario_phone/screens/items/item_form_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/theme.dart';

class _Api extends KhatarioApi {
  _Api(this.item) : super(Dio());

  final Map<String, dynamic> item;
  Map<String, dynamic>? patched;

  @override
  Future<Map<String, dynamic>> getJson(String path) async => {'item': item};

  @override
  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async {
    patched = body;
    return {'item': item};
  }
}

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

  test('an edit keeps photo, supplier and brand, and leaves stock structure alone', () {
    final body = itemUpdateBody(
      existing: {
        'image_url': 'data:image/jpeg;base64,abc',
        'default_supplier_id': 'sup-1',
        'brand': 'Hyper Pure',
        'country_of_origin': 'IN',
        'gst_included': true,
        'has_variants': true,
        'is_bundle': true,
        'barcode': '890',
      },
      name: ' Rice ',
      sellingPrice: '95',
      purchasePrice: '90',
      hsn: '100630',
      minStock: '1',
      showInStore: true,
    );
    expect(body['name'], 'Rice');
    expect(body['selling_price'], 95);
    expect(body['image_url'], 'data:image/jpeg;base64,abc');
    expect(body['default_supplier_id'], 'sup-1');
    expect(body['brand'], 'Hyper Pure');
    expect(body['country_of_origin'], 'IN');
    expect(body['gst_included'], isTrue);
    expect(body['show_in_store'], isTrue);
    expect(body.containsKey('barcode'), isFalse);
    expect(body.containsKey('has_variants'), isFalse);
    expect(body.containsKey('is_bundle'), isFalse);
    expect(body.containsKey('opening_stock'), isFalse);
    expect(body.containsKey('variants'), isFalse);
    expect(body.containsKey('business_id'), isFalse);
    expect(body.containsKey('updated_by'), isFalse);
  });

  test('itemFieldText drops a trailing decimal zero', () {
    expect(itemFieldText('95.00'), '95');
    expect(itemFieldText('12.50'), '12.5');
    expect(itemFieldText(null), '');
  });

  testWidgets('editing an item shows a pencil, fills the form, and keeps the photo', (tester) async {
    final api = _Api({
      'id': 'item-1',
      'name': 'Rice',
      'selling_price': '95.00',
      'purchase_price': '90.00',
      'tax_rate': '0.00',
      'unit': 'KGS',
      'item_type': 'goods',
      'hsn_sac': '100630',
      'min_stock': '0.00',
      'image_url': 'data:image/jpeg;base64,abc',
      'brand': 'Hyper Pure',
      'show_in_store': true,
      'is_bundle': true,
    });
    final session = AppSession(api, {'isPrimaryAdmin': true, 'user': <String, dynamic>{}, 'business': <String, dynamic>{}});
    await tester.pumpWidget(MaterialApp(
      theme: khatarioTheme(),
      home: ItemDetailScreen(session: session, itemId: 'item-1', onOpen: (_) {}),
    ));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Edit'), findsOneWidget);

    await tester.tap(find.byTooltip('Edit'));
    await tester.pumpAndSettle();
    expect(find.text('Edit item'), findsOneWidget);
    expect(find.text('Rice'), findsWidgets);
    expect(find.text('KGS'), findsOneWidget);
    expect(find.text('Opening stock'), findsNothing);

    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    final body = api.patched!;
    expect(body['name'], 'Rice');
    expect(body['unit'], 'KGS');
    expect(body['image_url'], 'data:image/jpeg;base64,abc');
    expect(body['brand'], 'Hyper Pure');
    expect(body.containsKey('opening_stock'), isFalse);
    expect(body.containsKey('is_bundle'), isFalse);
    expect(body.containsKey('business_id'), isFalse);
    expect(find.text('Edit item'), findsNothing);
    expect(find.text('Rice'), findsWidgets);
  });
}
