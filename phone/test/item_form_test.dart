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
  Map<String, dynamic>? posted;

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    if (path.startsWith('/api/categories')) {
      return {
        'categories': [
          {'id': 'cat-1', 'name': 'Grocery'},
        ],
      };
    }
    if (path.startsWith('/api/suppliers/')) {
      return {
        'supplier': {'id': 'sup-1', 'name': 'Metro Cash'},
      };
    }
    if (path.startsWith('/api/items/')) return {'item': item};
    return {};
  }

  @override
  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async {
    patched = body;
    return {'item': item};
  }

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    posted = body;
    return {'item': item};
  }
}

/// A row as `GET /api/items/[id]` returns it, with every field the phone form edits.
Map<String, dynamic> _fullItem() => {
      'id': 'item-1',
      'name': 'Rice',
      'code': 'R1',
      'barcode': '8901234567890',
      'barcode_type': 'EAN13',
      'selling_price': '95.00',
      'purchase_price': '90.00',
      'mrp': '99.00',
      'gst_included': true,
      'tax_rate': '5.00',
      'unit': 'KGS',
      'uqc': 'KGS',
      'item_type': 'goods',
      'hsn_sac': '100630',
      'min_stock': '2.00',
      'description': 'Sona masoori',
      'category_id': 'cat-1',
      'default_supplier_id': 'sup-1',
      'image_url': 'data:image/jpeg;base64,abc',
      'pack_size': 25,
      'pack_unit': 'BAG',
      'brand': 'Hyper Pure',
      'net_quantity': '1 kg',
      'fssai_licence_no': '12345678901234',
      'country_of_origin': 'IN',
      'is_weighed': true,
      'plu_code': '01234',
      'weight_barcode_mode': 'price',
      'show_in_store': true,
      'featured_in_store': false,
      'has_variants': false,
      'is_bundle': true,
    };

AppSession _session(_Api api) => AppSession(api, {'isPrimaryAdmin': true, 'user': <String, dynamic>{}, 'business': <String, dynamic>{}});

