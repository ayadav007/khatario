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

  test('inclusive scan lines keep the printed amount and split GST inside it', () {
    final lines = scannedPurchaseLines([
      {'item_name': 'Active PO - 1KG', 'quantity': 1, 'unit_price': 80, 'tax_rate': 18, 'tax_mode': 'inclusive', 'amount': 80, 'printed_rate': 80, 'printed_line_total': 80, 'mapping_rule': 'document_inclusive', 'validation_status': 'ok'},
      {'item_name': 'Reflect', 'quantity': 1, 'unit_price': 82, 'tax_rate': 18, 'tax_mode': 'inclusive', 'amount': 82, 'printed_rate': 82, 'printed_line_total': 82, 'mapping_rule': 'document_inclusive', 'validation_status': 'ok'},
      {'item_name': 'Dettol', 'quantity': 1, 'unit_price': 155, 'tax_rate': 5, 'tax_mode': 'inclusive', 'amount': 155, 'printed_rate': 155, 'printed_line_total': 155, 'mapping_rule': 'document_inclusive', 'validation_status': 'ok'},
    ]);
    expect(lines.map((line) => line.printedLineTotal), [80, 82, 155]);
    expect(lines.every((line) => line.taxMode == 'inclusive'), isTrue);
    final active = purchaseScannedLineGst(quantity: 1, unitPrice: 80, discountPercent: 0, taxRate: 18, intraState: true, lineMode: 'inclusive', headerMode: 'inclusive');
    final reflect = purchaseScannedLineGst(quantity: 1, unitPrice: 82, discountPercent: 0, taxRate: 18, intraState: true, lineMode: 'inclusive', headerMode: 'inclusive');
    final dettol = purchaseScannedLineGst(quantity: 1, unitPrice: 155, discountPercent: 0, taxRate: 5, intraState: true, lineMode: 'inclusive', headerMode: 'inclusive');
    expect(active.total, 80);
    expect(active.taxable, 67.8);
    expect(active.tax, 12.2);
    expect(reflect.total, 82);
    expect(reflect.taxable, 69.49);
    expect(reflect.tax, 12.51);
    expect(dettol.total, 155);
    expect(dettol.taxable, 147.62);
    expect(dettol.tax, 7.38);
  });

  test('exclusive scan adds GST on top of the printed taxable price', () {
    final line = scannedLine({
      'item_name': 'Active PO - 1KG',
      'quantity': 1,
      'unit_price': 80,
      'tax_rate': 18,
      'tax_mode': 'exclusive',
      'amount': 94.4,
      'printed_rate': 80,
      'printed_line_total': 80,
      'mapping_rule': 'exclusive_rate',
      'validation_status': 'discrepancy',
    });
    expect(line.printedLineTotal, 80);
    expect(line.inclusiveTotal, isNull);
    final gst = purchaseScannedLineGst(quantity: line.quantity, unitPrice: line.unitPrice, discountPercent: 0, taxRate: line.taxRate, intraState: true, lineMode: line.taxMode, headerMode: 'exclusive');
    expect(gst.taxable, 80);
    expect(gst.tax, 14.4);
    expect(gst.total, 94.4);
  });

  test('unknown price basis is not exclusive and cannot be finalized', () {
    expect(purchasePriceModeFromScan(null), 'unknown');
    expect(purchaseCanFinalize('unknown'), isFalse);
    expect(purchaseSavePriceMode('unknown'), isNull);
    expect(purchaseSaveTaxMode(null, 'unknown'), isNull);
    final line = scannedLine({
      'item_name': 'Active PO - 1KG',
      'quantity': 1,
      'unit_price': 80,
      'tax_rate': 18,
      'amount': 80,
      'printed_rate': 80,
      'printed_line_total': 80,
      'mapping_rule': 'price_basis_unknown',
      'validation_status': 'discrepancy',
    });
    expect(line.taxMode, isNull);
    expect(line.inclusiveTotal, isNull);
    expect(line.printedLineTotal, 80);
    final gst = purchaseScannedLineGst(quantity: 1, unitPrice: 80, discountPercent: 0, taxRate: 18, intraState: true, lineMode: null, headerMode: 'unknown');
    expect(gst.total, 80);
    expect(gst.tax, 0);
  });

  test('editing quantity recalculates and leaves the printed amount', () {
    final gst = purchaseScannedLineGst(quantity: 2, unitPrice: 80, discountPercent: 0, taxRate: 18, intraState: true, lineMode: 'inclusive', headerMode: 'inclusive');
    expect(gst.total, 160);
    expect(gst.taxable, closeTo(135.59, 0.01));
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

  group('bill line total and bill checks', () {
    test('a checked bill line total wins over qty × rate, as on the website', () {
      // Exclusive line: website backs GST out of the printed 1180 instead of 10 × 99.9 × 1.18.
      final gst = purchaseScannedLineGst(quantity: 10, unitPrice: 99.9, discountPercent: 0, taxRate: 18, intraState: true, lineMode: 'exclusive', headerMode: 'exclusive', inclusiveTotal: 1180);
      expect(gst.total, 1180);
      expect(gst.cgst, 90);
      expect(gst.sgst, 90);
      expect(gst.taxable, 1000);
      final igst = purchaseScannedLineGst(quantity: 1, unitPrice: 80, discountPercent: 0, taxRate: 18, intraState: false, lineMode: 'inclusive', headerMode: 'inclusive', inclusiveTotal: 80);
      expect(igst.taxable, 67.8);
      expect(igst.igst, 12.2);
      final zero = purchaseScannedLineGst(quantity: 0.486, unitPrice: 137.5, discountPercent: 0, taxRate: 0, intraState: true, lineMode: 'inclusive', headerMode: 'inclusive', inclusiveTotal: 66.83);
      expect(zero.total, 66.83);
      expect(zero.tax, 0);
    });

    test('an unresolved price basis ignores the bill line total', () {
      final gst = purchaseScannedLineGst(quantity: 2, unitPrice: 80, discountPercent: 0, taxRate: 18, intraState: true, lineMode: null, headerMode: 'unknown', inclusiveTotal: 100);
      expect(gst.total, 160);
    });

    test('flags a line whose qty × rate does not give the printed amount', () {
      final oil = purchaseScannedLineGst(quantity: 3, unitPrice: 165, discountPercent: 0, taxRate: 5, intraState: true, lineMode: 'inclusive', headerMode: 'inclusive');
      expect(scanLineDisagreesWithBill(165, oil), isTrue);
      expect(scanLineDisagreesWithBill(495, oil), isFalse);
      expect(scanLineDisagreesWithBill(null, oil), isFalse);
      // Exclusive bills print the taxable value; that is not a mismatch.
      final dal = purchaseScannedLineGst(quantity: 10, unitPrice: 100, discountPercent: 0, taxRate: 18, intraState: true, lineMode: 'exclusive', headerMode: 'exclusive');
      expect(scanLineDisagreesWithBill(1000, dal), isFalse);
    });

    test('bill total gap ignores paise and needs a printed total', () {
      expect(scanPrintedGrandTotal({'printed_grand_total': 2130.08, 'grand_total': 2000}), 2130.08);
      // No printed total: grand_total was filled from the lines, so it is not the bill's.
      expect(scanPrintedGrandTotal({'printed_grand_total': null, 'grand_total': 2130.08}), isNull);
      expect(scanPrintedGrandTotal({'grand_total': 2130.08}), 2130.08);
      expect(scanPrintedGrandTotal({}), isNull);
      expect(billTotalGap(2130.08, 1831.57), -298.51);
      expect(billTotalGap(2130.08, 2390), 259.92);
      expect(billTotalGap(2130.08, 2130.5), isNull);
      expect(billTotalGap(null, 1831.57), isNull);
    });
  });
}
