import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/items/item_detail_screen.dart';
import 'package:khatario_phone/screens/items/item_form_logic.dart';
import 'package:khatario_phone/screens/items/item_form_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/theme.dart';
import 'package:khatario_phone/ui/form_kit.dart';

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
  group('tax and retail label fields', () {
    test('only current GST slabs are offered', () {
      final rates = [for (final r in itemGstRates) r.$1];
      expect(rates, isNot(contains('12')));
      expect(rates.take(4), ['0', '5', '18', '40']);
    });

    test('create sends them only when set, and a blank country is none', () {
      final plain = itemCreateBody(name: 'Rice');
      expect(plain['gst_included'], isFalse);
      expect(plain['country_of_origin'], 'IN');
      for (final key in ['uqc', 'fssai_licence_no', 'net_quantity', 'is_weighed', 'plu_code', 'weight_barcode_mode']) {
        expect(plain.containsKey(key), isFalse, reason: key);
      }

      final full = itemCreateBody(
        name: 'Loose rice',
        gstIncluded: true,
        uqc: ' KGS ',
        fssai: ' 12345678901234 ',
        netQuantity: '1 kg',
        countryOfOrigin: '',
        isWeighed: true,
        pluCode: 'PLU 0123456',
        weightBarcodeMode: 'price',
      );
      expect(full['gst_included'], isTrue);
      expect(full['uqc'], 'KGS');
      expect(full['fssai_licence_no'], '12345678901234');
      expect(full['net_quantity'], '1 kg');
      expect(full['country_of_origin'], isNull);
      expect(full['is_weighed'], isTrue);
      expect(full['plu_code'], '01234');
      expect(full['weight_barcode_mode'], 'price');
    });

    test('a service is never sold by weight', () {
      final body = itemCreateBody(name: 'Repair', itemType: 'service', isWeighed: true, pluCode: '12');
      expect(body.containsKey('is_weighed'), isFalse);
      expect(body.containsKey('plu_code'), isFalse);
    });

    final existing = <String, dynamic>{
      'name': 'Loose rice',
      'gst_included': true,
      'uqc': 'KGS',
      'fssai_licence_no': '12345678901234',
      'net_quantity': '1 kg',
      'country_of_origin': 'CN',
      'is_weighed': true,
      'plu_code': '01234',
      'weight_barcode_mode': 'price',
    };

    test('an edit that does not offer the fields keeps them', () {
      final body = itemUpdateBody(existing: existing, name: 'Loose rice');
      expect(body['gst_included'], isTrue);
      expect(body.containsKey('uqc'), isFalse);
      expect(body['fssai_licence_no'], '12345678901234');
      expect(body['net_quantity'], '1 kg');
      expect(body['country_of_origin'], 'CN');
      expect(body['is_weighed'], isTrue);
      expect(body['plu_code'], '01234');
      expect(body['weight_barcode_mode'], 'price');
    });

    test('an untouched edit that offers the fields sends the same values', () {
      final body = itemUpdateBody(
        existing: existing,
        name: 'Loose rice',
        gstIncluded: true,
        uqc: 'KGS',
        fssai: '12345678901234',
        netQuantity: '1 kg',
        countryOfOrigin: 'CN',
        isWeighed: true,
        pluCode: '01234',
        weightBarcodeMode: 'price',
      );
      expect(body['gst_included'], isTrue);
      expect(body.containsKey('uqc'), isFalse);
      expect(body['fssai_licence_no'], '12345678901234');
      expect(body['net_quantity'], '1 kg');
      expect(body['country_of_origin'], 'CN');
      expect(body['is_weighed'], isTrue);
      expect(body['plu_code'], '01234');
      expect(body['weight_barcode_mode'], 'price');
    });

    test('changed values are sent and cleared values clear', () {
      final body = itemUpdateBody(
        existing: existing,
        name: 'Loose rice',
        gstIncluded: false,
        uqc: '',
        fssai: '',
        netQuantity: '2 kg',
        countryOfOrigin: '',
        isWeighed: false,
        pluCode: '01234',
        weightBarcodeMode: 'weight',
      );
      expect(body['gst_included'], isFalse);
      expect(body.containsKey('uqc'), isTrue);
      expect(body['uqc'], isNull);
      expect(body.containsKey('fssai_licence_no'), isFalse);
      expect(body['net_quantity'], '2 kg');
      expect(body.containsKey('country_of_origin'), isFalse);
      expect(body.containsKey('is_weighed'), isFalse);
      expect(body.containsKey('plu_code'), isFalse);
      expect(body['weight_barcode_mode'], 'weight');
    });

    test('an item saved without a country is not given India on edit', () {
      final body = itemUpdateBody(existing: const {'name': 'Rice'}, name: 'Rice', countryOfOrigin: '');
      expect(body.containsKey('country_of_origin'), isFalse);
    });
  });

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

  group('new item fields', () {
    test('create carries the new keys only when they are set', () {
      final bare = itemCreateBody(name: 'Rice');
      for (final k in ['barcode', 'category_id', 'brand', 'mrp', 'default_supplier_id', 'pack_size', 'pack_unit', 'image_url']) {
        expect(bare.containsKey(k), isFalse, reason: k);
      }
      final body = itemCreateBody(
        name: 'Rice',
        barcode: ' 8901234567 897 ',
        categoryId: 'cat-1',
        brand: ' Hyper ',
        mrp: '120.50',
        defaultSupplierId: 'sup-1',
        packSize: '12',
        packUnit: 'ctn',
        imageUrl: 'data:image/png;base64,abc',
      );
      expect(body['barcode'], '8901234567897');
      expect(body['category_id'], 'cat-1');
      expect(body['brand'], 'Hyper');
      expect(body['mrp'], 120.5);
      expect(body['default_supplier_id'], 'sup-1');
      expect(body['pack_size'], 12);
      expect(body['pack_unit'], 'CTN');
      expect(body['image_url'], 'data:image/png;base64,abc');
      expect(body.containsKey('track_batch'), isFalse);
    });

    test('an untouched edit keeps barcode, category, brand, MRP, supplier, pack and photo', () {
      final existing = {
        'barcode': '8901234567897',
        'category_id': 'cat-1',
        'brand': 'Hyper',
        'mrp': '120.00',
        'default_supplier_id': 'sup-1',
        'pack_size': 12,
        'pack_unit': 'CTN',
        'image_url': 'data:image/png;base64,abc',
      };
      final body = itemUpdateBody(
        existing: existing,
        name: 'Rice',
        barcode: '8901234567897',
        categoryId: 'cat-1',
        brand: 'Hyper',
        mrp: '120',
        defaultSupplierId: 'sup-1',
        packSize: '12',
        packUnit: 'CTN',
        imageUrl: 'data:image/png;base64,abc',
      );
      // PATCH leaves barcode, category and pack alone when the key is missing.
      expect(body.containsKey('barcode'), isFalse);
      expect(body.containsKey('category_id'), isFalse);
      expect(body.containsKey('pack_size'), isFalse);
      expect(body.containsKey('pack_unit'), isFalse);
      // It wipes these when missing, so they are carried.
      expect(body['brand'], 'Hyper');
      expect(body['mrp'], '120.00');
      expect(body['default_supplier_id'], 'sup-1');
      expect(body['image_url'], 'data:image/png;base64,abc');
    });

    test('not passing the fields behaves as before', () {
      final body = itemUpdateBody(existing: {'barcode': '123', 'category_id': 'c', 'brand': 'B'}, name: 'Rice');
      expect(body.containsKey('barcode'), isFalse);
      expect(body.containsKey('category_id'), isFalse);
      expect(body['brand'], 'B');
    });

    test('changed values are sent and cleared values clear', () {
      final existing = {
        'barcode': '8901234567897',
        'category_id': 'cat-1',
        'brand': 'Hyper',
        'mrp': '120.00',
        'default_supplier_id': 'sup-1',
        'pack_size': 12,
        'pack_unit': 'CTN',
        'image_url': 'data:image/png;base64,abc',
      };
      final changed = itemUpdateBody(
        existing: existing,
        name: 'Rice',
        barcode: 'ABCD1234',
        categoryId: 'cat-2',
        brand: 'New',
        mrp: '130',
        defaultSupplierId: 'sup-2',
        packSize: '24',
        packUnit: 'BOX',
        imageUrl: 'data:image/png;base64,zzz',
      );
      expect(changed['barcode'], 'ABCD1234');
      expect(changed['category_id'], 'cat-2');
      expect(changed['brand'], 'New');
      expect(changed['mrp'], 130);
      expect(changed['default_supplier_id'], 'sup-2');
      expect(changed['pack_size'], 24);
      expect(changed['pack_unit'], 'BOX');
      expect(changed['image_url'], 'data:image/png;base64,zzz');

      final cleared = itemUpdateBody(
        existing: existing,
        name: 'Rice',
        barcode: '',
        categoryId: '',
        brand: '',
        mrp: '',
        defaultSupplierId: '',
        packSize: '',
        packUnit: '',
        imageUrl: '',
      );
      expect(cleared.containsKey('barcode'), isTrue);
      expect(cleared['barcode'], isNull);
      expect(cleared['category_id'], isNull);
      expect(cleared['pack_size'], isNull);
      expect(cleared['pack_unit'], isNull);
      expect(cleared.containsKey('brand'), isFalse);
      expect(cleared.containsKey('mrp'), isFalse);
      expect(cleared.containsKey('default_supplier_id'), isFalse);
      expect(cleared['image_url'], '');
    });

    test('validation follows the website', () {
      expect(validateItemExtras(), isEmpty);
      expect(validateItemExtras(barcode: 'ab')['barcode'], 'Barcode must be at least 3 characters');
      expect(validateItemExtras(barcode: '8901234567897')['barcode'], 'Invalid EAN-13 check digit');
      expect(validateItemExtras(barcode: '8901234567890'), isEmpty);
      expect(validateItemExtras(barcode: 'ab-c'), isEmpty);
      expect(validateItemExtras(barcode: '8901234567'), isEmpty);
      expect(validateItemExtras(barcode: '123456789013')['barcode'], 'Invalid UPC-A check digit');
      expect(validateItemExtras(packSize: '1', packUnit: 'CTN')['pack_size'], 'Pack size must be a whole number from 2 to 100000');
      expect(validateItemExtras(packSize: '12')['pack_unit'], 'Enter the pack name, such as CTN or BOX');
      expect(validateItemExtras(packUnit: 'CTN')['pack_size'], 'Pack size must be a whole number from 2 to 100000');
      expect(validateItemExtras(packSize: '12', packUnit: 'pcs', unit: 'PCS')['pack_unit'], 'Pack name must be different from the stock unit');
      expect(validateItemExtras(packSize: '12', packUnit: 'CTN', unit: 'PCS'), isEmpty);
    });
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

  group('new item fields on the form', () {
    Future<_FormApi> open(WidgetTester tester, _FormApi api, {String? itemId, Future<String?> Function(BuildContext)? scan, Future<PickedPhoto?> Function()? pick}) async {
      await tester.binding.setSurfaceSize(const Size(420, 2600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final session = AppSession(api, {'isPrimaryAdmin': true, 'user': <String, dynamic>{}, 'business': <String, dynamic>{}});
      await tester.pumpWidget(MaterialApp(
        theme: khatarioTheme(),
        home: ItemFormScreen(session: session, itemId: itemId, scanBarcode: scan, pickPhoto: pick),
      ));
      await tester.pumpAndSettle();
      return api;
    }

    Future<void> typeIn(WidgetTester tester, String label, String text) async {
      final kit = find.descendant(of: find.byWidgetPredicate((w) => w is KTextField && w.label == label), matching: find.byType(TextField));
      await tester.enterText(kit.evaluate().isNotEmpty ? kit.first : find.widgetWithText(TextField, label).first, text);
      await tester.pump();
    }

    testWidgets('the new fields are on the create form', (tester) async {
      await open(tester, _FormApi());
      for (final label in ['Identify', 'Stock', 'Photos', 'Barcode', 'Category', 'Brand', 'MRP', 'Default supplier', 'Pack size', 'Pack name']) {
        expect(find.text(label), findsWidgets, reason: label);
      }
      expect(find.text('No category'), findsOneWidget);
      expect(find.text('Scan with camera'), findsOneWidget);
    });

    testWidgets('a service has no brand field', (tester) async {
      await open(tester, _FormApi());
      expect(find.text('Brand'), findsOneWidget);
      await tester.tap(find.text('Service'));
      await tester.pumpAndSettle();
      expect(find.text('Brand'), findsNothing);
    });

    testWidgets('a category and a supplier can be picked, the scanner fills the barcode, and all of it is posted', (tester) async {
      final api = await open(tester, _FormApi(), scan: (_) async => '8901234567890');
      await typeIn(tester, 'Name *', 'Rice');
      await tester.tap(find.text('Scan with camera'));
      await tester.pumpAndSettle();
      expect(find.text('8901234567890'), findsOneWidget);

      await tester.tap(find.text('No category'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Staples').last);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Select'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Acme Traders').last);
      await tester.pumpAndSettle();

      await typeIn(tester, 'Brand', 'Hyper');
      await typeIn(tester, 'Pack size', '12');
      await typeIn(tester, 'Pack name', 'ctn');
      await tester.tap(find.text('Save item'));
      await tester.pumpAndSettle();

      final body = api.posted!;
      expect(body['barcode'], '8901234567890');
      expect(body['category_id'], 'cat-1');
      expect(body['default_supplier_id'], 'sup-1');
      expect(body['brand'], 'Hyper');
      expect(body['pack_size'], 12);
      expect(body['pack_unit'], 'CTN');
      expect(body.containsKey('business_id'), isFalse);
      expect(body.containsKey('created_by'), isFalse);
      expect(body.containsKey('track_batch'), isFalse);
    });

    testWidgets('a bad barcode shows under the field and nothing is sent', (tester) async {
      final api = await open(tester, _FormApi());
      await typeIn(tester, 'Name *', 'Rice');
      await typeIn(tester, 'Barcode', '8901234567897');
      await tester.tap(find.text('Save item'));
      await tester.pumpAndSettle();
      expect(find.text('Invalid EAN-13 check digit'), findsOneWidget);
      expect(api.posted, isNull);
    });

    testWidgets('a bad pack shows under the field and nothing is sent', (tester) async {
      final api = await open(tester, _FormApi());
      await typeIn(tester, 'Name *', 'Rice');
      await typeIn(tester, 'Pack size', '12');
      await tester.tap(find.text('Save item'));
      await tester.pumpAndSettle();
      expect(find.text('Enter the pack name, such as CTN or BOX'), findsOneWidget);
      expect(api.posted, isNull);
    });

    testWidgets('a refused save shows the server message and keeps the form', (tester) async {
      final api = _FormApi()..refuse = ApiException('Barcode "ABC123" already exists for item "Soap"', status: 400);
      await open(tester, api);
      await typeIn(tester, 'Name *', 'Rice');
      await typeIn(tester, 'Barcode', 'ABC123');
      await tester.tap(find.text('Save item'));
      await tester.pumpAndSettle();
      expect(find.text('Barcode "ABC123" already exists for item "Soap"'), findsOneWidget);
      expect(find.text('New item'), findsOneWidget);
      expect(find.text('ABC123'), findsOneWidget);
      expect(find.text('Rice'), findsOneWidget);
    });

    testWidgets('a photo is uploaded, shown, and sent as image_url', (tester) async {
      final api = await open(tester, _FormApi(), pick: () async => (bytes: _png, name: 'rice.png'));
      await typeIn(tester, 'Name *', 'Rice');
      await tester.tap(find.text('Add photo'));
      await tester.pumpAndSettle();
      expect(api.uploads, ['/api/upload/image']);
      expect(find.text('Remove'), findsOneWidget);
      await tester.tap(find.text('Save item'));
      await tester.pumpAndSettle();
      expect(api.posted!['image_url'], startsWith('data:image/png;base64,'));
    });

    testWidgets('an item that has these fields shows them and keeps them when untouched', (tester) async {
      final api = _FormApi(item: {
        'id': 'item-1',
        'name': 'Rice',
        'selling_price': '95.00',
        'unit': 'KG',
        'item_type': 'goods',
        'barcode': '8901234567890',
        'category_id': 'cat-1',
        'brand': 'Hyper',
        'mrp': '120.00',
        'default_supplier_id': 'sup-1',
        'pack_size': 12,
        'pack_unit': 'CTN',
        'image_url': 'data:image/png;base64,abc',
      });
      await open(tester, api, itemId: 'item-1');
      expect(find.text('8901234567890'), findsOneWidget);
      expect(find.text('Staples'), findsOneWidget);
      expect(find.text('Acme Traders'), findsOneWidget);
      expect(find.text('Hyper'), findsOneWidget);
      expect(find.text('120'), findsOneWidget);
      await tester.tap(find.text('Save changes'));
      await tester.pumpAndSettle();
      final body = api.patched!;
      expect(body.containsKey('barcode'), isFalse);
      expect(body.containsKey('category_id'), isFalse);
      expect(body.containsKey('pack_size'), isFalse);
      expect(body['brand'], 'Hyper');
      expect(body['mrp'], '120.00');
      expect(body['default_supplier_id'], 'sup-1');
      expect(body['image_url'], 'data:image/png;base64,abc');
    });

    testWidgets('editing the barcode and clearing the category sends just those', (tester) async {
      final api = _FormApi(item: {
        'id': 'item-1',
        'name': 'Rice',
        'selling_price': '95.00',
        'unit': 'KG',
        'item_type': 'goods',
        'barcode': '8901234567890',
        'category_id': 'cat-1',
      });
      await open(tester, api, itemId: 'item-1');
      await typeIn(tester, 'Barcode', 'ABCD1234');
      await tester.tap(find.text('Staples'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('No category').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Save changes'));
      await tester.pumpAndSettle();
      final body = api.patched!;
      expect(body['barcode'], 'ABCD1234');
      expect(body.containsKey('category_id'), isTrue);
      expect(body['category_id'], isNull);
    });
  });
}

const _png = <int>[137, 80, 78, 71, 13, 10, 26, 10];

class _FormApi extends KhatarioApi {
  _FormApi({Map<String, dynamic>? item})
      : item = item ?? {},
        super(Dio());

  final Map<String, dynamic> item;
  Map<String, dynamic>? posted;
  Map<String, dynamic>? patched;
  ApiException? refuse;
  final uploads = <String>[];

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    if (path == '/api/categories') {
      return {
        'categories': [
          {'id': 'cat-1', 'name': 'Staples'},
          {'id': 'cat-2', 'name': 'Dairy'},
        ]
      };
    }
    if (path == '/api/suppliers/sup-1') {
      return {'supplier': {'id': 'sup-1', 'name': 'Acme Traders'}};
    }
    if (path.startsWith('/api/items/')) return {'item': item};
    throw ApiException('not found', status: 404);
  }

  @override
  Future<dynamic> getData(String path) async {
    if (path.startsWith('/api/suppliers')) {
      return {
        'suppliers': [
          {'id': 'sup-1', 'name': 'Acme Traders', 'phone': '9999999999'},
        ]
      };
    }
    return {};
  }

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    final refused = refuse;
    if (refused != null) throw refused;
    posted = body;
    return {'item': {'id': 'new'}};
  }

  @override
  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async {
    patched = body;
    return {'item': item};
  }

  @override
  Future<Map<String, dynamic>> uploadImage(String path, {required List<int> bytes, required String fileName, Map<String, String> fields = const {}}) async {
    uploads.add(path);
    return {'url': 'data:image/png;base64,iVBORw0KGgo='};
  }
}
