import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/purchases/bill_scan_logic.dart';

void main() {
  group('supplier auto-link', () {
    final suppliers = [
      {'id': 's1', 'name': 'Sharma Traders Pvt Ltd', 'gstin': '29ABCDE1234F1Z5'},
      {'id': 's2', 'name': 'Gupta Agencies', 'gstin': null},
    ];

    test('exact GSTIN wins over name', () {
      expect(autoLinkSupplier(suppliers, name: 'Other', gstin: '29abcde1234f1z5')?['id'], 's1');
    });

    test('normalized name drops M/s and Pvt Ltd', () {
      expect(normalizeSupplierName('M/s Sharma Traders Pvt Ltd'), 'sharma traders');
      expect(autoLinkSupplier(suppliers, name: 'M/s Sharma Traders')?['id'], 's1');
    });

    test('unknown party stays unlinked', () {
      expect(autoLinkSupplier(suppliers, name: 'Verma Steel'), isNull);
    });
  });

  group('scanned item match', () {
    final items = [
      {'id': 'i1', 'name': 'Tata Salt 1kg', 'hsn_sac': '25010020'},
      {'id': 'i2', 'name': 'Aashirvaad Atta 5kg', 'hsn_sac': '1101'},
    ];

    test('HSN chapter links first, as on the website', () {
      expect(matchScannedItem(items, name: 'Wheat flour', hsn: '11010000')?['id'], 'i2');
    });

    test('fuzzy name of 60 and up links', () {
      expect(matchScannedItem(items, name: 'TATA SALT 1 KG')?['id'], 'i1');
    });

    test('no close name leaves the line unlinked', () {
      expect(matchScannedItem(items, name: 'Parle G biscuit'), isNull);
    });

    test('Match automatically needs 85', () {
      expect(closeCatalogueMatch(items, 'Tata Salt'), isNotNull);
      expect(closeCatalogueMatch(items, 'Salt'), isNotNull);
      expect(closeCatalogueMatch(items, 'Rock salt powder'), isNull);
    });
  });

  test('scanned line keeps a discount amount instead of a percent', () {
    final line = scannedLine({
      'item_name': 'Tata Salt',
      'quantity': 0,
      'unit_price': 20.123456789,
      'discount_amount': 5,
      'discount_percent': 10,
      'tax_rate': 5,
      'tax_mode': 'inclusive',
      'amount': 100.004,
      'mapping_rule': 'rate_exclusive',
      'validation_status': 'ok',
    });
    expect(line.quantity, 1);
    expect(line.unitPrice, 20.123457);
    expect(line.discountPercent, 0);
    expect(line.discountAmount, 5);
    expect(line.taxMode, 'inclusive');
    expect(line.inclusiveTotal, 100.0);
    expect(line.unit, 'PCS');
  });

  test('line total is dropped when the mapper flagged the line', () {
    final line = scannedLine({'item_name': 'X', 'amount': 50, 'mapping_rule': 'r', 'validation_status': 'warning'});
    expect(line.inclusiveTotal, isNull);
  });

  test('place of supply falls back to the GSTIN state', () {
    expect(scannedPlaceOfSupply({'place_of_supply': ''}, gstin: '27AAAAA0000A1Z5', stateCodeOf: (_) => ''), '27');
    expect(scannedPlaceOfSupply({'place_of_supply_state_code': '29'}, stateCodeOf: (_) => ''), '29');
  });

  test('correction summary counts edits like the website', () {
    final before = {
      'supplier': {'name': 'A'},
      'invoice': {'invoice_number': '7'},
      'items': [
        {'item_name': 'Salt', 'quantity': 1, 'unit_price': 20},
      ],
      'totals': {'grand_total': 21},
    };
    final same = correctionSummary(before, {
      ...before,
      'items': [
        {'item_name': 'Salt', 'quantity': 1.0, 'unit_price': 20.0},
      ],
    });
    expect(same['accept_kind'], 'clean');
    final edited = correctionSummary(before, {
      ...before,
      'items': [
        {'item_name': 'Salt', 'quantity': 2, 'unit_price': 20},
      ],
    });
    expect(edited['accept_kind'], 'edited');
    expect(edited['items_rows_changed'], 1);
    expect((edited['item_field_changes'] as Map)['quantity'], 1);
  });
}
