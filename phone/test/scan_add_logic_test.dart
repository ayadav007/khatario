import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/items/scan_add_logic.dart';
import 'package:khatario_phone/screens/invoices/invoice_scan.dart';

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

  group('filling from a database or a photo', () {
    const blank = (name: '', brand: '', size: '', mrp: '');

    test('fills empty fields, with the size in the name', () {
      final f = fillFromFacts(blank, const ProductFacts(name: 'harpic', brand: 'Harpic', quantity: '500 ml'));
      expect(f, (name: 'Harpic 500 ml', brand: 'Harpic', size: '500 ml', mrp: ''));
    });

    test('never overwrites what was typed', () {
      final f = fillFromFacts((name: 'Harpic Blue 500 ml', brand: '', size: '500 ml', mrp: '99'), const ProductFacts(name: 'harpic', quantity: '200 ml', mrp: 120));
      expect(f.name, 'Harpic Blue 500 ml');
      expect(f.size, '500 ml');
      expect(f.mrp, '99');
    });

    test('a disputed size stays blank', () {
      final f = fillFromFacts(blank, const ProductFacts(name: 'Harpic', quantity: '300 ml'), sizeInDoubt: true);
      expect(f.size, '');
      expect(f.name, 'Harpic');
    });

    test('a size from a later photo joins the name once', () {
      final named = fillFromFacts(blank, const ProductFacts(name: 'Parle-G Biscuits'));
      expect(fillFromFacts(named, const ProductFacts(quantity: '75 g')).name, 'Parle-G Biscuits 75 g');
      expect(nameWithSize('Parle-G 75g', '75 g'), 'Parle-G 75g');
    });

    test('the accepted provider is sent by name only', () {
      expect(scanAddItemBody(base, lookupSource: 'productguru')['lookup_source'], 'productguru');
      expect(scanAddItemBody(base).containsKey('lookup_source'), isFalse);
    });
  });

  group('batches and sizes', () {
    test('a batch goes with the body only when there is stock', () {
      expect(batchBody('12', 'L45', '', '2027-03'), {'batch_number': 'L45', 'expiry_date': '2027-03'});
      expect(batchBody('0', 'L45', '', '2027-03'), isNull);
      expect(batchBody('12', '', '', ''), isNull);
      final body = scanAddItemBody(const ScanAddValues(barcode: '', name: 'Maggi 70 g', openingStock: '12', purchasePrice: '11', expiryDate: '2027-03'));
      expect(body['opening_batch'], {'expiry_date': '2027-03'});
    });

    test('date mistakes are caught before saving', () {
      expect(batchErrors('09/2026', ''), contains('manufacturing_date'));
      expect(batchErrors('2027-05', '2027-01'), contains('expiry_date'));
      expect(batchErrors('2026-09', '2027-03-31'), isEmpty);
    });

    test('the size leaves the name when sizes become variants', () {
      expect(nameWithoutSize('Harpic 500 ml', '500 ml'), 'Harpic');
      expect(nameWithoutSize('Harpic 500ml', '500 ml'), 'Harpic');
      expect(nameWithoutSize('Harpic Blue', '500 ml'), 'Harpic Blue');
    });
  });

  group('billing a barcode shared by sizes', () {
    final item = {
      'name': 'Harpic',
      'barcode': '8901396151012',
      'has_variants': true,
      'variants': [
        {'id': 'v1', 'variant_name': '500 ml', 'barcode': null},
        {'id': 'v2', 'variant_name': '200 ml', 'barcode': null},
      ],
    };

    test('the item barcode asks which size', () {
      final hit = matchScannedItem([item], '8901396151012')!;
      expect(sizesToPick(hit).map((v) => v['variant_name']), ['500 ml', '200 ml']);
    });

    test('a size with its own barcode, or an item without sizes, needs no choice', () {
      final own = {
        ...item,
        'variants': [
          {'id': 'v3', 'variant_name': '1 L', 'barcode': '8901396151029'},
        ],
      };
      expect(sizesToPick(matchScannedItem([own], '8901396151029')!), isEmpty);
      expect(sizesToPick(matchScannedItem([{'name': 'Salt', 'barcode': '1234'}], '1234')!), isEmpty);
    });
  });

  test('each product gets its own key', () {
    expect(newScanAddKey(), isNot(newScanAddKey()));
  });
}