/// A tall phone, so the whole form is built without scrolling.
void _tallScreen(WidgetTester tester) {
  tester.view.physicalSize = const Size(800, 3000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void _noIdentity(Map<String, dynamic> body) {
  for (final key in ['business_id', 'user_id', 'created_by', 'updated_by']) {
    expect(body.containsKey(key), isFalse, reason: key);
  }
}

void main() {
  test('a goods item omits identity and zeros nothing the shop typed', () {
    final body = itemCreateBody(const ItemFields(name: ' Rice ', sellingPrice: '12.5', taxRate: '5', hsn: '1006'), openingStock: '4');
    expect(body['name'], 'Rice');
    expect(body['selling_price'], 12.5);
    expect(body['opening_stock'], 4);
    expect(body['tax_rate'], 5);
    expect(body['has_variants'], isFalse);
    expect(body['allow_sale_when_out_of_stock'], isNull);
    expect(body['country_of_origin'], 'IN');
    expect(body.containsKey('uqc'), isFalse, reason: 'blank UQC lets the server work it out');
    _noIdentity(body);
  });

  test('a service cannot carry stock, packs or weighing', () {
    final body = itemCreateBody(
      const ItemFields(name: 'Delivery', itemType: 'service', minStock: '2', packSize: '10', packUnit: 'CTN', isWeighed: true, pluCode: '123'),
      openingStock: '9',
    );
    expect(body['opening_stock'], 0);
    expect(body['min_stock'], 0);
    expect(body['pack_size'], isNull);
    expect(body['pack_unit'], isNull);
    expect(body['is_weighed'], isFalse);
    expect(body['plu_code'], isNull);
  });

  test('the website fields go to POST /api/items under the same names', () {
    final body = itemCreateBody(const ItemFields(
      name: 'Atta',
      barcode: ' 8901234567890 ',
      mrp: '60',
      gstIncluded: true,
      brand: 'Aashirvaad',
      netQuantity: '1 kg',
      categoryId: 'cat-1',
      imageUrl: 'data:image/png;base64,xyz',
      packSize: '10',
      packUnit: 'BAG',
      uqc: 'KGS',
      supplierId: 'sup-1',
      fssai: '10012345678901',
      countryOfOrigin: '',
      isWeighed: true,
      pluCode: '01-23',
      weightBarcodeMode: 'price',
    ));
    expect(body['barcode'], '8901234567890');
    expect(body.containsKey('barcode_type'), isFalse, reason: 'the server detects the type');
    expect(body['mrp'], 60);
    expect(body['gst_included'], isTrue);
    expect(body['brand'], 'Aashirvaad');
    expect(body['net_quantity'], '1 kg');
    expect(body['category_id'], 'cat-1');
    expect(body['image_url'], 'data:image/png;base64,xyz');
    expect(body['pack_size'], 10);
    expect(body['pack_unit'], 'BAG');
    expect(body['uqc'], 'KGS');
    expect(body['default_supplier_id'], 'sup-1');
    expect(body['fssai_licence_no'], '10012345678901');
    expect(body['country_of_origin'], isNull);
    expect(body['is_weighed'], isTrue);
    expect(body['plu_code'], '0123');
    expect(body['weight_barcode_mode'], 'price');
    _noIdentity(body);
  });

  test('blank optional fields are sent as null and a bad pack size reaches the server as typed', () {
    final body = itemCreateBody(const ItemFields(name: 'Soap', packSize: '2.5', pluCode: '01234'));
    expect(body['barcode'], isNull);
    expect(body['mrp'], isNull);
    expect(body['category_id'], isNull);
    expect(body['default_supplier_id'], isNull);
    expect(body['image_url'], isNull);
    expect(body['pack_size'], 2.5);
    expect(body['plu_code'], isNull, reason: 'PLU only applies to weighed items');
    expect(itemCreateBody(const ItemFields(name: 'Soap', packSize: 'ten'))['pack_size'], 'ten');
  });

  test('an edit loaded with fromItem saves every field back unchanged', () {
    final body = itemUpdateBody(ItemFields.fromItem(_fullItem()));
    expect(body['name'], 'Rice');
    expect(body['code'], 'R1');
    expect(body['barcode'], '8901234567890');
    expect(body['selling_price'], 95);
    expect(body['purchase_price'], 90);
    expect(body['mrp'], 99);
    expect(body['gst_included'], isTrue);
    expect(body['tax_rate'], 5);
    expect(body['unit'], 'KGS');
    expect(body['uqc'], 'KGS');
    expect(body['hsn_sac'], '100630');
    expect(body['min_stock'], 2);
    expect(body['description'], 'Sona masoori');
    expect(body['category_id'], 'cat-1');
    expect(body['default_supplier_id'], 'sup-1');
    expect(body['image_url'], 'data:image/jpeg;base64,abc');
    expect(body['pack_size'], 25);
    expect(body['pack_unit'], 'BAG');
    expect(body['brand'], 'Hyper Pure');
    expect(body['net_quantity'], '1 kg');
    expect(body['fssai_licence_no'], '12345678901234');
    expect(body['country_of_origin'], 'IN');
    expect(body['is_weighed'], isTrue);
    expect(body['plu_code'], '01234');
    expect(body['weight_barcode_mode'], 'price');
    expect(body['show_in_store'], isTrue);
    expect(body['featured_in_store'], isFalse);
    for (final key in ['has_variants', 'variants', 'is_bundle', 'bundle_components', 'opening_stock', 'allow_sale_when_out_of_stock', 'gallery_urls', 'seo_title']) {
      expect(body.containsKey(key), isFalse, reason: key);
    }
    _noIdentity(body);
  });

  test('an item saved without a country keeps none', () {
    final row = _fullItem()..remove('country_of_origin');
    expect(itemUpdateBody(ItemFields.fromItem(row))['country_of_origin'], isNull);
  });

  test('the GST rates are the current slabs: no 12%, 28% only for cess goods', () {
    final rates = itemGstRates.map((r) => r.$1).toList();
    expect(rates, isNot(contains('12')));
    expect(rates, containsAll(['0', '5', '18', '40', '28', '0.1', '0.25', '1.5', '3']));
    expect(itemGstRates.firstWhere((r) => r.$1 == '28').$2, contains('cess'));
  });

  test('itemFieldText drops a trailing decimal zero', () {
    expect(itemFieldText('95.00'), '95');
    expect(itemFieldText('12.50'), '12.5');
    expect(itemFieldText(null), '');
  });

  testWidgets('editing an item shows a pencil, fills the form, and keeps every field', (tester) async {
    _tallScreen(tester);
    final api = _Api(_fullItem());
    await tester.pumpWidget(MaterialApp(
      theme: khatarioTheme(),
      home: ItemDetailScreen(session: _session(api), itemId: 'item-1', onOpen: (_) {}),
    ));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Edit'), findsOneWidget);

    await tester.tap(find.byTooltip('Edit'));
    await tester.pumpAndSettle();
    expect(find.text('Edit item'), findsOneWidget);
    expect(find.text('Rice'), findsWidgets);
    expect(find.text('KGS'), findsWidgets);
    expect(find.text('8901234567890'), findsOneWidget);
    expect(find.text('Opening stock'), findsNothing);
    // More details and Retail label open because the item has values there.
    expect(find.text('Grocery'), findsOneWidget);
    expect(find.text('Metro Cash'), findsOneWidget);
    expect(find.text('Hyper Pure'), findsOneWidget);
    expect(find.text('01234'), findsOneWidget);

    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    final body = api.patched!;
    expect(body['name'], 'Rice');
    expect(body['unit'], 'KGS');
    expect(body['image_url'], 'data:image/jpeg;base64,abc');
    expect(body['brand'], 'Hyper Pure');
    expect(body['barcode'], '8901234567890');
    expect(body['category_id'], 'cat-1');
    expect(body['default_supplier_id'], 'sup-1');
    expect(body['pack_size'], 25);
    expect(body['mrp'], 99);
    expect(body['gst_included'], isTrue);
    expect(body['is_weighed'], isTrue);
    expect(body.containsKey('opening_stock'), isFalse);
    expect(body.containsKey('is_bundle'), isFalse);
    _noIdentity(body);
    expect(find.text('Edit item'), findsNothing);
    expect(find.text('Rice'), findsWidgets);
  });

  testWidgets('an old 12% item keeps its rate on edit', (tester) async {
    _tallScreen(tester);
    final api = _Api({..._fullItem(), 'tax_rate': '12.00'});
    await tester.pumpWidget(MaterialApp(theme: khatarioTheme(), home: ItemFormScreen(session: _session(api), itemId: 'item-1')));
    await tester.pumpAndSettle();
    expect(find.text('12% (old)'), findsOneWidget);
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    expect(api.patched!['tax_rate'], 12);
  });

  testWidgets('a new item posts MRP, GST-inclusive price, category and the picked rate', (tester) async {
    _tallScreen(tester);
    final api = _Api({'id': 'item-2', 'name': 'Atta'});
    await tester.pumpWidget(MaterialApp(theme: khatarioTheme(), home: ItemFormScreen(session: _session(api))));
    await tester.pumpAndSettle();
    expect(find.text('New item'), findsOneWidget);
    expect(find.text('12%'), findsNothing);

    await tester.enterText(find.widgetWithText(TextField, 'Name *'), 'Atta');
    await tester.enterText(find.widgetWithText(TextField, 'Barcode'), '8901234567890');
    await tester.enterText(find.widgetWithText(TextField, 'Selling price'), '55');
    await tester.enterText(find.widgetWithText(TextField, 'MRP'), '60');
    await tester.tap(find.text('Selling price includes GST'));
    await tester.pump();
    await tester.tap(find.text('18%'));
    await tester.pump();

    await tester.tap(find.text('More details'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Category'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Grocery').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Save item'));
    await tester.pumpAndSettle();
    final body = api.posted!;
    expect(body['name'], 'Atta');
    expect(body['barcode'], '8901234567890');
    expect(body['selling_price'], 55);
    expect(body['mrp'], 60);
    expect(body['gst_included'], isTrue);
    expect(body['tax_rate'], 18);
    expect(body['category_id'], 'cat-1');
    _noIdentity(body);
  });
}
